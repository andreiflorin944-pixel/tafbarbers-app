import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Animated, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api';
import type { NextFree } from '@/api/client';
import { mediaUrl } from '@/api/staff';
import { Backdrop } from '@/components/Backdrop';
import { LangButton } from '@/components/LangButton';
import { PayDueBanner } from '@/components/PayDue';
import { useCart } from '@/state/Cart';
import { Button, styles as ui } from '@/components/ui';
import type { Product, Promo, Service } from '@/data/types';
import { whatsappUrl } from '@/lib/contact';
import { useT } from '@/i18n';
import { formatDayLong, formatTime } from '@/lib/dates';
import { barberDuration, barberPrice, lei } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Pozele de exemplu din cardul TAF Identity: tunsorile generate cu AI pe care serverul le servește deja consilierului.
const IDENTITY_STYLES = ['textured_crop', 'skin_fade', 'quiff'];

// Beneficiile clientului, în grila 2×2.
const PERKS: Array<[IconName, 'home.q.rewards' | 'home.q.gift' | 'home.q.subs' | 'home.q.shop', '/rewards' | '/gift-cards' | '/subscriptions' | '/shop']> = [
  ['gift-outline', 'home.q.rewards', '/rewards'],
  ['card-outline', 'home.q.gift', '/gift-cards'],
  ['calendar-number-outline', 'home.q.subs', '/subscriptions'],
  ['bag-handle-outline', 'home.q.shop', '/shop'],
];

