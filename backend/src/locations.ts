// Locațiile salonului. Fiecare frizer lucrează într-o singură locație (barbers.location_id); clientul alege în aplicație
// întâi locația, apoi frizerul, serviciul și ora. Proprietarul le adaugă și le editează din panou, la Setări → Locații.
import { newId } from './auth';
import { isImageUrl } from './appearance';
import { HttpError, type Env } from './env';
import { iso } from './time';

export type LocationRow = {
  id: string;
  name: string;
  address: string;
  phone: string;
  photo_url: string | null;
  active: number;
  sort: number;
  barbers?: number;
  future_bookings?: number;
};

export const location = (r: LocationRow) => ({
  id: r.id,
  name: r.name,
  address: r.address,
  phone: r.phone,
  photoUrl: r.photo_url,
  active: !!r.active,
  sort: r.sort,
  ...(r.barbers !== undefined && { barbers: r.barbers }),
  ...(r.future_bookings !== undefined && { futureBookings: r.future_bookings }),
});
export type Location = ReturnType<typeof location>;

/**
 * Locațiile active, în ordinea din panou (pentru aplicație). O locație fără niciun frizer activ (abia adăugată, încă
 * fără echipă) nu apare: clientul ar alege-o și n-ar găsi pe nimeni. Dacă niciuna n-are frizeri, apar toate cele active.
 */
export async function activeLocations(env: Env) {
  const r = await env.DB.prepare(
    `SELECT l.*, (SELECT count(*) FROM barbers b WHERE b.location_id = l.id AND b.active = 1) AS barbers FROM locations l WHERE l.active = 1 ORDER BY l.sort, l.name`,
  ).all<LocationRow>();
  const staffed = r.results.filter((l) => (l.barbers ?? 0) > 0);
  return (staffed.length ? staffed : r.results).map(({ barbers: _b, ...l }) => location(l));
}

/** Toate locațiile, cu numărul de frizeri activi și de programări viitoare din fiecare (pentru panou: avertisment la dezactivare). */
export async function allLocations(env: Env) {
  const r = await env.DB.prepare(
    `SELECT l.*, (SELECT count(*) FROM barbers b WHERE b.location_id = l.id AND b.active = 1) AS barbers,
       (SELECT count(*) FROM bookings k WHERE k.location_id = l.id AND k.status IN ('confirmed','requested') AND k.starts_at > ?) AS future_bookings
     FROM locations l ORDER BY l.sort, l.name`,
  )
    .bind(iso(new Date()))
    .all<LocationRow>();
  return r.results.map(location);
}

/** Locația în care intră un frizer nou fără locație aleasă: prima activă. */
export async function defaultLocationId(env: Env) {
  const r = await env.DB.prepare('SELECT id FROM locations WHERE active = 1 ORDER BY sort, name LIMIT 1').first<{ id: string }>();
  return r?.id ?? null;
}

/** Verifică o locație aleasă în panou pentru un frizer (trebuie să existe). */
export async function checkLocationId(env: Env, id: unknown) {
  if (typeof id !== 'string' || !id) throw new HttpError(400, 'location_required');
  const r = await env.DB.prepare('SELECT id FROM locations WHERE id = ?').bind(id).first();
  if (!r) throw new HttpError(400, 'location_not_found');
  return id;
}

/** Locația activă cerută de aplicație (`?locationId=`); una necunoscută sau dezactivată e refuzată. */
export async function activeLocationId(env: Env, id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !id) return null;
  const r = await env.DB.prepare('SELECT id FROM locations WHERE id = ? AND active = 1').bind(id).first();
  if (!r) throw new HttpError(404, 'location_not_found');
  return id;
}

type LocationInput = { name?: unknown; address?: unknown; phone?: unknown; photoUrl?: unknown; active?: unknown; sort?: unknown };

function values(b: LocationInput, create: boolean) {
  const v: Record<string, unknown> = {};
  if (b.name !== undefined || create) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) throw new HttpError(400, 'name_required');
    v.name = name.slice(0, 80);
  }
  if (b.address !== undefined) v.address = String(b.address ?? '').trim().slice(0, 200);
  if (b.phone !== undefined) v.phone = String(b.phone ?? '').trim().slice(0, 30);
  if (b.photoUrl !== undefined) {
    if (b.photoUrl && !isImageUrl(b.photoUrl)) throw new HttpError(400, 'invalid_url');
    v.photo_url = b.photoUrl || null;
  }
  if (b.sort !== undefined) v.sort = Math.round(Number(b.sort)) || 0;
  if (b.active !== undefined) v.active = b.active === false ? 0 : 1;
  return v;
}

export async function createLocation(env: Env, b: LocationInput) {
  const v = values(b, true);
  const id = newId('loc');
  const sort = v.sort ?? ((await env.DB.prepare('SELECT coalesce(max(sort), 0) + 1 AS n FROM locations').first<{ n: number }>())?.n ?? 1);
  await env.DB.prepare('INSERT INTO locations (id, name, address, phone, photo_url, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, v.name, v.address ?? '', v.phone ?? '', v.photo_url ?? null, v.active ?? 1, sort)
    .run();
  return id;
}

export async function updateLocation(env: Env, id: string, b: LocationInput) {
  const cur = await env.DB.prepare('SELECT active FROM locations WHERE id = ?').bind(id).first<{ active: number }>();
  if (!cur) throw new HttpError(404, 'not_found');
  const v = values(b, false);
  // Aplicația are nevoie de cel puțin o locație unde se poate programa.
  if (v.active === 0 && cur.active) {
    const others = await env.DB.prepare('SELECT count(*) AS n FROM locations WHERE active = 1 AND id != ?').bind(id).first<{ n: number }>();
    if (!others?.n) throw new HttpError(409, 'last_location');
  }
  const keys = Object.keys(v);
  if (keys.length) await env.DB.prepare(`UPDATE locations SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(v), id).run();
}

/**
 * Variabilele de locație pentru mesajele automate (confirmare, memento, anulare, lista de așteptare):
 * ##locationname## și ##locationaddress## (mereu), plus ##location##, o propoziție gata scrisă în limba clientului
 * („Locația: Nord, Str. Exemplu 1.”) care apare doar când salonul are mai multe locații active (cu una singură, e goală).
 */
export async function locationVars(env: Env, locationId: string | null | undefined, lang: string): Promise<Record<string, string>> {
  const loc = locationId ? await env.DB.prepare('SELECT name, address FROM locations WHERE id = ?').bind(locationId).first<{ name: string; address: string }>() : null;
  if (!loc) return { locationname: '', locationaddress: '', location: '' };
  const many = ((await env.DB.prepare('SELECT count(*) AS n FROM locations WHERE active = 1').first<{ n: number }>())?.n ?? 0) > 1;
  const where = [loc.name, loc.address].map((x) => (x ?? '').trim()).filter(Boolean).join(', ');
  const label = lang === 'en' ? 'Location:' : lang === 'fr' ? 'Adresse :' : 'Locația:';
  return { locationname: loc.name, locationaddress: loc.address ?? '', location: many && where ? `${label} ${where}.` : '' };
}
