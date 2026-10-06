import { useEffect, useState } from 'react';
import { api, ApiError, errorText, getToken, uploadImageTo } from '../api';
import { Field, Loading, Modal, useAction, useLoad } from '../ui';
import { date, time } from '../util';

// Postări pe Facebook, Instagram și TikTok: conturile se conectează o dată, apoi încarci poze sau un clip,
// scrii textul, bifezi unde pleacă și ora. Serverul le publică singur la ora aleasă.

type Network = 'facebook' | 'instagram' | 'tiktok';
type Account = { id: string; network: Network; name: string; createdAt: string };
type Status = {
  accounts: Account[];
  meta: boolean;
  tiktok: boolean;
  storage: boolean;
  publicUrl: boolean;
  redirectMeta: string;
  redirectTiktok: string;
};
type Media = { id: string; kind: 'image' | 'video'; url: string };
type Result = { status: 'sending' | 'processing' | 'done' | 'failed'; at: string; url?: string; error?: string };
type Post = {
  id: string;
  caption: string;
  media: Media[];
  targets: string[];
  scheduledAt: string | null;
  status: 'draft' | 'scheduled' | 'posting' | 'done' | 'partial' | 'failed';
  results: Record<string, Result>;
  createdAt: string;
};

const NET: Record<Network, { label: string; color: string }> = {
  facebook: { label: 'Facebook', color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E1306C' },
  tiktok: { label: 'TikTok', color: '#25F4EE' },
};
const POST_STATUS: Record<Post['status'], [string, string]> = {
  draft: ['Ciornă', 'off'],
  scheduled: ['Programată', 'confirmed'],
  posting: ['Se postează', 'ready'],
  done: ['Postată', 'completed'],
  partial: ['Postată parțial', 'confirmed'],
  failed: ['Nu s-a postat', 'cancelled'],
};
const RESULT_TEXT: Record<Result['status'], string> = { sending: 'se trimite', processing: 'se procesează', done: 'postat', failed: 'eroare' };
const ERRORS: Record<string, string> = {
  cancelled: 'Ai renunțat la conectare.',
  no_pages: 'Contul de Facebook nu are nicio pagină. Postările merg doar pe o pagină de Facebook, nu pe profilul personal.',
  bad_state: 'Legătura de conectare a expirat. Încearcă din nou.',
  meta_failed: 'Facebook nu a permis conectarea. Încearcă din nou.',
  tiktok_failed: 'TikTok nu a permis conectarea. Încearcă din nou.',
  meta_not_configured: 'Lipsește aplicația Meta pe server (vezi pașii de mai jos).',
  tiktok_not_configured: 'Lipsește aplicația TikTok pe server (vezi pașii de mai jos).',
};
const VIDEO_MAX = 95_000_000;
const CAPTION_MAX = 2200;

export function SocialPage() {
  const status = useLoad(() => api<Status>('GET', '/admin/social/status'));
  const posts = useLoad(() => api<Post[]>('GET', '/admin/social/posts'));
  const [editing, setEditing] = useState<Partial<Post> | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const { busy, error, run } = useAction();

  // Întoarcerea de la Facebook / TikTok: #/social?connected=meta&pages=1&ig=1 sau ?error=…
  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
    if (q.get('connected') === 'meta') {
      const ig = Number(q.get('ig') ?? 0);
      setNotice({ ok: true, text: `Conectat. Pagini de Facebook: ${q.get('pages')}. Conturi Instagram: ${ig}.${ig ? '' : ' Contul de Instagram trebuie să fie de tip Business și legat de pagină.'}` });
    } else if (q.get('connected') === 'tiktok') setNotice({ ok: true, text: 'Contul de TikTok e conectat.' });
    else if (q.get('error')) setNotice({ ok: false, text: ERRORS[q.get('error')!] ?? `Conectarea nu a mers (${q.get('error')}).` });
    if (q.toString()) history.replaceState(null, '', '#/social');
  }, []);

  // Cât timp ceva se postează, reîmprospătăm lista.
  useEffect(() => {
    if (!posts.data?.some((p) => p.status === 'posting')) return;
    const t = setTimeout(posts.reload, 8000);
    return () => clearTimeout(t);
  }, [posts.data]);

  if (!status.data) return <Loading error={status.error} />;
  const s = status.data;
  const accounts = s.accounts;
  const connect = (net: 'meta' | 'tiktok') =>
    run(async () => {
      const r = await api<{ url: string }>('GET', `/admin/social/connect/${net}`);
      location.href = r.url;
    });

  return (
    <>
      <div className="head">
        <h1>Postări pe rețele</h1>
        <button disabled={!accounts.length} onClick={() => setEditing({ caption: '', media: [], targets: accounts.filter((a) => a.network !== 'tiktok').map((a) => a.id) })}>
          + Postare nouă
        </button>
      </div>
      <p className="muted small" style={{ marginTop: -8, maxWidth: 760 }}>
        Încarci poze sau un clip, scrii textul, bifezi unde pleacă și ora. Postarea pleacă singură pe Facebook, Instagram și TikTok.
      </p>
      {notice ? <div className={notice.ok ? 'success' : 'err'} style={{ marginBottom: 12 }}>{notice.text}</div> : null}

      <div className="card grid" style={{ maxWidth: 820, marginBottom: 18 }}>
        <h3 style={{ margin: 0 }}>Conturi conectate</h3>
        {accounts.length ? (
          accounts.map((a) => (
            <div key={a.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 8 }}>
                <span className="pill" style={{ background: NET[a.network].color, color: a.network === 'tiktok' ? '#000' : '#fff' }}>
                  {NET[a.network].label}
                </span>
                {a.name}
              </span>
              <button
                className="ghost sm"
                disabled={busy}
                onClick={() =>
                  confirm(`Deconectezi ${a.name}? Postările programate pe acest cont nu mai pleacă.`) &&
                  run(async () => {
                    await api('DELETE', `/admin/social/accounts/${a.id}`);
                    status.reload();
                  })
                }
              >
                Deconectează
              </button>
            </div>
          ))
        ) : (
          <p className="muted small" style={{ margin: 0 }}>Niciun cont conectat încă.</p>
        )}
        <div className="row">
          <button disabled={busy || !s.meta} onClick={() => connect('meta')}>
            Conectează Facebook și Instagram
          </button>
          <button disabled={busy || !s.tiktok} onClick={() => connect('tiktok')}>
            Conectează TikTok
          </button>
        </div>
        {error ? <div className="err">{error}</div> : null}
        {!s.meta || !s.tiktok || !s.storage || !s.publicUrl ? <Setup s={s} /> : null}
      </div>

      <h3>Postările tale</h3>
      {!posts.data ? (
        <Loading error={posts.error} />
      ) : !posts.data.length ? (
        <p className="muted">Nicio postare încă.</p>
      ) : (
        <div className="grid" style={{ maxWidth: 820 }}>
          {posts.data.map((p) => (
            <PostCard key={p.id} p={p} accounts={accounts} onEdit={() => setEditing(p)} onChanged={posts.reload} />
          ))}
        </div>
      )}

      {editing ? (
        <Composer
          post={editing}
          status={s}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            posts.reload();
          }}
        />
      ) : null}
    </>
  );
}

