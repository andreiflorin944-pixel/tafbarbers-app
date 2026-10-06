import { notifyBooking, BOOKING_SELECT } from './bookings';
import { booking, type BookingRow } from './db';
import type { Env } from './env';
import { runCampaign } from './campaigns';
import { greetBirthdays } from './birthday';
import { sendPush } from './notify';
import { formatLocal, iso } from './time';

/**
 * Rulează la fiecare 5 minute: reminder-e (24h și 2h înainte), campanii programate, urări de ziua clientului,
 * curățenie (sesiuni și coduri expirate). Fiecare reminder se marchează înainte de trimitere,
 * ca o rulare suprapusă să nu-l trimită de două ori.
 */
export async function scheduled(env: Env) {
  const now = Date.now();
  await reminders(env, 'reminder_24h', 'reminder_24h_at', now + 23.5 * 3_600_000, now + 24 * 3_600_000);
  await reminders(env, 'reminder_2h', 'reminder_2h_at', now, now + 2 * 3_600_000);

  const due = await env.DB.prepare(`SELECT id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ?`)
    .bind(iso(new Date(now)))
    .all<{ id: string }>();
  for (const c of due.results) {
    const r = await env.DB.prepare(`UPDATE campaigns SET status = 'sending' WHERE id = ? AND status = 'scheduled'`).bind(c.id).run();
    if (r.meta.changes) await runCampaign(env, c.id);
  }

  try {
    await greetBirthdays(env, new Date(now));
  } catch (e) {
    console.error('birthday greetings failed', e);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(iso(new Date(now))),
    env.DB.prepare('DELETE FROM otp_codes WHERE expires_at < ?').bind(iso(new Date(now - 3_600_000))),
  ]);
}

async function reminders(
  env: Env,
  kind: 'reminder_24h' | 'reminder_2h',
  col: 'reminder_24h_at' | 'reminder_2h_at',
  from: number,
  to: number,
) {
  // Programările făcute deja în fereastră (ex. rezervate cu o oră înainte) primesc doar reminder-ul de 2h,
  // iar cele create cu mai puțin de 30 de minute înainte nu mai primesc nimic (au primit confirmarea).
  const rows = await env.DB.prepare(
    `${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.${col} IS NULL AND b.starts_at > ? AND b.starts_at <= ?
     AND b.created_at <= ?`,
  )
    .bind(iso(new Date(from)), iso(new Date(to)), iso(new Date(Date.now() - 30 * 60_000)))
    .all<BookingRow>();
  for (const r of rows.results) {
    const claimed = await env.DB.prepare(`UPDATE bookings SET ${col} = ? WHERE id = ? AND ${col} IS NULL`)
      .bind(iso(new Date()), r.id)
      .run();
    if (!claimed.meta.changes) continue;
    const b = booking(r);
    await notifyBooking(env, b, kind);
    const tokens = await env.DB.prepare('SELECT token FROM push_tokens WHERE client_id = ?').bind(b.clientId).all<{ token: string }>();
    if (tokens.results.length) {
      await sendPush(
        env,
        { kind, bookingId: b.id },
        tokens.results.map((t) => t.token),
        kind === 'reminder_24h' ? 'Programare mâine' : 'Programare în curând',
        `${b.serviceName} cu ${b.barberName}, ${formatLocal(env.TIMEZONE, b.start)}`,
        { bookingId: b.id },
      );
    }
  }
}
