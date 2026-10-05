import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'ro' | 'en';
export const LANGS: Array<{ code: Lang; flag: string; name: string }> = [
  { code: 'ro', flag: '🇷🇴', name: 'Română' },
  { code: 'en', flag: '🇬🇧', name: 'English' },
];

const ro = {
  'tab.home': 'Acasă',
  'tab.services': 'Servicii',
  'tab.bookings': 'Programări',
  'tab.about': 'Despre',
  'home.welcome': 'Bine ai venit la',
  'home.hi': 'Salut, {name}',
  'home.next': 'URMĂTOAREA PROGRAMARE',
  'home.ctaKicker': 'TUNS · BARBĂ · STIL',
  'home.ctaTitle': 'Rezervă în 30 de secunde',
  'home.ctaText': 'Alegi serviciul, frizerul și ora. Restul e treaba noastră.',
  'home.book': 'Programează-te',
  'home.newBooking': 'Programare nouă',
  'home.services': 'Servicii',
  'home.seeAll': 'Vezi toate',
  'home.team': 'Frizerii noștri',
  'lang.title': 'Alege limba',
  'services.title': 'Servicii',
  'services.sub': 'Prețuri și durate',
  'bookings.title': 'Programările mele',
  'bookings.upcoming': 'Urmează',
  'bookings.past': 'Trecut',
} as const;

type Key = keyof typeof ro;

// EN covers the main screens; untranslated keys fall back to Romanian.
const en: Partial<Record<Key, string>> = {
  'tab.home': 'Home',
  'tab.services': 'Services',
  'tab.bookings': 'Bookings',
  'tab.about': 'About',
  'home.welcome': 'Welcome to',
  'home.hi': 'Hi, {name}',
  'home.next': 'NEXT APPOINTMENT',
  'home.ctaKicker': 'CUT · BEARD · STYLE',
  'home.ctaTitle': 'Book in 30 seconds',
  'home.ctaText': 'Pick the service, the barber and the time. We handle the rest.',
  'home.book': 'Book now',
  'home.newBooking': 'New booking',
  'home.services': 'Services',
  'home.seeAll': 'See all',
  'home.team': 'Our barbers',
  'lang.title': 'Choose language',
  'services.title': 'Services',
  'services.sub': 'Prices and durations',
  'bookings.title': 'My bookings',
  'bookings.upcoming': 'Upcoming',
  'bookings.past': 'Past',
};

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: Key, vars?: Record<string, string>) => string };
const I18n = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('ro');
  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (k, vars) => {
        let s: string = (lang === 'en' && en[k]) || ro[k];
        for (const [v, val] of Object.entries(vars ?? {})) s = s.replace(`{${v}}`, val);
        return s;
      },
    }),
    [lang],
  );
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useT() {
  const ctx = useContext(I18n);
  if (!ctx) throw new Error('useT must be used inside I18nProvider');
  return ctx;
}
