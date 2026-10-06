import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { errorText, uploadImage } from './api';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost sm" onClick={onClose} aria-label="Închide">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="f">
      {label}
      {children}
    </label>
  );
}

/** Încarcă date și le reîncarcă la cerere; păstrează eroarea ca text. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let live = true;
    run().then(
      (d) => live && (setData(d), setError(null)),
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [run, n]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}

/** Rulează o acțiune async, cu stare de „se salvează” și mesaj de eroare. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function Loading({ error }: { error?: string | null }) {
  return <p className={error ? 'err' : 'muted'}>{error ?? 'Se încarcă…'}</p>;
}

/** Poză: previzualizare, urcare de pe calculator și scoatere. */
export function ImagePicker({
  value,
  onChange,
  keepAlpha,
  maxPx,
  round,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  keepAlpha?: boolean;
  maxPx?: number;
  round?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="row" style={{ alignItems: 'center', gap: 12 }}>
      <div className={`thumb${round ? ' round' : ''}`}>{value ? <img src={value} alt="" /> : <span className="muted small">fără poză</span>}</div>
      <label className={`btn ghost sm${busy ? ' disabled' : ''}`}>
        {busy ? 'Se urcă…' : value ? 'Schimbă poza' : 'Încarcă poză'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            setError(null);
            try {
              onChange(await uploadImage(f, { keepAlpha, maxPx }));
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {value ? (
        <button className="ghost sm" type="button" onClick={() => onChange(null)}>
          Scoate
        </button>
      ) : null}
      {error ? <span className="err small">{error}</span> : null}
    </div>
  );
}

/** A doua parte din adresa panoului (#/pagină/sub), ca meniul să deschidă direct un tab sau un raport. */
export function useSub(): string {
  const get = () => decodeURIComponent(location.hash.replace(/^#\/?/, '').split('/')[1] ?? '');
  const [sub, setSub] = useState(get);
  useEffect(() => {
    const f = () => setSub(get());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return sub;
}
