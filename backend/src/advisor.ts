import { Hono } from 'hono';
import { requireClient } from './auth';
import { localize, langOf } from './contentI18n';
import { getBusiness, getSetting, service, setSetting, type ServiceRow } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { mediaUrl } from './identity';
import { iso } from './time';
import { aiOf } from './translate';
import { hairstyle, HAIRSTYLES, stylePrompt } from './hairstyles';

// Consilierul AI de tunsori („Ce tunsoare mi se potrivește?”): clientul face o poză, modelul cu vedere descrie fața și
// părul, apoi asistentul recomandă 2-4 tunsori concrete (din lista fixă din hairstyles.ts), fiecare cu o poză de exemplu,
// motivul, ce să ceară la frizer și serviciul salonului la care se poate programa.
// Poza nu se salvează nicăieri: nici în baza de date, nici în jurnale. Stă doar în memorie cât durează analiza.

const VISION = '@cf/meta/llama-3.2-11b-vision-instruct';
const VISION_FALLBACK = '@cf/meta/llama-4-scout-17b-16e-instruct';
const TEXT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DAILY_LIMIT = 5; // analize pe zi pentru un client
const GLOBAL_DAILY_LIMIT = 300; // analize pe zi la tot salonul
const DAILY_TRIES = 10; // încercări pe zi pentru un client (și cele nereușite: fiecare face apeluri la AI)
const GLOBAL_DAILY_TRIES = 600; // încercări pe zi la tot salonul
const MAX_BYTES = 4_000_000;

export type AdvisorSettings = { on: boolean };
export const getAdvisor = (env: Env) => getSetting<AdvisorSettings>(env, 'advisor', { on: true });
export const setAdvisor = (env: Env, v: AdvisorSettings) => setSetting(env, 'advisor', { on: !!v.on });

/** Pornit în panou și cu AI-ul disponibil (aplicația arată cardul doar atunci). */
export async function advisorAvailable(env: Env) {
  return !!aiOf(env) && (await getAdvisor(env)).on;
}

/** Câte analize s-au făcut (doar numărul; nimic despre poze sau clienți). */
export async function advisorStats(env: Env) {
  const today = iso(new Date()).slice(0, 10);
  const since = iso(new Date(Date.now() - 29 * 86_400_000)).slice(0, 10);
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN day = ?1 THEN n END), 0) AS today, COALESCE(SUM(CASE WHEN day >= ?2 THEN n END), 0) AS last30, COALESCE(SUM(n), 0) AS total
     FROM assistant_usage WHERE key = 'advisor:done'`,
  )
    .bind(today, since)
    .first<{ today: number; last30: number; total: number }>();
  return { today: r?.today ?? 0, last30: r?.last30 ?? 0, total: r?.total ?? 0 };
}

/** Tipul pozei după primii octeți (nu după ce spune telefonul): JPG, PNG sau WebP. */
function imageKind(u: Uint8Array): string | null {
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return 'jpeg';
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return 'png';
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return 'webp';
  return null;
}

/** Răspunsul modelului ca obiect: din `response` (text sau obiect), cu JSON-ul scos din text dacă e nevoie. */
function jsonOf(raw: unknown): Record<string, unknown> | null {
  const r = raw as { response?: unknown } | null;
  const v = r?.response ?? raw;
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v !== 'string') return null;
  const m = v.match(/\{[\s\S]*\}/);
  try {
    return m ? (JSON.parse(m[0]) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Look = { face: string; hairType: string; density: string; length: string; hairline: string; beard: string; notes: string };

const VISION_PROMPT = `You are a professional barber. Look at the person in the photo and describe only what matters for choosing a haircut.
Answer ONLY with JSON: {"person": true|false, "face": "oval|round|square|oblong|heart|diamond|triangle", "hairType": "straight|wavy|curly|coily", "density": "thin|medium|thick", "length": "very short|short|medium|long", "hairline": "normal|receding|thinning crown|bald", "beard": "none|stubble|short|full", "notes": "max 15 words"}.
If there is no clearly visible human face, answer {"person": false}.`;

/** Poza ca „data URL” base64, forma din documentația Workers AI (un șir de numere pentru o poză întreagă era prea mare). */
function dataUrl(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/${imageKind(bytes) ?? 'jpeg'};base64,${btoa(bin)}`;
}