function Setup({ s }: { s: Status }) {
  const step = (done: boolean, text: React.ReactNode) => (
    <li style={{ marginBottom: 6 }}>
      <span className={done ? 'success' : ''}>{done ? '✓ ' : ''}</span>
      {text}
    </li>
  );
  return (
    <details open={!s.meta}>
      <summary className="small" style={{ cursor: 'pointer' }}>Ce trebuie făcut o singură dată</summary>
      <ol className="small" style={{ paddingLeft: 18, marginBottom: 0 }}>
        {step(s.publicUrl, 'Adresa publică a serverului (PUBLIC_URL) pusă pe server.')}
        {step(s.storage, 'Spațiul pentru clipuri (Cloudflare R2) pornit. Fără el merg doar pozele.')}
        {step(
          s.meta,
          <>
            Aplicația Meta: pe developers.facebook.com creezi o aplicație de tip Business și adaugi Facebook Login. La „Valid OAuth Redirect URIs” pui{' '}
            <code>{s.redirectMeta}</code>. Pagina de Facebook trebuie să fie legată de contul de Instagram de tip Business. Cheile (App ID și App Secret) se pun pe server, nu aici.
          </>,
        )}
        {step(
          s.tiktok,
          <>
            Aplicația TikTok: pe developers.tiktok.com creezi o aplicație cu Login Kit și Content Posting API. La Redirect URI pui <code>{s.redirectTiktok}</code>. Până o aprobă TikTok, clipurile apar doar privat pe cont.
          </>,
        )}
      </ol>
    </details>
  );
}

