import * as Linking from 'expo-linking';
import { useEffect } from 'react';
import { api } from '@/api';
import { clearQr, rememberQr } from '@/lib/campaign';
import { useApp } from '@/state/AppState';

/** Aplicația deschisă dintr-un cod QR (tafbarbers://...?qr=cod): clientul din cont e numărat pe loc, ceilalți la intrarea în cont. */
export function QrLink() {
  const url = Linking.useURL();
  const { token, sessionReady } = useApp();
  useEffect(() => {
    if (!url || !sessionReady) return;
    const raw = Linking.parse(url).queryParams?.qr;
    const code = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!/^[a-z0-9]{3,20}$/.test(code)) return;
    if (token) api.qrOpen(token, code).then(clearQr, () => rememberQr(code));
    else void rememberQr(code);
  }, [url, token, sessionReady]);
  return null;
}
