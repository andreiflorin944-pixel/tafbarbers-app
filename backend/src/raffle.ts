// Tombola săptămânală (panou → Marketing → Tombola săptămânii).
// Intră automat, o singură dată pe săptămână (șanse egale), fiecare client care are cont în aplicație și a avut cel puțin
// o programare ÎNCHEIATĂ (închisă în panou / aplicația echipei) între luni 00:00 și duminică 23:59, ora salonului.
// Extragerea o face serverul (număr la întâmplare criptografic), roata din panou doar arată rezultatul.
// Câștigătorul primește premiul ca beneficiu (Bonusurile mele în aplicație); echipa îl vede și îl marchează folosit la tuns.
// Nu se trimite nimic automat clienților (SMS, e-mail, push): câștigătorul vede premiul la următoarea deschidere a aplicației.
import { newId } from './auth';
import { localize, localizeText, ensureTranslated } from './contentI18n';
import { getBusiness, getSetting, setSetting, tryLock, unlock } from './db';
import { HttpError, type Env } from './env';
import { giveBonus } from './referrals';
import { addDays, iso, isDay, localDay, localToUtc, weekdayOf } from './time';

export type RaffleSettings = {
  enabled: boolean;
  prizes: string[]; // ex. Ceară de păr, Fixativ, Șampon
  winnersPerWeek: number; // câte extrageri se pot face pe o săptămână (fiecare câștigător alt client)
  validDays: number; // cât e valabil premiul după extragere
  showWinners: boolean; // câștigătorii (prenume + inițiala) se văd în aplicație și pe pagina tombolei
  rules: string; // regulamentul scris în panou; gol = modelul de mai jos
  rulesUpdatedAt: string | null;
};

export const DEFAULT_RAFFLE: RaffleSettings = {
  enabled: false,
  prizes: ['Ceară de păr', 'Fixativ', 'Șampon'],
  winnersPerWeek: 1,
  validDays: 30,
  showWinners: true,
  rules: '',
  rulesUpdatedAt: null,
};

export const getRaffleSettings = async (env: Env): Promise<RaffleSettings> => ({ ...DEFAULT_RAFFLE, ...(await getSetting(env, 'raffle', DEFAULT_RAFFLE)) });

export async function saveRaffleSettings(env: Env, b: Partial<RaffleSettings>) {
  const cur = await getRaffleSettings(env);
  const prizes = Array.isArray(b.prizes)
    ? [...new Set(b.prizes.map((p) => String(p ?? '').trim().slice(0, 80)).filter(Boolean))].slice(0, 20)
    : cur.prizes;
  if (!prizes.length) throw new HttpError(400, 'raffle_no_prizes');
  const int = (v: unknown, min: number, max: number, def: number) => {
    if (v === undefined || v === null || v === '') return def;
    const n = Math.round(Number(v));
    if (!(n >= min && n <= max)) throw new HttpError(400, 'invalid_value');
    return n;
  };
  const rules = typeof b.rules === 'string' ? b.rules.trim().slice(0, 20000) : cur.rules;
  const next: RaffleSettings = {
    enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled,
    prizes,
    winnersPerWeek: int(b.winnersPerWeek, 1, 10, cur.winnersPerWeek),
    validDays: int(b.validDays, 1, 365, cur.validDays),
    showWinners: typeof b.showWinners === 'boolean' ? b.showWinners : cur.showWinners,
    rules,
    rulesUpdatedAt: rules !== cur.rules ? iso(new Date()) : cur.rulesUpdatedAt,
  };
  await setSetting(env, 'raffle', next);
  // Premiile apar în aplicație și în limba clientului (engleză, franceză, arabă).
  await ensureTranslated(env, prizes.flatMap((p) => [p, prizeTitle(p)])).catch(() => undefined);
  return next;
}

/** Titlul beneficiului primit de câștigător (apare la Bonusurile mele și la încasare). */
export const prizeTitle = (prize: string) => `Premiu tombolă: ${prize}`;

// ——— Săptămâna (luni–duminică, ora salonului) ———

/** Lunea săptămânii în care cade ziua `day` (AAAA-LL-ZZ). */
export const mondayOf = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));

export async function weekRange(env: Env, week: string) {
  const tz = (await getBusiness(env)).timezone || 'Europe/Bucharest';
  return { tz, week, end: addDays(week, 6), from: iso(localToUtc(tz, week, 0)), to: iso(localToUtc(tz, addDays(week, 7), 0)) };
}

