import { Hono } from 'hono';
import { getBusiness, type Business } from './db';
import type { AppEnv, Env } from './env';
import { getAutomations } from './growth';
import { STORE_LINKS } from './stores';
import { getWebsite, isSiteHost, siteCity, siteOrigin, type Website } from './website';

// Paginile „de citit” ale site-ului (fără JavaScript), pentru Google și asistenții AI (ChatGPT, Gemini, Claude, Perplexity):
//   /servicii, /servicii/<serviciu>, /frizeri, /intrebari-frecvente
// Totul se construiește la fiecare cerere din panou: servicii, prețuri (și prețurile proprii ale frizerilor), program,
// frizeri, adresă, telefonul salonului, întrebările scrise în Panou → Site web → Asistenți AI. Nimic nu se scrie de mână aici.

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const one = (s: string) => s.replace(/\s+/g, ' ').trim();
const lei = (bani: number) => `${Number.isInteger(bani / 100) ? bani / 100 : (bani / 100).toFixed(2)} lei`;
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const RO_DAYS = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** „Tuns + Barbă” → „tuns-barba” (adresa paginii serviciului). */
export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'serviciu';

export type SiteService = { id: string; name: string; description: string; durationMin: number; priceBani: number; addon: boolean; slug: string };
export type SiteBarber = { id: string; name: string; nickname: string; role: string; bio: string; photo: string | null; slug: string; serviceIds: string[] };
export type SiteData = {
  w: Website;
  biz: Business;
  origin: string;
  city: string;
  services: SiteService[];
  barbers: SiteBarber[];
  /** Prețul / durata proprie a unui frizer, pe serviciu (cheia: `${barberId}|${serviceId}`). */
  own: Map<string, { priceBani: number | null; durationMin: number | null }>;
  hours: Array<{ weekday: number; s: number; e: number }>;
  giftCard: boolean;
};

/** Toate datele publice ale salonului, citite din panou (o singură dată pe cerere). */
export async function siteData(env: Env): Promise<SiteData> {
  const [w, biz, svc, barbers, own, hours, auto] = await Promise.all([
    getWebsite(env),
    getBusiness(env),
    env.DB.prepare('SELECT id, name, description, duration_min, price_bani, addon FROM services WHERE active = 1 AND members_only = 0 ORDER BY addon, sort, name LIMIT 60').all<{
      id: string;
      name: string;
      description: string | null;
      duration_min: number;
      price_bani: number;
      addon: number;
    }>(),
    env.DB.prepare('SELECT id, name, nickname, role, bio, photo_url FROM barbers WHERE active = 1 ORDER BY sort, name').all<{
      id: string;
      name: string;
      nickname: string | null;
      role: string | null;
      bio: string | null;
      photo_url: string | null;
    }>(),
    env.DB.prepare('SELECT bs.barber_id, bs.service_id, bs.price_bani, bs.duration_min FROM barber_services bs JOIN barbers b ON b.id = bs.barber_id WHERE b.active = 1').all<{
      barber_id: string;
      service_id: string;
      price_bani: number | null;
      duration_min: number | null;
    }>(),
    env.DB.prepare(
      'SELECT h.weekday, MIN(h.start_min) AS s, MAX(h.end_min) AS e FROM working_hours h JOIN barbers b ON b.id = h.barber_id WHERE b.active = 1 GROUP BY h.weekday',
    ).all<{ weekday: number; s: number; e: number }>(),
    getAutomations(env).catch(() => null),
  ]);
  const origin = siteOrigin(env, w);
  const abs = (u: string | null) => (!u ? null : /^https?:/.test(u) ? u : `${origin}${u.startsWith('/') ? '' : '/'}${u}`);
  const used = new Set<string>();
  const unique = (s: string) => {
    let x = s;
    for (let i = 2; used.has(x); i++) x = `${s}-${i}`;
    used.add(x);
    return x;
  };
  const services = svc.results.map((x) => ({
    id: x.id,
    name: one(x.name),
    description: one(x.description ?? ''),
    durationMin: x.duration_min,
    priceBani: x.price_bani,
    addon: !!x.addon,
    slug: unique(slugify(x.name)),
  }));
  used.clear();
  const map = new Map<string, { priceBani: number | null; durationMin: number | null }>();
  for (const o of own.results) map.set(`${o.barber_id}|${o.service_id}`, { priceBani: o.price_bani, durationMin: o.duration_min });
  return {
    w,
    biz,
    origin,
    city: siteCity(biz.address),
    services,
    barbers: barbers.results.map((b) => ({
      id: b.id,
      name: one(b.name),
      nickname: one(b.nickname ?? ''),
      role: one(b.role ?? ''),
      bio: one(b.bio ?? ''),
      photo: abs(b.photo_url),
      slug: unique(slugify(b.name)),
      serviceIds: own.results.filter((o) => o.barber_id === b.id).map((o) => o.service_id),
    })),
    own: map,
    hours: hours.results.sort((x, y) => ((x.weekday + 6) % 7) - ((y.weekday + 6) % 7)),
    giftCard: !!auto?.giftCard?.enabled,
  };
}

