import { Hono, type Context, type Next } from 'hono';
import { getBusiness, getSetting, setSetting, tryLock, unlock } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { sendEmail } from './notify';
import { STORE_LINKS } from './stores';
import { iso, localDay, localMinutes } from './time';

/**
 * Anunțul „ne mutăm din Barberly în aplicația TAF”, trimis pe e-mail din platforma noastră, câte puțin pe zi.
 * E un mesaj de serviciu (cum se fac programările de acum încolo), nu o ofertă: merge la toți clienții cu e-mail,
 * nu doar la cei cu acord de marketing, și nu are reduceri. Fără SMS.
 * Planul gratuit Resend: 100 de e-mailuri pe zi și 3.000 pe lună, numărate cu TOATE e-mailurile (coduri de intrare,
 * confirmări). De aceea tranșa zilei se oprește înainte de limita furnizorului și lasă loc pentru celelalte e-mailuri.
 * Fiecare destinatar e trecut în message_log (campaign_id = CAMPAIGN), așa că nimeni nu îl primește de două ori.
 */
export const CAMPAIGN = 'announce-platform';
const PER_RUN = 25; // cât trimite o rulare a cron-ului (la 5 minute); restul tranșei zilei la rulările următoare

export type AnnounceSettings = {
  enabled: boolean;
  dailyLimit: number; // câte anunțuri pe zi
  providerDaily: number; // limita pe zi a furnizorului de e-mail (toate e-mailurile)
  providerMonthly: number; // limita pe lună a furnizorului
  reserve: number; // câte e-mailuri pe zi rămân pentru coduri, confirmări etc.
  hour: number; // de la ce oră (ora salonului) începe tranșa zilei
  skipActive: boolean; // sare peste clienții care au intrat deja în aplicație
};
const DEFAULTS: AnnounceSettings = { enabled: false, dailyLimit: 80, providerDaily: 100, providerMonthly: 3000, reserve: 15, hour: 10, skipActive: true };

