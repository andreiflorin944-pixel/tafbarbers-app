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
import { Avatar, Button, SectionTitle, styles as ui } from '@/components/ui';
import type { Promo, Service } from '@/data/types';
import { whatsappUrl } from '@/lib/contact';
import { useT } from '@/i18n';
import { formatDate, formatTime } from '@/lib/dates';
import { usePriceLabel } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

export default function Home() {
  const { business, loading, loadError, reload, user, bookings, services, barbers, promos, serviceById, barberById, resetDraft, setDraft } = useApp();
  const { t, lang } = useT();
  const priceText = usePriceLabel();
  const { staff } = useStaff();
  const { products, count: cartCount } = useCart();
  const look = business?.appearance;
  const logo = mediaUrl(look?.logoUrl);
  const welcome = look?.welcome?.[lang as 'ro' | 'en' | 'fr'];

  const next = bookings
    .filter((b) => (b.status === 'confirmed' || b.status === 'requested') && new Date(b.start).getTime() > Date.now())
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
            {next.status === 'requested' ? (
              <View style={s.heroRow}>
                <Ionicons name="hourglass-outline" size={16} color={colors.onGold} />
                <Text style={s.heroText}>{t('bookings.pending')}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : (
          <Button title={t('home.book')} onPress={() => startBooking()} />
        )}

        <View style={s.quick}>
          {(
            [
              ['gift-outline', 'home.q.rewards', '/rewards'],
              ['card-outline', 'home.q.gift', '/gift-cards'],
              ['ribbon-outline', 'home.q.subs', '/subscriptions'],
              ['bag-handle-outline', 'home.q.shop', '/shop'],
            ] as const
          ).map(([icon, key, to]) => (
            <Pressable key={key} onPress={() => router.push(to)} style={({ pressed }) => [s.quickItem, pressed && { opacity: 0.7 }]} accessibilityRole="button">
              <View style={s.quickIcon}>
                <Ionicons name={icon} size={22} color={colors.gold} />
              </View>
              <Text style={s.quickText} numberOfLines={1}>
                {t(key)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => router.push('/assistant')} style={({ pressed }) => [s.invite, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <View style={s.quickIcon}>
            <Ionicons name="mic-outline" size={22} color={colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.svcName}>{t('home.assistant')}</Text>
            <Text style={[ui.muted, { fontSize: 13 }]}>{t('home.assistantText')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>

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
                <View style={[s.svcIcon, { backgroundColor: sv.color + '26' }]}>
                  <Ionicons name="cut" size={20} color={sv.color} />
                </View>
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

        {barbers.length ? (
          <>
            <View style={s.sectionHead}>
              <SectionTitle>{t('home.team')}</SectionTitle>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.md }}>
              {barbers.map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => {
                    resetDraft();
                    setDraft({ barberId: b.id });
                    router.push('/book/service');
                  }}
                  style={({ pressed }) => [s.barberCard, pressed && { opacity: 0.85 }]}
                >
                  <Avatar barber={b} size={64} />
                  <Text style={s.svcName} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <Text style={[ui.muted, { fontSize: 12 }]} numberOfLines={1}>
                    {b.role}
                  </Text>
                  <Text style={s.barberCta}>{t('home.bookWith')} ›</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {user ? (
          <Pressable onPress={() => router.push('/rewards')} style={({ pressed }) => [s.invite, pressed && { opacity: 0.85 }]}>
            <View style={s.quickIcon}>
              <Ionicons name="people-outline" size={22} color={colors.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.svcName}>{t('home.invite')}</Text>
              <Text style={[ui.muted, { fontSize: 13 }]}>{t('home.inviteText')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ) : null}

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

        {business?.address || business?.phone ? (
          <View style={s.visit}>
            <Text style={s.visitLabel}>{t('home.visit')}</Text>
            {business.address ? <Text style={[ui.text, { fontSize: 15 }]}>{business.address}</Text> : null}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
              {business.phone ? (
                <Pressable onPress={() => Linking.openURL(`tel:${business.phone}`)} style={s.pill} accessibilityRole="button">
                  <Ionicons name="call-outline" size={16} color={colors.gold} />
                  <Text style={s.pillText}>{t('home.call')}</Text>
                </Pressable>
              ) : null}
              {business.phone && whatsappUrl(business.phone) ? (
                <Pressable onPress={() => Linking.openURL(whatsappUrl(business.phone)!)} style={s.pill} accessibilityRole="button">
                  <Ionicons name="logo-whatsapp" size={16} color={colors.gold} />
                  <Text style={s.pillText}>{t('home.whatsapp')}</Text>
                </Pressable>
              ) : null}
              {business.address ? (
                <Pressable
                  onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${business.name} ${business.address}`)}`)}
                  style={s.pill}
                  accessibilityRole="button"
                >
                  <Ionicons name="navigate-outline" size={16} color={colors.gold} />
                  <Text style={s.pillText}>{t('home.directions')}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
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
  svcIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  quick: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: space.sm },
  quickItem: { alignItems: 'center', gap: 6, flex: 1 },
  quickIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  quickText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  barberCard: { width: 132, backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, gap: 4, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  barberCta: { color: colors.gold, fontSize: 13, fontWeight: '700', marginTop: 4 },
  invite: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.goldDark, marginTop: space.sm },
  visit: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, marginTop: space.lg, gap: 4 },
  visitLabel: { color: colors.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  pillText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  prodCard: { width: 136, backgroundColor: colors.card, borderRadius: radius.lg, padding: space.sm + 4, gap: 6, borderWidth: 1, borderColor: colors.border },
  prodName: { color: colors.text, fontSize: 14, fontWeight: '700', minHeight: 36 },
  svcImg: { width: 44, height: 44, borderRadius: radius.sm },
  logo: { width: 170, height: 40, marginTop: 2 },
  svcName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  svcFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  svcPrice: { color: colors.gold, fontSize: 16, fontWeight: '800' },
});
