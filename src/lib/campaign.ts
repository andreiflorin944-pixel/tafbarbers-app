import { storage } from '@/lib/storage';

// Codul QR din care a fost deschisă aplicația: îl ținem câteva zile, până omul intră în cont,
// ca să știm din ce campanie a venit.
const KEY = 'taf.qr';
const KEEP_MS = 7 * 86_400_000;

export async function rememberQr(code: string) {
  await storage.set(KEY, JSON.stringify({ code, at: Date.now() }));
}

export async function pendingQr(): Promise<string | undefined> {
  try {
    const v = JSON.parse((await storage.get(KEY)) ?? 'null') as { code?: string; at?: number } | null;
    if (v?.code && Date.now() - (v.at ?? 0) < KEEP_MS) return v.code;
  } catch {
    // Valoare stricată: o ignorăm.
  }
  return undefined;
}

export async function clearQr() {
  await storage.set(KEY, null);
}
