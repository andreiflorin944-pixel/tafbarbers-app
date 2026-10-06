import type { Env } from './env';

// Traducere automată din română în engleză și franceză, cu Workers AI. Variabilele de tip {nume} rămân neatinse.

export type Texts3 = { ro: string; en: string; fr: string };
const MODEL = '@cf/meta/m2m100-1.2b';

async function run(env: Env, text: string, to: 'en' | 'fr'): Promise<string | null> {
  const r = (await env.AI!.run(MODEL, { text, source_lang: 'ro', target_lang: to })) as { translated_text?: string } | null;
  const t = r?.translated_text?.trim();
  return t ? t : null;
}

/** Traduce un text scurt (titlu, mesaj, banner). Întoarce null dacă nu se poate (fără AI, eroare, variabile pierdute). */
export async function translate(env: Env, text: string, to: 'en' | 'fr'): Promise<string | null> {
  if (!env.AI || !text.trim()) return null;
  const vars: string[] = [];
  const masked = text.replace(/\{[a-zA-ZăâîșțĂÂÎȘȚ_]+\}/g, (m) => {
    vars.push(m);
    return `[${vars.length - 1}]`;
  });
  try {
    const lines = masked.split('\n');
    if (lines.filter((l) => l.trim()).length > 12) return null;
    const out: string[] = [];
    for (const l of lines) out.push(l.trim() ? ((await run(env, l, to)) ?? '') : l);
    if (out.some((l, i) => lines[i].trim() && !l)) return null;
    const joined = out.join('\n').replace(/\[\s*(\d+)\s*\]/g, (m, i) => vars[Number(i)] ?? m);
    // Dacă modelul a pierdut o variabilă, mesajul ar ieși greșit: mai bine rămâne româna.
    if (vars.some((v) => !joined.includes(v))) return null;
    return joined;
  } catch (e) {
    console.log('[translate]', String(e));
    return null;
  }
}

/**
 * Completează engleza și franceza la salvare. Se traduce din nou când s-a schimbat româna sau când limba e goală;
 * o limbă corectată de mână în aceeași salvare (diferită de cea salvată înainte) rămâne cum a scris-o omul.
 */
export async function autoTranslate(env: Env, prev: Partial<Texts3> | undefined, next: Texts3): Promise<Texts3> {
  const out = { ...next };
  if (!out.ro.trim()) return out;
  const roChanged = out.ro !== (prev?.ro ?? '');
  for (const l of ['en', 'fr'] as const) {
    const edited = out[l].trim() !== '' && out[l] !== (prev?.[l] ?? '');
    if (edited) continue;
    if (!roChanged && out[l].trim()) continue;
    const t = await translate(env, out.ro, l);
    if (t) out[l] = t;
  }
  return out;
}