/** Linkurile salonului pe alte site-uri (Instagram, Facebook, TikTok, Google Maps, Mero…): pentru `sameAs`, ca Google și AI să știe că sunt același salon. */
export function profileLinks(d: SiteData) {
  const { biz, w } = d;
  const handle = (v: string | undefined, base: string) => (v ? (/^https?:/.test(v) ? v : `${base}${v.replace(/^@/, '')}`) : null);
  return [
    ...new Set(
      [
        handle(biz.instagram, 'https://www.instagram.com/'),
        handle(biz.facebook, 'https://www.facebook.com/'),
        biz.tiktok ? (/^https?:/.test(biz.tiktok) ? biz.tiktok : `https://www.tiktok.com/@${biz.tiktok.replace(/^@/, '')}`) : null,
        ...(w.profiles ?? []),
        ...w.links.map((l) => l.url).filter((u) => /^https:\/\/([a-z0-9-]+\.)*(instagram|facebook|tiktok|youtube|google|goo|mero|maps\.app\.goo)\.[a-z.]+\//i.test(u)),
      ].filter((x): x is string => !!x && /^https:\/\//.test(x)),
    ),
  ];
}

const mapsUrl = (d: SiteData) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.biz.name} ${d.biz.address}`)}`;

/** Prețul și durata unui serviciu la un frizer (prețul propriu, dacă are). */
const atBarber = (d: SiteData, b: SiteBarber, s: SiteService) => {
  const o = d.own.get(`${b.id}|${s.id}`);
  return { priceBani: o?.priceBani ?? s.priceBani, durationMin: s.addon ? s.durationMin : (o?.durationMin ?? s.durationMin) };
};
const barbersFor = (d: SiteData, s: SiteService) => d.barbers.filter((b) => b.serviceIds.includes(s.id));
const priceText = (d: SiteData, s: SiteService) => {
  const all = [s.priceBani, ...barbersFor(d, s).map((b) => atBarber(d, b, s).priceBani)].filter((x) => x > 0);
  if (!all.length) return '';
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  return lo === hi ? lei(lo) : `${lei(lo)} – ${lei(hi)}`;
};

/** Programul pe zile: „Luni: 09:00–19:00”, „Duminică: închis”. */
export function hoursLines(d: SiteData) {
  if (!d.hours.length) return [];
  const out: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const day = i % 7;
    const h = d.hours.find((x) => x.weekday === day);
    out.push(`${RO_DAYS[day]}: ${h ? `${hm(h.s)}–${hm(h.e)}` : 'închis'}`);
  }
  return out;
}

