import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { Button, Card, Empty, Screen, Segmented, Title, styles } from '@/components/ui';
import type { Booking } from '@/data/types';
import { formatDate, formatTime } from '@/lib/dates';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function Bookings() {
  const { user, bookings, cancelBooking, serviceById, barberById, resetDraft } = useApp();
  const [tab, setTab] = useState(0);
  const book = () => {
    resetDraft();
    router.push('/book/service');
  };

  if (!user) {
    return (
      <Screen tab>
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

  const list = tab === 0 ? upcoming : past;

  return (
    <Screen tab>
      <Title>Programările mele</Title>
      <Segmented options={['Urmează', 'Trecut']} value={tab} onChange={setTab} />
      {list.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.lg }}>
          <Text style={[styles.title, { fontSize: 22, textAlign: 'center' }]}>Nu s-au găsit programări</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            {tab === 0 ? 'Nu ai nicio programare viitoare.' : 'Nu ai încă programări în istoric.'}
          </Text>
          <Button title="Rezervă o programare" onPress={book} />
        </Card>
      ) : (
        list.map((b) => renderItem(b, tab === 0))
      )}
    </Screen>
  );
}
