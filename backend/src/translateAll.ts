import { getBusiness, getSetting, setSetting, type PromoRow } from './db';
import type { Env } from './env';
import { emptyStats, ensureTranslated, lookup, TR_LANGS, type TrStats } from './contentI18n';
import { DOCS, legalBase } from './legal';
import { getReferralSettings } from './referrals';
import { getBirthdaySettings } from './birthday';
import { aiOf, type Budget } from './translate';
import { iso } from './time';

// „Tradu tot conținutul acum”: traduce în engleză și franceză tot ce s-a scris în panou înainte de traducerea automată
// (sau cât timp AI-ul n-a mers). Merge pe bucăți (un buget de apeluri la AI pe rulare): butonul din panou o reia până
// termină, iar cron-ul o rulează singur o dată, cât timp mai lipsesc traduceri.

/** Câte apeluri la AI face o rulare (o cerere din panou sau o rulare de cron). */
export const RUN_BUDGET = 40;
// Setările care țin textele direct în trei limbi ({ ro, en, fr }): aspect, mesaje automate, urarea de ziua clientului.
const TEXTS3_SETTINGS = ['appearance', 'templates', 'automations', 'birthday'];

/** Toate textele românești din conținutul salonului, care se arată clienților. */
async function contentTexts(env: Env): Promise<string[]> {
  const q = <T>(sql: string) => env.DB.prepare(sql).all<T>().then((r) => r.results);
  const [services, barbers, products, plans, subs, items, bonuses, campaigns, biz, referral, birthday, legal] = await Promise.all([
    q<{ name: string; description: string }>('SELECT name, description FROM services WHERE active = 1'),
    q<{ role: string; bio: string }>('SELECT role, bio FROM barbers WHERE active = 1'),
    q<{ name: string; description: string }>('SELECT name, description FROM products WHERE active = 1'),
    q<{ name: string; description: string }>('SELECT name, description FROM plans WHERE active = 1'),
    // Abonamentele vândute și comenzile păstrează numele de atunci; bonusurile au titlul lor.
    q<{ name: string }>(`SELECT DISTINCT name FROM subscriptions WHERE status = 'active' LIMIT 200`),
    q<{ name: string }>(`SELECT DISTINCT i.name FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status IN ('new','ready') LIMIT 200`),
    q<{ title: string }>(`SELECT DISTINCT title FROM bonuses WHERE status = 'active' LIMIT 200`),
    q<{ title: string; body: string }>(`SELECT title, body FROM campaigns WHERE status IN ('draft','scheduled','sending')`),
    getBusiness(env),
    getReferralSettings(env),
    getBirthdaySettings(env),
    Promise.all(DOCS.map((d) => legalBase(env, d))),
  ]);
  return [
    ...services.flatMap((s) => [s.name, s.description]),
    ...barbers.flatMap((b) => [b.role, b.bio]),
    ...products.flatMap((p) => [p.name, p.description]),
    ...plans.flatMap((p) => [p.name, p.description]),
    ...subs.map((s) => s.name),
    ...items.map((i) => i.name),
    ...bonuses.map((b) => b.title),
    ...campaigns.flatMap((c) => [c.title, c.body]),
    biz.tagline,
    biz.description ?? '',
    biz.cancellationPolicy ?? '',
    referral.standard.title,
    birthday.reward.title,
    ...legal.flatMap((l) => [l.title, l.body]),
  ];
}

type T3 = { ro: string; en: string; fr: string };
const isT3 = (o: unknown): o is T3 => !!o && typeof o === 'object' && ['ro', 'en', 'fr'].every((k) => typeof (o as Record<string, unknown>)[k] === 'string');
function eachT3(o: unknown, fn: (t: T3) => void) {
  if (!o || typeof o !== 'object') return;
  if (isT3(o)) return fn(o);
  for (const v of Object.values(o)) eachT3(v, fn);
}

/** Pune traducerile găsite în limbile goale ale obiectului. Întoarce true dacă a schimbat ceva. */
function applyT3(obj: unknown, en: Map<string, string>, fr: Map<string, string>) {
  let changed = false;
  eachT3(obj, (t) => {
    for (const [l, m] of [['en', en], ['fr', fr]] as const) {
      if (t.ro.trim() && !t[l].trim() && m.get(t.ro)) {
        t[l] = m.get(t.ro)!;
        changed = true;
      }
    }
  });
  return changed;
}

/**
 * Setările cu texte { ro, en, fr }: completează limbile goale.
 * Traducerea durează: între timp proprietarul poate schimba setarea în panou (ex. oprește un mesaj automat). De aceea,
 * după traducere se citește din nou setarea, se completează doar limbile goale și se scrie numai dacă nu s-a schimbat
 * între citire și scriere (altfel se reia), ca să nu se scrie peste o schimbare făcută între timp.
 */