export async function currentWeek(env: Env) {
  const tz = (await getBusiness(env)).timezone || 'Europe/Bucharest';
  return mondayOf(localDay(tz, new Date()));
}

/** Săptămâna cerută (orice zi din ea) sau cea de acum; nu una din viitor. */
async function pickWeek(env: Env, raw: unknown) {
  const now = await currentWeek(env);
  if (raw === undefined || raw === null || raw === '') return now;
  if (!isDay(raw)) throw new HttpError(400, 'invalid_day');
  const w = mondayOf(raw);
  if (w > now) throw new HttpError(400, 'raffle_future_week');
  return w;
}

// Cine are cont în aplicație (a semnat termenii sau și-a pus parolă), cont neșters și neblocat.
const HAS_ACCOUNT = `c.deleted_at IS NULL AND c.blocked_at IS NULL AND (c.terms_accepted_at IS NOT NULL OR c.password_hash IS NOT NULL)`;

type Entry = { id: string; name: string; phone: string; visits: number };

/** Participanții săptămânii: clienții cu cont și cel puțin o programare încheiată în săptămână (fără cei care au câștigat deja în ea). */
async function entries(env: Env, from: string, to: string, week: string) {
  const r = await env.DB.prepare(
    `SELECT c.id, c.name, c.phone, count(b.id) AS visits FROM clients c JOIN bookings b ON b.client_id = c.id
     WHERE b.status = 'completed' AND b.starts_at >= ? AND b.starts_at < ? AND ${HAS_ACCOUNT}
       AND NOT EXISTS (SELECT 1 FROM raffle_draws d WHERE d.week = ? AND d.client_id = c.id AND d.status = 'won')
     GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
  )
    .bind(from, to, week)
    .all<Entry>();
  return r.results;
}

/** Prenumele și inițiala numelui de familie: „Andrei P.” (așa apar câștigătorii public). */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Client TAF';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/** Număr întreg la întâmplare în [0, n), uniform (fără „modulo bias”), din generatorul criptografic. */
export function randomIndex(n: number) {
  if (n <= 0) throw new Error('empty');
  const max = Math.floor(0x1_0000_0000 / n) * n;
  const a = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(a);
    if (a[0] < max) return a[0] % n;
  }
}

type DrawRow = { id: string; week: string; client_id: string; prize: string; bonus_id: string | null; entries: number; status: string; drawn_at: string; drawn_by: string | null; name?: string | null; phone?: string | null; bonus_status?: string | null; by_name?: string | null };
const draw = (r: DrawRow) => ({
  id: r.id,
  week: r.week,
  clientId: r.client_id,
  name: r.name ?? '',
  phone: r.phone ?? '',
  prize: r.prize,
  entries: r.entries,
  status: r.status,
  bonusStatus: r.bonus_status ?? null,
  drawnAt: r.drawn_at,
  drawnBy: r.by_name ?? null,
});

const DRAW_SELECT = `SELECT d.*, c.name, c.phone, bn.status AS bonus_status, a.name AS by_name FROM raffle_draws d
  JOIN clients c ON c.id = d.client_id LEFT JOIN bonuses bn ON bn.id = d.bonus_id LEFT JOIN admins a ON a.id = d.drawn_by`;

// ——— Panou ———

/** Pagina din panou: setările, săptămâna aleasă cu participanții, programările încă neînchise și câștigătorii. */
export async function raffleWeek(env: Env, rawWeek: unknown) {
  const s = await getRaffleSettings(env);
  const week = await pickWeek(env, rawWeek);
  const { from, to, end } = await weekRange(env, week);
  const now = iso(new Date());
  const [list, draws, open] = await Promise.all([
    entries(env, from, to, week),
    env.DB.prepare(`${DRAW_SELECT} WHERE d.week = ? ORDER BY d.drawn_at`).bind(week).all<DrawRow>(),
    // Tunsori trecute din săptămână rămase neînchise (din grabă): cât timp nu sunt închise, clientul nu intră în tombolă.
    env.DB.prepare(
      `SELECT b.id, b.starts_at, c.name, c.phone, br.name AS barber, (${HAS_ACCOUNT}) AS has_account
       FROM bookings b JOIN clients c ON c.id = b.client_id LEFT JOIN barbers br ON br.id = b.barber_id
       WHERE b.status = 'confirmed' AND b.starts_at >= ? AND b.starts_at < ? AND b.starts_at < ? ORDER BY b.starts_at LIMIT 200`,
    )
      .bind(from, to, now)
      .all<{ id: string; starts_at: string; name: string; phone: string; barber: string | null; has_account: number }>(),
  ]);
  const won = draws.results.filter((d) => d.status === 'won').length;
  const thisWeek = await currentWeek(env);
  return {
    settings: s,
    week,
    end,
    current: week === thisWeek,
    weeks: Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * i)),
    participants: list.map((p) => ({ id: p.id, name: p.name || p.phone, short: shortName(p.name || 'Client'), visits: p.visits })),
    draws: draws.results.map(draw),
    left: Math.max(0, s.winnersPerWeek - won),
    unclosed: open.results.map((b) => ({ id: b.id, start: b.starts_at, name: b.name || b.phone, barber: b.barber ?? '', hasAccount: !!b.has_account })),
  };
}

/** Extragerea: un câștigător la întâmplare dintre participanți și premiul ales (sau unul la întâmplare din listă). */
export async function drawWinner(env: Env, adminId: string, b: { week?: unknown; prize?: unknown }) {
  const s = await getRaffleSettings(env);
  if (!s.enabled) throw new HttpError(409, 'raffle_off');
  const week = await pickWeek(env, b.week);
  const asked = typeof b.prize === 'string' ? b.prize.trim() : '';
  if (asked && !s.prizes.includes(asked)) throw new HttpError(400, 'raffle_bad_prize');
  if (!(await tryLock(env, 'raffle', 15_000))) throw new HttpError(409, 'raffle_busy');
  try {
    const { from, to } = await weekRange(env, week);
    const won = await env.DB.prepare(`SELECT count(*) AS n FROM raffle_draws WHERE week = ? AND status = 'won'`).bind(week).first<{ n: number }>();
    if ((won?.n ?? 0) >= s.winnersPerWeek) throw new HttpError(409, 'raffle_week_done');
    const list = await entries(env, from, to, week);
    if (!list.length) throw new HttpError(409, 'raffle_no_entries');
    const winner = list[randomIndex(list.length)];
    const prize = asked || s.prizes[randomIndex(s.prizes.length)];
    const bonusId = await giveBonus(env, winner.id, { title: prizeTitle(prize), kind: 'other', value: null, validDays: s.validDays }, 'manual');
    const id = newId('rf');
    await env.DB.prepare(
      `INSERT INTO raffle_draws (id, week, client_id, prize, bonus_id, entries, pool, drawn_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, week, winner.id, prize, bonusId, list.length, JSON.stringify(list.map((p) => p.id)), adminId)
      .run();
    await ensureTranslated(env, [prizeTitle(prize), prize]).catch(() => undefined);
    const row = await env.DB.prepare(`${DRAW_SELECT} WHERE d.id = ?`).bind(id).first<DrawRow>();
    return { draw: draw(row!), participants: list.map((p) => ({ id: p.id, name: p.name || p.phone, short: shortName(p.name || 'Client') })) };
  } finally {
    await unlock(env, 'raffle');
  }
}

