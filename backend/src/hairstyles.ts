// Tunsorile pe care le poate recomanda consilierul. Lista e fixă ca să aibă fiecare o poză de exemplu (generată o
// singură dată cu AI și păstrată) și ca modelul să nu inventeze nume. Numele rămân cele folosite în frizerii (mai
// ales englezești), cu traducere doar unde există una obișnuită.

export type Hairstyle = { key: string; name: { ro: string; en: string; fr: string }; about: string; look: string };

export const HAIRSTYLES: Hairstyle[] = [
  { key: 'buzz_cut', name: { ro: 'Buzz cut (tuns scurt cu mașina)', en: 'Buzz cut', fr: 'Coupe rasée (buzz cut)' }, about: 'very short all over, one clipper length', look: 'a short even buzz cut, same clipper length all over' },
  { key: 'crew_cut', name: { ro: 'Crew cut', en: 'Crew cut', fr: 'Coupe en brosse (crew cut)' }, about: 'short sides, slightly longer top, low maintenance', look: 'a classic crew cut, short tapered sides and a short top slightly longer at the front' },
  { key: 'french_crop', name: { ro: 'French crop', en: 'French crop', fr: 'French crop' }, about: 'short textured top with a straight short fringe, faded sides; hides a high hairline', look: 'a French crop haircut with a short blunt fringe, textured top and skin fade sides' },
  { key: 'textured_crop', name: { ro: 'Crop texturat', en: 'Textured crop', fr: 'Crop texturé' }, about: 'messy textured top pushed forward, short sides; adds volume to thin or straight hair', look: 'a textured crop haircut, choppy messy top pushed forward, mid fade sides' },
  { key: 'low_fade', name: { ro: 'Low fade', en: 'Low fade', fr: 'Dégradé bas (low fade)' }, about: 'discreet fade starting just above the ears, top any length', look: 'a low fade haircut, fade starting just above the ears, medium length combed top' },
  { key: 'mid_fade', name: { ro: 'Mid fade', en: 'Mid fade', fr: 'Dégradé moyen (mid fade)' }, about: 'fade to the temples, balanced and modern', look: 'a mid fade haircut, fade up to the temples, short textured top' },
  { key: 'skin_fade', name: { ro: 'Skin fade (high fade)', en: 'Skin fade (high fade)', fr: 'Dégradé américain (skin fade)' }, about: 'sides faded to the skin high up; slims a round face, makes the top look taller', look: 'a high skin fade haircut, sides shaved to the skin high up, short neat top' },
  { key: 'taper', name: { ro: 'Taper clasic', en: 'Classic taper', fr: 'Taper classique' }, about: 'gradual shortening only at the sideburns and neckline, office-friendly', look: 'a classic taper haircut, natural gradual shortening at sideburns and neckline, combed top' },
  { key: 'side_part', name: { ro: 'Side part (cărare laterală)', en: 'Side part', fr: 'Raie sur le côté' }, about: 'combed to one side with a clear part, elegant; suits straight hair and oval or square faces', look: 'a side part haircut, hair neatly combed to one side with a defined part line, tapered sides' },
  { key: 'quiff', name: { ro: 'Quiff', en: 'Quiff', fr: 'Quiff (houppe)' }, about: 'volume at the front styled up and back; lengthens a round face', look: 'a modern quiff hairstyle, voluminous front styled up and back, short faded sides' },
  { key: 'pompadour', name: { ro: 'Pompadour', en: 'Pompadour', fr: 'Pompadour' }, about: 'high swept-back volume, needs medium-long top and thick hair', look: 'a pompadour hairstyle, high glossy swept back volume on top, short sides' },
  { key: 'slick_back', name: { ro: 'Slick back (pieptănat pe spate)', en: 'Slick back', fr: 'Coiffé en arrière (slick back)' }, about: 'top combed straight back with product; needs medium length', look: 'a slick back hairstyle, medium length top combed straight back with light shine, tapered sides' },
  { key: 'undercut', name: { ro: 'Undercut', en: 'Undercut', fr: 'Undercut' }, about: 'sides very short with a clear line, long top', look: 'an undercut hairstyle, very short sides disconnected from a long top swept back' },
  { key: 'ivy_league', name: { ro: 'Ivy League', en: 'Ivy League', fr: 'Ivy League' }, about: 'longer crew cut that can be side-parted, clean and versatile', look: 'an Ivy League haircut, short tapered sides and a longer top lightly side parted' },
  { key: 'caesar', name: { ro: 'Caesar', en: 'Caesar cut', fr: 'Coupe César' }, about: 'short even top with a short straight fringe; good for a receding hairline', look: 'a Caesar haircut, short even top with a short straight horizontal fringe, short sides' },
  { key: 'curly_top_fade', name: { ro: 'Bucle sus cu fade', en: 'Curly top with fade', fr: 'Boucles sur le dessus avec dégradé' }, about: 'keeps natural curls or waves on top, faded sides', look: 'a curly top haircut, natural defined curls on top and a mid fade on the sides' },
  { key: 'afro_taper', name: { ro: 'Afro cu taper', en: 'Afro taper', fr: 'Afro avec taper' }, about: 'rounded natural coily top, clean tapered edges', look: 'a rounded natural afro haircut with a clean low taper at the temples and neckline' },
  { key: 'medium_flow', name: { ro: 'Păr mediu lejer (flow)', en: 'Medium flow', fr: 'Mi-long naturel (flow)' }, about: 'medium length pushed back naturally, light layers; suits wavy hair', look: 'a medium length flow hairstyle, wavy hair pushed back naturally to the ears, light layers' },
  { key: 'long_layers', name: { ro: 'Păr lung în straturi', en: 'Long layered hair', fr: 'Cheveux longs dégradés' }, about: 'long hair with layers to remove weight, shoulder length', look: 'long layered mens hair, shoulder length with soft layers' },
  { key: 'modern_mullet', name: { ro: 'Mullet modern', en: 'Modern mullet', fr: 'Mulet moderne' }, about: 'short textured front and sides, longer at the back', look: 'a modern mullet haircut, short textured top and sides with longer hair at the back of the neck' },
];

export const hairstyle = (key: string) => HAIRSTYLES.find((h) => h.key === key);

/** Textul pentru poza de exemplu: o poză de portofoliu de frizerie, fără text sau logo-uri. */
export const stylePrompt = (h: Hairstyle) =>
  `Professional barbershop portfolio photo of a young man with ${h.look}. Three-quarter view of the head, soft studio lighting, plain dark background, photorealistic, sharp focus on the haircut, no text, no logo.`;