function PostCard({ p, accounts, onEdit, onChanged }: { p: Post; accounts: Account[]; onEdit: () => void; onChanged: () => void }) {
  const { busy, error, run } = useAction();
  const [label, cls] = POST_STATUS[p.status];
  const when = p.scheduledAt ?? p.createdAt;
  return (
    <div className="card grid" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="row" style={{ gap: 8 }}>
          <span className={`pill ${cls}`}>{label}</span>
          <span className="muted small">
            {p.status === 'draft' ? 'fără oră' : `${date(when)}, ${time(when)}`}
          </span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          {p.status === 'draft' || p.status === 'scheduled' ? (
            <button className="ghost sm" onClick={onEdit}>
              Editează
            </button>
          ) : null}
          {p.status !== 'posting' ? (
            <button
              className="ghost sm"
              disabled={busy}
              onClick={() =>
                confirm(p.status === 'done' || p.status === 'partial' ? 'Ștergi postarea din listă? De pe rețele nu se șterge.' : 'Ștergi postarea?') &&
                run(async () => {
                  await api('DELETE', `/admin/social/posts/${p.id}`);
                  onChanged();
                })
              }
            >
              Șterge
            </button>
          ) : null}
        </span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {p.media.map((m) => (
          <Thumb key={m.id} m={m} size={56} />
        ))}
      </div>
      {p.caption ? <div style={{ whiteSpace: 'pre-wrap' }}>{p.caption.length > 220 ? `${p.caption.slice(0, 220)}…` : p.caption}</div> : null}
      <div className="row" style={{ gap: 6 }}>
        {p.targets.map((t) => {
          const a = accounts.find((x) => x.id === t);
          const r = p.results[t];
          const name = a ? `${NET[a.network].label} ${a.name}` : 'Cont deconectat';
          return (
            <span key={t} className="small" title={r?.error ?? ''}>
              <span className={`pill ${r?.status === 'done' ? 'completed' : r?.status === 'failed' ? 'cancelled' : ''}`}>
                {name}
                {r ? ` · ${RESULT_TEXT[r.status]}` : ''}
              </span>
              {r?.url ? (
                <>
                  {' '}
                  <a href={r.url} target="_blank" rel="noreferrer">
                    vezi
                  </a>
                </>
              ) : null}
            </span>
          );
        })}
      </div>
      {Object.values(p.results)
        .filter((r) => r.error)
        .map((r, i) => (
          <div key={i} className="err small">
            {r.error}
          </div>
        ))}
      {error ? <div className="err">{error}</div> : null}
    </div>
  );
}

function Thumb({ m, size, onRemove }: { m: Media; size: number; onRemove?: () => void }) {
  const style = { width: size, height: size, objectFit: 'cover' as const, borderRadius: 8, background: 'var(--card-alt)', display: 'block' };
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {m.kind === 'video' ? <video src={m.url} style={style} muted playsInline preload="metadata" /> : <img src={m.url} alt="" style={style} />}
      {m.kind === 'video' ? <span className="pill" style={{ position: 'absolute', left: 4, bottom: 4, fontSize: 10 }}>clip</span> : null}
      {onRemove ? (
        <button type="button" className="ghost sm" onClick={onRemove} style={{ position: 'absolute', top: 2, right: 2, padding: '0 6px' }} aria-label="Scoate">
          ×
        </button>
      ) : null}
    </span>
  );
}

/** Urcă un clip direct (fără micșorare), cu progres. */
function uploadVideo(file: File, onProgress: (pct: number) => void): Promise<Media> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/v1/admin/social/media');
    x.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    x.setRequestHeader('Content-Type', file.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      const j = (() => {
        try {
          return JSON.parse(x.responseText);
        } catch {
          return null;
        }
      })();
      if (x.status >= 200 && x.status < 300) resolve(j);
      else reject(new ApiError(j?.error ?? 'server_error', x.status));
    };
    x.onerror = () => reject(new ApiError('network', 0));
    x.send(file);
  });
}

