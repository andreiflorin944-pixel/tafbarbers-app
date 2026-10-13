import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Avatar, Button, Card, Screen, styles } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { useT } from '@/i18n';
import { space } from '@/theme';

export default function Barbers() {
  const { barbers, resetDraft } = useApp();
  const { t } = useT();

  return (
    <Screen edges={['bottom']}>
      {barbers.map((b) => (
        <Card key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Avatar barber={b} size={72} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>
              {b.name}
              {b.nickname ? <Text style={styles.muted}> „{b.nickname}”</Text> : null}
            </Text>
            <Text style={styles.muted}>{b.role}</Text>
            {b.bio ? (
              <Text style={[styles.muted, { marginTop: 4 }]}>{b.bio}</Text>
            ) : null}
          </View>
        </Card>
      ))}
      <View style={{ marginTop: space.md }}>
        <Button
          title={t('barbers.book')}
          onPress={() => {
            resetDraft();
            router.push('/book/location');
          }}
        />
      </View>
    </Screen>
  );
}
