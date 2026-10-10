import { Hono } from 'hono';
import { accessFor, availability, type Access } from './availability';
import { sha256, tokenFrom } from './auth';
import { getBusiness } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { onlinePaymentsOn } from './payments';
import { addDays, iso, localDay, weekdayOf } from './time';
import { aiOf } from './translate';
import { localizeText } from './contentI18n';

// Asistentul din aplicație: clientul scrie sau vorbește („Când are Florin loc vineri?”), asistentul răspunde despre
// servicii, prețuri, program și ore libere, și propune programarea. Programarea o confirmă clientul cu un buton,
// prin aceeași rută ca programarea obișnuită, deci regulile salonului rămân aceleași.

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const STT = '@cf/openai/whisper-large-v3-turbo';
const DAILY_LIMIT = 60; // mesaje pe zi pentru un client sau o adresă IP
const GLOBAL_DAILY_LIMIT = 3000; // mesaje pe zi la tot salonul (multe IP-uri diferite nu pot consuma AI-ul fără margine)
const ROUNDS = 4;
const WEEKDAYS = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'];

type Msg = { role: 'user' | 'assistant'; content: string };
type Step = { say: string; tool: 'none' | 'free_slots' | 'propose_booking'; serviceId?: string; barberId?: string; locationId?: string; day?: string; time?: string };
export type Proposal = {
  serviceId: string;
  barberId: string;
  locationId: string | null;
  start: string;
  serviceName: string;
  barberName: string;
  locationName: string | null;
  price: number;
  when: string;
};

const SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string' },
    tool: { type: 'string', enum: ['none', 'free_slots', 'propose_booking'] },
    serviceId: { type: 'string' },
    barberId: { type: 'string' },
    locationId: { type: 'string' },
    day: { type: 'string' },
    time: { type: 'string' },
  },
  required: ['say', 'tool'],
};

type Ctx = {
  services: Array<{ id: string; name: string; duration_min: number; price_bani: number; description: string }>;
  barbers: Array<{ id: string; name: string; role: string; location_id: string | null }>;
  locations: Array<{ id: string; name: string; address: string }>;
  own: Array<{ barber_id: string; service_id: string; price_bani: number | null; duration_min: number | null }>;
};