/** Modelul cu vedere poate cere o singură dată acceptarea licenței (prompt „agree”); o facem automat și reîncercăm. */
async function runLlamaVision(env: Env, image: string): Promise<unknown> {
  const ai = aiOf(env)!;
  const input = {
    messages: [
      { role: 'system', content: VISION_PROMPT },
      { role: 'user', content: 'Describe the face and hair in this photo.' },
    ],
    image,
    max_tokens: 250,
    temperature: 0.2,
  };
  try {
    return await ai.run(VISION, input);
  } catch (e) {
    if (!/agree/i.test(e instanceof Error ? e.message : String(e))) throw e;
    await ai.run(VISION, { prompt: 'agree' });
    return await ai.run(VISION, input);
  }
}

/** Al doilea model cu vedere, folosit doar dacă primul dă eroare sau un răspuns de necitit. */
async function runScout(env: Env, image: string): Promise<unknown> {
  return aiOf(env)!.run(VISION_FALLBACK, {
    messages: [
      { role: 'system', content: VISION_PROMPT },
      { role: 'user', content: [{ type: 'text', text: 'Describe the face and hair in this photo.' }, { type: 'image_url', image_url: { url: image } }] },
    ],
    max_tokens: 250,
    temperature: 0.2,
  });
}

async function runVision(env: Env, bytes: Uint8Array): Promise<Record<string, unknown>> {
  const image = dataUrl(bytes);
  try {
    const o = jsonOf(await runLlamaVision(env, image));
    if (o) return o;
    console.error('advisor vision unreadable');
  } catch (e) {
    // Doar mesajul erorii în jurnal, niciodată poza.
    console.error('advisor vision', e instanceof Error ? e.message.slice(0, 200) : 'error');
  }
  const o = jsonOf(await runScout(env, image));
  if (!o) throw new Error('vision_unreadable');
  return o;
}

const str = (v: unknown, max = 40) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Analiza pozei: forma feței și părul. Întoarce null dacă în poză nu se vede o față. */
async function analyse(env: Env, bytes: Uint8Array): Promise<Look | null> {
  const o = await runVision(env, bytes);
  if (o.person === false || (!o.face && !o.hairType)) return null;
  return { face: str(o.face), hairType: str(o.hairType), density: str(o.density), length: str(o.length), hairline: str(o.hairline), beard: str(o.beard), notes: str(o.notes, 160) };
}

// Termenii din analiza pozei (vin în engleză de la modelul cu vedere), traduși înainte să ajungă în rezumat.
const TERMS: Record<string, { ro: string; fr: string }> = {
  oval: { ro: 'ovală', fr: 'ovale' },
  round: { ro: 'rotundă', fr: 'ronde' },
  square: { ro: 'pătrată', fr: 'carrée' },
  oblong: { ro: 'alungită', fr: 'allongée' },
  heart: { ro: 'în formă de inimă', fr: 'en cœur' },
  diamond: { ro: 'în formă de romb', fr: 'en losange' },
  triangle: { ro: 'triunghiulară', fr: 'triangulaire' },
  straight: { ro: 'drept', fr: 'raides' },
  wavy: { ro: 'ondulat', fr: 'ondulés' },
  curly: { ro: 'creț', fr: 'bouclés' },
  coily: { ro: 'foarte creț (afro)', fr: 'crépus' },
  thin: { ro: 'rar', fr: 'fins' },
  medium: { ro: 'mediu', fr: 'moyens' },
  thick: { ro: 'des', fr: 'épais' },
  'very short': { ro: 'foarte scurt', fr: 'très courts' },
  short: { ro: 'scurt', fr: 'courts' },
  long: { ro: 'lung', fr: 'longs' },
  normal: { ro: 'normală', fr: 'normale' },
  receding: { ro: 'retrasă la tâmple', fr: 'dégarnie aux tempes' },
  'thinning crown': { ro: 'rărit la creștet', fr: 'clairsemés au sommet' },
  bald: { ro: 'chel', fr: 'chauve' },
  none: { ro: 'fără barbă', fr: 'sans barbe' },
  stubble: { ro: 'barbă de câteva zile', fr: 'barbe de quelques jours' },
  full: { ro: 'barbă plină', fr: 'barbe fournie' },
};
const term = (v: string, lang: string) => (lang === 'en' ? v : (TERMS[v.toLowerCase()]?.[lang === 'fr' ? 'fr' : 'ro'] ?? v));

const MAX_STYLES = 4;

