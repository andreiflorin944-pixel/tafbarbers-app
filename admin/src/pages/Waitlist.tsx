import { useState } from 'react';
import { api, type Me } from '../api';
import { Loading, useAction, useLoad } from '../ui';
import { addDays, date, longDate, time, today } from '../util';

type Entry = {
  id: string;
  serviceName: string;
  barberId: string | null;
  barberName: string | null;
  day: string;
  part: 'any' | 'morning' | 'afternoon' | 'evening';
  status: 'waiting' | 'notified' | 'booked' | 'expired' | 'removed';
  notifyCount: number;
  maxNotices: number;
  active: boolean;
  lastNotifiedAt: string | null;
  lastSlot: string | null;
  removedBy: 'client' | 'staff' | null;
  createdAt: string;
  clientName: string;
  clientPhone?: string;
};

const PART: Record<Entry['part'], string> = { any: 'Oricând', morning: 'Dimineața (până la 12)', afternoon: 'După-amiaza (12–17)', evening: 'Seara (după 17)' };
// Culorile etichetelor refolosesc stările existente din panou.
const PILL: Record<Entry['status'], string> = { waiting: 'ready', notified: 'new', booked: 'completed', expired: 'off', removed: 'off' };

function statusText(e: Entry) {
  if (e.status === 'waiting') return 'Așteaptă';
  if (e.status === 'notified') return e.active ? `Anunțat (${e.notifyCount} din ${e.maxNotices})` : `Anunțat de ${e.notifyCount} ori, gata`;
  if (e.status === 'booked') return 'S-a programat';
  if (e.status === 'expired') return 'Ziua a trecut';
  return e.removedBy === 'staff' ? 'Scos din panou' : 'Scos de client';
}

export function WaitlistPage({ me }: { me: Me }) {
  const [all, setAll] = useState(false);
  const from = all ? addDays(today(), -14) : today();
  const data = useLoad(() => api<Entry[]>('GET', `/admin/waitlist?from=${from}${all ? '&all=1' : ''}`), [all, from]);
  const { error, run } = useAction();
  const canRemove = me.permissions.bookings_manage;

  const remove = (e: Entry) =>
    confirm(`Scoți ${e.clientName || 'clientul'} de pe lista de așteptare din ${longDate(`${e.day}T12:00:00Z`)}? Nu mai primește mesaj.`) &&
    run(async () => {
      await api('DELETE', `/admin/waitlist/${e.id}`);
      data.reload();
    });

  // Pe zile, în ordinea înscrierii (cine s-a înscris primul e anunțat primul).
  const days = new Map<string, Entry[]>();
  for (const e of data.data ?? []) days.set(e.day, [...(days.get(e.day) ?? []), e]);

  return (
    <>
      <div className="head">
        <h1>Listă de așteptare</h1>
        <label className="check small">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Arată și cele închise (ultimele 2 săptămâni)
        </label>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Clienții care n-au găsit oră liberă cer din aplicație să fie anunțați dacă se eliberează un loc în ziua aceea. Când se eliberează o oră (anulare,
        cerere refuzată sau expirată, program schimbat), primii 3 înscriși primesc mesajul „S-a eliberat un loc”; dacă după 10 minute ora e tot liberă, îl
        primesc următorii. Fiecare e anunțat o singură dată pentru același loc și de cel mult 3 ori în total. Nu se face nicio programare automată: clientul
        rezervă singur din aplicație. Textul se schimbă din Șabloane de mesaje, iar canalele din Notificări.
      </p>
      {error ? <div className="err">{error}</div> : null}
      {!data.data ? (
        <Loading error={data.error} />
      ) : days.size === 0 ? (
        <p className="muted">{all ? 'Nicio înscriere în perioada asta.' : 'Nimeni nu așteaptă un loc liber acum.'}</p>
      ) : (
        [...days.entries()].map(([day, list]) => (
          <div key={day} className="card table-wrap" style={{ padding: 0, marginBottom: 16 }}>
            <div style={{ padding: '12px 14px', fontWeight: 700 }}>
              {day === today() ? 'Azi · ' : ''}
              {longDate(`${day}T12:00:00Z`)} <span className="muted small">· {list.filter((e) => e.active).length} în așteptare</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Client</th>
                  <th>Serviciu</th>
                  <th>Frizer</th>
                  <th>Interval</th>
                  <th>Stare</th>
                  <th>Înscris</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((e, i) => (
                  <tr key={e.id} style={e.active ? undefined : { opacity: 0.6 }}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      {e.clientName || 'Client'}
                      {e.clientPhone ? (
                        <div className="small">
                          <a href={`tel:${e.clientPhone}`}>{e.clientPhone}</a>
                        </div>
                      ) : null}
                    </td>
                    <td>{e.serviceName}</td>
                    <td>{e.barberName ?? 'Orice frizer'}</td>
                    <td>{PART[e.part]}</td>
                    <td>
                      <span className={`pill ${PILL[e.status]}`}>{statusText(e)}</span>
                      {e.lastNotifiedAt && e.lastSlot ? (
                        <div className="muted small" style={{ marginTop: 4 }}>
                          ultimul mesaj {date(e.lastNotifiedAt)}, {time(e.lastNotifiedAt)} (ora {time(e.lastSlot)})
                        </div>
                      ) : null}
                    </td>
                    <td className="muted small">
                      {date(e.createdAt)}, {time(e.createdAt)}
                    </td>
                    <td>
                      {canRemove && (e.status === 'waiting' || e.status === 'notified') ? (
                        <button className="danger sm" onClick={() => remove(e)}>
                          Scoate
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </>
  );
}
