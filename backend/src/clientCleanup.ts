import { clientStats, type ClientListItem } from './clientList';
import { HttpError, type Env } from './env';
import { deleteClient } from './gdpr';
import { iso } from './time';

// Blocarea unui client și curățenia conturilor după criterii (Panou → Clienți → Curățenie conturi). Doar proprietarul.

export async function blockClient(env: Env, id: string, reasonRaw: unknown, adminId: string) {
  const reason = String(reasonRaw ?? '').trim().slice(0, 200);
  const r = await env.DB.prepare('UPDATE clients SET blocked_at = ?, blocked_reason = ?, blocked_by = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(iso(new Date()), reason, adminId, id)
    .run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found');
  // Iese din cont pe toate telefoanele și nu mai primește notificări pe telefon.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE kind = 'client' AND subject_id = ?`).bind(id),
    env.DB.prepare('DELETE FROM push_tokens WHERE client_id = ?').bind(id),
  ]);
}

export async function unblockClient(env: Env, id: string) {
  const r = await env.DB.prepare(`UPDATE clients SET blocked_at = NULL, blocked_reason = '', blocked_by = NULL WHERE id = ? AND deleted_at IS NULL`).bind(id).run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found');
}

/** Criteriile se adună (toate trebuie îndeplinite). Cel puțin unul e obligatoriu. */
export type CleanupCriteria = {
  /** Fără vizită de cel puțin atâtea luni (cine n-a venit niciodată: de la crearea contului). */
  noVisitMonths?: number | null;
  /** N-a venit niciodată (nicio vizită, nici la noi, nici în istoricul din Barberly). */
  neverVisited?: boolean;
  /** Cel puțin atâtea neprezentări. */
  minNoShows?: number | null;
  /** N-a folosit niciodată aplicația sau site-ul (ex. clienți aduși din Barberly). */
  noApp?: boolean;
  /** Doar clienții blocați. */
  blockedOnly?: boolean;
};

export type CleanupItem = Pick<ClientListItem, 'id' | 'name' | 'phone' | 'visits' | 'lastVisit' | 'noShows' | 'app' | 'createdAt'> & { blocked: boolean };

const MONTH = 30.44 * 86_400_000;

function parseCriteria(raw: unknown): CleanupCriteria {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Math.floor(Number(v));
    if (!(n >= min && n <= max)) throw new HttpError(400, 'invalid_criteria');
    return n;
  };
  const c: CleanupCriteria = {
    noVisitMonths: num(b.noVisitMonths, 1, 120),
    neverVisited: b.neverVisited === true,
    minNoShows: num(b.minNoShows, 1, 100),
    noApp: b.noApp === true,
    blockedOnly: b.blockedOnly === true,
  };
  if (!c.noVisitMonths && !c.neverVisited && !c.minNoShows && !c.noApp && !c.blockedOnly) throw new HttpError(400, 'criteria_required');
  return c;
}

/**
 * Clienții care îndeplinesc criteriile. Nu intră niciodată: cine are programare viitoare, abonament activ
 * sau card cadou cumpărat și nefolosit (ca la ștergerea automată după un an de inactivitate).
 */
export async function cleanupMatches(env: Env, raw: unknown): Promise<{ criteria: CleanupCriteria; items: CleanupItem[]; kept: number }> {
  const crit = parseCriteria(raw);
  const now = new Date();
  const [stats, keep, blocked] = await Promise.all([
    clientStats(env, now, null),
    env.DB.prepare(
      `SELECT client_id AS id FROM subscriptions WHERE status = 'active' AND ends_at > ?1
       UNION SELECT buyer_client_id FROM gift_cards WHERE status = 'active' AND balance_bani > 0 AND buyer_client_id IS NOT NULL`,
    )
      .bind(iso(now))
      .all<{ id: string }>(),
    env.DB.prepare('SELECT id FROM clients WHERE blocked_at IS NOT NULL AND deleted_at IS NULL').all<{ id: string }>(),
  ]);
  const keepIds = new Set(keep.results.map((r) => r.id));
  const blockedIds = new Set(blocked.results.map((r) => r.id));
  let kept = 0;
  const items: CleanupItem[] = [];
  for (const x of stats) {
    const since = Date.parse(x.lastVisit ?? x.createdAt);
    const ok =
      (!crit.noVisitMonths || now.getTime() - since >= crit.noVisitMonths * MONTH) &&
      (!crit.neverVisited || x.visits === 0) &&
      (!crit.minNoShows || x.noShows >= crit.minNoShows) &&
      (!crit.noApp || !x.app) &&
      (!crit.blockedOnly || blockedIds.has(x.id));
    if (!ok) continue;
    if (x.upcoming > 0 || keepIds.has(x.id)) {
      kept++;
      continue;
    }
    items.push({ id: x.id, name: x.name, phone: x.phone, visits: x.visits, lastVisit: x.lastVisit, noShows: x.noShows, app: x.app, createdAt: x.createdAt, blocked: blockedIds.has(x.id) });
  }
  items.sort((a, b) => (a.lastVisit ?? a.createdAt).localeCompare(b.lastVisit ?? b.createdAt));
  return { criteria: crit, items, kept };
}

/** Câți clienți se șterg la o cerere (ștergerea fiecăruia face mai mulți pași; panoul trimite în tranșe). */
export const CLEANUP_BATCH = 25;

/** Șterge clienții aleși, doar dacă încă îndeplinesc criteriile (lista se poate schimba între previzualizare și confirmare). */
export async function cleanupDelete(env: Env, raw: unknown, idsRaw: unknown) {
  if (!Array.isArray(idsRaw) || !idsRaw.length) throw new HttpError(400, 'ids_required');
  const ids = [...new Set(idsRaw.map(String))];
  if (ids.length > CLEANUP_BATCH) throw new HttpError(400, 'too_many_ids');
  const { items } = await cleanupMatches(env, raw);
  const still = new Set(items.map((x) => x.id));
  let deleted = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    if (!still.has(id)) {
      skipped.push(id);
      continue;
    }
    try {
      await deleteClient(env, id);
      deleted++;
    } catch (e) {
      console.error('cleanup delete', id, e);
      skipped.push(id);
    }
  }
  return { deleted, skipped };
}
