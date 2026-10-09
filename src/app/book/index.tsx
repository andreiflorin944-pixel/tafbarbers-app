import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useApp } from '@/state/AppState';
import { colors } from '@/theme';

// Linkul „Programează” din Google Maps / Instagram (tafbarbers://book) deschide direct alegerea serviciului.
// Linkul din mesajul listei de așteptare (tafbarbers://book?serviceId=…&barberId=…&day=…) deschide direct orele zilei.
export default function BookLink() {
  const p = useLocalSearchParams<{ serviceId?: string; barberId?: string; day?: string }>();
  const { loading, serviceById, barberById, setDraft } = useApp();

  useEffect(() => {
    if (!p.serviceId || loading) return;
    if (!serviceById(p.serviceId)) {
      router.replace('/book/service');
      return;
    }
    // Un frizer care nu mai lucrează la noi = orice frizer.
    setDraft({ serviceId: p.serviceId, barberId: p.barberId && barberById(p.barberId) ? p.barberId : null, start: null, slotBarberId: null });
    router.replace({ pathname: '/book/time', params: p.day ? { day: p.day } : {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, p.serviceId]);

  if (!p.serviceId) return <Redirect href="/book/service" />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.gold} />
    </View>
  );
}