/** Prima literă mare: „miercuri, 14 oct” → „Miercuri, 14 oct”. */
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Home() {
  const { business, loading, loadError, reload, user, token, bookings, promos, serviceById, barberById, resetDraft, setDraft } = useApp();
  const { t, lang } = useT();
  const { staff } = useStaff();
  const { products, count: cartCount } = useCart();
  const look = business?.appearance;
  const logo = mediaUrl(look?.logoUrl);
  const welcome = look?.welcome?.[lang as 'ro' | 'en' | 'fr'];
  // Pozele de exemplu care nu s-au putut încărca (ex. încă negenerate): în locul lor, un chenar cu iconiță.
  const [brokenStyles, setBrokenStyles] = useState<string[]>([]);
  // Pe telefoanele înguste, etichetele din „Beneficiile tale” puțin mai mici, ca să nu fie tăiate.
  const narrow = useWindowDimensions().width < 380;

  // Eticheta „Vorbește cu TAF” apare câteva secunde când se deschide pagina, apoi dispare încet; butonul rămâne.
  const tipOpacity = useRef(new Animated.Value(1)).current;
  const [tipShown, setTipShown] = useState(true);
  useEffect(() => {
    if (loading) return;
    const anim = Animated.timing(tipOpacity, { toValue: 0, duration: 500, delay: TIP_MS, useNativeDriver: Platform.OS !== 'web' });
    anim.start(({ finished }) => finished && setTipShown(false));
    return () => anim.stop();
  }, [loading, tipOpacity]);

  // Prima oră liberă (la orice frizer): se reîncarcă de fiecare dată când revii pe prima pagină (ex. după o programare).
  const [free, setFree] = useState<NextFree | null>(null);
  const bookingsKey = bookings.map((b) => b.id + b.status).join();
  useFocusEffect(
    useCallback(() => {
      let on = true;
      api.getNextFree({ token }).then((f) => on && setFree(f), () => on && setFree(null));
      return () => {
        on = false;
      };
    }, [token, bookingsKey]),
  );
  const freeBarber = free ? barberById(free.barberId) : undefined;
  const freeService = free ? serviceById(free.serviceId) : undefined;
  const bookFree = () => {
    if (!free) return;
    // Ora e deja aleasă: direct la confirmare (frizerul și locația vin din oră).
    resetDraft();
    setDraft({ serviceId: free.serviceId, presetService: true, locationId: freeBarber?.locationId ?? null, barberId: null, start: free.start, slotBarberId: free.barberId });
    router.push('/book/confirm');
  };

  const startBooking = (service?: Service) => {
    resetDraft();
    // Întâi locația; cu serviciul deja ales (banner, card de serviciu), pasul „Serviciul” se sare.
    if (service) setDraft({ serviceId: service.id, presetService: true });
    router.push('/book/location');
  };

  const openPromo = (p: Promo) => {
    if (p.action.type === 'service') return startBooking(serviceById(p.action.serviceId));
    if (p.action.type === 'url') return Linking.openURL(p.action.url);
    // Ofertă de produs: magazinul, cu produsul ales primul.
    if (p.action.type === 'shop') return router.push(p.action.productId ? { pathname: '/shop', params: { product: p.action.productId } } : '/shop');
    startBooking();
  };

  // „Recomandarea TAF”: toate bannerele active din panou, întâi cele cu produs din magazin, apoi celelalte în ordinea lor.
  const picks = [...promos.filter((p) => p.action.type === 'shop'), ...promos.filter((p) => p.action.type !== 'shop')];

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
        <Text style={[ui.text, { textAlign: 'center' }]}>{t('home.offline')}</Text>
        <Button title={t('common.retry')} onPress={reload} />
      </SafeAreaView>
    );
  }

  // „Salut, Florin.”: numele în culoarea principală, restul alb (ordinea vine din traducere).
  const firstName = user ? (user.name || user.phone).split(' ')[0] : '';
  const [hiBefore, hiAfter = ''] = t('home.hi', { name: '\u0001' }).split('\u0001');
  const openAddress = () => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${business?.name ?? ''} ${business?.address ?? ''}`)}`);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Backdrop />
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.topBar}>
          {logo ? (
            <Image source={{ uri: logo }} style={s.logo} resizeMode="contain" accessibilityLabel={look?.title} />
          ) : look?.title && look.title !== 'TAF Barber’s' ? (
            <Text style={s.brand}>{look.title}</Text>
          ) : (
            <Text style={s.brand}>
              TAF <Text style={s.brandItalic}>Barber’s</Text>
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            {staff ? (
              <Pressable onPress={() => router.push('/staff')} hitSlop={6} accessibilityLabel={t('home.teamAgenda')} style={s.iconBtn}>
                <Ionicons name="calendar-outline" size={24} color={colors.gold} />
              </Pressable>
            ) : null}
            <LangButton />
            <Pressable onPress={() => router.push('/account')} hitSlop={6} accessibilityLabel={t('tab.account')} style={s.iconBtn}>
              <Ionicons name="person-outline" size={26} color={colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={s.greeting}>
          {user ? (
            <Text style={s.hello}>
              {hiBefore}
              <Text style={{ color: colors.gold }}>{firstName}</Text>
              {hiAfter}
            </Text>
          ) : (
            <Text style={s.hello}>{t('home.welcome')}</Text>
          )}
          {/* Fără cont: textul de bun venit din panou (dacă e scris), sub salut. */}
          <Text style={s.helloSub}>{!user && welcome ? welcome : t('home.sub')}</Text>
        </View>

        {/* Salonul a cerut plata în aplicație: „Ai de plătit X lei · Plătește acum”. */}
        {user ? <PayDueBanner refresh /> : null}

        {free ? (
          <View style={s.card}>
            <Text style={s.kicker}>{t('home.firstFree')}</Text>
            <Text style={s.freeTime}>{formatTime(new Date(free.start))}</Text>
            <Text style={s.freeDate}>{capital(formatDayLong(new Date(free.start)))}</Text>
            <Text style={s.freeMeta} numberOfLines={1}>
              {[freeBarber?.name, freeService?.name].filter(Boolean).join('  ·  ')}
            </Text>
            {freeService ? (
              <Text style={s.freeMeta}>
                {lei(barberPrice(freeService, freeBarber))} · {t('common.min', { n: barberDuration(freeService, freeBarber) })}
              </Text>
            ) : null}
            <Pressable onPress={bookFree} style={({ pressed }) => [s.bookBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              <Text style={s.bookBtnText}>{t('home.bookAt', { time: formatTime(new Date(free.start)) })}</Text>
            </Pressable>
            <Text style={s.otherTime} onPress={() => startBooking()} accessibilityRole="link">
              {t('home.otherTime')}
            </Text>
          </View>
        ) : (
          <Button title={t('home.book')} onPress={() => startBooking()} />
        )}

        {/* Asistentul: spui când vrei să vii și te programează el. */}
        <Pressable onPress={() => router.push('/assistant')} style={({ pressed }) => [s.card, s.rowCard, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <MaterialCommunityIcons name="waveform" size={36} color={colors.gold} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.cardTitle}>{t('home.assistantTitle')}</Text>
            <Text style={s.small}>{t('home.assistantSub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        {/* TAF Identity: pozele și dorințele clientului; pozele de exemplu duc la consilierul AI, când e pornit în panou. */}
        <View style={s.card}>
          <Pressable onPress={() => router.push('/identity')} style={({ pressed }) => [{ gap: 2 }, pressed && { opacity: 0.8 }]} accessibilityRole="button">
            <Text style={s.kicker}>{t('home.identityKicker')}</Text>
            <Text style={s.identityTitle}>{t('home.identityTitle')}</Text>
            <Text style={s.body}>{business?.advisor ? t('home.identityText') : t('home.identityTextNoAi')}</Text>
          </Pressable>
          <Pressable onPress={() => router.push(business?.advisor ? '/advisor' : '/identity')} style={s.photos} accessibilityRole="button" accessibilityLabel={business?.advisor ? t('advisor.title') : t('home.identityCta')}>
            {IDENTITY_STYLES.map((key) =>
              brokenStyles.includes(key) ? (
                <View key={key} style={[s.photo, s.photoEmpty]}>
                  <Ionicons name="cut-outline" size={26} color={colors.goldDark} />
                </View>
              ) : (
                <Image
                  key={key}
                  source={{ uri: mediaUrl(`/v1/advisor/style/${key}?bw=1`)! }}
                  style={s.photo}
                  resizeMode="cover"
                  onError={() => setBrokenStyles((b) => (b.includes(key) ? b : [...b, key]))}
                />
              ),
            )}
          </Pressable>
          <Pressable onPress={() => router.push('/identity')} style={({ pressed }) => [s.row, { marginTop: space.xs, alignSelf: 'flex-start', paddingVertical: 4 }, pressed && { opacity: 0.7 }]} accessibilityRole="link">
            <Text style={s.accentLink}>{t('home.identityCta')}</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.gold} />
          </Pressable>
        </View>

        {picks.length ? (
          <>
            <Text style={s.section}>{t('home.recommended')}</Text>
            <PromoPager promos={picks} products={products} onPress={openPromo} />
          </>
        ) : null}

        <Text style={s.section}>{t('home.perks')}</Text>
        <View style={s.perks}>
          {PERKS.map(([icon, key, to]) => (
            <Pressable key={key} onPress={() => router.push(to)} style={({ pressed }) => [s.perk, pressed && { opacity: 0.8 }]} accessibilityRole="button">
              <Ionicons name={icon} size={22} color={colors.gold} />
              <Text style={[s.perkText, narrow && { fontSize: 13 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {t(key)}
              </Text>
              {to === '/shop' && cartCount ? (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{cartCount}</Text>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          ))}
        </View>

        {/* Fără cont, „Adu un prieten” duce întâi la intrare / cont nou, apoi la recomandări. */}
        <Pressable
          onPress={() => (user ? router.push('/rewards') : router.push({ pathname: '/login', params: { next: '/rewards' } }))}
          style={({ pressed }) => [s.card, s.rowCard, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          <Ionicons name="people-outline" size={32} color={colors.text} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.cardTitle}>{t('home.invite')}</Text>
            <Text style={s.small}>{t('home.inviteText')}</Text>
            <View style={[s.row, { marginTop: 4 }]}>
              <Text style={[s.accentLink, { fontSize: 14 }]}>{t('home.inviteCta')}</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.gold} />
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        {business?.address || business?.phone ? (
          <>
            <Text style={s.section}>{t('home.visit')}</Text>
            {business.address ? (
              <Pressable onPress={openAddress} style={[s.row, { gap: space.sm, paddingVertical: space.xs }]} accessibilityRole="link">
                <Ionicons name="location" size={20} color={colors.text} />
                <Text style={[ui.text, { flex: 1, fontSize: 16 }]}>{business.address}</Text>
              </Pressable>
            ) : null}
            <View style={s.pills}>
              {business.address ? (
                <Pressable onPress={openAddress} style={({ pressed }) => [s.pill, pressed && { opacity: 0.8 }]} accessibilityRole="button">
                  <Ionicons name="navigate" size={16} color={colors.text} />
                  <Text style={[s.pillText, narrow && { fontSize: 13 }]}>{t('home.directions')}</Text>
                </Pressable>
              ) : null}
              {business.phone ? (
                <Pressable onPress={() => Linking.openURL(`tel:${business.phone}`)} style={({ pressed }) => [s.pill, pressed && { opacity: 0.8 }]} accessibilityRole="button">
                  <Ionicons name="call" size={16} color={colors.text} />
                  <Text style={[s.pillText, narrow && { fontSize: 13 }]}>{t('home.call')}</Text>
                </Pressable>
              ) : null}
              {business.phone && whatsappUrl(business.phone) ? (
                <Pressable onPress={() => Linking.openURL(whatsappUrl(business.phone)!)} style={({ pressed }) => [s.pill, pressed && { opacity: 0.8 }]} accessibilityRole="button">
                  <Ionicons name="logo-whatsapp" size={16} color={colors.text} />
                  <Text style={[s.pillText, narrow && { fontSize: 13 }]}>{t('home.whatsapp')}</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Asistentul la îndemână, deasupra barei de taburi (ecranul se termină deasupra ei), oricât derulezi. */}
      <View style={s.fab} pointerEvents="box-none">
        {tipShown ? (
          <Animated.View style={{ opacity: tipOpacity }}>
            <Pressable onPress={() => router.push('/assistant')} style={s.fabTip} accessibilityElementsHidden importantForAccessibility="no">
              <Text style={s.fabTipText}>{t('home.talk')}</Text>
            </Pressable>
          </Animated.View>
        ) : null}
        <Pressable
          onPress={() => router.push('/assistant')}
          style={({ pressed }) => [s.fabMic, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={t('home.talk')}
        >
          <Ionicons name="mic" size={26} color={colors.onGold} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/**
 * „Recomandarea TAF”: bannerele din panou ca un șir de carduri orizontale (poză în stânga, text în dreapta),
 * câte unul pe toată lățimea; tragi spre stânga pentru următorul. Punctele apar doar când sunt mai multe.
 */
function PromoPager({ promos, products, onPress }: { promos: Promo[]; products: Product[]; onPress: (p: Promo) => void }) {
  const { width: screen } = useWindowDimensions();
  const width = Math.min(screen, 720) - space.md * 2;
  const [index, setIndex] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width));

  return (
    <View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32} style={{ width }}>
        {promos.map((p) => {
          // Poza bannerului; la un produs din magazin fără poză de banner, poza produsului.
          const productId = p.action.type === 'shop' ? p.action.productId : null;
          const product = productId ? products.find((x) => x.id === productId) : undefined;
          const image = mediaUrl(p.imageUrl) ?? mediaUrl(product?.imageUrl);
          return (
            <Pressable key={p.id} onPress={() => onPress(p)} style={({ pressed }) => [s.card, s.pick, { width }, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              {image ? (
                <Image source={{ uri: image }} style={s.pickImg} resizeMode="cover" accessibilityLabel={product?.name ?? p.title} />
              ) : (
                <View style={[s.pickImg, s.photoEmpty, { borderWidth: 0 }]}>
                  <Ionicons name={`${p.icon}-outline` as IconName} size={40} color={colors.goldDark} />
                </View>
              )}
              <View style={s.pickBody}>
                {p.kicker ? (
                  <Text style={[s.kicker, s.pickKicker]} numberOfLines={2}>
                    {p.kicker}
                  </Text>
                ) : null}
                <Text style={s.cardTitle} numberOfLines={2}>
                  {p.title}
                </Text>
                {p.text ? (
                  <Text style={s.small} numberOfLines={3}>
                    {p.text}
                  </Text>
                ) : null}
                <View style={[s.row, { marginTop: space.sm }]}>
                  <Text style={[s.accentLink, { flexShrink: 1 }]} numberOfLines={1}>
                    {p.cta}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.gold} />
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {promos.length > 1 ? (
        <View style={s.dots}>
          {promos.map((p, i) => (
            <View key={p.id} style={[s.dot, i === index && { backgroundColor: colors.gold, width: 16 }]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// Butonul rotund al asistentului: cât e de mare și cât stă deasupra barei de taburi.
const FAB = 56;
const FAB_GAP = space.md;
const TIP_MS = 4000;

const s = StyleSheet.create({
  // Jos lăsăm loc pentru butonul asistentului și eticheta lui, ca ultimul rând (butoanele de contact) să rămână deasupra lor.
  content: { padding: space.md, paddingBottom: FAB + FAB_GAP + 32 + space.xl + space.md, gap: 12, width: '100%', maxWidth: 720, alignSelf: 'center' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  brand: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  brandItalic: { fontStyle: 'italic', fontFamily: 'Georgia', fontWeight: '700', color: colors.gold },
  logo: { width: 150, height: 36 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  greeting: { marginTop: space.xs, marginBottom: space.xs },
  hello: { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  helloSub: { color: colors.text, opacity: 0.85, fontSize: 18, marginTop: 2 },
  card: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  kicker: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  small: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  body: { color: colors.text, opacity: 0.85, fontSize: 15, lineHeight: 21 },
  meta: { color: colors.muted, fontSize: 14 },
  freeTime: { color: colors.text, fontSize: 60, lineHeight: 68, fontWeight: '800', letterSpacing: -1.5, marginTop: 2 },
  freeDate: { color: colors.text, fontSize: 20, fontWeight: '700' },
  freeMeta: { color: colors.text, opacity: 0.8, fontSize: 16, marginTop: 2 },
  bookBtn: { height: 50, borderRadius: 12, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', marginTop: space.md },
  bookBtnText: { color: colors.onGold, fontSize: 17, fontWeight: '800' },
  otherTime: { color: colors.muted, fontSize: 14, textDecorationLine: 'underline', alignSelf: 'center', marginTop: space.sm, padding: space.xs },
  identityTitle: { color: colors.text, fontSize: 21, fontWeight: '800', marginTop: 2, marginBottom: 2 },
  photos: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  photo: { flex: 1, aspectRatio: 1.05, borderRadius: 12, backgroundColor: colors.cardAlt },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  accentLink: { color: colors.gold, fontSize: 16, fontWeight: '600' },
  section: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: space.md },
  pick: { flexDirection: 'row', padding: 0, overflow: 'hidden' },
  pickImg: { width: '40%', minHeight: 156, backgroundColor: colors.cardAlt },
  pickBody: { flex: 1, padding: space.md, gap: 4, justifyContent: 'center' },
  pickKicker: { letterSpacing: 0.8, fontSize: 11 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  perks: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  perk: { flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: 8, height: 56, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  perkText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.onGold, fontSize: 12, fontWeight: '800' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  pillText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  fab: { position: 'absolute', right: space.md, bottom: FAB_GAP, alignItems: 'flex-end', gap: 6 },
  fabTip: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10, marginRight: FAB / 2 },
  fabTipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  fabMic: { width: FAB, height: FAB, borderRadius: FAB / 2, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
});
