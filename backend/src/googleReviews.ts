import { getBusiness, getSetting, setSetting } from './db';
import type { Env } from './env';
import { getAutomations } from './growth';
import { sendTemplate } from './sendTemplate';

// Recenziile Google, automat:
// 1. Nota și numărul de recenzii se citesc din Google (Places API) de două ori pe zi și se scriu în datele salonului
//    (googleRating / googleReviews), deci apar singure în aplicație, pe site, în llms.txt și în întrebările frecvente.
//    Cheia: secretul GOOGLE_PLACES_KEY (npx wrangler secret put GOOGLE_PLACES_KEY). Fără cheie rămân cifrele scrise în panou.
// 2. Cererea de recenzie pleacă singură după o tunsoare încheiată (Marketing → Automatizări → Recenzii Google), pe canalele
//    bifate la „Cerere de recenzie”: dacă mesajele sunt oprite acolo, nu pleacă nimic.

export type GooglePlace = { placeId: string; name: string; mapsUrl: string; rating: number | null; count: number | null; updatedAt: string | null; error: string | null };
const EMPTY: GooglePlace = { placeId: '', name: '', mapsUrl: '', rating: null, count: null, updatedAt: null, error: null };
const KEY = 'google_place';
const REFRESH_MS = 12 * 3_600_000;

export const getGooglePlace = (env: Env) => getSetting<GooglePlace>(env, KEY, EMPTY);

type Place = { id?: string; displayName?: { text?: string }; rating?: number; userRatingCount?: number; googleMapsUri?: string };

async function placesApi(env: Env, path: string, init: RequestInit & { mask: string }): Promise<unknown> {
  const r = await fetch(`https://places.googleapis.com/v1/${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY ?? '', 'X-Goog-FieldMask': init.mask },
  });
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message || `Google ${r.status}`);
  return j;
}

/**
 * Citește nota din Google și o pune în datele salonului. `placeId` (opțional): salonul ales în panou; altfel se caută după
 * numele și adresa din Setări (prima potrivire) și se ține minte.
 */
export async function syncGoogleRating(env: Env, opts: { force?: boolean; placeId?: string } = {}): Promise<GooglePlace> {
  const cur = await getGooglePlace(env);
  if (!env.GOOGLE_PLACES_KEY) return { ...cur, error: 'no_key' };
  if (!opts.force && cur.updatedAt && Date.now() - Date.parse(cur.updatedAt) < REFRESH_MS && !cur.error) return cur;
  const next: GooglePlace = { ...cur, placeId: opts.placeId?.trim() || cur.placeId };
  try {
    let p: Place;
    if (next.placeId) {
      p = (await placesApi(env, `places/${encodeURIComponent(next.placeId)}`, { method: 'GET', mask: 'id,displayName,rating,userRatingCount,googleMapsUri' })) as Place;
    } else {
      const biz = await getBusiness(env);
      const r = (await placesApi(env, 'places:searchText', {
        method: 'POST',
        mask: 'places.id,places.displayName,places.rating,places.userRatingCount,places.googleMapsUri',
        body: JSON.stringify({ textQuery: `${biz.name} ${biz.address}`.trim(), languageCode: 'ro', regionCode: 'RO' }),
      })) as { places?: Place[] };
      p = r.places?.[0] ?? {};
      if (!p.id) throw new Error('not_found');
    }
    Object.assign(next, {
      placeId: p.id ?? next.placeId,
      name: p.displayName?.text ?? '',
      mapsUrl: p.googleMapsUri ?? '',
      rating: typeof p.rating === 'number' ? Math.round(p.rating * 10) / 10 : null,
      count: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
      updatedAt: new Date().toISOString(),
      error: null,
    });
    // Cifrele noi intră în datele salonului: de acolo le citesc aplicația, site-ul și AI-ul.
    if (next.rating) {
      const biz = await getBusiness(env);
      await setSetting(env, 'business', { ...biz, googleRating: next.rating, googleReviews: next.count, googleMapsUrl: next.mapsUrl || biz.googleMapsUrl });
    }
  } catch (e) {
    next.error = e instanceof Error ? e.message.slice(0, 200) : 'error';
    next.updatedAt = new Date().toISOString();
  }
  await setSetting(env, KEY, next);
  return next;
}

/**
 * Cererea automată de recenzie: la programările încheiate (marcate „finalizat”) de acum `delayHours` (în ultimele 24 de ore
 * după asta), o singură dată pe programare și cel mult o dată la `everyDays` zile pe client. Programările copiate din
 * Barberly nu primesc (Barberly le cere singur).
 */
export async function autoReviewRequests(env: Env, now = Date.now()) {
  const { reviewAuto: cfg, links } = await getAutomations(env);
  if (!cfg.enabled || !links.googleReviewUrl) return 0;
  const to = new Date(now - cfg.delayHours * 3_600_000).toISOString();
  const from = new Date(now - (cfg.delayHours + 24) * 3_600_000).toISOString();
  const since = new Date(now - cfg.everyDays * 86_400_000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT b.id, b.client_id, s.name AS service, br.name AS barber
     FROM bookings b JOIN clients c ON c.id = b.client_id
     LEFT JOIN services s ON s.id = b.service_id LEFT JOIN barbers br ON br.id = b.barber_id
     WHERE b.status = 'completed' AND b.barberly_ref IS NULL AND b.ends_at > ? AND b.ends_at <= ?
       AND c.blocked_at IS NULL AND c.phone NOT LIKE 'deleted:%'
       AND NOT EXISTS (SELECT 1 FROM message_log m JOIN bookings b2 ON b2.id = m.booking_id
                       WHERE m.kind = 'review' AND b2.client_id = b.client_id AND (m.booking_id = b.id OR (m.status = 'sent' AND m.created_at > ?)))
     ORDER BY b.ends_at LIMIT 20`,
  )
    .bind(from, to, since)
    .all<{ id: string; client_id: string; service: string | null; barber: string | null }>();
  let sent = 0;
  const seen = new Set<string>();
  for (const b of rows.results) {
    if (seen.has(b.client_id)) continue;
    seen.add(b.client_id);
    const r = await sendTemplate(env, 'review', b.client_id, { servicename: b.service ?? '', barbername: b.barber ?? '', datetime: '', reviewlink: links.googleReviewUrl }, {
      bookingId: b.id,
      data: { url: links.googleReviewUrl },
    });
    // Mesajul „Cerere de recenzie” e oprit în Notificări: nu încercăm din nou la fiecare 5 minute.
    if (r.off) return sent;
    // Ținem minte și programările la care n-a plecat nimic (clientul n-are niciun canal), ca să nu reîncercăm.
    if (!r.sms && !r.push && !r.email)
      await env.DB.prepare(`INSERT INTO message_log (channel, kind, recipient, booking_id, status) VALUES ('none', 'review', '', ?, 'skipped')`).bind(b.id).run();
    else sent++;
  }
  return sent;
}
