import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/api';
import type { Barber, Booking, Business, Me, Promo, Service } from '@/data/types';
import { useT } from '@/i18n';
import { storage } from '@/lib/storage';
import { ACCENT_KEY, BG_KEY, colors, readSavedAccent, readSavedBackground } from '@/theme';
import { Platform } from 'react-native';

type Draft = {
  serviceId: string | null;
  barberId: string | null; // null = oricine
  start: string | null;
  slotBarberId: string | null; // frizerul liber efectiv la ora aleasă
};

type AppState = {
  business: Business | null;
  services: Service[];
  barbers: Barber[];
  promos: Promo[];
  loading: boolean;
  loadError: boolean;
  reload: () => void;
  draft: Draft;
  setDraft: (patch: Partial<Draft>) => void;
  resetDraft: () => void;
  user: Me | null;
  /** true după ce s-a verificat sesiunea salvată (până atunci nu știm dacă e logat). */
  sessionReady: boolean;
  token: string | null;
  /** Salvează sesiunea primită după verificarea codului SMS. */
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateMe: (patch: Parameters<typeof api.updateMe>[1]) => Promise<void>;
  bookings: Booking[];
  refreshBookings: () => Promise<void>;
  addBooking: (b: Booking) => void;
  cancelBooking: (id: string) => Promise<void>;
  serviceById: (id: string | null) => Service | undefined;
  barberById: (id: string | null) => Barber | undefined;
};

const TOKEN_KEY = 'taf.session';
const emptyDraft: Draft = { serviceId: null, barberId: null, start: null, slotBarberId: null };
const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { lang, setLang } = useT();
  const [business, setBusiness] = useState<Business | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraftState] = useState<Draft>(emptyDraft);
  const [user, setUser] = useState<Me | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);

  useEffect(() => {
    setLoadError(false);
    Promise.all([api.getBusiness(), api.getServices(), api.getBarbers()])
      .then(([b, s, br]) => {
        setBusiness(b);
        rememberLook(b.appearance?.accent, b.appearance?.background);
        setServices(s);
        setBarbers(br);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [attempt]);

  useEffect(() => {
    api.getPromos(lang).then(setPromos, () => setPromos([]));
  }, [lang, attempt]);

  // Sesiunea salvată de data trecută.
  useEffect(() => {
    storage.get(TOKEN_KEY).then(async (t) => {
      if (!t) return setSessionReady(true);
      try {
        const me = await api.me(t);
        if (me.lang === 'ro' || me.lang === 'en' || me.lang === 'fr') setLang(me.lang);
        setUser(me);
        setToken(t);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await storage.set(TOKEN_KEY, null);
      }
      setSessionReady(true);
    });
  }, []);

  // SMS-urile și reminder-ele pleacă în limba aleasă în aplicație.
  useEffect(() => {
    if (token && user && user.lang !== lang) api.updateMe(token, { lang }).then(setUser, () => undefined);
  }, [lang, token, user]);

  const refreshBookings = useCallback(async () => {
    if (!token) return setBookings([]);
    try {
      setBookings(await api.listBookings(token));
    } catch {
      // păstrăm lista veche
    }
  }, [token]);

  useEffect(() => {
    refreshBookings();
  }, [refreshBookings]);

  const value = useMemo<AppState>(
    () => ({
      business,
      services,
      barbers,
      promos,
      loading,
      loadError,
      reload: () => setAttempt((n) => n + 1),
      draft,
      setDraft: (patch) => setDraftState((d) => ({ ...d, ...patch })),
      resetDraft: () => setDraftState(emptyDraft),
      user,
      token,
      sessionReady,
      signIn: async (t) => {
        const me = await api.me(t);
        await storage.set(TOKEN_KEY, t);
        setToken(t);
        setUser(me);
      },
      signOut: async () => {
        if (token) await api.logout(token);
        await storage.set(TOKEN_KEY, null);
        setToken(null);
        setUser(null);
      },
      updateMe: async (patch) => {
        if (!token) return;
        setUser(await api.updateMe(token, patch));
      },
      bookings,
      refreshBookings,
      addBooking: (b) => setBookings((prev) => [...prev.filter((x) => x.id !== b.id), b]),
      cancelBooking: async (id) => {
        if (!token) return;
        const updated = await api.cancelBooking(token, id);
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...updated } : b)));
      },
      serviceById: (id) => services.find((s) => s.id === id),
      barberById: (id) => barbers.find((b) => b.id === id),
    }),
    [business, services, barbers, promos, loading, loadError, draft, user, token, sessionReady, bookings, refreshBookings],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Ține minte culorile din panou pentru pornirea următoare. Pe web reîncarcă o dată pagina, ca să se vadă imediat. */
async function rememberLook(accent: string | undefined, background: string | undefined) {
  const hex = (v: string | undefined) => (v && /^#[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null);
  const a = hex(accent);
  const bg = hex(background) ?? '#000000';
  const changed = (a && a !== colors.gold.toUpperCase()) || bg !== colors.bg.toUpperCase();
  if (!changed) return;
  if (a) await storage.set(ACCENT_KEY, a);
  await storage.set(BG_KEY, bg);
  // Doar dacă s-a salvat, altfel s-ar reîncărca la nesfârșit.
  if (Platform.OS === 'web' && (!a || readSavedAccent() === a) && (readSavedBackground() ?? '#000000') === bg) globalThis.location?.reload();
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}
