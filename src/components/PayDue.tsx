import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, Text, View } from 'react-native';
import { api } from '@/api';
import { Button, Card, styles } from '@/components/ui';
import type { Booking } from '@/data/types';
import { useT } from '@/i18n';
import { formatDate, formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { lei } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

/** Deschide plata Stripe a unei programări (suma cerută de salon sau prețul întreg). */
export function usePayBooking() {
  const { token } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const pay = async (b: Booking) => {
    if (!token) return;
    setBusy(b.id);
    try {
      const { url } = await api.payBooking(token, b.id);
      await Linking.openURL(url);
    } catch (e) {
      const m = errorMessage(e);
      Platform.OS === 'web' ? window.alert(m) : Alert.alert('TAF', m);
    } finally {
      setBusy(null);
    }
  };
  return { pay, busy };
}

/**
 * „Ai de plătit X lei · Plătește acum”: salonul i-a cerut clientului plata în aplicație (starea vine de la server, `payDue`).
 * Pe prima pagină (`refresh`) lista se reîncarcă la intrare și la întoarcerea de pe pagina de plată.
 */
export function PayDueBanner({ refresh }: { refresh?: boolean }) {
  const { bookings, business, refreshBookings, serviceById, user } = useApp();
  const { t } = useT();
  const { pay, busy } = usePayBooking();
  useFocusEffect(
    useCallback(() => {
      if (refresh && user) refreshBookings();
    }, [refresh, user, refreshBookings]),
  );
  useEffect(() => {
    if (!refresh) return;
    const sub = AppState.addEventListener('change', (st) => st === 'active' && user && refreshBookings());
    return () => sub.remove();
  }, [refresh, user, refreshBookings]);
  if (!business?.onlinePayments) return null;
  const due = bookings.filter((b) => b.payDue).sort((a, b) => a.start.localeCompare(b.start));
  if (!due.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      {due.map((b) => (
        <Card key={b.id} style={{ borderColor: colors.gold, gap: space.xs }}>
          <View style={styles.row}>
            <Ionicons name="card" size={20} color={colors.gold} />
            <Text style={[styles.cardTitle, { flex: 1 }]}>{t('pay.due', { amount: lei(b.payDue ?? 0) })}</Text>
          </View>
          <Text style={styles.muted}>
            {serviceById(b.serviceId)?.name ?? b.serviceName} · {formatDate(new Date(b.start))}, {formatTime(new Date(b.start))}
          </Text>
          <Text style={[styles.muted, { fontSize: 12 }]}>{t('pay.dueHint')}</Text>
          <View style={{ marginTop: space.xs }}>
            <Button title={t('pay.now')} onPress={() => pay(b)} loading={busy === b.id} />
          </View>
        </Card>
      ))}
    </View>
  );
}
