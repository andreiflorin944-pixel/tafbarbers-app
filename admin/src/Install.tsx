import { useEffect, useState } from 'react';
import { Modal } from './ui';

// Evenimentul prin care Chrome și Edge (Windows și Mac) oferă instalarea panoului ca aplicație.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  listeners.forEach((f) => f());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((f) => f());
});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/** Panoul rulează deja ca aplicație instalată (fereastră proprie, fără browser). */
const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function browser(): 'safari' | 'edge' | 'chrome' | 'firefox' | 'other' {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

/** Butonul „Descarcă aplicația” din bara de sus: instalează panoul pe Windows sau Mac, ca să nu mai deschizi browserul. */
export function InstallButton() {
  const [, rerender] = useState(0);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(standalone);
  useEffect(() => {
    const f = () => rerender((n) => n + 1);
    listeners.add(f);
    const mq = window.matchMedia('(display-mode: standalone)');
    const m = () => setInstalled(standalone());
    mq.addEventListener('change', m);
    return () => {
      listeners.delete(f);
      mq.removeEventListener('change', m);
    };
  }, []);
  if (installed) return null;

  const click = async () => {
    if (!deferred) return setHelp(true);
    const p = deferred;
    await p.prompt();
    const { outcome } = await p.userChoice;
    if (outcome === 'accepted') deferred = null;
    rerender((n) => n + 1);
  };

  return (
    <>
      <button className="install-btn" onClick={click} title="Instalează panoul pe calculator (Windows sau Mac)">
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12M7 10l5 5 5-5M4 19h16" />
        </svg>
        <span>Descarcă aplicația</span>
      </button>
      {help ? <InstallHelp onClose={() => setHelp(false)} /> : null}
    </>
  );
}

function InstallHelp({ onClose }: { onClose: () => void }) {
  const b = browser();
  const mac = /Mac/.test(navigator.platform || navigator.userAgent);
  const phone = /iPhone|iPad|Android/.test(navigator.userAgent) || (mac && navigator.maxTouchPoints > 1);
  return (
    <Modal title="Instalează panoul pe calculator" onClose={onClose}>
      <p className="muted">După instalare, panoul se deschide dintr-o iconiță, în fereastra lui, fără browser. Se actualizează singur.</p>
      {phone ? (
        <ol className="install-steps">
          <li>
            Apasă <b>Distribuie</b> (pătratul cu săgeată) sau meniul <b>⋮</b>.
          </li>
          <li>
            Alege <b>Adaugă pe ecranul principal</b>.
          </li>
        </ol>
      ) : b === 'safari' ? (
        <ol className="install-steps">
          <li>
            Sus în meniu, apasă <b>Fișier</b> (File).
          </li>
          <li>
            Alege <b>Adaugă în Dock</b> (Add to Dock), apoi <b>Adaugă</b>.
          </li>
          <li>Iconița „TAF Panou” apare în Dock și în Aplicații.</li>
        </ol>
      ) : b === 'chrome' || b === 'edge' ? (
        <ol className="install-steps">
          <li>
            În bara de adresă, sus în dreapta, apasă iconița de instalare <b>⊕</b> (sau meniul <b>⋮</b> / <b>…</b>).
          </li>
          <li>
            Alege <b>{b === 'edge' ? 'Aplicații → Instalați acest site ca aplicație' : 'Transmite, salvează și trimite → Instalează pagina ca aplicație'}</b>, apoi <b>Instalează</b>.
          </li>
          <li>Iconița „TAF Panou” apare {mac ? 'în Launchpad și în Dock' : 'în meniul Start și pe Desktop'}.</li>
        </ol>
      ) : (
        <p>
          Browserul acesta nu poate instala aplicații. Deschide <b>panou.tafbarbers.ro</b> în {mac ? <b>Safari, Chrome sau Edge</b> : <b>Chrome sau Edge</b>} și apasă
          din nou „Descarcă aplicația”.
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={onClose}>Am înțeles</button>
      </div>
    </Modal>
  );
}
