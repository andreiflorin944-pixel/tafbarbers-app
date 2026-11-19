import { newId } from './auth';
import { HttpError, type Env } from './env';
import { mediaUrl, saveMedia, sniffImage } from './identity';
import { iso } from './time';

// Albumul de lucrări al frizerului: pozele cu tunsorile făcute. Le urcă frizerul (aplicația echipei → Meniu → Albumul meu)
// sau patronul (panou → Frizeri). Clienții le văd la profilul frizerului, în aplicație și pe site.

/** Câte poze poate avea un album (pozele stau în baza de date, deci ținem albumul la o mărime rezonabilă). */
export const ALBUM_MAX = 60;

/** Subselectul cu albumul unui frizer `b` (cele mai noi întâi), ca JSON: [{ id, url }]. */
export const BARBER_ALBUM_COL = `(SELECT json_group_array(json_object('id', x.id, 'url', '/v1/media/' || x.media_id))
  FROM (SELECT id, media_id FROM barber_album WHERE barber_id = b.id ORDER BY created_at DESC LIMIT ${ALBUM_MAX}) x) AS album_json`;

export type AlbumPhoto = { id: string; url: string };

export async function getAlbum(env: Env, barberId: string): Promise<AlbumPhoto[]> {
  const r = await env.DB.prepare('SELECT id, media_id FROM barber_album WHERE barber_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(barberId, ALBUM_MAX)
    .all<{ id: string; media_id: string }>();
  return r.results.map((p) => ({ id: p.id, url: mediaUrl(p.media_id) }));
}

/** Adaugă o poză (corpul cererii) în albumul frizerului. Aceleași verificări ca la celelalte poze: max 1,5 MB, doar JPEG/PNG/WebP. */
export async function addAlbumPhoto(env: Env, barberId: string, buf: ArrayBuffer, addedBy: string | null): Promise<AlbumPhoto> {
  const b = await env.DB.prepare('SELECT id FROM barbers WHERE id = ?').bind(barberId).first();
  if (!b) throw new HttpError(404, 'not_found');
  const n = await env.DB.prepare('SELECT count(*) AS n FROM barber_album WHERE barber_id = ?').bind(barberId).first<{ n: number }>();
  if ((n?.n ?? 0) >= ALBUM_MAX) throw new HttpError(409, 'album_full');
  // Doar poze adevărate: tipul se ia din conținutul fișierului (JPEG, PNG sau WebP), nu din ce declară telefonul.
  const mediaId = await saveMedia(env, sniffImage(buf) ?? '', buf, null);
  const id = newId('alb');
  await env.DB.prepare('INSERT INTO barber_album (id, barber_id, media_id, added_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, barberId, mediaId, addedBy, iso(new Date()))
    .run();
  return { id, url: mediaUrl(mediaId) };
}

/** Șterge o poză din album (și fișierul ei). `barberId` = doar din albumul ăsta (frizerul își șterge doar pozele lui). */
export async function deleteAlbumPhoto(env: Env, photoId: string, barberId: string | null) {
  const p = await env.DB.prepare(`SELECT media_id FROM barber_album WHERE id = ? ${barberId ? 'AND barber_id = ?' : ''}`)
    .bind(...(barberId ? [photoId, barberId] : [photoId]))
    .first<{ media_id: string }>();
  if (!p) throw new HttpError(404, 'not_found');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM barber_album WHERE id = ?').bind(photoId),
    env.DB.prepare('DELETE FROM media WHERE id = ?').bind(p.media_id),
  ]);
}
