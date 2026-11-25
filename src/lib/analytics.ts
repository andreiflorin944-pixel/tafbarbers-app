import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { apiUrl } from '@/api';
import { currentLang } from '@/i18n';
import { storage } from '@/lib/storage';

// Statistici anonime din aplicație: ce ecrane deschide clientul, cât stă pe fiecare și câteva apăsări importante.
// Pornesc DOAR dacă proprietarul le-a pornit în panou (Site web → Statistici și reclame → Aplicația) ȘI clientul a spus „Da”.
// Se trimit la serverul nostru (care le dă mai departe la Google Analytics), cu un număr la întâmplare al telefonului:
// fără nume, telefon, e-mail sau contul clientului. Ecranele echipei nu se urmăresc.

const CONSENT_KEY = 'taf.stats';
const CID_KEY = 'taf.stats.cid';
const SESSION_GAP = 30 * 60 * 1000; // după 30 de minute fără aplicație începe o vizită nouă (ca în Google Analytics)

type Consent = 'yes' | 'no' | null;
type Ev = { name: string; params: Record<string, string | number> };

let consent: Consent = null;
let ready = false;
let serverOn = false;
let cid: string | null = null;
let sid = 0;
let lastSeen = Date.now();
let screen: { path: string; title: string; since: number } | null = null;
let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const active = () => ready && serverOn && consent === 'yes' && !!apiUrl && Platform.OS !== 'web';

const version = () => {
  const c = Constants.expoConfig;
  return [c?.version, Platform.OS === 'android' ? c?.android?.versionCode : c?.ios?.buildNumber].filter(Boolean).join(' / ');
};

async function load() {
  consent = ((await storage.get(CONSENT_KEY)) as Consent) ?? null;
  cid = await storage.get(CID_KEY);
  if (!cid) {
    cid = `${Crypto.randomUUID()}`;
    await storage.set(CID_KEY, cid);
  }
  sid = Math.floor(Date.now() / 1000);
  ready = true;
  notify();
}
void load();

async function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!active() || !queue.length) return;
  const events = queue.slice(0, 25);
  queue = queue.slice(25);
  try {
    await fetch(apiUrl!.replace(/\/+$/, '') + '/v1/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid, sid, platform: Platform.OS, version: version(), lang: currentLang(), events }),
    });
  } catch {
    /* fără internet: statisticile astea se pierd, nu e grav */
  }
  if (queue.length) void flush();
}

function push(ev: Ev) {
  if (!active()) return;
  queue.push(ev);
  if (queue.length > 100) queue = queue.slice(-100);
  if (!timer) timer = setTimeout(() => void flush(), 8000);
}

const pageLocation = (path: string) => `https://app.tafbarbers.ro/aplicatie${path === '/' ? '' : path}`;

/** Cât a stat clientul pe ecranul curent (se trimite când pleacă de pe el sau iese din aplicație). */
function closeScreen() {
  if (!screen) return;
  const ms = Math.min(Date.now() - screen.since, SESSION_GAP);
  if (ms >= 1000) push({ name: 'user_engagement', params: { engagement_time_msec: ms, page_location: pageLocation(screen.path), page_title: screen.title } });
  screen = { ...screen, since: Date.now() };
}

// Numele ecranelor în Google Analytics (în română, ușor de citit); id-urile (frizer, serviciu) devin „:id”.
const TITLES: Record<string, string> = {
  '/': 'Acasă',
  '/services': 'Servicii',
  '/bookings': 'Programările mele',
  '/account': 'Cont',
  '/about': 'Despre salon',
  '/new': 'Rezervă',
  '/book': 'Programare · început',
  '/book/location': 'Programare · locația',
  '/book/service': 'Programare 1 · serviciul',
  '/book/barber': 'Programare 2 · frizerul',
  '/book/time': 'Programare 3 · ziua și ora',
  '/book/confirm': 'Programare 4 · confirmare',
  '/book/success': 'Programare 5 · gata',
  '/login': 'Intrare în cont',
  '/barbers': 'Frizerii',
  '/barber/:id': 'Profil frizer',
  '/service/:id': 'Detalii serviciu',
  '/assistant': 'Asistentul Tafi',
  '/advisor': 'Ce tunsoare mi se potrivește',
  '/rewards': 'Beneficii',
  '/raffle': 'Tombola',
  '/social': 'Urmărește-ne',
  '/subscriptions': 'Abonamente',
  '/custom-sub': 'Abonament personalizat',
  '/gift-cards': 'Carduri cadou',
  '/before-after': 'Înainte și după',
  '/identity': 'TAF Identity',
  '/shop': 'Magazin',
  '/shop/cart': 'Coș',
  '/shop/orders': 'Comenzile mele',
};
const normalize = (p: string) =>
  (p || '/')
    .split('/')
    .map((x) => (/\d/.test(x) && x.length > 6 ? ':id' : x))
    .join('/') || '/';

/** Ecranul deschis acum (din expo-router). */
export function trackScreen(pathname: string) {
  const path = normalize(pathname);
  if (path.startsWith('/staff') || path.startsWith('/legal')) {
    closeScreen();
    screen = null;
    return;
  }
  if (screen?.path === path) return;
  closeScreen();
  const title = TITLES[path] ?? path;
  screen = { path, title, since: Date.now() };
  push({ name: 'page_view', params: { page_location: pageLocation(path), page_title: title } });
}

/** O apăsare sau o acțiune importantă (ex. programare făcută). */
export function trackEvent(name: string, params: Record<string, string | number> = {}) {
  push({ name, params: { ...params, ...(screen && { page_location: pageLocation(screen.path), page_title: screen.title }) } });
}

// Ieșirea din aplicație închide ecranul (timpul petrecut) și trimite tot; revenirea după 30 de minute = vizită nouă.
AppState.addEventListener('change', (s) => {
  if (s === 'active') {
    if (Date.now() - lastSeen > SESSION_GAP) sid = Math.floor(Date.now() / 1000);
    if (screen) screen = { ...screen, since: Date.now() };
  } else {
    lastSeen = Date.now();
    closeScreen();
    void flush();
  }
});

/** Panoul spune dacă statisticile din aplicație sunt pornite (vine cu datele salonului). */
export function setAnalyticsServerOn(on: boolean) {
  if (serverOn === on) return;
  serverOn = on;
  notify();
}

export async function setAnalyticsConsent(v: 'yes' | 'no') {
  // „Da”: ecranul de acum se trimite din nou (înainte nu se trimitea nimic); „Nu”: aruncăm ce era în așteptare.
  if (v === 'no') queue = [];
  screen = null;
  consent = v;
  await storage.set(CONSENT_KEY, v);
  notify();
}

/** Pentru întrebarea de la început și comutatorul din Cont. */
export function useAnalytics() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { available: ready && serverOn && Platform.OS !== 'web', consent, ask: ready && serverOn && Platform.OS !== 'web' && consent === null };
}
