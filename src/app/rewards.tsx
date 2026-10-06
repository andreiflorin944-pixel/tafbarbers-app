import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Share, Text, View } from 'react-native';
import { api, apiUrl } from '@/api';
import { BonusRow } from '@/components/BonusRow';
import { useLoginGate } from '@/components/LoginGate';
import { Button, Card, Screen, styles } from '@/components/ui';
import type { Referrals } from '@/data/types';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

// Bonusurile clientului și linkul lui de recomandare.
export default function Rewards() {
  const { token, business } = useApp();
  const gate = useLoginGate();
  const [data, setData] = useState<Referrals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (token) api.getReferrals(token).then(setData, (e) => setError(errorMessage(e)));
  }, [token]);

  if (gate) return gate;
  if (!data) return <Screen edges={[]}>{error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.gold} />}</Screen>;

  const link = apiUrl ? `${apiUrl}/r/${data.code}` : null;
  const shop = business?.name ?? "TAF Barber's";
  const share = async () => {
    const message = `Hai la ${shop}! Fă-ți cont în aplicație cu codul meu ${data.code}${link ? `: ${link}` : ''}`;
    if (Platform.OS === 'web') {
      await navigator.clipboard?.writeText(message).catch(() => undefined);
      setCopied(true);
    } else {
      await Share.share({ message });
    }
  };
  const active = data.bonuses.filter((b) => b.status === 'active');
  const past = data.bonuses.filter((b) => b.status !== 'active');

  return (
    <Screen edges={['bottom']}>
      {data.enabled ? (
        <Card style={{ alignItems: 'center', gap: space.sm, borderColor: colors.gold }}>
          <Ionicons name="people" size={30} color={colors.gold} />
          <Text style={[styles.cardTitle, { textAlign: 'center' }]}>Recomandă-ne prietenilor</Text>
          {data.reward ? (
            <Text style={[styles.muted, { textAlign: 'center' }]}>
              Pentru fiecare prieten care își face cont cu codul tău primești: <Text style={{ color: colors.text, fontWeight: '700' }}>{data.reward}</Text>
            </Text>
          ) : null}
          <Text style={{ color: colors.gold, fontSize: 34, fontWeight: '800', letterSpacing: 6, marginVertical: space.xs }}>{data.code}</Text>
          <View style={{ alignSelf: 'stretch' }}>
            <Button title={Platform.OS === 'web' ? (copied ? 'Copiat' : 'Copiază linkul') : 'Trimite linkul'} onPress={share} />
          </View>
          <Text style={styles.muted}>
            {data.referred === 0 ? 'Încă nu ai adus pe nimeni.' : data.referred === 1 ? 'Ai adus 1 prieten.' : `Ai adus ${data.referred} prieteni.`}
          </Text>
        </Card>
      ) : null}

      <Text style={[styles.label, { marginTop: space.lg }]}>Bonusurile mele</Text>
      {active.length === 0 ? <Text style={styles.muted}>Nu ai bonusuri active acum.</Text> : null}
      <View style={{ gap: space.sm }}>
        {active.map((b) => (
          <BonusRow key={b.id} b={b} />
        ))}
      </View>
      {active.length ? <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>Spune-i frizerului la salon că vrei să folosești bonusul.</Text> : null}

      {past.length ? (
        <>
          <Text style={[styles.label, { marginTop: space.lg }]}>Folosite sau expirate</Text>
          <View style={{ gap: space.sm }}>
            {past.map((b) => (
              <BonusRow key={b.id} b={b} />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
