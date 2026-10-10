import { sha256 } from './auth';
import { getSetting, setSetting } from './db';
import type { Env } from './env';
import { iso } from './time';
import { aiCalls, translateEx, type Budget, type TrResult } from './translate';

// Textele scrise în panou (servicii, frizeri, produse, abonamente, despre salon, regulamente, campanii, bonusuri) se scriu
// doar în română. La salvare se traduc singure în engleză și franceză și se păstrează în tabela `translations`, după textul
// românesc. Aplicația cere limba (`?lang=en`) și primește traducerea; unde lipsește, primește româna.
// O corectură făcută de mână în panou rămâne până se schimbă textul în română (atunci textul nou se traduce din nou).

export type Lang = 'ro' | 'en' | 'fr';
export const TR_LANGS = ['en', 'fr'] as const;
export type TrLang = (typeof TR_LANGS)[number];
export const langOf = (l: unknown): Lang => (l === 'en' || l === 'fr' ? l : 'ro');

/** Ce s-a întâmplat la o rulare: traduse acum, care nu se pot traduce automat, câte au rămas (buget terminat sau AI oprit). */
export type TrStats = { translated: number; failed: number; remaining: number; aiDown: boolean };
export const emptyStats = (): TrStats => ({ translated: 0, failed: 0, remaining: 0, aiDown: false });

// Textele lungi (regulamentele) se traduc rând cu rând; fiecare rând tradus rămâne salvat, deci o rulare întreruptă
// (buget terminat) continuă de unde a rămas.
const MAX_SHORT_LINES = 12;
const lines = (s: string) => s.split('\n');
const uniq = (texts: Array<string | null | undefined>) => [...new Set(texts.filter((t): t is string => typeof t === 'string' && t.trim() !== ''))];

async function hashMap(texts: string[]) {
  const m = new Map<string, string>(); // hash → text
  for (const t of texts) m.set(await sha256(t), t);
  return m;
}

/** Rândurile salvate pentru textele date: text → { text, manual }. Cu `withFailed`, și cele care n-au putut fi traduse (text gol). */
async function rows(env: Env, lang: TrLang, texts: string[], withFailed: boolean) {
  const out = new Map<string, { text: string; manual: boolean }>();
  const h = await hashMap(uniq(texts));
  const keys = [...h.keys()];
  for (let i = 0; i < keys.length; i += 90) {
    const part = keys.slice(i, i + 90);
    const r = await env.DB.prepare(
      `SELECT hash, text, manual FROM translations WHERE lang = ? ${withFailed ? '' : "AND text != ''"} AND hash IN (${part.map(() => '?').join(',')})`,
    )
      .bind(lang, ...part)
      .all<{ hash: string; text: string; manual: number }>();
    for (const x of r.results) out.set(h.get(x.hash)!, { text: x.text, manual: !!x.manual });
  }
  return out;
}

/** Traducerile existente într-o limbă: text românesc → traducere. */
export async function lookup(env: Env, lang: TrLang, texts: Array<string | null | undefined>): Promise<Map<string, string>> {
  const r = await rows(env, lang, uniq(texts), false);
  return new Map([...r].map(([k, v]) => [k, v.text]));
}

/** Înlocuiește câmpurile de text ale rândurilor cu traducerea în limba cerută (unde există). */
export async function localize<T extends object>(env: Env, lang: unknown, list: T[], fields: Array<keyof T>): Promise<T[]> {
  const l = langOf(lang);
  if (l === 'ro' || !list.length) return list;
  const m = await lookup(
    env,
    l,
    list.flatMap((r) => fields.map((f) => r[f] as unknown as string)),
  );
  return list.map((r) => {
    const o = { ...r };
    for (const f of fields) {
      const v = r[f];
      if (typeof v === 'string' && m.has(v)) (o as Record<keyof T, unknown>)[f] = m.get(v);
    }
    return o;
  });
}

/** Un singur text, tradus dacă se poate. */
export async function localizeText(env: Env, lang: unknown, text: string): Promise<string> {
  const l = langOf(lang);
  if (l === 'ro' || !text.trim()) return text;
  return (await lookup(env, l, [text])).get(text) ?? text;
}