/** Anulează o extragere (ex. câștigătorul nu mai vine): premiul nefolosit se anulează, iar locul se poate trage din nou. */
export async function cancelDraw(env: Env, id: string) {
  const d = await env.DB.prepare('SELECT bonus_id, status FROM raffle_draws WHERE id = ?').bind(id).first<{ bonus_id: string | null; status: string }>();
  if (!d) throw new HttpError(404, 'not_found');
  if (d.status !== 'won') return;
  if (d.bonus_id) {
    const bn = await env.DB.prepare('SELECT status FROM bonuses WHERE id = ?').bind(d.bonus_id).first<{ status: string }>();
    if (bn?.status === 'used') throw new HttpError(409, 'raffle_prize_used');
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE raffle_draws SET status = 'cancelled' WHERE id = ?`).bind(id),
    ...(d.bonus_id ? [env.DB.prepare(`UPDATE bonuses SET status = 'cancelled' WHERE id = ? AND status = 'active'`).bind(d.bonus_id)] : []),
  ]);
}

// ——— Aplicație, site ———

/** Ultimii câștigători (prenume + inițială), pentru aplicație și pagina publică. */
async function recentWinners(env: Env, lang: unknown) {
  const r = await env.DB.prepare(
    `SELECT d.week, d.prize, c.name FROM raffle_draws d JOIN clients c ON c.id = d.client_id
     WHERE d.status = 'won' ORDER BY d.week DESC, d.drawn_at DESC LIMIT 6`,
  ).all<{ week: string; prize: string; name: string }>();
  return localize(
    env,
    lang,
    r.results.map((w) => ({ week: w.week, prize: w.prize, name: shortName(w.name || '') })),
    ['prize'],
  );
}

/** Ce vede oricine: dacă e pornită, premiile, săptămâna de acum și (dacă e bifat) ultimii câștigători. */
export async function publicRaffle(env: Env, lang: unknown) {
  const s = await getRaffleSettings(env);
  if (!s.enabled) return { enabled: false as const };
  const week = await currentWeek(env);
  const base = (env.PUBLIC_URL ?? '').replace(/\/$/, '') || 'https://app.tafbarbers.ro';
  return {
    enabled: true as const,
    prizes: await Promise.all(s.prizes.map((p) => localizeText(env, lang, p))),
    winnersPerWeek: s.winnersPerWeek,
    week,
    weekEnd: addDays(week, 6),
    validDays: s.validDays,
    winners: s.showWinners ? await recentWinners(env, lang) : [],
    rulesUrl: `${base}/tombola`,
  };
}

/** Pentru clientul conectat, în plus: dacă e deja în tombola săptămânii și premiile câștigate. */
export async function myRaffle(env: Env, clientId: string, lang: unknown) {
  const pub = await publicRaffle(env, lang);
  const wins = await env.DB.prepare(
    `SELECT d.id, d.week, d.prize, d.drawn_at, bn.status AS bonus_status, bn.expires_at FROM raffle_draws d LEFT JOIN bonuses bn ON bn.id = d.bonus_id
     WHERE d.client_id = ? AND d.status = 'won' ORDER BY d.drawn_at DESC LIMIT 20`,
  )
    .bind(clientId)
    .all<{ id: string; week: string; prize: string; drawn_at: string; bonus_status: string | null; expires_at: string | null }>();
  const now = iso(new Date());
  const myWins = await localize(
    env,
    lang,
    wins.results.map((w) => ({
      id: w.id,
      week: w.week,
      prize: w.prize,
      drawnAt: w.drawn_at,
      // active = îl ridici la următoarea vizită; used = primit; expired = a trecut termenul.
      status: w.bonus_status === 'used' ? 'used' : w.bonus_status === 'active' && (!w.expires_at || w.expires_at > now) ? 'active' : 'expired',
      expiresAt: w.expires_at,
    })),
    ['prize'],
  );
  if (!pub.enabled) return { ...pub, entered: false, visits: 0, wins: myWins };
  const { from, to } = await weekRange(env, pub.week);
  const v = await env.DB.prepare(`SELECT count(*) AS n FROM bookings WHERE client_id = ? AND status = 'completed' AND starts_at >= ? AND starts_at < ?`)
    .bind(clientId, from, to)
    .first<{ n: number }>();
  return { ...pub, entered: (v?.n ?? 0) > 0, visits: v?.n ?? 0, wins: myWins };
}

// ——— Regulamentul ———

const RULES_RO = `REGULAMENTUL TOMBOLEI SĂPTĂMÂNALE „{name}”
Ultima actualizare: {updated}

1. Organizatorul
Tombola este organizată de {company}, cu sediul în {seat}, CUI {cui}, nr. de înregistrare la Registrul Comerțului {regcom} („Organizatorul”), pentru clienții salonului {name}, {address}.

2. Durata
Tombola are loc în fiecare săptămână, de luni (ora 00:00) până duminică (ora 23:59), ora României, cât timp este anunțată în aplicația {name}. Organizatorul o poate opri oricând, anunțând acest lucru în aplicație; extragerile pentru săptămânile deja încheiate se fac în continuare.

3. Cine participă
3.1. Participă automat orice persoană fizică cu vârsta de cel puțin 16 ani care are cont în aplicația {name} și care, în săptămâna respectivă, a beneficiat la salon de cel puțin un serviciu, înregistrat ca încheiat în sistemul salonului.
3.2. Participarea este gratuită: nu se plătește nimic în plus față de serviciul ales și nu trebuie făcut nimic în plus. Fiecare participant are o singură șansă pe săptămână, indiferent de numărul sau valoarea serviciilor.
3.3. Nu participă angajații și colaboratorii Organizatorului. Conturile false, duplicate sau blocate nu participă.

4. Premiile
Premiile din fiecare săptămână sunt produse de îngrijire din salon: {prizes}. Se acordă {winners} premiu/premii pe săptămână. Valoarea unui premiu este mai mică de 600 lei. Premiile nu se pot schimba în bani sau în alte produse și nu se pot transfera altei persoane.

5. Extragerea
5.1. Extragerea are loc după încheierea săptămânii (de regulă în următoarele zile), în salon, din panoul de administrare al aplicației. Câștigătorul este ales la întâmplare de sistemul informatic, dintre toți participanții săptămânii, cu șanse egale. Același participant poate câștiga cel mult un premiu pe săptămână.
5.2. Pentru fiecare extragere se păstrează data, numărul de participanți și câștigătorul, ca dovadă.

6. Acordarea premiului
6.1. Câștigătorul vede premiul în aplicație, la „Bonusurile mele”, și îl ridică de la salon la următoarea vizită, în cel mult {days} zile de la extragere. Dacă nu îl ridică în acest termen, premiul se pierde.
6.2. Organizatorul nu trimite mesaje care cer bani, parole sau date de card pentru acordarea premiului.

7. Datele personale
Pentru tombolă folosim datele din contul tău (nume, istoricul programărilor încheiate) doar ca să stabilim participanții și să acordăm premiul, pe baza participării tale la tombolă (art. 6 alin. 1 lit. b GDPR). {publish} Detalii despre datele tale și drepturile tale găsești în Politica de confidențialitate din aplicație.

8. Taxe
Valoarea premiilor este sub pragul de 600 lei, pentru care nu se reține impozit pe venitul din premii (Codul fiscal, art. 110). Dacă vreodată un premiu depășește această valoare, Organizatorul reține și plătește impozitul datorat.

9. Reclamații
Orice reclamație se trimite la {email} sau la salon, în cel mult 30 de zile de la extragere; răspundem în cel mult 30 de zile. Litigiile se rezolvă pe cale amiabilă sau, dacă nu e posibil, de instanțele competente din România.

10. Regulamentul
Acest regulament este disponibil gratuit oricui, în aplicație și la {url}, potrivit OG 99/2000. Participarea la tombolă înseamnă acceptarea lui. Orice schimbare se publică în același loc înainte să se aplice.`;

/** Regulamentul de afișat (cel scris în panou sau modelul), completat cu datele firmei și ale tombolei. */
export async function raffleRules(env: Env, s?: RaffleSettings) {
  const st = s ?? (await getRaffleSettings(env));
  const biz = await getBusiness(env);
  const b = biz as typeof biz & Partial<Record<'legalName' | 'cui' | 'regCom' | 'legalAddress' | 'legalEmail', string>>;
  const todo = (v: string | undefined, what: string) => (v?.trim() ? v.trim() : `[de completat: ${what}]`);
  const base = (env.PUBLIC_URL ?? '').replace(/\/$/, '') || 'https://app.tafbarbers.ro';
  const updated = (st.rulesUpdatedAt ?? '2026-11-21').slice(0, 10).split('-').reverse().join('.');
  const body = (st.rules || RULES_RO)
    .replaceAll('{name}', biz.name)
    .replaceAll('{company}', todo(b.legalName, 'denumirea firmei'))
    .replaceAll('{seat}', todo(b.legalAddress, 'sediul social'))
    .replaceAll('{cui}', todo(b.cui, 'CUI'))
    .replaceAll('{regcom}', todo(b.regCom, 'nr. Registrul Comerțului'))
    .replaceAll('{address}', todo(biz.address, 'adresa salonului'))
    .replaceAll('{email}', todo(b.legalEmail, 'e-mail de contact'))
    .replaceAll('{prizes}', st.prizes.join(', '))
    .replaceAll('{winners}', String(st.winnersPerWeek))
    .replaceAll('{days}', String(st.validDays))
    .replaceAll('{url}', `${base}/tombola`)
    .replaceAll('{updated}', updated)
    .replaceAll(
      '{publish}',
      st.showWinners
        ? 'Câștigătorii sunt afișați în aplicație și pe pagina tombolei doar cu prenumele și inițiala numelui de familie (ex. „Andrei P.”), timp de cel mult 6 săptămâni.'
        : 'Numele câștigătorilor nu se publică.',
    );
  return { title: `Regulamentul tombolei ${biz.name}`, body, isDefault: !st.rules, template: RULES_RO };
}
