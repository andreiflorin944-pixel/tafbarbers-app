import { useEffect, useState } from 'react';
import { api, setToken, PERM_LABELS, ROLE_HELP, ROLE_LABELS, type Barber, type Business, type Location, type Me, type Perm, type Role } from '../api';
import { emptyTr, Field, ImagePicker, Loading, TranslationFields, useAction, useLoad, useSub } from '../ui';
import { date, time } from '../util';

export function SettingsPage({ me }: { me: Me }) {
  // Din meniu: #/settings/<secțiune> derulează la secțiunea respectivă (după ce s-a încărcat).
  const sub = useSub();
  useEffect(() => {
    if (!sub) return;
    let tries = 0;
    const t = setInterval(() => {
      const el = document.getElementById(`set-${sub}`);
      if (el || ++tries > 20) {
        clearInterval(t);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
    return () => clearInterval(t);
  }, [sub]);
  return (
    <>
      <div className="head">
        <h1>Setări</h1>
      </div>
      <div className="grid" style={{ gap: 18, maxWidth: 760 }}>
        {me.owner ? (
          <a href="#/notifications" className="card" style={{ display: 'block', textDecoration: 'none' }}>
            <b>Notificări automate ›</b>
            <div className="muted small">
              Ce mesaje pleacă singure și pe ce canal (push, SMS, e-mail), textele lor, „Ne e dor de tine”, orele libere de azi, cardurile cadou și
              butonul „Programează” pentru Google Maps și Instagram.
            </div>
          </a>
        ) : null}
        {me.owner ? <BusinessForm /> : null}
        {me.owner ? <Locations /> : null}
        {me.owner ? <TranslateAll /> : null}
        {me.owner ? <HairAdvisor /> : null}
        {me.owner ? <Team me={me} /> : null}
        <Password />
        <Sessions />
        {me.owner ? <MessageLog /> : null}
      </div>
    </>
  );
}

/**
 * Locațiile salonului. Clientul alege întâi locația, apoi frizerul din ea; fiecare frizer lucrează într-o singură locație
 * (se alege în fișa frizerului). O locație dezactivată nu mai apare în aplicație.
 */
function Locations() {
  const list = useLoad(() => api<Location[]>('GET', '/admin/locations'));
  const [edit, setEdit] = useState<Partial<Location> | null>(null);
  const { busy, error, run } = useAction();
  const save = () =>
    run(async () => {
      if (!edit) return;
      const body = { name: edit.name ?? '', address: edit.address ?? '', phone: edit.phone ?? '', photoUrl: edit.photoUrl ?? null, sort: edit.sort ?? 0 };
      if (edit.id) await api('PATCH', `/admin/locations/${edit.id}`, body);
      else await api('POST', '/admin/locations', body);
      setEdit(null);
      list.reload();
    });
  const toggle = (l: Location) =>
    run(async () => {
      const future = l.futureBookings
        ? `\n\nAtenție: locația are ${l.futureBookings === 1 ? 'o programare viitoare' : `${l.futureBookings} programări viitoare`}. Ele rămân valabile și clienții primesc în continuare memento-urile; dacă nu mai lucrați acolo, anulează-le din Calendar (filtrul de locație) sau mută frizerii în altă locație.`
        : '';
      if (l.active && !confirm(`Dezactivezi „${l.name}”? Nu mai apare în aplicație, iar frizerii de acolo nu mai primesc programări noi. Programările deja făcute rămân.${future}`)) return;
      await api('PATCH', `/admin/locations/${l.id}`, { active: !l.active });
      list.reload();
    });
  const set = (patch: Partial<Location>) => setEdit((e) => ({ ...e, ...patch }));
  return (
    <div className="card grid">
      <h2 id="set-locatii" style={{ margin: 0, scrollMarginTop: 16 }}>Locații</h2>
      <div className="muted small">
        La o programare nouă, clientul alege întâi locația, apoi frizerul, serviciul și ora. Fiecare frizer lucrează într-o singură locație: o alegi în
        Afaceri → Frizeri, în fișa frizerului. Cât timp ai o singură locație, ea e deja aleasă pentru client.
      </div>
      {!list.data ? (
        <Loading error={list.error} />
      ) : (
        list.data.map((l) => (
          <div key={l.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 10, flexWrap: 'wrap' }}>
            <span>
              <b>{l.name}</b> {l.active ? null : <span className="pill off">dezactivată</span>}
              <div className="muted small">
                {[l.address || 'fără adresă', l.phone, `${l.barbers ?? 0} ${l.barbers === 1 ? 'frizer' : 'frizeri'}`].filter(Boolean).join(' · ')}
              </div>
              {l.active && !l.barbers ? <div className="muted small">Nu apare încă în aplicație: adaugă cel puțin un frizer în ea (Afaceri → Frizeri).</div> : null}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <button className="ghost sm" disabled={busy} onClick={() => setEdit(l)}>
                Editează
              </button>
              <button className="ghost sm" disabled={busy} onClick={() => toggle(l)}>
                {l.active ? 'Dezactivează' : 'Activează'}
              </button>
            </span>
          </div>
        ))
      )}
      {edit ? (
        <div className="grid" style={{ background: 'var(--card-alt)', borderRadius: 12, padding: 12 }}>
          <b>{edit.id ? `Editează: ${edit.name}` : 'Locație nouă'}</b>
          <div className="grid two">
            <Field label="Nume (ex. TAFBarbers Rediu)">
              <input value={edit.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Adresă">
              <input value={edit.address ?? ''} onChange={(e) => set({ address: e.target.value })} placeholder="Strada, numărul, orașul" />
            </Field>
            <Field label="Telefon (opțional; gol = telefonul salonului)">
              <input value={edit.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} placeholder="07xx xxx xxx" />
            </Field>
            <Field label="Ordine în aplicație">
              <input type="number" value={edit.sort ?? 0} onChange={(e) => set({ sort: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Poză (opțional)">
            <ImagePicker value={edit.photoUrl ?? null} onChange={(u) => set({ photoUrl: u })} maxPx={1200} />
          </Field>
          <div className="row">
            <button disabled={busy || !(edit.name ?? '').trim()} onClick={save}>
              Salvează
            </button>
            <button className="ghost" disabled={busy} onClick={() => setEdit(null)}>
              Renunță
            </button>
          </div>
        </div>
      ) : null}
      {error ? <div className="err">{error}</div> : null}
      {!edit ? (
        <div className="row">
          <button className="ghost" onClick={() => setEdit({ name: '', address: '', phone: '', photoUrl: null, sort: (list.data?.length ?? 0) + 1 })}>
            + Locație nouă
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BusinessForm() {
  const biz = useLoad(() => api<Business>('GET', '/admin/settings'));
  const barbers = useLoad(() => api<Barber[]>('GET', '/admin/barbers'));
  const [v, setV] = useState<Business | null>(null);
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(biz.data), [biz.data]);
  if (!v) return <Loading error={biz.error} />;
  const set = (patch: Partial<Business>) => {
    setSaved(false);
    setV({ ...v, ...patch });
  };
  const text = (k: keyof Business, label: string, ph = '') => (
    <Field label={label}>
      <input value={(v[k] as string) ?? ''} onChange={(e) => set({ [k]: e.target.value })} placeholder={ph} />
    </Field>
  );

  return (
    <div className="card grid">
      <h2 id="set-salon" style={{ margin: 0, scrollMarginTop: 16 }}>Salonul</h2>
      <div className="grid two">
        {text('name', 'Nume')}
        {text('tagline', 'Slogan scurt')}
        {text('address', 'Adresă')}
        {text('phone', 'Telefon salon', '07xx xxx xxx')}
        {text('website', 'Site', 'https://')}
        {text('instagram', 'Instagram (doar numele)', 'tafbarbers')}
        {text('facebook', 'Facebook (link)', 'https://facebook.com/…')}
        {text('tiktok', 'TikTok (link)', 'https://tiktok.com/@…')}
      </div>
      <Field label="Descriere (pagina Despre din aplicație)">
        <textarea value={v.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <h2 id="set-firma" style={{ margin: '6px 0 0', scrollMarginTop: 16 }}>Datele firmei</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Apar în Termeni și condiții și în Politica de confidențialitate (obligatoriu pentru Apple și Google). Le găsești în certificatul de înregistrare al firmei.
      </p>
      <div className="grid two">
        {text('legalName', 'Denumirea firmei', 'ex. TAF BARBERS SRL')}
        {text('cui', 'CUI', 'ex. RO12345678')}
        {text('regCom', 'Nr. Registrul Comerțului', 'ex. J40/1234/2020')}
        {text('legalEmail', 'E-mail pentru clienți și date personale', 'contact@tafbarbers.ro')}
      </div>
      {text('legalAddress', 'Sediul social (din certificat)', 'Str., nr., oraș, județ')}
      <h2 id="set-reguli" style={{ margin: '6px 0 0', scrollMarginTop: 16 }}>Reguli de programare</h2>
      <div className="grid two">
        <Field label="Pasul orelor în aplicație (minute)">
          <select value={v.slotStepMin} onChange={(e) => set({ slotStepMin: Number(e.target.value) })}>
            {[5, 10, 15, 20, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Anulare din aplicație cu cel puțin (ore înainte)">
          <input type="number" min={0} value={v.cancelHours} onChange={(e) => set({ cancelHours: Number(e.target.value) })} />
        </Field>
        <Field label="Programare cu cel puțin (minute înainte)">
          <input type="number" min={0} step={15} value={v.minLeadMin ?? 0} onChange={(e) => set({ minLeadMin: Number(e.target.value) })} />
        </Field>
        <Field label="Cât de departe în viitor (zile)">
          <input type="number" min={1} max={365} value={v.maxDaysAhead ?? 30} onChange={(e) => set({ maxDaysAhead: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="card" style={{ background: 'var(--card-alt)', display: 'grid', gap: 8 }}>
        <label className="row" style={{ gap: 8, fontWeight: 600 }}>
          <input type="checkbox" checked={!!v.requireApproval} onChange={(e) => set({ requireApproval: e.target.checked })} />
          Programările din aplicație cer aprobare
        </label>
        <div className="muted small">
          Când e bifat, programarea făcută de client intră ca cerere: ora rămâne rezervată pentru el, iar voi o acceptați sau o refuzați din clopoțelul din
          colțul de sus (sună și apare un mesaj când vine una nouă). Clientul primește „Am primit cererea ta”, apoi confirmarea sau refuzul. Dacă nu răspunde
          nimeni până la ora programării, cererea se anulează singură și clientul e anunțat. Programările puse din panou sunt confirmate direct.
        </div>
        {v.requireApproval ? (
          <>
            <label className="row" style={{ gap: 8 }}>
              <input type="radio" checked={!v.approvalBarberIds?.length} onChange={() => set({ approvalBarberIds: [] })} />
              La toți frizerii
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="radio"
                checked={!!v.approvalBarberIds?.length}
                onChange={() => {
                  const first = (barbers.data ?? []).find((b) => b.active);
                  if (first) set({ approvalBarberIds: [first.id] });
                }}
               
              />
              Doar la anumiți frizeri
            </label>
            {v.approvalBarberIds?.length ? (
              <div className="row" style={{ gap: 12, paddingLeft: 26 }}>
                {(barbers.data ?? [])
                  .filter((b) => b.active || v.approvalBarberIds?.includes(b.id))
                  .map((b) => {
                    const on = !!v.approvalBarberIds?.includes(b.id);
                    return (
                      <label key={b.id} className="row" style={{ gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={on}
                          // Măcar un frizer rămâne bifat; pentru niciunul se debifează aprobarea de sus.
                          disabled={on && v.approvalBarberIds!.length === 1}
                          onChange={(e) => set({ approvalBarberIds: e.target.checked ? [...v.approvalBarberIds!, b.id] : v.approvalBarberIds!.filter((x) => x !== b.id) })}
                         
                        />
                        {b.name}
                      </label>
                    );
                  })}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <Field label="Politica de anulare (apare la confirmarea programării)">
        <textarea value={v.cancellationPolicy ?? ''} onChange={(e) => set({ cancellationPolicy: e.target.value })} />
      </Field>
      <TranslationFields
        fields={[
          { key: 'tagline', label: 'Slogan scurt' },
          { key: 'description', label: 'Descriere', multiline: true },
          { key: 'cancellationPolicy', label: 'Politica de anulare', multiline: true },
        ]}
        ro={{ tagline: v.tagline, description: v.description, cancellationPolicy: v.cancellationPolicy }}
        initialRo={{ tagline: biz.data?.tagline, description: biz.data?.description, cancellationPolicy: biz.data?.cancellationPolicy }}
        value={v.translations ?? emptyTr()}
        onChange={(translations) => set({ translations })}
      />
      {error ? <div className="err">{error}</div> : null}
      <div className="row">
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const next = await api<Business>('PUT', '/admin/settings', v);
              setV(next);
              biz.setData(next);
              setSaved(true);
            })
          }
        >
          Salvează
        </button>
        {saved ? <span className="success small">Salvat.</span> : null}
      </div>
    </div>
  );
}

type TrStats = { translated: number; failed: number; remaining: number; aiDown: boolean };

/**
 * „Tradu tot conținutul acum”: traduce în engleză și franceză ce s-a scris în panou înainte de traducerea automată
 * (servicii, frizeri, produse, abonamente, bannere, despre salon, regulamente, mesaje). Merge pe bucăți, până termină.
 */
function TranslateAll() {
  const status = useLoad(() => api<TrStats>('GET', '/admin/translations/status'));
  const [progress, setProgress] = useState<{ done: number; left: number } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const { busy, error, run } = useAction();
  const start = () =>
    run(async () => {
      setResult(null);
      let done = 0;
      let failed = 0;
      let r = await api<TrStats>('POST', '/admin/translations/run', { fresh: true });
      done += r.translated;
      failed = r.failed;
      setProgress({ done, left: r.remaining });
      // Câte o bucată, cât timp mai rămâne ceva și se avansează.
      for (let i = 0; i < 60 && r.remaining > 0 && !r.aiDown && r.translated + r.failed > 0; i++) {
        r = await api<TrStats>('POST', '/admin/translations/run', {});
        done += r.translated;
        failed += r.failed;
        setProgress({ done, left: r.remaining });
      }
      setProgress(null);
      if (r.aiDown)
        setResult({ ok: false, text: `Traducerea automată nu merge acum (serviciul de traducere nu răspunde). Am tradus ${done} texte; restul se traduc singure mai târziu.` });
      else
        setResult({
          ok: true,
          text: `Gata. Am tradus ${done} texte.${failed ? ` ${failed} nu s-au putut traduce automat și apar în română; le poți traduce de mână, la „Engleză și franceză”, în fiecare formular.` : ''}`,
        });
      status.reload();
    });
  const left = status.data?.remaining ?? 0;
  return (
    <div className="card grid">
      <h2 id="set-traduceri" style={{ margin: 0, scrollMarginTop: 16 }}>Traduceri</h2>
      <div className="muted small">
        Tot ce scrii în panou (servicii, frizeri, produse, abonamente, bannere, despre salon, regulamente, mesaje) se traduce singur în engleză și franceză
        când salvezi. Clienții cu aplicația în engleză sau franceză văd traducerea. Cu butonul de mai jos se traduce acum și ce era scris de dinainte.
      </div>
      <div className="small">
        {!status.data ? <Loading error={status.error} /> : left ? `Mai sunt ${left} texte netraduse.` : 'Tot conținutul e tradus.'}
      </div>
      {error ? <div className="err">{error}</div> : null}
      {result ? <div className={result.ok ? 'success small' : 'err'}>{result.text}</div> : null}
      <div className="row">
        <button disabled={busy} onClick={start}>
          {busy ? (progress ? `Se traduce… (${progress.done} gata, mai sunt ${progress.left})` : 'Se traduce…') : 'Tradu tot conținutul acum'}
        </button>
      </div>
    </div>
  );
}

type AdvisorInfo = { on: boolean; aiReady: boolean; today: number; last30: number; total: number };

/**
 * Consilierul AI de tunsori din aplicație („Ce tunsoare mi se potrivește?”): pornit sau oprit, și câte analize s-au făcut.
 * Pozele clienților nu se păstrează, deci aici apare doar numărul.
 */
function HairAdvisor() {
  const info = useLoad(() => api<AdvisorInfo>('GET', '/admin/advisor'));
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const d = info.data;
  return (
    <div className="card grid">
      <h2 id="set-consilier" style={{ margin: 0, scrollMarginTop: 16 }}>Consilier AI de tunsori</h2>
      <div className="muted small">
        În aplicație, clientul face o poză, iar AI-ul îi recomandă 2-4 tunsori potrivite pentru el, fiecare cu o poză de exemplu (generată cu AI), ce să-i
        spună frizerului, poze înainte/după de la salon și butonul „Programează”. Poza se folosește doar pentru analiză și se șterge imediat. Fiecare client poate face cel mult 5 analize pe zi. Ca exemple apar doar
        perechile înainte/după bifate în fișa clientului („Arată ca exemplu”).
      </div>
      {!d ? (
        <Loading error={info.error} />
      ) : (
        <>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={d.on}
              disabled={busy}
              onChange={(e) =>
                run(async () => {
                  setSaved(false);
                  info.setData(await api<AdvisorInfo>('PUT', '/admin/advisor', { on: e.target.checked }));
                  setSaved(true);
                })
              }
            />
            <b>{d.on ? 'Pornit: clienții văd „Ce tunsoare mi se potrivește?”' : 'Oprit: clienții nu văd consilierul'}</b>
          </label>
          {saved ? <span className="success small">Salvat.</span> : null}
          {!d.aiReady ? <div className="err">AI-ul nu e legat la server, deci consilierul nu apare în aplicație chiar dacă e pornit.</div> : null}
          <div className="small">
            Analize făcute: <b>{d.today}</b> azi · <b>{d.last30}</b> în ultimele 30 de zile · <b>{d.total}</b> în total
          </div>
        </>
      )}
      {error ? <div className="err">{error}</div> : null}
    </div>
  );
}

type TeamMember = { id: string; email: string; name: string; barberId: string | null; role: Role; permissions: Record<Perm, boolean>; sessions?: number };

function Team({ me }: { me: Me }) {
  const data = useLoad(() => Promise.all([api<TeamMember[]>('GET', '/admin/admins'), api<Barber[]>('GET', '/admin/barbers')]));
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('barber');
  const [barberId, setBarberId] = useState('');
  const { busy, error, run } = useAction();
  const [admins, barbers] = data.data ?? [[], []];
  const patch = (id: string, body: object) => run(async () => (await api('PATCH', `/admin/admins/${id}`, body), data.reload()));

  return (
    <div className="card grid">
      <h2 id="set-echipa" style={{ margin: 0, scrollMarginTop: 16 }}>Utilizatori și roluri</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Fiecare cont are un rol, iar drepturile rolului le poți schimba pe fiecare om în parte. Același cont merge în panou și în aplicație, la Cont → Echipă.
        Legătura cu un frizer arată în ce coloană din calendar lucrează contul.
      </p>
      {admins.map((a) => (
        <div key={a.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span>
              {a.name || a.email} <span className="muted small">{a.email}</span>{' '}
              <span className="muted small">· {a.sessions ? `conectat pe ${a.sessions === 1 ? 'un dispozitiv' : `${a.sessions} dispozitive`}` : 'deconectat'}</span>
            </span>
            {a.id !== me.id ? (
              <span className="row" style={{ gap: 6 }}>
                {a.sessions ? (
                  <button
                    className="ghost sm"
                    disabled={busy}
                    onClick={() =>
                      confirm(`Deconectezi ${a.name || a.email} de pe toate dispozitivele? Va trebui să intre din nou cu parola.`) &&
                      run(async () => (await api('POST', `/admin/admins/${a.id}/logout`), data.reload()))
                    }
                  >
                    Deconectează
                  </button>
                ) : null}
                <button className="danger sm" onClick={() => confirm(`Ștergi contul ${a.email}?`) && run(async () => (await api('DELETE', `/admin/admins/${a.id}`), data.reload()))}>
                  Șterge
                </button>
              </span>
            ) : (
              <span className="muted small">tu</span>
            )}
          </div>
          <div className="grid two" style={{ marginTop: 8 }}>
            <Field label="Rol">
              <select value={a.role} disabled={a.id === me.id || busy} onChange={(e) => patch(a.id, { role: e.target.value, permissions: {} })}>
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Frizer în calendar">
              <select value={a.barberId ?? ''} disabled={busy} onChange={(e) => patch(a.id, { barberId: e.target.value || null })}>
                <option value="">Niciunul</option>
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="muted small">{ROLE_HELP[a.role]}</div>
          {a.role !== 'org_admin' ? (
            <div className="grid" style={{ gap: 4, marginTop: 8 }}>
              {(Object.keys(PERM_LABELS) as Perm[]).map((p) => (
                <label key={p} className="check small">
                  <input type="checkbox" checked={a.permissions[p]} disabled={busy} onChange={(e) => patch(a.id, { permissions: { ...a.permissions, [p]: e.target.checked } })} />
                  {PERM_LABELS[p]}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      <h3 style={{ margin: '6px 0 0' }}>Cont nou</h3>
      <div className="grid two">
        <Field label="Nume">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="E-mail">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Parolă inițială (minim 10 caractere)">
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Rol">
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Frizer în calendar">
          <select value={barberId} onChange={(e) => setBarberId(e.target.value)}>
            <option value="">Niciunul</option>
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="muted small">{ROLE_HELP[role]}</div>
      {error ? <div className="err">{error}</div> : null}
      <div>
        <button
          disabled={busy || !email || password.length < 10}
          onClick={() =>
            run(async () => {
              await api('POST', '/admin/admins', { email, name, password, role, barberId: barberId || null });
              setEmail('');
              setName('');
              setPassword('');
              data.reload();
            })
          }
        >
          Adaugă cont
        </button>
      </div>
    </div>
  );
}

function Password() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <div className="card grid">
      <h2 id="set-parola" style={{ margin: 0, scrollMarginTop: 16 }}>Schimbă parola</h2>
      <div className="grid two">
        <Field label="Parola actuală">
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Parola nouă (minim 10 caractere)">
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      {error ? <div className="err">{error}</div> : null}
      <div className="row">
        <button
          disabled={busy || !current || next.length < 10}
          onClick={() =>
            run(async () => {
              await api('POST', '/admin/me/password', { current, next });
              setCurrent('');
              setNext('');
              setDone(true);
            })
          }
        >
          Schimbă
        </button>
        {done ? <span className="success small">Parola a fost schimbată. Celelalte dispozitive au fost deconectate.</span> : null}
      </div>
    </div>
  );
}

function Sessions() {
  const [msg, setMsg] = useState('');
  const { busy, error, run } = useAction();
  return (
    <div className="card grid">
      <h2 id="set-sesiuni" style={{ margin: 0, scrollMarginTop: 16 }}>Deconectare</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Ai uitat contul deschis pe alt calculator sau telefon? Îl poți închide de aici.
      </p>
      {error ? <div className="err">{error}</div> : null}
      <div className="row">
        <button
          className="ghost"
          onClick={async () => {
            await api('POST', '/admin/logout').catch(() => undefined);
            setToken(null);
            location.hash = '';
            location.reload();
          }}
        >
          Ieși din cont
        </button>
        <button
          className="ghost"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api<{ loggedOut: number }>('POST', '/admin/me/logout-others');
              setMsg(r.loggedOut ? `Am închis ${r.loggedOut === 1 ? 'o sesiune' : `${r.loggedOut} sesiuni`} pe alte dispozitive.` : 'Nu erai conectat pe alte dispozitive.');
            })
          }
        >
          Ieși de pe celelalte dispozitive
        </button>
        {msg ? <span className="success small">{msg}</span> : null}
      </div>
    </div>
  );
}

type Msg = { id: number; channel: string; kind: string; recipient: string; status: string; error: string | null; created_at: string };
const KIND: Record<string, string> = {
  otp: 'Cod login',
  confirm: 'Confirmare',
  cancel: 'Anulare',
  reminder_24h: 'Reminder 24h',
  reminder_2h: 'Reminder 2h',
  campaign: 'Campanie',
};

function MessageLog() {
  const log = useLoad(() => api<Msg[]>('GET', '/admin/messages'));
  return (
    <div className="card">
      <h2 id="set-mesaje" style={{ scrollMarginTop: 16 }}>Mesaje trimise (ultimele 200)</h2>
      {!log.data ? (
        <Loading error={log.error} />
      ) : log.data.length === 0 ? (
        <p className="muted small">Niciun mesaj încă.</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table>
            <tbody>
              {log.data.map((m) => (
                <tr key={m.id}>
                  <td className="small">
                    {date(m.created_at.replace(' ', 'T') + (m.created_at.endsWith('Z') ? '' : 'Z'))},{' '}
                    {time(m.created_at.replace(' ', 'T') + (m.created_at.endsWith('Z') ? '' : 'Z'))}
                  </td>
                  <td className="small">{m.channel.toUpperCase()}</td>
                  <td className="small">{KIND[m.kind] ?? m.kind}</td>
                  <td className="small">{m.recipient}</td>
                  <td className="small">
                    {m.status === 'sent' ? (m.error === 'test-mode' ? <span className="muted">test (neconectat)</span> : <span className="success">trimis</span>) : <span className="danger" title={m.error ?? ''}>eșuat</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
