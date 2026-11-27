import QRCode from 'qrcode';

// Voucherele de reducere de printat (ex. date doamnelor la salon, ca să le cumpere bărbaților voucherul de Crăciun).
// Fiecare cod din serie are voucherul lui, cu codul QR care deschide pagina de cadou cu codul deja completat.
// 4 vouchere pe o foaie A4 (fiecare cât o carte poștală, A6), cu linii de tăiat.

export type VoucherModel = 1 | 2 | 3;
export const VOUCHER_MODELS: Array<{ id: VoucherModel; name: string; hint: string }> = [
  { id: 1, name: 'Negru cu auriu', hint: 'elegant, ca aplicația' },
  { id: 2, name: 'Roșu de Crăciun', hint: 'festiv, cu fulgi' },
  { id: 3, name: 'Crem, minimal', hint: 'luminos, se printează ușor' },
];

export type VoucherInfo = {
  shop: string;
  site: string; // ex. https://app.tafbarbers.ro
  packageName: string | null; // ex. Experiența TAF
  packageItems: string[]; // tuns, aranjarea bărbii…
  packageValue: number | null; // 180
  packagePrice: number | null; // 149.99
  expires: string | null; // 31.12.2026
};

type Code = { code: string; kind: 'percent' | 'fixed'; value: number };

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const money = (n: number) => (n % 1 ? n.toFixed(2).replace('.', ',') : String(n));

function texts(c: Code, i: VoucherInfo) {
  const off = c.kind === 'percent' ? `−${c.value}%` : `−${c.value} lei`;
  let pay = '';
  if (i.packagePrice) {
    const offLei = c.kind === 'percent' ? Math.round((i.packagePrice * c.value) / 100) : c.value;
    pay = money(Math.max(5, Math.round((i.packagePrice - offLei) * 100) / 100));
  }
  const what = i.packageName ? `la voucherul cadou ${i.packageName}` : 'la cardul cadou';
  return { off, pay, what };
}

const CSS = `@page{size:A4;margin:8mm}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:136mm;gap:0;width:194mm;margin:0 auto;page-break-after:always}
.cell{padding:4mm;border:0.2mm dashed #bbb}
.v{height:100%;border-radius:5mm;overflow:hidden;display:flex;flex-direction:column;align-items:center;text-align:center;padding:7mm 6mm 5mm;position:relative}
.k{font-weight:800;letter-spacing:.6mm;font-size:8.5pt}.shop{font-family:Georgia,serif;font-style:italic;font-size:17pt;margin-top:1mm}
.t{font-weight:800;font-size:15pt;line-height:1.15;margin:2.5mm 0 1mm}.off{font-weight:900;font-size:38pt;line-height:1;margin:2mm 0 0}.what{font-size:9.5pt}
.pay{font-size:10pt;margin-top:1.5mm}.pay s{opacity:.65}.pay b{font-size:12pt}
.inc{display:flex;flex-wrap:wrap;justify-content:center;gap:1.5mm;margin:4mm 2mm 0;max-width:80mm}.inc span{font-size:8.5pt;padding:.8mm 2.5mm;border-radius:10mm;border:0.3mm solid currentColor;opacity:.9}
.code{margin-top:auto;display:flex;align-items:center;gap:4mm;text-align:left}.code img{width:25mm;height:25mm;border-radius:2mm;background:#fff;padding:1mm}
.cd{white-space:nowrap;font-family:ui-monospace,Menlo,monospace;font-weight:800;font-size:11.5pt;letter-spacing:.4mm;padding:1.5mm 3mm;border-radius:2mm;display:inline-block}
.how{font-size:7.5pt;line-height:1.35;margin-top:1.5mm;max-width:52mm}.exp{font-size:7pt;opacity:.75;margin-top:1mm}
/* 1: negru cu auriu */
.m1{background:radial-gradient(ellipse at 50% 0%,#3a2708 0%,#0b0b0b 62%,#000 100%);color:#eee;border:0.8mm solid #F9A11B}
.m1 .k,.m1 .shop,.m1 .off{color:#F9A11B}.m1 .cd{border:0.4mm dashed #F9A11B;color:#F9A11B}
/* 2: roșu de Crăciun */
.m2{background:radial-gradient(ellipse at 50% 0%,#b3261e 0%,#7a0f0c 55%,#4a0806 100%);color:#fff7ec;border:0.8mm solid #e9c46a}
.m2:before{content:"❄  ✦  ❄  ✦  ❄  ✦  ❄";position:absolute;top:2mm;left:0;right:0;font-size:8pt;letter-spacing:2mm;color:#e9c46a;opacity:.7}
.m2 .k,.m2 .shop{color:#f6d68b}.m2 .off{color:#fff}.m2 .cd{background:#fff7ec;color:#7a0f0c}
.m1 .inc span{color:#F9A11B}.m2 .inc span{color:#f6d68b}.m3 .inc span{color:#9a7424}
/* 3: crem, minimal */
.m3{background:#fbf6ec;color:#1b1b1b;border:0.5mm solid #c9a24a}
.m3 .k{color:#9a7424}.m3 .shop{color:#1b1b1b}.m3 .off{color:#b07a12}.m3 .cd{border:0.4mm solid #1b1b1b}.m3 .t{font-family:Georgia,serif;font-weight:700}
@media screen{body{background:#ddd;padding:10mm 0}.sheet{background:#fff;margin-bottom:10mm;box-shadow:0 2mm 8mm rgba(0,0,0,.2)}.bar{position:sticky;top:0;text-align:center;padding:3mm;background:#111;color:#eee;font-size:11pt}.bar button{margin-left:4mm;padding:2mm 6mm;font-weight:700;border-radius:2mm;border:0;background:#F9A11B;cursor:pointer}}
@media print{.bar{display:none}}`;

