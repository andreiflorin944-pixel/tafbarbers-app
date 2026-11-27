import { useEffect, useRef, useState } from 'react';
import { api, type Me } from '../api';
import { Field, Loading, useAction, useLoad } from '../ui';

// Marketing → Tombola săptămânii. Intră singuri, o dată pe săptămână, toți clienții programați în săptămână care au telefon și e-mail
// în fișă (încasați sau nu, cu sau fără cont). Programarea ștearsă / anulată sau „nu a venit” îl scoate singur din listă.
// Serverul alege câștigătorul la întâmplare; roata doar arată rezultatul. Premiul ajunge la „Bonusurile mele” în aplicație.

type Settings = { enabled: boolean; prizes: string[]; winnersPerWeek: number; validDays: number; showWinners: boolean; rules: string; rulesUpdatedAt: string | null };
type Participant = { id: string; name: string; short: string; visits?: number; phone?: string; email?: string; firstAt?: string; upcoming?: boolean };
type Draw = { id: string; week: string; clientId: string; name: string; phone: string; prize: string; entries: number; status: 'won' | 'cancelled'; bonusStatus: string | null; drawnAt: string; drawnBy: string | null };
type NoContact = { id: string; name: string; phone: string; email: string; firstAt: string };
type Rules = { title: string; body: string; isDefault: boolean; template: string };
type Week = { settings: Settings; week: string; end: string; current: boolean; weeks: string[]; participants: Participant[]; draws: Draw[]; left: number; noContact: NoContact[]; rules: Rules };

