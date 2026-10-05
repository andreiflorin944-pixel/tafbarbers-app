import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { Button, Card, Icon, Screen, Steps, styles } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/dates';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function Confirm() {
  const { draft, serviceById, barberById, user, signIn, addBooking } = useApp();
  const service = serviceById(draft.serviceId);
  const barber = barberById(draft.slotBarberId);
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!service || !draft.start || !barber) return <Redirect href="/services" />;
  const start = new Date(draft.start);
  const valid = name.trim().length >= 2 && /^\+?\d{9,13}$/.test(phone.replace(/\s/g, ''));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const clientPhone = phone.replace(/\s/g, '');
      const booking = await api.createBooking({
        serviceId: service.id,
        barberId: barber.id,
        start: draft.start!,
        clientName: name.trim(),
        clientPhone,
      });
      if (!user) signIn({ name: name.trim(), phone: clientPhone });
      addBooking(booking);
      router.replace({ pathname: '/book/success', params: { id: booking.id } });
    } catch {
      setError('Nu am putut face programarea. Încearcă din nou.');
    } finally {
      setSaving(false);
    }
  };

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
          <Text style={styles.price}>{service.price} lei</Text>
        </View>
      </Card>

      <Text style={styles.label}>Nume</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Numele tău" placeholderTextColor={colors.muted} style={styles.input} autoComplete="name" />
      <Text style={styles.label}>Telefon</Text>
      <TextInput value={phone} onChangeText={setPhone} placeholder="07xx xxx xxx" placeholderTextColor={colors.muted} style={styles.input} keyboardType="phone-pad" autoComplete="tel" />
      <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>Plata se face la locație. Vei primi o confirmare pe SMS.</Text>

      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}

      <View style={{ marginTop: space.lg }}>
        <Button title="Confirmă programarea" onPress={submit} disabled={!valid} loading={saving} />
      </View>
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
