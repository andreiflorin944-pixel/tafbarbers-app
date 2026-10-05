import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Button, styles } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

export default function ServiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { serviceById, business, resetDraft, setDraft } = useApp();
  const service = serviceById(id ?? null);
  if (!service) return <Redirect href="/services" />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: space.xl }}>
      {/* Hero: replaced by the service photo once we load images from Barberly */}
      <View style={{ height: 320, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="cut" size={96} color={colors.goldDark} />
      </View>
      <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: space.md }}>
        <View style={{ backgroundColor: colors.gold, borderRadius: radius.md, padding: space.md, marginTop: -48, gap: 4 }}>
          <View style={styles.row}>
            <Ionicons name="time-outline" size={16} color={colors.onGold} />
            <Text style={{ color: colors.onGold, fontWeight: '700' }}>{service.durationMin} min</Text>
            <Text style={{ color: colors.onGold, fontWeight: '700', marginLeft: space.md }}>{service.price} lei</Text>
          </View>
          <Text style={{ color: colors.onGold, fontSize: 26, fontWeight: '800' }}>{service.name}</Text>
        </View>
        <Text style={[styles.text, { marginTop: space.lg, lineHeight: 22 }]}>{service.description}</Text>
        {business ? (
          <Text style={[styles.muted, { marginTop: space.md, lineHeight: 20 }]}>
            <Text style={{ color: colors.gold, fontWeight: '700' }}>Atenție! </Text>
            {business.cancellationPolicy}
          </Text>
        ) : null}
        <View style={{ marginTop: space.lg }}>
          <Button
            title="Rezervă o programare"
            onPress={() => {
              resetDraft();
              setDraft({ serviceId: service.id });
              router.push('/book/barber');
            }}
          />
        </View>
      </View>
    </ScrollView>
  );
}