async function loadCtx(env: Env): Promise<Ctx> {
  const [s, b, o, l] = await Promise.all([
    env.DB.prepare('SELECT id, name, duration_min, price_bani, description FROM services WHERE active = 1 ORDER BY sort, name').all<Ctx['services'][number]>(),
    // Frizerii dintr-o locație dezactivată nu mai primesc programări, deci asistentul nu-i mai propune.
    env.DB.prepare(
      `SELECT b.id, b.name, b.role, b.location_id FROM barbers b LEFT JOIN locations l ON l.id = b.location_id
       WHERE b.active = 1 AND (b.location_id IS NULL OR l.active = 1) ORDER BY b.sort, b.name`,
    ).all<Ctx['barbers'][number]>(),
    env.DB.prepare('SELECT barber_id, service_id, price_bani, duration_min FROM barber_services').all<Ctx['own'][number]>(),
    env.DB.prepare('SELECT id, name, address FROM locations WHERE active = 1 ORDER BY sort, name').all<Ctx['locations'][number]>(),
  ]);
  return { services: s.results, barbers: b.results, own: o.results, locations: l.results };
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

async function systemPrompt(env: Env, ctx: Ctx, lang: string, loggedIn: boolean) {
  const biz = await getBusiness(env);
  const tz = env.TIMEZONE;
  const now = new Date();
  const today = localDay(tz, now);
  const nowHm = new Intl.DateTimeFormat('ro-RO', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = localDay(tz, new Date(now.getTime() + i * 86_400_000));
    return `${i === 0 ? 'azi' : i === 1 ? 'mâine' : WEEKDAYS[weekdayOf(d)]} = ${d}`;
  }).join('; ');
  const hours = await env.DB.prepare(
    `SELECT h.barber_id, h.weekday, h.start_min, h.end_min FROM working_hours h JOIN barbers b ON b.id = h.barber_id WHERE b.active = 1 ORDER BY h.weekday, h.start_min`,
  ).all<{ barber_id: string; weekday: number; start_min: number; end_min: number }>();
  const program = ctx.barbers
    .map((b) => {
      const rows = hours.results.filter((h) => h.barber_id === b.id);
      const txt = [1, 2, 3, 4, 5, 6, 0]
        .map((wd) => {
          const r = rows.filter((h) => h.weekday === wd);
          return r.length ? `${WEEKDAYS[wd]} ${r.map((h) => `${hm(h.start_min)}-${hm(h.end_min)}`).join(', ')}` : null;
        })
        .filter(Boolean)
        .join('; ');
      const loc = ctx.locations.length > 1 ? ctx.locations.find((l) => l.id === b.location_id) : null;
      return `- ${b.name} (id ${b.id}, ${b.role}${loc ? `, locația ${loc.name}` : ''}): ${txt || 'fără program'}`;
    })
    .join('\n');
  const services = ctx.services
    .map((s) => {
      const per = ctx.own
        .filter((o) => o.service_id === s.id && (o.price_bani !== null || o.duration_min !== null))
        .map((o) => {
          const b = ctx.barbers.find((x) => x.id === o.barber_id);
          return b ? `la ${b.name}: ${o.price_bani !== null ? o.price_bani / 100 : s.price_bani / 100} lei, ${o.duration_min ?? s.duration_min} min` : null;
        })
        .filter(Boolean);
      return `- ${s.name} (id ${s.id}): ${s.price_bani / 100} lei, ${s.duration_min} min${per.length ? ` (${per.join('; ')})` : ''}${s.description ? `. ${s.description.slice(0, 160)}` : ''}`;
    })
    .join('\n');
  const language = lang === 'en' ? 'engleză' : lang === 'fr' ? 'franceză' : 'română';
  // Cu mai multe locații, asistentul le cunoaște și întreabă la care vrea clientul să vină.
  const many = ctx.locations.length > 1;
  const locations = many
    ? `Locații (fiecare frizer lucrează într-o singură locație):\n${ctx.locations.map((l) => `- ${l.name} (id ${l.id})${l.address ? `: ${l.address}` : ''}`).join('\n')}\n`
    : '';
  return `Ești asistentul salonului ${biz.name} în aplicația de programări. Răspunzi scurt (1-3 propoziții), cald și natural, în ${language}, sau în limba în care îți scrie clientul.
Azi e ${WEEKDAYS[weekdayOf(today)]} ${today}, ora ${nowHm} (ora României). Zilele: ${days}.
Salon: ${[biz.address, biz.phone].filter(Boolean).join(', ') || 'adresa și telefonul sunt în aplicație, la Despre'}. Anulare: ${biz.cancellationPolicy || `cu cel puțin ${biz.cancelHours} ore înainte`}. Plata: ${onlinePaymentsOn(env) ? 'la salon sau cu cardul în aplicație' : 'la salon'}.
Servicii:
${services}
${locations}Frizeri și program:
${program}

Reguli:
- Nu inventa niciodată ore libere și nu spune niciodată că o oră e ocupată fără să fi verificat. Pentru ore libere folosești tool "free_slots" cu serviceId, day (AAAA-LL-ZZ) și barberId (sau fără barberId pentru oricine${many ? ', dar atunci cu locationId' : ''}). Dacă clientul cere ceva ce se potrivește cu mai multe servicii (de ex. „tuns și barbă” cu mai multe variante), întreabă-l scurt care variantă; dacă nu spune nimic de serviciu, presupune cel mai cerut (primul din listă) și spune asta.${many ? '\n- Salonul are mai multe locații: dacă clientul nu a spus frizerul sau locația, întreabă-l întâi la care locație vrea să vină.' : ''}
- Când clientul alege o oră anume dintre cele libere, folosești tool "propose_booking" cu serviceId, barberId, day și time (HH:MM). Clientul confirmă apoi cu un buton.
- ${loggedIn ? 'Clientul e conectat în cont.' : 'Clientul nu e conectat; la confirmare aplicația îi cere să intre în cont.'}
- Nu promite reduceri sau lucruri care nu sunt în listă. Pentru alte întrebări, îndrumă la telefonul salonului.
- Răspunzi DOAR cu JSON: {"say": "...", "tool": "none" | "free_slots" | "propose_booking", "serviceId": "...", "barberId": "...",${many ? ' "locationId": "...",' : ''} "day": "AAAA-LL-ZZ", "time": "HH:MM"}. În "say" scrii ce îi spui clientului.`;
}

