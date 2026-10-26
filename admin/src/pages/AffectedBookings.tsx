import { useState } from 'react';
import { api, type Booking } from '../api';
import { Modal, useAction } from '../ui';
import { date, time } from '../util';

/**
 * După o zi liberă, un bloc sau un program nou: programările deja făcute care au rămas în afara programului.
 * Nu se anulează singure. Proprietarul alege: le anulează (clientul primește mesajul de anulare, iar plata online se returnează)
 * sau le păstrează (le mută el din calendar, ori le onorează oricum).
 */
export function AffectedBookings({ list, what, onClose }: { list: Booking[]; what: string; onClose: () => void }) {
  const [left, setLeft] = useState(list);
  const [done, setDone] = useState(0);
  const { busy, error, run } = useAction();

  const cancel = (ids: string[]) =>
    run(async () => {
      for (const id of ids) {
        await api('PATCH', `/admin/bookings/${id}`, { status: 'cancelled' });
        setLeft((l) => l.filter((b) => b.id !== id));
        setDone((n) => n + 1);
      }
    });

  return (
    <Modal title="Programări în afara programului" onClose={onClose}>
      <div className="grid">
        <p style={{ margin: 0 }}>
          {what}{' '}
          {left.length === 1 ? 'O programare deja făcută cade acum în afara programului.' : `${left.length} programări deja făcute cad acum în afara programului.`} Ele nu se
          anulează singure: clientul o să vină dacă nu faci nimic.
        </p>
        {left.length ? (
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <tbody>
                {left.map((b) => (
                  <tr key={b.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {date(b.start)}, {time(b.start)}
                    </td>
                    <td>{b.clientName || 'Fără nume'}</td>
                    <td className="muted">
                      {b.serviceName} · {b.barberName}
                      {b.status === 'requested' ? ' · cerere' : ''}
                    </td>
                    <td>
                      <button className="ghost sm" disabled={busy} onClick={() => cancel([b.id])}>
                        Anulează
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {done ? <div className="success small">{done === 1 ? 'Am anulat o programare; clientul a primit mesajul de anulare.' : `Am anulat ${done} programări; clienții au primit mesajul de anulare.`}</div> : null}
        {error ? <div className="err">{error}</div> : null}
        <div className="row">
          {left.length ? (
            <button className="danger" disabled={busy} onClick={() => cancel(left.map((b) => b.id))}>
              {left.length === 1 ? 'Anulează și anunță clientul' : `Anulează toate ${left.length} și anunță clienții`}
            </button>
          ) : null}
          <button className="ghost" disabled={busy} onClick={onClose}>
            {left.length ? 'Le păstrez (le mut eu din calendar)' : 'Gata'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