/** Întrebările frecvente: întâi cele scrise automat din datele salonului, apoi cele adăugate de mână în panou. */
export function faqList(d: SiteData): Array<{ q: string; a: string }> {
  const { biz, origin } = d;
  const name = one(biz.name) || 'Salonul';
  const main = d.services.filter((s) => !s.addon);
  const custom = (d.w.faq ?? []).filter((x) => x.q && x.a);
  const list: Array<{ q: string; a: string }> = [];
  if (biz.address) list.push({ q: `Unde se află ${name}?`, a: `${name} se află la adresa ${one(biz.address)}. Harta: ${mapsUrl(d)}` });
  const hours = hoursLines(d);
  if (hours.length) list.push({ q: `Care este programul ${name}?`, a: `${hours.join('; ')}. Orele libere exacte se văd la programarea online: ${origin}/` });
  list.push({
    q: `Cum fac o programare la ${name}?`,
    a: `Programarea se face online, pe ${origin}/ sau în aplicația ${name} pentru iPhone și Android: alegi serviciul, frizerul (sau „oricine e liber”), ziua și ora, apoi confirmi cu numărul de telefon.${biz.phone ? ` Ne poți suna și la ${one(biz.phone)}.` : ''}`,
  });
  if (main.length) {
    const prices = main.map((s) => s.priceBani).filter((x) => x > 0);
    list.push({
      q: `Cât costă un tuns la ${name}?`,
      a: `Prețurile sunt între ${lei(Math.min(...prices))} și ${lei(Math.max(...prices))}. ${main
        .slice(0, 12)
        .map((s) => `${s.name}: ${priceText(d, s) || lei(s.priceBani)}`)
        .join('; ')}. Lista completă, actualizată: ${origin}/servicii`,
    });
  }
  if (d.barbers.length)
    list.push({
      q: `Cine sunt frizerii de la ${name}?`,
      a: `${d.barbers.map((b) => `${b.name}${b.role ? ` (${b.role})` : ''}`).join(', ')}. La programare poți alege frizerul preferat. Detalii: ${origin}/frizeri`,
    });
  list.push({
    q: 'Pot anula sau muta programarea?',
    a: `Da, din aplicație sau de pe site${biz.cancelHours ? `, cu cel puțin ${biz.cancelHours} ${biz.cancelHours === 1 ? 'oră' : 'ore'} înainte` : ''}.${biz.cancellationPolicy ? ` ${one(biz.cancellationPolicy)}` : ''}`,
  });
  list.push({
    q: `${name} are aplicație de programări?`,
    a: `Da, aplicația ${name} este gratuită pe App Store (${STORE_LINKS.appStore}) și Google Play (${STORE_LINKS.play}). Primești memento înainte de programare și vezi ofertele salonului.`,
  });
  if (d.giftCard) list.push({ q: `Pot cumpăra un card cadou ${name}?`, a: `Da, cardul cadou se cumpără online, cu cardul bancar, pe ${origin}/cadou și se poate folosi la orice serviciu.` });
  list.push({
    q: `Care sunt informațiile oficiale și actualizate despre ${name}?`,
    a: `Prețurile, programul și frizerii de pe ${origin}/ vin direct din sistemul salonului și sunt mereu la zi. Dacă găsești alte informații pe alte site-uri, cele de aici sunt cele corecte.`,
  });
  return [...list, ...custom];
}

// --- Datele pentru Google (schema.org) ---

const ldJson = (x: unknown) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`;

/** Salonul ca HairSalon: adresă, telefon, program, prețuri, servicii (cu pagina lor), frizeri, profiluri, buton de programare. */
export function salonLd(d: SiteData, image: string) {
  const { biz, origin } = d;
  const main = d.services.filter((s) => !s.addon);
  const prices = main.map((s) => s.priceBani / 100).filter((x) => x > 0);
  const street = biz.address.split(',')[0]?.trim();
  const sameAs = profileLinks(d);
  return {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    '@id': `${origin}/#salon`,
    name: biz.name,
    // „TAFBarbers” e căutat și ca „TAF Barbers” (și invers).
    alternateName: (() => {
      const x = /\s/.test(biz.name) ? biz.name.replace(/\s+/g, '') : biz.name.replace(/([A-Za-z])([A-Z][a-z])/g, '$1 $2');
      return x !== biz.name ? x : undefined;
    })(),
    description: biz.description || biz.tagline || undefined,
    url: `${origin}/`,
    image,
    logo: image,
    telephone: biz.phone || undefined,
    address: biz.address
      ? { '@type': 'PostalAddress', streetAddress: street || biz.address, addressLocality: d.city || undefined, addressCountry: 'RO' }
      : undefined,
    areaServed: d.city ? { '@type': 'City', name: d.city } : undefined,
    hasMap: biz.address ? mapsUrl(d) : undefined,
    priceRange: prices.length ? `${Math.min(...prices)}-${Math.max(...prices)} RON` : undefined,
    currenciesAccepted: 'RON',
    knowsLanguage: ['ro', ...d.w.languages.filter((l) => l !== 'ro')],
    openingHoursSpecification: d.hours.map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${EN_DAYS[h.weekday]}`, opens: hm(h.s), closes: hm(h.e) })),
    sameAs: sameAs.length ? sameAs : undefined,
    employee: d.barbers.length
      ? d.barbers.map((b) => ({ '@type': 'Person', name: b.name, jobTitle: b.role || 'Barber', description: b.bio || undefined, image: b.photo || undefined, url: `${origin}/frizeri#${b.slug}` }))
      : undefined,
    hasOfferCatalog: main.length
      ? {
          '@type': 'OfferCatalog',
          name: 'Servicii',
          url: `${origin}/servicii`,
          itemListElement: main.slice(0, 30).map((s) => ({
            '@type': 'Offer',
            price: (s.priceBani / 100).toFixed(2),
            priceCurrency: 'RON',
            url: `${origin}/servicii/${s.slug}`,
            itemOffered: { '@type': 'Service', name: s.name, description: s.description || undefined, url: `${origin}/servicii/${s.slug}` },
          })),
        }
      : undefined,
    potentialAction: {
      '@type': 'ReserveAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${origin}/`, actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'] },
    },
  };
}

