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

/** „90 lei” sau, dacă frizerii au prețuri diferite, „de la 90 lei”. */
export function priceLabel(service: Service, barbers: Barber[]): string {
  const doing = barbers.filter((b) => !b.serviceIds?.length || b.serviceIds.includes(service.id));
  const all = doing.length ? doing.map((b) => barberPrice(service, b)) : [barberPrice(service)];
  const min = Math.min(...all);
  const label = min === Math.max(...all) ? lei(min) : tr('price.from', { price: lei(min) });
  return service.offer ? tr('price.offer', { price: label, n: service.offer.percent }) : label;
}

export function usePriceLabel() {
  const { barbers } = useApp();
  return (service: Service) => priceLabel(service, barbers);
}
