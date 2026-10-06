// Citește un tabel din .xlsx sau .csv direct în browser, fără bibliotecă: prima foaie, ca listă de rânduri cu text.

export async function readTable(file: File): Promise<string[][]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  // Fișierele .xlsx sunt arhive zip („PK”).
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);
  return parseCsv(decodeText(buf));
}

function decodeText(buf: Uint8Array): string {
  const utf = new TextDecoder('utf-8').decode(buf);
  // Excel pe Windows salvează CSV-ul în codarea locală; pentru diacritice încercăm windows-1250.
  const text = utf.includes('�') ? new TextDecoder('windows-1250').decode(buf) : utf;
  return text.replace(/^﻿/, '');
}

export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

async function unzip(buf: Uint8Array): Promise<Map<string, () => Promise<string>>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Fișierul Excel pare stricat.');
  const entries = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map<string, () => Promise<string>>();
  for (let n = 0; n < entries; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    files.set(name, async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = buf.slice(start, start + size);
      if (method === 0) return new TextDecoder().decode(data);
      if (method !== 8) throw new Error('Fișierul Excel folosește o compresie necunoscută.');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function readXlsx(buf: Uint8Array): Promise<string[][]> {
  const files = await unzip(buf);
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) {
    for (const si of Array.from(xml(await ss()).getElementsByTagName('si'))) {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
    }
  }
  // Prima foaie din registru, după relații; dacă lipsesc, prima foaie găsită.
  let sheetPath = '';
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = xml(await wb()).getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = Array.from(xml(await rels()).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target') ?? '';
    sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  if (!files.has(sheetPath)) sheetPath = [...files.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0] ?? '';
  const sheet = files.get(sheetPath);
  if (!sheet) throw new Error('Nu am găsit nicio foaie în fișierul Excel.');
  const rows: string[][] = [];
  for (const r of Array.from(xml(await sheet()).getElementsByTagName('row'))) {
    const row: string[] = [];
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r') ?? '';
      const col = colIndex(ref.replace(/\d+/g, '')) ?? row.length;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let val = v;
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('');
      else if (t === 'b') val = v === '1' ? 'da' : 'nu';
      while (row.length < col) row.push('');
      row[col] = val;
    }
    if (row.some((x) => x.trim() !== '')) rows.push(row);
  }
  return rows;
}

function colIndex(letters: string): number | null {
  if (!letters) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel ține datele ca număr de zile de la 30.12.1899; le transformăm în AAAA-LL-ZZ. */
export function excelDate(v: string): string {
  if (/^\d{4,5}(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n > 1000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000).toISOString().slice(0, 10);
  }
  return v;
}