/** Alegerea tunsorilor potrivite (doar din lista fixă), cu motivul și ce să ceară la frizer, în limba clientului. */
async function pick(env: Env, look: Look, services: ServiceRow[], lang: string) {
  const biz = await getBusiness(env);
  const language = lang === 'en' ? 'engleză' : lang === 'fr' ? 'franceză' : 'română';
  const you = lang === 'en' ? '"you"' : lang === 'fr' ? '"tu"' : '"tu"';
  const T = (v: string) => (v ? term(v, lang) : '');
  const styles = HAIRSTYLES.map((h) => `- ${h.key}: ${h.name.en} (${h.about})`).join('\n');
  const list = services.map((s) => `- ${s.name} (id ${s.id}): ${s.duration_min} min${s.description ? `. ${s.description.slice(0, 120)}` : ''}`).join('\n');
  const beard = look.beard.toLowerCase();
  const system = `Ești consilierul de tunsori al salonului ${biz.name}. Pe baza analizei unei poze a clientului, îi recomanzi 3 TUNSORI concrete (minim 2, maxim 4) din lista de tunsori de mai jos. Nu recomanzi pachete sau servicii, ci tunsori.
Analiza pozei: fața ${T(look.face) || '?'}; părul ${[look.hairType, look.density, look.length].filter(Boolean).map(T).join(', ') || '?'}; linia părului ${T(look.hairline) || '?'}; barba ${T(look.beard) || '?'}${look.notes ? `; observații (scrise în limba engleză, de tradus): ${look.notes}` : ''}.
Tunsorile posibile (cheie: nume, descriere):
${styles}
Serviciile salonului (doar ca să știi la ce serviciu se poate programa pentru tunsoarea aleasă):
${list}

Reguli:
- "key": doar chei din lista de tunsori, fiecare o singură dată. Alege ce se potrivește cu forma feței, tipul și desimea părului și linia părului (ex.: păr creț -> tunsori care păstrează buclele; linie retrasă -> French crop, Caesar, crop texturat, buzz cut, nu slick back; față rotundă -> volum sus și părți scurte).
- Dacă părul e scurt acum, alege mai ales tunsori care se pot face acum; una care cere păr mai lung o poți propune doar spunând asta în motiv.
- "reason": 1-2 propoziții calde, de ce i se potrivește lui, vorbind direct cu clientul (${you}), în ${language}.
- "ask": o propoziție scurtă cu ce să-i spună frizerului (lungimi, fade, textură), în ${language}.
- "serviceId": id-ul serviciului din listă la care se face tunsoarea (de obicei tunsoarea simplă; cu barbă doar dacă are barbă${beard === 'none' ? ', iar clientul NU are barbă' : ''}; pentru copii doar dacă e copil). "" dacă niciunul nu se potrivește.
- "summary": 1-2 propoziții despre forma feței și păr, vorbind direct cu clientul (${you}), pe înțelesul oricui, DOAR în ${language}, fără cuvinte în altă limbă.
- Nu inventa prețuri sau reduceri.
- Răspunzi DOAR cu JSON: {"summary": "...", "styles": [{"key": "...", "reason": "...", "ask": "...", "serviceId": "..."}]}.`;
  const schema = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      styles: {
        type: 'array',
        items: {
          type: 'object',
          properties: { key: { type: 'string', enum: HAIRSTYLES.map((h) => h.key) }, reason: { type: 'string' }, ask: { type: 'string' }, serviceId: { type: 'string', enum: ['', ...services.map((s) => s.id)] } },
          required: ['key', 'reason', 'ask', 'serviceId'],
        },
      },
    },
    required: ['summary', 'styles'],
  };
  const raw = await aiOf(env)!.run(TEXT, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: 'Ce tunsori mi se potrivesc?' },
    ],
    response_format: { type: 'json_schema', json_schema: schema },
    max_tokens: 700,
    temperature: 0.4,
  });
  const o = jsonOf(raw);
  if (!o) throw new Error('pick_unreadable');
  const seen = new Set<string>();
  // Doar tunsori din listă, fiecare o singură dată, cel mult 4; serviciul doar dacă e unul activ al salonului.
  const chosen = (Array.isArray(o.styles) ? o.styles : [])
    .map((x) => x as { key?: unknown; reason?: unknown; ask?: unknown; serviceId?: unknown })
    .filter((x) => typeof x.key === 'string' && hairstyle(x.key) && !seen.has(x.key) && seen.add(x.key))
    .slice(0, MAX_STYLES)
    .map((x) => ({
      key: x.key as string,
      reason: str(x.reason, 300),
      ask: str(x.ask, 240),
      serviceId: typeof x.serviceId === 'string' && services.some((s) => s.id === x.serviceId) ? x.serviceId : null,
    }));
  return { summary: str(o.summary, 400), chosen };
}

