import { barbers, business, services } from '@/data/mock';
import type { Booking, Slot } from '@/data/types';
import { formatTime, fromDayKey, parseHM } from '@/lib/dates';
import type { BookingApi } from './client';

const STEP_MIN = 15;
const bookings: Booking[] = [];

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

  async createBooking(input) {
    const booking: Booking = { ...input, id: `bk-${Date.now()}`, status: 'confirmed' };
    bookings.push(booking);
    return delay(booking, 500);
  },

  listBookings: (clientPhone) =>
    delay(bookings.filter((b) => b.clientPhone === clientPhone).map((b) => ({ ...b }))),

  async cancelBooking(id) {
    const b = bookings.find((x) => x.id === id);
    if (b) b.status = 'cancelled';
    return delay(undefined);
  },
};
