import { useEffect, useRef, useState } from 'react';
import { api, errorText, type Barber, type Booking, type BookingActivity, type Checkout, type Location, type Service, type Slot } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';
import { bookingsChanged, RequestActions, sentText } from '../Requests';
import { dayOf, lei, localToIso, longDate, STATUS, time } from '../util';

/** Iconițele mici din panoul programării (fișa clientului, programări, WhatsApp, notiță, telefon). */
const ICONS: Record<string, string> = {
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  calendar: 'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  chat: 'M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z',
  note: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6m-6 4h4',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  ban: 'M5.6 5.6l12.8 12.8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  card: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h3',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6l1-8Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Zm5-5h.01',
  pin: 'M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm10-14l4 4',
  image: 'M4 5h16v14H4V5Zm0 11 4.5-4.5 4 4 2.5-2.5L20 17M15 9.5h.01',
  coffee: 'M5 9h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Zm11 1h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3m3-3v3m3-3v3',
  chevL: 'M15 6l-6 6 6 6',
  chevR: 'M9 6l6 6-6 6',
};
export function Icon({ name, size = 18 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

const SOURCE: Record<string, string> = { admin: 'din panou', app: 'de client, din aplicație', web: 'de client, de pe site' };
const MSG_KIND: Record<string, string> = {
  confirm: 'Confirmarea programării',
  reminder_24h: 'Reminder cu o zi înainte',
  reminder_2h: 'Reminder cu 2 ore înainte',
  cancel: 'Programare anulată',
  booking_moved: 'Programare mutată',
  booking_request: 'Cerere primită',
  booking_request_refused: 'Cerere refuzată',
  booking_request_expired: 'Cerere expirată',
  review: 'Cerere de recenzie',
  pay_request: 'Cerere de plată',
};
const CHANNEL: Record<string, string> = { sms: 'SMS', push: 'notificare', email: 'e-mail' };
const METHOD: Record<string, string> = { cash: 'numerar', card: 'card (POS)', transfer: 'transfer', online: 'online', app: 'în aplicație' };
const when = (iso: string) => `${dayOf(iso).split('-').reverse().join('.')} ${time(iso)}`;

/** O linie din jurnalul programării, în cuvinte. */
function logText(e: BookingActivity['log'][number]) {
  const d = e.detail ?? {};
  const s = (k: string) => String(d[k] ?? '');
  switch (e.kind) {
    case 'created':
      return `Creată ${SOURCE[s('source')] ?? ''}`.trim();
    case 'accepted':
      return 'Cerere acceptată';
    case 'refused':
      return 'Cerere refuzată';
    case 'expired':
      return 'Cerere expirată: nimeni n-a răspuns la timp';
    case 'moved':
      return `Mutată: ${when(s('from'))} → ${when(s('to'))}${d.toBarber ? ` · ${s('fromBarber')} → ${s('toBarber')}` : ''}`;
    case 'service':
      return `Serviciu schimbat: ${s('from')} → ${s('to')}`;
    case 'price':
      return `Preț schimbat: ${lei(Number(d.from))} → ${lei(Number(d.to))}${d.discount ? ` (reducere ${s('discount')})` : ''}`;
    case 'no_show':
      return 'Marcată: nu a venit';
    case 'reopened':
      return 'Readusă la confirmată';
    case 'uncompleted':
      return 'Confirmarea plății a fost anulată';
    case 'pay_requested':
      return `Plată cerută în aplicație: ${lei(Number(d.amount))}`;
    case 'completed':
      return `Încheiată${d.payment === 'subscription' ? ', pe abonament' : ''}`;
    case 'cancelled':
      return d.by === 'client' ? 'Anulată de client' : 'Anulată de salon';
    case 'review_sent':
      return 'Cerere de recenzie trimisă';
    default:
      return e.kind;
  }
}

function payText(p: BookingActivity['payments'][number]) {
  switch (p.kind) {
    case 'salon':
      return `Plătit la salon: ${lei(p.amount ?? 0)}, ${METHOD[p.method ?? 'cash'] ?? p.method}${p.gift ? ` + ${lei(p.gift)} card cadou` : ''}${p.tip ? ` · bacșiș ${lei(p.tip)}` : ''}`;
    case 'subscription':
      return 'Pe abonament';
    case 'request':
      return `Plată cerută în aplicație: ${lei(p.amount ?? 0)}${p.status === 'open' ? ' · încă neplătită' : ''}`;
    case 'online':
      return `Plătit online, cu cardul: ${lei(p.amount ?? 0)}${p.status === 'to_refund' ? ' · de returnat' : ''}`;
    case 'refund':
      return `Returnat pe card: ${lei(p.amount ?? 0)}${p.note ? ` (${p.note})` : ''}`;
    default:
      return p.kind;
  }
}

type Edit = null | 'time' | 'barber' | 'service' | 'price' | 'discount';

/**
 * Panoul din dreapta, la click pe o programare (ca în Barberly): clientul, data și ora, frizerul, serviciul și prețul,
 * care se pot schimba și se salvează cu „Salvează modificările”; „Acțiuni” are starea (încheiată, nu a venit, anulează),
 * plata și clientul; jos, jurnalul, plățile și mesajele trimise.
 */
export function BookingPanel({
  b: initial,
  color,
  canManage,
  allBarbers,
  owner,
  online,
  barbers,
  services,
  locations,
  startCheckout,
  onClose,
  onChange,
}: {
  b: Booking;
  color: string;
  canManage: boolean;
  /** Poate da programarea altui frizer (vede toate programările). */
  allBarbers: boolean;
  owner: boolean;
  online: boolean;
  barbers: Barber[];
  services: Service[];
  locations: Location[];
  /** Deschis din ✓ de pe calendar: pornește direct la încasare. */
  startCheckout?: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  // Panoul rămâne deschis după salvare sau după cererea de plată: ținem aici varianta primită de la server.
  const [b, setB] = useState(initial);
  const { busy, error, run } = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<'log' | 'pay' | 'msg'>('log');
  const [edit, setEdit] = useState<Edit>(null);
  const [checkout, setCheckout] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const activity = useLoad(() => api<BookingActivity>('GET', `/admin/bookings/${b.id}/activity`), [b.id]);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const payRef = useRef<HTMLDivElement>(null);

  // Ce s-a schimbat și nu e încă salvat.
  const [day, setDay] = useState(dayOf(b.start));
  const [start, setStart] = useState(b.start);
  const [force, setForce] = useState(false);
  const [forceTime, setForceTime] = useState(time(b.start));
  const [barberId, setBarberId] = useState(b.barberId);
  const [serviceId, setServiceId] = useState(b.serviceId);
  const [price, setPrice] = useState(b.price);
  const [priceTouched, setPriceTouched] = useState(false);
  const [discount, setDiscount] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [note, setNote] = useState(b.note);
  const reset = (nb: Booking) => {
    setDay(dayOf(nb.start));
    setStart(nb.start);
    setForce(false);
    setForceTime(time(nb.start));
    setBarberId(nb.barberId);
    setServiceId(nb.serviceId);
    setPrice(nb.price);
    setPriceTouched(false);
    setDiscount(null);
    setNote(nb.note);
    setEdit(null);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) setMenu(false);
      else onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, menu]);

  const past = Date.parse(b.start) < Date.now();
  const canComplete = past && (b.status === 'confirmed' || (b.status === 'completed' && !b.payment));
  const editable = canManage && b.status === 'confirmed' && !checkout;
  useEffect(() => {
    if (startCheckout && canComplete && canManage) setCheckout(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const barber = barbers.find((x) => x.id === barberId);
  const service = services.find((x) => x.id === serviceId);
  const loc = locations.find((l) => l.id === (barberId !== b.barberId ? barber?.locationId : b.locationId)) ?? locations.find((l) => l.active);
  const sameAsSaved = barberId === b.barberId && serviceId === b.serviceId;
  const durMin = sameAsSaved ? Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60000) : (barber?.durations?.[serviceId] ?? service?.durationMin ?? 30);
  // Prețul urmează serviciul (și prețul propriu al frizerului), cât timp nu l-ai schimbat de mână.
  const listPrice = sameAsSaved ? b.price : (barber?.prices?.[serviceId] ?? service?.price ?? b.price);
  useEffect(() => {
    if (!priceTouched) setPrice(listPrice);
  }, [listPrice, priceTouched]);

  const effStart = force ? localToIso(day, forceTime) : start;
  const moved = effStart !== b.start || barberId !== b.barberId;
  const changed = moved || serviceId !== b.serviceId || price !== b.price;
  const dirty = changed || note !== b.note;
  const effEnd = effStart ? new Date(Date.parse(effStart) + durMin * 60000).toISOString() : '';

  // Orele libere ale zilei alese (ora de acum a programării contează ca liberă).
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const needSlots = editable && (edit === 'time' || (moved && !force) || serviceId !== b.serviceId);
  useEffect(() => {
    if (!needSlots || force) return;
    setSlots(null);
    api<Slot[]>('GET', `/availability?serviceId=${serviceId}&barberId=${barberId}&day=${day}&exclude=${b.id}`).then(setSlots, () => setSlots([]));
  }, [needSlots, force, serviceId, barberId, day, b.id]);
  const slotOk = !moved && serviceId === b.serviceId ? true : force || !!slots?.some((s) => s.start === effStart);

  const set = (patch: Record<string, string>, close = true) =>
    run(async () => {
      const nb = await api<Booking>('PATCH', `/admin/bookings/${b.id}`, patch);
      onChange();
      setMenu(false);
      if (close) onClose();
      else {
        setB({ ...b, ...nb });
        reset({ ...b, ...nb });
        activity.reload();
      }
    });
  const save = () =>
    run(async () => {
      const body: Record<string, unknown> = {};
      if (changed) {
        if (effStart !== b.start) body.start = effStart;
        if (barberId !== b.barberId) body.barberId = barberId;
        if (serviceId !== b.serviceId) body.serviceId = serviceId;
        if (price !== b.price) Object.assign(body, { price, ...(discount && { discount }) });
        body.force = force;
        body.notify = notify;
      }
      if (note !== b.note) body.note = note;
      const nb = await api<Booking>('PATCH', `/admin/bookings/${b.id}`, body);
      const next = { ...b, ...nb };
      setB(next);
      reset(next);
      setMsg(moved && notify ? 'Modificările sunt salvate. Clientul a primit mesaj cu noua oră.' : 'Modificările sunt salvate.');
      onChange();
      activity.reload();
    });
  const copy = async (text: string, done: string) => {
    setMenu(false);
    try {
      await navigator.clipboard.writeText(text);
      setMsg(done);
    } catch {
      prompt('Copiază linkul:', text);
    }
  };
  const review = () =>
    run(async () => {
      setMenu(false);
      const r = await api<{ sms: boolean; push: boolean }>('POST', `/admin/bookings/${b.id}/review-request`);
      setMsg(`Cererea de recenzie a plecat${r.sms && r.push ? ' prin SMS și notificare' : r.push ? ' prin notificare' : ' prin SMS'}.`);
      activity.reload();
    });
  const cancel = () => {
    setMenu(false);
    if (confirm('Anulezi programarea? Ora se eliberează și clientul primește mesaj.')) set({ status: 'cancelled' });
  };
  const undoPay = () => {
    setMenu(false);
    if (confirm('Anulezi confirmarea plății? Tunsoarea revine în abonament și bonusul folosit redevine activ.'))
      run(async () => {
        const nb = await api<Booking>('DELETE', `/admin/bookings/${b.id}/complete`);
        setB({ ...b, ...nb });
        onChange();
        activity.reload();
      });
  };
  const startPay = () => {
    setMenu(false);
    setPayOpen(true);
    setTimeout(() => payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const startCheckoutNow = () => {
    setMenu(false);
    setCheckout(true);
    setTimeout(() => payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const digits = b.clientPhone?.replace(/[^\d]/g, '') ?? '';
  const fileLink = `${location.origin}${location.pathname}#/clients/${b.clientId}`;
  const initials = (b.clientName || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const discountOf = (v: string) => {
    const m = v.trim().match(/^(\d+(?:[.,]\d+)?)\s*(%|lei)?$/i);
    if (!m) return null;
    const n = Number(m[1].replace(',', '.'));
    const off = m[2] === '%' ? Math.round((listPrice * n) / 100) : n;
    return off > 0 && off <= listPrice ? { off, label: m[2] === '%' ? `${n}%` : lei(n) } : null;
  };
  const [discountIn, setDiscountIn] = useState('');
  const disc = discountOf(discountIn);
  const showPay = canManage && (payOpen || checkout || !!b.payDue || !!b.onlinePaid || !!b.payment);

  return (
    <>
      <div className="drawer-back" onMouseDown={onClose} />
      <aside className="drawer bk" role="dialog" aria-label="Programare">
        <div className="drawer-head" style={{ borderTopColor: color }}>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <h2 style={{ margin: 0 }}>Programare</h2>
              <span className={`pill ${b.status}`}>{STATUS[b.status]}</span>
            </div>
            <div className="muted small" style={{ textTransform: 'capitalize' }}>
              {longDate(b.start)} · {time(b.start)}
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {canManage ? (
              <button className="ghost sm" onClick={() => setMenu(true)}>
                ··· Acțiuni
              </button>
            ) : null}
            <button className="ghost sm" onClick={onClose} aria-label="Închide">
              ✕
            </button>
          </div>
        </div>

        <div className="drawer-body">
          <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
            <div className="avatar" style={{ background: color }}>
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: 18 }}>{b.clientName || 'Client fără nume'}</strong>
              {b.clientPhone ? (
                <div>
                  <a href={`tel:${b.clientPhone}`}>{b.clientPhone}</a>
                </div>
              ) : null}
            </div>
          </div>
          <div className="row bk-icons">
            <a className="btn ghost sm" href={`#/clients/${b.clientId}`} title="Fișa clientului" aria-label="Fișa clientului">
              <Icon name="person" />
            </a>
            <a className="btn ghost sm" href={`#/clients/${b.clientId}`} title="Programările clientului" aria-label="Programările clientului">
              <Icon name="calendar" />
            </a>
            {b.clientPhone ? (
              <>
                <a className="btn ghost sm" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" title="WhatsApp" aria-label="WhatsApp">
                  <Icon name="chat" />
                </a>
                <a className="btn ghost sm" href={`tel:${b.clientPhone}`} title="Sună" aria-label="Sună">
                  <Icon name="phone" />
                </a>
              </>
            ) : null}
            <button className="ghost sm" onClick={() => noteRef.current?.focus()} title="Notiță internă" aria-label="Notiță internă">
              <Icon name="note" />
            </button>
          </div>
          {b.clientBirthday ? <div className="bday-note">🕯️ E ziua lui de naștere! Urează-i „La mulți ani” și, dacă vrei, fă-i o reducere.</div> : null}

          {b.status === 'requested' ? (
            <div className="drawer-card">
              <div className="small">Clientul a cerut programarea din aplicație și așteaptă confirmarea. Ora e rezervată până răspunzi.</div>
              {canManage ? (
                <RequestActions
                  b={b}
                  online={online}
                  onDone={() => {
                    bookingsChanged();
                    onChange();
                    onClose();
                  }}
                />
              ) : null}
            </div>
          ) : null}
          {b.requestOutcome === 'refused' ? <div className="muted small">Cerere refuzată{b.refuseReason ? `: ${b.refuseReason}` : '.'}</div> : null}
          {b.requestOutcome === 'expired' ? <div className="muted small">Cererea a expirat: nimeni n-a răspuns până la ora programării.</div> : null}

          <div className="drawer-card bk-sum">
            <div className="muted small">
              <Icon name="calendar" size={14} /> {effStart ? `${dayOf(effStart).split('-').reverse().join('.')} · ${time(effStart)} – ${time(effEnd)}` : 'alege ora'}
            </div>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="bk-price">{lei(price)}</span>
              {editable && !b.onlinePaid ? (
                <button className="ghost sm" onClick={() => setEdit(edit === 'price' ? null : 'price')} aria-label="Schimbă prețul" title="Schimbă prețul">
                  <Icon name="edit" size={16} />
                </button>
              ) : null}
            </div>
            <div className="muted small">
              {durMin} min total · 1 serviciu
              {b.payment ? ` · ${b.payment === 'subscription' ? 'pe abonament' : b.payMethod === 'app' && b.payDue ? `are de plătit ${lei(b.payDue)} în aplicație` : `a plătit ${lei(b.paidAmount ?? b.price)}`}` : ''}
              {b.onlinePaid && !b.onlineRefunded ? ` · plătită online ${lei(b.onlinePaid)}` : ''}
            </div>
            {edit === 'price' ? (
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => {
                    setPrice(Math.max(0, Number(e.target.value)));
                    setPriceTouched(true);
                    setDiscount(null);
                  }}
                  style={{ width: 110 }}
                  aria-label="Prețul programării"
                  autoFocus
                />
                lei
                {price !== listPrice ? (
                  <button className="ghost sm" onClick={() => { setPrice(listPrice); setPriceTouched(false); setDiscount(null); }}>
                    Prețul din listă ({lei(listPrice)})
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <section className="drawer-sec">
            <h3>Detalii</h3>
            <div className="bk-list">
              <div className="bk-row">
                {loc?.photoUrl ? <img src={loc.photoUrl} alt="" className="bk-thumb" /> : <span className="bk-thumb ic"><Icon name="pin" /></span>}
                <div>
                  <div className="muted small">Locație</div>
                  <b>{loc?.name ?? b.locationName ?? '—'}</b>
                  {loc?.address ? <div className="muted small">{loc.address}</div> : null}
                </div>
              </div>
              <button type="button" className="bk-row" disabled={!editable || !allBarbers} onClick={() => setEdit(edit === 'barber' ? null : 'barber')}>
                {barber?.photoUrl ? <img src={barber.photoUrl} alt="" className="bk-thumb round" style={{ borderColor: color }} /> : <span className="bk-thumb round ic" style={{ background: color, color: '#fff' }}>{barber?.initials}</span>}
                <div>
                  <div className="muted small">Membru al echipei</div>
                  <b>{barber?.name ?? b.barberName}</b>
                  {barber?.role ? <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{barber.role}</div> : null}
                </div>
                {editable && allBarbers ? <span className="bk-chev">›</span> : null}
              </button>
              {edit === 'barber' ? (
                <div className="bk-edit">
                  <select value={barberId} onChange={(e) => { setBarberId(e.target.value); setStart(''); }} aria-label="Frizerul">
                    {barbers
                      .filter((x) => x.active || x.id === b.barberId)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                          {x.serviceIds.includes(serviceId) ? '' : ' (nu face serviciul ales)'}
                        </option>
                      ))}
                  </select>
                  {barberId !== b.barberId && !force ? <div className="muted small">Alege și ora la noul frizer, mai jos.</div> : null}
                </div>
              ) : null}
              <button type="button" className="bk-row" disabled={!editable} onClick={() => setEdit(edit === 'time' ? null : 'time')}>
                <span className="bk-thumb ic"><Icon name="calendar" /></span>
                <div>
                  <div className="muted small">Data și ora</div>
                  <b>{effStart ? `${dayOf(effStart).split('-').reverse().join('.')} · ${time(effStart)}` : `${day.split('-').reverse().join('.')} · alege ora`}</b>
                  {effStart ? <div className="muted small">{time(effStart)} – {time(effEnd)}</div> : null}
                </div>
                {editable ? <span className="bk-chev">›</span> : null}
              </button>
              {editable && (edit === 'time' || edit === 'barber' || (moved && !slotOk) || (serviceId !== b.serviceId && !slotOk)) ? (
                <div className="bk-edit">
                  <input type="date" value={day} onChange={(e) => { if (e.target.value) { setDay(e.target.value); setStart(''); } }} style={{ width: 170 }} aria-label="Ziua" />
                  {!force ? (
                    slots === null ? (
                      <span className="muted small">Se încarcă orele libere…</span>
                    ) : slots.length === 0 ? (
                      <span className="muted small">Nicio oră liberă în ziua asta. Alege altă zi sau „Altă oră”.</span>
                    ) : (
                      <div className="slots">
                        {slots.map((s) => (
                          <button key={s.start} type="button" className={`${s.start === start ? 'on' : ''}${s.membersOnly ? ' members' : ''}`} onClick={() => setStart(s.start)}>
                            {time(s.start)}
                            {s.membersOnly ? ' ★' : ''}
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    <Field label="Ora (poate fi și în afara programului)">
                      <input type="time" step={300} value={forceTime} onChange={(e) => setForceTime(e.target.value)} style={{ width: 140 }} />
                    </Field>
                  )}
                  <label className="check small">
                    <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Altă oră decât cele libere
                  </label>
                </div>
              ) : null}
            </div>
          </section>

          <section className="drawer-sec">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>Servicii</h3>
              {editable ? (
                <button className="ghost sm" onClick={() => setEdit(edit === 'service' ? null : 'service')}>
                  {edit === 'service' ? 'Gata' : '✎ Schimbă'}
                </button>
              ) : null}
            </div>
            <div className="bk-list">
              <div className="bk-row">
                {service?.imageUrl ? <img src={service.imageUrl} alt="" className="bk-thumb" style={{ borderColor: service.color || color }} /> : <span className="bk-thumb ic" style={{ borderColor: service?.color || color }}><span className="dot" style={{ background: service?.color || color }} /></span>}
                <div>
                  <b>{service?.name ?? b.serviceName}</b>
                  <div className="muted small">
                    {durMin} min · {lei(listPrice)}
                  </div>
                </div>
              </div>
              {edit === 'service' ? (
                <div className="bk-edit">
                  <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} aria-label="Serviciul">
                    {services
                      .filter((s) => s.active || s.id === b.serviceId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {barber?.durations?.[s.id] ?? s.durationMin} min · {lei(barber?.prices?.[s.id] ?? s.price)}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}
              <div className="bk-row sub">
                <span>Subtotal</span>
                <b>{lei(price)}</b>
              </div>
            </div>
          </section>

          <section className="drawer-sec">
            <h3>Extra</h3>
            <div className="bk-list">
              <button type="button" className="bk-row" disabled={!editable || !!b.onlinePaid} onClick={() => setEdit(edit === 'discount' ? null : 'discount')}>
                <span className="bk-thumb ic"><Icon name="tag" /></span>
                <div>
                  <div className="muted small">Promoție</div>
                  <b>{discount ? `Reducere ${discount}: ${lei(listPrice - price)}` : 'Adaugă reducere'}</b>
                </div>
                {editable && !b.onlinePaid ? <span className="bk-chev">›</span> : null}
              </button>
              {edit === 'discount' ? (
                <div className="bk-edit">
                  <div className="row" style={{ gap: 6 }}>
                    {['10%', '15%', '20%', '50%'].map((p) => (
                      <button key={p} type="button" className="ghost sm" onClick={() => setDiscountIn(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <input value={discountIn} onChange={(e) => setDiscountIn(e.target.value)} placeholder="ex. 10% sau 15 lei" style={{ width: 170 }} aria-label="Reducerea" />
                    <button
                      type="button"
                      className="sm"
                      disabled={!disc}
                      onClick={() => {
                        if (!disc) return;
                        setPrice(listPrice - disc.off);
                        setPriceTouched(true);
                        setDiscount(disc.label);
                        setEdit(null);
                      }}
                    >
                      Aplică{disc ? ` (−${lei(disc.off)})` : ''}
                    </button>
                    {discount ? (
                      <button type="button" className="ghost sm" onClick={() => { setPrice(listPrice); setPriceTouched(false); setDiscount(null); setDiscountIn(''); }}>
                        Fără reducere
                      </button>
                    ) : null}
                  </div>
                  <div className="muted small">Reducerea se scade din prețul din listă; prețul nou se salvează cu „Salvează modificările”.</div>
                </div>
              ) : null}
              <button type="button" className="bk-row" disabled={!canManage || b.status !== 'completed' || busy} onClick={review}>
                <span className="bk-thumb ic"><Icon name="chat" /></span>
                <div>
                  <div className="muted small">Recenzie</div>
                  <b>Trimite cererea către client</b>
                  {b.status !== 'completed' ? <div className="muted small">Se poate după ce programarea e încheiată.</div> : null}
                </div>
                {canManage && b.status === 'completed' ? <span className="bk-chev">›</span> : null}
              </button>
            </div>
          </section>

          {showPay ? (
            <section className="drawer-sec" ref={payRef}>
              <h3>Plată</h3>
              {b.onlinePaid ? (
                <div className={b.onlineRefunded ? 'muted small' : 'success small'}>
                  {b.onlineRefunded ? `Plata online de ${b.onlinePaid} lei a fost returnată pe card.` : `Plătită online din aplicație: ${b.onlinePaid} lei.`}
                </div>
              ) : null}
              {!checkout && (payOpen || b.payDue) ? (
                <PayRequestBox
                  b={b}
                  online={online}
                  owner={owner}
                  onChange={(nb) => {
                    setB({ ...b, ...nb });
                    onChange();
                    activity.reload();
                  }}
                />
              ) : null}
              {checkout && canComplete ? (
                <CheckoutForm
                  b={b}
                  online={online}
                  onCancel={() => setCheckout(false)}
                  onDone={() => {
                    onChange();
                    onClose();
                  }}
                />
              ) : b.payment ? (
                b.payMethod === 'app' && b.payDue ? (
                  <span className="small">Încheiată; plata se așteaptă în aplicație.</span>
                ) : (
                  <span className="small success">Plata e confirmată{b.payMethod === 'online' ? ' (online, din aplicație)' : ''}.</span>
                )
              ) : null}
            </section>
          ) : null}

          <section className="drawer-sec">
            <h3>Notiță internă</h3>
            <textarea ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canManage} placeholder="O vede doar echipa" aria-label="Notiță internă" />
          </section>

          <section className="drawer-sec">
            <div className="tabs bk-tabs" role="tablist">
              {(
                [
                  ['log', 'Jurnal'],
                  ['pay', 'Plăți'],
                  ['msg', 'Notificări'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {l}
                </button>
              ))}
            </div>
            {!activity.data ? (
              <Loading error={activity.error} />
            ) : tab === 'log' ? (
              <ul className="bk-log">
                {activity.data.log.map((e, i) => (
                  <li key={i}>
                    <span className="dot" style={{ background: e.kind === 'cancelled' || e.kind === 'refused' || e.kind === 'no_show' ? 'var(--danger)' : 'var(--success, #30A46C)' }} />
                    <div>
                      <div>
                        <span className="muted">{when(e.at)}:</span> {logText(e)}
                        {e.by ? <span className="muted"> · {e.by}</span> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : tab === 'pay' ? (
              activity.data.payments.length ? (
                <ul className="bk-log">
                  {activity.data.payments.map((p, i) => (
                    <li key={i}>
                      <span className="dot" style={{ background: p.kind === 'refund' ? 'var(--danger)' : 'var(--gold)' }} />
                      <div>
                        <span className="muted">{p.at && p.at !== 'null' ? `${when(p.at)}:` : ''}</span> {payText(p)}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="muted small">Nicio plată încă. Se încasează după tunsoare (Acțiuni → Checkout rapid) sau se cere în aplicație.</div>
              )
            ) : activity.data.messages.length ? (
              <ul className="bk-log">
                {activity.data.messages.map((m, i) => (
                  <li key={i}>
                    <span className="dot" style={{ background: m.status === 'sent' ? 'var(--success, #30A46C)' : 'var(--danger)' }} />
                    <div>
                      <span className="muted">{when(m.at)}:</span> {MSG_KIND[m.kind] ?? m.kind}, prin {CHANNEL[m.channel] ?? m.channel}
                      {m.status === 'sent' ? '' : <span className="err"> · netrimis{m.error ? ` (${m.error})` : ''}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="muted small">Niciun mesaj trimis clientului pentru programarea asta.</div>
            )}
          </section>
          {msg ? <div className="success small">{msg}</div> : null}
          {error ? <div className="err">{error}</div> : null}
        </div>

        {canManage ? (
          <div className="drawer-foot">
            {moved && b.status === 'confirmed' ? (
              <label className="check small" style={{ gridColumn: '1 / -1' }}>
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Trimite clientului mesaj cu noua oră
              </label>
            ) : null}
            <button className="ghost" onClick={() => setMenu(true)}>
              ··· Acțiuni
            </button>
            <button disabled={!dirty || busy || (changed && (!effStart || !slotOk))} onClick={save} title={changed && !slotOk ? 'Alege o oră liberă (sau bifează „Altă oră”).' : undefined}>
              Salvează modificările
            </button>
          </div>
        ) : null}

        {menu ? (
          <div className="bk-menu-back" onMouseDown={(e) => e.target === e.currentTarget && setMenu(false)}>
            <div className="bk-menu" role="menu" aria-label="Acțiuni">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ margin: 0 }}>Acțiuni</h2>
                  <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>Ce vrei să faci?</div>
                </div>
                <button className="ghost sm" onClick={() => setMenu(false)} aria-label="Închide">
                  ✕
                </button>
              </div>
              <div className="muted small" style={{ textAlign: 'center' }}>
                {b.clientName || 'Client'} · {dayOf(b.start).split('-').reverse().join('.')} · {time(b.start)}
              </div>
              <h3>Stare</h3>
              <div className="bk-list">
                {b.status === 'confirmed' || canComplete ? (
                  <MenuItem icon="check" title="Marchează ca încheiată" sub={canComplete ? 'Încasează și închide programarea' : 'Se poate după ce începe programarea'} disabled={!canComplete} onClick={startCheckoutNow} />
                ) : null}
                {b.status === 'confirmed' ? <MenuItem icon="ban" title="Nu a venit" sub={past ? 'Marchează clientul ca neprezentat' : 'Se poate după ce începe programarea'} disabled={!past || busy} onClick={() => set({ status: 'no_show' }, false)} /> : null}
                {b.status === 'no_show' ? <MenuItem icon="undo" title="Readu la confirmată" sub="A venit totuși" disabled={busy} onClick={() => set({ status: 'confirmed' }, false)} /> : null}
                {b.status === 'confirmed' ? <MenuItem icon="trash" title="Anulează programarea" sub="Eliberează ora; clientul primește mesaj" danger disabled={busy} onClick={cancel} /> : null}
                {b.status === 'requested' ? <div className="muted small" style={{ padding: 10 }}>Cererea se acceptă sau se refuză din panou, mai sus.</div> : null}
                {b.status === 'cancelled' || b.status === 'completed' ? <div className="muted small" style={{ padding: 10 }}>Programarea e {STATUS[b.status].toLowerCase()}.</div> : null}
              </div>
              <h3>Plăți</h3>
              <div className="bk-list">
                {b.status === 'confirmed' && !b.onlinePaid ? (
                  <MenuItem icon="card" title="Cere plata în aplicație" sub={online ? 'Clientul primește mesaj și plătește cu cardul' : 'Plata online e oprită (Setări → Plăți online)'} disabled={!online} onClick={startPay} />
                ) : null}
                {canComplete ? <MenuItem icon="bolt" title="Checkout rapid" sub="Plată rapidă pentru această programare" onClick={startCheckoutNow} /> : null}
                {owner && b.payment ? <MenuItem icon="undo" title="Anulează confirmarea plății" sub="Programarea revine la confirmată" disabled={busy} onClick={undoPay} /> : null}
                {!(b.status === 'confirmed' && !b.onlinePaid) && !canComplete && !(owner && b.payment) ? <div className="muted small" style={{ padding: 10 }}>Nimic de făcut la plată.</div> : null}
              </div>
              <h3>Client</h3>
              <div className="bk-list">
                <MenuItem icon="chat" title="Trimite cerere de recenzie" sub={b.status === 'completed' ? 'Linkul de recenzie Google, prin SMS și notificare' : 'Se poate după ce programarea e încheiată'} disabled={b.status !== 'completed' || busy} onClick={review} />
                <MenuItem
                  icon="link"
                  title="Copiază linkul clientului"
                  sub={activity.data?.link ?? 'Se încarcă…'}
                  disabled={!activity.data}
                  onClick={() => activity.data && copy(activity.data.link, 'Linkul programării e copiat. Îl poți trimite clientului.')}
                />
                <MenuItem icon="person" title="Copiază linkul fișei" sub="Fișa clientului din panou, pentru echipă" onClick={() => copy(fileLink, 'Linkul fișei clientului e copiat.')} />
              </div>
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}

function MenuItem({ icon, title, sub, danger, disabled, onClick }: { icon: string; title: string; sub?: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className={`bk-row${danger ? ' danger' : ''}`} disabled={disabled} onClick={onClick}>
      <span className="bk-thumb ic">
        <Icon name={icon} />
      </span>
      <div style={{ minWidth: 0 }}>
        <b>{title}</b>
        {sub ? <div className="muted small bk-ellipsis">{sub}</div> : null}
      </div>
      <span className="bk-chev">›</span>
    </button>
  );
}

type PayMethod = 'cash' | 'card' | 'transfer' | 'online' | 'app';
type Sent = { sms: boolean; push: boolean; email: boolean };

/**
 * Cererea de plată în aplicație: clientul primește mesajul și vede în aplicație „Ai de plătit X lei · Plătește acum”.
 * Se poate trimite oricând cât programarea e confirmată (și după tunsoare, din „✓ Încheiată” → „cere plata în aplicație”).
 */
function PayRequestBox({ b, online, owner, onChange }: { b: Booking; online: boolean; owner: boolean; onChange: (b: Booking) => void }) {
  const { busy, error, run } = useAction();
  const [amount, setAmount] = useState(String(b.payDue ?? b.price));
  const [msg, setMsg] = useState<string | null>(null);
  if (b.onlinePaid) return null;
  const pendingApp = b.status === 'completed' && b.payMethod === 'app';
  if (b.status !== 'confirmed' && !pendingApp) return null;
  if (!online)
    return (
      <div className="muted small" style={{ marginBottom: 6 }}>
        „Cere plata în aplicație” nu e disponibil: plata online e oprită (lipsesc cheile Stripe).{' '}
        {owner ? <a href="#/settings/plati">Vezi Setări → Plăți online</a> : 'Proprietarul o pornește din Setări → Plăți online.'}
      </div>
    );
  const send = () =>
    run(async () => {
      const r = await api<Booking & { sent: Sent }>('POST', `/admin/bookings/${b.id}/pay-request`, { amount: Number(amount) });
      setMsg(sentText(r.sent, r.payDue ?? Number(amount)));
      onChange(r);
    });
  const withdraw = (payMethod: 'cash' | 'card') =>
    run(async () => {
      const r = await api<Booking>('DELETE', `/admin/bookings/${b.id}/pay-request`, { payMethod });
      setMsg(pendingApp ? `Notat: a plătit ${payMethod === 'card' ? 'cu cardul (POS)' : 'numerar'} la salon.` : 'Cererea de plată a fost retrasă.');
      onChange(r);
    });
  return (
    <div className="card grid" style={{ gap: 6, marginBottom: 6 }}>
      {b.payDue ? (
        <>
          <div className="small">
            <b>Plată cerută în aplicație: {lei(b.payDue)}</b> · clientul n-a plătit încă.
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="ghost sm" disabled={busy} onClick={send}>
              Trimite din nou
            </button>
            {pendingApp ? (
              <>
                <button className="ghost sm" disabled={busy} onClick={() => withdraw('cash')}>
                  A plătit numerar
                </button>
                <button className="ghost sm" disabled={busy} onClick={() => withdraw('card')}>
                  A plătit cu cardul (POS)
                </button>
              </>
            ) : (
              <button className="ghost sm" disabled={busy} onClick={() => withdraw('cash')}>
                Retrage cererea
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <input type="number" min={2} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 100 }} aria-label="Suma cerută" /> lei
          <button className="ghost sm" disabled={busy || !(Number(amount) >= 2)} onClick={send}>
            Cere plata în aplicație
          </button>
        </div>
      )}
      {msg ? <div className="success small">{msg}</div> : null}
      {error ? <div className="err small">{error}</div> : null}
    </div>
  );
}

/** Confirmarea tunsorii: „a plătit X lei” sau „pe abonament”, plus un bonus folosit (opțional). */
function CheckoutForm({ b, online, onCancel, onDone }: { b: Booking; online: boolean; onCancel: () => void; onDone: () => void }) {
  const data = useLoad(() => api<Checkout>('GET', `/admin/bookings/${b.id}/checkout`), [b.id]);
  const [mode, setMode] = useState<'paid' | 'subscription' | null>(null);
  const [amount, setAmount] = useState(String(b.price));
  const [bonusId, setBonusId] = useState('');
  const [tip, setTip] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>(b.onlinePaid ? 'online' : 'cash');
  const [giftCode, setGiftCode] = useState('');
  const [gift, setGift] = useState<{ code: string; take: number; balance: number } | null>(null);
  const [giftErr, setGiftErr] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  if (!data.data) return <Loading error={data.error} />;
  const applyGift = async () => {
    setGiftErr(null);
    try {
      const g = await api<{ code: string; balance: number; status: string }>('GET', `/admin/gift-cards/check?code=${encodeURIComponent(giftCode)}`);
      if (g.status !== 'active') throw new Error(g.status === 'expired' ? 'Cardul cadou a expirat.' : 'Pe cardul cadou nu mai sunt bani.');
      const take = Math.min(g.balance, b.price);
      setGift({ code: g.code, take, balance: g.balance });
      setMode('paid');
      setAmount(String(Math.max(0, b.price - take)));
    } catch (e) {
      setGift(null);
      setGiftErr(e instanceof Error && !('code' in e) ? e.message : errorText(e));
    }
  };
  const sub = data.data.subscription;
  const m = mode ?? (sub ? 'subscription' : 'paid');
  return (
    <div className="card grid">
      <b>Cum a plătit?</b>
      {b.onlinePaid ? <div className="success small">A plătit deja online, din aplicație: {b.onlinePaid} lei.</div> : null}
      <label className="check">
        <input type="radio" checked={m === 'paid'} onChange={() => setMode('paid')} /> A plătit
        <input type="number" min={0} value={amount} onChange={(e) => { setMode('paid'); setAmount(e.target.value); }} style={{ width: 110 }} aria-label="Suma plătită" /> lei
        <select value={payMethod} onChange={(e) => { setMode('paid'); setPayMethod(e.target.value as PayMethod); }} style={{ width: 170 }} aria-label="Cum a plătit">
          <option value="cash">numerar</option>
          <option value="card">card (POS)</option>
          <option value="transfer">transfer</option>
          {b.onlinePaid ? <option value="online">online (în aplicație)</option> : null}
          {online && !b.onlinePaid ? <option value="app">cere plata în aplicație</option> : null}
        </select>
      </label>
      {m === 'paid' && payMethod === 'app' ? (
        <div className="muted small">
          Clientul primește cererea de plată (SMS, e-mail sau notificare, după Notificări) și plătește din aplicație cu cardul, Apple Pay sau Google Pay. Suma nu
          intră la numerar sau card în registru; apare la online după ce plătește.
        </div>
      ) : !online && !b.onlinePaid ? (
        <div className="muted small">„Cere plata în aplicație” apare după ce pornești plata online (Setări → Plăți online).</div>
      ) : null}
      <label className="check" style={{ opacity: sub ? 1 : 0.5 }}>
        <input type="radio" disabled={!sub} checked={m === 'subscription'} onChange={() => setMode('subscription')} />
        <span>
          Pe abonament{' '}
          <span className="muted small">
          {sub
            ? `· ${sub.name} · ${sub.cutsTotal === null ? 'nelimitat' : `${sub.cutsLeft} din ${sub.cutsTotal} rămase`} · până pe ${longDate(sub.endsAt)}`
            : '· clientul nu are abonament activ pentru acest serviciu'}
          </span>
        </span>
      </label>
      {data.data.bonuses.length ? (
        <Field label="Folosește un bonus (opțional)">
          <select value={bonusId} onChange={(e) => setBonusId(e.target.value)}>
            <option value="">Fără bonus</option>
            {data.data.bonuses.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {m === 'paid' ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Card cadou</span>
          <input value={giftCode} onChange={(e) => { setGiftCode(e.target.value); setGift(null); }} placeholder="TAF-XXXX-XXXX" style={{ width: 160 }} aria-label="Cod card cadou" />
          <button className="ghost sm" disabled={!giftCode.trim()} onClick={applyGift}>
            Folosește
          </button>
          {gift ? <span className="success small">Se scad {gift.take} lei de pe card (are {gift.balance} lei). Restul, {amount || 0} lei, se plătește acum.</span> : null}
          {giftErr ? <span className="err small">{giftErr}</span> : null}
        </div>
      ) : null}
      <label className="check">
        Bacșiș (opțional)
        <input type="number" min={0} value={tip} onChange={(e) => setTip(e.target.value)} style={{ width: 110 }} aria-label="Bacșiș" /> lei
      </label>
      {error ? <div className="err">{error}</div> : null}
      <div className="row">
        <button
          disabled={busy || (m === 'paid' && amount === '')}
          onClick={() =>
            run(async () => {
              const r = await api<Booking & { sent?: Sent }>('POST', `/admin/bookings/${b.id}/complete`, {
                payment: m,
                ...(m === 'paid' && { amount: Number(amount), payMethod }),
                ...(m === 'paid' && gift && { giftCode: gift.code, giftAmount: gift.take }),
                tip: tip ? Number(tip) : null,
                bonusId: bonusId || null,
              });
              if (r.sent) alert(sentText(r.sent, Number(amount)));
              onDone();
            })
          }
        >
          {m === 'subscription'
            ? 'Confirmă: pe abonament'
            : payMethod === 'app'
              ? `Confirmă și cere ${amount || 0} lei în aplicație`
              : `Confirmă: ${amount || 0} lei${gift ? ` + ${gift.take} lei card cadou` : ''}`}
        </button>
        <button className="ghost" onClick={onCancel}>
          Înapoi
        </button>
      </div>
    </div>
  );
}
