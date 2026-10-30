import type { Env } from './env';
import { iso } from './time';

// Termenele de păstrare (GDPR art. 5 alin. 1 lit. e), aceleași ca în politica de confidențialitate:
// jurnalul mesajelor 12 luni, amprenta IP a scanărilor QR 30 de zile, contoarele zilnice ale asistentului 7 zile,
// notițele din programări 3 ani, jurnalul e-mailurilor din Barberly 90 de zile. Rulează o dată pe zi, noaptea.

const DAY = 86_400_000;

export async function applyRetention(env: Env, now: number) {
  const before = (days: number) => iso(new Date(now - days * DAY));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM message_log WHERE created_at < ?').bind(before(365)),
    env.DB.prepare('UPDATE qr_scans SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND at < ?').bind(before(30)),
    // Totalul analizelor consilierului (`advisor:done`) e doar un număr și rămâne pentru statistici.
    env.DB.prepare(`DELETE FROM assistant_usage WHERE day < ? AND key != 'advisor:done'`).bind(before(7).slice(0, 10)),
    env.DB.prepare(`UPDATE bookings SET note = '' WHERE note != '' AND starts_at < ?`).bind(before(3 * 365)),
    // Jurnalul e-mailurilor copiate din Barberly (subiectul are numele clientului): 90 de zile.
    env.DB.prepare('DELETE FROM barberly_inbox WHERE received_at < ?').bind(before(90)),
  ]);
}

/** O singură rulare pe zi: prima rulare a cron-ului de 5 minute după ora 02:00 UTC. */
export const retentionDue = (now: number) => {
  const d = new Date(now);
  return d.getUTCHours() === 2 && d.getUTCMinutes() < 5;
};
