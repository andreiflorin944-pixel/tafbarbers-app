import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { api } from '@/api';
import { SESSION_KEY, storage } from '@/lib/storage';

// „Anunță-mă când sunt lângă salon”: cu acordul clientului, telefonul urmărește zona din jurul fiecărei locații
// (geofencing, făcut de sistem; aplicația nu află și nu trimite poziția). La intrarea în zonă anunță serverul, care
// decide dacă trimite un push: doar cu ore libere în curând, fără programare deja făcută, cel mult de câteva ori pe săptămână.

const TASK = 'taf-nearby';
const FLAG = 'taf.nearby';
const ASKED = 'taf.nearby.asked';

if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(TASK, async ({ data, error }) => {
    if (error || !data || data.eventType !== Location.GeofencingEventType.Enter || !data.region?.identifier) return;
    const token = await storage.get(SESSION_KEY);
    if (token) await api.nearbyEnter(token, data.region.identifier).catch(() => undefined);
  });
}

export const nearbySupported = Platform.OS !== 'web';

/** Opțiunea e pornită pe telefonul ăsta. */
export async function nearbyOn(): Promise<boolean> {
  return (await storage.get(FLAG)) === '1';
}

/** Salonul are opțiunea pornită în panou și cel puțin o locație cu coordonate. */
export async function nearbyAvailable(): Promise<boolean> {
  if (!nearbySupported) return false;
  try {
    return (await api.getNearby()).enabled;
  } catch {
    return false;
  }
}

async function watch(): Promise<boolean> {
  const cfg = await api.getNearby();
  if (!cfg.enabled || !cfg.locations.length) {
    if (await TaskManager.isTaskRegisteredAsync(TASK)) await Location.stopGeofencingAsync(TASK);
    return false;
  }
  // Token-ul salvat înainte de opțiune se rescrie, ca să poată fi citit și cu telefonul blocat.
  const token = await storage.get(SESSION_KEY);
  if (token) await storage.set(SESSION_KEY, token);
  await Location.startGeofencingAsync(
    TASK,
    cfg.locations.map((l) => ({ identifier: l.id, latitude: l.lat, longitude: l.lng, radius: cfg.radius, notifyOnEnter: true, notifyOnExit: false })),
  );
  return true;
}

/** Pornește opțiunea: cere voie la locație (întâi cât aplicația e deschisă, apoi „tot timpul”) și urmărește zonele. */
export async function startNearby(): Promise<'ok' | 'denied' | 'off'> {
  if (!nearbySupported) return 'off';
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return 'denied';
  if (!(await watch())) return 'off';
  await storage.set(FLAG, '1');
  return 'ok';
}

/**
 * Întrebarea de după instalare: o singură dată pe telefon, doar dacă salonul a pornit opțiunea, clientul a acceptat
 * ofertele pe telefon și n-a pornit-o deja. Marchează întrebarea ca pusă, ca să nu mai apară.
 */
export async function shouldOfferNearby(marketingPush: boolean): Promise<boolean> {
  try {
    if (!nearbySupported || !marketingPush || (await storage.get(ASKED)) === '1' || (await nearbyOn())) return false;
    if (!(await nearbyAvailable())) return false;
    await storage.set(ASKED, '1');
    return true;
  } catch {
    return false;
  }
}

export async function stopNearby(): Promise<void> {
  await storage.set(FLAG, null);
  try {
    if (await TaskManager.isTaskRegisteredAsync(TASK)) await Location.stopGeofencingAsync(TASK);
  } catch {
    /* nimic de oprit */
  }
}

/** La pornirea aplicației: zonele urmează ce e în panou acum (locații noi, altă rază, oprit). Nu aruncă niciodată. */
export async function syncNearby(): Promise<void> {
  try {
    if (!nearbySupported || !(await nearbyOn())) return;
    if ((await Location.getBackgroundPermissionsAsync()).status !== 'granted') return void (await stopNearby());
    await watch();
  } catch {
    /* rămân zonele de data trecută */
  }
}
