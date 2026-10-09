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

  /** Trimite o poză locală (deja micșorată) ca fișier în corpul cererii. */
  async function upload<T>(method: string, path: string, token: string, uri: string): Promise<T> {
    let res: Response;
    try {
      const blob = await (await fetch(uri)).blob();
      res = await fetch(base + path, { method, headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${token}` }, body: blob });
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
    getAvailability: ({ serviceId, barberId, day, token }) =>
      call('GET', `/availability?serviceId=${encodeURIComponent(serviceId)}&barberId=${encodeURIComponent(barberId ?? '')}&day=${day}`, { token: token ?? undefined }),

    requestCode: (input, lang) => call('POST', `/auth/otp?lang=${lang}`, { body: input }),
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
    setProfilePhoto: (token, uri) => upload('PUT', '/me/photo', token, uri),
    removeProfilePhoto: async (token) => {
      await call('DELETE', '/me/photo', { token });
    },
    getIdentity: (token) => call('GET', '/me/identity', { token }),
    getReferrals: (token) => call('GET', '/me/referrals', { token }),
    getSubscriptions: (token) => call('GET', '/me/subscriptions', { token }),
    getGiftCards: (token) => call('GET', '/me/gift-cards', { token }),
    buyGiftCard: (token, input) => call('POST', '/me/gift-cards', { token, body: input }),
    cancelGiftCard: async (token, id) => {
      await call('POST', `/me/gift-cards/${encodeURIComponent(id)}/cancel`, { token });
    },
    payGiftCard: (token, id) => call('POST', `/me/gift-cards/${encodeURIComponent(id)}/pay`, { token }),
    getBeforeAfter: async (token) =>
      (await call<Array<{ id: string; before: string; after: string; barberName: string | null; createdAt: string }>>('GET', '/me/before-after', { token })).map((x) => ({
        ...x,
        before: x.before.startsWith('/') ? baseUrl.replace(/\/+$/, '') + x.before : x.before,
        after: x.after.startsWith('/') ? baseUrl.replace(/\/+$/, '') + x.after : x.after,
      })),
    saveIdentityNote: (token, note) => call('PUT', '/me/identity', { token, body: { note } }),
    addIdentityPhoto: (token, uri) => upload('POST', '/me/identity/photos', token, uri),
    removeIdentityPhoto: async (token, id) => {
      await call('DELETE', `/me/identity/photos/${encodeURIComponent(id)}`, { token });
    },

    listBookings: (token) => call('GET', '/me/bookings', { token }),
    createBooking: (token, input) => call('POST', '/bookings', { token, body: input }),
    cancelBooking: (token, id) => call('POST', `/bookings/${encodeURIComponent(id)}/cancel`, { token }),
    getWaitlist: (token) => call('GET', '/me/waitlist', { token }),
    joinWaitlist: (token, input) => call('POST', '/me/waitlist', { token, body: input }),
    leaveWaitlist: async (token, id) => {
      await call('DELETE', `/me/waitlist/${encodeURIComponent(id)}`, { token });
    },
    registerPushToken: async (token, pushToken, platform) => {
      await call('POST', '/push-tokens', { token, body: { token: pushToken, platform } });
    },

    getProducts: () => call('GET', '/products'),
    listOrders: (token) => call('GET', '/me/orders', { token }),
    createOrder: (token, input) => call('POST', '/orders', { token, body: input }),
    cancelOrder: (token, id) => call('POST', `/orders/${encodeURIComponent(id)}/cancel`, { token }),
    payOrder: (token, id) => call('POST', `/orders/${encodeURIComponent(id)}/pay`, { token }),
    qrOpen: (token, code) => call('POST', '/me/qr', { token, body: { code } }),
    payBooking: (token, id) => call('POST', `/bookings/${encodeURIComponent(id)}/pay`, { token }),
    assistant: (input, token) => call('POST', '/assistant', { body: input, token: token ?? undefined }),
    assistantVoice: async (uri, lang, token) => {
      let res: Response;
      try {
        const blob = await (await fetch(uri)).blob();
        res = await fetch(`${base}/assistant/voice?lang=${lang}`, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/m4a', ...(token && { Authorization: `Bearer ${token}` }) },
          body: blob,
        });
      } catch {
        throw new ApiError('network', 0);
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(json?.error ?? 'server_error', res.status);
      return json as { text: string };
    },
  };
}
