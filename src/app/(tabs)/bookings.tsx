import { router } from 'expo-router';
import { Alert, Platform, Text, View } from 'react-native';
import { Button, Card, Empty, Screen, SectionTitle, Title, styles } from '@/components/ui';
import type { Booking } from '@/data/types';
import { formatDate, formatTime } from '@/lib/dates';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function Bookings() {
  const { user, bookings, cancelBooking, serviceById, barberById } = useApp();

  if (!user) {
    return (
      <Screen>
        <Title>Programările mele</Title>
        <Empty icon="calendar-outline" text="Intră în cont ca să-ți vezi programările." />
        <Button title="Intră în cont" onPress={() => router.push('/login')} />
      </Screen>
    );
  }

  const now = Date.now();
  const sorted = [...bookings].sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = sorted.filter((b) => b.status === 'confirmed' && new Date(b.start).getTime() >= now);
  const past = sorted.filter((b) => !upcoming.includes(b)).reverse();

  const confirmCancel = (b: Booking) => {
    const msg = 'Sigur vrei să anulezi programarea?';
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) cancelBooking(b.id);
      return;
    }
    Alert.alert('Anulare', msg, [
      { text: 'Nu', style: 'cancel' },
      { text: 'Da, anulează', style: 'destructive', onPress: () => cancelBooking(b.id) },
    ]);
  };

  const renderItem = (b: Booking, canCancel: boolean) => {
    const start = new Date(b.start);
    const service = serviceById(b.serviceId);
    return (
      <Card key={b.id} style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.cardTitle}>{formatTime(start)}</Text>
          <Text style={{ color: b.status === 'cancelled' ? colors.danger : colors.muted, fontSize: 13 }}>
            {b.status === 'cancelled' ? 'Anulată' : formatDate(start)}
          </Text>
        </View>
        <Text style={styles.text}>{service?.name}</Text>
        <Text style={styles.muted}>
          cu {barberById(b.barberId)?.name} · {service?.price} lei
        </Text>
        {canCancel ? (
          <View style={{ marginTop: space.sm }}>
            <Button title="Anulează" variant="danger" onPress={() => confirmCancel(b)} />
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <Screen>
      <Title>Programările mele</Title>
      {upcoming.length === 0 && past.length === 0 ? (
        <>
          <Empty icon="calendar-outline" text="Nu ai încă nicio programare." />
          <Button title="Programează-te" onPress={() => router.push('/services')} />
        </>
      ) : null}
      {upcoming.length > 0 ? <SectionTitle>Viitoare</SectionTitle> : null}
      {upcoming.map((b) => renderItem(b, true))}
      {past.length > 0 ? <SectionTitle>Istoric</SectionTitle> : null}
      {past.map((b) => renderItem(b, false))}
    </Screen>
  );
}
