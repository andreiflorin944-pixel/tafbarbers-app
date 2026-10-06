import { useState } from 'react';
import { api, type Me, type Promo, type Service } from '../api';
import { Field, ImagePicker, Loading, Modal, useAction, useLoad } from '../ui';

const ICONS: Record<string, string> = { pricetag: 'Etichetă (ofertă)', flame: 'Flacără (popular)', 'bag-handle': 'Sacoșă (produs)', school: 'Academie' };
type Texts = { kicker: string; title: string; text: string; cta: string };

export function PromosPage(_: { me: Me }) {
  const data = useLoad(() => Promise.all([api<Promo[]>('GET', '/admin/promos'), api<Service[]>('GET', '/admin/services')]));
  const [edit, setEdit] = useState<Partial<Promo> | null>(null);
  const [promos, services] = data.data ?? [[], []];

  return (
    <>
      <div className="head">
        <h1>Bannere în aplicație</h1>
        <button onClick={() => setEdit({ icon: 'pricetag', action: { type: 'book' }, active: true, sort: promos.length + 1, translations: {} })}>+ Banner nou</button>
      </div>
      <p className="muted small" style={{ marginTop: -8 }}>
        Apar sus pe prima pagină a aplicației, în ordinea de mai jos, și se schimbă singure. Scrii doar în română; engleza și franceza se traduc singure la salvare.
      </p>
      {!data.data ? (
        <Loading error={data.error} />
      ) : (
        <div className="grid two">
          {promos.map((p, i) => (
            <div
              key={p.id}
              className="card"
              onClick={() => setEdit(p)}
              style={{ cursor: 'pointer', background: i % 2 === 0 ? 'var(--gold)' : 'var(--card-alt)', color: i % 2 === 0 ? '#000' : 'var(--text)', opacity: p.active ? 1 : 0.5 }}
            >
              <div className="small" style={{ letterSpacing: 1.5, fontWeight: 700, opacity: 0.75 }}>
                {p.kicker}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, margin: '4px 0' }}>{p.title}</div>
              <div className="small">{p.text}</div>
              <div className="small" style={{ marginTop: 10, fontWeight: 700 }}>
                {p.cta} → {p.action.type === 'service' ? services.find((s) => s.id === (p.action as { serviceId: string }).serviceId)?.name : p.action.type === 'url' ? (p.action as { url: string }).url : 'programare'}
              </div>
              <div className="small" style={{ marginTop: 6, opacity: 0.7 }}>
                {!p.active ? 'Ascuns · ' : ''}
                {p.startsAt || p.endsAt ? `Activ ${p.startsAt ? 'din ' + p.startsAt.slice(0, 10) : ''} ${p.endsAt ? 'până ' + p.endsAt.slice(0, 10) : ''}` : ''}
                {['en', 'fr'].filter((l) => p.translations?.[l]?.title).length ? ` · traduceri: ${['en', 'fr'].filter((l) => p.translations?.[l]?.title).join(', ').toUpperCase()}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit ? (
        <PromoModal
          p={edit}
          services={services}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            data.reload();
          }}
        />
      ) : null}
    </>
  );
}

function PromoModal({ p, services, onClose, onDone }: { p: Partial<Promo>; services: Service[]; onClose: () => void; onDone: () => void }) {
  const lang = 'ro';
  const [texts, setTexts] = useState<Record<string, Texts>>({
    ro: { kicker: p.kicker ?? '', title: p.title ?? '', text: p.text ?? '', cta: p.cta ?? '' },
    en: { kicker: '', title: '', text: '', cta: '', ...p.translations?.en },
    fr: { kicker: '', title: '', text: '', cta: '', ...p.translations?.fr },
  });
  const [icon, setIcon] = useState(p.icon ?? 'pricetag');
  const [imageUrl, setImageUrl] = useState<string | null>(p.imageUrl ?? null);
  const [color, setColor] = useState<string | null>(p.color ?? null);
  const [actionType, setActionType] = useState(p.action?.type ?? 'book');
  const [serviceId, setServiceId] = useState(p.action?.type === 'service' ? p.action.serviceId : (services[0]?.id ?? ''));
  const [url, setUrl] = useState(p.action?.type === 'url' ? p.action.url : 'https://');
  const [startsAt, setStartsAt] = useState(p.startsAt?.slice(0, 10) ?? '');
  const [endsAt, setEndsAt] = useState(p.endsAt?.slice(0, 10) ?? '');
  const [active, setActive] = useState(p.active !== false);
  const [sort, setSort] = useState(p.sort ?? 0);
  const { busy, error, run } = useAction();

  const t = texts[lang];
  const setT = (patch: Partial<Texts>) => setTexts((x) => ({ ...x, [lang]: { ...x[lang], ...patch } }));
  const clean = (o: Texts) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim()));

  const save = () =>
    run(async () => {
      const body = {
        ...texts.ro,
        icon,
        imageUrl,
        color,
        action: actionType === 'service' ? { type: 'service', serviceId } : actionType === 'url' ? { type: 'url', url } : { type: 'book' },
        translations: { en: clean(texts.en), fr: clean(texts.fr) },
        startsAt: startsAt ? new Date(startsAt + 'T00:00:00').toISOString() : null,
        endsAt: endsAt ? new Date(endsAt + 'T23:59:59').toISOString() : null,
        active,
        sort,
      };
      if (p.id) await api('PATCH', `/admin/promos/${p.id}`, body);
      else await api('POST', '/admin/promos', body);
      onDone();
    });

  return (
    <Modal title={p.id ? 'Editează bannerul' : 'Banner nou'} onClose={onClose}>
      <div className="grid">
        <div className="muted small">Scrii doar în română. Se traduce singur în engleză și franceză când salvezi.</div>
        <Field label="Etichetă mică (ex. OFERTA SĂPTĂMÂNII)">
          <input value={t.kicker} onChange={(e) => setT({ kicker: e.target.value })} />
        </Field>
        <Field label="Titlu">
          <input value={t.title} onChange={(e) => setT({ title: e.target.value })} />
        </Field>
        <Field label="Text">
          <textarea value={t.text} onChange={(e) => setT({ text: e.target.value })} style={{ minHeight: 60 }} />
        </Field>
        <Field label="Text buton">
          <input value={t.cta} onChange={(e) => setT({ cta: e.target.value })} />
        </Field>
        <Field label="Poză de fundal (opțional; textul apare alb peste poză)">
          <ImagePicker value={imageUrl} onChange={setImageUrl} maxPx={1200} />
        </Field>
        {!imageUrl ? (
          <Field label="Culoarea bannerului">
            <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className={color === null ? 'on sm' : 'ghost sm'} onClick={() => setColor(null)}>
                Automat
              </button>
              <input type="color" value={color ?? '#F9A11B'} onChange={(e) => setColor(e.target.value.toUpperCase())} style={{ width: 52, height: 32, padding: 2 }} aria-label="Culoarea bannerului" />
              <span className="muted small">{color ?? 'alternativ: culoarea principală / închis'}</span>
            </div>
          </Field>
        ) : null}
        <div className="grid two">
          <Field label="Iconiță">
            <select value={icon} onChange={(e) => setIcon(e.target.value)}>
              {Object.entries(ICONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Butonul duce la">
            <select value={actionType} onChange={(e) => setActionType(e.target.value as 'book')}>
              <option value="book">Programare (alegi serviciul)</option>
              <option value="service">Programare la un serviciu anume</option>
              <option value="url">Un link (site, Instagram…)</option>
            </select>
          </Field>
        </div>
        {actionType === 'service' ? (
          <Field label="Serviciul">
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : actionType === 'url' ? (
          <Field label="Link">
            <input value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
        ) : null}
        <div className="grid two">
          <Field label="Afișat din (opțional)">
            <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label="Până în (opțional)">
            <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
        </div>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Afișat
          </label>
          <Field label="Ordine">
            <input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value))} style={{ width: 80 }} />
          </Field>
        </div>
        {error ? <div className="err">{error}</div> : null}
        <div className="row">
          <button disabled={busy || !texts.ro.kicker || !texts.ro.title || !texts.ro.cta} onClick={save}>
            Salvează
          </button>
          {p.id ? (
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                confirm('Ștergi bannerul?') &&
                run(async () => {
                  await api('DELETE', `/admin/promos/${p.id}`);
                  onDone();
                })
              }
            >
              Șterge
            </button>
          ) : null}
        </div>
        {!texts.ro.kicker || !texts.ro.title || !texts.ro.cta ? <div className="muted small">Eticheta, titlul și butonul în română sunt obligatorii.</div> : null}
      </div>
    </Modal>
  );
}
