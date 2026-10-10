import type { Barber, Business, Location, Promo, Service } from './types';

// Date de test preluate din panoul Barberly (capturi din 5 oct 2026).
// i18n-ok-file: e conținutul salonului (cel scris în panou), nu text al aplicației; cu server, vine tradus de acolo.
// Adresa, telefonul și programul sunt provizorii până le citim din API.

export const business: Business = {
  name: 'TAFBarbers',
  tagline: 'Barbershop',
  description:
    'TAFBarbers este un barbershop de top, care oferă o experiență de tuns și îngrijire masculină deosebită. Cu o estetică elegantă și modernă, TAFBarbers se remarcă prin atenția la detalii și servicii de cea mai înaltă calitate.',
  address: 'Adresa locației (se preia din Barberly)',
  phone: '',
  website: 'https://www.tafbarbers.ro',
  instagram: 'tafbarbers',
  cancellationPolicy:
    'Poți anula programarea cu cel mult 12 ore înainte și se acceptă o singură neprezentare. Orice altă neprezentare sau anulare cu mai puțin de 12 ore înainte implică plata integrală a programării.',
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

export const locations: Location[] = [{ id: 'loc-main', name: 'TAFBarbers', address: 'Rediu, Iași', phone: '' }];

export const barbers: Barber[] = [
  { id: 'barber-florin', name: 'Florin', role: 'Barber', initials: 'F', locationId: 'loc-main' },
  { id: 'barber-andrei', name: 'Andrei', role: 'Barber', initials: 'A', locationId: 'loc-main' },
];

// Bannere de marketing pentru prima pagină. Textele sunt de test: le schimbăm
// cu oferta reală, produsul vedetă și datele academiei.
export const promos: Promo[] = [
  {
    id: 'promo-week',
    kicker: 'OFERTA SĂPTĂMÂNII',
    title: '-15% la Haircut & Beard',
    text: 'De luni până miercuri, la orice frizer. Locuri limitate.',
    cta: 'Rezervă oferta',
    icon: 'pricetag',
    action: { type: 'service', serviceId: 'svc-haircut-beard-skin-fade' },
  },
  {
    id: 'promo-bestseller',
    kicker: 'CEL MAI CERUT SERVICIU',
    title: 'Skin Fade Haircut',
    text: 'Alegerea nr. 1 a clienților noștri săptămâna aceasta.',
    cta: 'Programează-te',
    icon: 'flame',
    action: { type: 'service', serviceId: 'svc-skin-fade' },
  },
  {
    id: 'promo-product',
    kicker: 'PRODUSUL SĂPTĂMÂNII',
    title: 'Ceară de păr mată',
    text: 'Fixare puternică, aspect natural. O găsești în salon.',
    cta: 'Întreabă frizerul',
    icon: 'bag-handle',
    action: { type: 'book' },
  },
  {
    id: 'promo-academy',
    kicker: 'ACADEMIA TAF',
    title: 'Devino barber',
    text: 'Curs pentru începători, grupă nouă în curând. Rezervă-ți locul.',
    cta: 'Află mai mult',
    icon: 'school',
    action: { type: 'url', url: 'https://www.tafbarbers.ro' },
  },
];
