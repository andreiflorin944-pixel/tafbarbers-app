import type { Barber, Business, Service } from './types';

// Date de test preluate din panoul Barberly (capturi din 5 oct 2026).
// Adresa, telefonul și programul sunt provizorii până le citim din API.

export const business: Business = {
  name: 'TAFBarbers',
  tagline: 'Barbershop',
  description:
    'TAFBarbers este un barbershop de top, care oferă o experiență de tuns și îngrijire masculină deosebită. Cu o estetică elegantă și modernă, TAFBarbers se remarcă prin atenția la detalii și servicii de cea mai înaltă calitate.',
  address: 'Adresa locației (se preia din Barberly)',
  phone: '',
  instagram: 'tafbarbers',
  hours: [
    null,
    { open: '10:00', close: '20:00' },
    { open: '10:00', close: '20:00' },
    { open: '10:00', close: '20:00' },
    { open: '10:00', close: '20:00' },
    { open: '10:00', close: '20:00' },
    { open: '10:00', close: '16:00' },
  ],
};

export const services: Service[] = [
  {
    id: 'svc-haircut-beard-skin-fade',
    name: 'Haircut & Beard – TAF Skin Fade',
    description: 'Skin Fade de la 0 / 0.5 pentru un final curat și precis, plus barbă.',
    price: 100,
    durationMin: 45,
    color: '#3D4BE0',
  },
  {
    id: 'svc-haircut-beard-classic',
    name: 'Haircut & Beard – TAF Classic',
    description: 'Tuns clasic de la 0.5 în sus pentru un aspect natural, plus barbă.',
    price: 90,
    durationMin: 45,
    color: '#3D4BE0',
  },
  {
    id: 'svc-skin-fade',
    name: 'Skin Fade Haircut / Tuns Skin Fade',
    description: 'Tunsoare executată în intervalul 0.0 - 0.5.',
    price: 70,
    durationMin: 30,
    color: '#5FE0D0',
  },
  {
    id: 'svc-classic',
    name: 'Classic Haircut / Tuns Clasic',
    description: 'Tunsoare executată de la nr. 1 în sus, cu formă clasică.',
    price: 60,
    durationMin: 30,
    color: '#62D6F0',
  },
  {
    id: 'svc-beard',
    name: 'Beard Trim & Contour / Tuns & Contur Barbă',
    description: 'Tuns și contur barbă.',
    price: 35,
    durationMin: 15,
    color: '#E5625E',
  },
  {
    id: 'svc-kids',
    name: 'Kids Haircut / Tuns Copii (sub 7 ani)',
    description: 'Valabil doar pentru copii sub 7 ani.',
    price: 55,
    durationMin: 30,
    color: '#F2E85C',
  },
  {
    id: 'svc-beard-color',
    name: 'Beard Coloring / Vopsit Barbă',
    description: 'Vopsit barbă (castaniu închis / negru).',
    price: 50,
    durationMin: 15,
    color: '#444448',
  },
];

export const barbers: Barber[] = [
  { id: 'barber-florin', name: 'Florin', role: 'Barber', initials: 'F' },
  { id: 'barber-andrei', name: 'Andrei', role: 'Barber', initials: 'A' },
];
