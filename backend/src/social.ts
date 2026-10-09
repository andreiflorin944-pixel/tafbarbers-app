import { Hono, type Context, type Next } from 'hono';
import { newId } from './auth';
import { HttpError, type AppEnv, type Env } from './env';
import { iso } from './time';
import { tryLock, unlock } from './db';

// Postări programate pe Facebook, Instagram și TikTok. Adminul își conectează conturile o singură dată (OAuth),
// urcă poze sau un clip, scrie textul, bifează unde pleacă și ora; cron-ul de la 5 minute le publică.
// Rețelele își iau pozele și clipurile de la adresa noastră publică /v1/social/media/:id.

export const GRAPH = 'https://graph.facebook.com/v25.0';
const TIKTOK = 'https://open.tiktokapis.com/v2';
// Doar local, pentru teste: SOCIAL_MOCK_BASE trimite apelurile la un server de probă în loc de Facebook și TikTok.
let graphBase = GRAPH;
let tiktokBase = TIKTOK;
function apiBases(env: Env) {
  graphBase = env.SOCIAL_MOCK_BASE ? `${env.SOCIAL_MOCK_BASE}/graph` : GRAPH;
  tiktokBase = env.SOCIAL_MOCK_BASE ? `${env.SOCIAL_MOCK_BASE}/tiktok` : TIKTOK;
}
const NETWORKS = ['facebook', 'instagram', 'tiktok'] as const;
type Network = (typeof NETWORKS)[number];
const META_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts,business_management,instagram_basic,instagram_content_publish';

export const SOCIAL_IMAGE_MAX = 8_000_000;
export const SOCIAL_VIDEO_MAX = 95_000_000;
const IMAGE_TYPES = ['image/jpeg'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
const CAPTION_MAX = 2200;

type AccountRow = {
  id: string;
  network: Network;
  external_id: string;
  name: string;
  token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  page_id: string | null;
  created_at: string;
};
type MediaRow = { id: string; kind: 'image' | 'video'; mime: string; size: number; storage: 'd1' | 'r2'; created_at: string };
type PostRow = {
  id: string;
  caption: string;
  media: string;
  targets: string;
  scheduled_at: string | null;
  status: PostStatus;
  results: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
type PostStatus = 'draft' | 'scheduled' | 'posting' | 'done' | 'partial' | 'failed';
export type TargetResult = {
  status: 'sending' | 'processing' | 'done' | 'failed';
  at: string;
  url?: string;
  error?: string;
  container?: string; // Instagram: containerul care se procesează
  publishId?: string; // TikTok
};

const parse = <T>(s: string | null | undefined, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};

// --- Criptarea tokenurilor (AES-GCM, cheie din SOCIAL_KEY sau ADMIN_SETUP_KEY) ---

async function key(env: Env, usage: 'enc' | 'mac') {
  const secret = env.SOCIAL_KEY || env.ADMIN_SETUP_KEY;
  if (!secret) throw new HttpError(500, 'social_key_missing');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${usage}:${secret}`));
  return usage === 'enc'
    ? crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
    : crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function seal(env: Env, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env, 'enc'), new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64(out);
}
export async function unseal(env: Env, sealed: string): Promise<string> {
  const u = unb64(sealed);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, await key(env, 'enc'), u.slice(12));
  return new TextDecoder().decode(pt);
}

/** „state” pentru OAuth: cine a pornit conectarea și până când e valabil, semnat ca să nu poată fi falsificat. */
async function signState(env: Env, adminId: string, network: string) {
  const body = `${adminId}.${network}.${Date.now() + 15 * 60_000}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(env, 'mac'), new TextEncoder().encode(body)));
  return `${body}.${b64(sig)}`;
}
async function checkState(env: Env, state: string | undefined, network: string): Promise<string> {
  const parts = (state ?? '').split('.');
  if (parts.length !== 4) throw new HttpError(400, 'bad_state');
  const [adminId, net, exp, sig] = parts;
  const ok = await crypto.subtle.verify('HMAC', await key(env, 'mac'), unb64(sig), new TextEncoder().encode(`${adminId}.${net}.${exp}`));
  if (!ok || net !== network || Number(exp) < Date.now()) throw new HttpError(400, 'bad_state');
  return adminId;
}

const baseUrl = (env: Env, reqUrl: string) => (env.PUBLIC_URL || new URL(reqUrl).origin).replace(/\/$/, '');
const redirectUri = (env: Env, reqUrl: string, network: 'meta' | 'tiktok') => `${baseUrl(env, reqUrl)}/v1/social/${network}/callback`;
export const mediaPublicUrl = (base: string, id: string) => `${base}/v1/social/media/${id}`;

