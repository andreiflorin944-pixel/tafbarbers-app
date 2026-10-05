// Shapes mirror what we expect from the Barberly Booking API (catalog + bookings).
// Adjust field names once the OpenAPI document is in hand.

export type Service = {
  id: string;
  name: string;
  description: string;
  price: number; // lei
  durationMin: number;
  color: string;
};

export type Barber = {
  id: string;
  name: string;
  role: string;
  initials: string;
};

export type Slot = {
  start: string; // ISO datetime
  barberId: string;
};

export type Booking = {
  id: string;
  serviceId: string;
  barberId: string;
  start: string; // ISO datetime
  clientName: string;
  clientPhone: string;
  status: 'confirmed' | 'cancelled';
};

export type Business = {
  name: string;
  tagline: string;
  description: string;
  address: string;
  phone: string;
  website: string;
  instagram: string;
  cancellationPolicy: string;
  // 0 = duminică ... 6 = sâmbătă; null = închis
  hours: Array<{ open: string; close: string } | null>;
};
