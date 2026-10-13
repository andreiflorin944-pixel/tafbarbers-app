import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '@/api';
import { staffApi } from '@/api/staff';
import { storage } from '@/lib/storage';

// Notificările pe telefon (confirmări, remindere, cererea de plată, oferte): telefonul primește un cod de la Expo,
// pe care îl trimitem serverului pentru clientul din cont. Merg doar în aplicația din magazin (sau un build EAS),
// unde există proiectul EAS; în Expo Go și pe web nu se cere nimic.

const PUSH_KEY = 'taf.push';

// Notificarea venită cât aplicația e deschisă se arată și ea, ca banner.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

const projectId = (): string | undefined =>
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId;

/** Cere voie (o singură dată, de sistem) și întoarce codul Expo al telefonului, sau null (web, Expo Go, refuzat). */
async function devicePushToken(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice || !projectId()) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'TAF Barber’s', importance: Notifications.AndroidImportance.HIGH });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
}

/** Cere voie (o singură dată, de sistem) și leagă telefonul de clientul din cont. Nu aruncă niciodată. */
export async function registerPush(token: string): Promise<void> {
  try {
    const push = await devicePushToken();
    if (!push) return;
    await api.registerPushToken(token, push, Platform.OS);
    await storage.set(PUSH_KEY, push);
  } catch {
    // Fără notificări: SMS-ul și e-mailul merg în continuare.
  }
}

// Aplicația echipei: același telefon primește și anunțurile despre programări (nouă, anulată, mutată),
// pentru contul din echipă, separat de contul de client.
const STAFF_PUSH_KEY = 'taf.staffpush';

export async function registerStaffPush(staffToken: string): Promise<void> {
  try {
    const push = await devicePushToken();
    if (!push) return;
    await staffApi.registerPush(staffToken, push, Platform.OS);
    await storage.set(STAFF_PUSH_KEY, push);
  } catch {
    /* fără anunțuri pe telefon; programările se văd în calendar */
  }
}

export async function unregisterStaffPush(staffToken: string): Promise<void> {
  try {
    const push = await storage.get(STAFF_PUSH_KEY);
    if (!push) return;
    await staffApi.unregisterPush(staffToken, push);
    await storage.set(STAFF_PUSH_KEY, null);
  } catch {
    /* nimic de făcut */
  }
}

/** La ieșirea din cont: serverul uită telefonul ăsta pentru client. */
export async function unregisterPush(token: string): Promise<void> {
  try {
    const push = await storage.get(PUSH_KEY);
    if (!push) return;
    await api.unregisterPushToken(token, push);
    await storage.set(PUSH_KEY, null);
  } catch {
    /* nimic de făcut */
  }
}

/** Unde duce atingerea unei notificări, după datele trimise de server. */
export function pushTarget(data: Record<string, unknown> | undefined): { url?: string; route?: { pathname: string; params?: Record<string, string> } } | null {
  if (!data) return null;
  if (typeof data.url === 'string' && /^https:\/\//.test(data.url)) return { url: data.url };
  // Anunț pentru echipă: calendarul, în ziua programării.
  if (data.staff) return { route: { pathname: '/staff/calendar', params: typeof data.day === 'string' ? { day: data.day } : {} } };
  if (data.bookingId) return { route: { pathname: '/bookings' } };
  if (data.orderId) return { route: { pathname: '/shop/orders' } };
  switch (data.screen) {
    case 'book': {
      const params: Record<string, string> = {};
      for (const k of ['serviceId', 'barberId', 'locationId', 'day']) if (typeof data[k] === 'string' && data[k]) params[k] = data[k] as string;
      return { route: { pathname: '/book', params } };
    }
    case 'rewards':
      return { route: { pathname: '/rewards' } };
    case 'subscriptions':
      return { route: { pathname: '/subscriptions' } };
    case 'home':
      return { route: { pathname: '/' } };
    default:
      return null;
  }
}
