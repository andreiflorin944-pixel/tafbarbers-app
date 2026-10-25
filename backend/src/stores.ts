import { Hono, type Context, type Next } from 'hono';
import { newId } from './auth';
import { getSetting, setSetting } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { seal, unseal } from './social';
import { iso } from './time';

// Panou → Aplicații: starea aplicației în App Store și Google Play și butonul „Actualizați aplicația”.
// Construirea și trimiterea le face EAS (Expo), prin fișierele din .eas/workflows; la iOS, după ce Apple primește
// versiunea, serverul o trimite singur la verificare (App Store Connect API), din cron.
// Cheile (Expo, Apple, Google) le pune proprietarul în panou; se păstrează criptate în setări și nu se mai arată niciodată.

const IOS_APP_ID = '6826855504';
const ANDROID_PACKAGE = 'ro.tafbarbers.app';
const EXPO_PROJECT_ID = '9d5c78da-8145-45f1-bc49-4a055bebea7c';
const STORE_WORKFLOW = 'actualizare-aplicatie.yml';
const OTA_WORKFLOW = 'actualizare-rapida.yml';
const GIT_REF = 'main';

export const STORE_LINKS = {
  appStore: `https://apps.apple.com/app/id${IOS_APP_ID}`,
  play: `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`,
};

type Creds = {
  expo?: { token: string; savedAt: string };
  apple?: { keyId: string; issuerId: string; p8: string; savedAt: string };
  google?: { email: string; json: string; savedAt: string };
};
const getCreds = (env: Env) => getSetting<Creds>(env, 'store_creds', {});

/** Eroare de la Apple / Google / Expo, cu textul lor (afișat în panou). */
class StoreError extends Error {}

const bases = (env: Env) => {
  const m = env.STORES_MOCK_BASE;
  return {
    apple: m ? `${m}/apple` : 'https://api.appstoreconnect.apple.com',
    play: m ? `${m}/play` : 'https://androidpublisher.googleapis.com',
    expo: m ? `${m}/expo` : 'https://api.expo.dev',
    token: m ? `${m}/token` : null,
  };
};

// --- JWT (Apple ES256, Google RS256) ---

const b64url = (u: Uint8Array) => {
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64json = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const pemToDer = (pem: string) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));

