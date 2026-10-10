import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { api, ApiError } from '@/api';
import { Button, Card, Icon, Screen, Steps, styles } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useLoginGate } from '@/components/LoginGate';
import { barberDuration, barberPrice, lei } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { useT } from '@/i18n';
import { colors, space } from '@/theme';

export default function Confirm() {
  const { draft, serviceById, barberById, locationById, user, token, addBooking, business } = useApp();
  const gate = useLoginGate();
  const { t } = useT();
  const service = serviceById(draft.serviceId);
  const barber = barberById(draft.slotBarberId);
  const location = locationById(barber?.locationId ?? draft.locationId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slotTaken, setSlotTaken] = useState(false);
  const [payNow, setPayNow] = useState(false);

  if (gate) return gate;
  if (!service || !draft.start || !barber) return <Redirect href="/book/location" />;
  const start = new Date(draft.start);
  // Salonul cere aprobare pentru acest frizer: programarea pleacă drept cerere, iar plata online se face după confirmare.
  const approval = !!business?.requireApproval && (!business.approvalBarberIds?.length || business.approvalBarberIds.includes(barber.id));
  const online = !!business?.onlinePayments && !approval;

  const book = async (tok: string) => {
    setSaving(true);
    setError(null);
    try {
      // Trimitem frizerul ales efectiv la ora respectivă, ca serverul să verifice exact acel loc.
      const booking = await api.createBooking(tok, { serviceId: service.id, barberId: barber.id, start: draft.start! });
      addBooking(booking);
      router.replace({ pathname: '/book/success', params: { id: booking.id } });
      // Plata cu cardul: pagina Stripe se deschide peste ecranul de confirmare; dacă renunță, plătește la salon.
      if (online && payNow) {
        try {
          const { url } = await api.payBooking(tok, booking.id);
          await Linking.openURL(url);
        } catch {
          // programarea e făcută; se poate plăti și din Programări sau la salon
        }
      }
    } catch (e) {
      setError(errorMessage(e, t('book.failed')));
      setSlotTaken(e instanceof ApiError && e.code === 'slot_unavailable');
    } finally {
      setSaving(false);
    }
  };

  const policy =
    business?.cancellationPolicy ||
    (business?.cancelHours ? t('book.policyDefault', { h: business.cancelHours }) : null);

  return (
    <Screen edges={['bottom']}>
      <Steps current={5} />
      <Card style={{ gap: space.sm }}>
        {location ? <Line icon="location" text={[location.name, location.address].filter(Boolean).join(' · ')} /> : null}
        <Line icon="cut" text={service.name} />
        <Line icon="person" text={barber.name} />
        <Line icon="calendar" text={formatDate(start)} />
        <Line icon="time" text={`${formatTime(start)} · ${barberDuration(service, barber)} min`} />
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.xs }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.text}>{t('book.total')}</Text>
          <Text style={styles.price}>{lei(barberPrice(service, barber))}</Text>
        </View>
      </Card>

      {online ? (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <Text style={styles.label}>{t('book.howPay')}</Text>
          {([false, true] as const).map((now) => (
            <Card key={String(now)} selected={payNow === now} onPress={() => setPayNow(now)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name={now ? 'card' : 'storefront'} color={colors.gold} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{now ? t('book.payCard') : t('book.paySalon')}</Text>
                <Text style={styles.muted}>{now ? t('book.payCardSub') : t('book.paySalonSub')}</Text>
              </View>
            </Card>
          ))}
        </View>
      ) : (
        <Text style={[styles.muted, { fontSize: 12, marginTop: space.sm }]}>{t('book.payAtLocation')}</Text>
      )}
      {approval ? (
        <Card style={{ marginTop: space.sm, flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <Icon name="hourglass" color={colors.gold} />
          <Text style={[styles.muted, { flex: 1, lineHeight: 20 }]}>{t('confirm.approvalNote')}</Text>
        </Card>
      ) : null}
      {policy ? (
        <Text style={[styles.muted, { fontSize: 12, marginTop: space.sm, lineHeight: 18 }]}>
          <Text style={{ color: colors.gold, fontWeight: '700' }}>{t('book.attention')}</Text>
          {policy}
        </Text>
      ) : null}

      {error ? <Text style={{ color: colors.danger, marginTop: space.md }}>{error}</Text> : null}

      {user && token ? (
        <View style={{ marginTop: space.lg, gap: space.sm }}>
          <Text style={styles.muted}>
            {t('book.bookingAs', { name: user.name || user.phone, phone: user.phone })}
          </Text>
          {slotTaken ? (
            <Button title={t('book.otherTime')} onPress={() => router.back()} />
          ) : (
            <Button title={approval ? t('confirm.sendRequest') : online && payNow ? t('book.confirmPay') : t('book.confirm')} onPress={() => book(token)} loading={saving} />
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function Line({ icon, text }: { icon: 'location' | 'cut' | 'person' | 'calendar' | 'time'; text: string }) {
  return (
    <View style={styles.row}>
      <Icon name={icon} color={colors.gold} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}
