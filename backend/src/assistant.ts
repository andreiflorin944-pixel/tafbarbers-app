import { Hono } from 'hono';
import { accessFor, availability, type Access } from './availability';
import { sha256, tokenFrom } from './auth';
import { getBusiness } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { onlinePaymentsOn } from './payments';
import { addDays, iso, localDay, weekdayOf } from './time';

// Asistentul din aplicație: clientul scrie sau vorbește („Când are Florin loc vineri?”), asistentul răspunde despre
// servicii, prețuri, program și ore libere, și propune programarea. Programarea o confirmă clientul cu un buton,
// prin aceeași rută ca programarea obișnuită, deci regulile salonului rămân aceleași.

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const STT = '@cf/openai/whisper-large-v3-turbo';
const DAILY_LIMIT = 60; // mesaje pe zi pentru un client sau o adresă IP
const GLOBAL_DAILY_LIMIT = 3000; // mesaje pe zi la tot salonul (multe IP-uri diferite nu pot consuma AI-ul fără margine)
const ROUNDS = 3;
const WEEKDAYS = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'];

type Msg = { role: 'user' | 'assistant'; content: string };
type Step = { say: string; tool: 'none' | 'free_slots' | 'propose_booking'; serviceId?: string; barberId?: string; day?: string; time?: string };
export type Proposal = { serviceId: string; barberId: string; start: string; serviceName: string; barberName: string; price: number; when: string };
type Ai = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

const SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string' },
    tool: { type: 'string', enum: ['none', 'free_slots', 'propose_booking'] },
    serviceId: { type: 'string' },
    barberId: { type: 'string' },
    day: { type: 'string' },
    time: { type: 'string' },
  },
  required: ['say', 'tool'],
};