// --- Apeluri către rețele ---

class NetError extends Error {}

async function graph<T>(path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  const body = new URLSearchParams(params);
  const r = await fetch(method === 'GET' ? `${graphBase}${path}?${body}` : `${graphBase}${path}`, method === 'GET' ? {} : { method, body });
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string } } & T;
  if (!r.ok || j.error) throw new NetError(j.error?.error_user_msg || j.error?.message || `Facebook a răspuns ${r.status}`);
  return j;
}

async function tiktok<T>(path: string, token: string, body: unknown): Promise<T> {
  const r = await fetch(`${tiktokBase}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
  if (!r.ok || (j.error?.code && j.error.code !== 'ok')) throw new NetError(j.error?.message || j.error?.code || `TikTok a răspuns ${r.status}`);
  return j.data as T;
}

async function tiktokToken(env: Env, params: Record<string, string>) {
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) throw new HttpError(400, 'tiktok_not_configured');
  const r = await fetch(`${tiktokBase}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, ...params }),
  });
  const j = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    open_id?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!j.access_token) throw new NetError(j.error_description || j.error || `TikTok a răspuns ${r.status}`);
  return j as Required<Pick<typeof j, 'access_token' | 'expires_in' | 'open_id' | 'refresh_token'>>;
}

/** Tokenul TikTok ține 24 de ore; îl reînnoim cu refresh token-ul (valabil un an) când mai are sub o oră. */
async function tiktokAccess(env: Env, acc: AccountRow): Promise<string> {
  if (acc.token_expires_at && new Date(acc.token_expires_at).getTime() - Date.now() > 3_600_000) return unseal(env, acc.token);
  if (!acc.refresh_token) throw new NetError('Contul TikTok trebuie conectat din nou.');
  const t = await tiktokToken(env, { grant_type: 'refresh_token', refresh_token: await unseal(env, acc.refresh_token) });
  await env.DB.prepare('UPDATE social_accounts SET token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?')
    .bind(await seal(env, t.access_token), await seal(env, t.refresh_token), iso(new Date(Date.now() + t.expires_in * 1000)), acc.id)
    .run();
  return t.access_token;
}

async function upsertAccount(env: Env, a: { network: Network; externalId: string; name: string; token: string; refresh?: string; expiresAt?: string | null; pageId?: string | null }) {
  await env.DB.prepare(
    `INSERT INTO social_accounts (id, network, external_id, name, token, refresh_token, token_expires_at, page_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (network, external_id) DO UPDATE SET name = excluded.name, token = excluded.token,
       refresh_token = excluded.refresh_token, token_expires_at = excluded.token_expires_at, page_id = excluded.page_id`,
  )
    .bind(
      newId('sa'),
      a.network,
      a.externalId,
      a.name.slice(0, 120),
      await seal(env, a.token),
      a.refresh ? await seal(env, a.refresh) : null,
      a.expiresAt ?? null,
      a.pageId ?? null,
      iso(new Date()),
    )
    .run();
}

// --- Fișierele (poze și clipuri) ---

async function mediaBytes(env: Env, m: MediaRow): Promise<{ body: ReadableStream | ArrayBuffer; size: number } | null> {
  if (m.storage === 'r2') {
    const o = await env.MEDIA?.get(`social/${m.id}`);
    return o ? { body: o.body, size: o.size } : null;
  }
  const r = await env.DB.prepare('SELECT data FROM media WHERE id = ?').bind(m.id).first<{ data: ArrayBuffer | number[] }>();
  if (!r) return null;
  const buf = r.data instanceof ArrayBuffer ? r.data : new Uint8Array(r.data).buffer;
  return { body: buf as ArrayBuffer, size: buf.byteLength };
}