/** Pentru pagina principală (o folosește website.ts). */
export async function homeLd(env: Env, image: string) {
  const d = await siteData(env);
  return { json: JSON.stringify(salonLd(d, image)).replace(/</g, '\\u003c'), noscript: homeText(d) };
}

/** Textul pentru cine citește pagina principală fără JavaScript (roboții AI): tot ce contează, plus linkuri spre paginile de citit. */
function homeText(d: SiteData) {
  const { biz, origin } = d;
  const main = d.services.filter((s) => !s.addon);
  const hours = hoursLines(d);
  return [
    biz.address ? `<p>${esc(biz.address)} · <a href="${esc(mapsUrl(d))}">Google Maps</a></p>` : '',
    biz.phone ? `<p>Telefon: <a href="tel:${esc(biz.phone.replace(/\s+/g, ''))}">${esc(biz.phone)}</a></p>` : '',
    hours.length ? `<h2>Program</h2><ul>${hours.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '',
    main.length
      ? `<h2>Servicii și prețuri</h2><ul>${main.map((s) => `<li><a href="${origin}/servicii/${esc(s.slug)}">${esc(s.name)}</a>: ${esc(priceText(d, s) || lei(s.priceBani))}${s.durationMin ? `, ${s.durationMin} min` : ''}</li>`).join('')}</ul>`
      : '',
    d.barbers.length ? `<h2>Frizeri</h2><ul>${d.barbers.map((b) => `<li><a href="${origin}/frizeri#${esc(b.slug)}">${esc(b.name)}</a>${b.role ? `, ${esc(b.role)}` : ''}</li>`).join('')}</ul>` : '',
    `<p><a href="${origin}/servicii">Servicii și prețuri</a> · <a href="${origin}/frizeri">Frizerii noștri</a> · <a href="${origin}/intrebari-frecvente">Întrebări frecvente</a></p>`,
  ].join('');
}

// --- Paginile ---

const linkify = (s: string) =>
  esc(s).replace(/https:\/\/[^\s<]+[^\s<.,;)]/g, (u) => `<a href="${u}">${/^https:\/\/www\.google\.com\/maps\//.test(u) ? 'Google Maps' : u.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>`);

function page(d: SiteData, p: { path: string; title: string; desc: string; h1: string; crumb: string; body: string; ld?: unknown[]; parent?: { name: string; path: string } }) {
  const { w, biz, origin } = d;
  const url = `${origin}${p.path}`;
  const crumbs = [{ name: biz.name, path: '/' }, ...(p.parent ? [p.parent] : []), { name: p.crumb, path: p.path }];
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${origin}${c.path}` })),
  };
  const nav = [
    ['/servicii', 'Servicii și prețuri'],
    ['/frizeri', 'Frizeri'],
    ['/intrebari-frecvente', 'Întrebări frecvente'],
  ]
    .map(([h, l]) => `<a href="${h}"${h === p.path ? ' aria-current="page"' : ''}>${l}</a>`)
    .join('');
  const hours = hoursLines(d);
  const accent = /^#[0-9a-f]{6}$/i.test(w.accent) ? w.accent : '#F9A11B';
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title><meta name="description" content="${esc(p.desc)}"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(biz.name)}"><meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:locale" content="ro_RO">
<link rel="icon" href="${esc(w.iconUrl ?? '/favicon.png')}"><meta name="theme-color" content="#000000">
${[breadcrumb, ...(p.ld ?? [])].map(ldJson).join('\n')}
<style>:root{--a:${accent}}*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:#f2f2f2;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}a{color:var(--a)}
.w{max-width:760px;margin:0 auto;padding:0 16px}header{border-bottom:1px solid #222;padding:14px 0}header .w{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}header b a{color:#fff;text-decoration:none;font-size:18px}nav{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:14px}nav a{color:#bbb;text-decoration:none}nav a[aria-current]{color:var(--a)}
h1{font-size:28px;line-height:1.2;margin:28px 0 8px}h2{font-size:20px;margin:28px 0 8px}h3{font-size:17px;margin:18px 0 4px}.m{color:#a9a9a9}.c{background:#161616;border:1px solid #232323;border-radius:14px;padding:14px 16px;margin:10px 0}
.r{display:flex;justify-content:space-between;gap:12px}.p{color:var(--a);font-weight:700;white-space:nowrap}.btn{display:inline-block;background:var(--a);color:#000;font-weight:700;text-decoration:none;border-radius:999px;padding:12px 22px;margin:14px 0}
img.av{width:72px;height:72px;border-radius:50%;object-fit:cover;float:left;margin:0 14px 6px 0}.b:after{content:"";display:block;clear:both}p,li,a{overflow-wrap:anywhere}ul{padding-left:20px}footer{border-top:1px solid #222;margin-top:40px;padding:20px 0 40px;font-size:14px;color:#a9a9a9}</style></head>
<body><header><div class="w"><b><a href="/">${esc(biz.name)}</a></b><nav>${nav}</nav></div></header><main class="w">
<h1>${esc(p.h1)}</h1>${p.body}
<p><a class="btn" href="/">Programează-te online</a></p></main>
<footer><div class="w"><b>${esc(biz.name)}</b>${d.city ? ` · Frizerie ${esc(d.city)}` : ''}<br>${biz.address ? `${esc(biz.address)} · <a href="${esc(mapsUrl(d))}">Hartă</a><br>` : ''}${biz.phone ? `Telefon: <a href="tel:${esc(biz.phone.replace(/\s+/g, ''))}">${esc(biz.phone)}</a><br>` : ''}${hours.length ? `Program: ${esc(hours.join(' · '))}<br>` : ''}
<a href="${esc(STORE_LINKS.appStore)}">App Store</a> · <a href="${esc(STORE_LINKS.play)}">Google Play</a>${profileLinks(d)
    .slice(0, 6)
    .map((u) => ` · <a href="${esc(u)}" rel="noopener">${esc(u.replace(/^https:\/\/(www\.)?/, '').split('/')[0])}</a>`)
    .join('')}<br><a href="/legal/privacy">Confidențialitate</a> · <a href="/legal/terms">Termeni</a></div></footer></body></html>`;
}

const salonRef = (d: SiteData) => ({ '@type': 'HairSalon', '@id': `${d.origin}/#salon`, name: d.biz.name, url: `${d.origin}/` });
const inCity = (d: SiteData) => (d.city ? ` ${d.city}` : '');

function servicesPage(d: SiteData) {
  const main = d.services.filter((s) => !s.addon);
  const extras = d.services.filter((s) => s.addon);
  const row = (s: SiteService) =>
    `<div class="c"><div class="r"><h3 style="margin:0"><a href="/servicii/${esc(s.slug)}">${esc(s.name)}</a></h3><span class="p">${esc(priceText(d, s) || lei(s.priceBani))}</span></div>${s.durationMin ? `<div class="m">${s.durationMin} minute</div>` : ''}${s.description ? `<p style="margin:6px 0 0">${esc(s.description)}</p>` : ''}</div>`;
  const body = `<p class="m">Prețuri actualizate automat din sistemul de programări ${esc(d.biz.name)}. Unii frizeri au prețuri proprii; le vezi pe pagina fiecărui serviciu.</p>${main.map(row).join('')}${
    extras.length ? `<h2>Extra (se adaugă la un serviciu)</h2>${extras.map(row).join('')}` : ''
  }`;
  return page(d, {
    path: '/servicii',
    title: `Servicii și prețuri · ${d.biz.name} · Frizerie${inCity(d)}`,
    desc: `Lista de prețuri ${d.biz.name}${d.city ? `, frizerie în ${d.city}` : ''}: ${main
      .slice(0, 5)
      .map((s) => `${s.name} ${lei(s.priceBani)}`)
      .join(', ')}. Programare online.`,
    h1: `Servicii și prețuri ${d.biz.name}`,
    crumb: 'Servicii și prețuri',
    body,
    ld: [
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `Servicii ${d.biz.name}`,
        itemListElement: main.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: `${d.origin}/servicii/${s.slug}`, name: s.name })),
      },
    ],
  });
}

