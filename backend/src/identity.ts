import { newId } from './auth';
import { MEDIA_MAX, MEDIA_TYPES } from './appearance';
import { HttpError, type Env } from './env';
import { iso } from './time';

// TAF Identity: pozele și descrierea tunsorii dorite de client, plus ce notează echipa despre el.

export const IDENTITY_MAX_PHOTOS = 5;
const STAFF_MAX_PHOTOS = 30;
const CLIENT_UPLOADS_PER_DAY = 30;

/** Salvează o poză primită ca fișier în corpul cererii. Întoarce id-ul ei. */
export async function saveMedia(env: Env, mime: string, buf: ArrayBuffer, clientId: string | null): Promise<string> {
  if (!MEDIA_TYPES[mime]) throw new HttpError(400, 'unsupported_image');
  if (!buf.byteLength) throw new HttpError(400, 'empty_file');
  if (buf.byteLength > MEDIA_MAX) throw new HttpError(400, 'image_too_large');
  if (clientId) {
    const n = await env.DB.prepare('SELECT count(*) AS n FROM media WHERE client_id = ? AND created_at > ?')
      .bind(clientId, iso(new Date(Date.now() - 86_400_000)))
      .first<{ n: number }>();
    if ((n?.n ?? 0) >= CLIENT_UPLOADS_PER_DAY) throw new HttpError(429, 'too_many_requests');
  }
  const id = newId('m');
  await env.DB.prepare('INSERT INTO media (id, mime, data, size, created_at, client_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, mime, buf, buf.byteLength, iso(new Date()), clientId)
    .run();
  return id;
}

export const mediaUrl = (id: string) => `/v1/media/${id}`;
const mediaIdOf = (url: string | null) => url?.match(/^\/v1\/media\/([\w-]+)$/)?.[1] ?? null;

export async function deleteMediaUrl(env: Env, url: string | null) {
  const id = mediaIdOf(url);
  if (id) await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id).run();
}

type PhotoRow = { id: string; media_id: string; private: number; caption: string; added_by: string | null; created_at: string; added_by_name?: string | null };
const photo = (r: PhotoRow) => ({
  id: r.id,
  url: mediaUrl(r.media_id),
  caption: r.caption,
  createdAt: r.created_at,
  ...(r.private ? { addedBy: r.added_by_name ?? null } : {}),
});

/** Descrierea și pozele clientului; cu `staff`, și pozele urcate de echipă (doar pentru echipă). */
export async function getIdentity(env: Env, clientId: string, staff: boolean) {
  const c = await env.DB.prepare('SELECT identity_note FROM clients WHERE id = ?').bind(clientId).first<{ identity_note: string }>();
  const r = await env.DB.prepare(
    `SELECT p.*, a.name AS added_by_name FROM client_photos p LEFT JOIN admins a ON a.id = p.added_by
     WHERE p.client_id = ? ${staff ? '' : 'AND p.private = 0'} ORDER BY p.created_at`,
  )
    .bind(clientId)
    .all<PhotoRow>();
  return {
    note: c?.identity_note ?? '',
    photos: r.results.filter((p) => !p.private).map(photo),
    ...(staff && { staffPhotos: r.results.filter((p) => p.private).map(photo) }),
  };
}

export async function addPhoto(env: Env, clientId: string, mime: string, buf: ArrayBuffer, by: { adminId: string } | null, caption = '') {
  const isPrivate = by ? 1 : 0;
  const n = await env.DB.prepare('SELECT count(*) AS n FROM client_photos WHERE client_id = ? AND private = ?')
    .bind(clientId, isPrivate)
    .first<{ n: number }>();
  if ((n?.n ?? 0) >= (by ? STAFF_MAX_PHOTOS : IDENTITY_MAX_PHOTOS)) throw new HttpError(409, 'too_many_photos');
  const mediaId = await saveMedia(env, mime, buf, by ? null : clientId);
  const id = newId('ph');
  await env.DB.prepare('INSERT INTO client_photos (id, client_id, media_id, private, caption, added_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, clientId, mediaId, isPrivate, caption.slice(0, 200), by?.adminId ?? null)
    .run();
  return { id, url: mediaUrl(mediaId), caption: caption.slice(0, 200) };
}

export async function deletePhoto(env: Env, clientId: string, photoId: string, isPrivate: boolean) {
  const p = await env.DB.prepare('SELECT media_id FROM client_photos WHERE id = ? AND client_id = ? AND private = ?')
    .bind(photoId, clientId, isPrivate ? 1 : 0)
    .first<{ media_id: string }>();
  if (!p) throw new HttpError(404, 'not_found');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM client_photos WHERE id = ?').bind(photoId),
    env.DB.prepare('DELETE FROM media WHERE id = ?').bind(p.media_id),
  ]);
}

/** Data nașterii: AAAA-LL-ZZ, o dată reală din trecut (între 1900 și azi). */
export function parseBirthDate(v: unknown): string | null {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, 'invalid_birth_date');
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || v < '1900-01-01' || d.getTime() > Date.now())
    throw new HttpError(400, 'invalid_birth_date');
  return v;
}

/** Șterge pozele și datele de profil ale unui client (la ștergerea contului). */
export async function wipeIdentity(env: Env, clientId: string) {
  const c = await env.DB.prepare('SELECT photo_url FROM clients WHERE id = ?').bind(clientId).first<{ photo_url: string | null }>();
  await deleteMediaUrl(env, c?.photo_url ?? null);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM media WHERE id IN (SELECT media_id FROM client_photos WHERE client_id = ?)').bind(clientId),
    env.DB.prepare('DELETE FROM media WHERE client_id = ?').bind(clientId),
    env.DB.prepare('DELETE FROM client_photos WHERE client_id = ?').bind(clientId),
    env.DB.prepare(`UPDATE clients SET birth_date = NULL, photo_url = NULL, identity_note = '' WHERE id = ?`).bind(clientId),
  ]);
}
