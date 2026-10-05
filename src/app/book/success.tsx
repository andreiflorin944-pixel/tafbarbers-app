import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Screen, styles } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/dates';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function Success() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings, serviceById, barberById, resetDraft } = useApp();
  const booking = bookings.find((b) => b.id === id);
  const start = booking ? new Date(booking.start) : null;

  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
        <Ionicons name="checkmark-circle" size={88} color={colors.gold} />
        <Text style={styles.title}>Te așteptăm!</Text>
        {booking && start ? (
          <Text style={[styles.muted, { textAlign: 'center', fontSize: 16, lineHeight: 24 }]}>
            {serviceById(booking.serviceId)?.name}
            {'\n'}cu {barberById(booking.barberId)?.name}
            {'\n'}
            {formatDate(start)}, ora {formatTime(start)}
          </Text>
        ) : null}
      </View>
      <View style={{ gap: space.sm }}>
        <Button
          title="Vezi programările mele"
          onPress={() => {
            resetDraft();
            router.dismissAll();
            router.replace('/bookings');
          }}
        />
        <Button
          title="Înapoi acasă"
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
