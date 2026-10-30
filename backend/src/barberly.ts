import { Hono, type Context, type Next } from 'hono';
import { newId, normalizePhone, randomToken, sha256 } from './auth';
import { HOLDS_SLOT, logBookingEvent } from './bookings';
import { getSetting, setSetting } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { iso, localToUtc } from './time';

// Copierea programărilor din Barberly, cât timp clienții se mută în aplicația nouă.
// Barberly nu are export și nici API cu lista programărilor, dar trimite proprietarului un e-mail la fiecare programare
// nouă sau anulare („Numire nouă: <client>”, cu Client + telefon, Când, Unde, Servicii + Total, Cu <frizer>).
// Un script din Gmail (generat în panou, cu o cheie proprie) trimite aceste e-mailuri la /v1/barberly/inbound;
// același text se poate lipi și de mână în panou. Programările intră fără SMS sau reminder de la noi (le trimite Barberly).

export type ParsedMail = {
  kind: 'new' | 'cancel' | 'change' | 'unknown';
  clientName: string;
  phone: string | null;
  day: string | null;
  minutes: number | null;
  services: string[];
  totalBani: number | null;
  barber: string | null;
};

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };

/** HTML → rânduri de text (câte un rând pentru fiecare bloc, celulă sau <br>). */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|td|th|tr|li|h[1-6]|table|span|a)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENTITIES[e.toLowerCase()] ?? m),
    );
  return linesOf(text);
}

const linesOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/[\s ​]+/g, ' ').trim())
    .filter(Boolean);

const LABELS = {
  client: ['client', 'customer', 'clientul'],
  when: ['cand', 'when', 'data si ora', 'date'],
  where: ['unde', 'where', 'locatie', 'location'],
  services: ['servicii', 'serviciu', 'services', 'service'],
  with: ['cu', 'with', 'frizer', 'team member', 'staff'],
} as const;
type Label = keyof typeof LABELS;
const labelOf = (line: string): Label | null => {
  const f = fold(line);
  for (const k of Object.keys(LABELS) as Label[]) if ((LABELS[k] as readonly string[]).includes(f)) return k;
  return null;
};

