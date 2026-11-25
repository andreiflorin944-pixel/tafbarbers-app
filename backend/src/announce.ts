import { Hono, type Context, type Next } from 'hono';
import { getBusiness, getSetting, setSetting, tryLock, unlock } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { sendEmail } from './notify';
import { STORE_LINKS } from './stores';
import { iso, localDay, localMinutes } from './time';

/**
 * E-mailurile despre trecerea din Barberly în aplicația TAF, trimise din platforma noastră, câte puțin pe zi:
 * anunțul mare (pornit din panou) și mementourile programate (1 decembrie, 9 decembrie, 7 ianuarie).
 * Sunt mesaje de serviciu (cum se fac programările de acum încolo), nu oferte: merg la toți clienții cu e-mail,
 * nu doar la cei cu acord de marketing, și nu au reduceri. Fără SMS.
 * Limitele furnizorului (Resend) se numără cu TOATE e-mailurile (coduri de intrare, confirmări), așa că tranșa zilei
 * se oprește înainte de ele și lasă loc pentru celelalte e-mailuri.
 * Fiecare destinatar e trecut în message_log (campaign_id = id-ul valului), așa că nimeni nu primește un val de două ori.
 */
export const CAMPAIGN = 'announce-platform';
const PER_RUN = 25; // cât trimite o rulare a cron-ului (la 5 minute); restul la rulările următoare

type WaveId = 'announce-dec1' | 'announce-dec9' | 'announce-dec24' | 'announce-dec31' | 'announce-jan7';
/** Mementourile programate: pleacă singure din ziua lor (ora salonului), dacă sunt bifate în panou. */
export const WAVES: Array<{ id: WaveId; day: string; label: string }> = [
  { id: 'announce-dec1', day: '2026-12-01', label: '1 decembrie: La mulți ani, România! + memento aplicație' },
  { id: 'announce-dec9', day: '2026-12-09', label: '9 decembrie: încă o lună cu Barberly' },
  { id: 'announce-dec24', day: '2026-12-24', label: '24 decembrie: Crăciun fericit! (cu animație) + memento aplicație' },
  { id: 'announce-dec31', day: '2026-12-31', label: '31 decembrie: La mulți ani 2027! (cu animație) + memento aplicație' },
  { id: 'announce-jan7', day: '2027-01-07', label: '7 ianuarie: ultimul memento (de luni, doar în aplicație)' },
];
type AnyWave = typeof CAMPAIGN | WaveId;

export type AnnounceSettings = {
  enabled: boolean; // anunțul mare
  dailyLimit: number; // câte e-mailuri de anunț pe zi (toate valurile la un loc)
  providerDaily: number; // limita pe zi a furnizorului de e-mail (toate e-mailurile)
  providerMonthly: number; // limita pe lună a furnizorului
  reserve: number; // câte e-mailuri pe zi rămân pentru coduri, confirmări etc.
  hour: number; // de la ce oră (ora salonului) încep trimiterile zilei
  skipActive: boolean; // sare peste clienții care au intrat deja în aplicație
  waves: Partial<Record<WaveId, boolean>>; // mementourile programate pornite
  wavesDone: Partial<Record<WaveId, string>>;
};
const DEFAULTS: AnnounceSettings = {
  enabled: false,
  dailyLimit: 80,
  providerDaily: 100,
  providerMonthly: 3000,
  reserve: 15,
  hour: 10,
  skipActive: true,
  waves: { 'announce-dec1': true, 'announce-dec9': true, 'announce-dec24': true, 'announce-dec31': true, 'announce-jan7': true },
  wavesDone: {},
};