async function saveSocialMedia(env: Env, mime: string, body: ReadableStream | ArrayBuffer, size: number): Promise<MediaRow> {
  const kind = IMAGE_TYPES.includes(mime) ? 'image' : VIDEO_TYPES.includes(mime) ? 'video' : null;
  if (!kind) throw new HttpError(400, 'unsupported_media');
  if (!size) throw new HttpError(400, 'empty_file');
  if (size > (kind === 'image' ? SOCIAL_IMAGE_MAX : SOCIAL_VIDEO_MAX)) throw new HttpError(400, kind === 'image' ? 'image_too_large' : 'video_too_large');
  const id = newId('sm');
  let storage: 'd1' | 'r2';
  if (env.MEDIA) {
    await env.MEDIA.put(`social/${id}`, body, { httpMetadata: { contentType: mime } });
    storage = 'r2';
  } else {
    // Fără spațiul de fișiere (R2) ținem doar poze mici, în baza de date; clipurile au nevoie de R2.
    if (kind === 'video') throw new HttpError(400, 'video_needs_storage');
    const buf = body instanceof ArrayBuffer ? body : await new Response(body).arrayBuffer();
    if (buf.byteLength > 1_900_000) throw new HttpError(400, 'image_too_large');
    await env.DB.prepare('INSERT INTO media (id, mime, data, size, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, mime, buf, buf.byteLength, iso(new Date())).run();
    storage = 'd1';
  }
  const row: MediaRow = { id, kind, mime, size, storage, created_at: iso(new Date()) };
  await env.DB.prepare('INSERT INTO social_media (id, kind, mime, size, storage, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.kind, row.mime, row.size, row.storage, row.created_at)
    .run();
  return row;
}

// --- Publicarea ---

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ctx = { env: Env; base: string; caption: string; media: MediaRow[] };

async function publishFacebook(x: Ctx, acc: AccountRow): Promise<TargetResult> {
  const token = await unseal(x.env, acc.token);
  const urls = x.media.map((m) => mediaPublicUrl(x.base, m.id));
  if (x.media[0].kind === 'video') {
    const r = await graph<{ id: string }>(`/${acc.external_id}/videos`, { file_url: urls[0], description: x.caption, access_token: token });
    return { status: 'done', at: iso(new Date()), url: `https://www.facebook.com/${acc.external_id}/videos/${r.id}` };
  }
  if (urls.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>(`/${acc.external_id}/photos`, { url: urls[0], caption: x.caption, access_token: token });
    return { status: 'done', at: iso(new Date()), url: `https://www.facebook.com/${r.post_id ?? r.id}` };
  }
  const ids: string[] = [];
  for (const url of urls) ids.push((await graph<{ id: string }>(`/${acc.external_id}/photos`, { url, published: 'false', access_token: token })).id);
  const params: Record<string, string> = { message: x.caption, access_token: token };
  ids.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
  const r = await graph<{ id: string }>(`/${acc.external_id}/feed`, params);
  return { status: 'done', at: iso(new Date()), url: `https://www.facebook.com/${r.id}` };
}

async function igFinish(x: Ctx, acc: AccountRow, token: string, container: string, waitMs: number): Promise<TargetResult> {
  const until = Date.now() + waitMs;
  for (;;) {
    const s = await graph<{ status_code?: string; status?: string }>(`/${container}`, { fields: 'status_code,status', access_token: token }, 'GET');
    if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new NetError(`Instagram nu a putut procesa fișierul (${s.status ?? s.status_code}).`);
    if (Date.now() > until) return { status: 'processing', at: iso(new Date()), container };
    await sleep(4000);
  }
  const p = await graph<{ id: string }>(`/${acc.external_id}/media_publish`, { creation_id: container, access_token: token });
  const link = await graph<{ permalink?: string }>(`/${p.id}`, { fields: 'permalink', access_token: token }, 'GET').catch(() => ({ permalink: undefined }));
  return { status: 'done', at: iso(new Date()), url: link.permalink };
}

async function publishInstagram(x: Ctx, acc: AccountRow, prev: TargetResult | undefined, waitMs: number): Promise<TargetResult> {
  const token = await unseal(x.env, acc.token);
  if (prev?.container) return igFinish(x, acc, token, prev.container, waitMs);
  const urls = x.media.map((m) => mediaPublicUrl(x.base, m.id));
  let container: string;
  if (x.media[0].kind === 'video') {
    container = (await graph<{ id: string }>(`/${acc.external_id}/media`, { media_type: 'REELS', video_url: urls[0], caption: x.caption, share_to_feed: 'true', access_token: token })).id;
  } else if (urls.length === 1) {
    container = (await graph<{ id: string }>(`/${acc.external_id}/media`, { image_url: urls[0], caption: x.caption, access_token: token })).id;
  } else {
    const children: string[] = [];
    for (const url of urls) children.push((await graph<{ id: string }>(`/${acc.external_id}/media`, { image_url: url, is_carousel_item: 'true', access_token: token })).id);
    container = (await graph<{ id: string }>(`/${acc.external_id}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: x.caption, access_token: token })).id;
  }
  return igFinish(x, acc, token, container, waitMs);
}

async function publishTiktok(x: Ctx, acc: AccountRow, prev: TargetResult | undefined): Promise<TargetResult> {
  const token = await tiktokAccess(x.env, acc);
  if (prev?.publishId) {
    const s = await tiktok<{ status?: string; fail_reason?: string }>('/post/publish/status/fetch/', token, { publish_id: prev.publishId });
    if (s.status === 'PUBLISH_COMPLETE' || s.status === 'SEND_TO_USER_INBOX') return { status: 'done', at: iso(new Date()), publishId: prev.publishId };
    if (s.status === 'FAILED') throw new NetError(`TikTok a refuzat clipul (${s.fail_reason ?? 'fără motiv'}).`);
    return { ...prev, status: 'processing' };
  }
  const video = x.media[0];
  if (video?.kind !== 'video') throw new NetError('Pe TikTok se pot posta doar clipuri.');
  const file = await mediaBytes(x.env, video);
  if (!file) throw new NetError('Clipul nu mai există.');
  // Contul nostru de dezvoltator TikTok, până la aprobare, are voie să posteze doar privat („SELF_ONLY”).
  const info = await tiktok<{ privacy_level_options?: string[] }>('/post/publish/creator_info/query/', token, {});
  const opts = info.privacy_level_options ?? ['SELF_ONLY'];
  const privacy = opts.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : opts[0];
  // Bucăți: un singur fișier dacă are sub 64 MB; altfel bucăți de 20 MB, ultima ia și restul.
  const single = file.size <= 64_000_000;
  const chunk = single ? file.size : 20_000_000;
  const count = single ? 1 : Math.floor(file.size / chunk);
  const init = await tiktok<{ publish_id: string; upload_url: string }>('/post/publish/video/init/', token, {
    post_info: { title: x.caption.slice(0, CAPTION_MAX), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
    source_info: { source: 'FILE_UPLOAD', video_size: file.size, chunk_size: chunk, total_chunk_count: count },
  });
  const bytes = new Uint8Array(file.body instanceof ArrayBuffer ? file.body : await new Response(file.body).arrayBuffer());
  for (let i = 0; i < count; i++) {
    const start = i * chunk;
    const end = i === count - 1 ? file.size : start + chunk;
    const r = await fetch(init.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': video.mime, 'Content-Range': `bytes ${start}-${end - 1}/${file.size}`, 'Content-Length': String(end - start) },
      body: bytes.slice(start, end),
    });
    if (!r.ok) throw new NetError(`Urcarea clipului pe TikTok a eșuat (${r.status}).`);
  }
  return { status: 'processing', at: iso(new Date()), publishId: init.publish_id };
}

function overall(targets: string[], results: Record<string, TargetResult>): PostStatus {
  const st = targets.map((t) => results[t]?.status);
  if (st.some((s) => !s || s === 'sending' || s === 'processing')) return 'posting';
  if (st.every((s) => s === 'done')) return 'done';
  if (st.every((s) => s === 'failed')) return 'failed';
  return 'partial';
}

/**
 * Publică (sau continuă) o postare. Fiecare cont se marchează „sending” înainte de apel, ca o rulare
 * suprapusă să nu posteze de două ori; un „sending” rămas agățat se trece la eșuat, nu se reia.
 */
export async function publishPost(env: Env, id: string, base: string, waitMs = 20_000) {
  apiBases(env);
  // O singură publicare odată pe postare: două rulări suprapuse (cron + „Publică acum”) ar posta de două ori.
  if (!(await tryLock(env, `social:${id}`, 5 * 60_000))) return;
  try {
    await publishLocked(env, id, base, waitMs);
  } finally {
    await unlock(env, `social:${id}`);
  }
}

async function publishLocked(env: Env, id: string, base: string, waitMs: number) {
  const p = await env.DB.prepare('SELECT * FROM social_posts WHERE id = ?').bind(id).first<PostRow>();
  if (!p || p.status !== 'posting') return;
  const targets = parse<string[]>(p.targets, []);
  const mediaIds = parse<string[]>(p.media, []);
  const results = parse<Record<string, TargetResult>>(p.results, {});
  const media = mediaIds.length
    ? (await env.DB.prepare(`SELECT * FROM social_media WHERE id IN (${mediaIds.map(() => '?').join(',')})`).bind(...mediaIds).all<MediaRow>()).results.sort(
        (a, b) => mediaIds.indexOf(a.id) - mediaIds.indexOf(b.id),
      )
    : [];
  const accounts = new Map(
    (await env.DB.prepare(`SELECT * FROM social_accounts WHERE id IN (${targets.map(() => '?').join(',') || "''"})`).bind(...targets).all<AccountRow>()).results.map((a) => [a.id, a]),
  );
  const x: Ctx = { env, base, caption: p.caption, media };
  const save = () =>
    env.DB.prepare('UPDATE social_posts SET results = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(results), overall(targets, results), iso(new Date()), id)
      .run();

  for (const t of targets) {
    const prev = results[t];
    if (prev?.status === 'done' || prev?.status === 'failed') continue;
    if (prev?.status === 'sending') {
      if (Date.now() - new Date(prev.at).getTime() > 10 * 60_000)
        results[t] = { status: 'failed', at: iso(new Date()), error: 'Postarea s-a întrerupt. Verifică pe pagină dacă a apărut.' };
      continue;
    }
    if (prev?.status === 'processing' && Date.now() - new Date(prev.at).getTime() > 6 * 3_600_000) {
      results[t] = { status: 'failed', at: iso(new Date()), error: 'Rețeaua nu a terminat de procesat clipul în 6 ore.' };
      continue;
    }
    const acc = accounts.get(t);
    if (!acc) {
      results[t] = { status: 'failed', at: iso(new Date()), error: 'Contul a fost deconectat.' };
      continue;
    }
    if (!media.length) {
      results[t] = { status: 'failed', at: iso(new Date()), error: 'Postarea nu are nicio poză sau clip.' };
      continue;
    }
    if (!prev) {
      results[t] = { status: 'sending', at: iso(new Date()) };
      await save();
    }
    try {
      const r =
        acc.network === 'facebook'
          ? await publishFacebook(x, acc)
          : acc.network === 'instagram'
            ? await publishInstagram(x, acc, prev, waitMs)
            : await publishTiktok(x, acc, prev);
      // „processing” păstrează ora primei încercări, ca limita de 6 ore să se socotească de la început.
      results[t] = r.status === 'processing' && prev?.status === 'processing' ? { ...r, at: prev.at } : r;
    } catch (e) {
      results[t] = { status: 'failed', at: iso(new Date()), error: e instanceof NetError || e instanceof HttpError ? e.message : 'Eroare neașteptată.' };
      if (!(e instanceof NetError)) console.error('social publish', t, e);
    }
    await save();
  }
  await save();
}

/** Din cron: pornește postările ajunse la oră și continuă clipurile care încă se procesează. */
export async function runSocial(env: Env, now: Date) {
  if (!env.PUBLIC_URL) return; // rețelele au nevoie de adresa publică pentru poze și clipuri
  const base = env.PUBLIC_URL.replace(/\/$/, '');
  const due = await env.DB.prepare(`SELECT id FROM social_posts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 10`)
    .bind(iso(now))
    .all<{ id: string }>();
  for (const p of due.results) {
    const r = await env.DB.prepare(`UPDATE social_posts SET status = 'posting', updated_at = ? WHERE id = ? AND status = 'scheduled'`).bind(iso(now), p.id).run();
    if (r.meta.changes) await publishPost(env, p.id, base);
  }
  const pending = await env.DB.prepare(`SELECT id FROM social_posts WHERE status = 'posting' AND updated_at <= ? LIMIT 10`)
    .bind(iso(new Date(now.getTime() - 60_000)))
    .all<{ id: string }>();
  for (const p of pending.results) await publishPost(env, p.id, base, 10_000);
}

// --- Rutele publice: întoarcerea din OAuth și fișierele pentru rețele ---

export const socialPublic = new Hono<AppEnv>();

const backToPanel = (c: Context<AppEnv>, q: string) => c.redirect(`${baseUrl(c.env, c.req.url)}/#/social?${q}`);

socialPublic.get('/social/meta/callback', async (c) => {
  const { code, state, error } = c.req.query();
  if (error || !code) return backToPanel(c, 'error=cancelled');
  apiBases(c.env);
  try {
    await checkState(c.env, state, 'meta');
    if (!c.env.META_APP_ID || !c.env.META_APP_SECRET) throw new HttpError(400, 'meta_not_configured');
    const app = { client_id: c.env.META_APP_ID, client_secret: c.env.META_APP_SECRET };
    const short = await graph<{ access_token: string }>('/oauth/access_token', { ...app, redirect_uri: redirectUri(c.env, c.req.url, 'meta'), code }, 'GET');
    // Tokenul de lungă durată al omului dă tokenuri de pagină care nu expiră.
    const long = await graph<{ access_token: string }>('/oauth/access_token', { ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token }, 'GET');
    const pages = await graph<{ data: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }> }>(
      '/me/accounts',
      { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50', access_token: long.access_token },
      'GET',
    );
    if (!pages.data.length) return backToPanel(c, 'error=no_pages');
    let ig = 0;
    for (const pg of pages.data) {
      await upsertAccount(c.env, { network: 'facebook', externalId: pg.id, name: pg.name, token: pg.access_token });
      if (pg.instagram_business_account) {
        ig++;
        await upsertAccount(c.env, {
          network: 'instagram',
          externalId: pg.instagram_business_account.id,
          name: pg.instagram_business_account.username ? `@${pg.instagram_business_account.username}` : pg.name,
          token: pg.access_token,
          pageId: pg.id,
        });
      }
    }
    return backToPanel(c, `connected=meta&pages=${pages.data.length}&ig=${ig}`);
  } catch (e) {
    console.error('meta callback', e);
    return backToPanel(c, `error=${encodeURIComponent(e instanceof HttpError ? e.code : 'meta_failed')}`);
  }
});

socialPublic.get('/social/tiktok/callback', async (c) => {
  const { code, state, error } = c.req.query();
  if (error || !code) return backToPanel(c, 'error=cancelled');
  apiBases(c.env);
  try {
    await checkState(c.env, state, 'tiktok');
    const t = await tiktokToken(c.env, { code, grant_type: 'authorization_code', redirect_uri: redirectUri(c.env, c.req.url, 'tiktok') });
    let name = 'TikTok';
    try {
      const r = await fetch(`${tiktokBase}/user/info/?fields=open_id,display_name`, { headers: { Authorization: `Bearer ${t.access_token}` } });
      const j = (await r.json()) as { data?: { user?: { display_name?: string } } };
      name = j.data?.user?.display_name || name;
    } catch {
      // numele e doar pentru afișare
    }
    await upsertAccount(c.env, {
      network: 'tiktok',
      externalId: t.open_id,
      name,
      token: t.access_token,
      refresh: t.refresh_token,
      expiresAt: iso(new Date(Date.now() + t.expires_in * 1000)),
    });
    return backToPanel(c, 'connected=tiktok');
  } catch (e) {
    console.error('tiktok callback', e);
    return backToPanel(c, `error=${encodeURIComponent(e instanceof HttpError ? e.code : 'tiktok_failed')}`);
  }
});

// Id-urile sunt aleatorii și nu se pot ghici; rețelele descarcă de aici pozele și clipurile.
socialPublic.get('/social/media/:id', async (c) => {
  const m = await c.env.DB.prepare('SELECT * FROM social_media WHERE id = ?').bind(c.req.param('id')).first<MediaRow>();
  if (!m) throw new HttpError(404, 'not_found');
  const headers: Record<string, string> = { 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=86400', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
  if (m.storage === 'r2' && c.env.MEDIA) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(c.req.header('Range') ?? '');
    if (range) {
      const offset = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), m.size - 1) : m.size - 1;
      if (offset >= m.size) return c.body(null, 416, { 'Content-Range': `bytes */${m.size}` });
      const o = await c.env.MEDIA.get(`social/${m.id}`, { range: { offset, length: end - offset + 1 } });
      if (!o) throw new HttpError(404, 'not_found');
      return c.body(o.body, 206, { ...headers, 'Content-Range': `bytes ${offset}-${end}/${m.size}`, 'Content-Length': String(end - offset + 1) });
    }
  }
  const f = await mediaBytes(c.env, m);
  if (!f) throw new HttpError(404, 'not_found');
  return c.body(f.body as ArrayBuffer, 200, { ...headers, 'Content-Length': String(f.size) });
});

// --- Rutele din panou (doar proprietarul) ---

export const socialAdmin = new Hono<AppEnv>();

async function ownerOnly(c: Context<AppEnv>, next: Next) {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
}
socialAdmin.use('/social/*', ownerOnly);

const account = (a: AccountRow) => ({ id: a.id, network: a.network, name: a.name, createdAt: a.created_at });

socialAdmin.get('/social/status', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM social_accounts ORDER BY network, name').all<AccountRow>();
  return c.json({
    accounts: r.results.map(account),
    meta: !!(c.env.META_APP_ID && c.env.META_APP_SECRET),
    tiktok: !!(c.env.TIKTOK_CLIENT_KEY && c.env.TIKTOK_CLIENT_SECRET),
    storage: !!c.env.MEDIA,
    publicUrl: !!c.env.PUBLIC_URL,
    redirectMeta: redirectUri(c.env, c.req.url, 'meta'),
    redirectTiktok: redirectUri(c.env, c.req.url, 'tiktok'),
  });
});

socialAdmin.get('/social/connect/:network', async (c) => {
  const net = c.req.param('network');
  const state = await signState(c.env, c.get('admin').adminId, net);
  if (net === 'meta') {
    if (!c.env.META_APP_ID || !c.env.META_APP_SECRET) throw new HttpError(400, 'meta_not_configured');
    const q = new URLSearchParams({ client_id: c.env.META_APP_ID, redirect_uri: redirectUri(c.env, c.req.url, 'meta'), state, scope: META_SCOPES, response_type: 'code' });
    return c.json({ url: `https://www.facebook.com/v25.0/dialog/oauth?${q}` });
  }
  if (net === 'tiktok') {
    if (!c.env.TIKTOK_CLIENT_KEY || !c.env.TIKTOK_CLIENT_SECRET) throw new HttpError(400, 'tiktok_not_configured');
    const q = new URLSearchParams({ client_key: c.env.TIKTOK_CLIENT_KEY, redirect_uri: redirectUri(c.env, c.req.url, 'tiktok'), state, scope: 'user.info.basic,video.publish', response_type: 'code' });
    return c.json({ url: `https://www.tiktok.com/v2/auth/authorize/?${q}` });
  }
  throw new HttpError(404, 'not_found');
});

socialAdmin.delete('/social/accounts/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM social_accounts WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

socialAdmin.post('/social/media', async (c) => {
  const mime = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const len = Number(c.req.header('Content-Length') ?? 0);
  let m: MediaRow;
  if (c.env.MEDIA && len && c.req.raw.body) {
    // Cu R2 trimitem fluxul direct, fără să ținem clipul în memorie; R2 vrea lungimea știută dinainte.
    const fl = new FixedLengthStream(len);
    c.req.raw.body.pipeTo(fl.writable).catch(() => undefined);
    m = await saveSocialMedia(c.env, mime, fl.readable, len);
  } else {
    const buf = await c.req.arrayBuffer();
    m = await saveSocialMedia(c.env, mime, buf, buf.byteLength);
  }
  return c.json({ id: m.id, kind: m.kind, url: mediaPublicUrl('', m.id) }, 201);
});

type PostInput = { caption?: unknown; media?: unknown; targets?: unknown; scheduledAt?: unknown; draft?: unknown; now?: unknown };

async function validPost(env: Env, b: PostInput) {
  const caption = typeof b.caption === 'string' ? b.caption.trim().slice(0, CAPTION_MAX) : '';
  const media = Array.isArray(b.media) ? [...new Set(b.media.filter((x): x is string => typeof x === 'string'))].slice(0, 10) : [];
  const targets = Array.isArray(b.targets) ? [...new Set(b.targets.filter((x): x is string => typeof x === 'string'))] : [];
  const draft = b.draft === true;
  const rows = media.length
    ? (await env.DB.prepare(`SELECT * FROM social_media WHERE id IN (${media.map(() => '?').join(',')})`).bind(...media).all<MediaRow>()).results
    : [];
  if (rows.length !== media.length) throw new HttpError(400, 'media_missing');
  const videos = rows.filter((m) => m.kind === 'video').length;
  if (videos && rows.length > 1) throw new HttpError(400, 'one_video_only');
  const accs = targets.length
    ? (await env.DB.prepare(`SELECT * FROM social_accounts WHERE id IN (${targets.map(() => '?').join(',')})`).bind(...targets).all<AccountRow>()).results
    : [];
  if (accs.length !== targets.length) throw new HttpError(400, 'account_missing');
  let scheduledAt: string | null = null;
  if (b.now !== true && typeof b.scheduledAt === 'string' && b.scheduledAt) {
    const d = new Date(b.scheduledAt);
    if (isNaN(d.getTime())) throw new HttpError(400, 'invalid_date');
    scheduledAt = iso(d);
  }
  if (!draft) {
    if (!rows.length) throw new HttpError(400, 'media_required');
    if (!targets.length) throw new HttpError(400, 'targets_required');
    if (accs.some((a) => a.network === 'tiktok') && !videos) throw new HttpError(400, 'tiktok_video_only');
    if (b.now !== true && !scheduledAt) throw new HttpError(400, 'invalid_date');
    if (!env.PUBLIC_URL) throw new HttpError(400, 'public_url_missing');
  }
  return { caption, media, targets, scheduledAt: b.now === true ? iso(new Date()) : scheduledAt, draft, now: b.now === true };
}

async function postJson(env: Env, p: PostRow) {
  const mediaIds = parse<string[]>(p.media, []);
  const media = mediaIds.length
    ? (await env.DB.prepare(`SELECT id, kind FROM social_media WHERE id IN (${mediaIds.map(() => '?').join(',')})`).bind(...mediaIds).all<{ id: string; kind: string }>()).results
    : [];
  return {
    id: p.id,
    caption: p.caption,
    media: mediaIds.map((id) => ({ id, kind: media.find((m) => m.id === id)?.kind ?? 'image', url: mediaPublicUrl('', id) })),
    targets: parse<string[]>(p.targets, []),
    scheduledAt: p.scheduled_at,
    status: p.status,
    results: parse<Record<string, TargetResult>>(p.results, {}),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

socialAdmin.get('/social/posts', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT * FROM social_posts ORDER BY CASE WHEN status IN ('draft', 'scheduled', 'posting') THEN 0 ELSE 1 END, coalesce(scheduled_at, created_at) DESC LIMIT 100`,
  ).all<PostRow>();
  return c.json(await Promise.all(r.results.map((p) => postJson(c.env, p))));
});

socialAdmin.post('/social/posts', async (c) => {
  const v = await validPost(c.env, await c.req.json<PostInput>());
  const id = newId('sp');
  const now = iso(new Date());
  await c.env.DB.prepare(
    'INSERT INTO social_posts (id, caption, media, targets, scheduled_at, status, results, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, v.caption, JSON.stringify(v.media), JSON.stringify(v.targets), v.scheduledAt, v.draft ? 'draft' : v.now ? 'posting' : 'scheduled', '{}', c.get('admin').adminId, now, now)
    .run();
  if (v.now) c.executionCtx.waitUntil(publishPost(c.env, id, c.env.PUBLIC_URL!.replace(/\/$/, '')));
  const p = await c.env.DB.prepare('SELECT * FROM social_posts WHERE id = ?').bind(id).first<PostRow>();
  return c.json(await postJson(c.env, p!), 201);
});

socialAdmin.patch('/social/posts/:id', async (c) => {
  const id = c.req.param('id');
  const cur = await c.env.DB.prepare('SELECT * FROM social_posts WHERE id = ?').bind(id).first<PostRow>();
  if (!cur) throw new HttpError(404, 'not_found');
  if (cur.status !== 'draft' && cur.status !== 'scheduled') throw new HttpError(409, 'post_already_sent');
  const v = await validPost(c.env, await c.req.json<PostInput>());
  const r = await c.env.DB.prepare(
    `UPDATE social_posts SET caption = ?, media = ?, targets = ?, scheduled_at = ?, status = ?, updated_at = ? WHERE id = ? AND status IN ('draft', 'scheduled')`,
  )
    .bind(v.caption, JSON.stringify(v.media), JSON.stringify(v.targets), v.scheduledAt, v.draft ? 'draft' : v.now ? 'posting' : 'scheduled', iso(new Date()), id)
    .run();
  if (!r.meta.changes) throw new HttpError(409, 'post_already_sent');
  if (v.now) c.executionCtx.waitUntil(publishPost(c.env, id, c.env.PUBLIC_URL!.replace(/\/$/, '')));
  const p = await c.env.DB.prepare('SELECT * FROM social_posts WHERE id = ?').bind(id).first<PostRow>();
  return c.json(await postJson(c.env, p!));
});

/** Șterge postarea din listă (nu și de pe rețele, unde a apărut deja). Pozele și clipurile ei se șterg și ele. */
socialAdmin.delete('/social/posts/:id', async (c) => {
  const id = c.req.param('id');
  const p = await c.env.DB.prepare('SELECT * FROM social_posts WHERE id = ?').bind(id).first<PostRow>();
  if (!p) throw new HttpError(404, 'not_found');
  if (p.status === 'posting') throw new HttpError(409, 'post_in_progress');
  await c.env.DB.prepare('DELETE FROM social_posts WHERE id = ?').bind(id).run();
  for (const m of parse<string[]>(p.media, [])) await dropMediaIfUnused(c.env, m);
  return c.json({ ok: true });
});

async function dropMediaIfUnused(env: Env, id: string) {
  const used = await env.DB.prepare(`SELECT 1 FROM social_posts, json_each(social_posts.media) j WHERE j.value = ? LIMIT 1`).bind(id).first();
  if (used) return;
  const m = await env.DB.prepare('SELECT storage FROM social_media WHERE id = ?').bind(id).first<{ storage: string }>();
  if (!m) return;
  if (m.storage === 'r2') await env.MEDIA?.delete(`social/${id}`);
  else await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM social_media WHERE id = ?').bind(id).run();
}

export const SOCIAL_NETWORKS = NETWORKS;