function parseStep(raw: unknown): Step | null {
  const r = raw as { response?: unknown } | null;
  let v: unknown = r?.response ?? raw;
  if (typeof v === 'string') {
    const m = v.match(/\{[\s\S]*\}/);
    try {
      v = m ? JSON.parse(m[0]) : { say: v, tool: 'none' };
    } catch {
      v = { say: v, tool: 'none' };
    }
  }
  const s = v as Partial<Step> | null;
  if (!s || typeof s.say !== 'string') return null;
  return { ...s, say: s.say.trim(), tool: s.tool === 'free_slots' || s.tool === 'propose_booking' ? s.tool : 'none' } as Step;
}

// Ora cerută de model, în orice formă („10”, „10:00:00”, „10.30”, „ora 10”, „10 AM”), ca „HH:MM”; null dacă nu e o oră.
export function parseHm(raw?: string): string | null {
  const m = (raw ?? '').trim().toLowerCase().match(/(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Ziua cerută de model: de obicei „AAAA-LL-ZZ”, dar uneori „16.10”, „16 octombrie”, „vineri” sau „mâine”.
// Ce nu se înțelege întoarce null; atunci NU se presupune „azi” (așa verifica greșit sâmbăta în loc de vineri).
const MONTHS: Record<string, number> = {
  ian: 1, jan: 1, janv: 1, feb: 2, fev: 2, févr: 2, mar: 3, mars: 3, apr: 4, avr: 4, mai: 5, may: 5, iun: 6, jun: 6, juin: 6,
  iul: 7, jul: 7, juil: 7, aug: 8, août: 8, aou: 8, sep: 9, sept: 9, oct: 10, noi: 11, nov: 11, dec: 12, déc: 12,
};
const WEEKDAY_WORDS: Array<[RegExp, number]> = [
  [/duminic|sunday|dimanche/, 0], [/\bluni\b|monday|lundi/, 1], [/mar[țţt]i\b|tuesday|mardi/, 2], [/miercuri|wednesday|mercredi/, 3],
  [/\bjoi\b|thursday|jeudi/, 4], [/vineri|friday|vendredi/, 5], [/s[âa]mb[ăa]t|saturday|samedi/, 6],
];
export function parseDay(raw: string | undefined, today: string): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const ty = Number(today.slice(0, 4));
  const ymd = (d: number, mo: number, y?: number) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let day = `${y ?? ty}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!y && day < today) day = `${ty + 1}${day.slice(4)}`;
    return day;
  };
  m = v.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/);
  if (m) return ymd(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
  m = v.match(/(\d{1,2})\s+([a-zăâîșțéû]+)\.?(?:\s+(\d{4}))?/);
  if (m) {
    const key = Object.keys(MONTHS).sort((a, b) => b.length - a.length).find((k) => m![2].startsWith(k));
    if (key) return ymd(Number(m[1]), MONTHS[key], m[3] ? Number(m[3]) : undefined);
  }
  if (/\b(azi|astăzi|astazi|today|aujourd)/.test(v)) return today;
  if (/poim[âa]ine/.test(v)) return addDays(today, 2);
  if (/m[âa]ine|tomorrow|demain/.test(v)) return addDays(today, 1);
  for (const [re, wd] of WEEKDAY_WORDS) {
    if (re.test(v)) {
      const diff = (wd - weekdayOf(today) + 7) % 7;
      return addDays(today, diff);
    }
  }
  return null;
}

// „Nu e liber” spus fără să fi verificat: modelul nu are voie să decidă singur că o oră e ocupată.
const SAYS_BUSY = /(nu (mai )?(e|este|sunt|avem)[^.?!]{0,40}(liber|disponibil|valabil|loc))|indisponibil|ocupat|not available|unavailable|fully booked|pas disponible/i;

const fmtTime = (env: Env, iso: string) => new Intl.DateTimeFormat('ro-RO', { timeZone: env.TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const fmtWhen = (env: Env, iso: string, lang: string) =>
  new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang === 'fr' ? 'fr-FR' : 'ro-RO', { timeZone: env.TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/** O conversație: istoricul vine de la aplicație; întoarce răspunsul și, dacă e cazul, programarea propusă. */
export async function chat(env: Env, history: Msg[], lang: string, loggedIn: boolean, access: Access = 'public'): Promise<{ reply: string; proposal?: Proposal }> {
  const ai = aiOf(env);
  if (!ai) throw new HttpError(409, 'assistant_off');
  const ctx = await loadCtx(env);
  const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: await systemPrompt(env, ctx, lang, loggedIn) }, ...history];
  const svcOf = (id?: string) => ctx.services.find((s) => s.id === id) ?? null;
  const barberOf = (id?: string) => (id ? (ctx.barbers.find((b) => b.id === id || b.name.toLowerCase() === id.toLowerCase()) ?? null) : null);
  const locationOf = (id?: string) => (id ? (ctx.locations.find((l) => l.id === id || l.name.toLowerCase() === id.toLowerCase()) ?? null) : null);

  let checked = false; // a verificat orele măcar o dată în cererea asta
  for (let round = 0; round < ROUNDS; round++) {
    let raw: unknown;
    try {
      raw = await ai.run(MODEL, { messages, response_format: { type: 'json_schema', json_schema: SCHEMA }, max_tokens: 400, temperature: 0.3 });
    } catch (e) {
      console.error('assistant ai', e);
      throw new HttpError(500, 'assistant_failed');
    }
    const step = parseStep(raw);
    if (!step) throw new HttpError(500, 'assistant_failed');
    messages.push({ role: 'assistant', content: JSON.stringify(step) });
    if (step.tool === 'none') {
      if (!checked && round < ROUNDS - 1 && SAYS_BUSY.test(step.say)) {
        messages.push({ role: 'user', content: '[SISTEM] Nu ai verificat orele. Nu spune că o oră e ocupată fără să folosești free_slots sau propose_booking pentru ziua aceea. Verifică acum.' });
        continue;
      }
      return { reply: step.say };
    }
    checked = true;

    const svc = svcOf(step.serviceId) ?? ctx.services[0];
    const barber = barberOf(step.barberId);
    // Cu frizer ales, locația e a lui; cu o singură locație, e aceea.
    const loc = barber ? null : (locationOf(step.locationId) ?? (ctx.locations.length === 1 ? ctx.locations[0] : null));
    if (!barber && !loc && ctx.locations.length > 1) {
      messages.push({
        role: 'user',
        content: `[REZULTAT locatie] Salonul are mai multe locații: ${ctx.locations.map((l) => `${l.name} (id ${l.id})`).join(', ')}. Întreabă clientul la care locație vrea să vină (sau la ce frizer), fără ore deocamdată.`,
      });
      continue;
    }
    const today = localDay(env.TIMEZONE, new Date());
    const day = parseDay(step.day, today);
    if (!day) {
      console.log('assistant day miss', JSON.stringify({ day: step.day, tool: step.tool }));
      messages.push({ role: 'user', content: `[REZULTAT ${step.tool}] Nu știu ce zi e „${step.day ?? ''}”. Ia ziua din conversație și scrie-o ca AAAA-LL-ZZ, din lista de zile (de ex. vineri = ${parseDay('vineri', today)}). Dacă clientul n-a spus ziua, întreabă-l.` });
      continue;
    }
    if (!svc) return { reply: step.say };
    // Aceleași limite ca în aplicație: nici zile trecute, nici mai departe decât „cu câte zile înainte” din setări.
    const inRange = day >= today && day <= addDays(today, (await getBusiness(env)).maxDaysAhead ?? 30);
    const slots = inRange ? await availability(env, { serviceId: svc.id, barberId: barber?.id ?? null, locationId: loc?.id ?? null, day, access }) : [];

    if (step.tool === 'free_slots') {
      const byBarber = new Map<string, string[]>();
      for (const s of slots) byBarber.set(s.barberId, [...(byBarber.get(s.barberId) ?? []), fmtTime(env, s.start)]);
      const txt = slots.length
        ? [...byBarber.entries()].map(([id, t]) => `${ctx.barbers.find((b) => b.id === id)?.name ?? id}: ${t.slice(0, 16).join(', ')}${t.length > 16 ? '…' : ''}`).join('\n')
        : 'nicio oră liberă în ziua asta';
      messages.push({ role: 'user', content: `[REZULTAT free_slots] ${svc.name}${loc && ctx.locations.length > 1 ? `, locația ${loc.name}` : ''}, ${WEEKDAYS[weekdayOf(day)]} ${day}:\n${txt}\nSpune-i clientului pe scurt orele (sau propune altă zi). Nu folosi din nou free_slots pentru aceeași zi.` });
      continue;
    }

    // propose_booking: ora trebuie să fie chiar una dintre cele libere.
    const want = parseHm(step.time) ?? (step.time ?? '');
    const slot = slots.find((s) => fmtTime(env, s.start) === want);
    if (!slot) {
      console.log('assistant propose miss', JSON.stringify({ day, time: step.time, want, serviceId: step.serviceId, barberId: step.barberId, free: slots.length }));
      messages.push({ role: 'user', content: `[REZULTAT propose_booking] Ora ${want} din ${day} nu e liberă${barber ? ` la ${barber.name}` : ''}. Orele libere: ${slots.map((s) => fmtTime(env, s.start)).slice(0, 12).join(', ') || 'niciuna'}. Spune-i clientului și cere altă oră.` });
      continue;
    }
    const b = ctx.barbers.find((x) => x.id === slot.barberId)!;
    const own = ctx.own.find((o) => o.barber_id === b.id && o.service_id === svc.id);
    const where = ctx.locations.find((l) => l.id === b.location_id) ?? null;
    return {
      reply: step.say,
      proposal: {
        serviceId: svc.id,
        barberId: b.id,
        locationId: where?.id ?? null,
        start: slot.start,
        // Numele serviciului în limba clientului (traducerea din panou), ca pe ecranul de confirmare.
        serviceName: await localizeText(env, lang, svc.name),
        barberName: b.name,
        locationName: where?.name ?? null,
        price: (own?.price_bani ?? svc.price_bani) / 100,
        when: fmtWhen(env, slot.start, lang),
      },
    };
  }
  return {
    reply:
      lang === 'en'
        ? 'Sorry, I could not find an answer. Please call the salon.'
        : lang === 'fr'
          ? 'Désolé, je n’ai pas trouvé de réponse. Veuillez appeler le salon.'
          : 'Nu am reușit să găsesc răspunsul. Te rog sună la salon.',
  };
}

/** Câte mesaje pe zi: după client sau după adresa IP, plus o limită pentru tot salonul. Aruncă eroarea potrivită peste limită. */
async function checkLimit(env: Env, key: string) {
  const day = iso(new Date()).slice(0, 10);
  const count = async (k: string) =>
    (
      await env.DB.prepare(`INSERT INTO assistant_usage (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1 RETURNING n`)
        .bind(day, k)
        .first<{ n: number }>()
    )?.n ?? 0;
  if ((await count(key)) > DAILY_LIMIT) throw new HttpError(429, 'assistant_limit');
  if ((await count('*')) > GLOBAL_DAILY_LIMIT) throw new HttpError(429, 'assistant_busy');
}

async function whoIs(env: Env, token: string | null) {
  if (!token) return null;
  const s = await env.DB.prepare(`SELECT subject_id FROM sessions WHERE token_hash = ? AND kind = 'client' AND expires_at > ?`)
    .bind(await sha256(token), iso(new Date()))
    .first<{ subject_id: string }>();
  return s?.subject_id ?? null;
}

export const assistantRoutes = new Hono<AppEnv>();

assistantRoutes.post('/assistant', async (c) => {
  const b = await c.req.json<{ messages?: unknown; lang?: unknown }>().catch(() => ({}) as { messages?: unknown; lang?: unknown });
  const lang = b.lang === 'en' || b.lang === 'fr' ? b.lang : 'ro';
  const history = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m): m is Msg => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim() !== '')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
  if (!history.length || history[history.length - 1].role !== 'user') throw new HttpError(400, 'message_required');
  const clientId = await whoIs(c.env, tokenFrom(c));
  const key = clientId ?? `ip:${c.req.header('CF-Connecting-IP') ?? 'local'}`;
  await checkLimit(c.env, key);
  return c.json(await chat(c.env, history, lang, !!clientId, await accessFor(c.env, clientId)));
});

/** Vocea clientului (fișierul audio, max ~1 minut) transformată în text. */
assistantRoutes.post('/assistant/voice', async (c) => {
  const ai = aiOf(c.env);
  if (!ai) throw new HttpError(409, 'assistant_off');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'empty_file');
  if (buf.byteLength > 3_000_000) throw new HttpError(400, 'audio_too_long');
  const clientId = await whoIs(c.env, tokenFrom(c));
  await checkLimit(c.env, clientId ?? `ip:${c.req.header('CF-Connecting-IP') ?? 'local'}`);
  const lang = c.req.query('lang');
  let bin = '';
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  try {
    const r = (await ai.run(STT, { audio: btoa(bin), task: 'transcribe', ...(lang === 'ro' || lang === 'en' || lang === 'fr' ? { language: lang } : {}), vad_filter: true })) as { text?: string };
    return c.json({ text: (r?.text ?? '').trim() });
  } catch (e) {
    console.error('assistant voice', e);
    throw new HttpError(500, 'assistant_failed');
  }
});
