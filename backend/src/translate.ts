import type { Env } from './env';

// Traducere automată din română în engleză și franceză, cu Workers AI. Variabilele de tip {nume} rămân neatinse.

export type Texts3 = { ro: string; en: string; fr: string };
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

export async function translateEx(env: Env, text: string, to: 'en' | 'fr', budget?: Budget): Promise<TrResult> {
  const ai = aiOf(env);
  if (!ai) return { fail: 'ai' };
  if (!text.trim()) return { fail: 'text' };
  const vars: string[] = [];
  const masked = text.replace(/\{[a-zA-ZăâîșțĂÂÎȘȚ_]+\}|##[a-z_]+##/g, (m) => {
    vars.push(m);
    return `[${vars.length - 1}]`;
  });
  const lines = masked.split('\n');
  if (lines.filter((l) => l.trim()).length > 12) return { fail: 'text' };
  if (budget && budget.left < aiCalls(text)) return { fail: 'budget' };
  const out: string[] = [];
  try {
    for (const l of lines) {
      if (!l.trim()) {
        out.push(l);
        continue;
      }
      if (budget) budget.left--;
      const r = (await ai.run(MODEL, { text: l, source_lang: 'ro', target_lang: to })) as { translated_text?: string } | null;
      const t = r?.translated_text?.trim();
      // Fără răspuns: serviciul nu merge acum (nu e vina textului).
      if (!t) return { fail: 'ai' };
      out.push(t);
    }
  } catch (e) {
    console.log('[translate]', String(e));
    return { fail: 'ai' };
  }
  const joined = out.join('\n').replace(/\[\s*(\d+)\s*\]/g, (m, i) => vars[Number(i)] ?? m);
  // Dacă modelul a pierdut o variabilă, mesajul ar ieși greșit: mai bine rămâne româna.
  if (vars.some((v) => !joined.includes(v))) return { fail: 'text' };
  return { text: joined };
}

/** Traduce un text scurt (titlu, mesaj, banner). Întoarce null dacă nu se poate (fără AI, eroare, variabile pierdute). */
export async function translate(env: Env, text: string, to: 'en' | 'fr'): Promise<string | null> {
  const r = await translateEx(env, text, to);
  return 'text' in r ? r.text : null;
}

/**
 * Completează engleza și franceza la salvare. Se traduce din nou când s-a schimbat româna sau când limba e goală;
 * o limbă corectată de mână în aceeași salvare (diferită de cea salvată înainte) rămâne cum a scris-o omul.
 */
export async function autoTranslate(env: Env, prev: Partial<Texts3> | undefined, next: Texts3): Promise<Texts3> {
  const out = { ...next };
  // Româna golită (ex. subtitlul unui banner scos): dispar și traducerile vechi, afară de cele scrise de mână acum.
  if (!out.ro.trim()) {
    for (const l of ['en', 'fr'] as const) if (out[l] === (prev?.[l] ?? '')) out[l] = '';
    return out;
  }
  const roChanged = out.ro !== (prev?.ro ?? '');
  for (const l of ['en', 'fr'] as const) {
    const edited = out[l].trim() !== '' && out[l] !== (prev?.[l] ?? '');
    if (edited) continue;
    if (!roChanged && out[l].trim()) continue;
    const t = await translate(env, out.ro, l);
    // Traducerea n-a mers: o traducere veche a altui text român ar fi greșită; goală, se folosește româna.
    if (t) out[l] = t;
    else if (roChanged) out[l] = '';
  }
  return out;
}