export async function getAnnounce(env: Env): Promise<AnnounceSettings> {
  const s = await getSetting<Partial<AnnounceSettings>>(env, 'announce_platform', {});
  return { ...DEFAULTS, ...s, waves: { ...DEFAULTS.waves, ...(s.waves ?? {}) }, wavesDone: { ...(s.wavesDone ?? {}) } };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const base = (env: Env) => (env.PUBLIC_URL || 'https://app.tafbarbers.ro').replace(/\/+$/, '');

// Bucățile e-mailului (stil întunecat, ca celelalte e-mailuri TAF).
const btn = (href: string, label: string, solid: boolean) =>
  `<a href="${href}" style="display:inline-block;margin:6px;padding:12px 20px;${solid ? 'background:#c9a24b;color:#111' : 'border:1px solid #c9a24b;color:#c9a24b'};text-decoration:none;font-weight:bold;border-radius:10px;font-size:15px">${label}</a>`;
const gold = (s: string) => `<b style="color:#c9a24b">${s}</b>`;
const p = (s: string, extra = '') => `<p style="margin:0 0 12px${extra}">${s}</p>`;
const ul = (items: string[], tag = 'ul') => `<${tag} style="margin:0 0 12px;padding-left:22px">${items.map((i) => `<li>${i}</li>`).join('')}</${tag}>`;
const search = (ro: boolean) =>
  `<div style="margin:0 0 16px;padding:12px 14px;border:1px dashed #c9a24b;border-radius:10px;text-align:center">${
    ro ? 'Caută în <b>App Store</b> sau <b>Google Play</b>:' : 'Search in the <b>App Store</b> or <b>Google Play</b>:'
  }<br><span style="font-size:20px;font-weight:bold;color:#c9a24b">TAF Barbers</span></div>`;
const box = (s: string) => `<b style="color:#fff">${esc(s)}</b>`;
const title = (s: string, en = false) => `<p style="margin:0 0 ${en ? 12 : 14}px;font-size:${en ? 18 : 20}px;font-weight:bold;color:#fff">${s}</p>`;

type Who = { name: string; phone: string; email: string; salonPhone: string };

/** Pașii de intrare: e-mailul mai întâi (codul vine pe e-mail), SMS-ul dacă nu are acces la e-mail. */
function loginRo(w: Who, short = false) {
  const em = w.email ? ` ${box(w.email)}` : '';
  const ph = w.phone ? ` ${box(w.phone)}` : '';
  return `${p(gold(short ? 'Cum intri:' : 'Cum intri în cont (prima dată):'), ';margin-bottom:6px')}
${ul(['Deschide aplicația și apasă <b>„Intră în cont”</b>.', 'Apasă <b>„Nu ai parolă? Intră cu un cod pe e-mail sau prin SMS”</b>.', `Scrie e-mailul${em} și numărul de telefon${ph}, apoi apasă <b>„Trimite codul”</b>. Codul vine pe e-mail.`, 'Scrie codul primit. Gata, ești în cont.'], 'ol')}
${p('<b>Nu ai acces la e-mail sau nu-ți vine codul?</b> Pe același ecran apasă <b>„Trimite codul prin SMS”</b> și îl primești pe telefon.', ';font-size:15px')}`;
}
function loginEn(w: Who, short = false) {
  const em = w.email ? ` ${box(w.email)}` : '';
  const ph = w.phone ? ` ${box(w.phone)}` : '';
  return `${p(gold(short ? 'How to sign in:' : 'How to sign in (first time):'), ';margin-bottom:6px')}
${ul(['Open the app and tap <b>“Sign in”</b>.', 'Tap <b>“No password? Sign in with a code by email or SMS”</b>.', `Enter your e-mail${em} and phone number${ph}, then tap <b>“Send code”</b>. The code comes by e-mail.`, 'Enter the code you receive. Done.'], 'ol')}
${p('<b>No access to your e-mail, or no code?</b> On the same screen tap <b>“Send code by SMS”</b> and you get it on your phone.', ';font-size:14px')}`;
}

/** Cadrul comun: antet, partea în română, butoanele de descărcare, partea în engleză, subsol. */
function frame(env: Env, o: { preheader: string; ro: string; en: string; salonPhone: string; footer: string; banner?: { file: string; alt: string } }) {
  const b = base(env);
  const host = esc(b.replace(/^https?:\/\//, ''));
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TAF Barbers</title></head>
<body style="margin:0;padding:0;background:#0e0e10;font-family:Helvetica,Arial,sans-serif;color:#f2efe8">
<div data-preheader style="display:none;max-height:0;overflow:hidden">${o.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e10"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#17171a;border:1px solid #c9a24b;border-radius:14px">
<tr><td align="center" style="padding:28px 24px 8px"><div style="font-size:26px;letter-spacing:6px;font-weight:bold;color:#c9a24b">TAF BARBERS</div><div style="font-size:12px;letter-spacing:3px;color:#9a968c;margin-top:4px">IAȘI</div></td></tr>
${o.banner ? `<tr><td style="padding:12px 0 0"><img src="${b}/${o.banner.file}" width="560" alt="${esc(o.banner.alt)}" style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>` : ''}
<tr><td style="padding:16px 28px 4px;font-size:16px;line-height:1.55">
${o.ro}
${search(true)}
</td></tr>
<tr><td align="center" style="padding:0 24px 8px">${btn(STORE_LINKS.appStore, 'iPhone · App Store', true)}${btn(STORE_LINKS.play, 'Android · Google Play', true)}</td></tr>
<tr><td align="center" style="padding:4px 28px 22px;font-size:14px;color:#bdb8ad">Nu știi ce telefon ai? <a href="${b}/descarca" style="color:#c9a24b">${host}/descarca</a><br>Fără aplicație: <a href="${b}" style="color:#c9a24b">${host}</a></td></tr>
<tr><td style="padding:0 28px"><div style="border-top:1px solid #33322f"></div></td></tr>
<tr><td style="padding:22px 28px 4px;font-size:15px;line-height:1.55;color:#dcd8ce">
${o.en}
${search(false)}
</td></tr>
<tr><td align="center" style="padding:0 24px 22px">${btn(STORE_LINKS.appStore, 'App Store', false)}${btn(STORE_LINKS.play, 'Google Play', false)}${btn(`${b}/descarca`, 'Any phone', false)}</td></tr>
<tr><td align="center" style="padding:16px 24px 24px;font-size:12px;line-height:1.6;color:#8a867d;border-top:1px solid #33322f">TAF Barbers · Iași${o.salonPhone ? ` · ${esc(o.salonPhone)}` : ''}<br>${o.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const SUBJECTS: Record<AnyWave, string> = {
  [CAMPAIGN]: 'TAF Barbers are aplicație nouă / TAF Barbers has a new app',
  'announce-dec1': 'La mulți ani, România! 🇷🇴 / Happy National Day, Romania!',
  'announce-dec9': 'Încă o lună până trecem în aplicația TAF / One more month until we move to the TAF app',
  'announce-dec24': 'Crăciun fericit de la TAF Barbers! 🎄 / Merry Christmas!',
  'announce-dec31': 'La mulți ani 2027! 🥂 / Happy New Year from TAF Barbers',
  'announce-jan7': 'De luni, 11 ianuarie, te programezi doar în aplicația TAF / From Monday 11 January, book only in the TAF app',
};
export const SUBJECT = SUBJECTS[CAMPAIGN];

/** E-mailul unui val, în română și engleză, cu datele clientului (prenume, telefon, e-mail). */
export function waveHtml(env: Env, wave: AnyWave, w: Who) {
  const hi = w.name ? `Salut, ${esc(w.name)},` : 'Salut,';
  const hiEn = w.name ? `Hi ${esc(w.name)},` : 'Hi,';
  const em = w.email ? ` (${box(w.email)})` : '';
  const ph = w.phone ? ` (${box(w.phone)})` : '';
  const ready = p(`Contul tău e deja în aplicație, cu e-mailul${em} și numărul de telefon${ph}. <b>Nu trebuie să faci cont nou.</b>`);
  const readyEn = p(`Your account is already in the app, with your e-mail${em} and phone number${ph}. <b>No need to create a new one.</b>`);
  const footer = 'Primești acest mesaj pentru că ești client TAF Barbers. / You get this message because you are a TAF Barbers client.';
  if (wave === 'announce-dec1')
    return frame(env, {
      preheader: 'La mulți ani, România! Contul tău e deja în aplicația TAF Barbers.',
      salonPhone: w.salonPhone,
      footer,
      ro: `${title('La mulți ani, România! 🇷🇴')}
${p(hi)}
${p('De Ziua Națională, echipa TAF Barbers îți urează sănătate, bucurie și un an cât mai frumos.')}
${p('Îți amintim că acum te poți programa în aplicația noastră, TAF Barbers. Din <b>11 ianuarie 2027</b> programările se fac doar acolo sau pe site.')}
${ready}
${loginRo(w, true)}
${p('Florin și Andrei')}`,
      en: `${title('Happy National Day, Romania!', true)}
${p(`${hiEn} the TAF Barbers team wishes you health, joy and a great year ahead.`)}
${p('A reminder that you can now book in our TAF Barbers app. From <b>11 January 2027</b> bookings are made only there or on our website.')}
${readyEn}
${loginEn(w, true)}
${p('Florin and Andrei')}`,
    });
  if (wave === 'announce-dec9')
    return frame(env, {
      preheader: 'Din 11 ianuarie te programezi doar în aplicația TAF Barbers.',
      salonPhone: w.salonPhone,
      footer,
      ro: `${title('Încă o lună până trecem în aplicație')}
${p(hi)}
${p('Îți amintim că din <b>11 ianuarie 2027</b> programările la TAF Barbers se fac doar în aplicația noastră sau pe site. Până atunci te poți programa și în Barberly.')}
${ready}
${loginRo(w, true)}`,
      en: `${title('One more month until we move to the app', true)}
${p(`${hiEn} a reminder that from <b>11 January 2027</b> bookings at TAF Barbers are made only in our app or on our website. Until then you can still book in Barberly.`)}
${readyEn}
${loginEn(w, true)}`,
    });
  if (wave === 'announce-dec24')
    return frame(env, {
      preheader: 'Crăciun fericit! Echipa TAF Barbers îți mulțumește pentru anul acesta.',
      banner: { file: 'email-craciun.gif', alt: 'Crăciun fericit! / Merry Christmas!' },
      salonPhone: w.salonPhone,
      footer,
      ro: `${title('Crăciun fericit! 🎄')}
${p(hi)}
${p('Îți mulțumim că ai fost alături de noi anul acesta. Îți dorim un Crăciun liniștit, cu cei dragi, sănătate și multă bucurie.')}
${p('Un mic memento: din <b>11 ianuarie 2027</b> programările la TAF Barbers se fac doar în aplicația noastră sau pe site.')}
${ready}
${loginRo(w, true)}
${p('Cu drag, Florin și Andrei')}`,
      en: `${title('Merry Christmas!', true)}
${p(`${hiEn} thank you for being with us this year. We wish you a peaceful Christmas with your loved ones, good health and lots of joy.`)}
${p('A small reminder: from <b>11 January 2027</b> bookings at TAF Barbers are made only in our app or on our website.')}
${readyEn}
${loginEn(w, true)}
${p('Warm wishes, Florin and Andrei')}`,
    });
  if (wave === 'announce-dec31')
    return frame(env, {
      preheader: 'La mulți ani 2027! Din 11 ianuarie te programezi doar în aplicația TAF Barbers.',
      banner: { file: 'email-revelion.gif', alt: 'La mulți ani 2027! / Happy New Year!' },
      salonPhone: w.salonPhone,
      footer,
      ro: `${title('La mulți ani 2027! 🥂')}
${p(hi)}
${p('Echipa TAF Barbers îți urează un an nou cu sănătate, împliniri și mereu o tunsoare pe gustul tău. Mulțumim că ne-ai fost alături în 2026!')}
${p('În 2027 ne vedem în aplicația TAF Barbers: din <b>11 ianuarie</b> programările se fac doar acolo sau pe site.')}
${ready}
${loginRo(w, true)}
${p('La mulți ani! Florin și Andrei')}`,
      en: `${title('Happy New Year 2027!', true)}
${p(`${hiEn} the TAF Barbers team wishes you a new year full of health, success and always a haircut you love. Thank you for being with us in 2026!`)}
${p('In 2027 we will see you in the TAF Barbers app: from <b>11 January</b> bookings are made only there or on our website.')}
${readyEn}
${loginEn(w, true)}
${p('Happy New Year! Florin and Andrei')}`,
    });
  if (wave === 'announce-jan7')
    return frame(env, {
      preheader: 'De luni, 11 ianuarie, nu mai primim programări prin Barberly.',
      salonPhone: w.salonPhone,
      footer,
      ro: `${title('De luni, 11 ianuarie, te programezi doar în aplicația TAF')}
${p(hi)}
${p('De luni, <b>11 ianuarie 2027</b>, nu mai primim programări prin Barberly. Te așteptăm în aplicația TAF Barbers sau pe site. Programările pe care le ai deja rămân valabile.')}
${ready}
${loginRo(w, true)}
${w.salonPhone ? p(`Ai nevoie de ajutor? Sună-ne la <b>${esc(w.salonPhone)}</b>.`) : ''}`,
      en: `${title('From Monday 11 January, book only in the TAF app', true)}
${p(`${hiEn} from Monday <b>11 January 2027</b> we no longer take bookings through Barberly. Book in the TAF Barbers app or on our website. Bookings you already have stay valid.`)}
${readyEn}
${loginEn(w, true)}
${w.salonPhone ? p(`Need help? Call us at <b>${esc(w.salonPhone)}</b>.`) : ''}`,
    });
  // Anunțul mare.
  return frame(env, {
    preheader: 'Contul tău e deja în aplicația TAF Barbers. Your account is already in the TAF Barbers app.',
    salonPhone: w.salonPhone,
    footer: 'Primești acest mesaj o singură dată, pentru că ești client TAF Barbers. / You get this message once, because you are a TAF Barbers client.',
    ro: `${title('Avem aplicația noastră TAF Barbers')}
${p(hi)}
${p('Îți mulțumim că vii la noi. De acum te poți programa direct în aplicația TAF Barbers, făcută special pentru salonul nostru: vezi orele libere pe loc, te programezi la Florin sau la Andrei, poți muta sau anula singur programarea și primești memento înainte.')}
${p(gold('Cum facem trecerea:'), ';margin-bottom:6px')}
${ul(['Până pe <b>10 ianuarie 2027</b> te poți programa și în Barberly, și în aplicația nouă.', 'Din <b>11 ianuarie 2027</b> programările se fac doar în aplicația TAF Barbers sau pe site.', 'Programările pe care le ai deja rămân valabile.'])}
${p(gold('Contul tău e deja pregătit'), ';margin-bottom:6px')}
${p(`Am mutat lista de clienți din Barberly la noi: e-mailul tău${em}, numărul de telefon${ph}, numele și vizitele tale sunt deja în aplicație. <b>Nu trebuie să faci cont nou.</b> Parola din Barberly nu merge la noi, dar nici nu ai nevoie de ea.`)}
${loginRo(w)}
${p('Vrei să intri cu parolă? După ce intri, mergi la <b>Cont → Parola</b> și îți alegi una. Ai uitat-o? Apasă <b>„Am uitat parola”</b> și primești un cod cu care îți pui o parolă nouă.', ';font-size:14px;color:#bdb8ad')}`,
    en: `${title('We have our own TAF Barbers app', true)}
${p(`${hiEn} thank you for coming to us. You can now book directly in the TAF Barbers app, made just for our salon: see free times instantly, book with Florin or Andrei, move or cancel your booking yourself, and get a reminder before your visit.`)}
${p('Until <b>10 January 2027</b> you can book both in Barberly and in the new app. From <b>11 January 2027</b> bookings are made only in the TAF Barbers app or on our website. Bookings you already have stay valid.')}
${p(`${gold('Your account is already set up.')} We moved our client list from Barberly: your e-mail${em}, phone number${ph}, name and visits are already in the app, so you don't need a new account. Your Barberly password doesn't work here, and you don't need it.`)}
${loginEn(w)}`,
  });
}

/** Anunțul mare (păstrat pentru apelurile vechi). */
export const announceHtml = (env: Env, name: string, phone: string, salonPhone = '', email = '') => waveHtml(env, CAMPAIGN, { name, phone, salonPhone, email });

/** Telefonul salonului din panou (Setări → Salonul), ca în celelalte e-mailuri. */
const salonPhone = async (env: Env) => ((await getBusiness(env).catch(() => null)) as { phone?: string } | null)?.phone?.trim() ?? '';

const firstName = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0]?.slice(0, 40) ?? '';

/** Clienții care încă trebuie să primească un val (cu e-mail, cont activ, fără valul trimis). */
function pendingSql(s: AnnounceSettings, wave: AnyWave) {
  return `FROM clients c WHERE c.deleted_at IS NULL AND c.blocked_at IS NULL AND c.email IS NOT NULL AND c.email LIKE '%_@_%._%'
    ${s.skipActive ? 'AND c.last_active_at IS NULL' : ''}
    AND NOT EXISTS (SELECT 1 FROM message_log m WHERE m.campaign_id = '${wave}' AND m.recipient = lower(c.email) AND m.status = 'sent')
    AND (SELECT count(*) FROM message_log m WHERE m.campaign_id = '${wave}' AND m.recipient = lower(c.email) AND m.status = 'failed') < 2`;
}

/** Câte e-mailuri au plecat azi / luna asta (toate tipurile; zilele furnizorului sunt în UTC) și câte anunțuri azi. */
async function counts(env: Env, now: Date) {
  const day = `${iso(now).slice(0, 10)}T00:00:00Z`;
  const month = `${iso(now).slice(0, 7)}-01T00:00:00Z`;
  const r = await env.DB.prepare(
    `SELECT
       sum(CASE WHEN created_at >= ?1 THEN 1 ELSE 0 END) AS today,
       count(*) AS month,
       sum(CASE WHEN created_at >= ?1 AND campaign_id LIKE 'announce-%' AND campaign_id != 'announce-test' THEN 1 ELSE 0 END) AS announceToday
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

/** Valurile care trebuie să plece acum: anunțul mare (dacă e pornit), apoi mementourile ajunse la ziua lor. */
function dueWaves(s: AnnounceSettings, today: string): AnyWave[] {
  const out: AnyWave[] = [];
  if (s.enabled) out.push(CAMPAIGN);
  for (const w of WAVES) if (s.waves[w.id] && !s.wavesDone[w.id] && today >= w.day) out.push(w.id);
  return out;
}

/** Trimite o bucată dintr-un val; întoarce câte au plecat și dacă valul s-a terminat. */
async function sendWave(env: Env, s: AnnounceSettings, wave: AnyWave, n: number) {
  const rows = await env.DB.prepare(
    `SELECT lower(c.email) AS email, max(c.name) AS name, max(c.phone) AS phone ${pendingSql(s, wave)} GROUP BY lower(c.email) ORDER BY max(coalesce(c.hist_last_visit, '')) DESC LIMIT ?`,
  )
    .bind(n)
    .all<{ email: string; name: string; phone: string }>();
  let sent = 0;
  let refused = false;
  const sp = await salonPhone(env);
  for (const [i, r] of rows.results.entries()) {
    // Pauză între anunțuri: rămâne loc la furnizor (câteva e-mailuri pe secundă) pentru codurile de cont, care au prioritate.
    if (i) await new Promise((res) => setTimeout(res, 700));
    const html = waveHtml(env, wave, { name: firstName(r.name), phone: r.phone, salonPhone: sp, email: r.email });
    if (await sendEmail(env, { kind: 'announce', recipient: r.email, campaignId: wave }, SUBJECTS[wave], html)) sent++;
    else {
      refused = true; // furnizorul refuză (de ex. limita lui): reîncearcă la rularea următoare, nu arde lista
      break;
    }
  }
  return { sent, done: !rows.results.length, refused };
}

/** Din cron: tranșa zilei, câte PER_RUN la o rulare, doar după ora aleasă și până la 20:00. */
export async function runAnnounce(env: Env, now = new Date(), opts: { force?: boolean } = {}) {
  const s = await getAnnounce(env);
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  const due = dueWaves(s, localDay(tz, now));
  if (!due.length) return { sent: 0, reason: 'off' as const };
  const mins = localMinutes(tz, now);
  if (!opts.force && (mins < s.hour * 60 || mins >= 20 * 60)) return { sent: 0, reason: 'hour' as const };
  if (!(await tryLock(env, 'announce-platform', 4 * 60_000))) return { sent: 0, reason: 'busy' as const };
  try {
    let left = Math.min(PER_RUN, room(s, await counts(env, now)));
    if (!left) return { sent: 0, reason: 'limit' as const };
    let sent = 0;
    const next = { ...s, waves: { ...s.waves }, wavesDone: { ...s.wavesDone } };
    let changed = false;
    for (const wave of due) {
      if (!left) break;
      const r = await sendWave(env, s, wave, left);
      sent += r.sent;
      left -= r.sent;
      // Lista valului s-a terminat: se oprește singur.
      if (r.done) {
        changed = true;
        if (wave === CAMPAIGN) Object.assign(next, { enabled: false, finishedAt: iso(now) });
        else next.wavesDone[wave] = iso(now);
      }
      if (r.refused) break;
    }
    if (changed) await setSetting(env, 'announce_platform', next);
    return { sent, reason: sent ? ('ok' as const) : ('done' as const) };
  } finally {
    await unlock(env, 'announce-platform');
  }
}

async function waveStats(env: Env, s: AnnounceSettings, wave: AnyWave) {
  const pending = await env.DB.prepare(`SELECT count(DISTINCT lower(c.email)) AS n ${pendingSql(s, wave)}`).first<{ n: number }>();
  const done = await env.DB.prepare(`SELECT status, count(DISTINCT recipient) AS n FROM message_log WHERE campaign_id = ? GROUP BY status`).bind(wave).all<{ status: string; n: number }>();
  const by = Object.fromEntries(done.results.map((x) => [x.status, x.n]));
  return { sent: by.sent ?? 0, failed: by.failed ?? 0, pending: pending?.n ?? 0 };
}

async function view(env: Env) {
  const s = await getAnnounce(env);
  const now = new Date();
  const c = await counts(env, now);
  const main = await waveStats(env, s, CAMPAIGN);
  const perDay = Math.max(1, Math.min(s.dailyLimit, s.providerDaily - s.reserve));
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  const waves = [];
  for (const w of WAVES) waves.push({ ...w, enabled: !!s.waves[w.id], doneAt: s.wavesDone[w.id] ?? null, ...(await waveStats(env, s, w.id)) });
  return {
    settings: s,
    ...main,
    today: { announce: c.announceToday, allEmails: c.today, monthEmails: c.month, room: room(s, c) },
    daysLeft: Math.ceil(main.pending / perDay),
    waves,
    localDay: localDay(tz, now),
    emailConfigured: !!env.EMAIL_API_KEY,
  };
}

async function ownerOnly(c: Context<AppEnv>, next: Next) {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
}

const waveOf = (v: unknown): AnyWave => (v === CAMPAIGN || WAVES.some((w) => w.id === v) ? (v as AnyWave) : CAMPAIGN);

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
  const waves = { ...s.waves };
  if (b.waves && typeof b.waves === 'object') for (const w of WAVES) if (typeof (b.waves as Record<string, unknown>)[w.id] === 'boolean') waves[w.id] = (b.waves as Record<string, boolean>)[w.id];
  const next: AnnounceSettings = {
    ...s,
    enabled: typeof b.enabled === 'boolean' ? b.enabled : s.enabled,
    dailyLimit: b.dailyLimit === undefined ? s.dailyLimit : int(b.dailyLimit, 1, 5000, s.dailyLimit),
    providerDaily: b.providerDaily === undefined ? s.providerDaily : int(b.providerDaily, 10, 100000, s.providerDaily),
    providerMonthly: b.providerMonthly === undefined ? s.providerMonthly : int(b.providerMonthly, 100, 10000000, s.providerMonthly),
    reserve: b.reserve === undefined ? s.reserve : int(b.reserve, 0, 1000, s.reserve),
    hour: b.hour === undefined ? s.hour : int(b.hour, 6, 19, s.hour),
    skipActive: typeof b.skipActive === 'boolean' ? b.skipActive : s.skipActive,
    waves,
  };
  await setSetting(c.env, 'announce_platform', next);
  return c.json(await view(c.env));
});

/**
 * Urmărirea trecerii: câți clienți și-au activat contul în aplicație (prima intrare = terms_accepted_at),
 * câți dintre cei care au primit e-mailurile s-au activat după, activările pe zile și de unde vin programările noi.
 */
export async function activation(env: Env, now = new Date()) {
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const off = ((((localMinutes(tz, now) - utcMin) % 1440) + 2160) % 1440) - 720; // minute față de UTC (+120 iarna)
  const mod = `${off >= 0 ? '+' : ''}${off} minutes`;
  const since14 = iso(new Date(now.getTime() - 14 * 86400_000));
  const since7 = iso(new Date(now.getTime() - 7 * 86400_000));
  const sentWhere = `m.channel = 'email' AND m.status = 'sent' AND m.campaign_id LIKE 'announce-%' AND m.campaign_id != 'announce-test'`;
  const tot = await env.DB.prepare(
    `SELECT count(*) AS clients,
       sum(CASE WHEN terms_accepted_at IS NOT NULL THEN 1 ELSE 0 END) AS active,
       sum(CASE WHEN terms_accepted_at >= ?1 THEN 1 ELSE 0 END) AS week
     FROM clients WHERE deleted_at IS NULL`,
  )
    .bind(since7)
    .first<{ clients: number; active: number | null; week: number | null }>();
  const mail = await env.DB.prepare(
    `SELECT (SELECT count(DISTINCT m.recipient) FROM message_log m WHERE ${sentWhere}) AS reached,
       (SELECT count(*) FROM clients c WHERE c.deleted_at IS NULL AND c.terms_accepted_at IS NOT NULL AND c.email IS NOT NULL
          AND EXISTS (SELECT 1 FROM message_log m WHERE ${sentWhere} AND m.recipient = lower(c.email) AND m.created_at <= c.terms_accepted_at)) AS after`,
  ).first<{ reached: number; after: number }>();
  const days = await env.DB.prepare(
    `SELECT date(terms_accepted_at, ?1) AS day, count(*) AS n FROM clients WHERE deleted_at IS NULL AND terms_accepted_at >= ?2 GROUP BY day ORDER BY day`,
  )
    .bind(mod, since14)
    .all<{ day: string; n: number }>();
  const byDay = Object.fromEntries(days.results.map((r) => [r.day, r.n]));
  const today = localDay(tz, now);
  const perDay = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 13 + i);
    const day = d.toISOString().slice(0, 10);
    return { day, n: byDay[day] ?? 0 };
  });
  const bk = async (since: string) => {
    const r = await env.DB.prepare(
      `SELECT sum(CASE WHEN barberly_ref IS NULL AND source IN ('app','web') THEN 1 ELSE 0 END) AS ours,
         sum(CASE WHEN barberly_ref IS NOT NULL THEN 1 ELSE 0 END) AS barberly,
         sum(CASE WHEN barberly_ref IS NULL AND source = 'admin' THEN 1 ELSE 0 END) AS panel
       FROM bookings WHERE created_at >= ?`,
    )
      .bind(since)
      .first<{ ours: number | null; barberly: number | null; panel: number | null }>();
    const ours = r?.ours ?? 0;
    const barberly = r?.barberly ?? 0;
    return { ours, barberly, panel: r?.panel ?? 0, oursPct: ours + barberly ? Math.round((100 * ours) / (ours + barberly)) : 0 };
  };
  return {
    clients: tot?.clients ?? 0,
    active: tot?.active ?? 0,
    activeWeek: tot?.week ?? 0,
    reached: mail?.reached ?? 0,
    activatedAfterEmail: mail?.after ?? 0,
    perDay,
    bookings7: await bk(since7),
    bookings14: await bk(since14),
  };
}

announceAdmin.get('/announce/activation', async (c) => c.json(await activation(c.env)));

/** Previzualizare în panou (HTML-ul exact, cu date de exemplu). `?wave=` alege valul. */
announceAdmin.get('/announce/preview', async (c) =>
  c.html(waveHtml(c.env, waveOf(c.req.query('wave')), { name: 'Andrei', phone: '+40712345678', salonPhone: await salonPhone(c.env), email: 'andrei@exemplu.ro' })),
);

/** Un e-mail de probă la adresa dată; nu intră în socoteala anunțului. */
announceAdmin.post('/announce/test', async (c) => {
  const { email, wave } = await c.req.json<{ email?: unknown; wave?: unknown }>();
  const to = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpError(400, 'invalid_email');
  const wv = waveOf(wave);
  // Proba arată datele reale ale clientului cu acest e-mail, dacă există (altfel fără telefon).
  const me = await c.env.DB.prepare('SELECT name, phone FROM clients WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1').bind(to).first<{ name: string; phone: string }>();
  const html = waveHtml(c.env, wv, { name: firstName(me?.name) || 'Florin', phone: me?.phone ?? '', salonPhone: await salonPhone(c.env), email: to });
  const ok = await sendEmail(c.env, { kind: 'announce_test', recipient: to, campaignId: 'announce-test' }, SUBJECTS[wv], html);
  return c.json({ ok });
});

/** „Trimite acum tranșa”: ce ar trimite cron-ul, fără să aștepte ora (tot în limitele zilei). */
announceAdmin.post('/announce/run', async (c) => {
  const r = await runAnnounce(c.env, new Date(), { force: true });
  return c.json({ ...(await view(c.env)), justSent: r.sent, reason: r.reason });
});
