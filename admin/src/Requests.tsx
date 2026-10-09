import { useEffect, useRef, useState } from 'react';
import { api, type Booking, type Me } from './api';
import { useAction } from './ui';
import { date, lei, longDate, time } from './util';

// Cererile de programare (când programările din aplicație cer aprobare): clopoțelul din bara de sus,
// cu numărul cererilor în așteptare, un sunet scurt și un mesaj când apare una nouă, plus lista cu Acceptă / Refuză.

const POLL_MS = 20_000;
/** Calendarul ascultă evenimentul ăsta ca să se reîncarce când se schimbă o cerere. */
export const BOOKINGS_CHANGED = 'taf:bookings-changed';
export const bookingsChanged = (from?: 'bell') => window.dispatchEvent(new CustomEvent(BOOKINGS_CHANGED, { detail: from }));

const QUICK_REASONS = ['Frizerul nu e disponibil atunci.', 'Salonul e închis atunci.', 'Te rugăm să alegi altă oră.'];

// Sunetul: un „ding-ding” scurt generat din browser (Web Audio), fără fișier audio.
// Browserele pornesc sunetul doar după un click pe pagină, așa că pregătim contextul la primul click.
let audio: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
    return audio;
  } catch {
    return null;
  }
}
export function beep() {
  const ctx = audioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const s = t0 + i * 0.18;
    gain.gain.setValueAtTime(0.0001, s);
    gain.gain.exponentialRampToValueAtTime(0.25, s + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(s);
    osc.stop(s + 0.17);
  });
}

type Requests = { count: number; items: Booking[] };

