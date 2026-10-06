import { Hono, type Context } from 'hono';
import { HttpError, type AppEnv } from './env';
import { iso, isDay } from './time';

// Notițe pentru echipă: adminul (sau administratorul de locație) scrie sarcini și scripturi de filmat
// și le dă unui frizer sau întregii echipe; frizerul le vede pe ale lui și le bifează „făcut”.
export const notesRoutes = new Hono<AppEnv>();

const KINDS = ['task', 'script', 'note'] as const;
type Row = {
  id: string;
  kind: string;
  title: string;
  body: string;
  barber_id: string | null;
  due_day: string | null;
  done_at: string | null;
  done_by: string | null;
  created_at: string;
  updated_at: string;
  barber_name: string | null;
  author_name: string | null;
  done_by_name: string | null;
};
const SELECT = `SELECT n.*, b.name AS barber_name, coalesce(nullif(a.name, ''), a.email) AS author_name, coalesce(nullif(d.name, ''), d.email) AS done_by_name
  FROM staff_notes n LEFT JOIN barbers b ON b.id = n.barber_id LEFT JOIN admins a ON a.id = n.created_by LEFT JOIN admins d ON d.id = n.done_by`;
const note = (r: Row) => ({
  id: r.id,
  kind: r.kind as (typeof KINDS)[number],
  title: r.title,
  body: r.body,
  barberId: r.barber_id,
  barberName: r.barber_name,
  dueDay: r.due_day,
  doneAt: r.done_at,
  doneByName: r.done_by_name,
  authorName: r.author_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Cine împarte sarcinile: proprietarul și administratorii de locație. Frizerii doar le citesc și le bifează. */
const isManager = (c: Context<AppEnv>) => c.get('admin').role !== 'barber';

/** Un frizer vede ce i s-a dat lui și ce e pentru toată echipa. */
function scope(c: Context<AppEnv>): [string, unknown[]] {
  if (isManager(c)) return ['1 = 1', []];
  const b = c.get('admin').barberId;
  return b ? ['(n.barber_id IS NULL OR n.barber_id = ?)', [b]] : ['n.barber_id IS NULL', []];
}

async function load(c: Context<AppEnv>, id: string) {
  const [w, binds] = scope(c);
  const r = await c.env.DB.prepare(`${SELECT} WHERE n.id = ? AND ${w}`).bind(id, ...binds).first<Row>();
  if (!r) throw new HttpError(404, 'not_found');
  return r;
}

function clean(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || b.title !== undefined) {
    const t = String(b.title ?? '').trim().slice(0, 140);
    if (!t) throw new HttpError(400, 'title_required');
    out.title = t;
  }
  if (b.body !== undefined) out.body = String(b.body ?? '').slice(0, 10000);
  if (!partial || b.kind !== undefined) out.kind = KINDS.includes(b.kind as never) ? b.kind : 'task';
  if (b.barberId !== undefined) out.barber_id = b.barberId ? String(b.barberId) : null;
  if (b.dueDay !== undefined) {
    if (b.dueDay && !isDay(String(b.dueDay))) throw new HttpError(400, 'invalid_day');
    out.due_day = b.dueDay ? String(b.dueDay) : null;
  }
  return out;
}

notesRoutes.get('/notes', async (c) => {
  const [w, binds] = scope(c);
  const status = c.req.query('status');
  const extra = status === 'open' ? ' AND n.done_at IS NULL' : status === 'done' ? ' AND n.done_at IS NOT NULL' : '';
  const r = await c.env.DB.prepare(
    `${SELECT} WHERE ${w}${extra} ORDER BY (n.done_at IS NOT NULL), coalesce(n.due_day, '9999'), n.created_at DESC LIMIT 300`,
  )
    .bind(...binds)
    .all<Row>();
  return c.json(r.results.map(note));
});

notesRoutes.post('/notes', async (c) => {
  if (!isManager(c)) throw new HttpError(403, 'no_permission');
  const v = clean(await c.req.json(), false);
  if (v.barber_id && !(await c.env.DB.prepare('SELECT 1 FROM barbers WHERE id = ?').bind(v.barber_id).first())) throw new HttpError(400, 'invalid_barber');
  const id = 'nt_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await c.env.DB.prepare('INSERT INTO staff_notes (id, kind, title, body, barber_id, due_day, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, v.kind, v.title, v.body ?? '', v.barber_id ?? null, v.due_day ?? null, c.get('admin').adminId)
    .run();
  return c.json(note(await load(c, id)), 201);
});

notesRoutes.patch('/notes/:id', async (c) => {
  const id = c.req.param('id')!;
  await load(c, id);
  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof b.done === 'boolean') {
    sets.push('done_at = ?', 'done_by = ?');
    binds.push(b.done ? iso(new Date()) : null, b.done ? c.get('admin').adminId : null);
  }
  const edits = Object.keys(b).some((k) => k !== 'done');
  if (edits) {
    if (!isManager(c)) throw new HttpError(403, 'no_permission');
    const v = clean(b, true);
    if (v.barber_id && !(await c.env.DB.prepare('SELECT 1 FROM barbers WHERE id = ?').bind(v.barber_id).first())) throw new HttpError(400, 'invalid_barber');
    for (const [k, val] of Object.entries(v)) {
      sets.push(`${k} = ?`);
      binds.push(val);
    }
  }
  if (sets.length) await c.env.DB.prepare(`UPDATE staff_notes SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...binds, iso(new Date()), id).run();
  return c.json(note(await load(c, id)));
});

notesRoutes.delete('/notes/:id', async (c) => {
  if (!isManager(c)) throw new HttpError(403, 'no_permission');
  const r = await c.env.DB.prepare('DELETE FROM staff_notes WHERE id = ?').bind(c.req.param('id')).run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found');
  return c.json({ ok: true });
});
