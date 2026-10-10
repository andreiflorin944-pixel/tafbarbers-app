import type { Barber, Service } from '@/data/types';

// Ordinea programării: 1) locația, 2) frizerul, 3) serviciul, 4) ziua și ora, 5) confirmarea.
// Pașii deja aleși (serviciul de pe pagina lui, frizerul de pe Acasă, linkul din lista de așteptare) se sar.

/** Frizerul face serviciul? (fără listă de servicii = le face pe toate, ca în datele de test) */
export const doesService = (b: Barber, serviceId: string) => !b.serviceIds?.length || b.serviceIds.includes(serviceId);

/** Frizerii unei locații (cu o singură locație, și cei fără locație trecută). */
export function barbersAt(barbers: Barber[], locationId: string | null, single: boolean) {
  return barbers.filter((b) => b.locationId === locationId || (!b.locationId && single));
}

/** Serviciile pe care le face frizerul ales sau, pentru „orice frizer”, măcar unul din locație. */
export function servicesFor(services: Service[], barber: Barber | undefined, here: Barber[]) {
  return services.filter((s) => (barber ? doesService(barber, s.id) : here.some((b) => doesService(b, s.id))));
}
