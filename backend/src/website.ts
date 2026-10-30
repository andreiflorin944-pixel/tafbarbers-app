import { Hono } from 'hono';
import { getAppearance, isImageUrl } from './appearance';
import { getBusiness, getSetting, setSetting, type Business } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { getAutomations } from './growth';
import { STORE_LINKS } from './stores';

// Site-ul web cu programare online (Panou → Aplicații → Site web): o pagină pentru telefon, ca aplicația, la app.tafbarbers.ro
// (și la domeniul propriu, dacă e legat). Aspectul se alege din panou; programarea folosește aceleași rute ca aplicația
// (servicii, frizeri, ore libere, cont cu cod, programare), deci regulile salonului sunt aceleași.

export const LANGS = ['ro', 'en', 'fr'] as const;
type Lang = (typeof LANGS)[number];
type Texts = Record<Lang, string>;

export type Website = {
  background: string; // culoarea fundalului
  backgroundImage: string | null;
  backgroundDim: number; // 0–90 (%)
  logoUrl: string | null; // null = logo-ul din aplicație
  iconUrl: string | null; // iconița din tab-ul browserului și de pe ecranul telefonului
  showIcons: boolean; // iconițe pe butoanele din meniu
  accent: string; // butoane și bara de sus
  buttonText: string | null; // null = automat (negru / alb)
  text: string;
  languages: Lang[];
  defaultLang: Lang;
  welcome: Texts; // textul din bara de sus; gol = „Bine ați venit”
  layout: 'buttons' | 'tiles'; // butoane pe rând (ca în aplicație) sau pătrate câte două
  sections: { booking: boolean; barbers: boolean; services: boolean; contact: boolean; links: boolean; apps: boolean };
  customDomain: string; // ex. programari.tafbarbers.ro (îl leagă cine publică serverul)
  // Codurile pentru statistici și reclame (din conturile Google, Meta, TikTok); pornesc doar după acordul vizitatorului.
  tracking: { gaId: string; metaPixelId: string; googleAdsId: string; googleAdsLabel: string; tiktokPixelId: string };
  // Cum apare site-ul în Google și când e trimis pe WhatsApp / Facebook; gol = text automat din datele salonului.
  seo: { title: Texts; description: Texts; shareImage: string | null; googleVerification: string; metaVerification: string };
  links: Array<{ label: string; url: string }>;
};

export const DEFAULT_WEBSITE: Website = {
  background: '#000000',
  backgroundImage: null,
  backgroundDim: 55,
  logoUrl: null,
  iconUrl: null,
  showIcons: true,
  accent: '#F9A11B',
  buttonText: null,
  text: '#FFFFFF',
  languages: ['ro', 'en', 'fr'],
  defaultLang: 'ro',
  welcome: { ro: '', en: '', fr: '' },
  layout: 'buttons',
  sections: { booking: true, barbers: true, services: true, contact: true, links: true, apps: true },
  customDomain: '',
  tracking: { gaId: '', metaPixelId: '', googleAdsId: '', googleAdsLabel: '', tiktokPixelId: '' },
  seo: { title: { ro: '', en: '', fr: '' }, description: { ro: '', en: '', fr: '' }, shareImage: null, googleVerification: '', metaVerification: '' },
  links: [],
};

