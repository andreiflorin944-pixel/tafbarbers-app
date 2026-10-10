import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useApp } from '@/state/AppState';
import { colors } from '@/theme';

// Linkul „Programează” din Google Maps / Instagram / QR (tafbarbers://book) deschide programarea de la primul pas, locația.
// Linkul din mesajul listei de așteptare (tafbarbers://book?serviceId=…&barberId=…&locationId=…&day=…) deschide direct orele zilei.
export default function BookLink() {
  const p = useLocalSearchParams<{ serviceId?: string; barberId?: string; locationId?: string; day?: string }>();
  const { loading, serviceById, barberById, locationById, locations, setDraft, resetDraft } = useApp();

  useEffect(() => {
    if (!p.serviceId || loading) return;
    resetDraft();
    if (!serviceById(p.serviceId)) {
      router.replace('/book/location');
      return;
    }
    // Un frizer care nu mai lucrează la noi = orice frizer din locația lui (sau din cea din link).
    const barber = p.barberId ? barberById(p.barberId) : undefined;
    const locationId = barber?.locationId ?? (locationById(p.locationId)?.id || (locations.length === 1 ? locations[0].id : null));
    setDraft({ serviceId: p.serviceId, presetService: true, barberId: barber ? barber.id : null, locationId, start: null, slotBarberId: null });
    // Fără frizer și fără locație știută (mai multe locații): clientul alege întâi locația, apoi frizerul.
    if (!barber && !locationId) router.replace('/book/location');
    else router.replace({ pathname: '/book/time', params: p.day ? { day: p.day } : {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, p.serviceId]);

  if (!p.serviceId) return <Redirect href="/book/location" />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.gold} />
    </View>
  );
}
