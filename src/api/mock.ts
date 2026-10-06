import { barbers, business, promos, services } from '@/data/mock';
import type { Booking, Identity, Me, Slot } from '@/data/types';
import { dayKey, formatTime, fromDayKey, parseHM } from '@/lib/dates';
import { ApiError, type BookingApi } from './client';

const STEP_MIN = 15;
// Varianta de test, fără server: totul stă în memorie, orice cod din 4 cifre e acceptat.
// Token-ul e chiar numărul de telefon.
const bookings: Array<Booking & { phone: string }> = [];
const users = new Map<string, Me>();

const delay = <T,>(value: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(value), ms));

// Deterministic "already booked" blocks so the calendar looks realistic.
function seededBusy(day: string, barberId: string) {
  let seed = 0;
  for (const ch of day + barberId) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  const blocks: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    seed = (seed * 7919 + 17) % 9973;
    const startHour = 10 + (seed % 9);
    const startMin = (seed % 4) * 15;
    const len = [30, 45, 30, 60][seed % 4];
    const start = startHour * 60 + startMin;
    blocks.push([start, start + len]);
  }
  return blocks;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}


const identities = new Map<string, Identity>();
const identityOf = (token: string) => {
  if (!identities.has(token)) identities.set(token, { note: '', photos: [] });
  return identities.get(token)!;
};
export const mockApi: BookingApi = {
  getBusiness: () => delay(business),
  getServices: () => delay(services),
  getBarbers: () => delay(barbers),

  async getAvailability({ serviceId, barberId, day }) {
    const service = services.find((s) => s.id === serviceId);
    const date = fromDayKey(day);
    const hours = business.hours[date.getDay()];
    if (!service || !hours) return delay([]);

    const open = parseHM(date, hours.open);
    const close = parseHM(date, hours.close);
    const now = Date.now();
    const candidates = barberId ? barbers.filter((b) => b.id === barberId) : barbers;
    const byTime = new Map<string, Slot>();

    for (const barber of candidates) {
      const busy = seededBusy(day, barber.id);
      for (const b of bookings) {
        if (b.status !== 'confirmed' || b.barberId !== barber.id) continue;
        const s = new Date(b.start);
        if (s.toDateString() !== date.toDateString()) continue;
        const dur = services.find((x) => x.id === b.serviceId)?.durationMin ?? 30;
        const m = s.getHours() * 60 + s.getMinutes();
        busy.push([m, m + dur]);
      }

      for (let t = open.getTime(); t + service.durationMin * 60000 <= close.getTime(); t += STEP_MIN * 60000) {
        if (t < now) continue;
        const d = new Date(t);
        const m = d.getHours() * 60 + d.getMinutes();
        if (busy.some(([bs, be]) => overlaps(m, m + service.durationMin, bs, be))) continue;
        const key = formatTime(d);
        if (!byTime.has(key)) byTime.set(key, { start: d.toISOString(), barberId: barber.id });
      }
    }

    return delay([...byTime.values()].sort((a, b) => a.start.localeCompare(b.start)));
  },

  getPromos: () => delay(promos),

  requestCode: ({ phone, email, channel }) => {
    const p = phone.replace(/\s/g, '');
    return delay({ phone: p, channel, sentTo: channel === 'email' && email ? email : p, devCode: undefined });
  },
  async verifyCode({ phone, code, name, lang }) {
    if (!/^\d{4}$/.test(code)) throw new ApiError('wrong_code', 400);
    const p = phone.replace(/\s/g, '');
    if (!users.has(p))
      users.set(p, { id: p, phone: p, name, email: null, lang, marketing: { sms: false, email: false, push: true } });
    return delay({ token: p });
  },
  logout: () => delay(undefined),
  getLegal: (doc) =>
    delay({
      title: doc === 'terms' ? 'Termeni și condiții' : 'Politica de confidențialitate',
      body: 'Versiune de test. Textul real se editează din panou, la Regulamente, după ce aplicația e legată de server.',
      updatedAt: null,
    }),
  async exportMe(token) {
    return delay({ profile: users.get(token), bookings: bookings.filter((b) => b.phone === token) });
  },
  async deleteMe(token) {
    users.delete(token);
    return delay(undefined);
  },
  async me(token) {
    const u = users.get(token);
    if (!u) throw new ApiError('unauthorized', 401);
    return delay({ ...u });
  },
  async setProfilePhoto(token, uri) {
    const u = users.get(token);
    if (u) users.set(token, { ...u, photoUrl: uri });
    return delay({ photoUrl: uri });
  },
  async removeProfilePhoto(token) {
    const u = users.get(token);
    if (u) users.set(token, { ...u, photoUrl: null });
    return delay(undefined);
  },
  getIdentity: (token) => delay(identityOf(token)),
  getReferrals: () =>
    delay({
      enabled: true,
      code: 'DEMO42',
      referred: 1,
      reward: '10% reducere la următoarea tunsoare',
      bonuses: [
        { id: 'bn-demo', title: '10% reducere la următoarea tunsoare', kind: 'percent', value: 10, source: 'referral', status: 'active', expiresAt: null, createdAt: new Date().toISOString(), usedAt: null },
      ],
    }),
  getSubscriptions: () =>
    delay({
      plans: [
        { id: 'pl-4', name: 'Lunar 4 tunsori', description: 'Patru tunsori clasice într-o lună.', price: 150, periodDays: 30, cuts: 4, serviceIds: ['svc-classic'] },
        { id: 'pl-u', name: 'Nelimitat', description: 'Tunsori și barbă oricât de des într-o lună.', price: 250, periodDays: 30, cuts: null, serviceIds: [] },
      ],
      subscriptions: [],
    }),
  getGiftCards: () => delay({ enabled: true, amounts: [50, 100, 150, 200], validMonths: 12, bought: [], received: [] }),
  buyGiftCard: () => delay({ id: `gc-${Date.now()}` }),
  cancelGiftCard: () => delay(undefined),
  getBeforeAfter: () => delay([]),
  async saveIdentityNote(token, note) {
    identityOf(token).note = note;
    return delay(identityOf(token));
  },
  async addIdentityPhoto(token, uri) {
    const id = identityOf(token);
    if (id.photos.length >= 5) throw new ApiError('too_many_photos', 409);
    const p = { id: `ph-${Date.now()}`, url: uri, caption: '' };
    id.photos.push(p);
    return delay(p);
  },
  async removeIdentityPhoto(token, pid) {
    const id = identityOf(token);
    id.photos = id.photos.filter((p) => p.id !== pid);
    return delay(undefined);
  },
  async updateMe(token, patch) {
    const u = users.get(token);
    if (!u) throw new ApiError('unauthorized', 401);
    const next = { ...u, ...patch, marketing: { ...u.marketing, ...patch.marketing } };
    users.set(token, next);
    return delay({ ...next });
  },

  async createBooking(token, input) {
    const service = services.find((s) => s.id === input.serviceId);
    const slots = await mockApi.getAvailability({ serviceId: input.serviceId, barberId: input.barberId, day: dayKey(new Date(input.start)) });
    const slot = slots.find((s) => s.start === input.start);
    if (!slot || !service) throw new ApiError('slot_unavailable', 409);
    const booking = {
      id: `bk-${Date.now()}`,
      serviceId: input.serviceId,
      barberId: slot.barberId,
      start: input.start,
      price: service.price,
      status: 'confirmed' as const,
      phone: token,
    };
    bookings.push(booking);
    return delay({ ...booking }, 500);
  },

  listBookings: (token) => delay(bookings.filter((b) => b.phone === token).map((b) => ({ ...b }))),

  async cancelBooking(token, id) {
    const b = bookings.find((x) => x.id === id && x.phone === token);
    if (!b) throw new ApiError('booking_not_found', 404);
    b.status = 'cancelled';
    return delay({ ...b });
  },
  registerPushToken: () => delay(undefined),

  // Magazinul există doar cu serverul real; în modul de test lista e goală și secțiunea nu apare.
  getProducts: () => delay([]),
  listOrders: () => delay([]),
  createOrder: () => Promise.reject(new ApiError('no_server', 0)),
  cancelOrder: () => Promise.reject(new ApiError('no_server', 0)),
};
