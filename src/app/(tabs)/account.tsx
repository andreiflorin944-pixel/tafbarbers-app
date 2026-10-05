import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Avatar, Button, Card, Icon, Screen, Title, styles } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { space } from '@/theme';

export default function Account() {
  const { user, signOut, bookings } = useApp();

  if (!user) {
    return (
      <Screen>
        <Title sub="Salvează-ți datele și vezi istoricul programărilor">Cont</Title>
        <Button title="Intră în cont cu telefonul" onPress={() => router.push('/login')} />
      </Screen>
    );
  }

  const done = bookings.filter((b) => b.status === 'confirmed').length;

  return (
    <Screen>
      <Title>Cont</Title>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar barber={{ id: 'me', name: user.name, role: '', initials: user.name.charAt(0).toUpperCase() }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{user.name}</Text>
          <Text style={styles.muted}>{user.phone}</Text>
        </View>
      </Card>
      <Card style={{ gap: space.sm }}>
        <View style={styles.row}>
          <Icon name="calendar" />
          <Text style={styles.text}>{done} programări active</Text>
        </View>
        <View style={styles.row}>
          <Icon name="star" />
          <Text style={styles.text}>Program de loialitate (în curând)</Text>
        </View>
        <View style={styles.row}>
          <Icon name="notifications" />
          <Text style={styles.text}>Notificări și reamintiri (în curând)</Text>
        </View>
      </Card>
      <View style={{ marginTop: space.lg }}>
        <Button title="Ieși din cont" variant="ghost" onPress={signOut} />
      </View>
    </Screen>
  );
}
