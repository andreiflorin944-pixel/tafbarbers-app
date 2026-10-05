import { ApiError, type BookingApi } from './client';

export function httpApi(baseUrl: string): BookingApi {
  const base = baseUrl.replace(/\/+$/, '') + '/v1';

  async function call<T>(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
          ...(opts.token && { Authorization: `Bearer ${opts.token}` }),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw new ApiError('network', 0);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(json?.error ?? 'server_error', res.status);
    return json as T;
  }

  return {
    getBusiness: () => call('GET', '/business'),
    getServices: () => call('GET', '/services'),
    getBarbers: () => call('GET', '/barbers'),
    getPromos: (lang) => call('GET', `/promos?lang=${encodeURIComponent(lang)}`),
    getAvailability: ({ serviceId, barberId, day }) =>
      call('GET', `/availability?serviceId=${encodeURIComponent(serviceId)}&barberId=${encodeURIComponent(barberId ?? '')}&day=${day}`),

    requestCode: (phone, lang) => call('POST', `/auth/otp?lang=${lang}`, { body: { phone } }),
    verifyCode: (input) => call('POST', '/auth/verify', { body: input }),
    logout: async (token) => {
      await call('POST', '/auth/logout', { token }).catch(() => undefined);
    },
    me: (token) => call('GET', '/me', { token }),
    getLegal: (doc, lang) => call('GET', `/legal/${doc}?lang=${lang}`),
    exportMe: (token) => call('GET', '/me/export', { token }),
    deleteMe: async (token) => {
      await call('DELETE', '/me', { token });
    },
    updateMe: (token, patch) => call('PATCH', '/me', { token, body: patch }),

    listBookings: (token) => call('GET', '/me/bookings', { token }),
    createBooking: (token, input) => call('POST', '/bookings', { token, body: input }),
    cancelBooking: (token, id) => call('POST', `/bookings/${encodeURIComponent(id)}/cancel`, { token }),
    registerPushToken: async (token, pushToken, platform) => {
      await call('POST', '/push-tokens', { token, body: { token: pushToken, platform } });
    },

    getProducts: () => call('GET', '/products'),
    listOrders: (token) => call('GET', '/me/orders', { token }),
    createOrder: (token, input) => call('POST', '/orders', { token, body: input }),
    cancelOrder: (token, id) => call('POST', `/orders/${encodeURIComponent(id)}/cancel`, { token }),
  };
}
