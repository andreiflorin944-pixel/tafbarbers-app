import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { Button, Card, Empty, Screen, Segmented, Title, styles } from '@/components/ui';
import type { Booking } from '@/data/types';
import { formatDate, formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function Bookings() {
  const { user, bookings, cancelBooking, serviceById, barberById, resetDraft, business, refreshBookings } = useApp();
  const [tab, setTab] = useState(0);
  const { t } = useT();
  const book = () => {
    resetDraft();
    router.push('/book/service');
  };

  if (!user) {
    return (
      <Screen tab>
        <Title>{t('bookings.title')}</Title>
        <Empty icon="calendar-outline" text="Intră în cont ca să-ți vezi programările." />
        <Button title="Intră în cont" onPress={() => router.push('/login')} />
      </Screen>
    );
  }

  const now = Date.now();
  const sorted = [...bookings].sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = sorted.filter((b) => b.status === 'confirmed' && new Date(b.start).getTime() >= now);
  const past = sorted.filter((b) => !upcoming.includes(b)).reverse();

  const notify = (msg: string) => (Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Anulare', msg));
  const doCancel = (b: Booking) =>
    cancelBooking(b.id).catch((e) => {
      notify(errorMessage(e, 'Nu am putut anula programarea.'));
      refreshBookings();
    });
  const confirmCancel = (b: Booking) => {
    const msg = 'Sigur vrei să anulezi programarea?';
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) doCancel(b);
      return;
    }
    Alert.alert('Anulare', msg, [
      { text: 'Nu', style: 'cancel' },
      { text: 'Da, anulează', style: 'destructive', onPress: () => doCancel(b) },
    ]);
  };
  const cancelMs = (business?.cancelHours ?? 0) * 3_600_000;
  const STATUS: Record<string, string> = { cancelled: 'Anulată', completed: 'Finalizată', no_show: 'Neprezentare' };

  const renderItem = (b: Booking, canCancel: boolean) => {
    const start = new Date(b.start);
    const service = serviceById(b.serviceId);
    return (
      <Card key={b.id} style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.cardTitle}>{formatTime(start)}</Text>
          <Text style={{ color: b.status === 'cancelled' || b.status === 'no_show' ? colors.danger : colors.muted, fontSize: 13 }}>
            {STATUS[b.status] ?? formatDate(start)}
          </Text>
        </View>
        <Text style={styles.text}>{service?.name ?? b.serviceName}</Text>
        <Text style={styles.muted}>
          cu {barberById(b.barberId)?.name ?? b.barberName} · {b.price ?? service?.price} lei
        </Text>
        {canCancel && start.getTime() - Date.now() < cancelMs ? (
          <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>
            Se mai poate anula doar telefonic (mai puțin de {business?.cancelHours} ore până la programare).
          </Text>
        ) : canCancel ? (
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
      <Title>{t('bookings.title')}</Title>
      <Segmented options={[t('bookings.upcoming'), t('bookings.past')]} value={tab} onChange={setTab} />
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
