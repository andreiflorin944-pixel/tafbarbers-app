import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Image, ScrollView, Text, View } from 'react-native';
import { Button, styles } from '@/components/ui';
import { mediaUrl } from '@/api/staff';
import { usePriceLabel } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { useT } from '@/i18n';
import { colors, radius, space } from '@/theme';

export default function ServiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { serviceById, business, resetDraft, setDraft, loading } = useApp();
  const priceText = usePriceLabel();
  const { t } = useT();
  const service = serviceById(id ?? null);
  // Deschisă direct dintr-un link: așteptăm întâi serviciile de la server.
  if (!service) return loading ? <View style={{ flex: 1, backgroundColor: colors.bg }} /> : <Redirect href="/services" />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: space.xl }}>
      {/* Poza serviciului (din panou); fără poză rămâne foarfeca. */}
      <View style={{ height: 320, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
        {service.imageUrl ? (
          <Image source={{ uri: mediaUrl(service.imageUrl)! }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <Ionicons name="cut" size={96} color={colors.goldDark} />
        )}
      </View>
      <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: space.md }}>
        <View style={{ backgroundColor: colors.gold, borderRadius: radius.md, padding: space.md, marginTop: -48, gap: 4 }}>
          <View style={styles.row}>
            <Ionicons name="time-outline" size={16} color={colors.onGold} />
            <Text style={{ color: colors.onGold, fontWeight: '700' }}>{service.durationMin} min</Text>
            <Text style={{ color: colors.onGold, fontWeight: '700', marginLeft: space.md }}>{priceText(service)}</Text>
          </View>
          <Text style={{ color: colors.onGold, fontSize: 26, fontWeight: '800' }}>{service.name}</Text>
        </View>
        <Text style={[styles.text, { marginTop: space.lg, lineHeight: 22 }]}>{service.description}</Text>
        {business ? (
          <Text style={[styles.muted, { marginTop: space.md, lineHeight: 20 }]}>
            <Text style={{ color: colors.gold, fontWeight: '700' }}>{t('book.attention')}</Text>
            {business.cancellationPolicy}
          </Text>
        ) : null}
        <View style={{ marginTop: space.lg }}>
          <Button
            title={t('service.book')}
            onPress={() => {
              // Serviciul e ales: locația, frizerul, apoi direct ora.
              resetDraft();
              setDraft({ serviceId: service.id, presetService: true });
              router.push('/book/location');
            }}
          />
        </View>
      </View>
    </ScrollView>
  );
}