const RANDOM = '__random__';
const pad = (n: number) => String(n).padStart(2, '0');
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(`${d}T12:00:00`).toLocaleDateString('ro-RO', opts);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const weekLabel = (w: string, i: number) => `${dayLabel(w)} – ${dayLabel(addDays(w, 6))}${i === 0 ? ' (săptămâna aceasta)' : i === 1 ? ' (săptămâna trecută)' : ''}`;
const time = (iso: string) => new Date(iso).toLocaleString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function RafflePage({ me }: { me: Me }) {
  const [week, setWeek] = useState<string>('');
  const data = useLoad(() => api<Week>('GET', `/admin/raffle${week ? `?week=${week}` : ''}`), [week]);
  const [v, setV] = useState<Settings | null>(null);
  const [rulesText, setRulesText] = useState('');
  const [saved, setSaved] = useState('');
  const save = useAction();
  const d = data.data;
  useEffect(() => {
    if (!d) return;
    // Prima deschidere: săptămâna trecută, dacă încă n-are câștigător (extragerea se face după ce se încheie săptămâna).
    if (!week) {
      setWeek(d.weeks[1]);
      return;
    }
    setV((cur) => cur ?? d.settings);
    setRulesText((cur) => cur || (d.rules.isDefault ? d.rules.template : d.settings.rules));
  }, [d, week]);

  if (!d || !v || !week) return <Loading error={data.error} />;
  const owner = me.owner;
  const set = (p: Partial<Settings>) => {
    setSaved('');
    setV({ ...v, ...p });
  };
  const saveSettings = (extra: Partial<Settings> = {}, msg = 'Salvat. Clienții văd schimbarea la următoarea deschidere a aplicației.') =>
    save.run(async () => {
      const r = await api<{ settings: Settings; rules: Rules }>('PUT', '/admin/raffle', { ...v, ...extra });
      setV(r.settings);
      setRulesText(r.rules.isDefault ? r.rules.template : r.settings.rules);
      setSaved(msg);
      data.reload();
    });

  return (
    <>
      <div className="head">
        <h1>Tombola săptămânii</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 780 }}>
        În fiecare săptămână (luni–duminică) intră automat în tombolă toți clienții <b>programați</b> în acea săptămână care au <b>telefon și e-mail</b> în
        fișă (din aplicație, site, panou sau Barberly; încasați sau nu; cu sau fără cont). Fiecare apare o singură dată, oricâte programări a avut. Dacă
        ștergi programarea din calendar sau o marchezi „Nu a venit”, clientul iese singur din tombolă. Apeși „Învârte roata”, serverul alege câștigătorul la
        întâmplare, iar premiul i se trece în fișă (și la „Bonusurile mele” în aplicație, dacă are cont). Când vine la salon, îl vedeți la încasare și îl
        bifați „folosit”. Nu se trimite niciun SMS sau e-mail.
      </p>

      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <DrawCard d={d} v={v} owner={owner} week={week} setWeek={setWeek} reload={data.reload} />

        <div className="card grid" style={{ flex: '1 1 340px', maxWidth: 460 }}>
          <h2 style={{ margin: 0 }}>Setări</h2>
          <label className="check">
            <input type="checkbox" disabled={!owner} checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Tombola pornită (o văd clienții în
            aplicație)
          </label>
          <Field label="Premiile (câte unul pe rând)">
            <div className="grid" style={{ gap: 6 }}>
              {v.prizes.map((p, i) => (
                <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
                  <input
                    disabled={!owner}
                    value={p}
                    maxLength={80}
                    onChange={(e) => set({ prizes: v.prizes.map((x, j) => (j === i ? e.target.value : x)) })}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="ghost" disabled={!owner || v.prizes.length < 2} onClick={() => set({ prizes: v.prizes.filter((_, j) => j !== i) })} title="Șterge">
                    ✕
                  </button>
                </div>
              ))}
              {owner && v.prizes.length < 20 ? (
                <button type="button" className="ghost" onClick={() => set({ prizes: [...v.prizes, ''] })} style={{ justifySelf: 'start' }}>
                  + Adaugă un premiu
                </button>
              ) : null}
            </div>
          </Field>
          <div className="grid two">
            <Field label="Câștigători pe săptămână">
              <input type="number" min={1} max={10} disabled={!owner} value={v.winnersPerWeek} onChange={(e) => set({ winnersPerWeek: Number(e.target.value) })} />
            </Field>
            <Field label="Premiul e valabil (zile)">
              <input type="number" min={1} max={365} disabled={!owner} value={v.validDays} onChange={(e) => set({ validDays: Number(e.target.value) })} />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" disabled={!owner} checked={v.showWinners} onChange={(e) => set({ showWinners: e.target.checked })} /> Arată câștigătorii în aplicație
            (doar prenumele și inițiala, ex. „Andrei P.”)
          </label>
          {save.error ? <div className="error">{save.error}</div> : null}
          {owner ? (
            <div className="row">
              <button onClick={() => saveSettings({ prizes: v.prizes.filter((p) => p.trim()) })} disabled={save.busy}>
                {save.busy ? 'Se salvează…' : 'Salvează'}
              </button>
              {saved ? <span className="small" style={{ color: 'var(--success, #3fb950)' }}>{saved}</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card grid" style={{ marginTop: 16, maxWidth: 940 }}>
        <div className="head" style={{ margin: 0 }}>
          <h2 style={{ margin: 0 }}>Regulamentul tombolei</h2>
          <a href="/tombola" target="_blank" rel="noreferrer">
            Vezi pagina publică ↗
          </a>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Legea (OG 99/2000) cere ca regulamentul să fie public și gratuit: îl găsesc clienții în aplicație și la adresa /tombola. Cuvintele între acolade se
          completează singure: {'{prizes}'} = premiile, {'{winners}'} = câștigători pe săptămână, {'{days}'} = zile de valabilitate, {'{company}'}, {'{cui}'},{' '}
          {'{seat}'} = datele firmei din Setări. Dacă schimbi premiile sus, regulamentul se schimbă singur.
          {d.rules.isDefault ? ' Acum e modelul pregătit de noi.' : ''}
        </p>
        <textarea disabled={!owner} value={rulesText} onChange={(e) => setRulesText(e.target.value)} style={{ minHeight: 280, fontFamily: 'inherit' }} />
        {owner ? (
          <div className="row">
            <button disabled={save.busy} onClick={() => saveSettings({ rules: rulesText.trim() === d.rules.template.trim() ? '' : rulesText }, 'Regulamentul a fost salvat.')}>
              Salvează regulamentul
            </button>
            {!d.rules.isDefault ? (
              <button className="ghost" disabled={save.busy} onClick={() => confirm('Revii la modelul nostru de regulament?') && saveSettings({ rules: '' }, 'Ai revenit la model.')}>
                Revino la model
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function DrawCard({ d, v, owner, week, setWeek, reload }: { d: Week; v: Settings; owner: boolean; week: string; setWeek: (w: string) => void; reload: () => void }) {
  const [prize, setPrize] = useState(RANDOM);
  const [spin, setSpin] = useState<{ list: Participant[]; angle: number; draw: Draw; done: boolean } | null>(null);
  const act = useAction();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => setSpin(null), [week]);

  const list = spin?.list ?? d.participants;
  const won = d.draws.filter((x) => x.status === 'won');
  const canSpin = owner && v.enabled && d.left > 0 && d.participants.length > 0 && !(spin && !spin.done);
  const go = () =>
    act.run(async () => {
      const r = await api<{ draw: Draw; participants: Participant[] }>('POST', '/admin/raffle/draw', { week, prize: prize === RANDOM ? undefined : prize });
      const n = r.participants.length;
      const i = Math.max(0, r.participants.findIndex((p) => p.id === r.draw.clientId));
      // Felia câștigătorului ajunge sus, sub săgeată, după câteva ture întregi (cu o mică abatere în interiorul feliei).
      const slice = 360 / n;
      const jitter = (Math.random() - 0.5) * slice * 0.6;
      const prev = spin?.angle ?? 0;
      const target = 360 * 6 + (360 - (i * slice + slice / 2)) + jitter;
      const angle = prev - (prev % 360) + target;
      setSpin({ list: r.participants, angle, draw: r.draw, done: false });
      timer.current = window.setTimeout(() => {
        setSpin((s) => (s ? { ...s, done: true } : s));
        reload();
      }, 5600);
    });
  const cancel = (x: Draw) =>
    confirm(`Anulezi extragerea câștigată de ${x.name}? Premiul îi dispare din aplicație și poți extrage din nou.`) &&
    act.run(async () => {
      await api('DELETE', `/admin/raffle/draws/${x.id}`);
      setSpin(null);
      reload();
    });

  return (
    <div className="card grid" style={{ flex: '2 1 480px', maxWidth: 640 }}>
      <div className="head" style={{ margin: 0 }}>
        <h2 style={{ margin: 0 }}>Extragerea</h2>
        <select value={week} onChange={(e) => setWeek(e.target.value)} style={{ maxWidth: 360 }}>
          {d.weeks.map((w, i) => (
            <option key={w} value={w}>
              {weekLabel(w, i)}
            </option>
          ))}
        </select>
      </div>
      {!v.enabled ? <div className="small" style={{ color: 'var(--gold)' }}>Tombola e oprită. Bifează „Tombola pornită” în dreapta și apasă Salvează.</div> : null}
      {d.current ? <div className="muted small">Săptămâna nu s-a încheiat încă: cine vine până duminică intră și el. De obicei extragi luni, pentru săptămâna trecută.</div> : null}

      <div className="row" style={{ gap: 18 }}>
        <div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--gold)' }}>{d.participants.length}</div>
          <div className="muted small">participanți</div>
        </div>
        <div>
          <div style={{ fontSize: 32, fontWeight: 800 }}>{won.length}/{v.winnersPerWeek}</div>
          <div className="muted small">câștigători extrași</div>
        </div>
      </div>

      {list.length ? <Wheel list={list} angle={spin?.angle ?? 0} winnerId={spin?.done ? spin.draw.clientId : null} /> : <div className="muted">Încă nu e niciun participant în această săptămână.</div>}

      {spin?.done ? (
        <div className="card" style={{ borderColor: 'var(--gold)', textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: 1.5, color: 'var(--gold)', fontWeight: 800 }}>🎉 CÂȘTIGĂTORUL</div>
          <div style={{ fontSize: 26, fontWeight: 800, margin: '4px 0' }}>{spin.draw.name}</div>
          <div className="muted">{spin.draw.phone}</div>
          <div style={{ marginTop: 6 }}>
            Premiu: <b>{spin.draw.prize}</b>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            Premiul i s-a trecut în fișă (și la „Bonusurile mele” în aplicație, dacă are cont). Dacă vrei să-l anunți, sună-l sau trimite-i un mesaj din fișa lui.
          </div>
        </div>
      ) : null}

      {owner ? (
        <div className="row">
          <select value={prize} onChange={(e) => setPrize(e.target.value)} disabled={!canSpin} style={{ maxWidth: 240 }}>
            <option value={RANDOM}>Premiu la întâmplare</option>
            {v.prizes.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button onClick={go} disabled={!canSpin || act.busy} style={{ fontSize: 17, padding: '10px 22px' }}>
            {spin && !spin.done ? 'Se învârte…' : '🎡 Învârte roata'}
          </button>
          {d.left === 0 ? <span className="muted small">Săptămâna are deja toți câștigătorii.</span> : null}
        </div>
      ) : null}
      {act.error ? <div className="error">{act.error}</div> : null}

      {d.draws.length ? (
        <div className="grid" style={{ gap: 6 }}>
          <h3 style={{ margin: '8px 0 0' }}>Câștigătorii săptămânii</h3>
          {d.draws.map((x) => (
            <div key={x.id} className="row" style={{ justifyContent: 'space-between', opacity: x.status === 'cancelled' ? 0.5 : 1 }}>
              <span>
                <b>{x.name}</b> <span className="muted small">{x.phone}</span> · {x.prize}{' '}
                <span className="muted small">
                  ({x.entries} participanți, {time(x.drawnAt)}
                  {x.drawnBy ? `, ${x.drawnBy}` : ''})
                </span>
              </span>
              <span className="row" style={{ gap: 8 }}>
                {x.status === 'cancelled' ? (
                  <span className="pill cancelled">anulat</span>
                ) : x.bonusStatus === 'used' ? (
                  <span className="pill completed">premiu ridicat</span>
                ) : (
                  <>
                    <span className="pill confirmed">de ridicat</span>
                    {owner ? (
                      <button className="ghost small" onClick={() => cancel(x)} disabled={act.busy}>
                        Anulează
                      </button>
                    ) : null}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid" style={{ gap: 6 }}>
        <h3 style={{ margin: '8px 0 0' }}>Participanții săptămânii ({d.participants.length})</h3>
        <div className="muted small">
          Cine nu a venit sau nu a plătit: șterge-i programarea din <a href="#/calendar">Calendar</a> sau marcheaz-o „Nu a venit” și dispare singur de aici.
        </div>
        {d.participants.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr className="muted" style={{ textAlign: 'left' }}>
                  <th style={{ padding: '4px 6px' }}>Nume</th>
                  <th style={{ padding: '4px 6px' }}>Telefon</th>
                  <th style={{ padding: '4px 6px' }}>E-mail</th>
                  <th style={{ padding: '4px 6px' }}>Programarea</th>
                </tr>
              </thead>
              <tbody>
                {d.participants.map((p) => (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--line, #2a2a2e)' }}>
                    <td style={{ padding: '4px 6px' }}>
                      <a href={`#/clients/${p.id}`}>{p.name}</a>
                    </td>
                    <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{p.phone}</td>
                    <td style={{ padding: '4px 6px', wordBreak: 'break-all' }}>{p.email}</td>
                    <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                      {p.firstAt ? time(p.firstAt) : ''}
                      {p.visits && p.visits > 1 ? <span className="muted"> (+{p.visits - 1})</span> : null}
                      {p.upcoming ? <span className="muted"> · urmează</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {d.noContact.length ? (
        <details>
          <summary className="small" style={{ cursor: 'pointer', color: 'var(--gold)' }}>
            {d.noContact.length === 1 ? '1 client programat nu intră' : `${d.noContact.length} clienți programați nu intră`}: le lipsește e-mailul sau telefonul din fișă
          </summary>
          <div className="muted small" style={{ margin: '6px 0' }}>Dacă le completezi fișa (apasă pe nume), intră și ei în tombolă.</div>
          <div className="grid small" style={{ gap: 4 }}>
            {d.noContact.map((u) => (
              <div key={u.id}>
                <a href={`#/clients/${u.id}`}>{u.name}</a> · {time(u.firstAt)} · <span className="muted">{!u.phone ? 'fără telefon' : ''}{!u.phone && !u.email ? ', ' : ''}{!u.email ? 'fără e-mail' : ''}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** Roata: o felie pe participant (numele scrise doar cât încap), săgeata sus. Se rotește până la felia câștigătorului. */
function Wheel({ list, angle, winnerId }: { list: Participant[]; angle: number; winnerId: string | null }) {
  const n = list.length;
  const R = 150;
  const slice = (2 * Math.PI) / n;
  const labels = n <= 36;
  const pt = (a: number, r = R) => [R + r * Math.sin(a), R - r * Math.cos(a)];
  return (
    <div style={{ position: 'relative', width: 'min(100%, 340px)', margin: '4px auto' }}>
      <div style={{ position: 'absolute', left: '50%', top: -4, transform: 'translateX(-50%)', zIndex: 2, width: 0, height: 0, borderLeft: '13px solid transparent', borderRight: '13px solid transparent', borderTop: '24px solid #fff', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.6))' }} />
      <svg
        viewBox={`-6 -6 ${2 * R + 12} ${2 * R + 12}`}
        style={{ width: '100%', display: 'block', transform: `rotate(${angle}deg)`, transition: angle ? 'transform 5.4s cubic-bezier(0.12, 0.7, 0.08, 1)' : 'none' }}
      >
        <circle cx={R} cy={R} r={R + 4} fill="#000" stroke="var(--gold)" strokeWidth={3} />
        {n === 1 ? (
          <circle cx={R} cy={R} r={R} fill="var(--gold)" />
        ) : (
          list.map((p, i) => {
            const [x1, y1] = pt(i * slice);
            const [x2, y2] = pt((i + 1) * slice);
            const win = p.id === winnerId;
            return (
              <path
                key={p.id}
                d={`M${R},${R} L${x1},${y1} A${R},${R} 0 ${slice > Math.PI ? 1 : 0} 1 ${x2},${y2} Z`}
                fill={win ? '#fff' : i % 2 ? '#1c1c20' : 'var(--gold)'}
                stroke="#000"
                strokeWidth={0.6}
              />
            );
          })
        )}
        {labels
          ? list.map((p, i) => {
              const mid = (i + 0.5) * slice;
              const deg = (mid * 180) / Math.PI;
              const fs = n <= 8 ? 14 : n <= 16 ? 11 : n <= 24 ? 9 : 7;
              const dark = n === 1 || i % 2 === 0 || p.id === winnerId;
              return (
                <text
                  key={p.id}
                  x={R}
                  y={R - R * 0.6}
                  // Puține felii: numele drept, în lățime; multe: de-a lungul razei, ca să încapă.
                  transform={`rotate(${deg} ${R} ${R})${n > 8 ? ` rotate(-90 ${R} ${R - R * 0.6})` : ''}`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={fs}
                  fontWeight={700}
                  fill={dark ? '#000' : '#eee'}
                >
                  {p.short.length > 14 ? `${p.short.slice(0, 13)}…` : p.short}
                </text>
              );
            })
          : null}
        <circle cx={R} cy={R} r={26} fill="#000" stroke="var(--gold)" strokeWidth={3} />
        <text x={R} y={R + 1} textAnchor="middle" dominantBaseline="middle" fontSize={13} fontWeight={800} fill="var(--gold)">
          TAF
        </text>
      </svg>
      {!labels ? <div className="muted small" style={{ textAlign: 'center', marginTop: 6 }}>{n} participanți (prea mulți ca să încapă numele pe roată)</div> : null}
    </div>
  );
}
