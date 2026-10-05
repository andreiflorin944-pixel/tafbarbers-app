import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { api } from '@/api';
import { Screen, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { colors, space } from '@/theme';

export default function LegalDoc() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const { lang } = useT();
  const [data, setData] = useState<{ title: string; body: string; updatedAt: string | null } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (doc !== 'terms' && doc !== 'privacy') return setError(true);
    api.getLegal(doc, lang).then(setData, () => setError(true));
  }, [doc, lang]);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: data?.title ?? '' }} />
      {error ? (
        <Text style={styles.muted}>Nu am putut încărca documentul. Încearcă din nou.</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: space.xl }} />
      ) : (
        <>
          {data.updatedAt ? <Text style={[styles.muted, { fontSize: 12, marginBottom: space.sm }]}>Actualizat: {data.updatedAt.slice(0, 10)}</Text> : null}
          <Text style={[styles.text, { lineHeight: 23 }]}>{data.body}</Text>
        </>
      )}
    </Screen>
  );
}
