import { Hono } from 'hono';
import { getSetting, setSetting } from './db';
import { HttpError, type AppEnv, type Env } from './env';
import { seal, unseal } from './social';
import { getWebsite, type Website } from './website';

// Statistici despre vizitatori (unde stau cel mai mult, pe ce apasă), cu codurile puse de proprietar în
// Panou → Site web → Statistici și reclame:
//  • pe site (tafbarbers.ro, app.…, /cont, /cadou, paginile /servicii, /frizeri…): Google Analytics 4, Microsoft Clarity
//    (hărți de clicuri și înregistrări ale vizitei), Google Ads, Meta Pixel, TikTok Pixel. Toate pornesc DOAR după „Accept”
//    în bannerul de cookie-uri (GDPR, Legea 506/2004); acordul dat o dată ține pe toate paginile site-ului.
//  • în aplicație: ecranele deschise, cât timp stă clientul pe fiecare și câteva apăsări importante, trimise prin serverul
//    nostru la Google Analytics (Measurement Protocol), doar dacă clientul a spus „Da” în aplicație. Cheia secretă stă
//    criptată la noi, nu în aplicație.

export const hasSiteTracking = (t: Website['tracking']) => !!(t.gaId || t.googleAdsId || t.metaPixelId || t.tiktokPixelId || t.clarityId);

/** Codul din browser: bannerul de acord + pornirea scripturilor + paginile vizitate + clicurile. Expune window.tafTrack. */
const TRACKING_JS = String.raw`(function(){
var TR=window.TAF_TR||{},on=false,cur=null,L=(document.documentElement.lang||'ro').slice(0,2);
var TX={ro:['Folosim cookie-uri de statistică și publicitate doar dacă ești de acord.','Accept','Nu, mulțumesc','Cookie-uri'],
en:['We use statistics and advertising cookies only if you agree.','Accept','No, thanks','Cookies'],
fr:['Nous utilisons des cookies de statistiques et de publicité seulement avec votre accord.','Accepter','Non merci','Cookies'],
ar:['نستخدم ملفات تعريف الارتباط للإحصاءات والإعلانات فقط إذا وافقت.','موافق','لا، شكراً','ملفات تعريف الارتباط']};
function tx(i){return(TX[L]||TX.ro)[i]}
var has=!!(TR.gaId||TR.googleAdsId||TR.metaPixelId||TR.tiktokPixelId||TR.clarityId);
function get(){try{return localStorage.getItem('taf-consent')}catch(x){return null}}
function put(v){try{if(v)localStorage.setItem('taf-consent',v);else localStorage.removeItem('taf-consent')}catch(x){}}
function add(src){var s=document.createElement('script');s.async=true;s.src=src;document.head.appendChild(s)}
function ask(){if(document.getElementById('taf-consent'))return;var d=document.createElement('div');d.id='taf-consent';d.setAttribute('role','dialog');
d.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;max-width:500px;margin:0 auto;background:#1f2023;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:14px;padding:14px;font:14px/1.4 system-ui,-apple-system,sans-serif;z-index:2147483000;box-shadow:0 6px 30px rgba(0,0,0,.45)';
var b='min-height:42px;padding:8px 14px;border-radius:10px;font:600 15px system-ui,-apple-system,sans-serif;cursor:pointer;flex:1;';
d.innerHTML='<span></span> <a href="/legal/privacy?lang='+L+'" style="color:inherit">›</a><div style="display:flex;gap:10px;margin-top:10px"><button type="button" id="taf-cy" style="'+b+'background:#F5C542;color:#111;border:0">'+tx(1)+'</button><button type="button" id="taf-cn" style="'+b+'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.3)">'+tx(2)+'</button></div>';
d.firstChild.textContent=tx(0);document.body.appendChild(d);
document.getElementById('taf-cy').onclick=function(){put('yes');d.remove();start()};document.getElementById('taf-cn').onclick=function(){put('no');d.remove()}}
function start(){if(on)return;on=true;var g=TR.gaId||TR.googleAdsId;
if(g){add('https://www.googletagmanager.com/gtag/js?id='+g);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'});gtag('js',new Date());if(TR.gaId)gtag('config',TR.gaId,{send_page_view:false});if(TR.googleAdsId)gtag('config',TR.googleAdsId)}
if(TR.clarityId){(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,'clarity','script',TR.clarityId);clarity('consentv2',{ad_Storage:TR.googleAdsId||TR.metaPixelId||TR.tiktokPixelId?'granted':'denied',analytics_Storage:'granted'})}
if(TR.metaPixelId){!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',TR.metaPixelId);fbq('track','PageView')}
if(TR.tiktokPixelId){!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var r='https://analytics.tiktok.com/i18n/pixel/events.js';ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};add(r+'?sdkid='+e+'&lib='+t)}}(window,document,'ttq');ttq.load(TR.tiktokPixelId);ttq.page()}
var c=cur;cur=null;page(c?c.name:'',c?c.title:document.title)}
// Pagina (sau ecranul de pe site-ul cu butoane) văzută acum. Pe site-ul cu butoane adresa primește #/ecran, ca hărțile
// de clicuri din Clarity să fie separate pe ecrane; în Google Analytics apare ca /ecran/<nume>.
function page(name,title){name=name||'';if(cur&&cur.name===name)return;cur={name:name,title:title||document.title};if(!on)return;
var path=name?'/ecran/'+name:location.pathname;
if(TR.spa&&TR.clarityId){try{window.history.replaceState(window.history.state,'',location.pathname+location.search+(name?'#/'+name:''))}catch(x){}}
try{if(window.gtag&&TR.gaId)gtag('event','page_view',{send_to:TR.gaId,page_location:location.origin+path,page_title:cur.title});if(window.clarity&&name)clarity('set','ecran',name)}catch(x){}}
function event(n,p){if(!on)return;try{if(window.gtag&&TR.gaId)gtag('event',n,Object.assign({send_to:TR.gaId},p||{}));if(window.clarity)clarity('event',n)}catch(x){}}
// Fiecare apăsare pe un buton sau link: textul butonului și ecranul (fără ce scrie clientul în câmpuri).
document.addEventListener('click',function(ev){if(!on||!TR.gaId)return;var el=ev.target&&ev.target.closest&&ev.target.closest('a,button,[role=button],[data-go],[data-tab]');if(!el||el.closest('#taf-consent'))return;
var txt=(el.getAttribute('aria-label')||el.textContent||el.getAttribute('title')||'').replace(/\s+/g,' ').trim().slice(0,80);var p={link_text:txt||'(fără text)',ecran:cur&&cur.name||location.pathname};if(el.href)p.link_url=String(el.href).slice(0,200);event('clic_buton',p)},true);
function settings(){var was=get();put(null);if(was==='yes')return location.reload();ask()}
// Linkul „Cookie-uri” în subsolul paginilor simple (site-ul cu butoane îl pune singur).
function link(){if(TR.spa)return;var f=document.querySelector('footer');if(!f)return;var a=document.createElement('a');a.href='#';a.textContent=tx(3);a.style.color='inherit';a.onclick=function(e){e.preventDefault();settings()};f.appendChild(document.createTextNode(' · '));f.appendChild(a)}
window.tafTrack={has:has,get on(){return on},page:page,event:event,settings:settings};
if(!has)return;link();var c=get();if(c==='yes')start();else if(c!=='no')ask();if(!TR.spa)page('',document.title)})();`;

