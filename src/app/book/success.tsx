import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Screen, styles } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/dates';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function Success() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings, serviceById, barberById, locationById, locations, resetDraft } = useApp();
  const booking = bookings.find((b) => b.id === id);
  const start = booking ? new Date(booking.start) : null;
  // Cu aprobare: cererea e trimisă, salonul o confirmă (clientul primește mesaj).
  const pending = booking?.status === 'requested';
  const { t } = useT();

  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
        <Ionicons name={pending ? 'hourglass' : 'checkmark-circle'} size={88} color={colors.gold} />
        <Text style={styles.title}>{pending ? t('success.requestTitle') : t('success.title')}</Text>
        {pending ? (
          <Text style={{ color: colors.gold, fontWeight: '700', fontSize: 15 }}>{t('bookings.pending')}</Text>
        ) : null}
        {booking && start ? (
          <Text style={[styles.muted, { textAlign: 'center', fontSize: 16, lineHeight: 24 }]}>
            {serviceById(booking.serviceId)?.name}
            {'\n'}
            {t('common.with', { name: barberById(booking.barberId)?.name ?? '' })}
            {'\n'}
            {locations.length > 1 && locationById(booking.locationId) ? `${locationById(booking.locationId)!.name}\n` : ''}
            {t('success.when', { date: formatDate(start), time: formatTime(start) })}
          </Text>
        ) : null}
        {pending ? <Text style={[styles.muted, { textAlign: 'center', fontSize: 14, lineHeight: 20 }]}>{t('success.requestText')}</Text> : null}
      </View>
      <View style={{ gap: space.sm }}>
        <Button
          title={t('success.myBookings')}
          onPress={() => {
            resetDraft();
            router.dismissAll();
            router.replace('/bookings');
          }}
        />
        <Button
          title={t('success.home')}
          variant="ghost"
          onPress={() => {
            resetDraft();
            router.dismissAll();
            router.replace('/');
          }}
        />
      </View>
    </Screen>
  );
}
