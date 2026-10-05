import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '@/api';
import { Button, Card, Icon, Screen, Steps, styles } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useLoginGate } from '@/components/LoginGate';
import { barberPrice } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function Confirm() {
  const { draft, serviceById, barberById, user, token, addBooking, business } = useApp();
  const gate = useLoginGate();
  const service = serviceById(draft.serviceId);
  const barber = barberById(draft.slotBarberId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slotTaken, setSlotTaken] = useState(false);

  if (gate) return gate;
  if (!service || !draft.start || !barber) return <Redirect href="/book/service" />;
  const start = new Date(draft.start);

  const book = async (t: string) => {
    setSaving(true);
    setError(null);
    try {
      // Trimitem frizerul ales efectiv la ora respectivă, ca serverul să verifice exact acel loc.
      const booking = await api.createBooking(t, { serviceId: service.id, barberId: barber.id, start: draft.start! });
      addBooking(booking);
      router.replace({ pathname: '/book/success', params: { id: booking.id } });
    } catch (e) {
      setError(errorMessage(e, 'Nu am putut face programarea. Încearcă din nou.'));
      setSlotTaken(e instanceof ApiError && e.code === 'slot_unavailable');
    } finally {
      setSaving(false);
    }
  };

  const policy =
    business?.cancellationPolicy ||
    (business?.cancelHours ? `Poți anula programarea din aplicație cu cel puțin ${business.cancelHours} ore înainte.` : null);

  return (
    <Screen edges={['bottom']}>
      <Steps current={4} />
      <Card style={{ gap: space.sm }}>
        <Line icon="cut" text={service.name} />
        <Line icon="person" text={barber.name} />
        <Line icon="calendar" text={formatDate(start)} />
        <Line icon="time" text={`${formatTime(start)} · ${service.durationMin} min`} />
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.xs }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.text}>Total</Text>
          <Text style={styles.price}>{barberPrice(service, barber)} lei</Text>
        </View>
      </Card>

      <Text style={[styles.muted, { fontSize: 12, marginTop: space.sm }]}>Plata se face la locație. Vei primi o confirmare pe SMS.</Text>
      {policy ? (
        <Text style={[styles.muted, { fontSize: 12, marginTop: space.sm, lineHeight: 18 }]}>
          <Text style={{ color: colors.gold, fontWeight: '700' }}>Atenție! </Text>
          {policy}
        </Text>
      ) : null}

      {error ? <Text style={{ color: colors.danger, marginTop: space.md }}>{error}</Text> : null}

      {user && token ? (
        <View style={{ marginTop: space.lg, gap: space.sm }}>
          <Text style={styles.muted}>
            Rezervi ca {user.name || user.phone} · {user.phone}
          </Text>
          {slotTaken ? (
            <Button title="Alege altă oră" onPress={() => router.back()} />
          ) : (
            <Button title="Confirmă programarea" onPress={() => book(token)} loading={saving} />
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function Line({ icon, text }: { icon: 'cut' | 'person' | 'calendar' | 'time'; text: string }) {
  return (
    <View style={styles.row}>
      <Icon name={icon} color={colors.gold} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}
