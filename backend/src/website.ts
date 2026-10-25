import { Hono } from 'hono';
import { getAppearance, isImageUrl } from './appearance';
import { getBusiness, getSetting, setSetting } from './db';
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
  tracking: { gaId: string; metaPixelId: string };
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
  tracking: { gaId: '', metaPixelId: '' },
  links: [],
};

export async function getWebsite(env: Env): Promise<Website> {
  const saved = await getSetting<Partial<Website>>(env, 'website', {});
  return {
    ...DEFAULT_WEBSITE,
    ...saved,
    sections: { ...DEFAULT_WEBSITE.sections, ...saved.sections },
    tracking: { ...DEFAULT_WEBSITE.tracking, ...saved.tracking },
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
    const ga = String(b.tracking.gaId ?? n.tracking.gaId).trim().toUpperCase();
    const px = String(b.tracking.metaPixelId ?? n.tracking.metaPixelId).trim();
    if (ga && !/^G-[A-Z0-9]{4,15}$/.test(ga)) throw new HttpError(400, 'invalid_ga_id');
    if (px && !/^\d{6,20}$/.test(px)) throw new HttpError(400, 'invalid_pixel_id');
    n.tracking = { gaId: ga, metaPixelId: px };
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

export async function sitePage(env: Env, opts: { preview?: boolean } = {}) {
  const [w, biz, look, auto] = await Promise.all([getWebsite(env), getBusiness(env), getAppearance(env), getAutomations(env)]);
  const icon = w.iconUrl ?? '/favicon.png';
  const cfg = {
    w,
    biz: { name: biz.name, tagline: biz.tagline, address: biz.address, phone: biz.phone, instagram: biz.instagram },
    appLogo: look.logoUrl,
    otpSms: auto.otpSms,
    stores: STORE_LINKS,
    preview: !!opts.preview,
  };
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="${w.defaultLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(biz.name)} · Programare online</title><meta name="description" content="${esc(`${biz.name}: programare online${biz.address ? `, ${biz.address}` : ''}`)}">
<link rel="icon" href="${esc(icon)}"><link rel="apple-touch-icon" href="${esc(icon)}"><meta name="theme-color" content="${esc(w.accent)}">
${opts.preview ? '<meta name="robots" content="noindex">' : ''}
<style>${SITE_CSS}</style></head><body><div id="bg"></div><div id="app"></div>
<script>window.SITE=${json};</script><script>${SITE_JS}</script></body></html>`;
}

const SITE_CSS = `
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
#bg{position:fixed;inset:0;background:var(--bg) var(--bgimg) center/cover no-repeat;z-index:-1}
#bg:after{content:"";position:absolute;inset:0;background:var(--bg);opacity:var(--dim)}
.wrap{max-width:520px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
header{position:sticky;top:0;z-index:5;background:var(--accent);color:var(--on);display:flex;align-items:center;justify-content:center;min-height:54px;padding:0 14px;font-weight:700}
header .back{position:absolute;left:8px;background:none;border:0;color:inherit;font-size:24px;padding:6px 10px;cursor:pointer}
header select{position:absolute;right:10px;background:transparent;color:inherit;border:0;font-weight:700;font-size:15px;cursor:pointer}
header select option{color:#000}
main{flex:1;padding:18px 16px 32px}
.logo{display:block;max-width:78%;max-height:230px;margin:26px auto 30px;object-fit:contain}
.title{font-size:34px;font-weight:800;text-align:center;margin:40px 0 34px}
.menu{display:grid;gap:12px}.menu.tiles{grid-template-columns:1fr 1fr}
.mb{display:flex;align-items:center;gap:14px;width:100%;background:var(--accent);color:var(--on);border:0;border-radius:14px;padding:17px 18px;font-size:19px;font-weight:600;text-align:left;cursor:pointer;text-decoration:none}
.tiles .mb{flex-direction:column;justify-content:center;text-align:center;aspect-ratio:1/0.8;font-size:17px}
.mb svg{flex:none;width:30px;height:30px}.mb span{flex:1}.mb i{font-style:normal;opacity:.7;font-size:20px}.tiles .mb i{display:none}.tiles .mb span{flex:none}
.card{background:var(--card);border-radius:14px;padding:14px 16px;margin-bottom:10px}
.row{display:flex;align-items:center;gap:12px}.grow{flex:1;min-width:0}
.pick{width:100%;text-align:left;border:1px solid transparent;color:inherit;font:inherit;cursor:pointer}
.pick:hover,.pick.on{border-color:var(--accent)}
.muted{opacity:.68;font-size:14px}.price{color:var(--accent);font-weight:700;white-space:nowrap}.old{text-decoration:line-through;opacity:.55;font-weight:400;margin-right:6px}
.av{width:52px;height:52px;border-radius:50%;object-fit:cover;background:var(--card2);display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.big .av{width:84px;height:84px;font-size:24px}
h2{font-size:22px;margin:4px 0 14px}
.days{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:10px;scrollbar-width:none}
.day{flex:none;width:62px;border-radius:12px;background:var(--card);color:inherit;border:1px solid transparent;padding:8px 0;text-align:center;cursor:pointer;font:inherit}
.day b{display:block;font-size:20px}.day small{font-size:12px;opacity:.7}.day.on{border-color:var(--accent);background:var(--card2)}
.slots{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.slot{background:var(--card);color:inherit;border:1px solid transparent;border-radius:10px;padding:11px 0;font:inherit;font-weight:600;cursor:pointer}.slot:hover{border-color:var(--accent)}
input,select.f{width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;color:var(--text);font:inherit;padding:13px 14px;margin:5px 0 12px}
label.f{display:block;font-size:14px;opacity:.85}
.check{display:flex;gap:10px;align-items:flex-start;font-size:14px;margin:4px 0 12px}.check input{width:auto;margin:3px 0 0}
.btn{display:block;width:100%;background:var(--accent);color:var(--on);border:0;border-radius:999px;padding:15px;font:inherit;font-weight:800;font-size:17px;cursor:pointer;text-align:center;text-decoration:none;margin-top:6px}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}.btn:disabled{opacity:.5}
.err{color:#ff7a70;font-size:14px;margin:6px 0}.ok{color:#8fc79a}
.sum .row{justify-content:space-between;padding:4px 0}.sum .row span:first-child{opacity:.7}
.stores{display:flex;gap:10px;justify-content:center;margin-top:22px;flex-wrap:wrap}.stores a{border:1px solid var(--line);border-radius:10px;padding:8px 14px;color:var(--text);text-decoration:none;font-size:14px}
.hours .row{justify-content:space-between;padding:3px 0}
#consent{position:fixed;left:12px;right:12px;bottom:12px;max-width:500px;margin:0 auto;background:var(--card2);border-radius:14px;padding:14px;font-size:14px;z-index:9;box-shadow:0 6px 30px rgba(0,0,0,.4)}
#consent .row{margin-top:10px}#consent .btn{margin:0;padding:10px;font-size:15px}
footer{text-align:center;font-size:12px;opacity:.55;padding:18px}footer a{color:inherit}
`;

// Scriptul paginii: totul se desenează din window.SITE (în panou, previzualizarea trimite aspectul nesalvat prin postMessage).
const SITE_JS = String.raw`(function(){
var S=window.SITE,W=S.w,app=document.getElementById('app');
var T={
ro:{welcome:'Bine ați venit',book:'Programare',barbers:'Frizerii',services:'Servicii',contact:'Contact',links:'Linkurile mele',chooseService:'Alege serviciul',chooseBarber:'Alege frizerul',any:'Oricare frizer',anyHint:'Prima oră liberă',chooseTime:'Alege ziua și ora',noSlots:'Nicio oră liberă în ziua asta. Încearcă altă zi.',yourData:'Datele tale',phone:'Telefon',email:'E-mail',sendCode:'Trimite codul',code:'Codul primit',codeSentTo:'Ți-am trimis codul la ',name:'Nume și prenume',birth:'Data nașterii',terms:'Sunt de acord cu <a href="/legal/terms?lang=ro" target="_blank">termenii</a> și <a href="/legal/privacy?lang=ro" target="_blank">politica de confidențialitate</a>.',marketing:'Vreau să primesc oferte (opțional).',confirm:'Confirmă programarea',service:'Serviciu',barber:'Frizer',when:'Când',price:'Preț',done:'Programare confirmată!',requested:'Cererea a fost trimisă. Salonul o confirmă în curând.',doneText:'Ți-am trimis confirmarea. O poți muta sau anula din aplicație.',again:'Înapoi la început',min:'min',call:'Sună',map:'Vezi pe hartă',hours:'Program',closed:'Închis',days:['Duminică','Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă'],short:['Du','Lu','Ma','Mi','Jo','Vi','Sâ'],months:['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','nov','dec'],consent:'Folosim cookie-uri de statistică doar dacă ești de acord.',accept:'Accept',refuse:'Nu, mulțumesc',getApp:'Ia aplicația',err:'A apărut o problemă. Încearcă din nou.',wrongCode:'Codul nu e corect.',expired:'Codul a expirat. Cere altul.',slotTaken:'Ora tocmai a fost ocupată. Alege alta.',badPhone:'Numărul de telefon nu pare corect.',emailMismatch:'E-mailul nu e cel din cont.',emailMissing:'Contul nu are e-mail; scrie-ne la salon.',tooMany:'Ai cerut un cod de curând. Mai încearcă peste un minut.',fill:'Completează toate câmpurile.',emailInUse:'E-mailul e deja folosit de alt cont.'},
en:{welcome:'Welcome',book:'Book now',barbers:'Barbers',services:'Services',contact:'Contact',links:'My links',chooseService:'Choose a service',chooseBarber:'Choose a barber',any:'Any barber',anyHint:'First free time',chooseTime:'Choose day and time',noSlots:'No free times this day. Try another day.',yourData:'Your details',phone:'Phone',email:'E-mail',sendCode:'Send code',code:'Code received',codeSentTo:'We sent the code to ',name:'Full name',birth:'Date of birth',terms:'I agree to the <a href="/legal/terms?lang=en" target="_blank">terms</a> and <a href="/legal/privacy?lang=en" target="_blank">privacy policy</a>.',marketing:'Send me offers (optional).',confirm:'Confirm booking',service:'Service',barber:'Barber',when:'When',price:'Price',done:'Booking confirmed!',requested:'Request sent. The shop will confirm it soon.',doneText:'We sent you a confirmation. You can move or cancel it in the app.',again:'Back to start',min:'min',call:'Call',map:'Open map',hours:'Opening hours',closed:'Closed',days:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],short:['Su','Mo','Tu','We','Th','Fr','Sa'],months:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],consent:'We use statistics cookies only if you agree.',accept:'Accept',refuse:'No, thanks',getApp:'Get the app',err:'Something went wrong. Please try again.',wrongCode:'Wrong code.',expired:'The code expired. Ask for a new one.',slotTaken:'That time was just taken. Pick another.',badPhone:'The phone number looks wrong.',emailMismatch:'This is not the e-mail on the account.',emailMissing:'The account has no e-mail; please contact the shop.',tooMany:'You asked for a code recently. Try again in a minute.',fill:'Please fill in all fields.',emailInUse:'This e-mail is used by another account.'},
fr:{welcome:'Bienvenue',book:'Prendre rendez-vous',barbers:'Barbiers',services:'Services',contact:'Contact',links:'Mes liens',chooseService:'Choisissez un service',chooseBarber:'Choisissez un barbier',any:'N’importe quel barbier',anyHint:'Premier créneau libre',chooseTime:'Choisissez le jour et l’heure',noSlots:'Aucun créneau ce jour-là. Essayez un autre jour.',yourData:'Vos coordonnées',phone:'Téléphone',email:'E-mail',sendCode:'Envoyer le code',code:'Code reçu',codeSentTo:'Code envoyé à ',name:'Nom et prénom',birth:'Date de naissance',terms:'J’accepte les <a href="/legal/terms?lang=fr" target="_blank">conditions</a> et la <a href="/legal/privacy?lang=fr" target="_blank">politique de confidentialité</a>.',marketing:'Je veux recevoir des offres (facultatif).',confirm:'Confirmer le rendez-vous',service:'Service',barber:'Barbier',when:'Quand',price:'Prix',done:'Rendez-vous confirmé !',requested:'Demande envoyée. Le salon la confirmera bientôt.',doneText:'Nous vous avons envoyé une confirmation. Vous pouvez le déplacer ou l’annuler dans l’app.',again:'Retour au début',min:'min',call:'Appeler',map:'Voir la carte',hours:'Horaires',closed:'Fermé',days:['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'],short:['Di','Lu','Ma','Me','Je','Ve','Sa'],months:['janv','févr','mars','avr','mai','juin','juil','août','sept','oct','nov','déc'],consent:'Nous utilisons des cookies de statistiques seulement avec votre accord.',accept:'Accepter',refuse:'Non merci',getApp:'Télécharger l’app',err:'Un problème est survenu. Réessayez.',wrongCode:'Code incorrect.',expired:'Le code a expiré. Demandez-en un autre.',slotTaken:'Ce créneau vient d’être pris. Choisissez-en un autre.',badPhone:'Le numéro semble incorrect.',emailMismatch:'Cet e-mail n’est pas celui du compte.',emailMissing:'Le compte n’a pas d’e-mail ; contactez le salon.',tooMany:'Vous avez demandé un code récemment. Réessayez dans une minute.',fill:'Remplissez tous les champs.',emailInUse:'Cet e-mail est déjà utilisé.'}
};
var ICON={book:'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4M12 13v4M10 15h4',barbers:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M17 4l3 3-8 8',services:'M6 3v18M6 8h5a3 3 0 0 0 0-6H6M14 14l6 6M20 14l-6 6',contact:'M4 5h16v12H4zM4 6l8 6 8-6',links:'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1'};
var lang=pickLang(),view='home',data={},sel={},token=null,history=[];
function pickLang(){var q=new URLSearchParams(location.search).get('lang');var saved=null;try{saved=localStorage.getItem('taf-site-lang')}catch(e){}var l=S.preview?W.defaultLang:q||saved||(navigator.language||'').slice(0,2);return W.languages.indexOf(l)>=0?l:W.defaultLang}
function t(k){return (T[lang]||T.ro)[k]}
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return'&#'+c.charCodeAt(0)+';'})}
function on(hex){var n=parseInt(hex.slice(1),16);return (0.299*(n>>16&255)+0.587*(n>>8&255)+0.114*(n&255))>150?'#000000':'#FFFFFF'}
function mix(hex,k){var n=parseInt(hex.slice(1),16);return'#'+[n>>16&255,n>>8&255,n&255].map(function(x){return Math.round(x+(255-x)*k).toString(16).padStart(2,'0')}).join('')}
function theme(){var r=document.documentElement.style;r.setProperty('--bg',W.background);r.setProperty('--text',W.text);r.setProperty('--accent',W.accent);r.setProperty('--on',W.buttonText||on(W.accent));r.setProperty('--card',mix(W.background,.08));r.setProperty('--card2',mix(W.background,.16));r.setProperty('--line',mix(W.background,.25));r.setProperty('--bgimg',W.backgroundImage?'url("'+W.backgroundImage+'")':'none');r.setProperty('--dim',W.backgroundImage?W.backgroundDim/100:0);document.documentElement.lang=lang}
function api(m,p,b){var h={'content-type':'application/json'};if(token)h.authorization='Bearer '+token;return fetch('/v1'+p+(p.indexOf('?')>=0?'&':'?')+'lang='+lang,{method:m,headers:h,body:b?JSON.stringify(b):undefined}).then(function(r){return r.json().catch(function(){return null}).then(function(j){if(!r.ok)throw new Error((j&&j.error)||'server_error');return j})})}
function load(k,p){if(data[k])return Promise.resolve(data[k]);return api('GET',p).then(function(x){data[k]=x;return x})}
function svg(k){return W.showIcons&&ICON[k]?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+ICON[k]+'"/></svg>':''}
function header(title){var langs=W.languages.length>1?'<select id="lang" aria-label="Language">'+W.languages.map(function(l){return'<option value="'+l+'"'+(l===lang?' selected':'')+'>'+l.toUpperCase()+'</option>'}).join('')+'</select>':'';return'<header>'+(view!=='home'?'<button class="back" id="back" aria-label="Back">‹</button>':'')+'<span>'+e(title)+'</span>'+langs+'</header>'}
function money(v){return (v%1?v.toFixed(2):v)+' lei'}
function svcPrice(s){if(s.offer&&s.offer.percent){var p=Math.round(s.price*(100-s.offer.percent)/100);return'<span class="old">'+money(s.price)+'</span>'+money(p)}return money(s.price)}
function avatar(b){return b.photoUrl?'<img class="av" src="'+e(b.photoUrl)+'" alt="">':'<div class="av">'+e(b.initials||'')+'</div>'}
function dayLabel(d){var x=new Date(d+'T12:00:00');return t('days')[x.getDay()]+', '+x.getDate()+' '+t('months')[x.getMonth()]}
function time(iso){return new Date(iso).toLocaleTimeString(lang==='en'?'en-GB':lang,{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Bucharest'})}
function today(){return new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Bucharest'})}
function addDays(d,n){var x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)}
function go(v){history.push(view);view=v;render();scrollTo(0,0)}
function back(){view=history.pop()||'home';render()}
function home(){var logo=W.logoUrl||S.appLogo;var items=[];if(W.sections.booking)items.push(['book','book']);if(W.sections.barbers)items.push(['barbers','barbers']);if(W.sections.services)items.push(['services','services']);if(W.sections.contact)items.push(['contact','contact']);if(W.sections.links&&W.links.length)items.push(['links','links']);
var h=(logo?'<img class="logo" src="'+e(logo)+'" alt="'+e(S.biz.name)+'">':'<div class="title">'+e(S.biz.name)+'</div>')+'<div class="menu'+(W.layout==='tiles'?' tiles':'')+'">'+items.map(function(i){return'<button class="mb" data-go="'+i[0]+'">'+svg(i[1])+'<span>'+t(i[1])+'</span><i>›</i></button>'}).join('')+'</div>';
if(W.sections.apps)h+='<div class="stores"><a href="'+S.stores.appStore+'" target="_blank" rel="noopener">App Store</a><a href="'+S.stores.play+'" target="_blank" rel="noopener">Google Play</a></div>';return h}
function services(pick){return load('services','/services').then(function(list){return'<h2>'+(pick?t('chooseService'):t('services'))+'</h2>'+list.map(function(s){return'<button class="card pick row" '+(pick?'data-svc="'+e(s.id)+'"':'disabled style="cursor:default"')+'>'+(s.imageUrl?'<img class="av" src="'+e(s.imageUrl)+'" alt="">':'')+'<div class="grow"><b>'+e(s.name)+'</b><div class="muted">'+s.durationMin+' '+t('min')+(s.description?' · '+e(s.description):'')+'</div></div><div class="price">'+svcPrice(s)+'</div></button>'}).join('')})}
function barbers(pick){return load('barbers','/barbers').then(function(list){if(pick)list=list.filter(function(b){return b.serviceIds.indexOf(sel.service.id)>=0});var h='<h2>'+(pick?t('chooseBarber'):t('barbers'))+'</h2>';if(pick)h+='<button class="card pick row" data-barber=""><div class="av">★</div><div class="grow"><b>'+t('any')+'</b><div class="muted">'+t('anyHint')+'</div></div></button>';return h+list.map(function(b){return'<button class="card pick row'+(pick?'':' big')+'" '+(pick?'data-barber="'+e(b.id)+'"':'disabled style="cursor:default"')+'>'+avatar(b)+'<div class="grow"><b>'+e(b.name)+'</b><div class="muted">'+e(b.role||'')+'</div>'+(!pick&&b.bio?'<div class="muted" style="margin-top:6px">'+e(b.bio)+'</div>':'')+'</div></button>'}).join('')})}
function times(){var d=sel.day||today();var days=[];for(var i=0;i<21;i++)days.push(addDays(today(),i));var q='/availability?serviceId='+encodeURIComponent(sel.service.id)+'&day='+d+(sel.barber?'&barberId='+encodeURIComponent(sel.barber.id):'');
return api('GET',q).then(function(slots){sel._slots=slots;return'<h2>'+t('chooseTime')+'</h2><div class="days">'+days.map(function(x){var o=new Date(x+'T12:00:00');return'<button class="day'+(x===d?' on':'')+'" data-day="'+x+'"><small>'+t('short')[o.getDay()]+'</small><b>'+o.getDate()+'</b><small>'+t('months')[o.getMonth()]+'</small></button>'}).join('')+'</div><p class="muted">'+dayLabel(d)+'</p>'+(slots.length?'<div class="slots">'+slots.map(function(s,i){return'<button class="slot" data-slot="'+i+'">'+time(s.start)+'</button>'}).join('')+'</div>':'<p class="muted">'+t('noSlots')+'</p>');}).then(null,function(){return'<p class="err">'+t('err')+'</p>'})}
function summary(){var b=sel.barber||((data.barbers||[]).filter(function(x){return x.id===sel.slot.barberId})[0])||{};return'<div class="card sum"><div class="row"><span>'+t('service')+'</span><b>'+e(sel.service.name)+'</b></div><div class="row"><span>'+t('barber')+'</span><b>'+e(b.name||'')+'</b></div><div class="row"><span>'+t('when')+'</span><b>'+dayLabel(sel.day||today())+', '+time(sel.slot.start)+'</b></div><div class="row"><span>'+t('price')+'</span><b class="price">'+svcPrice(sel.service)+'</b></div></div>'}
function details(){if(token)return summary()+'<button class="btn" id="confirm">'+t('confirm')+'</button><p class="err" id="msg"></p>';var h=summary()+'<h2>'+t('yourData')+'</h2><div id="f1"><label class="f">'+t('phone')+'<input id="phone" type="tel" autocomplete="tel" placeholder="07xx xxx xxx"></label>'+(S.otpSms?'':'<label class="f">'+t('email')+'<input id="email" type="email" autocomplete="email"></label>')+'<button class="btn" id="send">'+t('sendCode')+'</button></div><div id="f2" hidden><p class="muted ok" id="sent"></p><label class="f">'+t('code')+'<input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label><div id="newacc" hidden><label class="f">'+t('name')+'<input id="name" autocomplete="name"></label>'+(S.otpSms?'<label class="f">'+t('email')+'<input id="email2" type="email" autocomplete="email"></label>':'')+'<label class="f">'+t('birth')+'<input id="birth" type="date"></label><label class="check"><input type="checkbox" id="terms"><span>'+t('terms')+'</span></label><label class="check"><input type="checkbox" id="mk"><span>'+t('marketing')+'</span></label></div><button class="btn" id="confirm">'+t('confirm')+'</button></div><p class="err" id="msg"></p>';return h}
var ERR={wrong_code:'wrongCode',code_expired:'expired',slot_unavailable:'slotTaken',too_many_active_bookings:'err',invalid_phone:'badPhone',email_mismatch:'emailMismatch',email_not_on_account:'emailMissing',too_many_requests:'tooMany',terms_required:'fill',birth_date_required:'fill',email_required:'fill',email_in_use:'emailInUse'};
function fail(x){var m=document.getElementById('msg');if(m)m.textContent=t(ERR[x&&x.message]||'err')}
function bindDetails(){var phone='',isNew=false;var $=function(i){return document.getElementById(i)};
if($('send'))$('send').onclick=function(){$('msg').textContent='';this.disabled=true;var me=this;var body={phone:$('phone').value,channel:S.otpSms?'sms':'email'};if(!S.otpSms)body.email=$('email').value.trim();api('POST','/auth/otp',body).then(function(r){phone=r.phone;isNew=r.newAccount;$('f1').hidden=true;$('f2').hidden=false;$('newacc').hidden=!isNew;$('sent').textContent=t('codeSentTo')+r.sentTo+(r.devCode?' ('+r.devCode+')':'');},fail).then(function(){me.disabled=false})};
$('confirm').onclick=function(){$('msg').textContent='';var me=this;var body={phone:phone,code:token?'':$('code').value.trim(),lang:lang};if(isNew&&!token){body.name=$('name').value.trim();body.birthDate=$('birth').value;body.acceptTerms=$('terms').checked;body.marketing=$('mk').checked;if(S.otpSms)body.email=$('email2').value.trim();if(!body.name||!body.birthDate||!body.acceptTerms){$('msg').textContent=t('fill');return}}me.disabled=true;
(token?Promise.resolve({token:token}):api('POST','/auth/verify',body)).then(function(v){token=v.token;return api('POST','/bookings',{serviceId:sel.service.id,barberId:sel.barber?sel.barber.id:sel.slot.barberId,start:sel.slot.start,note:'Programare de pe site'})}).then(function(b){sel.result=b;history=[];view='done';render()},function(x){if(x&&x.message==='slot_unavailable'){sel.slot=null;history.pop();view='pickTime';render();setTimeout(function(){alert(t('slotTaken'))},50);return}fail(x);me.disabled=false})}}
function done(){var req=sel.result&&sel.result.status==='requested';return'<div style="text-align:center;margin-top:30px"><div style="font-size:54px">✓</div><h2>'+(req?t('requested'):t('done'))+'</h2>'+summary()+'<p class="muted">'+t('doneText')+'</p><a class="btn" href="'+(/iPhone|iPad/.test(navigator.userAgent)?S.stores.appStore:S.stores.play)+'" target="_blank" rel="noopener">'+t('getApp')+'</a><button class="btn ghost" id="again">'+t('again')+'</button></div>'}
function contact(){return load('biz','/business').then(function(b){var h='<h2>'+t('contact')+'</h2><div class="card"><b>'+e(S.biz.name)+'</b>'+(S.biz.address?'<div class="muted">'+e(S.biz.address)+'</div>':'')+'</div>';if(S.biz.phone)h+='<a class="btn" href="tel:'+e(S.biz.phone.replace(/\s+/g,''))+'">'+t('call')+' '+e(S.biz.phone)+'</a>';if(S.biz.address)h+='<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(S.biz.name+', '+S.biz.address)+'">'+t('map')+'</a>';if(b&&b.hours){h+='<h2 style="margin-top:22px">'+t('hours')+'</h2><div class="card hours">'+[1,2,3,4,5,6,0].map(function(d){var x=b.hours[d];return'<div class="row"><span>'+t('days')[d]+'</span><b>'+(x?x.open+'–'+x.close:t('closed'))+'</b></div>'}).join('')+'</div>'}return h})}
function links(){return'<h2>'+t('links')+'</h2>'+W.links.map(function(l){return'<a class="mb" style="margin-bottom:10px" href="'+e(l.url)+'" target="_blank" rel="noopener">'+svg('links')+'<span>'+e(l.label)+'</span><i>›</i></a>'}).join('')}
function render(){theme();var titles={home:W.welcome[lang]||t('welcome'),services:t('services'),barbers:t('barbers'),contact:t('contact'),links:t('links'),book:t('book'),pickBarber:t('book'),pickTime:t('book'),details:t('book'),done:t('book')};
var body=view==='home'?home():view==='services'?services(false):view==='barbers'?barbers(false):view==='contact'?contact():view==='links'?links():view==='book'?services(true):view==='pickBarber'?barbers(true):view==='pickTime'?times():view==='details'?details():done();
Promise.resolve(body).then(function(h){app.innerHTML='<div class="wrap">'+header(titles[view])+'<main>'+h+'</main><footer>© '+e(S.biz.name)+' · <a href="/legal/privacy?lang='+lang+'">'+(lang==='ro'?'Confidențialitate':lang==='fr'?'Confidentialité':'Privacy')+'</a></footer></div>';wire()},function(){app.innerHTML='<div class="wrap">'+header(titles[view])+'<main><p class="err">'+t('err')+'</p></main></div>';wire()})}
function wire(){var q=function(s){return Array.prototype.slice.call(app.querySelectorAll(s))};var b=document.getElementById('back');if(b)b.onclick=back;var l=document.getElementById('lang');if(l)l.onchange=function(){lang=this.value;try{localStorage.setItem('taf-site-lang',lang)}catch(e){}data={};render()};
q('[data-go]').forEach(function(x){x.onclick=function(){go(x.dataset.go)}});
q('[data-svc]').forEach(function(x){x.onclick=function(){sel={service:data.services.filter(function(s){return s.id===x.dataset.svc})[0]};go('pickBarber')}});
q('[data-barber]').forEach(function(x){x.onclick=function(){sel.barber=x.dataset.barber?data.barbers.filter(function(b){return b.id===x.dataset.barber})[0]:null;sel.day=today();go('pickTime')}});
q('[data-day]').forEach(function(x){x.onclick=function(){sel.day=x.dataset.day;render()}});
q('[data-slot]').forEach(function(x){x.onclick=function(){sel.slot=sel._slots[+x.dataset.slot];load('barbers','/barbers').then(function(){go('details')})}});
if(view==='details')bindDetails();var a=document.getElementById('again');if(a)a.onclick=function(){sel={};view='home';history=[];render()}}
function tracking(){if(S.preview||(!W.tracking.gaId&&!W.tracking.metaPixelId))return;var c=null;try{c=localStorage.getItem('taf-consent')}catch(x){}if(c==='yes')return startTracking();if(c==='no')return;var d=document.createElement('div');d.id='consent';d.innerHTML=e(t('consent'))+' <a href="/legal/privacy?lang='+lang+'" style="color:inherit">›</a><div class="row"><button class="btn" id="cy">'+t('accept')+'</button><button class="btn ghost" id="cn">'+t('refuse')+'</button></div>';document.body.appendChild(d);
document.getElementById('cy').onclick=function(){try{localStorage.setItem('taf-consent','yes')}catch(x){}d.remove();startTracking()};document.getElementById('cn').onclick=function(){try{localStorage.setItem('taf-consent','no')}catch(x){}d.remove()}}
function startTracking(){if(W.tracking.gaId){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+W.tracking.gaId;document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config',W.tracking.gaId)}
if(W.tracking.metaPixelId){!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',W.tracking.metaPixelId);fbq('track','PageView')}}
// Previzualizarea din panou: aspectul nesalvat vine prin postMessage, de la aceeași adresă.
if(S.preview)addEventListener('message',function(ev){if(ev.origin!==location.origin||!ev.data||ev.data.type!=='taf-site')return;W=S.w=ev.data.website;if(W.languages.indexOf(lang)<0)lang=W.defaultLang;if(ev.data.view&&ev.data.view!==view){history=[];view=ev.data.view}render()});
render();tracking();
})();`;

// --- Rutele ---

export const websitePublic = new Hono<AppEnv>();
websitePublic.get('/site', async (c) => c.html(await sitePage(c.env, { preview: c.req.query('preview') === '1' })));

export const websiteAdmin = new Hono<AppEnv>();
websiteAdmin.use('/website', async (c, next) => {
  if (!c.get('admin').owner) throw new HttpError(403, 'owner_only');
  await next();
});
websiteAdmin.get('/website', async (c) => c.json(await getWebsite(c.env)));
websiteAdmin.put('/website', async (c) => c.json(await saveWebsite(c.env, await c.req.json())));
