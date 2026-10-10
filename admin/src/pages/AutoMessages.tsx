import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { useLoad } from '../ui';

type Channel = { enabled: boolean; push: boolean; sms: boolean; email: boolean };
type Key = 'confirm' | 'reminder_24h' | 'reminder_2h' | 'cancel' | 'review' | 'otpSms';
type Automations = { channels: Record<Exclude<Key, 'otpSms'>, Channel>; otpSms: boolean };

const ITEMS: Array<{ k: Key; label: string; hint?: string }> = [
  { k: 'confirm', label: 'Confirmare programare', hint: 'Pleacă imediat după ce se face programarea.' },
  { k: 'reminder_24h', label: 'Reminder cu o zi înainte' },
  { k: 'reminder_2h', label: 'Reminder cu 2 ore înainte' },
  { k: 'cancel', label: 'Anulare', hint: 'Când salonul anulează o programare.' },
  { k: 'review', label: 'Cerere de recenzie', hint: 'Când apeși „Cere recenzie” după o tunsoare.' },
  { k: 'otpSms', label: 'Cod de intrare prin SMS', hint: 'Codul de intrare în cont vine întâi pe e-mail.' },
];

const channelNames = (c: Channel) => [c.sms && 'SMS', c.push && 'Push', c.email && 'E-mail'].filter(Boolean).join(' · ');

/**
 * Tablou de bord → Mesaje automate: un comutator pe mesaj, salvat pe loc. Oprit = nu pleacă nimic, pe niciun canal;
 * canalele bifate la Notificări rămân păstrate, așa că la repornire mesajul pleacă din nou pe aceleași.
 */
export function AutoMessagesCard() {
  const load = useLoad(() => api<Automations>('GET', '/admin/automations'));
  const [a, setA] = useState<Automations | null>(null);
  const [busy, setBusy] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState(false);

  useEffect(() => {
    if (load.data) setA(load.data);
  }, [load.data]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!a) return load.error ? <p className="err">{load.error}</p> : null;
  const isOn = (k: Key) => (k === 'otpSms' ? a.otpSms : a.channels[k].enabled);

  const flip = async (k: Key, enabled: boolean) => {
    const before = a;
    // Se vede pe loc; dacă salvarea nu reușește, comutatorul revine.
    setA(k === 'otpSms' ? { ...a, otpSms: enabled } : { ...a, channels: { ...a.channels, [k]: { ...a.channels[k], enabled } } });
    setBusy(k);
    setError(null);
    try {
      const r = await api<Automations>('PUT', '/admin/automations/switch', { key: k, enabled });
      setA(r);
      setToast(true);
    } catch (e) {
      setA(before);
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const line = (k: Key) => {
    if (k === 'otpSms') return a.otpSms ? 'Clientul îl poate cere și prin SMS, dacă nu-i vine e-mailul.' : 'Codul vine doar pe e-mail.';
    const c = a.channels[k];
    const names = channelNames(c);
    if (!c.enabled) return names ? `Oprit: nu se trimite nimic. Când îl pornești, pleacă pe ${names}.` : 'Oprit: nu se trimite nimic.';
    return names ? `Pleacă pe: ${names}.` : null;
  };

  return (
    <div className="card auto-msgs" style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0 }}>Mesaje automate</h2>
      <p className="muted small" style={{ marginTop: -6 }}>
        Ce mesaje primesc clienții singuri. Oprit înseamnă că nu pleacă nimic, nici SMS, nici push, nici e-mail. Se salvează imediat.
      </p>
      <div className="grid two" style={{ gap: '12px 24px' }}>
        {ITEMS.map((it) => {
          const on = isOn(it.k);
          const l = line(it.k);
          const noChannel = it.k !== 'otpSms' && on && !l;
          return (
            <div key={it.k} className="auto-msg" title={it.hint}>
              <label className="switch">
                <input type="checkbox" role="switch" aria-label={it.label} checked={on} disabled={busy === it.k} onChange={(e) => flip(it.k, e.target.checked)} />
                <span />
              </label>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, opacity: on ? 1 : 0.6 }}>{it.label}</div>
                <div className={noChannel ? 'err small' : 'muted small'}>
                  {noChannel ? 'Niciun canal ales, așa că nu pleacă nimic.' : l}
                  {it.k !== 'otpSms' ? (
                    <>
                      {' '}
                      <a href="#/notifications/canale">Alege canalele</a>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {error ? <div className="err" style={{ marginTop: 10 }}>{error}</div> : null}
      {toast ? (
        <div className="toast saved" role="status">
          <b>Salvat</b>
        </div>
      ) : null}
    </div>
  );
}
