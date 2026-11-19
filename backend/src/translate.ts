import type { Env } from './env';

// Traducere automată din română în engleză, franceză și arabă, cu Workers AI. Variabilele de tip {nume} rămân neatinse.

/** Un text scris în panou, cu traducerile lui. Araba e opțională în datele salvate înainte de ea (se completează singură). */
export type Texts3 = { ro: string; en: string; fr: string; ar?: string };
export type To = 'en' | 'fr' | 'ar';
export const TO: readonly To[] = ['en', 'fr', 'ar'];
/** Textul în limba cerută; unde lipsește traducerea, româna (pentru arabă întâi engleza, mai ușor de înțeles decât româna). */
export const pick3 = (t: Partial<Texts3> | null | undefined, lang: string): string =>
  ((lang === 'en' || lang === 'fr' || lang === 'ar' ? t?.[lang] : '') || (lang === 'ar' ? t?.en : '') || t?.ro || '');
const MODEL = '@cf/meta/m2m100-1.2b';
type Ai = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

/** Workers AI; local, pentru teste, serverul de probă (DEV_AI_MOCK_BASE), ca la asistent. */
export function aiOf(env: Env): Ai | null {
  if (env.AI) return env.AI;
  const base = env.DEV_AI_MOCK_BASE;
  if (!base) return null;
  return {
    run: async (model, input) => {
      const r = await fetch(`${base}/ai/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input }) });
      // Ca legătura adevărată: o eroare a modelului aruncă (cu mesajul lui), nu întoarce un răspuns gol.
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 300)}`);
      return r.json();
    },
  };
}

/** Câte apeluri la AI mai are voie o rulare (traducerea întregului conținut se face pe bucăți). */
export type Budget = { left: number };

/** Rezultatul unei traduceri: textul, sau de ce nu s-a putut ('ai' = serviciul nu răspunde, 'text' = textul nu se poate traduce bine, 'budget' = s-a terminat bugetul). */
export type TrResult = { text: string } | { fail: 'ai' | 'text' | 'budget' };

/** Numărul de rânduri nevide, adică numărul de apeluri la AI pentru un text. */
export const aiCalls = (text: string) => text.split('\n').filter((l) => l.trim()).length;

const VAR_RE = /\{[a-zA-ZăâîșțĂÂÎȘȚ_]+\}|##[a-z_]+##/g;
/** Cifrele scrise în arabă (٠–٩) sau persană (۰–۹) devin cifre obișnuite. */
const latinDigits = (x: string) => x.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** Trimite rândurile la model (rândurile goale rămân goale). null = serviciul nu răspunde. */
async function runLines(ai: Ai, lines: string[], to: To, budget?: Budget): Promise<string[] | null> {
  const out: string[] = [];
  for (const l of lines) {
    if (!l.trim()) {
      out.push(l);
      continue;
    }
    if (budget) budget.left--;
    const r = (await ai.run(MODEL, { text: l, source_lang: 'ro', target_lang: to })) as { translated_text?: string } | null;
    const t = r?.translated_text?.trim();
    if (!t) return null;
    out.push(t);
  }
  return out;
}

/**
 * Traduce un text, cu variabilele ({nume}, {ora}...) puse la loc. Modelul mai pierde uneori semnele puse în locul
 * variabilelor (mai ales în arabă), așa că se încearcă pe rând trei feluri:
 *  1. variabilele devin [0], [1]...;
 *  2. variabilele devin numere (7301, 7302...), pe care modelul le lasă aproape mereu neatinse;
 *  3. textul se taie la variabile și se traduce bucată cu bucată (modelul nu mai vede deloc variabilele).
 */
