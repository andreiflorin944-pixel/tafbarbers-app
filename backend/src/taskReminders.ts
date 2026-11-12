import { blocksForDay } from './blocks';
import type { Env } from './env';
import { sendPush } from './notify';
import { addDays, iso, localDay, localToUtc, weekdayOf } from './time';

// Amintirile cu taskuri pentru frizeri (aplicația echipei): cu 10 minute înainte de începerea programului
// și la sfârșitul lui, cu taskurile încă nebifate (ale lui și cele pentru toată echipa).
// Orele vin din programul săptămânal al frizerului; zilele libere, concediile, salonul închis și blocurile
// „Liber” din calendar se scad, deci într-o zi liberă nu pleacă nimic, iar o zi scurtată mută amintirile.
// Sunt pentru personal, nu pentru clienți: nu intră sub pauza mesajelor automate către clienți.

export const BEFORE_START_MIN = 10;
// Cât timp după moment mai are voie să plece (cron-ul rulează la 5 minute și poate întârzia).
const START_GRACE_MIN = 15;
const END_GRACE_MIN = 30;

type Interval = { s: number; e: number };

/** Programul zilei după ce scazi pauzele de tip liber/concediu: primul minut lucrat și ultimul (ms UTC), sau null dacă e zi liberă. */
export function workSpan(hours: Interval[], off: Interval[]): Interval | null {
  let parts = hours.filter((h) => h.e > h.s);
  for (const o of off) {
    const next: Interval[] = [];
    for (const p of parts) {
      if (o.e <= p.s || o.s >= p.e) {
        next.push(p);
        continue;
      }
      if (o.s > p.s) next.push({ s: p.s, e: o.s });
      if (o.e < p.e) next.push({ s: o.e, e: p.e });
    }
    parts = next;
  }
  if (!parts.length) return null;
  return { s: Math.min(...parts.map((p) => p.s)), e: Math.max(...parts.map((p) => p.e)) };
}

/** Ce amintire e de trimis acum pentru programul ăsta (cel mult una). */
export function dueReminder(span: Interval, now: number): 'start' | 'end' | null {
  if (now >= span.s - BEFORE_START_MIN * 60_000 && now < span.s + START_GRACE_MIN * 60_000 && now < span.e) return 'start';
  if (now >= span.e && now < span.e + END_GRACE_MIN * 60_000) return 'end';
  return null;
}

type Task = { title: string; due_day: string | null };

/** Titlul și textul notificării. */
export function reminderText(kind: 'start' | 'end', tasks: Task[], today: string): { title: string; body: string } {
  const n = tasks.length;
  const count = n === 1 ? '1 task' : `${n} taskuri`;
  const title = kind === 'start' ? `☀️ Ai ${count} de făcut azi` : `🌙 Înainte să pleci: ${count} nebifat${n === 1 ? '' : 'e'}`;
  const shown = tasks.slice(0, 4).map((t) => {
    const tag = t.due_day && t.due_day < today ? ' (întârziat)' : t.due_day === today ? ' (azi)' : '';
    return `• ${t.title}${tag}`;
  });
  if (n > shown.length) shown.push(`…și încă ${n - shown.length}`);
  return { title, body: shown.join('\n') };
}

/** Rulează din cron (la 5 minute). Nu aruncă pentru un frizer: o eroare la unul nu oprește amintirile celorlalți. */
export async function sendTaskReminders(env: Env, nowDate: Date): Promise<void> {
  const tz = env.TIMEZONE || 'Europe/Bucharest';
  const now = nowDate.getTime();
  const today = localDay(tz, nowDate);

  // Doar frizerii care au aplicația echipei pe telefon și n-au oprit amintirile.
  const who = await env.DB.prepare(
    `SELECT DISTINCT a.barber_id FROM admins a JOIN staff_push_tokens p ON p.admin_id = a.id JOIN barbers b ON b.id = a.barber_id
     WHERE a.barber_id IS NOT NULL AND a.notify_tasks = 1 AND b.active = 1`,
  ).all<{ barber_id: string }>();
  const ids = who.results.map((r) => r.barber_id);
  if (!ids.length) return;

  const ph = ids.map(() => '?').join(',');
  const dayStart = localToUtc(tz, today, 0);
  const dayEnd = localToUtc(tz, today, 24 * 60);
  const [hours, timeOff, blocks] = await Promise.all([
    env.DB.prepare(`SELECT barber_id, start_min, end_min FROM working_hours WHERE weekday = ? AND barber_id IN (${ph})`)
      .bind(weekdayOf(today), ...ids)
      .all<{ barber_id: string; start_min: number; end_min: number }>(),
    env.DB.prepare(`SELECT barber_id, starts_at, ends_at FROM time_off WHERE (barber_id IS NULL OR barber_id IN (${ph})) AND starts_at < ? AND ends_at > ?`)
      .bind(...ids, iso(dayEnd), iso(dayStart))
      .all<{ barber_id: string | null; starts_at: string; ends_at: string }>(),
    blocksForDay(env, today, ids),
  ]);

  for (const barberId of ids) {
    try {
      const h = hours.results.filter((x) => x.barber_id === barberId).map((x) => ({ s: localToUtc(tz, today, x.start_min).getTime(), e: localToUtc(tz, today, x.end_min).getTime() }));
      const off = [
        ...timeOff.results.filter((t) => !t.barber_id || t.barber_id === barberId).map((t) => ({ s: Date.parse(t.starts_at), e: Date.parse(t.ends_at) })),
        ...blocks.filter((k) => k.kind === 'off' && (!k.barberId || k.barberId === barberId)).map((k) => ({ s: k.s, e: k.e })),
      ];
      const span = workSpan(h, off);
      if (!span) continue;
      const kind = dueReminder(span, now);
      if (!kind) continue;

      // Se marchează înainte de trimitere: o rulare suprapusă nu o mai trimite o dată.
      const claimed = await env.DB.prepare('INSERT OR IGNORE INTO task_reminders (barber_id, day, kind) VALUES (?, ?, ?)').bind(barberId, today, kind).run();
      if (!claimed.meta.changes) continue;

      const tasks = await env.DB.prepare(
        `SELECT title, due_day FROM staff_notes WHERE kind = 'task' AND done_at IS NULL AND (barber_id IS NULL OR barber_id = ?)
         ORDER BY coalesce(due_day, '9999'), created_at LIMIT 50`,
      )
        .bind(barberId)
        .all<Task>();
      if (!tasks.results.length) continue; // nimic de amintit

      const tokens = await env.DB.prepare(
        `SELECT DISTINCT p.token FROM staff_push_tokens p JOIN admins a ON a.id = p.admin_id WHERE a.barber_id = ? AND a.notify_tasks = 1`,
      )
        .bind(barberId)
        .all<{ token: string }>();
      if (!tokens.results.length) continue;
      const { title, body } = reminderText(kind, tasks.results, today);
      await sendPush(env, { kind: `staff_tasks_${kind}` }, tokens.results.map((t) => t.token), title, body, { staff: '1', screen: 'notes' });
    } catch (e) {
      console.error('task reminder', barberId, e);
    }
  }

  // Marcajele vechi nu mai trebuie.
  await env.DB.prepare('DELETE FROM task_reminders WHERE day < ?').bind(addDays(today, -7)).run();
}
