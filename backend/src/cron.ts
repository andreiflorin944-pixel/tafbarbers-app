import { notifyBooking, BOOKING_SELECT, expireRequests } from './bookings';
import { booking, type BookingRow } from './db';
import type { Env } from './env';
import { runCampaign } from './campaigns';
import { greetBirthdays } from './birthday';
import { channelsFor, sendLastMinute, sendWinback } from './growth';
import { formatLocal, iso } from './time';
import { runSocial } from './social';
import { checkWaitlist } from './waitlist';
import { translateAllOnce } from './translateAll';

/**
 * Rulează la fiecare 5 minute: reminder-e (24h și 2h înainte), cererile de programare expirate, lista de așteptare, campanii programate, urări de ziua clientului,
 * „Ne e dor de tine”, ore libere de ultim moment, traducerea conținutului care nu e încă tradus,
 * curățenie (sesiuni și coduri expirate). Fiecare reminder se marchează înainte de trimitere,
 * ca o rulare suprapusă să nu-l trimită de două ori.
 */
export async function scheduled(env: Env) {
  const now = Date.now();
  try {
    await expireRequests(env, new Date(now));
  } catch (e) {
    console.error('expire requests failed', e);
  }
  // Lista de așteptare: după cererile expirate (care eliberează ore); prinde și orele eliberate de schimbări de program.
  try {
    await checkWaitlist(env, { now: new Date(now) });
  } catch (e) {
    console.error('waitlist failed', e);
  }
  // O eroare la reminder-e nu oprește restul pașilor (campanii, urări, curățenie).
  try {
    await reminders(env, 'reminder_24h', 'reminder_24h_at', now + 23.5 * 3_600_000, now + 24 * 3_600_000);
  } catch (e) {
    console.error('reminders 24h failed', e);
  }
  try {
    await reminders(env, 'reminder_2h', 'reminder_2h_at', now, now + 2 * 3_600_000);
  } catch (e) {
    console.error('reminders 2h failed', e);
  }

  try {
    await env.DB.prepare(`UPDATE campaigns SET status = 'sending' WHERE status = 'scheduled' AND scheduled_at <= ?`).bind(iso(new Date(now))).run();
    // Campaniile care se trimit (pornite acum sau rămase la jumătate): următoarea bucată de destinatari.
    const sending = await env.DB.prepare(`SELECT id FROM campaigns WHERE status = 'sending' ORDER BY created_at LIMIT 5`).all<{ id: string }>();
    for (const c of sending.results) await runCampaign(env, c.id);
  } catch (e) {
    console.error('campaigns failed', e);
  }

  try {
    await greetBirthdays(env, new Date(now));
  } catch (e) {
    console.error('birthday greetings failed', e);
  }
  try {
    await sendWinback(env, new Date(now));
  } catch (e) {
    console.error('winback failed', e);
  }
  try {
    await sendLastMinute(env, new Date(now));
  } catch (e) {
    console.error('last minute failed', e);
  }
  try {
    await runSocial(env, new Date(now));
  } catch (e) {
    console.error('social posts failed', e);
  }

  // Textele din panou netraduse încă în engleză și franceză (o dată, pe bucăți, până nu mai lipsește nimic).
  try {
    await translateAllOnce(env);
  } catch (e) {
    console.error('translations failed', e);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(iso(new Date(now))),
    env.DB.prepare('DELETE FROM otp_codes WHERE expires_at < ?').bind(iso(new Date(now - 3_600_000))),
    // Greșelile de parolă vechi (fereastra și blocarea țin 15 minute).
    env.DB.prepare('DELETE FROM login_failures WHERE first_at < ? AND (locked_until IS NULL OR locked_until < ?)').bind(iso(new Date(now - 3_600_000)), iso(new Date(now))),
  ]);
}

async function reminders(
  env: Env,
  kind: 'reminder_24h' | 'reminder_2h',
  col: 'reminder_24h_at' | 'reminder_2h_at',
  from: number,
  to: number,
) {
  // Reminder-ul oprit (Tablou de bord → Mesaje automate): nu pleacă nici pentru programările făcute deja.
  // Programările nu se marchează, așa că dacă îl repornește, cele încă în fereastră îl primesc.
  if (!(await channelsFor(env, kind))) return;
  // Programările făcute deja în fereastră (ex. rezervate cu o oră înainte) primesc doar reminder-ul de 2h,
  // iar cele create cu mai puțin de 30 de minute înainte nu mai primesc nimic (au primit confirmarea).
  // La o cerere acceptată contează momentul acceptării (atunci a plecat confirmarea), nu cel al cererii.
  const rows = await env.DB.prepare(
    `${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.${col} IS NULL AND b.starts_at > ? AND b.starts_at <= ?
     AND coalesce(b.request_answered_at, b.created_at) <= ?`,
  )
    .bind(iso(new Date(from)), iso(new Date(to)), iso(new Date(Date.now() - 30 * 60_000)))
    .all<BookingRow>();
  for (const r of rows.results) {
    const at = iso(new Date());
    const claimed = await env.DB.prepare(`UPDATE bookings SET ${col} = ? WHERE id = ? AND ${col} IS NULL`)
      .bind(at, r.id)
      .run();
    if (!claimed.meta.changes) continue;
    const b = booking(r);
    let sent = null;
    try {
      sent = await notifyBooking(env, b, kind);
    } catch (e) {
      console.error('reminder', r.id, e);
    }
    // N-a plecat pe niciun canal (ex. SMS-ul a dat eroare): se reîncearcă la următoarea rulare, cât timp e în fereastră,
    // de cel mult 3 ori (după încercările eșuate din jurnal), ca o eroare care ține să nu trimită la nesfârșit.
    if (sent && !sent.off && !sent.sms && !sent.push && !sent.email) {
      const failed = await env.DB.prepare(`SELECT count(*) AS n FROM message_log WHERE booking_id = ? AND kind = ? AND status = 'failed'`)
        .bind(r.id, kind)
        .first<{ n: number }>();
      if ((failed?.n ?? 0) < 3) await env.DB.prepare(`UPDATE bookings SET ${col} = NULL WHERE id = ? AND ${col} = ?`).bind(r.id, at).run();
    }
  }
}
