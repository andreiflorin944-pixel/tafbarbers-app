import * as Speech from 'expo-speech';

// Vocea asistentului: cea mai bună voce a telefonului pentru limba aleasă (pe iPhone, varianta „îmbunătățită” sau
// „premium”, dacă e descărcată), puțin mai lentă decât cea standard, ca să sune mai cald și mai liniștit.
const SPEECH_LANG = { ro: 'ro-RO', en: 'en-GB', fr: 'fr-FR' } as const;
type Lang = keyof typeof SPEECH_LANG;

const chosen = new Map<Lang, string | null>();

async function voiceFor(lang: Lang): Promise<string | null> {
  if (chosen.has(lang)) return chosen.get(lang)!;
  let id: string | null = null;
  try {
    const want = SPEECH_LANG[lang].toLowerCase();
    const prefix = want.slice(0, 2);
    const all = await Speech.getAvailableVoicesAsync();
    const same = all.filter((v) => v.language?.toLowerCase().replace('_', '-').startsWith(prefix));
    const score = (v: Speech.Voice) =>
      (v.quality === Speech.VoiceQuality.Enhanced ? 10 : 0) +
      (/premium/i.test(v.identifier) ? 5 : 0) +
      (v.language.toLowerCase().replace('_', '-') === want ? 2 : 0) +
      // Vocile „novelty” ale iPhone-ului (Bells, Whisper, Zarvox…) nu sunt pentru conversație.
      (/eloquence|speech\.synthesis\.voice\./i.test(v.identifier) ? -20 : 0);
    id = same.sort((a, b) => score(b) - score(a))[0]?.identifier ?? null;
  } catch {
    id = null;
  }
  chosen.set(lang, id);
  return id;
}

export async function say(text: string, lang: Lang) {
  const voice = await voiceFor(lang);
  Speech.speak(text, { language: SPEECH_LANG[lang], ...(voice ? { voice } : {}), rate: 0.92, pitch: 1.0 });
}

export const stopSpeaking = () => void Speech.stop();
