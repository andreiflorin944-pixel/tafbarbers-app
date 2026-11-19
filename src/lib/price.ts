import type { Barber, Service } from '@/data/types';
import { useApp } from '@/state/AppState';
import { tr } from '@/i18n';

/** „90 lei”, în limba aplicației. */
export const lei = (n: number) => tr('common.lei', { n });

/** Prețul unui serviciu la un anumit frizer: prețul lui propriu, altfel prețul standard. */
export function barberPrice(service: Service, barber?: Barber | null): number {
  const base = barber?.prices?.[service.id] ?? service.price;
  // Reducerea din banner, rotunjită la leu, la fel ca pe server.
  return service.offer ? Math.round((base * (100 - service.offer.percent)) / 100) : base;
}

/** Durata unui serviciu la un anumit frizer: durata lui proprie, altfel durata standard. */
export function barberDuration(service: Service, barber?: Barber | null): number {
  return barber?.durations?.[service.id] ?? service.durationMin;
}

/**
 * Prețul din listele de servicii (fără frizer ales): prețul standard din panou (Servicii), ca pe site.
 * Prețul propriu al unui frizer apare după ce clientul îl alege. `barbers` rămâne pentru compatibilitate.
 */
export function priceLabel(service: Service, _barbers?: Barber[]): string {
  const label = lei(barberPrice(service));
  return service.offer ? tr('price.offer', { price: label, n: service.offer.percent }) : label;
}

export function usePriceLabel() {
  const { barbers } = useApp();
  return (service: Service) => priceLabel(service, barbers);
}