export async function translateEx(env: Env, text: string, to: To, budget?: Budget): Promise<TrResult> {
  const ai = aiOf(env);
  if (!ai) return { fail: 'ai' };
  if (!text.trim()) return { fail: 'text' };
  const vars: string[] = [];
  const masked = text.replace(VAR_RE, (m) => {
    vars.push(m);
    return `[${vars.length - 1}]`;
  });
  const lines = masked.split('\n');
  if (lines.filter((l) => l.trim()).length > 12) return { fail: 'text' };
  if (budget && budget.left < aiCalls(text)) return { fail: 'budget' };
  try {
    const out = await runLines(ai, lines, to, budget);
    if (!out) return { fail: 'ai' };
    if (!vars.length) return { text: out.join('\n') };
    // 1. [0], [1]... (și parantezele sau cifrele scrise altfel de model).
    const joined = out.join('\n').replace(/[\[［]\s*([\d٠-٩۰-۹]+)\s*[\]］]/g, (m, i) => vars[Number(latinDigits(i))] ?? m);
    if (vars.every((v) => joined.includes(v))) return { text: joined };

    // 2. Numere: 7301, 7302...
    const num = (i: number) => String(7301 + i);
    let k = 0;
    const numbered = text.replace(VAR_RE, () => num(k++)).split('\n');
    if (budget && budget.left < aiCalls(text)) return { fail: 'budget' };
    const out2 = await runLines(ai, numbered, to, budget);
    if (!out2) return { fail: 'ai' };
    let joined2 = latinDigits(out2.join('\n')).replace(/(\d)[,.\s\u066C\u066B](?=\d)/g, '$1');
    let ok = true;
    for (let i = vars.length - 1; i >= 0; i--) {
      const re = new RegExp(num(i), 'g');
      if ((joined2.match(re) ?? []).length !== 1) ok = false;
      joined2 = joined2.replace(re, () => vars[i]);
    }
    if (ok && vars.every((v) => joined2.includes(v))) return { text: joined2 };

    // 3. Bucată cu bucată, între variabile (ordinea rămâne cea din română).
    const pieces = text.split('\n').map((line) => line.split(/(\{[a-zA-ZăâîșțĂÂÎȘȚ_]+\}|##[a-z_]+##)/));
    const isVar = (p: string) => /^(\{[a-zA-ZăâîșțĂÂÎȘȚ_]+\}|##[a-z_]+##)$/.test(p);
    const toDo = pieces.flat().filter((p, i, a) => !isVar(p) && /\p{L}/u.test(p) && a.indexOf(p) === i);
    if (budget && budget.left < toDo.length) return { fail: 'budget' };
    const done = new Map<string, string>();
    for (const p of toDo) {
      const r = await runLines(ai, [p.trim()], to, budget);
      if (!r) return { fail: 'ai' };
      done.set(p, r[0]);
    }
    const result = pieces
      .map((parts) =>
        parts
          .map((p) => {
            if (isVar(p) || !done.has(p)) return p;
            // Păstrează spațiile din jur, ca variabila să nu se lipească de cuvinte.
            const lead = /^\s/.test(p) ? ' ' : '';
            const trail = /\s$/.test(p) ? ' ' : '';
            return lead + done.get(p)!.replace(/[.!?。]$/, (m) => (/[.!?]\s*$/.test(p) ? m : '')) + trail;
          })
          .join(''),
      )
      .join('\n');
    if (vars.every((v) => result.includes(v))) return { text: result };
    return { fail: 'text' };
  } catch (e) {
    console.log('[translate]', String(e));
    return { fail: 'ai' };
  }
}

/** Traduce un text scurt (titlu, mesaj, banner). Întoarce null dacă nu se poate (fără AI, eroare, variabile pierdute). */
export async function translate(env: Env, text: string, to: To): Promise<string | null> {
  const r = await translateEx(env, text, to);
  return 'text' in r ? r.text : null;
}

/**
 * Completează engleza, franceza și araba la salvare. Se traduce din nou când s-a schimbat româna sau când limba e goală;
 * o limbă corectată de mână în aceeași salvare (diferită de cea salvată înainte) rămâne cum a scris-o omul.
 */
export async function autoTranslate(env: Env, prev: Partial<Texts3> | undefined, next: Texts3): Promise<Texts3> {
  const out = { ...next };
  // Româna golită (ex. subtitlul unui banner scos): dispar și traducerile vechi, afară de cele scrise de mână acum.
  if (!out.ro.trim()) {
    for (const l of TO) if ((out[l] ?? '') === (prev?.[l] ?? '')) out[l] = '';
    return out;
  }
  const roChanged = out.ro !== (prev?.ro ?? '');
  for (const l of TO) {
    const cur = out[l] ?? '';
    const edited = cur.trim() !== '' && cur !== (prev?.[l] ?? '');
    if (edited) continue;
    if (!roChanged && cur.trim()) continue;
    const t = await translate(env, out.ro, l);
    // Traducerea n-a mers: o traducere veche a altui text român ar fi greșită; goală, se folosește româna.
    if (t) out[l] = t;
    else if (roChanged) out[l] = '';
  }
  return out;
}