/**
 * Numără o analiză (client + tot salonul); peste limită aruncă eroarea potrivită. Întoarce câte mai are clientul azi.
 * Pe lângă analizele reușite se numără și încercările (și cele nereușite, care se dau înapoi la analize): fiecare
 * încercare face apeluri la AI, deci și ele au o limită (altfel cineva ar putea trimite la nesfârșit poze fără față).
 */
async function takeSlot(env: Env, clientId: string) {
  const day = iso(new Date()).slice(0, 10);
  const inc = async (k: string) =>
    (await env.DB.prepare(`INSERT INTO assistant_usage (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1 RETURNING n`).bind(day, k).first<{ n: number }>())?.n ?? 0;
  const dec = (keys: string[]) =>
    env.DB.batch(keys.map((k) => env.DB.prepare('UPDATE assistant_usage SET n = MAX(n - 1, 0) WHERE day = ? AND key = ?').bind(day, k)));
  const mine = await inc(`advisor:${clientId}`);
  if (mine > DAILY_LIMIT) {
    await dec([`advisor:${clientId}`]);
    throw new HttpError(429, 'advisor_limit');
  }
  if ((await inc(`advisor-try:${clientId}`)) > DAILY_TRIES) {
    await dec([`advisor:${clientId}`, `advisor-try:${clientId}`]);
    throw new HttpError(429, 'advisor_limit');
  }
  if ((await inc('advisor:*')) > GLOBAL_DAILY_LIMIT) {
    await dec([`advisor:${clientId}`, `advisor-try:${clientId}`, 'advisor:*']);
    throw new HttpError(429, 'advisor_busy');
  }
  if ((await inc('advisor-try:*')) > GLOBAL_DAILY_TRIES) {
    await dec([`advisor:${clientId}`, `advisor-try:${clientId}`, 'advisor:*', 'advisor-try:*']);
    throw new HttpError(429, 'advisor_busy');
  }
  return DAILY_LIMIT - mine;
}

/** Analiza n-a reușit: nu se pune la socoteală la analize (încercarea rămâne numărată, vezi takeSlot). */
async function giveBack(env: Env, clientId: string) {
  const day = iso(new Date()).slice(0, 10);
  const keys = [`advisor:${clientId}`, 'advisor:*'];
  await env.DB.batch(keys.map((k) => env.DB.prepare('UPDATE assistant_usage SET n = MAX(n - 1, 0) WHERE day = ? AND key = ?').bind(day, k)));
}

export const advisorRoutes = new Hono<AppEnv>();

/**
 * POST /advisor?lang=ro&consent=1, cu poza în corp (image/jpeg, png sau webp, max 4 MB).
 * `consent=1` = clientul a acceptat „Poza e folosită doar pentru analiză și se șterge imediat”.
 */
