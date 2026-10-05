import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/api';
import type { Barber, Booking, Business, Service } from '@/data/types';

type Draft = {
  serviceId: string | null;
  barberId: string | null; // null = oricine
  start: string | null;
  slotBarberId: string | null; // barber actually free at that slot
};

type User = { name: string; phone: string } | null;

type AppState = {
  business: Business | null;
  services: Service[];
  barbers: Barber[];
  loading: boolean;
  draft: Draft;
  setDraft: (patch: Partial<Draft>) => void;
  resetDraft: () => void;
  user: User;
  signIn: (u: NonNullable<User>) => void;
  signOut: () => void;
  bookings: Booking[];
  refreshBookings: () => Promise<void>;
  addBooking: (b: Booking) => void;
  cancelBooking: (id: string) => Promise<void>;
  serviceById: (id: string | null) => Service | undefined;
  barberById: (id: string | null) => Barber | undefined;
};

const emptyDraft: Draft = { serviceId: null, barberId: null, start: null, slotBarberId: null };
const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraftState] = useState<Draft>(emptyDraft);
  const [user, setUser] = useState<User>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);

  useEffect(() => {
    Promise.all([api.getBusiness(), api.getServices(), api.getBarbers()]).then(([b, s, br]) => {
      setBusiness(b);
      setServices(s);
      setBarbers(br);
      setLoading(false);
    });
  }, []);

  const refreshBookings = useCallback(async () => {
    if (!user) return setBookings([]);
    setBookings(await api.listBookings(user.phone));
  }, [user]);

  useEffect(() => {
    refreshBookings();
  }, [refreshBookings]);

  const value = useMemo<AppState>(
    () => ({
      business,
      services,
      barbers,
      loading,
      draft,
      setDraft: (patch) => setDraftState((d) => ({ ...d, ...patch })),
      resetDraft: () => setDraftState(emptyDraft),
      user,
      signIn: setUser,
      signOut: () => setUser(null),
      bookings,
      refreshBookings,
      addBooking: (b) => setBookings((prev) => [...prev, b]),
      cancelBooking: async (id) => {
        await api.cancelBooking(id);
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: 'cancelled' } : b)));
      },
      serviceById: (id) => services.find((s) => s.id === id),
      barberById: (id) => barbers.find((b) => b.id === id),
    }),
    [business, services, barbers, loading, draft, user, bookings, refreshBookings],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}