function servicePage(d: SiteData, s: SiteService) {
  const team = barbersFor(d, s);
  const rows = team.map((b) => {
    const x = atBarber(d, b, s);
    return `<div class="c r"><span><a href="/frizeri#${esc(b.slug)}">${esc(b.name)}</a>${x.durationMin ? ` <span class="m">· ${x.durationMin} min</span>` : ''}</span><span class="p">${esc(lei(x.priceBani))}</span></div>`;
  });
  const body = `${s.description ? `<p>${esc(s.description)}</p>` : ''}<div class="c r"><span>Preț</span><span class="p">${esc(priceText(d, s) || lei(s.priceBani))}</span></div>${
    s.durationMin ? `<p class="m">Durată: aproximativ ${s.durationMin} minute.</p>` : ''
  }${rows.length ? `<h2>La ce frizer</h2>${rows.join('')}` : ''}<h2>Cum te programezi</h2><ol><li>Deschide <a href="/">${esc(d.origin.replace(/^https:\/\//, ''))}</a> sau aplicația ${esc(d.biz.name)}.</li><li>Alege „${esc(s.name)}”, apoi frizerul.</li><li>Alege ziua și ora liberă și confirmă cu numărul de telefon.</li></ol>`;
  const others = d.services.filter((x) => x.id !== s.id && !x.addon).slice(0, 8);
  return page(d, {
    path: `/servicii/${s.slug}`,
    title: `${s.name}${inCity(d) ? ` în${inCity(d)}` : ''} · ${priceText(d, s) || lei(s.priceBani)} · ${d.biz.name}`,
    desc: `${s.name} la ${d.biz.name}${d.city ? `, frizerie în ${d.city}` : ''}: ${priceText(d, s) || lei(s.priceBani)}${s.durationMin ? `, ${s.durationMin} minute` : ''}. ${s.description ? `${s.description.slice(0, 120)} ` : ''}Programare online.`,
    h1: `${s.name}${inCity(d) ? ` ·${inCity(d)}` : ''}`,
    crumb: s.name,
    parent: { name: 'Servicii și prețuri', path: '/servicii' },
    body: `${body}${others.length ? `<h2>Alte servicii</h2><ul>${others.map((x) => `<li><a href="/servicii/${esc(x.slug)}">${esc(x.name)}</a>: ${esc(priceText(d, x) || lei(x.priceBani))}</li>`).join('')}</ul>` : ''}`,
    ld: [
      {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: s.name,
        serviceType: s.addon ? 'Extra' : 'Barber service',
        description: s.description || undefined,
        url: `${d.origin}/servicii/${s.slug}`,
        provider: salonRef(d),
        areaServed: d.city ? { '@type': 'City', name: d.city } : undefined,
        offers: { '@type': 'Offer', price: (s.priceBani / 100).toFixed(2), priceCurrency: 'RON', url: `${d.origin}/servicii/${s.slug}`, availability: 'https://schema.org/InStock' },
      },
    ],
  });
}