const MONTHS: Record<string, number> = { jan: 1, ian: 1, feb: 2, mar: 3, apr: 4, may: 5, mai: 5, jun: 6, iun: 6, jul: 7, iul: 7, aug: 8, sep: 9, oct: 10, nov: 11, noi: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

/** „Oct 31, 2026 11:30”, „31 oct. 2026, 11:30”, „31.10.2026 11:30”, „2026-10-31 11:30” → zi locală + minute. */
export function parseWhen(s: string): { day: string; minutes: number } | null {
  const t = fold(s.replace(/[.,]/g, ' ')).replace(/\s+/g, ' ');
  const raw = s.toLowerCase();
  const hm = (h: string, m: string, ap?: string) => {
    let hh = +h;
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    return hh * 60 + +m;
  };
  const ok = (y: number, mo: number, d: number, min: number) =>
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && min >= 0 && min < 1440 ? { day: `${y}-${pad(mo)}-${pad(d)}`, minutes: min } : null;
  let m = raw.match(/(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})/);
  if (m) return ok(+m[1], +m[2], +m[3], hm(m[4], m[5]));
  m = raw.match(/(\d{1,2})[./](\d{1,2})[./](\d{4}),?\s+(?:la\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (m) return ok(+m[3], +m[2], +m[1], hm(m[4], m[5], m[6]));
  const time = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (!time) return null;
  const min = hm(time[1], time[2], time[3]);
  m = t.match(/([a-z]{3})[a-z]* (\d{1,2}) (\d{4})/); // Oct 31 2026
  if (m && MONTHS[m[1]]) return ok(+m[3], MONTHS[m[1]], +m[2], min);
  m = t.match(/(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})/); // 31 oct 2026
  if (m && MONTHS[m[2]]) return ok(+m[3], MONTHS[m[2]], +m[1], min);
  return null;
}

const PHONE = /^\+?[\d\s\-().]{8,20}$/;
const TOTAL = /^total\s*:?\s*(?:lei|ron)?\s*([\d.,]+)?/i;
const money = (s: string) => {
  const n = Number(s.replace(/\s/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/** Citește un e-mail Barberly (subiect + rânduri de text). */
export function parseMail(subject: string, lines: string[]): ParsedMail {
  const idx: Partial<Record<Label, number>> = {};
  lines.forEach((l, i) => {
    const k = labelOf(l);
    if (k && idx[k] === undefined) idx[k] = i;
  });
  const starts = Object.values(idx).sort((a, b) => a - b);
  const block = (k: Label) => {
    const i = idx[k];
    if (i === undefined) return [];
    const next = starts.find((s) => s > i) ?? lines.length;
    return lines.slice(i + 1, next);
  };

  const cl = block('client');
  const phoneLine = cl.find((l) => PHONE.test(l) && /\d{8}/.test(l.replace(/\D/g, '')));
  let phone: string | null = null;
  try {
    phone = phoneLine ? normalizePhone(phoneLine) : null;
  } catch {
    phone = null;
  }
  const clientName = cl.find((l) => l !== phoneLine) ?? subject.replace(/^[^:]*:\s*/, '').trim();

  const whenLine = block('when')[0] ?? '';
  const when = parseWhen(whenLine);

  const services: string[] = [];
  let totalBani: number | null = null;
  const sv = block('services');
  for (let i = 0; i < sv.length; i++) {
    const t = sv[i].match(TOTAL);
    if (t) {
      totalBani = t[1] ? money(t[1]) : sv[i + 1] ? money(sv[i + 1]) : null;
      break;
    }
    services.push(sv[i]);
  }
  const barber = block('with')[0] ?? null;

  const head = fold(`${subject} ${lines.slice(0, 6).join(' ')}`);
  const kind: ParsedMail['kind'] = /anulat|anulare|anulata|cancel/.test(head)
    ? 'cancel'
    : /reprogram|modificat|schimbat|mutat|resched|changed|updated|actualizat/.test(head)
      ? 'change'
      : phone && when
        ? 'new'
        : 'unknown';
  return { kind, clientName, phone, day: when?.day ?? null, minutes: when?.minutes ?? null, services, totalBani, barber };
}

type Svc = { id: string; name: string; duration_min: number; price_bani: number };

/** Serviciul nostru după numele din Barberly (la noi sunt aceleași nume, uneori doar jumătatea în română sau engleză). */
export function matchService(name: string, list: Svc[]): Svc | null {
  const f = fold(name);
  const halves = (s: string) => fold(s).split('/').map((x) => x.trim()).filter(Boolean);
  return (
    list.find((s) => fold(s.name) === f) ??
    list.find((s) => halves(s.name).some((h) => halves(name).includes(h))) ??
    list.find((s) => fold(s.name).includes(f) || f.includes(fold(s.name))) ??
    null
  );
}

export type ImportResult = { kind: ParsedMail['kind']; result: string; detail: string; bookingId: string | null };

/** Face (sau anulează) programarea din e-mail. Nu trimite nimic clientului. */
export async function applyMail(env: Env, p: ParsedMail, now = new Date()): Promise<ImportResult> {
  const out = (result: string, detail = '', bookingId: string | null = null): ImportResult => ({ kind: p.kind, result, detail, bookingId });
  if (p.kind === 'unknown') return out('ignored', 'Nu pare un e-mail de programare de la Barberly.');
  if (!p.phone) return out('error', 'Lipsește telefonul clientului.');
  if (!p.day || p.minutes === null) return out('error', 'Nu am înțeles data și ora.');
  const start = localToUtc(env.TIMEZONE, p.day, p.minutes);

  if (p.kind === 'cancel') {
    const b = await env.DB.prepare(
      `SELECT b.id FROM bookings b JOIN clients c ON c.id = b.client_id
       WHERE c.phone = ? AND b.starts_at = ? AND b.status IN ${HOLDS_SLOT} ORDER BY b.barberly_ref IS NULL LIMIT 1`,
    )
      .bind(p.phone, iso(start))
      .first<{ id: string }>();
    if (!b) return out('ignored', 'Nu există la noi o programare activă la ora asta pentru acest client.');
    await env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'client' WHERE id = ?`).bind(iso(now), b.id).run();
    await logBookingEvent(env, b.id, 'barberly_cancel', {}, null);
    return out('cancelled', '', b.id);
  }

  if (start.getTime() < now.getTime()) return out('past', 'Programarea a trecut deja.');

  const barbers = await env.DB.prepare('SELECT id, name FROM barbers WHERE active = 1').all<{ id: string; name: string }>();
  const bf = fold(p.barber ?? '');
  const barber =
    barbers.results.find((b) => fold(b.name) === bf) ??
    barbers.results.find((b) => bf && (fold(b.name).split(' ')[0] === bf.split(' ')[0])) ??
    null;
  if (!barber) return out('error', `Nu găsesc frizerul „${p.barber ?? ''}”.`);

  const svcs = await env.DB.prepare('SELECT id, name, duration_min, price_bani FROM services').all<Svc>();
  const matched = p.services.map((n) => matchService(n, svcs.results));
  const missing = p.services.filter((_, i) => !matched[i]);
  if (!p.services.length || missing.length) return out('error', `Nu găsesc serviciul „${missing.join(', ') || '(lipsă)'}”.`);
  const found = matched as Svc[];
  // Durata frizerului pentru fiecare serviciu, adunată (o programare cu două servicii ține ora pentru amândouă).
  let minutes = 0;
  let listBani = 0;
  for (const s of found) {
    const own = await env.DB.prepare('SELECT price_bani, duration_min FROM barber_services WHERE barber_id = ? AND service_id = ?')
      .bind(barber.id, s.id)
      .first<{ price_bani: number | null; duration_min: number | null }>();
    minutes += own?.duration_min ?? s.duration_min;
    listBani += own?.price_bani ?? s.price_bani;
  }
  const end = new Date(start.getTime() + minutes * 60_000);
  const price = p.totalBani ?? listBani;
  const extra = found.length > 1 ? ` (${found.map((s) => s.name).join(' + ')})` : '';
  const note = `Din Barberly${extra}`;

  if (p.kind === 'change') {
    // E-mailul de modificare are doar ora nouă: dacă clientul are o singură programare viitoare venită din Barberly, aceea se mută.
    const prev = await env.DB.prepare(
      `SELECT b.id, b.starts_at FROM bookings b JOIN clients c ON c.id = b.client_id
       WHERE c.phone = ? AND b.barberly_ref IS NOT NULL AND b.status IN ${HOLDS_SLOT} AND b.starts_at > ?`,
    )
      .bind(p.phone, iso(now))
      .all<{ id: string; starts_at: string }>();
    if (prev.results.length === 1 && prev.results[0].starts_at !== iso(start)) {
      const id = prev.results[0].id;
      await env.DB.prepare(
        `UPDATE bookings SET starts_at = ?, ends_at = ?, barber_id = ?, service_id = ?, price_bani = ?, note = ?, barberly_ref = ?,
           location_id = (SELECT location_id FROM barbers WHERE id = ?) WHERE id = ?`,
      )
        .bind(iso(start), iso(end), barber.id, found[0].id, price, note, refOf(p.phone, start, barber.id), barber.id, id)
        .run();
      await logBookingEvent(env, id, 'barberly_change', { from: prev.results[0].starts_at, to: iso(start) }, null);
      return out('updated', '', id);
    }
  }

  let client = await env.DB.prepare('SELECT id, name FROM clients WHERE phone = ? AND deleted_at IS NULL').bind(p.phone).first<{ id: string; name: string }>();
  if (!client) {
    client = { id: newId('cl'), name: p.clientName.slice(0, 80) };
    await env.DB.prepare('INSERT INTO clients (id, phone, name, marketing_push) VALUES (?, ?, ?, 0)').bind(client.id, p.phone, client.name).run();
  } else if (!client.name && p.clientName) {
    await env.DB.prepare('UPDATE clients SET name = ? WHERE id = ?').bind(p.clientName.slice(0, 80), client.id).run();
  }

  const overlap = await env.DB.prepare(`SELECT 1 FROM bookings WHERE barber_id = ? AND status IN ${HOLDS_SLOT} AND starts_at < ? AND ends_at > ? LIMIT 1`)
    .bind(barber.id, iso(end), iso(start))
    .first();
  const id = newId('bk');
  const stamp = iso(now);
  // Reminder-ele le trimite Barberly: la noi se marchează ca trimise, ca clientul să nu primească două.
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO bookings (id, client_id, barber_id, service_id, starts_at, ends_at, price_bani, source, note, status, location_id, barberly_ref, reminder_24h_at, reminder_2h_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', ?, 'confirmed', (SELECT location_id FROM barbers WHERE id = ?), ?, ?, ?)`,
  )
    .bind(id, client.id, barber.id, found[0].id, iso(start), iso(end), price, note, barber.id, refOf(p.phone, start, barber.id), stamp, stamp)
    .run();
  if (!res.meta.changes) return out('duplicate', 'Programarea există deja.');
  await logBookingEvent(env, id, 'barberly_import', {}, null);
  return out('created', overlap ? 'Atenție: se suprapune cu o altă programare a frizerului.' : '', id);
}

const refOf = (phone: string, start: Date, barberId: string) => `${phone}|${iso(start)}|${barberId}`;

export type InboundMail = { id?: string; from?: string; subject?: string; html?: string; text?: string };

/** Un e-mail primit (de la scriptul din Gmail sau lipit în panou): o singură procesare pentru fiecare id de mesaj. */
export async function importMail(env: Env, m: InboundMail, now = new Date()): Promise<ImportResult & { messageId: string }> {
  const subject = (m.subject ?? '').slice(0, 300);
  const lines = m.html ? htmlToLines(m.html) : linesOf(m.text ?? '');
  const messageId = (m.id ?? '').slice(0, 200) || `h:${await sha256(`${subject}\n${lines.join('\n')}`)}`;
  const seen = await env.DB.prepare('SELECT kind, result, detail, booking_id FROM barberly_inbox WHERE message_id = ?')
    .bind(messageId)
    .first<{ kind: ParsedMail['kind']; result: string; detail: string; booking_id: string | null }>();
  // Erorile se pot reîncerca (ex. după ce s-a adăugat serviciul lipsă); restul rămân cum s-au procesat prima dată.
  if (seen && seen.result !== 'error') return { messageId, kind: seen.kind, result: 'duplicate', detail: seen.detail, bookingId: seen.booking_id };
  let r: ImportResult;
  try {
    r = await applyMail(env, parseMail(subject, lines), now);
  } catch (e) {
    r = { kind: 'unknown', result: 'error', detail: String(e instanceof Error ? e.message : e).slice(0, 300), bookingId: null };
  }
  await env.DB.prepare(
    `INSERT INTO barberly_inbox (message_id, received_at, subject, kind, result, detail, booking_id) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET received_at = excluded.received_at, kind = excluded.kind, result = excluded.result, detail = excluded.detail, booking_id = excluded.booking_id`,
  )
    .bind(messageId, iso(now), subject, r.kind, r.result, r.detail, r.bookingId)
    .run();
  return { messageId, ...r };
}

type ImportSettings = { tokenHash: string | null; createdAt: string | null };
const SETTINGS = 'barberly_import';

// Intrarea pentru scriptul din Gmail: cheia lui (Bearer), generată în panou; în baza de date stă doar amprenta ei.
export const barberlyPublic = new Hono<AppEnv>();
barberlyPublic.post('/barberly/inbound', async (c) => {
  const s = await getSetting<ImportSettings>(c.env, SETTINGS, { tokenHash: null, createdAt: null });
  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!s.tokenHash || !token || (await sha256(token)) !== s.tokenHash) throw new HttpError(401, 'unauthorized');
  const m = await c.req.json<InboundMail>();
  // Doar e-mailurile trimise de Barberly (scriptul caută deja după expeditor; aici e a doua verificare).
  if (!/barberly/i.test(m.from ?? '')) return c.json({ result: 'ignored' });
  const r = await importMail(c.env, m);
  return c.json(r);
});

async function ownerOnly(c: Context<AppEnv>, next: Next) {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
}

export const barberlyAdmin = new Hono<AppEnv>();
barberlyAdmin.use('/barberly/*', ownerOnly);

barberlyAdmin.get('/barberly/status', async (c) => {
  const s = await getSetting<ImportSettings>(c.env, SETTINGS, { tokenHash: null, createdAt: null });
  const log = await c.env.DB.prepare(
    `SELECT i.message_id AS id, i.received_at AS receivedAt, i.subject, i.kind, i.result, i.detail, i.booking_id AS bookingId, b.starts_at AS startsAt, cl.name AS clientName, br.name AS barberName
     FROM barberly_inbox i LEFT JOIN bookings b ON b.id = i.booking_id LEFT JOIN clients cl ON cl.id = b.client_id LEFT JOIN barbers br ON br.id = b.barber_id
     ORDER BY i.received_at DESC LIMIT 100`,
  ).all();
  const n = await c.env.DB.prepare(`SELECT count(*) AS n FROM bookings WHERE barberly_ref IS NOT NULL AND status IN ${HOLDS_SLOT} AND starts_at > ?`)
    .bind(iso(new Date()))
    .first<{ n: number }>();
  return c.json({ connected: !!s.tokenHash, createdAt: s.createdAt, upcoming: n?.n ?? 0, log: log.results });
});

// Cheie nouă pentru script (o arată o singură dată, în codul scriptului); cea veche nu mai merge.
barberlyAdmin.post('/barberly/token', async (c) => {
  const token = `tafb_${randomToken(24)}`;
  await setSetting(c.env, SETTINGS, { tokenHash: await sha256(token), createdAt: iso(new Date()) } satisfies ImportSettings);
  return c.json({ token });
});

barberlyAdmin.delete('/barberly/token', async (c) => {
  await setSetting(c.env, SETTINGS, { tokenHash: null, createdAt: null } satisfies ImportSettings);
  return c.json({ ok: true });
});

// E-mail lipit de mână în panou (textul copiat din e-mail, cu subiectul pe primul rând sau separat).
barberlyAdmin.post('/barberly/paste', async (c) => {
  const b = await c.req.json<{ subject?: string; text?: string }>();
  const text = (b.text ?? '').slice(0, 20_000);
  if (!text.trim()) throw new HttpError(400, 'invalid_body');
  return c.json(await importMail(c.env, { subject: b.subject ?? linesOf(text)[0] ?? '', text }));
});
