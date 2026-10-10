import { ApiError } from '@/api/client';
import { hasKey, tr } from '@/i18n';

// Mesajele pentru codurile de eroare de la server sunt în src/i18n.tsx (cheile „err.<cod>”), în limba aleasă în aplicație.

/** Mesaj pe înțelesul clientului pentru o eroare de la server, în limba aplicației. */
export function errorMessage(e: unknown, fallback?: string): string {
  const k = e instanceof ApiError ? `err.${e.code}` : '';
  return hasKey(k) ? tr(k) : (fallback ?? tr('err.generic'));
}
