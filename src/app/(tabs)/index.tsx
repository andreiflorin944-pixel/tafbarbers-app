import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mediaUrl } from '@/api/staff';
import { Backdrop } from '@/components/Backdrop';
import { LangButton } from '@/components/LangButton';
import { PromoCarousel } from '@/components/PromoCarousel';
import { ProductImage } from '@/components/Shop';
import { useCart } from '@/state/Cart';
import { Button, SectionTitle, styles as ui } from '@/components/ui';
import type { Promo, Service } from '@/data/types';
import { useT } from '@/i18n';
import { formatDate, formatTime } from '@/lib/dates';
import { usePriceLabel } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

export default function Home() {
  const { business, loading, loadError, reload, user, bookings, services, promos, serviceById, barberById, resetDraft, setDraft } = useApp();
  const { t, lang } = useT();
  const priceText = usePriceLabel();
  const { staff } = useStaff();
  const { products, count: cartCount } = useCart();
  const look = business?.appearance;
  const logo = mediaUrl(look?.logoUrl);
  const welcome = look?.welcome?.[lang as 'ro' | 'en' | 'fr'];

  const next = bookings
    .filter((b) => b.status === 'confirmed' && new Date(b.start).getTime() > Date.now())
    .sort((a, b) => a.start.localeCompare(b.start))[0];

  const startBooking = (service?: Service) => {
    resetDraft();
    if (service) {
      setDraft({ serviceId: service.id });
      router.push('/book/barber');
    } else {
      router.push('/book/service');
    }
  };

  const openPromo = (p: Promo) => {
    if (p.action.type === 'service') return startBooking(serviceById(p.action.serviceId));
    if (p.action.type === 'url') return Linking.openURL(p.action.url);
    startBooking();
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.gold} style={{ marginTop: 120 }} />
      </View>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg, justifyContent: 'center', gap: space.md }}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.gold} style={{ alignSelf: 'center' }} />
        <Text style={[ui.text, { textAlign: 'center' }]}>Nu ne putem conecta la server. Verifică internetul.</Text>
        <Button title="Încearcă din nou" onPress={reload} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Backdrop />
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.topBar}>
          <View>
            <Text style={ui.muted}>{user ? t('home.hi', { name: (user.name || user.phone).split(' ')[0] }) : welcome || t('home.welcome')}</Text>
            {logo ? (
              <Image source={{ uri: logo }} style={s.logo} resizeMode="contain" accessibilityLabel={look?.title} />
            ) : look?.title && look.title !== 'TAF Barber’s' ? (
              <Text style={s.brand}>{look.title}</Text>
            ) : (
              <Text style={s.brand}>
                TAF <Text style={s.brandItalic}>Barber’s</Text>
              </Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {staff ? (
              <Pressable onPress={() => router.push('/staff')} hitSlop={10} accessibilityLabel="Agenda echipei" style={s.iconBtn}>
                <Ionicons name="calendar-outline" size={20} color={colors.gold} />
              </Pressable>
            ) : null}
            <LangButton />
            <Pressable onPress={() => router.push('/account')} hitSlop={10} accessibilityLabel="Cont" style={s.iconBtn}>
              <Ionicons name="person-outline" size={20} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {promos.length ? <PromoCarousel promos={promos} onPress={openPromo} /> : null}

        {next ? (
          <Pressable onPress={() => router.push('/bookings')} style={s.hero}>
            <Text style={s.heroLabel}>{t('home.next')}</Text>
            <Text style={s.heroTitle}>{formatTime(new Date(next.start))}</Text>
            <Text style={s.heroText}>{formatDate(new Date(next.start))}</Text>
            <View style={s.heroRow}>
              <Ionicons name="cut-outline" size={16} color={colors.onGold} />
              <Text style={s.heroText} numberOfLines={1}>
                {serviceById(next.serviceId)?.name} · {barberById(next.barberId)?.name}
              </Text>
            </View>
          </Pressable>
        ) : (
          <Button title={t('home.book')} onPress={() => startBooking()} />
        )}


        <View style={s.sectionHead}>
          <SectionTitle>{t('home.services')}</SectionTitle>
          <Text style={s.link} onPress={() => router.push('/services')}>
            {t('home.seeAll')}
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.md }}>
          {services.map((sv) => (
            <Pressable key={sv.id} onPress={() => startBooking(sv)} style={({ pressed }) => [s.svcCard, pressed && { opacity: 0.85 }]}>
              {sv.imageUrl ? (
                <Image source={{ uri: mediaUrl(sv.imageUrl)! }} style={s.svcImg} />
              ) : (
                <View style={[s.svcBadge, { backgroundColor: sv.color }]} />
              )}
              <Text style={s.svcName} numberOfLines={2}>
                {sv.name}
              </Text>
              <View style={s.svcFoot}>
                <Text style={s.svcPrice}>{priceText(sv)}</Text>
                <Text style={ui.muted}>{sv.durationMin} min</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {products.length ? (
          <>
            <View style={s.sectionHead}>
              <SectionTitle>Magazin</SectionTitle>
              <Text style={s.link} onPress={() => router.push(cartCount ? '/shop/cart' : '/shop')}>
                {cartCount ? `Coș (${cartCount})` : t('home.seeAll')}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.md }}>
              {products.slice(0, 8).map((p) => (
                <Pressable key={p.id} onPress={() => router.push('/shop')} style={({ pressed }) => [s.prodCard, pressed && { opacity: 0.85 }]}>
                  <ProductImage product={p} size={112} />
                  <Text style={s.prodName} numberOfLines={2}>
                    {p.name}
                  </Text>
                  <Text style={s.svcPrice}>{p.price} lei</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {!next ? null : (
          <View style={{ marginTop: space.lg }}>
            <Button title={t('home.newBooking')} onPress={() => startBooking()} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  content: { padding: space.md, paddingBottom: 120, gap: space.sm, width: '100%', maxWidth: 720, alignSelf: 'center' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  brand: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: 1 },
  brandItalic: { fontStyle: 'italic', fontFamily: 'Georgia', fontWeight: '700', color: colors.gold },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: colors.gold, borderRadius: radius.lg, padding: space.lg, gap: 4 },
  heroLabel: { color: colors.onGold, opacity: 0.7, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  heroTitle: { color: colors.onGold, fontSize: 30, fontWeight: '800', marginVertical: 2 },
  heroText: { color: colors.onGold, fontSize: 15, flexShrink: 1 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  link: { color: colors.gold, fontSize: 13, fontWeight: '600', marginBottom: space.xs },
  svcCard: { width: 168, height: 150, backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between' },
  svcBadge: { width: 28, height: 6, borderRadius: 3 },
  prodCard: { width: 136, backgroundColor: colors.card, borderRadius: radius.lg, padding: space.sm + 4, gap: 6, borderWidth: 1, borderColor: colors.border },
  prodName: { color: colors.text, fontSize: 14, fontWeight: '700', minHeight: 36 },
  svcImg: { width: 44, height: 44, borderRadius: radius.sm },
  logo: { width: 170, height: 40, marginTop: 2 },
  svcName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  svcFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  svcPrice: { color: colors.gold, fontSize: 16, fontWeight: '800' },
});