export type TrMap = Record<TrLang, Record<string, string>>;

/** Pentru panou: fiecare rând primește `translations` = { en: { câmp: text }, fr: {…} } (gol = netradus încă). */
export async function withTranslations<T extends object>(env: Env, list: T[], fields: Array<keyof T & string>): Promise<Array<T & { translations: TrMap }>> {
  const texts = list.flatMap((r) => fields.map((f) => r[f] as unknown as string));
  const [en, fr] = await Promise.all([lookup(env, 'en', texts), lookup(env, 'fr', texts)]);
  return list.map((r) => {
    const tr: TrMap = { en: {}, fr: {} };
    for (const f of fields) {
      const v = r[f] as unknown;
      tr.en[f] = typeof v === 'string' ? (en.get(v) ?? '') : '';
      tr.fr[f] = typeof v === 'string' ? (fr.get(v) ?? '') : '';
    }
    return { ...r, translations: tr };
  });
}

async function store(env: Env, lang: TrLang, ro: string, text: string, manual: boolean) {
  // O corectură de mână nu e înlocuită de o traducere automată (doar de altă corectură).
  await env.DB.prepare(
    `INSERT INTO translations (lang, hash, ro, text, manual, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(lang, hash) DO UPDATE SET text = excluded.text, manual = excluded.manual, updated_at = excluded.updated_at
     WHERE excluded.manual = 1 OR translations.manual = 0`,
  )
    .bind(lang, await sha256(ro), ro, text, manual ? 1 : 0, iso(new Date()))
    .run();
}

async function forget(env: Env, lang: TrLang, ro: string) {
  await env.DB.prepare('DELETE FROM translations WHERE lang = ? AND hash = ?').bind(lang, await sha256(ro)).run();
}

/** Corecturile venite din panou: { en: { câmp: text }, fr: {…} }. */
export type ManualTr = Partial<Record<TrLang, Record<string, unknown>>>;

/**
 * La salvarea unui rând din panou. `fields` = câmp → textul românesc nou (`ro`) și cel de dinainte (`prev`).
 * Panoul trimite înapoi engleza și franceza pe care le-a arătat: dacă omul le-a schimbat, sunt corecturi de mână;
 * un câmp golit înseamnă „tradu din nou automat”. Apoi se traduc textele românești care nu au încă traducere.
 */
export async function saveTranslations(env: Env, fields: Record<string, { ro: string | null | undefined; prev?: string | null }>, manual?: ManualTr | null) {
  for (const l of TR_LANGS) {
    const sent = manual?.[l];
    if (!sent || typeof sent !== 'object') continue;
    for (const [f, { ro, prev }] of Object.entries(fields)) {
      const v = sent[f];
      if (typeof v !== 'string' || !ro?.trim()) continue;
      const before = prev ?? ro;
      const shown = (await lookup(env, l, [before])).get(before) ?? '';
      if (!v.trim()) await forget(env, l, ro);
      else if (v.trim() !== shown.trim()) await store(env, l, ro, v.trim().slice(0, 50_000), true);
    }
  }
  return ensureTranslated(env, Object.values(fields).map((x) => x.ro));
}

/** Traducerea a rămas neterminată (AI oprit sau buget terminat): cron-ul o reia (vezi translateAll.ts). */
export async function markPending(env: Env) {
  await setSetting(env, 'i18n_backfill', { done: false });
}

/**
 * Traduce textele românești care nu au încă traducere (nici una reușită, nici una încercată fără succes).
 * Se oprește la primul semn că AI-ul nu merge (nu marchează nimic ca netraductibil din cauza asta).
 */
