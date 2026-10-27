import { emailHtml } from './campaigns';
import { getBusiness } from './db';
import type { Env } from './env';
import { deleteClient } from './gdpr';
import { sendEmail, sendPush } from './notify';
import { iso } from './time';

// Conturile nefolosite de 1 an (fără programare, vizită, comandă sau deschiderea aplicației) se șterg, ca la „Șterge contul”.
// Întâi clientul e anunțat pe e-mail și în aplicație; dacă în 30 de zile nu revine, contul se șterge.
// Nu se ating conturile cu abonament activ sau cu card cadou cumpărat și nefolosit.

const DAY = 86_400_000;
export const INACTIVE_DAYS = 365;
const NOTICE_DAYS = 30;
/** Câte anunțuri și câte ștergeri la o rulare (o dată pe zi): fără valuri de mesaje după publicare. */
const WARN_PER_RUN = 100;
const DELETE_PER_RUN = 25;

/** Ultima urmă de activitate a clientului `c` (șirurile ISO și datele AAAA-LL-ZZ se compară corect ca text). */
const LAST_ACTIVE = `max(
  c.created_at,
  coalesce(c.last_active_at, ''),
  coalesce(c.hist_last_visit, ''),
  coalesce((SELECT max(starts_at) FROM bookings WHERE client_id = c.id), ''),
  coalesce((SELECT max(created_at) FROM bookings WHERE client_id = c.id), ''),
  coalesce((SELECT max(created_at) FROM orders WHERE client_id = c.id), '')
)`;

const KEEP = `NOT EXISTS (SELECT 1 FROM subscriptions WHERE client_id = c.id AND status = 'active' AND ends_at > ?1)
  AND NOT EXISTS (SELECT 1 FROM gift_cards WHERE buyer_client_id = c.id AND status = 'active' AND balance_bani > 0)`;

const TEXT: Record<'ro' | 'en' | 'fr', { title: string; body: (shop: string, date: string) => string }> = {
  ro: {
    title: 'Contul tău va fi șters',
    body: (shop, date) =>
      `Nu ai mai folosit contul ${shop} de peste un an. Ca să nu păstrăm date de care nu mai e nevoie, contul tău se va șterge pe ${date}. Dacă vrei să-l păstrezi, deschide aplicația sau fă o programare până atunci.`,
  },
  en: {
    title: 'Your account will be deleted',
    body: (shop, date) =>
      `You have not used your ${shop} account for over a year. So that we do not keep data we no longer need, your account will be deleted on ${date}. To keep it, open the app or make a booking before then.`,
  },
  fr: {
    title: 'Votre compte sera supprimé',
    body: (shop, date) =>
      `Vous n’avez pas utilisé votre compte ${shop} depuis plus d’un an. Pour ne pas garder de données inutiles, votre compte sera supprimé le ${date}. Pour le garder, ouvrez l’application ou prenez rendez-vous d’ici là.`,
  },
};

export async function cleanInactive(env: Env, now: number) {
  const nowIso = iso(new Date(now));
  const cutoff = iso(new Date(now - INACTIVE_DAYS * DAY));

  // Anunțul revine dacă între timp clientul a fost activ: atunci data anunțului e mai veche decât activitatea.
  await env.DB.prepare(`UPDATE clients AS c SET inactive_warned_at = NULL WHERE inactive_warned_at IS NOT NULL AND ${LAST_ACTIVE} > inactive_warned_at`).run();

  // 1. Ștergerea: anunțați de cel puțin 30 de zile și tot nefolosiți.
  const due = await env.DB.prepare(
    `SELECT c.id FROM clients c WHERE c.deleted_at IS NULL AND c.inactive_warned_at IS NOT NULL AND c.inactive_warned_at < ?2
       AND ${LAST_ACTIVE} < ?3 AND ${KEEP} LIMIT ${DELETE_PER_RUN}`,
  )
    .bind(nowIso, iso(new Date(now - NOTICE_DAYS * DAY)), cutoff)
    .all<{ id: string }>();
  for (const r of due.results) {
    try {
      await deleteClient(env, r.id);
    } catch (e) {
      console.error('inactive delete', r.id, e);
    }
  }

  // 2. Anunțul: e-mail (mesaj de serviciu) și notificare în aplicație; fără SMS.
  const warn = await env.DB.prepare(
    `SELECT c.id, c.email, c.lang FROM clients c WHERE c.deleted_at IS NULL AND c.inactive_warned_at IS NULL AND ${LAST_ACTIVE} < ?2 AND ${KEEP}
     ORDER BY c.created_at LIMIT ${WARN_PER_RUN}`,
  )
    .bind(nowIso, cutoff)
    .all<{ id: string; email: string | null; lang: string }>();
  if (!warn.results.length) return { deleted: due.results.length, warned: 0 };
  const shop = (await getBusiness(env)).name;
  const on = new Date(now + NOTICE_DAYS * DAY);
  for (const c of warn.results) {
    // Marcat întâi, ca o rulare suprapusă să nu trimită de două ori.
    const claimed = await env.DB.prepare('UPDATE clients SET inactive_warned_at = ? WHERE id = ? AND inactive_warned_at IS NULL').bind(nowIso, c.id).run();
    if (!claimed.meta.changes) continue;
    const lang = c.lang === 'en' || c.lang === 'fr' ? c.lang : 'ro';
    const t = TEXT[lang];
    const date = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang === 'fr' ? 'fr-FR' : 'ro-RO', { timeZone: env.TIMEZONE, day: 'numeric', month: 'long', year: 'numeric' }).format(on);
    const body = t.body(shop, date);
    try {
      if (c.email) await sendEmail(env, { kind: 'inactive', recipient: c.email }, t.title, emailHtml(shop, t.title, body, true, lang));
      const tokens = (await env.DB.prepare('SELECT token FROM push_tokens WHERE client_id = ?').bind(c.id).all<{ token: string }>()).results.map((x) => x.token);
      if (tokens.length) await sendPush(env, { kind: 'inactive' }, tokens, t.title, body, { screen: 'home' });
    } catch (e) {
      console.error('inactive warn', c.id, e);
    }
  }
  return { deleted: due.results.length, warned: warn.results.length };
}
