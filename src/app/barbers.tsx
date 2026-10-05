import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Avatar, Button, Card, Screen, styles } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { space } from '@/theme';

export default function Barbers() {
  const { barbers, resetDraft } = useApp();

  return (
    <Screen edges={[]}>
      {barbers.map((b) => (
        <Card key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Avatar barber={b} size={72} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{b.name}</Text>
            <Text style={styles.muted}>{b.role}</Text>
          </View>
        </Card>
      ))}
      <View style={{ marginTop: space.md }}>
        <Button
          title="Programează-te"
          onPress={() => {
            resetDraft();
            router.push('/book/service');
          }}
        />
      </View>
    </Screen>
  );
}