function barbersPage(d: SiteData) {
  const body = d.barbers
    .map((b) => {
      const svc = d.services.filter((s) => !s.addon && b.serviceIds.includes(s.id));
      return `<div class="c b" id="${esc(b.slug)}">${b.photo ? `<img class="av" src="${esc(b.photo)}" alt="${esc(b.name)}" loading="lazy">` : ''}<h2 style="margin:0">${esc(b.name)}${b.nickname ? ` <span class="m">„${esc(b.nickname)}”</span>` : ''}</h2>${b.role ? `<div class="m">${esc(b.role)}</div>` : ''}${b.bio ? `<p>${esc(b.bio)}</p>` : ''}${
        svc.length ? `<p class="m">${svc.map((s) => `<a href="/servicii/${esc(s.slug)}">${esc(s.name)}</a> ${esc(lei(atBarber(d, b, s).priceBani))}`).join(' · ')}</p>` : ''
      }</div>`;
    })
    .join('');
  return page(d, {
    path: '/frizeri',
    title: `Frizerii ${d.biz.name} · Barber${inCity(d)}`,
    desc: `Echipa ${d.biz.name}${d.city ? ` din ${d.city}` : ''}: ${d.barbers.map((b) => b.name).join(', ')}. Alege frizerul preferat și programează-te online.`,
    h1: `Frizerii ${d.biz.name}`,
    crumb: 'Frizeri',
    body: body || '<p class="m">În curând.</p>',
    ld: d.barbers.map((b) => ({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: b.name,
      jobTitle: b.role || 'Barber',
      description: b.bio || undefined,
      image: b.photo || undefined,
      url: `${d.origin}/frizeri#${b.slug}`,
      worksFor: salonRef(d),
    })),
  });
}