// Ce nu s-a ales separat pentru site (culori, fundal) vine din aspectul aplicației, ca site-ul să arate ca aplicația.
export async function getWebsite(env: Env): Promise<Website> {
  const [saved, look] = await Promise.all([getSetting<Partial<Website>>(env, 'website', {}), getAppearance(env)]);
  const fromApp = { background: look.background, backgroundImage: look.backgroundImage, backgroundDim: look.backgroundDim, accent: look.accent, buttonText: look.buttonText, text: look.text };
  return {
    ...DEFAULT_WEBSITE,
    ...fromApp,
    ...saved,
    sections: { ...DEFAULT_WEBSITE.sections, ...saved.sections },
    tracking: { ...DEFAULT_WEBSITE.tracking, ...saved.tracking },
    seo: {
      ...DEFAULT_WEBSITE.seo,
      ...saved.seo,
      title: { ...DEFAULT_WEBSITE.seo.title, ...saved.seo?.title },
      description: { ...DEFAULT_WEBSITE.seo.description, ...saved.seo?.description },
    },
    welcome: { ...DEFAULT_WEBSITE.welcome, ...saved.welcome },
  };
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const color = (v: unknown) => {
  if (typeof v !== 'string' || !COLOR.test(v)) throw new HttpError(400, 'invalid_color');
  return v.toUpperCase();
};
const image = (v: unknown) => {
  if (v !== null && !isImageUrl(v)) throw new HttpError(400, 'invalid_url');
  return v as string | null;
};

export async function saveWebsite(env: Env, b: Partial<Website>): Promise<Website> {
  const n = await getWebsite(env);
  for (const k of ['background', 'accent', 'text'] as const) if (b[k] !== undefined) n[k] = color(b[k]);
  if (b.buttonText !== undefined) n.buttonText = b.buttonText === null ? null : color(b.buttonText);
  for (const k of ['backgroundImage', 'logoUrl', 'iconUrl'] as const) if (b[k] !== undefined) n[k] = image(b[k]);
  if (b.backgroundDim !== undefined) n.backgroundDim = Math.max(0, Math.min(90, Math.round(Number(b.backgroundDim) || 0)));
  if (b.showIcons !== undefined) n.showIcons = !!b.showIcons;
  if (b.layout !== undefined) n.layout = b.layout === 'tiles' ? 'tiles' : 'buttons';
  if (Array.isArray(b.languages)) {
    const l = LANGS.filter((x) => b.languages!.includes(x));
    if (!l.length) throw new HttpError(400, 'no_language');
    n.languages = l;
  }
  if (b.defaultLang !== undefined) n.defaultLang = LANGS.includes(b.defaultLang) ? b.defaultLang : 'ro';
  if (!n.languages.includes(n.defaultLang)) n.defaultLang = n.languages[0];
  if (b.welcome && typeof b.welcome === 'object') for (const l of LANGS) if (typeof b.welcome[l] === 'string') n.welcome[l] = b.welcome[l].trim().slice(0, 40);
  if (b.sections && typeof b.sections === 'object') for (const k of Object.keys(n.sections) as Array<keyof Website['sections']>) if (b.sections[k] !== undefined) n.sections[k] = !!b.sections[k];
  if (b.customDomain !== undefined) {
    const d = String(b.customDomain ?? '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (d && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) throw new HttpError(400, 'invalid_domain');
    n.customDomain = d;
  }
  if (b.tracking && typeof b.tracking === 'object') {
    const tr = { ...n.tracking, ...b.tracking };
    const v = (k: keyof Website['tracking'], re: RegExp, err: string, up = true) => {
      const x = String(tr[k] ?? '').trim().replace(/\s+/g, '');
      const y = up ? x.toUpperCase() : x;
      if (y && !re.test(y)) throw new HttpError(400, err);
      return y;
    };
    n.tracking = {
      gaId: v('gaId', /^G-[A-Z0-9]{4,15}$/, 'invalid_ga_id'),
      metaPixelId: v('metaPixelId', /^\d{6,20}$/, 'invalid_pixel_id'),
      googleAdsId: v('googleAdsId', /^AW-\d{6,15}$/, 'invalid_ads_id'),
      googleAdsLabel: v('googleAdsLabel', /^[A-Za-z0-9_-]{4,40}$/, 'invalid_ads_label', false),
      tiktokPixelId: v('tiktokPixelId', /^[A-Z0-9]{10,30}$/, 'invalid_tiktok_id'),
    };
  }
  if (b.seo && typeof b.seo === 'object') {
    const s = b.seo;
    for (const l of LANGS) {
      if (typeof s.title?.[l] === 'string') n.seo.title[l] = s.title[l].replace(/\s+/g, ' ').trim().slice(0, 70);
      if (typeof s.description?.[l] === 'string') n.seo.description[l] = s.description[l].replace(/\s+/g, ' ').trim().slice(0, 300);
    }
    if (s.shareImage !== undefined) n.seo.shareImage = image(s.shareImage);
    // Se poate lipi tot rândul <meta …> din Google Search Console / Meta Business; păstrăm doar codul.
    const code = (x: unknown, err: string) => {
      const raw = String(x ?? '').trim();
      const c = (raw.match(/content=["']([^"']+)["']/i)?.[1] ?? raw).trim();
      if (c && !/^[A-Za-z0-9_-]{10,100}$/.test(c)) throw new HttpError(400, err);
      return c;
    };
    if (s.googleVerification !== undefined) n.seo.googleVerification = code(s.googleVerification, 'invalid_verification');
    if (s.metaVerification !== undefined) n.seo.metaVerification = code(s.metaVerification, 'invalid_verification');
  }
  if (Array.isArray(b.links)) {
    n.links = b.links.slice(0, 12).map((x) => {
      const label = String(x?.label ?? '').trim().slice(0, 40);
      let url = String(x?.url ?? '').trim();
      if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(url) && !/^(https?:|mailto:|tel:)/i.test(url)) throw new HttpError(400, 'invalid_link');
      if (url && !/^(https?:|mailto:|tel:)/i.test(url)) url = `https://${url}`;
      if (!label || !/^(https?:\/\/\S+|mailto:\S+|tel:[+\d\s]+)$/i.test(url) || url.length > 300) throw new HttpError(400, 'invalid_link');
      return { label, url };
    });
  }
  await setSetting(env, 'website', n);
  return n;
}

/** Adresele la care rădăcina („/”) arată site-ul, nu panoul: app.tafbarbers.ro și domeniul propriu. */
export async function isSiteHost(env: Env, host: string) {
  const h = host.toLowerCase().split(':')[0];
  if (h.startsWith('app.')) return true;
  const w = await getWebsite(env);
  return !!w.customDomain && (h === w.customDomain || h === `www.${w.customDomain}`);
}

// --- Pagina publică ---

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const SEO_TEXT: Record<Lang, { title: (n: string) => string; desc: (n: string, where: string) => string; locale: string }> = {
  ro: {
    title: (n) => `${n} · Frizerie, programare online`,
    desc: (n, where) => `${n}${where ? `, ${where}` : ''}: tuns, barbă și styling. Programează-te online în câteva secunde: alegi serviciul, frizerul și ora.`,
    locale: 'ro_RO',
  },
  en: {
    title: (n) => `${n} · Barbershop, book online`,
    desc: (n, where) => `${n}${where ? `, ${where}` : ''}: haircuts, beard and styling. Book online in seconds: choose the service, the barber and the time.`,
    locale: 'en_GB',
  },
  fr: {
    title: (n) => `${n} · Barbier, réservation en ligne`,
    desc: (n, where) => `${n}${where ? `, ${where}` : ''} : coupe, barbe et coiffage. Réservez en ligne en quelques secondes : service, barbier et heure.`,
    locale: 'fr_FR',
  },
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Limba paginii cerută prin `?lang=` (pentru Google: câte o adresă pe limbă), dacă e pornită pe site. */
export function siteLang(w: Website, q: string | undefined): Lang {
  return w.languages.includes(q as Lang) ? (q as Lang) : w.defaultLang;
}

/** Adresa principală a site-ului (pentru Google): domeniul propriu, dacă e legat, altfel app.tafbarbers.ro. */
export const siteOrigin = (env: Env, w: Website) => (w.customDomain ? `https://${w.customDomain}` : (env.PUBLIC_URL ?? 'https://app.tafbarbers.ro').replace(/\/$/, ''));

const langUrl = (origin: string, w: Website, l: Lang) => `${origin}/${l === w.defaultLang ? '' : `?lang=${l}`}`;

/** Datele salonului pentru Google (schema.org HairSalon): adresă, telefon, program, prețuri, servicii, buton de programare. */
async function structuredData(env: Env, w: Website, biz: Business, origin: string, image: string) {
  const [svc, hours] = await Promise.all([
    env.DB.prepare('SELECT name, description, duration_min, price_bani FROM services WHERE active = 1 AND members_only = 0 ORDER BY sort, name LIMIT 30').all<{
      name: string;
      description: string;
      duration_min: number;
      price_bani: number;
    }>(),
    env.DB.prepare(
      `SELECT h.weekday, MIN(h.start_min) AS s, MAX(h.end_min) AS e FROM working_hours h JOIN barbers b ON b.id = h.barber_id WHERE b.active = 1 GROUP BY h.weekday`,
    ).all<{ weekday: number; s: number; e: number }>(),
  ]);
  const prices = svc.results.map((x) => x.price_bani / 100).filter((x) => x > 0);
  const social = [
    biz.instagram && (/^https?:/.test(biz.instagram) ? biz.instagram : `https://www.instagram.com/${biz.instagram.replace(/^@/, '')}`),
    biz.facebook && (/^https?:/.test(biz.facebook) ? biz.facebook : `https://www.facebook.com/${biz.facebook}`),
    biz.tiktok && (/^https?:/.test(biz.tiktok) ? biz.tiktok : `https://www.tiktok.com/@${biz.tiktok.replace(/^@/, '')}`),
    ...w.links.map((l) => l.url).filter((u) => /^https:\/\/(www\.)?(instagram|facebook|tiktok|youtube)\.com\//.test(u)),
  ].filter((x): x is string => !!x);
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    '@id': `${origin}/#salon`,
    name: biz.name,
    description: biz.description || biz.tagline || undefined,
    url: `${origin}/`,
    image,
    logo: image,
    telephone: biz.phone || undefined,
    address: biz.address ? { '@type': 'PostalAddress', streetAddress: biz.address, addressCountry: 'RO' } : undefined,
    priceRange: prices.length ? `${Math.min(...prices)}-${Math.max(...prices)} RON` : undefined,
    currenciesAccepted: 'RON',
    openingHoursSpecification: hours.results
      .sort((x, y) => ((x.weekday + 6) % 7) - ((y.weekday + 6) % 7))
      .map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${DAY_NAMES[h.weekday]}`, opens: hm(h.s), closes: hm(h.e) })),
    sameAs: social.length ? [...new Set(social)] : undefined,
    hasOfferCatalog: svc.results.length
      ? {
          '@type': 'OfferCatalog',
          name: 'Servicii',
          itemListElement: svc.results.map((x) => ({
            '@type': 'Offer',
            price: (x.price_bani / 100).toFixed(2),
            priceCurrency: 'RON',
            itemOffered: { '@type': 'Service', name: x.name, description: x.description || undefined },
          })),
        }
      : undefined,
    potentialAction: { '@type': 'ReserveAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/`, actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'] } },
  };
  return JSON.stringify(ld).replace(/</g, '\\u003c');
}

export async function sitePage(env: Env, opts: { preview?: boolean; lang?: string } = {}) {
  const [w, biz, look, auto] = await Promise.all([getWebsite(env), getBusiness(env), getAppearance(env), getAutomations(env)]);
  const icon = w.iconUrl ?? '/favicon.png';
  const origin = siteOrigin(env, w);
  const lang = siteLang(w, opts.lang);
  const abs = (u: string) => (/^https:/.test(u) ? u : `${origin}${u}`);
  const image = abs(w.seo.shareImage ?? w.logoUrl ?? look.logoUrl ?? '/app-icon.png');
  const where = biz.address.split(',').slice(-1)[0]?.trim() ?? '';
  const title = w.seo.title[lang] || SEO_TEXT[lang].title(biz.name);
  const desc = w.seo.description[lang] || SEO_TEXT[lang].desc(biz.name, where);
  const url = langUrl(origin, w, lang);
  const cfg = {
    w,
    biz: { name: biz.name, tagline: biz.tagline, address: biz.address, phone: biz.phone, instagram: biz.instagram, description: biz.description ?? '' },
    appLogo: look.logoUrl,
    look: { title: look.title, welcome: look.welcome, muted: look.muted, card: look.card, background: look.background },
    otpSms: auto.otpSms,
    stores: STORE_LINKS,
    preview: !!opts.preview,
  };
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  const meta = (k: string, v: string, attr = 'property') => `<meta ${attr}="${k}" content="${esc(v)}">`;
  const head = opts.preview
    ? '<meta name="robots" content="noindex">'
    : [
        `<link rel="canonical" href="${esc(url)}">`,
        ...(w.languages.length > 1
          ? [...w.languages.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(langUrl(origin, w, l))}">`), `<link rel="alternate" hreflang="x-default" href="${esc(`${origin}/`)}">`]
          : []),
        meta('og:type', 'website'),
        meta('og:site_name', biz.name),
        meta('og:title', title),
        meta('og:description', desc),
        meta('og:url', url),
        meta('og:image', image),
        meta('og:locale', SEO_TEXT[lang].locale),
        ...w.languages.filter((l) => l !== lang).map((l) => meta('og:locale:alternate', SEO_TEXT[l].locale)),
        meta('twitter:card', w.seo.shareImage ? 'summary_large_image' : 'summary', 'name'),
        meta('twitter:title', title, 'name'),
        meta('twitter:description', desc, 'name'),
        meta('twitter:image', image, 'name'),
        w.seo.googleVerification && meta('google-site-verification', w.seo.googleVerification, 'name'),
        w.seo.metaVerification && meta('facebook-domain-verification', w.seo.metaVerification, 'name'),
        `<script type="application/ld+json">${await structuredData(env, w, biz, origin, image)}</script>`,
      ]
        .filter(Boolean)
        .join('\n');
  // Pentru cine n-are JavaScript (și pentru motoarele de căutare care nu-l rulează): numele, descrierea și datele de contact.
  const noscript = `<noscript><main style="max-width:720px;margin:0 auto;padding:24px 16px"><h1>${esc(biz.name)}</h1><p>${esc(desc)}</p>${biz.address ? `<p>${esc(biz.address)}</p>` : ''}${biz.phone ? `<p><a href="tel:${esc(biz.phone.replace(/\s+/g, ''))}">${esc(biz.phone)}</a></p>` : ''}</main></noscript>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="icon" href="${esc(icon)}"><link rel="apple-touch-icon" href="${esc(icon)}"><meta name="theme-color" content="${esc(w.accent)}">
${head}
<style>${SITE_CSS}</style></head><body><div id="bg"></div><div id="app"></div>${noscript}
<script>window.SITE=${json};</script><script>${SITE_JS}</script></body></html>`;
}

/** robots.txt: pe site (app.… / domeniul propriu) Google poate citi pagina; panoul și API-ul nu se indexează. */
export async function robotsTxt(env: Env, site: boolean) {
  if (!site) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\nDisallow: /v1/admin/\nDisallow: /b/\nDisallow: /plata/\nDisallow: /r/\nDisallow: /q/\nDisallow: /w/\nDisallow: /sterge-cont\nDisallow: /site\n\nSitemap: ${siteOrigin(env, await getWebsite(env))}/sitemap.xml\n`;
}

/** sitemap.xml: pagina principală în fiecare limbă și regulamentele. */
export async function sitemapXml(env: Env) {
  const w = await getWebsite(env);
  const origin = siteOrigin(env, w);
  const alt = w.languages.length > 1 ? w.languages.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(langUrl(origin, w, l))}"/>`).join('') : '';
  const pages = w.languages.map((l) => `<url><loc>${esc(langUrl(origin, w, l))}</loc>${alt}<changefreq>weekly</changefreq><priority>${l === w.defaultLang ? '1.0' : '0.8'}</priority></url>`);
  for (const d of ['privacy', 'terms']) pages.push(`<url><loc>${esc(`${origin}/legal/${d}`)}</loc><changefreq>monthly</changefreq><priority>0.2</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${pages.join('\n')}\n</urlset>\n`;
}

const SITE_CSS = `
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
button{font:inherit;color:inherit}a{color:inherit}
#bg{position:fixed;inset:0;background:var(--bg) var(--bgimg) center/cover no-repeat;z-index:-1}
#bg:after{content:"";position:absolute;inset:0;background:var(--bg);opacity:var(--dim)}
.wrap{max-width:720px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;min-height:60px;padding:8px 16px;background:var(--bg);background:color-mix(in srgb,var(--bg) 82%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
header .ttl{flex:1;font-size:17px;font-weight:700;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header .brand{flex:1;font-size:22px;font-weight:800;letter-spacing:.5px;white-space:nowrap}
header .brand em{font-family:Georgia,"Times New Roman",serif;font-style:italic;font-weight:700;color:var(--accent)}
header .hlogo{height:36px;max-width:150px;object-fit:contain;display:block}
header .hl{flex:1;display:flex}
.ib{width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:none;border:0;cursor:pointer;border-radius:12px;flex:none}
.ib svg{width:26px;height:26px}
.langw{position:relative;display:flex;align-items:center;gap:5px;height:36px;padding:0 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);font-weight:700;font-size:14px;flex:none}
.langw svg{width:17px;height:17px;color:var(--accent)}
.langw select{appearance:none;-webkit-appearance:none;background:transparent;color:var(--text);border:0;font:inherit;font-weight:700;cursor:pointer;padding:0;outline:none}
.langw select option{color:#000}
main{flex:1;padding:6px 16px 40px;display:flex;flex-direction:column;gap:12px}
.hello{font-size:32px;font-weight:800;letter-spacing:-.5px;line-height:1.15;margin:10px 0 0}
.hello-sub{font-size:18px;opacity:.85;margin:2px 0 6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px}
.kicker{color:var(--muted);font-size:12px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase}
.sec{color:var(--accent);font-size:13px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin:18px 0 0}
.free-time{font-size:60px;line-height:68px;font-weight:800;letter-spacing:-1.5px;margin-top:2px}
.free-date{font-size:20px;font-weight:700}.free-meta{font-size:16px;opacity:.8;margin-top:2px}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:52px;background:var(--accent);color:var(--on);border:1px solid var(--accent);border-radius:999px;padding:12px 24px;font-weight:700;font-size:16px;cursor:pointer;text-align:center;text-decoration:none;transition:opacity .15s,transform .15s}
.btn svg{width:20px;height:20px;flex:none}.btn:hover{opacity:.9}.btn:active{transform:scale(.99)}
.btn.sq{border-radius:12px;font-weight:800;font-size:17px;margin-top:16px}
.btn.ghost{background:transparent;color:var(--text);border-color:var(--line)}.btn:disabled{opacity:.45}
.link-u{display:block;margin:10px auto 0;background:none;border:0;color:var(--muted);font-size:14px;text-decoration:underline;cursor:pointer;padding:4px}
.about{font-size:15px;line-height:1.55;opacity:.85}
.promos{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;margin:0 -16px;padding:0 16px}.promos::-webkit-scrollbar{display:none}
.promo{flex:none;width:100%;scroll-snap-align:center;display:flex;padding:0;overflow:hidden;text-align:left;cursor:pointer;min-height:156px}
.promo .pimg{width:40%;flex:none;background:var(--card2) center/cover no-repeat;display:flex;align-items:center;justify-content:center}
.promo .badge{width:76px;height:76px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--bg);border:1.5px solid var(--accent);color:var(--accent)}
.promo .badge svg{width:34px;height:34px}
.promo .pbody{flex:1;padding:16px;display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:0}
.promo .kicker{font-size:11px;letter-spacing:.8px}
.ptitle{font-size:16px;font-weight:700}.small{color:var(--muted);font-size:13px;line-height:18px}
.alink{display:flex;align-items:center;gap:6px;color:var(--accent);font-weight:600;font-size:16px;margin-top:8px}.alink svg{width:18px;height:18px;flex:none}
.dots{display:flex;justify-content:center;gap:6px;margin-top:2px}.dots i{width:6px;height:6px;border-radius:3px;background:var(--line);transition:all .2s}.dots i.on{width:16px;background:var(--accent)}
.svc{display:flex;align-items:center;gap:16px;width:100%;text-align:left;cursor:pointer;padding:16px;border-radius:14px}
.svc:disabled{cursor:default}
.thumb{width:52px;height:52px;border-radius:8px;flex:none;object-fit:cover;background:var(--card2);display:flex;align-items:center;justify-content:center;color:var(--accent);border-left:4px solid var(--sc,var(--accent))}
img.thumb{border-left:0}.thumb svg{width:24px;height:24px}
.grow{flex:1;min-width:0}.ctitle{font-size:16px;font-weight:600;margin-bottom:2px}
.muted{color:var(--muted);font-size:14px}
.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pr{text-align:right;white-space:nowrap}.price{color:var(--accent);font-size:16px;font-weight:700;white-space:nowrap}.old{text-decoration:line-through;opacity:.55;font-weight:400;margin-right:6px;font-size:14px}
.club{display:inline-block;background:var(--accent);color:var(--on);font-size:11px;font-weight:800;padding:1px 6px;border-radius:6px;margin:2px 0}
.pick:hover:not(:disabled),.pick.on{border-color:var(--accent);background:var(--card2)}
.team{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.bcard{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;cursor:pointer;padding:20px 12px}
.av{width:56px;height:56px;border-radius:50%;object-fit:cover;flex:none;background:var(--card2);border:1px solid var(--accent2);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:22px}
.av svg{width:26px;height:26px}
.bcard .av{width:84px;height:84px;font-size:32px}
.brow{display:flex;align-items:center;gap:16px;width:100%;text-align:left;cursor:pointer;padding:16px;border-radius:14px}
.perks{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.perk{display:flex;align-items:center;gap:8px;height:56px;width:100%;text-align:left;padding:0 12px;border-radius:14px;cursor:pointer;text-decoration:none;font-size:15px;font-weight:600}
svg.chev{width:20px;height:20px;color:var(--muted);flex:none}
.perk>svg:first-child{width:22px;height:22px;color:var(--accent);flex:none}.perk span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.perk .chev{width:16px;height:16px;color:var(--muted);flex:none}
.addr{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:16px;text-decoration:none}.addr svg{width:20px;height:20px;flex:none}
.pills{display:flex;flex-wrap:wrap;gap:8px}
.pill{display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 12px;border-radius:12px;background:var(--card2);border:1px solid var(--line);font-weight:700;font-size:14px;text-decoration:none}.pill svg{width:16px;height:16px}
.hours .r{display:flex;justify-content:space-between;padding:4px 0;font-size:15px}.hours .r span{color:var(--muted)}.hours .r.today span,.hours .r.today b{color:var(--accent)}
.stores{display:flex;gap:10px;flex-wrap:wrap}
.store{flex:1;min-width:150px;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;background:#000;border:1px solid #3a3a3a;color:#fff;text-decoration:none}
.store svg{width:26px;height:26px;flex:none}.store small{display:block;font-size:11px;opacity:.75;line-height:1.1}.store b{font-size:17px;line-height:1.2}
.steps{display:flex;gap:8px;margin:2px 0 6px}.steps div{flex:1;min-width:0}.steps i{display:block;height:4px;border-radius:2px;background:var(--line)}.steps i.on{background:var(--accent)}.steps span{display:block;font-size:11px;color:var(--muted);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.steps span.cur{color:var(--text)}
h2{font-size:28px;font-weight:700;margin:4px 0 0;line-height:1.2}
.days{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none;margin:0 -16px;padding:0 16px 4px}.days::-webkit-scrollbar{display:none}
.day{flex:none;width:62px;border-radius:14px;background:var(--card);border:1px solid var(--line);padding:9px 0;text-align:center;cursor:pointer}
.day b{display:block;font-size:20px}.day small{font-size:12px;color:var(--muted)}.day.on{border-color:var(--accent);background:var(--accent);color:var(--on)}.day.on small{color:var(--on);opacity:.8}
.slots{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.slot{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 0;font-weight:600;cursor:pointer}.slot:hover{border-color:var(--accent);color:var(--accent)}
input,select.f{width:100%;height:52px;background:var(--card);border:1px solid var(--line);border-radius:14px;color:var(--text);font:inherit;padding:0 16px;margin:6px 0 4px;outline:none}
input:focus{border-color:var(--accent)}
input[type=date]{color-scheme:dark}
label.f{display:block;font-size:13px;color:var(--muted);margin-top:8px}
.legal{max-height:320px;overflow-y:auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;font-size:14px;line-height:1.55;white-space:pre-wrap;margin-top:14px}.legal h3{margin:0 0 6px;font-size:16px;white-space:normal}.legal hr{border:0;border-top:1px solid var(--line);margin:16px 0}
.check{display:flex;gap:10px;align-items:flex-start;font-size:14px;margin:10px 0 4px}.check input{width:18px;height:18px;margin:2px 0 0;accent-color:var(--accent)}.check a{color:var(--accent)}
.err{color:#E5625E;font-size:14px;margin:6px 0}.ok{color:#8fc79a}
.sum .r{display:flex;justify-content:space-between;gap:12px;padding:5px 0}.sum .r span{color:var(--muted)}.sum .r b{text-align:right}
.done-ic{width:84px;height:84px;border-radius:50%;margin:18px auto 4px;display:flex;align-items:center;justify-content:center;background:var(--accent);color:var(--on)}.done-ic svg{width:44px;height:44px}
.center{text-align:center}
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:6;display:flex;background:var(--bg);border-top:1px solid var(--line);padding:6px 0 max(8px,env(safe-area-inset-bottom))}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;background:none;border:0;cursor:pointer;font-size:11px;font-weight:600;color:var(--text);padding:2px 0;min-width:0}
.tab svg{width:24px;height:24px}.tab.on{color:var(--accent)}.tab span{white-space:nowrap}
.tplus{width:46px;height:32px;border-radius:10px;background:var(--accent);color:var(--on);display:flex;align-items:center;justify-content:center}.tplus svg{width:26px;height:26px;stroke-width:2.2}
.rowc{display:flex;align-items:center;gap:16px;width:100%;text-align:left;cursor:pointer;padding:16px 18px}
.rowc svg.big{width:36px;height:36px;color:var(--accent);flex:none}.rowc svg.plainc{width:32px;height:32px;color:var(--text)}
.plain{display:block;width:100%;background:none;border:0;padding:0;text-align:left;cursor:pointer}
.idc .idtitle{font-size:21px;font-weight:800;margin:2px 0}.idc .body{font-size:15px;line-height:21px;opacity:.85}
.photos{display:flex!important;gap:8px;margin-top:8px}.photo{flex:1;aspect-ratio:1.05;border-radius:12px;background:var(--card2);overflow:hidden;display:flex;align-items:center;justify-content:center;color:var(--accent2);border:1px solid var(--line)}.photo img{width:100%;height:100%;object-fit:cover;display:block}.photo svg{width:26px;height:26px}
.idc .alink{display:flex;width:auto;margin-top:6px;padding:4px 0}
.alink.sm{font-size:14px;margin-top:4px}
.sec2{font-size:20px;font-weight:800;margin-top:16px}
.appc{display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 18px}.appic{width:64px;height:64px;border-radius:50%;border:1.5px solid var(--accent);color:var(--accent);display:flex;align-items:center;justify-content:center;margin-bottom:6px}.appic svg{width:30px;height:30px}
.fab{position:fixed;left:0;right:0;bottom:0;z-index:6;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 40%);pointer-events:none;transition:opacity .25s,transform .25s}
.fab .btn{max-width:688px;margin:0 auto;pointer-events:auto;box-shadow:0 6px 24px rgba(0,0,0,.45)}
.fab.hide{opacity:0;transform:translateY(20px)}.fab.hide .btn{pointer-events:none}
.spin{width:28px;height:28px;margin:60px auto;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:sp 0.8s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
#consent{position:fixed;left:12px;right:12px;bottom:12px;max-width:500px;margin:0 auto;background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:14px;font-size:14px;z-index:9;box-shadow:0 6px 30px rgba(0,0,0,.4)}
#consent .row{display:flex;gap:10px;margin-top:10px}#consent .btn{min-height:42px;padding:8px;font-size:15px}
footer{text-align:center;font-size:12px;color:var(--muted);padding:20px 16px 110px}footer a{color:inherit}
@media (min-width:760px){main{padding-top:16px}.hello{font-size:40px}.promo{width:calc(50% - 6px)}.team{grid-template-columns:repeat(3,1fr)}.slots{grid-template-columns:repeat(6,1fr)}}
`;

// Scriptul paginii: totul se desenează din window.SITE (în panou, previzualizarea trimite aspectul nesalvat prin postMessage).
const SITE_JS = String.raw`(function(){
var S=window.SITE,W=S.w,app=document.getElementById('app');
var T={
ro:{welcome:'Bine ați venit',book:'Programare',barbers:'Frizerii',services:'Servicii',contact:'Contact',links:'Linkurile mele',chooseService:'Alege serviciul',chooseBarber:'Alege frizerul',any:'Oricare frizer',anyHint:'Prima oră liberă',chooseTime:'Alege ziua și ora',noSlots:'Nicio oră liberă în ziua asta. Încearcă altă zi.',yourData:'Datele tale',phone:'Telefon',email:'E-mail',sendCode:'Trimite codul',code:'Codul primit',codeSentTo:'Ți-am trimis codul la ',name:'Nume și prenume',birth:'Data nașterii',terms:'Am citit și accept Termenii și condițiile și Politica de confidențialitate.',scrollHint:'Derulează termenii și politica până la capăt ca să poți bifa și semna.',sig:'Semnătura: scrie numele și prenumele',sigNeeded:'Bifează că ai citit documentele și scrie numele ca semnătură.',legalChanged:'Documentele tocmai s-au actualizat. Citește-le din nou și semnează.',marketing:'Vreau să primesc oferte (opțional).',confirm:'Confirmă programarea',service:'Serviciu',barber:'Frizer',when:'Când',price:'Preț',done:'Programare confirmată!',requested:'Cererea a fost trimisă. Salonul o confirmă în curând.',doneText:'Ți-am trimis confirmarea. O poți muta sau anula din aplicație.',again:'Înapoi la început',min:'min',call:'Sună',map:'Vezi pe hartă',hours:'Program',closed:'Închis',days:['Duminică','Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă'],short:['Du','Lu','Ma','Mi','Jo','Vi','Sâ'],months:['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','nov','dec'],consent:'Folosim cookie-uri de statistică și publicitate doar dacă ești de acord.',accept:'Accept',refuse:'Nu, mulțumesc',getApp:'Ia aplicația',err:'A apărut o problemă. Încearcă din nou.',wrongCode:'Codul nu e corect.',expired:'Codul a expirat. Cere altul.',slotTaken:'Ora tocmai a fost ocupată. Alege alta.',badPhone:'Numărul de telefon nu pare corect.',emailMismatch:'E-mailul nu e cel din cont.',emailMissing:'Contul nu are e-mail; scrie-ne la salon.',tooMany:'Ai cerut un cod de curând. Mai încearcă peste un minut.',fill:'Completează toate câmpurile.',emailInUse:'E-mailul e deja folosit de alt cont.'},
en:{welcome:'Welcome',book:'Book now',barbers:'Barbers',services:'Services',contact:'Contact',links:'My links',chooseService:'Choose a service',chooseBarber:'Choose a barber',any:'Any barber',anyHint:'First free time',chooseTime:'Choose day and time',noSlots:'No free times this day. Try another day.',yourData:'Your details',phone:'Phone',email:'E-mail',sendCode:'Send code',code:'Code received',codeSentTo:'We sent the code to ',name:'Full name',birth:'Date of birth',terms:'I have read and accept the Terms and conditions and the Privacy policy.',scrollHint:'Scroll the terms and the privacy policy to the end to be able to tick and sign.',sig:'Signature: type your full name',sigNeeded:'Tick that you read the documents and type your name as your signature.',legalChanged:'The documents were just updated. Read them again and sign.',marketing:'Send me offers (optional).',confirm:'Confirm booking',service:'Service',barber:'Barber',when:'When',price:'Price',done:'Booking confirmed!',requested:'Request sent. The shop will confirm it soon.',doneText:'We sent you a confirmation. You can move or cancel it in the app.',again:'Back to start',min:'min',call:'Call',map:'Open map',hours:'Opening hours',closed:'Closed',days:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],short:['Su','Mo','Tu','We','Th','Fr','Sa'],months:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],consent:'We use statistics and advertising cookies only if you agree.',accept:'Accept',refuse:'No, thanks',getApp:'Get the app',err:'Something went wrong. Please try again.',wrongCode:'Wrong code.',expired:'The code expired. Ask for a new one.',slotTaken:'That time was just taken. Pick another.',badPhone:'The phone number looks wrong.',emailMismatch:'This is not the e-mail on the account.',emailMissing:'The account has no e-mail; please contact the shop.',tooMany:'You asked for a code recently. Try again in a minute.',fill:'Please fill in all fields.',emailInUse:'This e-mail is used by another account.'},
fr:{welcome:'Bienvenue',book:'Prendre rendez-vous',barbers:'Barbiers',services:'Services',contact:'Contact',links:'Mes liens',chooseService:'Choisissez un service',chooseBarber:'Choisissez un barbier',any:'N’importe quel barbier',anyHint:'Premier créneau libre',chooseTime:'Choisissez le jour et l’heure',noSlots:'Aucun créneau ce jour-là. Essayez un autre jour.',yourData:'Vos coordonnées',phone:'Téléphone',email:'E-mail',sendCode:'Envoyer le code',code:'Code reçu',codeSentTo:'Code envoyé à ',name:'Nom et prénom',birth:'Date de naissance',terms:'J’ai lu et j’accepte les Conditions générales et la Politique de confidentialité.',scrollHint:'Faites défiler les conditions et la politique jusqu’au bout pour pouvoir cocher et signer.',sig:'Signature : écrivez vos nom et prénom',sigNeeded:'Cochez que vous avez lu les documents et écrivez votre nom comme signature.',legalChanged:'Les documents viennent d’être mis à jour. Relisez-les et signez.',marketing:'Je veux recevoir des offres (facultatif).',confirm:'Confirmer le rendez-vous',service:'Service',barber:'Barbier',when:'Quand',price:'Prix',done:'Rendez-vous confirmé !',requested:'Demande envoyée. Le salon la confirmera bientôt.',doneText:'Nous vous avons envoyé une confirmation. Vous pouvez le déplacer ou l’annuler dans l’app.',again:'Retour au début',min:'min',call:'Appeler',map:'Voir la carte',hours:'Horaires',closed:'Fermé',days:['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'],short:['Di','Lu','Ma','Me','Je','Ve','Sa'],months:['janv','févr','mars','avr','mai','juin','juil','août','sept','oct','nov','déc'],consent:'Nous utilisons des cookies de statistiques et de publicité seulement avec votre accord.',accept:'Accepter',refuse:'Non merci',getApp:'Télécharger l’app',err:'Un problème est survenu. Réessayez.',wrongCode:'Code incorrect.',expired:'Le code a expiré. Demandez-en un autre.',slotTaken:'Ce créneau vient d’être pris. Choisissez-en un autre.',badPhone:'Le numéro semble incorrect.',emailMismatch:'Cet e-mail n’est pas celui du compte.',emailMissing:'Le compte n’a pas d’e-mail ; contactez le salon.',tooMany:'Vous avez demandé un code récemment. Réessayez dans une minute.',fill:'Remplissez tous les champs.',emailInUse:'Cet e-mail est déjà utilisé.'}
};
var T2={
ro:{hello:'Bine ai venit.',sub:'Următoarea vizită începe aici.',bookCta:'Programează-te',firstFree:'Prima oră disponibilă',bookAt:'Rezervă {t}',otherTime:'Altă oră',recommended:'Recomandarea TAF',team:'Echipa',visit:'Ne găsești aici',directions:'Indicații',whatsapp:'WhatsApp',about:'Despre noi',apps:'Aplicația TAF',dlOn:'Descarcă din',getOn:'Disponibil pe',steps:['Serviciul','Frizerul','Ora','Confirmare'],from:'de la',chooseBarberSub:'Alege cu cine vrei să te tunzi.',chooseServiceSub:'Ce facem azi?',assistantTitle:'Spune când vrei să te tunzi.',assistantSub:'Asistentul tău se ocupă de programare.',idKicker:'TAF Identity',idTitle:'Arată-ne cum vrei să te tunzi.',idText:'Adaugă fotografii sau vezi cu AI ce ți se potrivește și spune-ne ce vrei să păstrăm sau să schimbăm.',idTextNoAi:'Adaugă fotografii cu tunsoarea dorită și spune-ne ce vrei să păstrăm sau să schimbăm.',idCta:'Pregătește-ți tunsoarea',perks:'Beneficiile tale',qRewards:'Bonusuri',qGift:'Card cadou',qSubs:'Abonamente',qShop:'Magazin',invite:'Adu un prieten',inviteText:'Primiți amândoi bonus la prima lui tunsoare.',inviteCta:'Invită un prieten',tabHome:'Acasă',tabServices:'Servicii',tabBook:'Rezervă',tabBookings:'Programări',tabAccount:'Cont',appTitle:'Disponibil în aplicația TAF',appText:'Descarcă aplicația gratuită ca să folosești și asta. Te programezi la fel de ușor și primești bonusuri.',bookingsText:'Programările tale le vezi, le muți sau le anulezi din aplicația TAF.',accountText:'Contul tău, bonusurile și abonamentele sunt în aplicația TAF.'},
en:{hello:'Welcome.',sub:'Your next visit starts here.',bookCta:'Book now',firstFree:'First available time',bookAt:'Book {t}',otherTime:'Another time',recommended:'TAF recommends',team:'The team',visit:'Find us here',directions:'Directions',whatsapp:'WhatsApp',about:'About us',apps:'The TAF app',dlOn:'Download on the',getOn:'Get it on',steps:['Service','Barber','Time','Confirm'],from:'from',chooseBarberSub:'Choose who cuts your hair.',chooseServiceSub:'What are we doing today?',assistantTitle:'Tell us when you want a haircut.',assistantSub:'Your assistant takes care of the booking.',idKicker:'TAF Identity',idTitle:'Show us the haircut you want.',idText:'Add photos or let AI show you what suits you, and tell us what to keep or change.',idTextNoAi:'Add photos of the haircut you want and tell us what to keep or change.',idCta:'Prepare your haircut',perks:'Your perks',qRewards:'Rewards',qGift:'Gift card',qSubs:'Memberships',qShop:'Shop',invite:'Bring a friend',inviteText:'You both get a bonus on their first cut.',inviteCta:'Invite a friend',tabHome:'Home',tabServices:'Services',tabBook:'Book',tabBookings:'Bookings',tabAccount:'Account',appTitle:'Available in the TAF app',appText:'Download the free app to use this too. Booking is just as easy and you earn rewards.',bookingsText:'See, move or cancel your bookings in the TAF app.',accountText:'Your account, rewards and memberships are in the TAF app.'},
fr:{hello:'Bienvenue.',sub:'Votre prochaine visite commence ici.',bookCta:'Réserver',firstFree:'Première heure disponible',bookAt:'Réserver {t}',otherTime:'Autre heure',recommended:'La recommandation TAF',team:'L’équipe',visit:'Où nous trouver',directions:'Itinéraire',whatsapp:'WhatsApp',about:'À propos',apps:'L’app TAF',dlOn:'Télécharger dans',getOn:'Disponible sur',steps:['Service','Barbier','Heure','Confirmation'],from:'dès',chooseBarberSub:'Choisissez votre barbier.',chooseServiceSub:'On fait quoi aujourd’hui ?',assistantTitle:'Dites-nous quand vous voulez vous faire couper.',assistantSub:'Votre assistant s’occupe de la réservation.',idKicker:'TAF Identity',idTitle:'Montrez-nous la coupe que vous voulez.',idText:'Ajoutez des photos ou découvrez avec l’IA ce qui vous va, et dites-nous quoi garder ou changer.',idTextNoAi:'Ajoutez des photos de la coupe souhaitée et dites-nous quoi garder ou changer.',idCta:'Préparez votre coupe',perks:'Vos avantages',qRewards:'Bonus',qGift:'Carte cadeau',qSubs:'Abonnements',qShop:'Boutique',invite:'Invite un ami',inviteText:'Vous recevez tous les deux un bonus à sa première coupe.',inviteCta:'Inviter un ami',tabHome:'Accueil',tabServices:'Services',tabBook:'Réserver',tabBookings:'RDV',tabAccount:'Compte',appTitle:'Disponible dans l’app TAF',appText:'Téléchargez l’app gratuite pour utiliser aussi ceci. Réserver est tout aussi simple et vous gagnez des bonus.',bookingsText:'Consultez, déplacez ou annulez vos rendez-vous dans l’app TAF.',accountText:'Votre compte, vos bonus et abonnements sont dans l’app TAF.'}
};
for(var k in T2)for(var j in T2[k])T[k][j]=T2[k][j];
// Iconițe în stilul celor din aplicație (contur, colțuri rotunjite).
var ICON={book:'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4M12 13v4M10 15h4',barbers:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M17 4l3 3-8 8',services:'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',contact:'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',links:'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
back:'M15 18l-6-6 6-6',chev:'M9 18l6-6-6-6',arrow:'M5 12h14M13 6l6 6-6 6',globe:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',pin:'M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',nav:'M3 11l19-9-9 19-2-8-8-2z',wa:'M20.5 3.5A11 11 0 0 0 3.2 17.3L2 22l4.8-1.3A11 11 0 0 0 20.5 3.5zM8.5 7.5c.3-.6.6-.6 1-.6h.6c.2 0 .5 0 .7.6l.9 2.1c.1.2.1.4 0 .6l-.5.8c-.1.2-.2.4 0 .6.5.9 1.2 1.6 2 2.1.3.2.6.4.9.5.2.1.4 0 .5-.1l.7-.9c.2-.2.4-.2.6-.1l2 1c.3.1.4.3.4.5 0 .6-.3 1.6-1.4 2-1 .4-2.3.3-4-.5a11 11 0 0 1-4.6-4.4c-.8-1.4-.9-2.8-.3-3.8z',check:'M20 6L9 17l-5-5',wave:'M3 10v4M7 7v10M11 4v16M15 8v8M19 6v12M21 10v4',card:'M2 6h20v13H2zM2 10h20M6 15h4',calnum:'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 18h2M14 18h2',calendar:'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',home:'M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5',plus:'M12 5v14M5 12h14',pinf:'M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',user:'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM3.5 21a8.5 8.5 0 0 1 17 0',
pricetag:'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',flame:'M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z',school:'M2 9l10-5 10 5-10 5-10-5zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6','bag-handle':'M5 8h14l-1 13H6L5 8zM9 8V6a3 3 0 0 1 6 0v2',cut:'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',sparkles:'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',star:'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9L12 2.5z',diamond:'M6 3h12l4 6-10 12L2 9l4-6zM2 9h20',gift:'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',water:'M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0L12 2.7z',hourglass:'M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4',trophy:'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',people:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.7',ribbon:'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.2 13.9L7 23l5-3 5 3-1.2-9.1',flash:'M13 2L3 14h9l-1 8 10-12h-9l1-8z',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z'};
var FILL={apple:'M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9s-2-.9-3.4-.9c-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.8 1.3 10.3.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.2zM13.9 5c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z',play:'M3.6 2.2c-.3.3-.4.7-.4 1.3v17c0 .6.1 1 .4 1.3l9.5-9.8-9.5-9.8zM14.2 13.1l2.9 3-11.7 6.6c-.4.2-.8.2-1.1.1l9.9-9.7zM14.2 10.9L4.3 1.2c.3-.1.7-.1 1.1.1L17.1 7.9l-2.9 3zM18.3 8.6l3.2 1.8c1 .6 1 1.5 0 2.1l-3.2 1.8-3.1-3.2 3.1-2.5z'};
var lang=pickLang(),view='home',data={},sel={},token=null,history=[];
function pickLang(){var q=new URLSearchParams(location.search).get('lang');var saved=null;try{saved=localStorage.getItem('taf-site-lang')}catch(e){}var l=S.preview?W.defaultLang:q||saved||(navigator.language||'').slice(0,2);return W.languages.indexOf(l)>=0?l:W.defaultLang}
function t(k,v){var s=(T[lang]||T.ro)[k];return v?String(s).replace('{t}',v):s}
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return'&#'+c.charCodeAt(0)+';'})}
function on(hex){var n=parseInt(hex.slice(1),16);return (0.299*(n>>16&255)+0.587*(n>>8&255)+0.114*(n&255))>150?'#000000':'#FFFFFF'}
function mix(hex,k){var n=parseInt(hex.slice(1),16);return'#'+[n>>16&255,n>>8&255,n&255].map(function(x){return Math.round(x+(255-x)*k).toString(16).padStart(2,'0')}).join('')}
function shade(hex,k){var n=parseInt(hex.slice(1),16);return'#'+[n>>16&255,n>>8&255,n&255].map(function(x){return Math.round(x*k).toString(16).padStart(2,'0')}).join('')}
// Cardurile ca în aplicație: culoarea cardurilor din aspectul aplicației, dacă site-ul are același fundal; altfel puțin mai deschise decât fundalul.
function theme(){var r=document.documentElement.style,L=S.look||{},same=L.background===W.background;var card=same&&L.card?L.card:mix(W.background,.07);r.setProperty('--bg',W.background);r.setProperty('--text',W.text);r.setProperty('--muted',same&&L.muted?L.muted:mix(W.background,.6));r.setProperty('--accent',W.accent);r.setProperty('--accent2',shade(W.accent,.74));r.setProperty('--on',W.buttonText||on(W.accent));r.setProperty('--card',card);r.setProperty('--card2',mix(card,.06));r.setProperty('--line',mix(card,.1));r.setProperty('--bgimg',W.backgroundImage?'url("'+W.backgroundImage+'")':'none');r.setProperty('--dim',W.backgroundImage?W.backgroundDim/100:0);document.documentElement.lang=lang;var m=document.querySelector('meta[name=theme-color]');if(m)m.content=W.background}
function api(m,p,b){var h={'content-type':'application/json'};if(token)h.authorization='Bearer '+token;return fetch('/v1'+p+(p.indexOf('?')>=0?'&':'?')+'lang='+lang,{method:m,headers:h,body:b?JSON.stringify(b):undefined}).then(function(r){return r.json().catch(function(){return null}).then(function(j){if(!r.ok)throw new Error((j&&j.error)||'server_error');return j})})}
function load(k,p){if(data[k])return Promise.resolve(data[k]);return api('GET',p).then(function(x){data[k]=x;return x})}
function soft(k,p,d){return load(k,p).then(null,function(){return d})}
function ic(k,cls){return ICON[k]?'<svg'+(cls?' class="'+cls+'"':'')+' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="'+ICON[k]+'"/></svg>':''}
function fi(k){return'<svg viewBox="0 0 24 24" fill="currentColor"><path d="'+FILL[k]+'"/></svg>'}
function svg(k){return W.showIcons?ic(k):''}
function brand(){var logo=W.logoUrl||S.appLogo;if(logo)return'<span class="hl"><img class="hlogo" src="'+e(logo)+'" alt="'+e(S.biz.name)+'"></span>';var n=(S.look&&S.look.title)||S.biz.name||'';var i=n.lastIndexOf(' ');return'<span class="brand">'+(i>0?e(n.slice(0,i))+' <em>'+e(n.slice(i+1))+'</em>':e(n))+'</span>'}
function header(title){var langs=W.languages.length>1?'<label class="langw">'+ic('globe')+'<select id="lang" aria-label="Language">'+W.languages.map(function(l){return'<option value="'+l+'"'+(l===lang?' selected':'')+'>'+l.toUpperCase()+'</option>'}).join('')+'</select></label>':'';
if(TABS[view])return'<header>'+brand()+langs+'<button class="ib" data-go="account" aria-label="'+t('tabAccount')+'">'+ic('user')+'</button></header>';return'<header><button class="ib" id="back" aria-label="Back">'+ic('back')+'</button><span class="ttl">'+e(title)+'</span>'+(langs||'<span class="ib"></span>')+'</header>'}
function money(v){return (v%1?v.toFixed(2):v)+' lei'}
function svcPrice(s){if(s.offer&&s.offer.percent){var p=Math.round(s.price*(100-s.offer.percent)/100);return'<span class="old">'+money(s.price)+'</span>'+money(p)}return money(s.price)}
function avatar(b){return b.photoUrl?'<img class="av" src="'+e(b.photoUrl)+'" alt="">':'<div class="av">'+e(b.initials||'')+'</div>'}
function dayLabel(d){var x=new Date(d+'T12:00:00');return t('days')[x.getDay()]+', '+x.getDate()+' '+t('months')[x.getMonth()]}
function time(iso){return new Date(iso).toLocaleTimeString(lang==='en'?'en-GB':lang,{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Bucharest'})}
function today(){return new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Bucharest'})}
function dayOf(iso){return new Date(iso).toLocaleDateString('en-CA',{timeZone:'Europe/Bucharest'})}
function addDays(d,n){var x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)}
function go(v){history.push(view);view=v;render();scrollTo(0,0)}
function back(){view=history.pop()||'home';render()}
function steps(n){return'<div class="steps">'+t('steps').map(function(l,i){return'<div><i class="'+(i<n?'on':'')+'"></i><span class="'+(i+1===n?'cur':'')+'">'+e(l)+'</span></div>'}).join('')+'</div>'}
function svcCard(s,pick){return'<button class="card svc pick" '+(pick?'data-svc="'+e(s.id)+'"':'data-book-svc="'+e(s.id)+'"')+'>'+(s.imageUrl?'<img class="thumb" src="'+e(s.imageUrl)+'" alt="">':'<div class="thumb" style="--sc:'+e(s.color||W.accent)+'">'+ic('cut')+'</div>')+'<div class="grow"><div class="ctitle">'+e(s.name)+'</div>'+(s.membersOnly?'<span class="club">TAF Club</span>':'')+(s.description?'<div class="muted clamp">'+e(s.description)+'</div>':'')+'</div><div class="pr"><div class="price">'+svcPrice(s)+'</div><div class="muted">'+s.durationMin+' '+t('min')+'</div></div></button>'}
function promoCard(p){var bg=p.imageUrl?' style="background-image:url(&quot;'+e(p.imageUrl)+'&quot;)"':'';return'<button class="card promo" data-promo="'+e(p.id)+'"><div class="pimg"'+bg+'>'+(p.imageUrl?'':'<div class="badge">'+(ic(p.icon)||ic('star'))+'</div>')+'</div><div class="pbody">'+(p.kicker?'<div class="kicker">'+e(p.kicker)+'</div>':'')+'<div class="ptitle">'+e(p.title)+'</div>'+(p.text?'<div class="small">'+e(p.text)+'</div>':'')+(p.cta?'<div class="alink"><span>'+e(p.cta)+'</span>'+ic('arrow')+'</div>':'')+'</div></button>'}
// Prima pagină, ca în aplicație: salutul, prima oră liberă, recomandările, serviciile, echipa, adresa.
// Prima pagină, în aceeași ordine ca în aplicație: salutul, prima oră, asistentul, TAF Identity, recomandările, beneficiile, invită un prieten, adresa.
// Ce există doar în aplicație (asistentul, bonusurile, magazinul...) duce la pagina cu aplicația.
var STYLES=['textured_crop','skin_fade','quiff'];
var PERKS=[['gift','qRewards'],['card','qGift'],['calnum','qSubs'],['bag-handle','qShop']];
function home(){return Promise.all([soft('services','/services',[]),soft('barbers','/barbers',[]),soft('promos','/promos',[]),api('GET','/next-free').then(null,function(){return null}),soft('biz','/business',null)]).then(function(r){var svcs=r[0]||[],team=r[1]||[],promos=r[2]||[],free=r[3],b=r[4]||{};data.free=free;
var welcome=W.welcome[lang]||(S.look&&S.look.welcome&&S.look.welcome[lang])||t('sub');
var h='<div><div class="hello">'+e(t('hello'))+'</div><div class="hello-sub">'+e(welcome)+'</div></div>';
if(W.sections.booking){var fs=free&&!free.membersOnly&&svcs.filter(function(s){return s.id===free.serviceId})[0],fb=fs&&team.filter(function(x){return x.id===free.barberId})[0];
if(fs)h+='<div class="card"><div class="kicker">'+t('firstFree')+'</div><div class="free-time">'+time(free.start)+'</div><div class="free-date">'+dayLabel(dayOf(free.start))+'</div><div class="free-meta">'+e([fb&&fb.name,fs.name].filter(Boolean).join('  ·  '))+'</div><div class="free-meta">'+money(fs.price)+' · '+fs.durationMin+' '+t('min')+'</div><button class="btn sq" id="bookfree">'+e(t('bookAt',time(free.start)))+'</button><button class="link-u" data-go="book">'+t('otherTime')+'</button></div>';
else h+='<button class="btn" data-go="book">'+t('bookCta')+'</button>'}
h+='<button class="card rowc" data-go="app">'+ic('wave','big')+'<div class="grow"><div class="ptitle">'+t('assistantTitle')+'</div><div class="small">'+t('assistantSub')+'</div></div>'+ic('chev','chev')+'</button>';
h+='<div class="card idc"><button class="plain" data-go="app"><div class="kicker">'+t('idKicker')+'</div><div class="idtitle">'+t('idTitle')+'</div><div class="body">'+t(b.advisor?'idText':'idTextNoAi')+'</div></button><button class="photos plain" data-go="app">'+STYLES.map(function(k){return'<span class="photo"><img src="/v1/advisor/style/'+k+'?bw=1&v='+(b.styleV||0)+'" alt="" onerror="this.parentNode.innerHTML=this.parentNode.dataset.ph" ></span>'}).join('').replace(/<span class="photo">/g,'<span class="photo" data-ph="'+e(ic('cut'))+'">')+'</button><button class="alink plain" data-go="app"><span>'+t('idCta')+'</span>'+ic('arrow')+'</button></div>';
if(promos.length){h+='<div class="sec2">'+t('recommended')+'</div><div class="promos" id="promos">'+promos.map(promoCard).join('')+'</div>';if(promos.length>1)h+='<div class="dots" id="dots">'+promos.map(function(p,i){return'<i class="'+(i?'':'on')+'"></i>'}).join('')+'</div>'}
h+='<div class="sec2">'+t('perks')+'</div><div class="perks">'+PERKS.map(function(x){return'<button class="card perk" data-go="app">'+ic(x[0])+'<span>'+t(x[1])+'</span>'+ic('chev','chev')+'</button>'}).join('')+'</div>';
h+='<button class="card rowc" data-go="app">'+ic('people','big plainc')+'<div class="grow"><div class="ptitle">'+t('invite')+'</div><div class="small">'+t('inviteText')+'</div><div class="alink sm"><span>'+t('inviteCta')+'</span>'+ic('arrow')+'</div></div>'+ic('chev','chev')+'</button>';
if(W.sections.links&&W.links.length)h+='<div class="sec2">'+t('links')+'</div><div class="perks">'+W.links.map(function(l){return'<a class="card perk" href="'+e(l.url)+'" target="_blank" rel="noopener">'+ic('links')+'<span>'+e(l.label)+'</span>'+ic('chev','chev')+'</a>'}).join('')+'</div>';
if(W.sections.contact)h+=visit();
return h})}
// Ce e doar în aplicație: programările, contul, asistentul, bonusurile, magazinul.
function appOnly(){var k=view==='bookings'?'bookingsText':view==='account'?'accountText':'appText';var ico=view==='bookings'?'calendar':view==='account'?'user':'sparkles';return'<h2>'+(view==='bookings'?t('tabBookings'):view==='account'?t('tabAccount'):t('apps'))+'</h2><div class="card center appc"><div class="appic">'+ic(ico)+'</div><div class="ptitle">'+t('appTitle')+'</div><div class="small">'+t(k)+'</div></div>'+stores(true)}
function visit(){var B=S.biz,h='';if(!B.address&&!B.phone)return'';var map='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(B.name+' '+B.address);var tel=(B.phone||'').replace(/\s+/g,''),wa=tel.replace(/^\+/,'').replace(/^0/,'40');
h+='<div class="sec2">'+t('visit')+'</div>';if(B.address)h+='<a class="addr" target="_blank" rel="noopener" href="'+map+'">'+ic('pinf')+'<span>'+e(B.address)+'</span></a>';
h+='<div class="pills">'+(B.address?'<a class="pill" target="_blank" rel="noopener" href="'+map+'">'+ic('nav')+t('directions')+'</a>':'')+(tel?'<a class="pill" href="tel:'+e(tel)+'">'+ic('contact')+t('call')+'</a><a class="pill" target="_blank" rel="noopener" href="https://wa.me/'+e(wa)+'">'+ic('wa')+t('whatsapp')+'</a>':'')+'</div>';return h}
function stores(bare){return(bare?'':'<div class="sec">'+t('apps')+'</div>')+'<div class="stores"><a class="store" href="'+S.stores.appStore+'" target="_blank" rel="noopener">'+fi('apple')+'<span><small>'+t('dlOn')+'</small><b>App Store</b></span></a><a class="store" href="'+S.stores.play+'" target="_blank" rel="noopener">'+fi('play')+'<span><small>'+t('getOn')+'</small><b>Google Play</b></span></a></div>'}
function services(pick){return load('services','/services').then(function(list){return(pick?steps(1):'')+'<div><h2>'+(pick?t('chooseService'):t('services'))+'</h2>'+(pick?'<div class="muted">'+t('chooseServiceSub')+'</div>':'')+'</div>'+list.map(function(s){return svcCard(s,pick)}).join('')})}
function barbers(pick){return Promise.all([load('barbers','/barbers'),pick?Promise.resolve():soft('services','/services',[])]).then(function(r){var list=r[0];if(pick)list=list.filter(function(b){return b.serviceIds.indexOf(sel.service.id)>=0});var h=(pick?steps(2):'')+'<div><h2>'+(pick?t('chooseBarber'):t('barbers'))+'</h2>'+(pick?'<div class="muted">'+t('chooseBarberSub')+'</div>':'')+'</div>';if(pick)h+='<button class="card brow pick" data-barber=""><div class="av">'+ic('people')+'</div><div class="grow"><div class="ctitle">'+t('any')+'</div><div class="muted">'+t('anyHint')+'</div></div>'+ic('chev','chev')+'</button>';
return h+list.map(function(b){return'<button class="card brow pick" '+(pick?'data-barber="'+e(b.id)+'"':'data-go="book"')+'>'+avatar(b)+'<div class="grow"><div class="ctitle">'+e(b.name)+'</div><div class="muted">'+e(b.role||'')+'</div>'+(!pick&&b.bio?'<div class="muted" style="margin-top:6px">'+e(b.bio)+'</div>':'')+'</div></button>'}).join('')+(pick?'':'<button class="btn" data-go="book" style="margin-top:8px">'+t('bookCta')+'</button>')})}
function times(){var d=sel.day||today();var days=[];for(var i=0;i<21;i++)days.push(addDays(today(),i));var q='/availability?serviceId='+encodeURIComponent(sel.service.id)+'&day='+d+(sel.barber?'&barberId='+encodeURIComponent(sel.barber.id):'');
return api('GET',q).then(function(slots){sel._slots=slots;return steps(3)+'<h2>'+t('chooseTime')+'</h2><div class="days">'+days.map(function(x){var o=new Date(x+'T12:00:00');return'<button class="day'+(x===d?' on':'')+'" data-day="'+x+'"><small>'+t('short')[o.getDay()]+'</small><b>'+o.getDate()+'</b><small>'+t('months')[o.getMonth()]+'</small></button>'}).join('')+'</div><div class="muted">'+dayLabel(d)+'</div>'+(slots.length?'<div class="slots">'+slots.map(function(s,i){return'<button class="slot" data-slot="'+i+'">'+time(s.start)+'</button>'}).join('')+'</div>':'<div class="card muted center">'+t('noSlots')+'</div>');}).then(null,function(){return'<p class="err">'+t('err')+'</p>'})}
function summary(){var b=sel.barber||((data.barbers||[]).filter(function(x){return x.id===sel.slot.barberId})[0])||{};return'<div class="card sum"><div class="r"><span>'+t('service')+'</span><b>'+e(sel.service.name)+'</b></div><div class="r"><span>'+t('barber')+'</span><b>'+e(b.name||'')+'</b></div><div class="r"><span>'+t('when')+'</span><b>'+dayLabel(sel.day||today())+', '+time(sel.slot.start)+'</b></div><div class="r"><span>'+t('price')+'</span><b class="price">'+svcPrice(sel.service)+'</b></div></div>'}
function details(){if(token)return steps(4)+'<h2>'+t('confirm')+'</h2>'+summary()+'<button class="btn" id="confirm">'+t('confirm')+'</button><p class="err" id="msg"></p>';var h=steps(4)+summary()+'<h2 style="font-size:22px;margin-top:10px">'+t('yourData')+'</h2><div id="f1"><label class="f">'+t('phone')+'<input id="phone" type="tel" autocomplete="tel" placeholder="07xx xxx xxx"></label>'+(S.otpSms?'':'<label class="f">'+t('email')+'<input id="email" type="email" autocomplete="email"></label>')+'<button class="btn" id="send">'+t('sendCode')+'</button></div><div id="f2" hidden><p class="muted ok" id="sent"></p><label class="f">'+t('code')+'<input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label><div id="newacc" hidden><label class="f">'+t('name')+'<input id="name" autocomplete="name"></label>'+(S.otpSms?'<label class="f">'+t('email')+'<input id="email2" type="email" autocomplete="email"></label>':'')+'<label class="f">'+t('birth')+'<input id="birth" type="date"></label><div class="legal" id="legal" tabindex="0"></div><p class="muted" id="lhint">'+t('scrollHint')+'</p><label class="check"><input type="checkbox" id="terms" disabled><span>'+t('terms')+'</span></label><label class="f">'+t('sig')+'<input id="sig" autocomplete="off" maxlength="120"></label><label class="check"><input type="checkbox" id="mk"><span>'+t('marketing')+'</span></label></div><button class="btn" id="confirm">'+t('confirm')+'</button></div><p class="err" id="msg"></p>';return h}
var ERR={wrong_code:'wrongCode',code_expired:'expired',slot_unavailable:'slotTaken',too_many_active_bookings:'err',invalid_phone:'badPhone',email_mismatch:'emailMismatch',email_not_on_account:'emailMissing',too_many_requests:'tooMany',terms_required:'fill',birth_date_required:'fill',email_required:'fill',email_in_use:'emailInUse',signature_required:'sigNeeded',legal_changed:'legalChanged'};
function fail(x){var m=document.getElementById('msg');if(m)m.textContent=t(ERR[x&&x.message]||'err')}
function bindDetails(){var phone='',isNew=false,legal=null;var $=function(i){return document.getElementById(i)};
// Termenii și politica, de derulat până la capăt înainte de bifă și semnătură (numele scris); versiunile se trimit la creare.
function loadLegal(){legal=null;$('terms').checked=false;$('terms').disabled=true;$('lhint').hidden=false;var box=$('legal');box.textContent='…';Promise.all([api('GET','/legal/terms?lang='+lang),api('GET','/legal/privacy?lang='+lang)]).then(function(r){legal=r;box.innerHTML='<h3>'+e(r[0].title)+'</h3>'+e(r[0].body)+'<hr><h3>'+e(r[1].title)+'</h3>'+e(r[1].body);box.scrollTop=0;box.onscroll=function(){if(box.scrollTop+box.clientHeight>=box.scrollHeight-30){$('terms').disabled=false;$('lhint').hidden=true}}},function(){box.textContent=t('err')})}
if($('send'))$('send').onclick=function(){$('msg').textContent='';this.disabled=true;var me=this;var body={phone:$('phone').value,channel:S.otpSms?'sms':'email'};if(!S.otpSms)body.email=$('email').value.trim();api('POST','/auth/otp',body).then(function(r){phone=r.phone;isNew=r.newAccount;$('f1').hidden=true;$('f2').hidden=false;$('newacc').hidden=!isNew;if(isNew)loadLegal();$('sent').textContent=t('codeSentTo')+r.sentTo+(r.devCode?' ('+r.devCode+')':'');},fail).then(function(){me.disabled=false})};
$('confirm').onclick=function(){$('msg').textContent='';var me=this;var body={phone:phone,code:token?'':$('code').value.trim(),lang:lang};if(isNew&&!token){body.name=$('name').value.trim();body.birthDate=$('birth').value;body.acceptTerms=$('terms').checked;body.marketing=$('mk').checked;if(S.otpSms)body.email=$('email2').value.trim();if(!body.name||!body.birthDate){$('msg').textContent=t('fill');return}var sig=$('sig').value.replace(/\s+/g,' ').trim();if(!legal||!body.acceptTerms||(sig.match(/[A-Za-zÀ-ɏ]/g)||[]).length<3){$('msg').textContent=t('sigNeeded');return}body.signature=sig;body.termsVersion=legal[0].version;body.privacyVersion=legal[1].version}me.disabled=true;
(token?Promise.resolve({token:token}):api('POST','/auth/verify',body)).then(function(v){token=v.token;return api('POST','/bookings',{serviceId:sel.service.id,barberId:sel.barber?sel.barber.id:sel.slot.barberId,start:sel.slot.start,note:'Programare de pe site'})}).then(function(b){sel.result=b;trackBooking();history=[];view='done';render()},function(x){if(x&&x.message==='slot_unavailable'){sel.slot=null;history.pop();view='pickTime';render();setTimeout(function(){alert(t('slotTaken'))},50);return}fail(x);if(x&&x.message==='legal_changed')loadLegal();me.disabled=false})}}
function done(){var req=sel.result&&sel.result.status==='requested';return'<div class="center"><div class="done-ic">'+ic('check')+'</div><h2>'+(req?t('requested'):t('done'))+'</h2></div>'+summary()+'<p class="muted center">'+t('doneText')+'</p><a class="btn" href="'+(/iPhone|iPad/.test(navigator.userAgent)?S.stores.appStore:S.stores.play)+'" target="_blank" rel="noopener">'+t('getApp')+'</a><button class="btn ghost" id="again">'+t('again')+'</button>'}
function contact(){return soft('biz','/business',null).then(function(b){return'<h2>'+t('contact')+'</h2><div class="card"><div class="ctitle">'+e(S.biz.name)+'</div>'+(S.biz.address?'<div class="muted">'+e(S.biz.address)+'</div>':'')+'</div>'+visit()})}
function links(){return'<h2>'+t('links')+'</h2>'+W.links.map(function(l){return'<a class="card perk" href="'+e(l.url)+'" target="_blank" rel="noopener">'+ic('links')+'<span>'+e(l.label)+'</span>'+ic('chev','chev')+'</a>'}).join('')}
var seq=0;
function render(){theme();document.documentElement.lang=lang;var titles={home:'',app:t('apps'),bookings:t('tabBookings'),account:t('tabAccount'),services:t('services'),barbers:t('barbers'),contact:t('contact'),links:t('links'),book:t('book'),pickBarber:t('book'),pickTime:t('book'),details:t('book'),done:t('book')};
var body=view==='home'?home():view==='app'||view==='bookings'||view==='account'?appOnly():view==='services'?services(false):view==='barbers'?barbers(false):view==='contact'?contact():view==='links'?links():view==='book'?services(true):view==='pickBarber'?barbers(true):view==='pickTime'?times():view==='details'?details():done();
var my=++seq,foot='<footer>© '+e(S.biz.name)+' · <a href="/legal/privacy?lang='+lang+'">'+(lang==='ro'?'Confidențialitate':lang==='fr'?'Confidentialité':'Privacy')+'</a> · <a href="/legal/terms?lang='+lang+'">'+(lang==='ro'?'Termeni':lang==='fr'?'Conditions':'Terms')+'</a>'+(hasTracking()&&!S.preview?' · <a href="#" id="cookies">'+(lang==='ro'?'Cookie-uri':'Cookies')+'</a>':'')+'</footer>';
var fab=TABS[view]||view==='app'?tabbar():'';
var shell=function(h){return'<div class="wrap">'+header(titles[view])+'<main>'+h+'</main>'+foot+'</div>'+fab};
if(body&&body.then&&!app.firstChild||body&&body.then&&app.dataset.view!==view){app.innerHTML=shell('<div class="spin"></div>');wire()}
Promise.resolve(body).then(function(h){if(my!==seq)return;app.dataset.view=view;app.innerHTML=shell(h);wire()},function(){if(my!==seq)return;app.innerHTML=shell('<p class="err">'+t('err')+'</p>');wire()})}
function wire(){var q=function(s){return Array.prototype.slice.call(app.querySelectorAll(s))};var b=document.getElementById('back');if(b)b.onclick=back;var ck=document.getElementById('cookies');if(ck)ck.onclick=function(ev){ev.preventDefault();cookieSettings()};var l=document.getElementById('lang');if(l)l.onchange=function(){lang=this.value;try{localStorage.setItem('taf-site-lang',lang)}catch(e){}data={};render()};
q('[data-go]').forEach(function(x){x.onclick=function(){if(x.dataset.go==='book')sel={};go(x.dataset.go)}});
q('[data-tab]').forEach(function(x){x.onclick=function(){if(view===x.dataset.tab)return scrollTo(0,0);history=[];view=x.dataset.tab;render();scrollTo(0,0)}});
q('[data-svc]').forEach(function(x){x.onclick=function(){sel={service:data.services.filter(function(s){return s.id===x.dataset.svc})[0]};go('pickBarber')}});
q('[data-book-svc]').forEach(function(x){x.onclick=function(){var s=(data.services||[]).filter(function(s){return s.id===x.dataset.bookSvc})[0];if(!s)return;sel={service:s};go('pickBarber')}});
q('[data-promo]').forEach(function(x){x.onclick=function(){var p=(data.promos||[]).filter(function(p){return p.id===x.dataset.promo})[0];if(!p)return;var a=p.action||{};if(a.type==='url'&&a.url)return window.open(a.url,'_blank','noopener');if(a.type==='shop')return window.open(/iPhone|iPad/.test(navigator.userAgent)?S.stores.appStore:S.stores.play,'_blank','noopener');var s=a.type==='service'&&(data.services||[]).filter(function(s){return s.id===a.serviceId})[0];sel=s?{service:s}:{};go(s?'pickBarber':'book')}});
var bf=document.getElementById('bookfree');if(bf)bf.onclick=function(){var f=data.free,s=f&&(data.services||[]).filter(function(s){return s.id===f.serviceId})[0];if(!s)return go('book');sel={service:s,barber:null,day:dayOf(f.start),slot:{start:f.start,barberId:f.barberId}};go('details')};
var pr=document.getElementById('promos'),dots=document.getElementById('dots');if(pr&&dots)pr.onscroll=function(){var w=pr.firstChild?pr.firstChild.offsetWidth+12:1,i=Math.round(pr.scrollLeft/w);Array.prototype.forEach.call(dots.children,function(d,j){d.className=j===i?'on':''})};
q('[data-barber]').forEach(function(x){x.onclick=function(){sel.barber=x.dataset.barber?data.barbers.filter(function(b){return b.id===x.dataset.barber})[0]:null;sel.day=today();go('pickTime')}});
q('[data-day]').forEach(function(x){x.onclick=function(){sel.day=x.dataset.day;render()}});
q('[data-slot]').forEach(function(x){x.onclick=function(){sel.slot=sel._slots[+x.dataset.slot];load('barbers','/barbers').then(function(){go('details')})}});
if(view==='details')bindDetails();var a=document.getElementById('again');if(a)a.onclick=function(){sel={};view='home';history=[];render()}}
// Butonul „Programează-te” de jos apare după ce derulezi pe prima pagină.
// Bara de jos, ca în aplicație: Acasă, Servicii, Rezervă (butonul din mijloc), Programări, Cont.
var TABS={home:1,services:1,bookings:1,account:1};
function tabbar(){var it=[['home','home','tabHome'],['services','cut','tabServices'],null,['bookings','calendar','tabBookings'],['account','user','tabAccount']];return'<nav class="tabs">'+it.map(function(x){if(!x)return'<button class="tab" data-go="book"><span class="tplus">'+ic('plus')+'</span><span>'+t('tabBook')+'</span></button>';return'<button class="tab'+(view===x[0]?' on':'')+'" data-tab="'+x[0]+'">'+ic(x[1])+'<span>'+t(x[2])+'</span></button>'}).join('')+'</nav>'}
// Statistici și reclame (Google Analytics / Ads, Meta Pixel, TikTok): pornesc doar după „Accept” în banner (GDPR, Legea 506/2004).
var TR=W.tracking||{},trackOn=false;
function hasTracking(){return!!(TR.gaId||TR.googleAdsId||TR.metaPixelId||TR.tiktokPixelId)}
function tracking(){if(S.preview||!hasTracking())return;var c=null;try{c=localStorage.getItem('taf-consent')}catch(x){}if(c==='yes')return startTracking();if(c==='no')return;askConsent()}
function askConsent(){if(document.getElementById('consent'))return;var d=document.createElement('div');d.id='consent';d.setAttribute('role','dialog');d.innerHTML=e(t('consent'))+' <a href="/legal/privacy?lang='+lang+'" style="color:inherit">›</a><div class="row"><button class="btn" id="cy">'+t('accept')+'</button><button class="btn ghost" id="cn">'+t('refuse')+'</button></div>';document.body.appendChild(d);
document.getElementById('cy').onclick=function(){try{localStorage.setItem('taf-consent','yes')}catch(x){}d.remove();startTracking()};document.getElementById('cn').onclick=function(){try{localStorage.setItem('taf-consent','no')}catch(x){}d.remove()}}
// Linkul „Cookie-uri” din subsol: retragi sau schimbi acordul oricând (după retragere, pagina se reîncarcă fără scripturi).
function cookieSettings(){var was=null;try{was=localStorage.getItem('taf-consent');localStorage.removeItem('taf-consent')}catch(x){}if(was==='yes')return location.reload();askConsent()}
function addScript(src){var s=document.createElement('script');s.async=true;s.src=src;document.head.appendChild(s)}
function startTracking(){if(trackOn)return;trackOn=true;var g=TR.gaId||TR.googleAdsId;
if(g){addScript('https://www.googletagmanager.com/gtag/js?id='+g);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'});gtag('js',new Date());if(TR.gaId)gtag('config',TR.gaId);if(TR.googleAdsId)gtag('config',TR.googleAdsId)}
if(TR.metaPixelId){!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',TR.metaPixelId);fbq('track','PageView')}
if(TR.tiktokPixelId){!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var r='https://analytics.tiktok.com/i18n/pixel/events.js';ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};addScript(r+'?sdkid='+e+'&lib='+t)}}(window,document,'ttq');ttq.load(TR.tiktokPixelId);ttq.page()}}
// Programarea făcută = „conversia” pentru reclame (doar dacă vizitatorul a acceptat).
function trackBooking(){if(!trackOn||!sel.service)return;var v=Number(sel.service.price)||0,p={value:v,currency:'RON'};
try{if(window.gtag){if(TR.gaId)gtag('event','generate_lead',{value:v,currency:'RON',items:[{item_name:sel.service.name}]});if(TR.googleAdsId&&TR.googleAdsLabel)gtag('event','conversion',{send_to:TR.googleAdsId+'/'+TR.googleAdsLabel,value:v,currency:'RON'})}
if(window.fbq)fbq('track','Schedule',p);if(window.ttq)ttq.track('PlaceAnOrder',{value:v,currency:'RON',contents:[{content_name:sel.service.name}]})}catch(x){}}
// Previzualizarea din panou: aspectul nesalvat vine prin postMessage, de la aceeași adresă.
if(S.preview)addEventListener('message',function(ev){if(ev.origin!==location.origin||!ev.data||ev.data.type!=='taf-site')return;W=S.w=ev.data.website;TR=W.tracking||{};if(W.languages.indexOf(lang)<0)lang=W.defaultLang;if(ev.data.view&&ev.data.view!==view){history=[];view=ev.data.view}render()});
render();tracking();
})();`;

// --- Rutele ---

export const websitePublic = new Hono<AppEnv>();
websitePublic.get('/site', async (c) =>
  c.html(await sitePage(c.env, { preview: c.req.query('preview') === '1', lang: c.req.query('lang') })),
);
websitePublic.get('/robots.txt', async (c) => {
  const u = new URL(c.req.url);
  return c.text(await robotsTxt(c.env, await isSiteHost(c.env, u.host)), 200, { 'cache-control': 'public, max-age=3600' });
});
websitePublic.get('/sitemap.xml', async (c) => {
  const u = new URL(c.req.url);
  if (!(await isSiteHost(c.env, u.host))) return c.text('Not found', 404);
  return c.body(await sitemapXml(c.env), 200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
});

export const websiteAdmin = new Hono<AppEnv>();
websiteAdmin.use('/website', async (c, next) => {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
});
websiteAdmin.get('/website', async (c) => c.json(await getWebsite(c.env)));
websiteAdmin.put('/website', async (c) => c.json(await saveWebsite(c.env, await c.req.json())));
