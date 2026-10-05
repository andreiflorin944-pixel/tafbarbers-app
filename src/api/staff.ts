import Constants from 'expo-constants';
import { ApiError } from './client';

// Partea de echipă a aplicației (proprietar și frizeri) vorbește cu /v1/admin, cu contul din panou.
/** Pozele urcate din panou au adrese relative la server (/v1/media/...). */
export const mediaUrl = (u: string | null | undefined): string | null => (!u ? null : u.startsWith('/') ? `${apiUrl}${u}` : u);

export const apiUrl: string = (process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra?.apiUrl as string | undefined) || '').replace(/\/+$/, '');

export type Perm = 'bookings_all' | 'bookings_create' | 'bookings_manage' | 'clients' | 'timeoff' | 'stats';
export type StaffMe = { id: string; email: string; name: string; barberId: string | null; owner: boolean; permissions: Record<Perm, boolean> };
export type StaffBooking = {
  id: string;
  clientId: string;
  barberId: string;
  serviceId: string;
  start: string;
  end: string;
  price: number;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  source: string;
  note: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  barberName: string;
};

async function call<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  if (!apiUrl) throw new ApiError('no_server', 0);
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/v1${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error ?? 'server_error', res.status);
  return json as T;
}

export const staffApi = {
  login: (email: string, password: string) => call<{ token: string }>('POST', '/admin/login', null, { email, password }),
  logout: (t: string) => call('POST', '/admin/logout', t).catch(() => undefined),
  me: (t: string) => call<StaffMe>('GET', '/admin/me', t),
  bookings: (t: string, from: string, to: string) => call<StaffBooking[]>('GET', `/admin/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, t),
  setStatus: (t: string, id: string, status: string) => call<StaffBooking>('PATCH', `/admin/bookings/${id}`, t, { status }),
  create: (t: string, body: { phone: string; name: string; serviceId: string; barberId: string; start: string; notify: boolean }) =>
    call<StaffBooking>('POST', '/admin/bookings', t, body),
  timeOff: (t: string, body: { fromDay: string; toDay: string; reason: string; barberId?: string | null }) => call('POST', '/admin/time-off', t, body),
};
