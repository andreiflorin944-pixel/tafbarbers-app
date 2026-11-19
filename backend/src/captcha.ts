import { turnstileLang } from './contentI18n';
import { Hono, type Context } from 'hono';
import { getSetting, setSetting } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { seal, unseal } from './social';
import { iso } from './time';

// Verificarea „nu sunt robot” (Cloudflare Turnstile, gratuită) înainte de trimiterea unui cod pe SMS sau e-mail.
// Fără ea, cineva cu multe adrese IP ar putea cere coduri la nesfârșit și ar consuma plafonul zilnic de SMS-uri (și banii).
// Cheile le pune proprietarul în Panou → Setări → Protecție anti-robot: cheia de site e publică (merge în aplicație și pe
// site), cheia secretă se păstrează criptată și nu se mai arată. Verificarea se cere doar după ce e pornită din panou,
// ca versiunile vechi ale aplicației (fără verificare) să nu rămână fără cod până se actualizează.

type Settings = {
  siteKey: string;
  secretSealed: string | null;
  secretHint: string;
  enforce: boolean;
  savedAt: string | null;
  lastFailAt: string | null;
};
const KEY = 'captcha';
const EMPTY: Settings = { siteKey: '', secretSealed: null, secretHint: '', enforce: false, savedAt: null, lastFailAt: null };
const getSettings = async (env: Env) => ({ ...EMPTY, ...(await getSetting<Partial<Settings>>(env, KEY, {})) });

const verifyUrl = (env: Env) => `${(env.TURNSTILE_MOCK_BASE || 'https://challenges.cloudflare.com').replace(/\/+$/, '')}/turnstile/v0/siteverify`;

async function siteverify(env: Env, secret: string, token: string, ip?: string) {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const r = await fetch(verifyUrl(env), { method: 'POST', body: form, signal: AbortSignal.timeout(8000) });
  return (await r.json()) as { success?: boolean; 'error-codes'?: string[] };
}

/** Cheia de site pentru aplicație și site, doar cât sunt puse ambele chei (altfel nu se arată nicio verificare). */
export async function captchaSiteKey(env: Env): Promise<string | null> {
  const s = await getSettings(env);
  return s.siteKey && s.secretSealed ? s.siteKey : null;
}

/**
 * Înainte de orice cod trimis din paginile publice: cât e pornită verificarea, cererea trebuie să aibă un răspuns
 * Turnstile valid (fiecare se poate folosi o singură dată). Dacă serverul Cloudflare nu răspunde, codul pleacă totuși
 * (limitele pe număr, IP și zi rămân), ca o pană la ei să nu oprească intrarea în cont.
 */
export async function requireCaptcha(c: Context<AppEnv>, token: unknown) {
  const s = await getSettings(c.env);
  if (!s.enforce || !s.siteKey || !s.secretSealed) return;
  if (typeof token !== 'string' || !token || token.length > 4096) throw new HttpError(400, 'captcha_required');
  let ok: boolean;
  try {
    ok = !!(await siteverify(c.env, await unseal(c.env, s.secretSealed), token, c.req.header('CF-Connecting-IP'))).success;
  } catch (e) {
    console.error('turnstile_unreachable', e);
    return;
  }
  if (!ok) {
    // Ultima respingere, ca proprietarul să vadă în panou că verificarea lucrează (scrisă cel mult o dată pe minut).
    const now = iso(new Date());
    if (!s.lastFailAt || Date.parse(s.lastFailAt) < Date.now() - 60_000) c.executionCtx.waitUntil(setSetting(c.env, KEY, { ...s, lastFailAt: now }).catch(() => undefined));
    throw new HttpError(400, 'captcha_failed');
  }
}

// --- Pagina cu verificarea (o deschide aplicația într-un WebView mic, iar site-ul o pune direct în pagină) ---

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export const captchaPublic = new Hono<AppEnv>();

captchaPublic.get('/captcha', async (c) => {
  const key = await captchaSiteKey(c.env);
  if (!key) return c.text('Not found', 404);
  const lang = ['ro', 'en', 'fr', 'ar'].includes(c.req.query('lang') ?? '') ? c.req.query('lang')! : 'ro';
  const theme = c.req.query('theme') === 'light' ? 'light' : 'dark';
  const cfg = JSON.stringify({ sitekey: key, theme, language: turnstileLang(lang) });
  return c.html(
    `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">` +
      `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}#w{display:flex;justify-content:center;padding-top:2px}</style>` +
      `<script>var CFG=${cfg.replace(/</g, '\\u003c')};function send(m){var s=JSON.stringify(m);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(s);else if(window.parent!==window)window.parent.postMessage(s,'*')}` +
      `function go(){turnstile.render('#w',{sitekey:CFG.sitekey,theme:CFG.theme,language:CFG.language,callback:function(t){send({type:'token',token:t})},'expired-callback':function(){send({type:'expired'})},'error-callback':function(){send({type:'error'})}})}</script>` +
      `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=go&render=explicit" async defer></script></head><body><div id="w"></div></body></html>`,
    200,
    { 'cache-control': 'no-store' },
  );
});

// --- Panou → Setări → Protecție anti-robot (doar proprietarul) ---

export const captchaAdmin = new Hono<AppEnv>();
captchaAdmin.use('/captcha', async (c, next) => {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
});

const view = (s: Settings) => ({ siteKey: s.siteKey, hasSecret: !!s.secretSealed, secretHint: s.secretHint, enforce: s.enforce, savedAt: s.savedAt, lastFailAt: s.lastFailAt });

captchaAdmin.get('/captcha', async (c) => c.json(view(await getSettings(c.env))));

captchaAdmin.put('/captcha', async (c) => {
  const b = await c.req.json<{ siteKey?: string; secret?: string | null; enforce?: boolean }>().catch(() => ({}) as { siteKey?: string; secret?: string | null; enforce?: boolean });
  const s = await getSettings(c.env);
  const next: Settings = { ...s };
  if (typeof b.siteKey === 'string') {
    const k = b.siteKey.trim();
    if (k && !/^[0-9A-Za-z_-]{10,100}$/.test(k)) throw new HttpError(400, 'invalid_site_key');
    next.siteKey = k;
  }
  if (b.secret === null) Object.assign(next, { secretSealed: null, secretHint: '' });
  else if (typeof b.secret === 'string' && b.secret.trim()) {
    const k = b.secret.trim();
    if (!/^[0-9A-Za-z_-]{10,200}$/.test(k)) throw new HttpError(400, 'invalid_secret');
    // Cheia secretă se încearcă la Cloudflare înainte de salvare: o cheie greșită dă „invalid-input-secret”.
    try {
      const r = await siteverify(c.env, k, 'verificare-din-panou');
      if (r['error-codes']?.includes('invalid-input-secret')) throw new HttpError(400, 'captcha_secret_rejected');
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // Cloudflare nu răspunde acum: salvăm oricum.
    }
    Object.assign(next, { secretSealed: await seal(c.env, k), secretHint: k.slice(-4) });
  }
  if (!next.siteKey || !next.secretSealed) next.enforce = false;
  if (typeof b.enforce === 'boolean') {
    if (b.enforce && (!next.siteKey || !next.secretSealed)) throw new HttpError(400, 'captcha_incomplete');
    next.enforce = b.enforce;
  }
  next.savedAt = iso(new Date());
  await setSetting(c.env, KEY, next);
  return c.json(view(next));
});
