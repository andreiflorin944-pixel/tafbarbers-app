import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { mediaUrl } from '@/api/staff';
import { Button, Card, Empty, Screen, Steps, styles } from '@/components/ui';
import { useLoginGate } from '@/components/LoginGate';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

// Primul pas al programării: locația. Se arată mereu (așa a cerut salonul), chiar și cu o singură locație:
// atunci e deja aleasă și clientul doar apasă Continuă.
export default function ChooseLocation() {
  const { locations, loading, draft, setDraft, serviceById, business } = useApp();
  const gate = useLoginGate();
  const { t } = useT();
  const [picked, setPicked] = useState<string | null>(draft.locationId);
  const service = draft.presetService ? serviceById(draft.serviceId) : undefined;

  // Locațiile vin de la server după pornire: cu una singură, o alegem noi.
  useEffect(() => {
    if (!picked && locations.length === 1) setPicked(locations[0].id);
  }, [locations, picked]);

  if (gate) return gate;

  const next = () => {
    if (!picked) return;
    // Altă locație: frizerul ales înainte nu mai e valabil.
    setDraft({ locationId: picked, ...(picked !== draft.locationId && { barberId: null }), start: null, slotBarberId: null });
    router.push('/book/barber');
  };

  return (
    <Screen edges={['bottom']}>
      <Steps current={1} />
      <Text style={[styles.muted, { marginBottom: space.sm }]}>
        {service ? `${service.name} · ` : ''}
        {t('book.locationHint')}
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: space.xl }} />
      ) : !locations.length ? (
        <Empty icon="location-outline" text={t('book.noBarbers')} />
      ) : (
        locations.map((l) => {
          const photo = mediaUrl(l.photoUrl);
          const on = picked === l.id;
          return (
            <Card key={l.id} onPress={() => setPicked(l.id)} selected={on} style={{ gap: space.sm }}>
              {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 120, borderRadius: radius.sm }} accessibilityLabel={l.name} /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="location" size={22} color={colors.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{l.name}</Text>
                  {l.address ? <Text style={styles.muted}>{l.address}</Text> : null}
                  {l.phone || business?.phone ? <Text style={[styles.muted, { fontSize: 13 }]}>{l.phone || business?.phone}</Text> : null}
                </View>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={on ? colors.gold : colors.muted} />
              </View>
            </Card>
          );
        })
      )}

      <View style={{ marginTop: space.md }}>
        <Button title={t('book.continue')} disabled={!picked} onPress={next} />
      </View>
    </Screen>
  );
}
