/** Link de WhatsApp pentru numărul salonului: wa.me vrea numărul internațional, fără + și fără spații (07xx → 407xx). */
export function whatsappUrl(phone: string): string | null {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `40${d.slice(1)}`;
  return d.length >= 10 ? `https://wa.me/${d}` : null;
}
