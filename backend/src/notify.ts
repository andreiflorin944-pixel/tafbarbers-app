import type { Env } from './env';

type Log = {
  channel: 'sms' | 'email' | 'push';
  kind: string;
  recipient: string;
  bookingId?: string | null;
  campaignId?: string | null;
};

async function log(env: Env, l: Log, ok: boolean, error?: string) {
  await env.DB.prepare(
    'INSERT INTO message_log (channel, kind, recipient, booking_id, campaign_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(l.channel, l.kind, l.recipient, l.bookingId ?? null, l.campaignId ?? null, ok ? 'sent' : 'failed', error ?? null)
    .run();
}

/**
 * SMS prin SMSAdvert (smsadvert.ro). Fără cheie configurată, mesajul doar se jurnalizează
 * (mod test), ca restul fluxului să poată fi încercat.
 */
export async function sendSms(env: Env, l: Omit<Log, 'channel'>, text: string): Promise<boolean> {
  const entry = { ...l, channel: 'sms' as const };
  if (!env.SMSADVERT_TOKEN) {
    console.log(`[sms:test] ${l.recipient}: ${text}`);
    await log(env, entry, true, 'test-mode');
    return true;
  }
  try {
    const res = await fetch('https://www.smsadvert.ro/api/sms/', {
      method: 'POST',
      headers: { Authorization: env.SMSADVERT_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: l.recipient, shortTextMessage: text, sendAsShort: true }),
    });
    // Răspuns OK: {"successMessage": "...", "msgId": "..."}; altfel apare un mesaj de eroare.
    const raw = await res.text();
    let json: { successMessage?: string; errorMessage?: string } = {};
    try {
      json = JSON.parse(raw);
    } catch {
      // răspuns ne-JSON: îl păstrăm în jurnal
    }
    const ok = res.ok && !!json.successMessage;
    await log(env, entry, ok, ok ? undefined : `HTTP ${res.status}: ${(json.errorMessage ?? raw).slice(0, 300)}`);
    return ok;
  } catch (e) {
    await log(env, entry, false, String(e));
    return false;
  }
}

/** E-mail prin Resend (resend.com). Fără cheie: mod test, doar jurnalizare. */
export async function sendEmail(
  env: Env,
  l: Omit<Log, 'channel'>,
  subject: string,
  html: string,
): Promise<boolean> {
  const entry = { ...l, channel: 'email' as const };
  if (!env.EMAIL_API_KEY) {
    console.log(`[email:test] ${l.recipient}: ${subject}`);
    await log(env, entry, true, 'test-mode');
    return true;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? 'TAFBarbers <oferte@tafbarbers.ro>',
        to: [l.recipient],
        subject,
        html,
      }),
    });
    await log(env, entry, res.ok, res.ok ? undefined : `HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    await log(env, entry, false, String(e));
    return false;
  }
}

/** Push prin serviciul Expo; acceptă până la 100 de token-uri pe cerere. */
export async function sendPush(
  env: Env,
  l: Omit<Log, 'channel' | 'recipient'>,
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<number> {
  let sent = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch.map((to) => ({ to, title, body, data, sound: 'default' }))),
      });
      const json = (await res.json().catch(() => null)) as { data?: Array<{ status: string; details?: { error?: string } }> } | null;
      for (const [k, r] of (json?.data ?? []).entries()) {
        const ok = r.status === 'ok';
        if (ok) sent++;
        await log(env, { ...l, channel: 'push', recipient: batch[k] }, ok, ok ? undefined : r.details?.error);
        // Token-uri dezinstalate: le scoatem ca să nu mai încercăm.
        if (r.details?.error === 'DeviceNotRegistered') {
          await env.DB.prepare('DELETE FROM push_tokens WHERE token = ?').bind(batch[k]).run();
        }
      }
    } catch (e) {
      for (const t of batch) await log(env, { ...l, channel: 'push', recipient: t }, false, String(e));
    }
  }
  return sent;
}
