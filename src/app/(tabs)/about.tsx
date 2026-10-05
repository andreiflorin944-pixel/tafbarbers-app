import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { router } from 'expo-router';
import { Linking, Pressable, Text, View } from 'react-native';
import { Card, Logo, Screen, SectionTitle, styles } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

const DAY_NAMES = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];

export default function About() {
  const { business } = useApp();
  if (!business) return null;

  return (
    <Screen tab>
      <View style={{ paddingHorizontal: 72, paddingVertical: space.lg }}>
        <Logo size={0.6} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.md, marginBottom: space.md }}>
        {business.instagram ? <Social icon="logo-instagram" url={`https://instagram.com/${business.instagram}`} /> : null}
        {business.facebook ? <Social icon="logo-facebook" url={business.facebook} /> : null}
        {business.tiktok ? <Social icon="logo-tiktok" url={business.tiktok} /> : null}
        {business.website ? <Social icon="globe-outline" url={business.website} /> : null}
      </View>

      <Card style={{ gap: space.sm }}>
        <Text style={[styles.title, { fontSize: 24 }]}>{business.name}</Text>
        <Text style={[styles.text, { color: colors.gold, textDecorationLine: 'underline' }]} onPress={() => Linking.openURL(business.website)}>
          {business.website.replace('https://', '')}
        </Text>
        <Text style={[styles.text, { lineHeight: 22, marginTop: space.sm }]}>{business.description}</Text>
      </Card>

      <SectionTitle>Program</SectionTitle>
      <Card style={{ gap: 6 }}>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const h = business.hours[d];
          return (
            <View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.text}>{DAY_NAMES[d]}</Text>
              <Text style={h ? styles.text : styles.muted}>{h ? `${h.open} – ${h.close}` : 'Închis'}</Text>
            </View>
          );
        })}
      </Card>

      {business.address ? (
        <>
          <SectionTitle>Locație</SectionTitle>
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

      <SectionTitle>Informații legale</SectionTitle>
      <Card style={{ gap: space.sm }}>
        <Text style={[styles.text, { color: colors.gold }]} onPress={() => router.push('/legal/terms')}>
          Termeni și condiții
        </Text>
        <Text style={[styles.text, { color: colors.gold }]} onPress={() => router.push('/legal/privacy')}>
          Politica de confidențialitate (GDPR)
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
