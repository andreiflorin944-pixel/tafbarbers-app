import type { Barber, Booking, Business, Service, Slot } from '@/data/types';

// Single seam between the UI and the backend. Today it is backed by mock data;
// next it will call our Cloudflare Worker, which forwards to the Barberly
// Booking API with the secret X-Api-Key (the key never ships in the app).
export interface BookingApi {
  getBusiness(): Promise<Business>;
  getServices(): Promise<Service[]>;
  getBarbers(): Promise<Barber[]>;
  getAvailability(input: {
    serviceId: string;
    barberId: string | null; // null = oricine e liber
    day: string; // YYYY-MM-DD
  }): Promise<Slot[]>;
  createBooking(input: Omit<Booking, 'id' | 'status'>): Promise<Booking>;
  listBookings(clientPhone: string): Promise<Booking[]>;
  cancelBooking(id: string): Promise<void>;
}