advisorRoutes.post('/advisor', requireClient, async (c) => {
  const env = c.env;
  if (!(await getAdvisor(env)).on) throw new HttpError(409, 'advisor_off');
  if (c.req.query('consent') !== '1') throw new HttpError(400, 'consent_required');
  if (!aiOf(env)) throw new HttpError(409, 'advisor_off');
  const lang = langOf(c.req.query('lang'));
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'empty_file');
  if (buf.byteLength > MAX_BYTES) throw new HttpError(400, 'image_too_large');
  const bytes = new Uint8Array(buf);
  if (!imageKind(bytes)) throw new HttpError(400, 'unsupported_image');

  const clientId = c.get('client').clientId;
  const services = (await env.DB.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort, name').all<ServiceRow>()).results;
  if (!services.length) throw new HttpError(409, 'advisor_off');
  const left = await takeSlot(env, clientId);

  let look: Look | null;
  let picked: Awaited<ReturnType<typeof pick>>;
  try {
    look = await analyse(env, bytes);
    if (look) picked = await pick(env, look, services, lang);
  } catch (e) {
    // Doar mesajul erorii în jurnal, niciodată poza.
    console.error('advisor ai', e instanceof Error ? e.message.slice(0, 200) : 'error');
    await giveBack(env, clientId);
    throw new HttpError(500, 'advisor_failed');
  }
  if (!look) {
    await giveBack(env, clientId);
    throw new HttpError(400, 'advisor_no_face');
  }
  if (!picked!.chosen.length) {
    await giveBack(env, clientId);
    throw new HttpError(500, 'advisor_failed');
  }
  await env.DB.prepare(`INSERT INTO assistant_usage (day, key, n) VALUES (?, 'advisor:done', 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1`)
    .bind(iso(new Date()).slice(0, 10))
    .run();

  // Fiecare tunsoare: numele în limba clientului, poza de exemplu (generată o dată, vezi mai jos), serviciul la care se
  // programează și pozele înainte/după ale salonului la acel serviciu (doar perechile bifate ca exemplu în panou).
  const ids = [...new Set(picked!.chosen.map((x) => x.serviceId).filter((x): x is string => !!x))];
  const shown = await localize(env, lang, services.filter((s) => ids.includes(s.id)).map(service), ['name', 'description']);
  const examples = new Map<string, { before: string; after: string }[]>();
  for (const id of ids) {
    const ex = await env.DB.prepare(
      `SELECT x.before_media, x.after_media FROM before_after x JOIN clients cl ON cl.id = x.client_id
       WHERE x.service_id = ? AND x.show_example = 1 AND cl.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 3`,
    )
      .bind(id)
      .all<{ before_media: string; after_media: string }>();
    examples.set(id, ex.results.map((p) => ({ before: mediaUrl(p.before_media), after: mediaUrl(p.after_media) })));
  }
  const name = (key: string) => hairstyle(key)!.name[lang === 'en' ? 'en' : lang === 'fr' ? 'fr' : 'ro'];
  const styles = picked!.chosen.map((x) => {
    const s = x.serviceId ? shown.find((y) => y.id === x.serviceId) : undefined;
    return {
      key: x.key,
      name: name(x.key),
      reason: x.reason,
      ask: x.ask,
      imageUrl: `/v1/advisor/style/${x.key}`,
      service: s ? { id: s.id, name: s.name, price: s.price, durationMin: s.durationMin } : null,
      examples: (s && examples.get(s.id)) || [],
    };
  });
  return c.json({ summary: picked!.summary, styles, left });
});

const STYLE_IMAGE = '@cf/black-forest-labs/flux-1-schnell';
const STYLE_FAILS_PER_DAY = 40;

/**
 * GET /advisor/style/:key — poza de exemplu a unei tunsori din listă. Se generează cu AI la prima cerere și se păstrează
 * în media (id fix „style-<cheie>”), deci fiecare tunsoare costă un singur apel. Publică (aplicația o încarcă direct).
 */
advisorRoutes.get('/advisor/style/:key', async (c) => {
  const env = c.env;
  const h = hairstyle(c.req.param('key'));
  if (!h) throw new HttpError(404, 'not_found');
  const id = `style-${h.key}`;
  const send = (body: ArrayBuffer | Uint8Array, mime: string) =>
    c.body(body as ArrayBuffer, 200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff' });
  const r = await env.DB.prepare('SELECT mime, data FROM media WHERE id = ?').bind(id).first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (r) return send(r.data instanceof ArrayBuffer ? r.data : new Uint8Array(r.data), r.mime);
  const ai = aiOf(env);
  if (!ai) throw new HttpError(404, 'not_found');
  // Dacă generarea tot cade, nu o mai încercăm la nesfârșit în aceeași zi (fiecare încercare e un apel la AI).
  const day = iso(new Date()).slice(0, 10);
  const fails = await env.DB.prepare(`SELECT n FROM assistant_usage WHERE day = ? AND key = 'advisor-style-fail'`).bind(day).first<{ n: number }>();
  if ((fails?.n ?? 0) >= STYLE_FAILS_PER_DAY) throw new HttpError(404, 'not_found');
  let bytes: Uint8Array | null = null;
  try {
    const out = (await ai.run(STYLE_IMAGE, { prompt: stylePrompt(h), steps: 6 })) as { image?: string };
    if (typeof out?.image === 'string') bytes = Uint8Array.from(atob(out.image), (ch) => ch.charCodeAt(0));
  } catch (e) {
    console.error('advisor style image', e instanceof Error ? e.message.slice(0, 200) : 'error');
  }
  const kind = bytes && imageKind(bytes);
  if (!bytes || !kind) {
    await env.DB.prepare(`INSERT INTO assistant_usage (day, key, n) VALUES (?, 'advisor-style-fail', 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1`).bind(day).run();
    throw new HttpError(404, 'not_found');
  }
  const mime = `image/${kind}`;
  await env.DB.prepare('INSERT OR IGNORE INTO media (id, mime, data, size, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, mime, bytes, bytes.byteLength, iso(new Date())).run();
  return send(bytes, mime);
});