export async function ensureTranslated(
  env: Env,
  texts: Array<string | null | undefined>,
  opts: { budget?: Budget; stats?: TrStats; dry?: boolean } = {},
): Promise<TrStats> {
  const budget = opts.budget ?? { left: 60 };
  const st = opts.stats ?? emptyStats();
  const list = uniq(texts);
  if (!list.length) return st;
  for (const l of TR_LANGS) {
    const have = await rows(env, l, list, true);
    for (const ro of list) {
      if (have.has(ro)) continue;
      if (opts.dry || st.aiDown || budget.left <= 0) {
        st.remaining++;
        continue;
      }
      let r: TrResult | { fail: 'later' } = lines(ro).length > MAX_SHORT_LINES ? await translateLong(env, l, ro, budget) : await translateEx(env, ro, l, budget);
      // Un text scurt fără răspuns: AI-ul e oprit sau doar textul ăsta nu merge (vezi textFault).
      if ('fail' in r && r.fail === 'ai' && lines(ro).length <= MAX_SHORT_LINES) r = await textFault(env, l, ro, budget);
      if ('text' in r) {
        await store(env, l, ro, r.text, false);
        st.translated++;
      } else if (r.fail === 'text') {
        // Nu se poate traduce bine (ex. s-a pierdut o variabilă): rămâne în română și nu se mai încearcă singur.
        await store(env, l, ro, '', false);
        st.failed++;
      } else {
        if (r.fail === 'ai') st.aiDown = true;
        st.remaining++;
      }
    }
  }
  if (!opts.dry && (st.remaining || st.aiDown)) await markPending(env);
  return st;
}

/** Text lung (regulament): rând cu rând, cu rândurile deja traduse refolosite; rândul netraductibil rămâne în română. */
async function translateLong(env: Env, lang: TrLang, ro: string, budget: Budget): Promise<{ text: string } | { fail: 'ai' | 'budget' | 'later' }> {
  const ls = lines(ro);
  const have = await rows(env, lang, ls, true);
  let later = false;
  for (const line of uniq(ls)) {
    if (have.has(line)) continue;
    if (budget.left < aiCalls(line)) return { fail: 'budget' };
    let r: TrResult | { fail: 'later' } = await translateEx(env, line, lang, budget);
    if ('fail' in r && r.fail === 'ai') r = await textFault(env, lang, line, budget);
    if ('text' in r) {
      await store(env, lang, line, r.text, false);
      have.set(line, { text: r.text, manual: false });
    } else if (r.fail === 'text') {
      await store(env, lang, line, '', false);
      have.set(line, { text: '', manual: false });
    } else if (r.fail === 'later') later = true;
    else return { fail: r.fail };
  }
  // Un rând care n-a mers acum (dar AI-ul merge): restul rândurilor rămân salvate, textul se încheie la o rulare următoare.
  if (later) return { fail: 'later' };
  return { text: ls.map((line) => (line.trim() ? have.get(line)?.text || line : line)).join('\n') };
}

/** De câte ori poate da greș un text (cu AI-ul mergând) până rămâne în română și nu se mai încearcă singur. */
const MAX_TEXT_FAILS = 3;
const PROBE = 'Bună ziua';

/**
 * Un text n-a primit traducere: e AI-ul oprit sau doar textul ăsta (pe care modelul îl refuză mereu)?
 * Se încearcă un text scurt de probă. Dacă proba merge, vina e a textului: se numără încercarea, iar după
 * MAX_TEXT_FAILS rulări textul rămâne în română ('text'), ca restul traducerilor să nu stea după el la nesfârșit.
 */
async function textFault(env: Env, lang: TrLang, ro: string, budget: Budget): Promise<{ fail: 'ai' | 'text' | 'budget' | 'later' }> {
  const probe = await translateEx(env, PROBE, lang, budget);
  if (!('text' in probe)) return { fail: probe.fail === 'budget' ? 'budget' : 'ai' };
  const key = `${lang}:${await sha256(ro)}`;
  const fails = await getSetting<Record<string, number>>(env, 'i18n_fails', {});
  fails[key] = (fails[key] ?? 0) + 1;
  if (fails[key] >= MAX_TEXT_FAILS) delete fails[key];
  await setSetting(env, 'i18n_fails', fails);
  console.log('[translate] textul nu primește traducere', key, fails[key] ?? 'renunț');
  return { fail: fails[key] ? 'later' : 'text' };
}
