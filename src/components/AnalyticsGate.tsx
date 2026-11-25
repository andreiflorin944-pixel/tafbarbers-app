import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { useT } from '@/i18n';
import { setAnalyticsConsent, setAnalyticsServerOn, trackEvent, trackScreen, useAnalytics } from '@/lib/analytics';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

/**
 * Statisticile anonime din aplicație: spune ce ecran e deschis și, o singură dată, întreabă clientul dacă e de acord
 * (un card jos, care nu blochează aplicația, la câteva secunde după pornire). Fără „Da”, nu se trimite nimic.
 */
export function AnalyticsGate() {
  const { t } = useT();
  const path = usePathname();
  const { business } = useApp();
  const { ask } = useAnalytics();
  const insets = useSafeAreaInsets();
  const [late, setLate] = useState(false);

  useEffect(() => setAnalyticsServerOn(!!business?.analytics), [business?.analytics]);
  useEffect(() => {
    trackScreen(path);
    // Programarea făcută = „conversia” (Google Analytics o arată ca eveniment cheie).
    if (path === '/book/success') trackEvent('generate_lead');
  }, [path]);
  useEffect(() => {
    const id = setTimeout(() => setLate(true), 12_000);
    return () => clearTimeout(id);
  }, []);

  if (!ask || !late || path.startsWith('/staff') || path.startsWith('/legal') || path.startsWith('/login') || path.startsWith('/book')) return null;
  return (
    <View style={[s.card, { bottom: insets.bottom + 72 }]} accessibilityRole="alert">
      <Text style={s.title}>{t('analytics.askTitle')}</Text>
      <Text style={s.text}>{t('analytics.askText')}</Text>
      <View style={{ gap: space.sm, marginTop: space.sm }}>
        <Button title={t('analytics.yes')} onPress={() => void setAnalyticsConsent('yes').then(() => trackScreen(path))} />
        <Button title={t('analytics.no')} variant="ghost" onPress={() => void setAnalyticsConsent('no')} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  title: { color: colors.text, fontWeight: '700', fontSize: 16 },
  text: { color: colors.muted, fontSize: 14, marginTop: 4 },
});
