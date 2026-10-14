import type { Env } from './env';
import { iso } from './time';

// Reducerile din bannere: un banner activ care duce la un serviciu și are un procent face serviciul mai ieftin
// cât timp e afișat (între „Afișat din” și „Până în”). Prețul redus se rotunjește la leu.

export type Offer = { percent: number; until: string | null };

/** Serviciu → reducerea activă acum (cea mai mare, dacă sunt mai multe bannere pe același serviciu). */
export async function serviceOffers(env: Env, now = new Date()): Promise<Map<string, Offer>> {
  const t = iso(now);
  const r = await env.DB.prepare(
    `SELECT action_value AS service_id, discount_percent AS percent, ends_at AS until FROM promos
     WHERE active = 1 AND action_type = 'service' AND discount_percent > 0
       AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)`,
  )
    .bind(t, t)
    .all<{ service_id: string; percent: number; until: string | null }>();
  const out = new Map<string, Offer>();
  for (const x of r.results) if (!out.has(x.service_id) || out.get(x.service_id)!.percent < x.percent) out.set(x.service_id, { percent: x.percent, until: x.until });
  return out;
}

/** Prețul cu reducere, în bani, rotunjit la leu. */
export const discounted = (bani: number, percent: number) => Math.round((bani * (100 - percent)) / 10000) * 100;