/** Codurile publice din panou (fără nimic secret), pentru browser. */
const publicCodes = (t: Website['tracking'], spa: boolean) => ({
  gaId: t.gaId,
  googleAdsId: t.googleAdsId,
  metaPixelId: t.metaPixelId,
  tiktokPixelId: t.tiktokPixelId,
  clarityId: t.clarityId,
  spa,
});

/** Scripturile de pus înainte de </body> pe orice pagină a site-ului. Gol dacă nu e pus niciun cod în panou. */
export function trackingTagFor(t: Website['tracking'], spa = false): string {
  if (!hasSiteTracking(t)) return spa ? '<script>window.tafTrack={has:false,on:false,page:function(){},event:function(){},settings:function(){}}</script>' : '';
  return `<script>window.TAF_TR=${JSON.stringify(publicCodes(t, spa)).replace(/</g, '\\u003c')};</script><script>${TRACKING_JS}</script>`;
}

export async function trackingTag(env: Env): Promise<string> {
  try {
    return trackingTagFor((await getWebsite(env)).tracking);
  } catch {
    return '';
  }
}

/** Pune scripturile în pagina HTML dată (înainte de </body>). */
export async function withTracking(env: Env, html: string): Promise<string> {
  const tag = await trackingTag(env);
  if (!tag) return html;
  const i = html.lastIndexOf('</body>');
  return i < 0 ? html + tag : html.slice(0, i) + tag + html.slice(i);
}

