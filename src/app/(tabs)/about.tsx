import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { router } from 'expo-router';
import { Linking, Pressable, Text, View } from 'react-native';
import { Card, Logo, Screen, SectionTitle, styles } from '@/components/ui';
import { socialUrl, whatsappUrl } from '@/lib/contact';
import { dayName } from '@/lib/dates';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function About() {
  const { business, user } = useApp();
  const { t } = useT();
  if (!business) return null;

  return (
    <Screen tab>
      <View style={{ paddingHorizontal: 72, paddingVertical: space.lg }}>
        <Logo size={0.6} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.md, marginBottom: space.md }}>
        {socialUrl('instagram', business.instagram) ? <Social icon="logo-instagram" url={socialUrl('instagram', business.instagram)!} /> : null}
        {socialUrl('facebook', business.facebook) ? <Social icon="logo-facebook" url={socialUrl('facebook', business.facebook)!} /> : null}
        {socialUrl('tiktok', business.tiktok) ? <Social icon="logo-tiktok" url={socialUrl('tiktok', business.tiktok)!} /> : null}
        {business.phone && whatsappUrl(business.phone) ? <Social icon="logo-whatsapp" url={whatsappUrl(business.phone)!} /> : null}
        {business.website ? <Social icon="globe-outline" url={business.website} /> : null}
      </View>

      {/* Promo „Urmărește-ne pe rețele și ai X% reducere” (pornit din panou), sub iconițele rețelelor; dispare după deblocare. */}
      {business.socialPromo && !user?.socialPromoClaimed ? (
        <Card onPress={() => router.push('/social')} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: colors.gold, marginBottom: space.md }}>
          <Text style={{ color: colors.gold, fontSize: 28, fontWeight: '800', minWidth: 72, textAlign: 'center' }}>-{business.socialPromo.percent}%</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.muted, { fontSize: 12, fontWeight: '600', letterSpacing: 1.2 }]}>{t('social.kicker')}</Text>
            <Text style={styles.cardTitle}>{t('social.homeTitle', { n: business.socialPromo.percent })}</Text>
            <Text style={[styles.muted, { fontSize: 13 }]}>{t('social.homeText')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Card>
      ) : null}

      <Card style={{ gap: space.sm }}>
        <Text style={[styles.title, { fontSize: 24 }]}>{business.name}</Text>
        <Text style={[styles.text, { color: colors.gold, textDecorationLine: 'underline' }]} onPress={() => Linking.openURL(business.website)}>
          {business.website.replace('https://', '')}
        </Text>
        <Text style={[styles.text, { lineHeight: 22, marginTop: space.sm }]}>{business.description}</Text>
      </Card>

      <SectionTitle>{t('about.hours')}</SectionTitle>
      <Card style={{ gap: 6 }}>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const h = business.hours[d];
          return (
            <View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[styles.text, { textTransform: 'capitalize' }]}>{dayName(d, true)}</Text>
              <Text style={h ? styles.text : styles.muted}>{h ? `${h.open} – ${h.close}` : t('about.closed')}</Text>
            </View>
          );
        })}
      </Card>

      {business.address ? (
        <>
          <SectionTitle>{t('about.location')}</SectionTitle>
          <Card style={styles.row} onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(business.address)}`)}>
            <Ionicons name="location" size={18} color={colors.gold} />
            <Text style={[styles.text, { flex: 1 }]}>{business.address}</Text>
          </Card>
        </>
      ) : null}
      {business.phone ? (
        <Card style={[styles.row, { marginTop: space.sm }]} onPress={() => Linking.openURL(`tel:${business.phone}`)}>
          <Ionicons name="call" size={18} color={colors.gold} />
          <Text style={styles.text}>{business.phone}</Text>
        </Card>
      ) : null}
      {business.phone && whatsappUrl(business.phone) ? (
        <Card style={[styles.row, { marginTop: space.sm }]} onPress={() => Linking.openURL(whatsappUrl(business.phone)!)}>
          <Ionicons name="logo-whatsapp" size={18} color={colors.gold} />
          <Text style={styles.text}>{t('about.whatsapp')}</Text>
        </Card>
      ) : null}

      <SectionTitle>{t('about.legal')}</SectionTitle>
      <Card style={{ gap: space.sm }}>
        <Text style={[styles.text, { color: colors.gold }]} onPress={() => router.push('/legal/terms')}>
          {t('about.terms')}
        </Text>
        <Text style={[styles.text, { color: colors.gold }]} onPress={() => router.push('/legal/privacy')}>
          {t('about.privacy')}
        </Text>
      </Card>
    </Screen>
  );
}

function Social({ icon, url }: { icon: ComponentProps<typeof Ionicons>['name']; url: string }) {
  return (
    <Pressable
      onPress={() => Linking.openURL(url)}
      style={({ pressed }) => ({ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
    >
      <Ionicons name={icon} size={30} color={colors.onGold} />
    </Pressable>
  );
}