const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Composer({ post, status, onClose, onDone }: { post: Partial<Post>; status: Status; onClose: () => void; onDone: () => void }) {
  const [caption, setCaption] = useState(post.caption ?? '');
  const [media, setMedia] = useState<Media[]>(post.media ?? []);
  const [targets, setTargets] = useState<string[]>(post.targets ?? []);
  const [mode, setMode] = useState<'now' | 'later'>(post.scheduledAt ? 'later' : 'now');
  const [when, setWhen] = useState(localInput(post.scheduledAt ? new Date(post.scheduledAt) : new Date(Date.now() + 3_600_000)));
  const [uploading, setUploading] = useState<string | null>(null);
  const { busy, error, run, setError } = useAction();

  const hasVideo = media.some((m) => m.kind === 'video');
  const chosen = status.accounts.filter((a) => targets.includes(a.id));
  const problem = !media.length
    ? 'Adaugă cel puțin o poză sau un clip.'
    : !targets.length
      ? 'Bifează unde să plece postarea.'
      : chosen.some((a) => a.network === 'tiktok') && !hasVideo
        ? 'Pe TikTok se pot posta doar clipuri.'
        : mode === 'later' && new Date(when).getTime() < Date.now() - 60_000
          ? 'Ora aleasă a trecut.'
          : null;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    for (const f of Array.from(files)) {
      const isVideo = f.type.startsWith('video/');
      if (isVideo && (hasVideo || media.length)) {
        setError('Un clip se postează singur, fără alte poze sau clipuri.');
        continue;
      }
      if (!isVideo && hasVideo) {
        setError('Postarea are deja un clip. Pozele merg într-o postare separată.');
        continue;
      }
      if (media.length >= 10) {
        setError('Cel mult 10 poze într-o postare.');
        break;
      }
      if (isVideo && f.size > VIDEO_MAX) {
        setError('Clipul e prea mare (cel mult 95 MB). Exportă-l mai mic din telefon.');
        continue;
      }
      try {
        setUploading(isVideo ? 'Se urcă clipul… 0%' : 'Se urcă poza…');
        const m = isVideo
          ? await uploadVideo(f, (pct) => setUploading(`Se urcă clipul… ${pct}%`))
          : ((await uploadImageTo('/v1/admin/social/media', f, { maxPx: 1440 })) as Media);
        setMedia((x) => [...x, m]);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setUploading(null);
      }
    }
  };

  const save = (kind: 'draft' | 'send') =>
    run(async () => {
      const body = {
        caption,
        media: media.map((m) => m.id),
        targets,
        draft: kind === 'draft',
        now: kind === 'send' && mode === 'now',
        scheduledAt: mode === 'later' ? new Date(when).toISOString() : null,
      };
      if (post.id) await api('PATCH', `/admin/social/posts/${post.id}`, body);
      else await api('POST', '/admin/social/posts', body);
      onDone();
    });

  const move = (i: number, d: number) =>
    setMedia((x) => {
      const y = [...x];
      const j = i + d;
      if (j < 0 || j >= y.length) return x;
      [y[i], y[j]] = [y[j], y[i]];
      return y;
    });

  return (
    <Modal title={post.id ? 'Editează postarea' : 'Postare nouă'} onClose={onClose}>
      <div className="grid">
        <Field label={`Poze (până la 10) sau un clip${status.storage ? '' : '. Clipurile merg după ce pornim spațiul pentru clipuri.'}`}>
          <input type="file" accept={status.storage ? 'image/*,video/mp4,video/quicktime' : 'image/*'} multiple disabled={!!uploading} onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
        </Field>
        {uploading ? <div className="muted small">{uploading}</div> : null}
        {media.length ? (
          <div className="row" style={{ gap: 8 }}>
            {media.map((m, i) => (
              <span key={m.id} style={{ display: 'grid', gap: 2, justifyItems: 'center' }}>
                <Thumb m={m} size={84} onRemove={() => setMedia((x) => x.filter((y) => y.id !== m.id))} />
                {media.length > 1 ? (
                  <span className="row" style={{ gap: 2 }}>
                    <button type="button" className="ghost sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Mută la stânga">
                      ‹
                    </button>
                    <button type="button" className="ghost sm" onClick={() => move(i, 1)} disabled={i === media.length - 1} aria-label="Mută la dreapta">
                      ›
                    </button>
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
        <Field label={`Text (${caption.length}/${CAPTION_MAX})`}>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))} style={{ minHeight: 110 }} placeholder="Scrie textul postării, cu emoji și #hashtaguri" />
        </Field>
        <div className="f">
          Unde pleacă
          <div className="grid" style={{ gap: 6, marginTop: 6 }}>
            {status.accounts.map((a) => (
              <label key={a.id} className="check">
                <input type="checkbox" checked={targets.includes(a.id)} onChange={(e) => setTargets((x) => (e.target.checked ? [...x, a.id] : x.filter((y) => y !== a.id)))} />{' '}
                {NET[a.network].label} · {a.name}
                {a.network === 'tiktok' ? <span className="muted small"> (doar clipuri)</span> : null}
              </label>
            ))}
          </div>
        </div>
        <div className="f">
          Când
          <div className="row" style={{ marginTop: 6 }}>
            <label className="check">
              <input type="radio" checked={mode === 'now'} onChange={() => setMode('now')} /> Acum
            </label>
            <label className="check">
              <input type="radio" checked={mode === 'later'} onChange={() => setMode('later')} /> La data și ora
            </label>
            {mode === 'later' ? <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ width: 'auto' }} /> : null}
          </div>
        </div>
        {error ? <div className="err">{error}</div> : problem && (media.length || targets.length) ? <div className="muted small">{problem}</div> : null}
        <div className="row">
          <button disabled={busy || !!uploading || !!problem} onClick={() => save('send')}>
            {mode === 'now' ? 'Postează acum' : 'Programează'}
          </button>
          <button className="ghost" disabled={busy || !!uploading} onClick={() => save('draft')}>
            Salvează ca ciornă
          </button>
        </div>
      </div>
    </Modal>
  );
}
