/** Link de WhatsApp pentru numărul salonului: wa.me vrea numărul internațional, fără + și fără spații (07xx → 407xx). */
export function whatsappUrl(phone: string): string | null {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `40${d.slice(1)}`;
  return d.length >= 10 ? `https://wa.me/${d}` : null;
}

/** Linkurile complete spre rețele, din setările salonului (pot fi scrise ca „@tafbarbers” sau ca link). */
export function socialUrl(kind: 'facebook' | 'instagram' | 'tiktok', value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(www\.)?(instagram|facebook|tiktok)\.com\//i.test(v)) return `https://${v}`;
  const name = v.replace(/^@/, '');
  return kind === 'tiktok' ? `https://www.tiktok.com/@${name}` : `https://www.${kind}.com/${name}`;
}