async function fillTexts3(env: Env, budget: Budget, st: TrStats, dry: boolean) {
  const read = (key: string) => env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  for (const key of TEXTS3_SETTINGS) {
    const row = await read(key);
    if (!row) continue;
    const need: string[] = [];
    eachT3(JSON.parse(row.value) as unknown, (t) => t.ro.trim() && (!t.en.trim() || !t.fr.trim()) && need.push(t.ro));
    if (!need.length) continue;
    await ensureTranslated(env, need, { budget, stats: st, dry });
    if (dry) continue;
    const [en, fr] = await Promise.all([lookup(env, 'en', need), lookup(env, 'fr', need)]);
    for (let i = 0; i < 5; i++) {
      const cur = await read(key);
      if (!cur) break;
      const obj = JSON.parse(cur.value) as unknown;
      if (!applyT3(obj, en, fr)) break;
      const r = await env.DB.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').bind(JSON.stringify(obj), key, cur.value).run();
      if (r.meta.changes) break;
    }
  }
}

/** Bannerele țin traducerile în rândul lor (`translations`): completează câmpurile goale (tot fără să scrie peste o schimbare făcută între timp). */
async function fillPromos(env: Env, budget: Budget, st: TrStats, dry: boolean) {
  const promos = (await env.DB.prepare('SELECT * FROM promos').all<PromoRow>()).results;
  const F = ['kicker', 'title', 'text', 'cta'] as const;
  type Tr = Partial<Record<'en' | 'fr', Record<string, string>>>;
  const missing = promos.filter((p) => {
    const tr = JSON.parse(p.translations || '{}') as Tr;
    return F.some((f) => p[f]?.trim() && TR_LANGS.some((l) => !tr[l]?.[f]?.trim()));
  });
  if (!missing.length) return;
  const need = missing.flatMap((p) => F.map((f) => p[f]));
  await ensureTranslated(env, need, { budget, stats: st, dry });
  if (dry) return;
  const [en, fr] = await Promise.all([lookup(env, 'en', need), lookup(env, 'fr', need)]);
  for (const old of missing) {
    for (let i = 0; i < 5; i++) {
      // Rândul de acum (textele și traducerile pot fi schimbate în panou cât a durat traducerea).
      const p = await env.DB.prepare('SELECT * FROM promos WHERE id = ?').bind(old.id).first<PromoRow>();
      if (!p) break;
      const tr = JSON.parse(p.translations || '{}') as Tr;
      const out = { en: { ...tr.en }, fr: { ...tr.fr } };
      let changed = false;
      for (const f of F) {
        for (const [l, m] of [['en', en], ['fr', fr]] as const) {
          if (p[f]?.trim() && !out[l][f]?.trim() && m.get(p[f])) {
            out[l][f] = m.get(p[f])!;
            changed = true;
          }
        }
      }
      if (!changed) break;
      const r = await env.DB.prepare(
        'UPDATE promos SET translations = ? WHERE id = ? AND translations IS ? AND kicker IS ? AND title IS ? AND text IS ? AND cta IS ?',
      )
        .bind(JSON.stringify(out), p.id, p.translations, p.kicker, p.title, p.text, p.cta)
        .run();
      if (r.meta.changes) break;
    }
  }
}

/**
 * O rulare: traduce ce lipsește, până la buget. `fresh` = încearcă din nou și textele care n-au mers data trecută.
 * `dry` = doar numără ce lipsește (pentru panou), fără AI.
 */
export async function translateAll(env: Env, opts: { budget?: number; fresh?: boolean; dry?: boolean } = {}): Promise<TrStats> {
  if (opts.fresh && !opts.dry) await env.DB.prepare(`DELETE FROM translations WHERE text = '' AND manual = 0`).run();
  const st = emptyStats();
  const dry = !!opts.dry;
  const budget = { left: dry ? 0 : (opts.budget ?? RUN_BUDGET) };
  if (!dry && !aiOf(env)) st.aiDown = true;
  await ensureTranslated(env, await contentTexts(env), { budget, stats: st, dry });
  await fillTexts3(env, budget, st, dry);
  await fillPromos(env, budget, st, dry);
  if (!dry && !st.aiDown && !st.remaining) await setSetting(env, 'i18n_backfill', { done: true, at: iso(new Date()) });
  return st;
}

/** Din cron: rulează cât timp mai lipsesc traduceri (prima dată după actualizare sau după o salvare când AI-ul n-a mers). */
export async function translateAllOnce(env: Env) {
  const s = await getSetting(env, 'i18n_backfill', { done: false });
  if (s.done || !aiOf(env)) return null;
  return translateAll(env);
}