async function signJwt(alg: 'ES256' | 'RS256', pem: string, header: Record<string, string>, payload: Record<string, unknown>) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem),
    alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const input = `${b64json({ alg, typ: 'JWT', ...header })}.${b64json(payload)}`;
  const sig = await crypto.subtle.sign(alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

async function call<T>(url: string, init: { method?: string; token?: string; body?: unknown; form?: URLSearchParams }, who: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.token && { Authorization: `Bearer ${init.token}` }),
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(init.form && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new StoreError(`${who}: nu răspunde`);
  }
  if (r.status === 204) return {} as T;
  const j = (await r.json().catch(() => null)) as Record<string, any> | null;
  if (!r.ok) {
    const detail = j?.errors?.[0]?.detail ?? j?.errors?.[0]?.title ?? j?.errors?.[0]?.message ?? j?.error?.message ?? j?.error_description ?? j?.error ?? `HTTP ${r.status}`;
    throw new StoreError(`${who}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return j as T;
}

// --- Apple (App Store Connect API) ---

type AscVersion = { id: string; attributes: { versionString: string; appStoreState?: string; appVersionState?: string; createdDate?: string } };

async function appleToken(env: Env, creds: Creds) {
  const a = creds.apple;
  if (!a) throw new StoreError('Apple nu e conectat');
  const now = Math.floor(Date.now() / 1000);
  return signJwt('ES256', await unseal(env, a.p8), { kid: a.keyId }, { iss: a.issuerId, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' });
}
const apple = <T>(env: Env, token: string, path: string, method = 'GET', body?: unknown) => call<T>(`${bases(env).apple}${path}`, { method, token, body }, 'Apple');

const versionState = (v: AscVersion) => v.attributes.appVersionState ?? v.attributes.appStoreState ?? '';
const LIVE = ['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'];
const IN_REVIEW = ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE', 'ACCEPTED', 'PROCESSING_FOR_APP_STORE', 'PROCESSING_FOR_DISTRIBUTION', 'WAITING_FOR_EXPORT_COMPLIANCE'];
const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];

const IOS_STATES: Record<string, [string, Tone]> = {
  READY_FOR_SALE: ['Publicat', 'ok'],
  READY_FOR_DISTRIBUTION: ['Publicat', 'ok'],
  WAITING_FOR_REVIEW: ['Așteaptă verificarea Apple', 'wait'],
  IN_REVIEW: ['În verificare la Apple', 'wait'],
  PENDING_DEVELOPER_RELEASE: ['Aprobat, așteaptă să-l lansezi', 'wait'],
  PENDING_APPLE_RELEASE: ['Aprobat, se lansează', 'wait'],
  ACCEPTED: ['Aprobat', 'ok'],
  PROCESSING_FOR_APP_STORE: ['Aprobat, se publică', 'wait'],
  PROCESSING_FOR_DISTRIBUTION: ['Aprobat, se publică', 'wait'],
  PREPARE_FOR_SUBMISSION: ['În pregătire', 'muted'],
  WAITING_FOR_EXPORT_COMPLIANCE: ['Așteaptă răspunsul despre criptare', 'bad'],
  REJECTED: ['Respins de Apple', 'bad'],
  METADATA_REJECTED: ['Respins de Apple (fișa din magazin)', 'bad'],
  INVALID_BINARY: ['Fișier respins de Apple', 'bad'],
  DEVELOPER_REJECTED: ['Retras din verificare', 'muted'],
  REPLACED_WITH_NEW_VERSION: ['Înlocuit de o versiune nouă', 'muted'],
  REMOVED_FROM_SALE: ['Scos din magazin', 'bad'],
};
type Tone = 'ok' | 'wait' | 'bad' | 'muted';
type StoreVersion = { version: string; state: string; label: string; tone: Tone };
type StoreStatus = { ok: true; name: string; description: string; versions: StoreVersion[]; live: string | null; note?: string } | { ok: false; error: string };

/** Comparație de versiuni „1.2.3”. */
export const cmpVersion = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

async function iosVersions(env: Env, token: string) {
  const r = await apple<{ data: AscVersion[] }>(env, token, `/v1/apps/${IOS_APP_ID}/appStoreVersions?filter[platform]=IOS&limit=10&fields[appStoreVersions]=versionString,appStoreState,appVersionState,createdDate`);
  return r.data.sort((a, b) => (b.attributes.createdDate ?? '').localeCompare(a.attributes.createdDate ?? '') || cmpVersion(b.attributes.versionString, a.attributes.versionString));
}

async function iosStatus(env: Env, creds: Creds): Promise<StoreStatus> {
  try {
    const t = await appleToken(env, creds);
    const [app, versions] = await Promise.all([apple<{ data: { attributes: { name: string } } }>(env, t, `/v1/apps/${IOS_APP_ID}?fields[apps]=name,bundleId`), iosVersions(env, t)]);
    let description = '';
    if (versions[0]) {
      const locs = await apple<{ data: Array<{ attributes: { locale: string; description?: string } }> }>(
        env,
        t,
        `/v1/appStoreVersions/${versions[0].id}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale,description&limit=20`,
      );
      const ro = locs.data.find((l) => l.attributes.locale.startsWith('ro')) ?? locs.data[0];
      description = ro?.attributes.description ?? '';
    }
    const live = versions.find((v) => LIVE.includes(versionState(v)));
    return {
      ok: true,
      name: app.data.attributes.name,
      description,
      live: live?.attributes.versionString ?? null,
      versions: versions.slice(0, 3).map((v) => {
        const s = versionState(v);
        const [label, tone] = IOS_STATES[s] ?? [s, 'muted' as Tone];
        return { version: v.attributes.versionString, state: s, label, tone };
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof StoreError ? e.message : 'Apple: nu am putut citi starea' };
  }
}

/**
 * După ce EAS a urcat versiunea la Apple: o leagă de versiunea din App Store, pune „Ce e nou” și o trimite la verificare.
 * Întoarce un text dacă trebuie așteptat (Apple încă procesează fișierul), null când e trimisă.
 */
async function submitIosForReview(env: Env, creds: Creds, version: string, whatsNew: string): Promise<string | null> {
  const t = await appleToken(env, creds);
  const builds = await apple<{ data: Array<{ id: string; attributes: { processingState: string; version: string } }> }>(
    env,
    t,
    `/v1/builds?filter[app]=${IOS_APP_ID}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&sort=-uploadedDate&limit=1&fields[builds]=processingState,version`,
  );
  const build = builds.data[0];
  if (!build || build.attributes.processingState === 'PROCESSING') return 'Apple procesează versiunea nouă (de obicei 10–30 de minute)';
  if (build.attributes.processingState !== 'VALID') throw new StoreError(`Apple a respins fișierul (${build.attributes.processingState})`);

  const versions = await iosVersions(env, t);
  let ver = versions.find((v) => v.attributes.versionString === version);
  if (ver && IN_REVIEW.includes(versionState(ver))) return null;
  if (!ver) {
    const editable = versions.find((v) => EDITABLE.includes(versionState(v)));
    if (editable) {
      await apple(env, t, `/v1/appStoreVersions/${editable.id}`, 'PATCH', { data: { type: 'appStoreVersions', id: editable.id, attributes: { versionString: version } } });
      ver = editable;
    } else {
      const created = await apple<{ data: AscVersion }>(env, t, '/v1/appStoreVersions', 'POST', {
        data: {
          type: 'appStoreVersions',
          attributes: { platform: 'IOS', versionString: version, releaseType: 'AFTER_APPROVAL' },
          relationships: { app: { data: { type: 'apps', id: IOS_APP_ID } } },
        },
      });
      ver = created.data;
    }
  }
  await apple(env, t, `/v1/appStoreVersions/${ver.id}/relationships/build`, 'PATCH', { data: { type: 'builds', id: build.id } });

  // „Ce e nou” se cere doar la actualizări (prima versiune din magazin nu are câmpul).
  if (versions.some((v) => LIVE.includes(versionState(v)) || versionState(v) === 'REPLACED_WITH_NEW_VERSION')) {
    const locs = await apple<{ data: Array<{ id: string; attributes: { locale: string } }> }>(env, t, `/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations?limit=20`);
    for (const l of locs.data) {
      const text = whatsNew.trim() || (l.attributes.locale.startsWith('ro') ? 'Îmbunătățiri și corecturi.' : 'Improvements and bug fixes.');
      await apple(env, t, `/v1/appStoreVersionLocalizations/${l.id}`, 'PATCH', { data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: { whatsNew: text } } });
    }
  }

  const open = await apple<{ data: Array<{ id: string }> }>(env, t, `/v1/reviewSubmissions?filter[app]=${IOS_APP_ID}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=1`);
  const sub =
    open.data[0] ??
    (
      await apple<{ data: { id: string } }>(env, t, '/v1/reviewSubmissions', 'POST', {
        data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: IOS_APP_ID } } } },
      })
    ).data;
  try {
    await apple(env, t, '/v1/reviewSubmissionItems', 'POST', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } },
      },
    });
  } catch (e) {
    // Versiunea e deja în această trimitere (o rulare anterioară a apucat s-o adauge).
    if (!(e instanceof StoreError) || !/already|exist/i.test(e.message)) throw e;
  }
  await apple(env, t, `/v1/reviewSubmissions/${sub.id}`, 'PATCH', { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } });
  return null;
}

// --- Google Play (Android Publisher API) ---

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

async function googleToken(env: Env, creds: Creds) {
  if (!creds.google) throw new StoreError('Google nu e conectat');
  const sa = JSON.parse(await unseal(env, creds.google.json)) as ServiceAccount;
  const uri = bases(env).token ?? sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt('RS256', sa.private_key, {}, { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: sa.token_uri ?? uri, iat: now, exp: now + 3600 });
  const r = await call<{ access_token: string }>(uri, { method: 'POST', form: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) }, 'Google');
  return r.access_token;
}

const TRACKS: Record<string, string> = { production: 'Producție', beta: 'Testare deschisă', alpha: 'Testare închisă', internal: 'Testare internă' };
const PLAY_STATES: Record<string, [string, Tone]> = {
  completed: ['Lansată', 'ok'],
  inProgress: ['Lansare treptată', 'wait'],
  draft: ['Ciornă', 'muted'],
  halted: ['Lansare oprită', 'bad'],
};

async function androidStatus(env: Env, creds: Creds): Promise<StoreStatus> {
  try {
    const t = await googleToken(env, creds);
    const root = `${bases(env).play}/androidpublisher/v3/applications/${ANDROID_PACKAGE}/edits`;
    // O „editare” doar pentru citit; se șterge la final, fără să schimbe nimic în Play Console.
    const edit = await call<{ id: string }>(root, { method: 'POST', token: t, body: {} }, 'Google');
    try {
      const [tracks, listings] = await Promise.all([
        call<{ tracks?: Array<{ track: string; releases?: Array<{ name?: string; versionCodes?: string[]; status: string; userFraction?: number }> }> }>(`${root}/${edit.id}/tracks`, { token: t }, 'Google'),
        call<{ listings?: Array<{ language: string; title?: string; fullDescription?: string }> }>(`${root}/${edit.id}/listings`, { token: t }, 'Google'),
      ]);
      const listing = listings.listings?.find((l) => l.language.startsWith('ro')) ?? listings.listings?.[0];
      const order = ['production', 'beta', 'alpha', 'internal'];
      const versions: StoreVersion[] = [];
      for (const tr of (tracks.tracks ?? []).sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track))) {
        for (const rel of tr.releases ?? []) {
          const [label, tone] = PLAY_STATES[rel.status] ?? [rel.status, 'muted' as Tone];
          const pct = rel.status === 'inProgress' && rel.userFraction ? ` (${Math.round(rel.userFraction * 100)}%)` : '';
          versions.push({ version: (rel.name ?? '').replace(/^\d+\s*\((.+)\)$/, '$1') || (rel.versionCodes ?? []).join(', '), state: `${tr.track}:${rel.status}`, label: `${TRACKS[tr.track] ?? tr.track}: ${label}${pct}`, tone });
        }
      }
      const live = versions.find((v) => v.state === 'production:completed');
      return {
        ok: true,
        name: listing?.title ?? 'TAF Barbers',
        description: listing?.fullDescription ?? '',
        live: live?.version ?? null,
        versions: versions.slice(0, 3),
        note: 'Google nu arată prin API dacă o versiune e încă în verificare; o versiune „Lansată” apare la clienți după aprobarea Google.',
      };
    } finally {
      await call(`${root}/${edit.id}`, { method: 'DELETE', token: t }, 'Google').catch(() => null);
    }
  } catch (e) {
    return { ok: false, error: e instanceof StoreError ? e.message : 'Google: nu am putut citi starea' };
  }
}

// --- Expo (EAS Workflows) ---

type Run = { id: string; status: string; url: string; jobs: Array<{ key: string; name: string; status: string; errors?: Array<{ message?: string; title?: string }> }> };

async function expoToken(env: Env, creds: Creds) {
  if (!creds.expo) throw new HttpError(400, 'expo_not_connected');
  return unseal(env, creds.expo.token);
}

// --- Actualizările pornite din panou ---

type ReleaseRow = {
  id: string;
  platform: 'ios' | 'android' | 'all';
  kind: 'store' | 'ota';
  version: string;
  whats_new: string;
  run_id: string | null;
  run_url: string | null;
  status: 'building' | 'apple' | 'done' | 'failed';
  step: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};
const release = (r: ReleaseRow) => ({
  id: r.id,
  platform: r.platform,
  kind: r.kind,
  version: r.version,
  status: r.status,
  step: r.step,
  error: r.error,
  runUrl: r.run_url,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const JOB_NAMES: Record<string, string> = {
  build_ios: 'construirea pentru iPhone',
  build_android: 'construirea pentru Android',
  submit_ios: 'trimiterea la Apple',
  submit_android: 'trimiterea la Google Play',
  update: 'actualizarea rapidă',
};

async function setRelease(env: Env, id: string, patch: Partial<Pick<ReleaseRow, 'status' | 'step' | 'error'>>) {
  const now = iso(new Date());
  await env.DB.prepare('UPDATE app_releases SET status = coalesce(?, status), step = coalesce(?, step), error = ?, updated_at = ? WHERE id = ?')
    .bind(patch.status ?? null, patch.step ?? null, patch.error ?? null, now, id)
    .run();
}

/** Duce mai departe actualizările în curs (din cron și când se deschide pagina). */
export async function advanceReleases(env: Env) {
  const rows = await env.DB.prepare(`SELECT * FROM app_releases WHERE status IN ('building', 'apple') ORDER BY created_at`).all<ReleaseRow>();
  if (!rows.results.length) return;
  const creds = await getCreds(env);
  for (const r of rows.results) {
    try {
      if (r.status === 'building' && r.run_id) {
        const run = (await call<{ data: Run }>(`${bases(env).expo}/v2/workflows/runs/${r.run_id}`, { token: await expoToken(env, creds) }, 'Expo')).data;
        if (run.status === 'success') {
          if (r.kind === 'ota') await setRelease(env, r.id, { status: 'done', step: 'Actualizarea rapidă e publicată. Clienții o primesc la următoarea deschidere a aplicației.' });
          else if (r.platform !== 'android' && creds.apple) await setRelease(env, r.id, { status: 'apple', step: 'Versiunea a ajuns la Apple; o trimit la verificare după ce Apple o procesează.' });
          else
            await setRelease(env, r.id, {
              status: 'done',
              step:
                r.platform === 'android'
                  ? 'Trimisă la Google Play. Apare la clienți după aprobarea Google (de obicei 1–3 zile).'
                  : 'Versiunea a ajuns la Apple. Trimite-o la verificare din App Store Connect (conectează Apple în panou ca să se facă singur).',
            });
        } else if (run.status === 'failure' || run.status === 'canceled') {
          const bad = run.jobs.filter((j) => j.status === 'failure');
          const why = bad.map((j) => `${JOB_NAMES[j.key] ?? j.name}${j.errors?.[0] ? `: ${j.errors[0].message ?? j.errors[0].title}` : ''}`).join('; ');
          await setRelease(env, r.id, { status: 'failed', step: run.status === 'canceled' ? 'Oprită din Expo.' : 'Nu a mers.', error: why || 'Vezi detaliile în Expo.' });
        } else {
          const now = run.jobs.filter((j) => j.status === 'in-progress').map((j) => JOB_NAMES[j.key] ?? j.name);
          await setRelease(env, r.id, { step: now.length ? `Acum: ${now.join(', ')}.` : 'În coada Expo, pornește în curând.' });
        }
      } else if (r.status === 'apple') {
        if (Date.now() - Date.parse(r.created_at) > 12 * 3_600_000) {
          await setRelease(env, r.id, { status: 'failed', step: 'Apple nu a terminat procesarea în 12 ore.', error: 'Verifică în App Store Connect → TestFlight.' });
          continue;
        }
        const wait = await submitIosForReview(env, creds, r.version, r.whats_new);
        if (wait) await setRelease(env, r.id, { step: `${wait}.` });
        else
          await setRelease(env, r.id, {
            status: 'done',
            step: r.platform === 'all' ? 'Trimisă la verificare la Apple și la Google. Apare la clienți după aprobare (de obicei 1–2 zile).' : 'Trimisă la verificare la Apple. Apare la clienți după aprobare (de obicei 1–2 zile).',
          });
      }
    } catch (e) {
      if (e instanceof StoreError) await setRelease(env, r.id, { status: 'failed', step: 'Nu a mers.', error: e.message });
      else console.error('release', r.id, e);
    }
  }
}

// --- Rutele din panou (doar proprietarul) ---

export const storesAdmin = new Hono<AppEnv>();

async function ownerOnly(c: Context<AppEnv>, next: Next) {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
}
storesAdmin.use('/apps', ownerOnly);
storesAdmin.use('/apps/*', ownerOnly);

const connections = (creds: Creds) => ({
  expo: creds.expo ? { savedAt: creds.expo.savedAt } : null,
  apple: creds.apple ? { keyId: creds.apple.keyId, savedAt: creds.apple.savedAt } : null,
  google: creds.google ? { email: creds.google.email, savedAt: creds.google.savedAt } : null,
});

storesAdmin.get('/apps', async (c) => {
  await advanceReleases(c.env).catch((e) => console.error('advance releases', e));
  const creds = await getCreds(c.env);
  const [ios, android, rel] = await Promise.all([
    creds.apple ? iosStatus(c.env, creds) : null,
    creds.google ? androidStatus(c.env, creds) : null,
    c.env.DB.prepare('SELECT * FROM app_releases ORDER BY created_at DESC LIMIT 10').all<ReleaseRow>(),
  ]);
  return c.json({ connections: connections(creds), ios, android, releases: rel.results.map(release), links: STORE_LINKS });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cheile se pun sau se scot pe rând: { expoToken }, { apple: { keyId, issuerId, p8 } }, { google: { json } }; null = scoate. */
storesAdmin.put('/apps/connections', async (c) => {
  const b = await c.req.json<{ expoToken?: string | null; apple?: { keyId?: string; issuerId?: string; p8?: string } | null; google?: { json?: string } | null }>();
  const creds = await getCreds(c.env);
  const now = iso(new Date());
  if (b.expoToken !== undefined) {
    if (b.expoToken === null) delete creds.expo;
    else {
      const tok = String(b.expoToken).trim();
      if (!/^[\w.-]{20,200}$/.test(tok)) throw new HttpError(400, 'invalid_expo_token');
      creds.expo = { token: await seal(c.env, tok), savedAt: now };
    }
  }
  if (b.apple !== undefined) {
    if (b.apple === null) delete creds.apple;
    else {
      const keyId = (b.apple.keyId ?? '').trim().toUpperCase();
      const issuerId = (b.apple.issuerId ?? '').trim().toLowerCase();
      const p8 = (b.apple.p8 ?? '').trim();
      if (!/^[A-Z0-9]{10}$/.test(keyId)) throw new HttpError(400, 'invalid_key_id');
      if (!UUID.test(issuerId)) throw new HttpError(400, 'invalid_issuer_id');
      if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(p8) || p8.length > 1000) throw new HttpError(400, 'invalid_p8');
      creds.apple = { keyId, issuerId, p8: await seal(c.env, p8), savedAt: now };
    }
  }
  if (b.google !== undefined) {
    if (b.google === null) delete creds.google;
    else {
      let sa: ServiceAccount;
      try {
        sa = JSON.parse(b.google.json ?? '');
      } catch {
        throw new HttpError(400, 'invalid_google_json');
      }
      if (typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string' || !sa.private_key.includes('PRIVATE KEY')) throw new HttpError(400, 'invalid_google_json');
      const keep: ServiceAccount = { client_email: sa.client_email, private_key: sa.private_key, ...(sa.token_uri && { token_uri: sa.token_uri }) };
      creds.google = { email: sa.client_email, json: await seal(c.env, JSON.stringify(keep)), savedAt: now };
    }
  }
  await setSetting(c.env, 'store_creds', creds);
  // Proba: citim starea imediat, ca proprietarul să vadă pe loc dacă cheia merge.
  const [ios, android] = await Promise.all([
    b.apple && creds.apple ? iosStatus(c.env, creds) : null,
    b.google && creds.google ? androidStatus(c.env, creds) : null,
  ]);
  return c.json({ connections: connections(creds), ios, android });
});

const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** „Actualizați aplicația”: { platform: ios | android | all, version: "1.0.1", whatsNew?, kind?: store | ota }. */
storesAdmin.post('/apps/release', async (c) => {
  const b = await c.req.json<{ platform?: string; version?: string; whatsNew?: string; kind?: string }>();
  const kind = b.kind === 'ota' ? 'ota' : 'store';
  const platform = b.platform === 'ios' || b.platform === 'android' ? b.platform : 'all';
  const version = (b.version ?? '').trim();
  const whatsNew = (b.whatsNew ?? '').trim().slice(0, 4000);
  if (kind === 'store' && !VERSION.test(version)) throw new HttpError(400, 'invalid_version');
  const creds = await getCreds(c.env);
  const token = await expoToken(c.env, creds);
  const running = await c.env.DB.prepare(`SELECT 1 FROM app_releases WHERE status IN ('building', 'apple') LIMIT 1`).first();
  if (running) throw new HttpError(409, 'release_running');

  // Apple nu primește o versiune nouă cât timp alta e în verificare, și nici una mai mică decât cea publicată.
  if (kind === 'store' && platform !== 'android' && creds.apple) {
    try {
      const versions = await iosVersions(c.env, await appleToken(c.env, creds));
      const busy = versions.find((v) => IN_REVIEW.includes(versionState(v)));
      if (busy) throw new HttpError(409, 'ios_in_review');
      if (versions.some((v) => LIVE.includes(versionState(v)) && cmpVersion(v.attributes.versionString, version) >= 0)) throw new HttpError(400, 'version_too_low');
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // Apple nu răspunde: pornim oricum; verificarea se face la trimitere.
    }
  }

  const id = newId('rel');
  const now = iso(new Date());
  let run: { id: string; url: string };
  try {
    run = (
      await call<{ data: { id: string; url: string } }>(
        `${bases(c.env).expo}/v2/workflows/dispatch`,
        {
          method: 'POST',
          token,
          body: {
            appId: EXPO_PROJECT_ID,
            gitRef: GIT_REF,
            fileName: kind === 'ota' ? OTA_WORKFLOW : STORE_WORKFLOW,
            inputs: kind === 'ota' ? { message: whatsNew || 'Actualizare din panou' } : { platform, version },
          },
        },
        'Expo',
      )
    ).data;
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: 'expo_failed', message: e.message }, 400);
    throw e;
  }
  await c.env.DB.prepare(
    `INSERT INTO app_releases (id, platform, kind, version, whats_new, run_id, run_url, status, step, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'building', ?, ?, ?, ?)`,
  )
    .bind(id, kind === 'ota' ? 'all' : platform, kind, kind === 'ota' ? '' : version, whatsNew, run.id, run.url, kind === 'ota' ? 'Se pregătește actualizarea rapidă (câteva minute).' : 'Pornită. Construirea durează de obicei 20–40 de minute.', c.get('admin').adminId, now, now)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM app_releases WHERE id = ?').bind(id).first<ReleaseRow>();
  return c.json(release(row!), 201);
});