export function RequestsBell({ me }: { me: Me }) {
  const [data, setData] = useState<Requests | null>(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const allowed = me.owner || me.permissions.bookings_manage;

  const load = async () => {
    try {
      const r = await api<Requests>('GET', '/admin/bookings/requests');
      // Sunet și mesaj doar pentru cererile apărute de la ultima verificare (nu la prima încărcare a panoului).
      const fresh = seen.current ? r.items.filter((b) => !seen.current!.has(b.id)) : [];
      seen.current = new Set(r.items.map((b) => b.id));
      setData(r);
      if (fresh.length) {
        beep();
        const b = fresh[0];
        setToast(
          fresh.length === 1
            ? `Cerere nouă: ${b.clientName || 'Client'} · ${b.serviceName} · ${date(b.start)}, ${time(b.start)}`
            : `${fresh.length} cereri noi de programare`,
        );
        bookingsChanged('bell');
      }
    } catch {
      // fără rețea: încercăm din nou la următoarea verificare
    }
  };

  useEffect(() => {
    if (!allowed) return;
    void load();
    // Verificăm și cu fila în fundal (browserul o rărește la ~1 minut): tocmai atunci contează sunetul și numărul din titlu.
    const t = setInterval(() => void load(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    const unlock = () => audioCtx();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(BOOKINGS_CHANGED, onChanged);
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(BOOKINGS_CHANGED, onChanged);
      window.removeEventListener('pointerdown', unlock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  // Când se răspunde la o cerere din calendar, clopoțelul se actualizează imediat.
  function onChanged(e?: Event) {
    if ((e as CustomEvent | undefined)?.detail === 'bell') return;
    void api<Requests>('GET', '/admin/bookings/requests').then((r) => {
      seen.current = new Set([...(seen.current ?? []), ...r.items.map((b) => b.id)]);
      setData(r);
    }, () => undefined);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // Numărul apare și în titlul filei, ca să se vadă și când panoul e într-o filă din spate.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = data?.count ? `(${data.count}) ${base}` : base;
  }, [data?.count]);

  if (!allowed) return null;
  const n = data?.count ?? 0;

  return (
    <>
      <button
        className={`bell${n ? ' on' : ''}`}
        onClick={() => setOpen(true)}
        title={n ? `${n} ${n === 1 ? 'cerere' : 'cereri'} de programare în așteptare` : 'Nicio cerere de programare în așteptare'}
        aria-label={`Cereri de programare: ${n}`}
      >
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4" />
        </svg>
        {n ? <span className="bell-n">{n > 99 ? '99+' : n}</span> : null}
      </button>
      {toast ? (
        <button className="toast" onClick={() => (setOpen(true), setToast(null))}>
          <b>🔔 {toast}</b>
          <span className="muted small">Apasă ca să răspunzi</span>
        </button>
      ) : null}
      {open ? (
        <>
          <div className="drawer-back" onMouseDown={() => setOpen(false)} />
          <aside className="drawer" role="dialog" aria-label="Cereri de programare">
            <div className="drawer-head">
              <div>
                <div className="drawer-time">Cereri de programare</div>
                <div className="muted small">{n ? `${n} în așteptare · se verifică singur la 20 de secunde` : 'Nicio cerere în așteptare'}</div>
              </div>
              <button className="ghost sm" onClick={() => setOpen(false)} aria-label="Închide">
                ✕
              </button>
            </div>
            <div className="drawer-body">
              {!data ? (
                <p className="muted">Se încarcă…</p>
              ) : !data.items.length ? (
                <p className="muted small">
                  Când un client face o programare din aplicație și ea cere aprobare, apare aici. Ora rămâne rezervată până răspunzi; dacă nu răspunde nimeni
                  până la ora programării, cererea se anulează singură și clientul e anunțat.
                </p>
              ) : (
                data.items.map((b) => (
                  <div key={b.id} className="drawer-card" style={{ gap: 6 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong>{b.clientName || b.clientPhone || 'Client'}</strong>
                      <span className="pill requested">în așteptare</span>
                    </div>
                    <div className="small" style={{ textTransform: 'capitalize' }}>
                      {longDate(b.start)}, {time(b.start)}–{time(b.end)}
                    </div>
                    <div className="muted small">
                      {b.serviceName} · {b.barberName} · {lei(b.price)}
                    </div>
                    {b.clientPhone ? (
                      <a className="small" href={`tel:${b.clientPhone}`}>
                        {b.clientPhone}
                      </a>
                    ) : null}
                    {b.note ? <div className="small">„{b.note}”</div> : null}
                    <RequestActions b={b} onDone={() => bookingsChanged()} />
                  </div>
                ))
              )}
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}

/** Butoanele Acceptă / Refuză (cu motiv) ale unei cereri; folosite în lista clopoțelului și în calendar. */
export function RequestActions({ b, onDone }: { b: Booking; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const accept = () =>
    run(async () => {
      await api('POST', `/admin/bookings/${b.id}/accept`);
      onDone();
    });
  const refuse = () =>
    run(async () => {
      await api('POST', `/admin/bookings/${b.id}/refuse`, { reason });
      onDone();
    });
  return (
    <div className="grid" style={{ gap: 6 }}>
      {!refusing ? (
        <div className="row" style={{ gap: 6 }}>
          <button className="sm" disabled={busy} onClick={accept}>
            ✓ Acceptă
          </button>
          <button className="danger sm" disabled={busy} onClick={() => setRefusing(true)}>
            Refuză
          </button>
        </div>
      ) : (
        <>
          <label className="f small">
            Motivul (îl primește clientul în mesaj; poate rămâne gol)
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="ex. Frizerul nu e disponibil atunci." autoFocus />
          </label>
          <div className="row" style={{ gap: 4 }}>
            {QUICK_REASONS.map((r) => (
              <button key={r} type="button" className="ghost sm" onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="danger sm" disabled={busy} onClick={refuse}>
              Trimite refuzul
            </button>
            <button className="ghost sm" disabled={busy} onClick={() => setRefusing(false)}>
              Înapoi
            </button>
          </div>
        </>
      )}
      {error ? <div className="err small">{error}</div> : null}
    </div>
  );
}

