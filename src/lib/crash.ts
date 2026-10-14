import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiUrl } from '@/api';
import { SESSION_KEY, storage } from '@/lib/storage';

// Când aplicația se închide neașteptat, eroarea se ține minte pe telefon și se trimite serverului la pornirea următoare
// (doar textul erorii și versiunea aplicației), ca s-o vedem în panou și s-o reparăm fără să întrebăm clientul.

const KEY = 'taf.crash';
type Saved = { message: string; stack: string; fatal: boolean };

const version = () => {
  const c = Constants.expoConfig;
  return [c?.version, Platform.OS === 'android' ? c?.android?.versionCode : c?.ios?.buildNumber].filter(Boolean).join(' / ');
};

const describe = (e: unknown): { message: string; stack: string } => {
  if (e instanceof Error) return { message: `${e.name}: ${e.message}`.slice(0, 500), stack: (e.stack ?? '').slice(0, 1200) };
  return { message: String(e).slice(0, 500), stack: '' };
};

/** Trimite serverului o eroare. Nu aruncă niciodată. */
export async function reportError(e: unknown, fatal = false): Promise<void> {
  if (!apiUrl || Platform.OS === 'web') return;
  try {
    const token = await storage.get(SESSION_KEY);
    await fetch(apiUrl.replace(/\/+$/, '') + '/v1/app-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ ...describe(e), fatal, platform: Platform.OS, version: version() }),
    });
  } catch {
    /* fără internet: nu e grav */
  }
}

type Handler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsT = { getGlobalHandler: () => Handler; setGlobalHandler: (h: Handler) => void };

/** Prinde erorile care ar închide aplicația: le ține minte, apoi lasă sistemul să facă ce făcea. */
export function installCrashReporter(): void {
  const eu = (globalThis as { ErrorUtils?: ErrorUtilsT }).ErrorUtils;
  if (!eu || Platform.OS === 'web') return;
  const previous = eu.getGlobalHandler();
  eu.setGlobalHandler((error, isFatal) => {
    if (!isFatal) {
      void reportError(error);
      return previous(error, isFatal);
    }
    const saved: Saved = { ...describe(error), fatal: true };
    // Scrierea durează puțin; nu ținem aplicația deschisă mai mult de o secundă pentru ea.
    Promise.race([storage.set(KEY, JSON.stringify(saved)), new Promise((r) => setTimeout(r, 1000))]).finally(() => previous(error, isFatal));
  });
  // Eroarea de data trecută, dacă aplicația s-a închis atunci.
  storage.get(KEY).then(async (raw) => {
    if (!raw) return;
    await storage.set(KEY, null);
    try {
      const s = JSON.parse(raw) as Saved;
      const err = new Error(s.message);
      err.name = 'Crash';
      err.stack = s.stack;
      await reportError(err, true);
    } catch {
      /* nimic de trimis */
    }
  });
}
