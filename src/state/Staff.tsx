import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { staffApi, type StaffMe } from '@/api/staff';
import { registerStaffPush, unregisterStaffPush } from '@/lib/push';
import { storage } from '@/lib/storage';

// Sesiunea de echipă (proprietar / frizer), separată de contul de client.
type StaffState = {
  staff: StaffMe | null;
  staffToken: string | null;
  /** true după ce s-a verificat sesiunea salvată. */
  staffReady: boolean;
  staffSignIn: (email: string, password: string) => Promise<void>;
  staffSignOut: () => Promise<void>;
  /** Actualizează local datele contului (de ex. poza nouă), fără o cerere în plus. */
  staffPatch: (patch: Partial<StaffMe>) => void;
};

const KEY = 'taf.staff';
const Ctx = createContext<StaffState | null>(null);

export function StaffProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffMe | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    storage.get(KEY).then(async (t) => {
      if (!t) return setReady(true);
      try {
        setStaff(await staffApi.me(t));
        setToken(t);
        void registerStaffPush(t);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await storage.set(KEY, null);
      }
      setReady(true);
    });
  }, []);

  const value = useMemo<StaffState>(
    () => ({
      staff,
      staffToken: token,
      staffReady: ready,
      staffSignIn: async (email, password) => {
        const { token: t } = await staffApi.login(email.trim().toLowerCase(), password);
        const me = await staffApi.me(t);
        await storage.set(KEY, t);
        setToken(t);
        setStaff(me);
        void registerStaffPush(t);
      },
      staffSignOut: async () => {
        if (token) {
          await unregisterStaffPush(token);
          await staffApi.logout(token);
        }
        await storage.set(KEY, null);
        setToken(null);
        setStaff(null);
      },
      staffPatch: (patch) => setStaff((s) => (s ? { ...s, ...patch } : s)),
    }),
    [staff, token, ready],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStaff() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStaff must be used inside StaffProvider');
  return ctx;
}