export async function getAnnounce(env: Env): Promise<AnnounceSettings> {
  return { ...DEFAULTS, ...(await getSetting<Partial<AnnounceSettings>>(env, 'announce_platform', {})) };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const base = (env: Env) => (env.PUBLIC_URL || 'https://app.tafbarbers.ro').replace(/\/+$/, '');

export const SUBJECT = 'TAF Barbers are aplicație nouă / TAF Barbers has a new app';

/** E-mailul, în română și engleză. `name` = prenumele clientului (poate lipsi). */
export function announceHtml(env: Env, name: string, phone: string, salonPhone = '') {
  const b = base(env);
  const hi = name ? `Salut, ${esc(name)},` : 'Salut,';
  const hiEn = name ? `Hi ${esc(name)},` : 'Hi,';
  const btn = (href: string, label: string, solid: boolean) =>
    `<a href="${href}" style="display:inline-block;margin:6px;padding:12px 20px;${solid ? 'background:#c9a24b;color:#111' : 'border:1px solid #c9a24b;color:#c9a24b'};text-decoration:none;font-weight:bold;border-radius:10px;font-size:15px">${label}</a>`;
  const gold = (s: string) => `<b style="color:#c9a24b">${s}</b>`;
  const p = (s: string, extra = '') => `<p style="margin:0 0 12px${extra}">${s}</p>`;
  const ul = (items: string[], tag = 'ul') => `<${tag} style="margin:0 0 12px;padding-left:22px">${items.map((i) => `<li>${i}</li>`).join('')}</${tag}>`;
  const search = (ro: boolean) =>
    `<div style="margin:0 0 16px;padding:12px 14px;border:1px dashed #c9a24b;border-radius:10px;text-align:center">${
      ro ? 'Caută în <b>App Store</b> sau <b>Google Play</b>:' : 'Search in the <b>App Store</b> or <b>Google Play</b>:'
    }<br><span style="font-size:20px;font-weight:bold;color:#c9a24b">TAF Barbers</span></div>`;
  const phoneNote = phone ? ` (${esc(phone)})` : '';
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TAF Barbers</title></head>
<body style="margin:0;padding:0;background:#0e0e10;font-family:Helvetica,Arial,sans-serif;color:#f2efe8">
<div data-preheader style="display:none;max-height:0;overflow:hidden">Contul tău e deja în aplicația TAF Barbers. Your account is already in the TAF Barbers app.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e10"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#17171a;border:1px solid #c9a24b;border-radius:14px">
<tr><td align="center" style="padding:28px 24px 8px"><div style="font-size:26px;letter-spacing:6px;font-weight:bold;color:#c9a24b">TAF BARBERS</div><div style="font-size:12px;letter-spacing:3px;color:#9a968c;margin-top:4px">IAȘI</div></td></tr>
<tr><td style="padding:16px 28px 4px;font-size:16px;line-height:1.55">
<p style="margin:0 0 14px;font-size:20px;font-weight:bold;color:#fff">Avem aplicația noastră TAF Barbers</p>
${p(hi)}
${p('Îți mulțumim că vii la noi. De acum te poți programa direct în aplicația TAF Barbers, făcută special pentru salonul nostru: vezi orele libere pe loc, te programezi la Florin sau la Andrei, poți muta sau anula singur programarea și primești memento înainte.')}
${p(gold('Cum facem trecerea:'), ';margin-bottom:6px')}
${ul(['Până pe <b>10 ianuarie 2027</b> te poți programa și în Barberly, și în aplicația nouă.', 'Din <b>11 ianuarie 2027</b> programările se fac doar în aplicația TAF Barbers sau pe site.', 'Programările pe care le ai deja rămân valabile.'])}
${p(gold('Contul tău e deja pregătit'), ';margin-bottom:6px')}
${p(`Am mutat lista de clienți din Barberly la noi: numărul tău de telefon${phoneNote}, numele și vizitele tale sunt deja în aplicație. <b>Nu trebuie să faci cont nou.</b> Parola din Barberly nu merge la noi, dar nici nu ai nevoie de ea.`)}
${p(gold('Cum intri în cont (prima dată):'), ';margin-bottom:6px')}
${ul(['Deschide aplicația și apasă <b>„Intră în cont”</b>.', 'Apasă <b>„Nu ai parolă? Intră cu un cod pe e-mail sau prin SMS”</b>.', 'Scrie numărul de telefon pe care îl foloseai în Barberly și apasă <b>„Trimite codul”</b>.', 'Scrie codul primit. Gata, ești în cont.'], 'ol')}
${p('Vrei să intri cu parolă? După ce intri, mergi la <b>Cont → Parola</b> și îți alegi una. Ai uitat-o? Apasă <b>„Am uitat parola”</b> și primești un cod cu care îți pui o parolă nouă.', ';font-size:14px;color:#bdb8ad')}
${search(true)}
</td></tr>
<tr><td align="center" style="padding:0 24px 8px">${btn(STORE_LINKS.appStore, 'iPhone · App Store', true)}${btn(STORE_LINKS.play, 'Android · Google Play', true)}</td></tr>
<tr><td align="center" style="padding:4px 28px 22px;font-size:14px;color:#bdb8ad">Nu știi ce telefon ai? <a href="${b}/descarca" style="color:#c9a24b">${esc(b.replace(/^https?:\/\//, ''))}/descarca</a><br>Fără aplicație: <a href="${b}" style="color:#c9a24b">${esc(b.replace(/^https?:\/\//, ''))}</a></td></tr>
<tr><td style="padding:0 28px"><div style="border-top:1px solid #33322f"></div></td></tr>
<tr><td style="padding:22px 28px 4px;font-size:15px;line-height:1.55;color:#dcd8ce">
<p style="margin:0 0 12px;font-size:18px;font-weight:bold;color:#fff">We have our own TAF Barbers app</p>
${p(`${hiEn} thank you for coming to us. You can now book directly in the TAF Barbers app, made just for our salon: see free times instantly, book with Florin or Andrei, move or cancel your booking yourself, and get a reminder before your visit.`)}
${p('Until <b>10 January 2027</b> you can book both in Barberly and in the new app. From <b>11 January 2027</b> bookings are made only in the TAF Barbers app or on our website. Bookings you already have stay valid.')}
${p(`${gold('Your account is already set up.')} We moved our client list from Barberly: your phone number${phoneNote}, name and visits are already in the app, so you don't need a new account. Your Barberly password doesn't work here, and you don't need it.`)}
${p(gold('How to sign in (first time):'), ';margin-bottom:6px')}
${ul(['Open the app and tap <b>“Sign in”</b>.', 'Tap <b>“No password? Sign in with a code by email or SMS”</b>.', 'Enter the phone number you used in Barberly and tap <b>“Send code”</b>.', 'Enter the code you receive. Done.'], 'ol')}
${search(false)}
</td></tr>
<tr><td align="center" style="padding:0 24px 22px">${btn(STORE_LINKS.appStore, 'App Store', false)}${btn(STORE_LINKS.play, 'Google Play', false)}${btn(`${b}/descarca`, 'Any phone', false)}</td></tr>
<tr><td align="center" style="padding:16px 24px 24px;font-size:12px;line-height:1.6;color:#8a867d;border-top:1px solid #33322f">TAF Barbers · Iași${salonPhone ? ` · ${esc(salonPhone)}` : ''}<br>Primești acest mesaj o singură dată, pentru că ești client TAF Barbers. / You get this message once, because you are a TAF Barbers client.</td></tr>
</table></td></tr></table></body></html>`;
}

/** Telefonul salonului din panou (Setări → Salonul), ca în celelalte e-mailuri. */
const salonPhone = async (env: Env) => ((await getBusiness(env).catch(() => null)) as { phone?: string } | null)?.phone?.trim() ?? '';

const firstName = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0]?.slice(0, 40) ?? '';

/** Clienții care încă trebuie să primească anunțul (cu e-mail, cont activ, fără anunț trimis). */
function pendingSql(s: AnnounceSettings) {
  return `FROM clients c WHERE c.deleted_at IS NULL AND c.blocked_at IS NULL AND c.email IS NOT NULL AND c.email LIKE '%_@_%._%'
    ${s.skipActive ? 'AND c.last_active_at IS NULL' : ''}
    AND NOT EXISTS (SELECT 1 FROM message_log m WHERE m.campaign_id = '${CAMPAIGN}' AND m.recipient = lower(c.email) AND m.status = 'sent')
    AND (SELECT count(*) FROM message_log m WHERE m.campaign_id = '${CAMPAIGN}' AND m.recipient = lower(c.email) AND m.status = 'failed') < 2`;
}

/** Câte e-mailuri au plecat azi / luna asta (toate tipurile; zilele furnizorului sunt în UTC) și câte anunțuri azi. */
async function counts(env: Env, now: Date) {
  const day = `${iso(now).slice(0, 10)}T00:00:00Z`;
  const month = `${iso(now).slice(0, 7)}-01T00:00:00Z`;
  const r = await env.DB.prepare(
    `SELECT
       sum(CASE WHEN created_at >= ?1 THEN 1 ELSE 0 END) AS today,
       count(*) AS month,
       sum(CASE WHEN created_at >= ?1 AND campaign_id = '${CAMPAIGN}' THEN 1 ELSE 0 END) AS announceToday
     FROM message_log WHERE channel = 'email' AND status = 'sent' AND created_at >= ?2`,
  )
    .bind(day, month)
    .first<{ today: number | null; month: number | null; announceToday: number | null }>();
  return { today: r?.today ?? 0, month: r?.month ?? 0, announceToday: r?.announceToday ?? 0 };
}

/** Câte anunțuri mai pot pleca acum, fără să treacă de limita zilei, de a furnizorului sau de a lunii. */
function room(s: AnnounceSettings, c: Awaited<ReturnType<typeof counts>>) {
  return Math.max(0, Math.min(s.dailyLimit - c.announceToday, s.providerDaily - s.reserve - c.today, s.providerMonthly - s.reserve * 3 - c.month));
}

/** Din cron: tranșa zilei, câte PER_RUN la o rulare, doar după ora aleasă și până la 20:00. */
export async function runAnnounce(env: Env, now = new Date(), opts: { force?: boolean } = {}) {
  const s = await getAnnounce(env);
  if (!s.enabled) return { sent: 0, reason: 'off' as const };
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  const mins = localMinutes(tz, now);
  if (!opts.force && (mins < s.hour * 60 || mins >= 20 * 60)) return { sent: 0, reason: 'hour' as const };
  if (!(await tryLock(env, 'announce-platform', 4 * 60_000))) return { sent: 0, reason: 'busy' as const };
  try {
    const n = Math.min(PER_RUN, room(s, await counts(env, now)));
    if (!n) return { sent: 0, reason: 'limit' as const };
    const rows = await env.DB.prepare(`SELECT lower(c.email) AS email, max(c.name) AS name, max(c.phone) AS phone ${pendingSql(s)} GROUP BY lower(c.email) ORDER BY max(coalesce(c.hist_last_visit, '')) DESC LIMIT ?`)
      .bind(n)
      .all<{ email: string; name: string; phone: string }>();
    let sent = 0;
    const sp = await salonPhone(env);
    for (const r of rows.results) {
      if (await sendEmail(env, { kind: 'announce', recipient: r.email, campaignId: CAMPAIGN }, SUBJECT, announceHtml(env, firstName(r.name), r.phone, sp))) sent++;
      else break; // furnizorul refuză (de ex. limita lui): reîncearcă la rularea următoare, nu arde lista
    }
    // Lista s-a terminat: se oprește singur.
    if (!rows.results.length) await setSetting(env, 'announce_platform', { ...s, enabled: false, finishedAt: iso(now) });
    return { sent, reason: rows.results.length ? ('ok' as const) : ('done' as const) };
  } finally {
    await unlock(env, 'announce-platform');
  }
}

async function view(env: Env) {
  const s = await getAnnounce(env);
  const now = new Date();
  const c = await counts(env, now);
  const pending = await env.DB.prepare(`SELECT count(DISTINCT lower(c.email)) AS n ${pendingSql(s)}`).first<{ n: number }>();
  const done = await env.DB.prepare(`SELECT status, count(DISTINCT recipient) AS n FROM message_log WHERE campaign_id = ? GROUP BY status`).bind(CAMPAIGN).all<{ status: string; n: number }>();
  const by = Object.fromEntries(done.results.map((x) => [x.status, x.n]));
  const left = pending?.n ?? 0;
  const perDay = Math.max(1, Math.min(s.dailyLimit, s.providerDaily - s.reserve));
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  return {
    settings: s,
    sent: by.sent ?? 0,
    failed: by.failed ?? 0,
    pending: left,
    today: { announce: c.announceToday, allEmails: c.today, monthEmails: c.month, room: room(s, c) },
    daysLeft: Math.ceil(left / perDay),
    localDay: localDay(tz, now),
    emailConfigured: !!env.EMAIL_API_KEY,
  };
}

async function ownerOnly(c: Context<AppEnv>, next: Next) {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
}

export const announceAdmin = new Hono<AppEnv>();
announceAdmin.use('/announce', ownerOnly);
announceAdmin.use('/announce/*', ownerOnly);

announceAdmin.get('/announce', async (c) => c.json(await view(c.env)));

announceAdmin.put('/announce', async (c) => {
  const b = await c.req.json<Partial<Record<keyof AnnounceSettings, unknown>>>();
  const s = await getAnnounce(c.env);
  const int = (v: unknown, min: number, max: number, d: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const next: AnnounceSettings = {
    enabled: typeof b.enabled === 'boolean' ? b.enabled : s.enabled,
    dailyLimit: b.dailyLimit === undefined ? s.dailyLimit : int(b.dailyLimit, 1, 5000, s.dailyLimit),
    providerDaily: b.providerDaily === undefined ? s.providerDaily : int(b.providerDaily, 10, 100000, s.providerDaily),
    providerMonthly: b.providerMonthly === undefined ? s.providerMonthly : int(b.providerMonthly, 100, 10000000, s.providerMonthly),
    reserve: b.reserve === undefined ? s.reserve : int(b.reserve, 0, 1000, s.reserve),
    hour: b.hour === undefined ? s.hour : int(b.hour, 6, 19, s.hour),
    skipActive: typeof b.skipActive === 'boolean' ? b.skipActive : s.skipActive,
  };
  await setSetting(c.env, 'announce_platform', next);
  return c.json(await view(c.env));
});

/** Previzualizare în panou (HTML-ul exact, cu un nume de exemplu). */
announceAdmin.get('/announce/preview', async (c) => c.html(announceHtml(c.env, 'Andrei', '+40712345678', await salonPhone(c.env))));

/** Un e-mail de probă la adresa dată; nu intră în socoteala anunțului. */
announceAdmin.post('/announce/test', async (c) => {
  const { email } = await c.req.json<{ email?: unknown }>();
  const to = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpError(400, 'invalid_email');
  const ok = await sendEmail(c.env, { kind: 'announce_test', recipient: to, campaignId: 'announce-test' }, SUBJECT, announceHtml(c.env, 'Florin', '+40712345678', await salonPhone(c.env)));
  return c.json({ ok });
});

/** „Trimite acum tranșa”: ce ar trimite cron-ul, fără să aștepte ora (tot în limitele zilei). */
announceAdmin.post('/announce/run', async (c) => {
  const r = await runAnnounce(c.env, new Date(), { force: true });
  return c.json({ ...(await view(c.env)), justSent: r.sent, reason: r.reason });
});