/** Workers AI; local, pentru teste, un server de probă (DEV_AI_MOCK_BASE). */
function aiOf(env: Env): Ai | null {
  if (env.AI) return env.AI;
  const base = env.DEV_AI_MOCK_BASE;
  if (!base) return null;
  return {
    run: async (model, input) => {
      const r = await fetch(`${base}/ai/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input }) });
      return r.json();
    },
  };
}

type Ctx = {
  services: Array<{ id: string; name: string; duration_min: number; price_bani: number; description: string }>;
  barbers: Array<{ id: string; name: string; role: string }>;
  own: Array<{ barber_id: string; service_id: string; price_bani: number | null; duration_min: number | null }>;
};

async function loadCtx(env: Env): Promise<Ctx> {
  const [s, b, o] = await Promise.all([
    env.DB.prepare('SELECT id, name, duration_min, price_bani, description FROM services WHERE active = 1 ORDER BY sort, name').all<Ctx['services'][number]>(),
    env.DB.prepare('SELECT id, name, role FROM barbers WHERE active = 1 ORDER BY sort, name').all<Ctx['barbers'][number]>(),
    env.DB.prepare('SELECT barber_id, service_id, price_bani, duration_min FROM barber_services').all<Ctx['own'][number]>(),
  ]);
  return { services: s.results, barbers: b.results, own: o.results };
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
      return `- ${b.name} (id ${b.id}, ${b.role}): ${txt || 'fără program'}`;
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
  return `Ești asistentul salonului ${biz.name} în aplicația de programări. Răspunzi scurt (1-3 propoziții), cald și natural, în ${language}, sau în limba în care îți scrie clientul.
Azi e ${WEEKDAYS[weekdayOf(today)]} ${today}, ora ${nowHm} (ora României). Zilele: ${days}.
Salon: ${[biz.address, biz.phone].filter(Boolean).join(', ') || 'adresa și telefonul sunt în aplicație, la Despre'}. Anulare: ${biz.cancellationPolicy || `cu cel puțin ${biz.cancelHours} ore înainte`}. Plata: ${onlinePaymentsOn(env) ? 'la salon sau cu cardul în aplicație' : 'la salon'}.
Servicii:
${services}
Frizeri și program:
${program}

Reguli:
- Nu inventa niciodată ore libere. Pentru ore libere folosești tool "free_slots" cu serviceId, day (AAAA-LL-ZZ) și barberId (sau fără barberId pentru oricine). Dacă nu știi serviciul, presupune cel mai cerut (primul din listă) și spune asta.
- Când clientul alege o oră anume dintre cele libere, folosești tool "propose_booking" cu serviceId, barberId, day și time (HH:MM). Clientul confirmă apoi cu un buton.
- ${loggedIn ? 'Clientul e conectat în cont.' : 'Clientul nu e conectat; la confirmare aplicația îi cere să intre în cont.'}
- Nu promite reduceri sau lucruri care nu sunt în listă. Pentru alte întrebări, îndrumă la telefonul salonului.
- Răspunzi DOAR cu JSON: {"say": "...", "tool": "none" | "free_slots" | "propose_booking", "serviceId": "...", "barberId": "...", "day": "AAAA-LL-ZZ", "time": "HH:MM"}. În "say" scrii ce îi spui clientului.`;
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
    if (step.tool === 'none') return { reply: step.say };

    const svc = svcOf(step.serviceId) ?? ctx.services[0];
    const barber = barberOf(step.barberId);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(step.day ?? '') ? step.day! : localDay(env.TIMEZONE, new Date());
    if (!svc) return { reply: step.say };
    // Aceleași limite ca în aplicație: nici zile trecute, nici mai departe decât „cu câte zile înainte” din setări.
    const today = localDay(env.TIMEZONE, new Date());
    const inRange = day >= today && day <= addDays(today, (await getBusiness(env)).maxDaysAhead ?? 30);
    const slots = inRange ? await availability(env, { serviceId: svc.id, barberId: barber?.id ?? null, day, access }) : [];

    if (step.tool === 'free_slots') {
      const byBarber = new Map<string, string[]>();
      for (const s of slots) byBarber.set(s.barberId, [...(byBarber.get(s.barberId) ?? []), fmtTime(env, s.start)]);
      const txt = slots.length
        ? [...byBarber.entries()].map(([id, t]) => `${ctx.barbers.find((b) => b.id === id)?.name ?? id}: ${t.slice(0, 16).join(', ')}${t.length > 16 ? '…' : ''}`).join('\n')
        : 'nicio oră liberă în ziua asta';
      messages.push({ role: 'user', content: `[REZULTAT free_slots] ${svc.name}, ${WEEKDAYS[weekdayOf(day)]} ${day}:\n${txt}\nSpune-i clientului pe scurt orele (sau propune altă zi). Nu folosi din nou free_slots pentru aceeași zi.` });
      continue;
    }

    // propose_booking: ora trebuie să fie chiar una dintre cele libere.
    const want = (step.time ?? '').replace('.', ':').padStart(5, '0');
    const slot = slots.find((s) => fmtTime(env, s.start) === want);
    if (!slot) {
      messages.push({ role: 'user', content: `[REZULTAT propose_booking] Ora ${want} din ${day} nu e liberă${barber ? ` la ${barber.name}` : ''}. Orele libere: ${slots.map((s) => fmtTime(env, s.start)).slice(0, 12).join(', ') || 'niciuna'}. Spune-i clientului și cere altă oră.` });
      continue;
    }
    const b = ctx.barbers.find((x) => x.id === slot.barberId)!;
    const own = ctx.own.find((o) => o.barber_id === b.id && o.service_id === svc.id);
    return {
      reply: step.say,
      proposal: {
        serviceId: svc.id,
        barberId: b.id,
        start: slot.start,
        serviceName: svc.name,
        barberName: b.name,
        price: (own?.price_bani ?? svc.price_bani) / 100,
        when: fmtWhen(env, slot.start, lang),
      },
    };
  }
  return { reply: lang === 'en' ? 'Sorry, I could not find an answer. Please call the salon.' : 'Nu am reușit să găsesc răspunsul. Te rog sună la salon.' };
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
