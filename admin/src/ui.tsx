import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { errorText, uploadImage, type Translations } from './api';

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

export const emptyTr = (): Translations => ({ en: {}, fr: {} });

/**
 * Engleza și franceza unor texte scrise în română. Se traduc singure când salvezi; aici le poți corecta de mână.
 * Corectura rămâne până schimbi textul în română (atunci textul nou se traduce din nou). Un câmp golit se traduce din nou automat.
 */
export function TranslationFields({
  fields,
  ro,
  initialRo,
  value,
  onChange,
}: {
  fields: Array<{ key: string; label: string; multiline?: boolean; tall?: boolean }>;
  /** Textele în română, așa cum sunt acum în formular. */
  ro: Record<string, string | null | undefined>;
  /** Textele în română de la deschiderea formularului (ca să arătăm că se traduc din nou). */
  initialRo?: Record<string, string | null | undefined>;
  value: Translations;
  onChange: (v: Translations) => void;
}) {
  const shown = fields.filter((f) => (ro[f.key] ?? '').trim());
  if (!shown.length) return null;
  const missing = shown.some((f) => !value.en[f.key]?.trim() || !value.fr[f.key]?.trim());
  const set = (l: 'en' | 'fr', k: string, v: string) => onChange({ ...value, [l]: { ...value[l], [k]: v } });
  return (
    <details className="translations">
      <summary>
        Engleză și franceză <span className="muted small">{missing ? '· se traduc singure la salvare' : '· traduse'}</span>
      </summary>
      <p className="muted small">
        Se traduc singure din română când salvezi. Dacă o traducere nu sună bine, corecteaz-o aici: corectura rămâne până schimbi textul în română. Golește un
        câmp ca să se traducă din nou automat.
      </p>
      {(['en', 'fr'] as const).map((l) => (
        <div key={l} className="grid" style={{ marginBottom: 8 }}>
          <strong className="small">{l === 'en' ? 'Engleză' : 'Franceză'}</strong>
          {shown.map((f) => {
            const changed = initialRo !== undefined && (initialRo[f.key] ?? '') !== (ro[f.key] ?? '');
            const v = value[l][f.key] ?? '';
            return (
              <Field key={f.key} label={f.label}>
                {f.multiline ? (
                  <textarea value={v} onChange={(e) => set(l, f.key, e.target.value)} style={{ minHeight: f.tall ? 320 : 60, lineHeight: f.tall ? 1.5 : undefined }} placeholder="Se traduce la salvare" />
                ) : (
                  <input value={v} onChange={(e) => set(l, f.key, e.target.value)} placeholder="Se traduce la salvare" />
                )}
                {changed ? <span className="muted small">Ai schimbat textul în română: dacă nu corectezi aici, se traduce din nou la salvare.</span> : null}
              </Field>
            );
          })}
        </div>
      ))}
    </details>
  );
}