// --- Aplicația ---

const SECRET_KEY = 'app_analytics_secret';
type Secret = { sealed: string | null };

export async function appAnalyticsSecretSet(env: Env) {
  return !!(await getSetting<Secret>(env, SECRET_KEY, { sealed: null })).sealed;
}

/** Din panou: cheia „API secret” a fluxului Google Analytics pentru aplicație. Șir gol = o păstrăm pe cea veche; null = o ștergem. */
export async function saveAppAnalyticsSecret(env: Env, v: unknown) {
  if (v === null) return setSetting(env, SECRET_KEY, { sealed: null });
  if (typeof v !== 'string' || !v.trim()) return;
  const s = v.trim();
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(s)) throw new HttpError(400, 'invalid_ga_secret');
  await setSetting(env, SECRET_KEY, { sealed: await seal(env, s) });
}

/** Aplicația trimite statistici doar dacă proprietarul a pus în panou și codul G-, și cheia API secret. */
export async function appAnalyticsOn(env: Env) {
  const w = await getWebsite(env);
  return !!(w.tracking.appGaId && (await appAnalyticsSecretSet(env)));
}

const EVENT = /^[a-z][a-z0-9_]{1,39}$/;
const RESERVED = new Set(['ad_activeview', 'ad_click', 'ad_exposure', 'ad_query', 'adunit_exposure', 'app_clear_data', 'app_install', 'app_remove', 'app_update', 'error', 'first_open', 'first_visit', 'in_app_purchase', 'notification_dismiss', 'notification_foreground', 'notification_open', 'notification_receive', 'os_update', 'session_start', 'screen_view', 'user_engagement_reserved']);

export const analyticsPublic = new Hono<AppEnv>();

/**
 * Aplicația trimite aici, la câteva secunde, ce ecrane s-au deschis și cât s-a stat pe ele. Le dăm mai departe la
 * Google Analytics. Nu trimitem numele, telefonul sau contul clientului: doar un număr la întâmplare al telefonului.
 */
analyticsPublic.post('/analytics', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { cid?: unknown; sid?: unknown; platform?: unknown; version?: unknown; lang?: unknown; events?: unknown } | null;
  if (!b || typeof b.cid !== 'string' || !/^[A-Za-z0-9.-]{8,64}$/.test(b.cid) || !Array.isArray(b.events)) throw new HttpError(400, 'bad_request');
  const w = await getWebsite(c.env);
  const sec = await getSetting<Secret>(c.env, SECRET_KEY, { sealed: null });
  if (!w.tracking.appGaId || !sec.sealed) return c.json({ ok: false, off: true });
  const sid = Number(b.sid);
  const platform = b.platform === 'ios' || b.platform === 'android' ? b.platform : 'other';
  const events = b.events
    .slice(0, 25)
    .filter((e): e is { name: string; params?: Record<string, unknown>; t?: number } => !!e && typeof e === 'object' && typeof (e as { name?: unknown }).name === 'string')
    .filter((e) => EVENT.test(e.name) && !RESERVED.has(e.name))
    .map((e) => {
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(e.params ?? {}).slice(0, 20)) {
        if (!EVENT.test(k)) continue;
        if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
        else if (typeof v === 'string') params[k] = v.slice(0, 100);
      }
      if (Number.isFinite(sid) && sid > 0) params.session_id = Math.floor(sid);
      if (typeof params.engagement_time_msec !== 'number') params.engagement_time_msec = 1;
      params.platforma = platform;
      if (typeof b.version === 'string') params.app_version = b.version.slice(0, 30);
      return { name: e.name, params };
    });
  if (!events.length) return c.json({ ok: true });
  const cf = (c.req.raw as { cf?: { country?: string; city?: string; region?: string } }).cf;
  const body = {
    client_id: b.cid,
    // Orașul aproximativ (din rețea), ca în Google Analytics să nu apară toți vizitatorii la serverul Cloudflare.
    ...(cf?.country && { user_location: { country_id: cf.country, ...(cf.city && { city: cf.city }) } }),
    device: { category: 'mobile', operating_system: platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : undefined, language: typeof b.lang === 'string' ? b.lang.slice(0, 5) : undefined },
    events,
  };
  const secret = await unseal(c.env, sec.sealed);
  const url = `https://region1.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(w.tracking.appGaId)}&api_secret=${encodeURIComponent(secret)}`;
  c.executionCtx.waitUntil(fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(() => undefined, () => undefined));
  return c.json({ ok: true });
});