async function card(m: VoucherModel, c: Code, i: VoucherInfo) {
  const url = `${i.site}/cadou?cod=${encodeURIComponent(c.code)}`;
  const qr = await QRCode.toDataURL(url, { width: 400, margin: 1, errorCorrectionLevel: 'M' });
  const t = texts(c, i);
  const site = i.site.replace(/^https?:\/\//, '');
  return `<div class="cell"><div class="v m${m}">
<div class="k">${m === 2 ? 'DE CRĂCIUN, PENTRU EL' : 'PENTRU EL · DE CRĂCIUN'}</div><div class="shop">${esc(i.shop)}</div>
<div class="t">${i.packageName ? `Fă-i cadou ${esc(i.packageName)}` : 'Fă-i cadou o vizită la noi'}</div>
<div class="off">${esc(t.off)}</div><div class="what">${esc(t.what)}</div>
${t.pay && i.packageValue && i.packagePrice ? `<div class="pay">în loc de <s>${money(i.packagePrice)} lei</s> plătești doar <b>${t.pay} lei</b></div><div class="exp">valoarea pachetului la salon: ${money(i.packageValue)} lei</div>` : ''}
${i.packageItems.length ? `<div class="inc">${i.packageItems.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
<div class="code"><img src="${qr}" alt=""><div><div class="cd">${esc(c.code)}</div>
<div class="how">Scanează codul sau intră pe ${esc(site)}/cadou și scrie codul. Voucherul ajunge pe loc, gata de dăruit.</div>
${i.expires ? `<div class="exp">Codul e valabil până pe ${esc(i.expires)}.</div>` : ''}</div></div></div></div>`;
}

/** Deschide fereastra de printare. Fereastra se deschide înainte de calcule, ca browserul să nu o blocheze. */
export async function printPromoVouchers(model: VoucherModel, codes: Code[], info: VoucherInfo) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write('<p style="font-family:sans-serif;padding:20px">Se pregătesc voucherele…</p>');
  const cards = await Promise.all(codes.map((c) => card(model, c, info)));
  const sheets: string[] = [];
  for (let k = 0; k < cards.length; k += 4) sheets.push(`<div class="sheet">${cards.slice(k, k + 4).join('')}</div>`);
  w.document.open();
  w.document.write(
    `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Vouchere reducere · ${esc(info.shop)}</title><style>${CSS}</style></head><body>` +
      `<div class="bar">${codes.length} ${codes.length === 1 ? 'voucher' : 'vouchere'}, câte 4 pe foaie A4. Taie pe liniile punctate.<button onclick="print()">Printează</button></div>${sheets.join('')}</body></html>`,
  );
  w.document.close();
  return true;
}