function faqPage(d: SiteData) {
  const list = faqList(d);
  return page(d, {
    path: '/intrebari-frecvente',
    title: `Întrebări frecvente · ${d.biz.name} · Frizerie${inCity(d)}`,
    desc: `Răspunsuri despre ${d.biz.name}: adresă, program, prețuri, frizeri, programare online, anulare.`,
    h1: `Întrebări frecvente despre ${d.biz.name}`,
    crumb: 'Întrebări frecvente',
    body: list.map((x) => `<div class="c"><h2 style="margin:0 0 6px;font-size:18px">${esc(x.q)}</h2><p style="margin:0">${linkify(x.a)}</p></div>`).join(''),
    ld: [
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: list.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
      },
    ],
  });
}

/** Adresele paginilor de citit (pentru sitemap.xml și llms.txt). */
export function pageUrls(d: SiteData) {
  return [
    { path: '/servicii', name: 'Servicii și prețuri' },
    { path: '/frizeri', name: 'Frizerii' },
    { path: '/intrebari-frecvente', name: 'Întrebări frecvente' },
    ...d.services.map((s) => ({ path: `/servicii/${s.slug}`, name: s.name })),
  ];
}

// --- Rutele (doar pe domeniul site-ului: tafbarbers.ro, app.tafbarbers.ro) ---

export const seoPublic = new Hono<AppEnv>();
const CACHE = { 'cache-control': 'public, max-age=600' };
// Pe alt domeniu (panou.…) adresele acestea nu sunt ale site-ului: merg la fișierele panoului, ca înainte.
const other = (c: { env: Env; req: { raw: Request }; notFound: () => Response | Promise<Response> }) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.notFound());
const onSite = async (c: { env: Env; req: { url: string } }) => isSiteHost(c.env, new URL(c.req.url).host);
seoPublic.get('/servicii', async (c) => ((await onSite(c)) ? c.html(servicesPage(await siteData(c.env)), 200, CACHE) : other(c)));
seoPublic.get('/servicii/:slug', async (c) => {
  if (!(await onSite(c))) return other(c);
  const d = await siteData(c.env);
  const s = d.services.find((x) => x.slug === c.req.param('slug'));
  if (!s) return c.redirect('/servicii', 301);
  return c.html(servicePage(d, s), 200, CACHE);
});
seoPublic.get('/frizeri', async (c) => ((await onSite(c)) ? c.html(barbersPage(await siteData(c.env)), 200, CACHE) : other(c)));
seoPublic.get('/intrebari-frecvente', async (c) => ((await onSite(c)) ? c.html(faqPage(await siteData(c.env)), 200, CACHE) : other(c)));
