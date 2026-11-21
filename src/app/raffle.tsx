import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { api } from '@/api';
import { Button, Card, Screen, styles } from '@/components/ui';
import type { Raffle } from '@/data/types';
import { locale, useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

const short = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

// Tombola săptămânii: premiile, dacă ești înscris, premiile tale și ultimii câștigători (prenume + inițială).
export default function RaffleScreen() {
  const { token } = useApp();
  const { t, lang } = useT();
  const [data, setData] = useState<Raffle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api.getRaffle(token, lang).then(setData, (e) => setError(errorMessage(e)));
    }, [token, lang]),
  );

  if (!data) return <Screen edges={[]}>{error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.gold} />}</Screen>;
  const wins = data.wins ?? [];

  return (
    <Screen edges={['bottom']}>
      {!data.enabled ? (
        <Text style={styles.muted}>{t('raffle.off')}</Text>
      ) : (
        <>
          <Card style={{ alignItems: 'center', gap: space.sm, borderColor: colors.gold }}>
            <Ionicons name="gift" size={34} color={colors.gold} />
            <Text style={[styles.cardTitle, { textAlign: 'center' }]}>{t('raffle.title')}</Text>
            <Text style={[styles.muted, { textAlign: 'center' }]}>{t('raffle.week', { from: short(data.week), to: short(data.weekEnd) })}</Text>
            {!token ? (
              <>
                <Text style={[styles.text, { textAlign: 'center' }]}>{t('raffle.noAccount')}</Text>
                <View style={{ alignSelf: 'stretch' }}>
                  <Button title={t('raffle.signIn')} onPress={() => router.push({ pathname: '/login', params: { next: '/raffle' } })} />
                </View>
              </>
            ) : data.entered ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <Ionicons name="checkmark-circle" size={22} color={colors.gold} />
                <Text style={[styles.text, { fontWeight: '700' }]}>{t('raffle.entered')}</Text>
              </View>
            ) : (
              <Text style={[styles.text, { textAlign: 'center' }]}>{t('raffle.notEntered')}</Text>
            )}
          </Card>

          <Text style={[styles.label, { marginTop: space.lg }]}>{t('raffle.prizes')}</Text>
          <View style={{ gap: space.xs }}>
            {data.prizes.map((p) => (
              <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Ionicons name="star" size={16} color={colors.gold} />
                <Text style={styles.text}>{p}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {wins.length ? (
        <>
          <Text style={[styles.label, { marginTop: space.lg }]}>{t('raffle.myWins')}</Text>
          <View style={{ gap: space.sm }}>
            {wins.map((w) => (
              <Card key={w.id} style={{ gap: 2, borderColor: w.status === 'active' ? colors.gold : undefined }}>
                <Text style={styles.cardTitle}>🎉 {w.prize}</Text>
                <Text style={styles.muted}>
                  {w.status === 'used'
                    ? t('raffle.used')
                    : w.status === 'expired'
                      ? t('raffle.expired')
                      : w.expiresAt
                        ? t('raffle.pickUp', { date: new Date(w.expiresAt).toLocaleDateString(locale(), { day: 'numeric', month: 'long' }) })
                        : t('raffle.pickUpAny')}
                </Text>
              </Card>
            ))}
          </View>
        </>
      ) : null}

      {data.enabled ? (
        <>
          {data.winners.length ? (
            <>
              <Text style={[styles.label, { marginTop: space.lg }]}>{t('raffle.winners')}</Text>
              <View style={{ gap: space.xs }}>
                {data.winners.map((w, i) => (
                  <Text key={i} style={styles.text}>
                    <Text style={{ fontWeight: '700' }}>{w.name}</Text> · {w.prize} <Text style={styles.muted}>({short(w.week)})</Text>
                  </Text>
                ))}
              </View>
            </>
          ) : null}

          <Text style={[styles.label, { marginTop: space.lg }]}>{t('raffle.how')}</Text>
          <Text style={styles.muted}>{t('raffle.howText')}</Text>
          <Text style={[styles.text, { color: colors.gold, marginTop: space.sm, fontWeight: '600' }]} onPress={() => Linking.openURL(data.rulesUrl)} accessibilityRole="link">
            {t('raffle.rules')}
          </Text>
        </>
      ) : null}
    </Screen>
  );
}
