import type { Barber, Service } from '@/data/types';
import { useApp } from '@/state/AppState';

/** Prețul unui serviciu la un anumit frizer: prețul lui propriu, altfel prețul standard. */
export function barberPrice(service: Service, barber?: Barber | null): number {
  return barber?.prices?.[service.id] ?? service.price;
}

/** Durata unui serviciu la un anumit frizer: durata lui proprie, altfel durata standard. */
export function barberDuration(service: Service, barber?: Barber | null): number {
  return barber?.durations?.[service.id] ?? service.durationMin;
}

/** „90 lei” sau, dacă frizerii au prețuri diferite, „de la 90 lei”. */
export function priceLabel(service: Service, barbers: Barber[]): string {
  const doing = barbers.filter((b) => !b.serviceIds?.length || b.serviceIds.includes(service.id));
  const all = doing.length ? doing.map((b) => barberPrice(service, b)) : [service.price];
  const min = Math.min(...all);
  return min === Math.max(...all) ? `${min} lei` : `de la ${min} lei`;
}

export function usePriceLabel() {
  const { barbers } = useApp();
  return (service: Service) => priceLabel(service, barbers);
}
