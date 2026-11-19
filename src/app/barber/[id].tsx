import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { AlbumGrid } from '@/components/AlbumGrid';
import { Avatar, Button, Card, Empty, Screen, SectionTitle, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { space } from '@/theme';

// Profilul unui frizer, pentru client: poza, rangul, descrierea și albumul cu tunsorile făcute de el.
// Din pasul „Alege frizerul” (`from=book`) butonul îl alege pe frizer și merge mai departe în programare.
export default function BarberProfile() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { barberById, draft, setDraft, resetDraft, serviceById } = useApp();
  const { t } = useT();
  const [width, setWidth] = useState(0);
  const b = barberById(id);
  if (!b) return <Screen edges={['bottom']}>{null}</Screen>;
  const album = b.album ?? [];

  const book = () => {
    if (from === 'book') {
      setDraft({ barberId: b.id, start: null, slotBarberId: null });
      const service = draft.presetService ? serviceById(draft.serviceId) : undefined;
      return router.push(service ? '/book/time' : '/book/service');
    }
    resetDraft();
    setDraft({ barberId: b.id, locationId: b.locationId ?? null });
    router.push('/book/service');
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: b.name }} />
      <View style={{ alignItems: 'center', gap: space.xs, marginBottom: space.md }}>
        <Avatar barber={b} size={120} />
        <Text style={[styles.title, { fontSize: 24, marginTop: space.sm, textAlign: 'center' }]}>
          {b.name}
          {b.nickname ? <Text style={styles.muted}> „{b.nickname}”</Text> : null}
        </Text>
        <Text style={styles.muted}>{b.role}</Text>
      </View>
      {b.bio ? (
        <Card>
          <Text style={[styles.text, { lineHeight: 22 }]}>{b.bio}</Text>
        </Card>
      ) : null}

      <Button title={t('album.bookWith', { name: b.nickname || b.name.split(' ')[0] })} onPress={book} />

      <SectionTitle>
        {t('album.title')}
        {album.length ? ` · ${t('album.photos', { n: album.length })}` : ''}
      </SectionTitle>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {!album.length ? <Empty icon="images-outline" text={t('album.empty')} /> : width ? <AlbumGrid photos={album} width={width} /> : null}
      </View>
    </Screen>
  );
}
