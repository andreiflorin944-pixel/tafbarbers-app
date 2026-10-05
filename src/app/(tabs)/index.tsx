import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, SectionTitle, styles as ui } from '@/components/ui';
import type { Service } from '@/data/types';
import { formatDate, formatTime } from '@/lib/dates';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export default function Home() {
  const { loading, user, bookings, services, barbers, serviceById, barberById, resetDraft, setDraft } = useApp();

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

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.gold} style={{ marginTop: 120 }} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.topBar}>
          <View>
            <Text style={ui.muted}>{user ? `Salut, ${user.name.split(' ')[0]}` : 'Bine ai venit la'}</Text>
            <Text style={s.brand}>
              TAF <Text style={s.brandItalic}>Barber’s</Text>
            </Text>
          </View>
          <Pressable onPress={() => router.push('/account')} hitSlop={10} accessibilityLabel="Cont" style={s.iconBtn}>
            <Ionicons name="person-outline" size={20} color={colors.text} />
          </Pressable>
        </View>

        {next ? (
          <Pressable onPress={() => router.push('/bookings')} style={s.hero}>
            <Text style={s.heroLabel}>URMĂTOAREA PROGRAMARE</Text>
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
          <View style={s.hero}>
            <Text style={s.heroLabel}>TUNS · BARBĂ · STIL</Text>
            <Text style={s.heroTitle}>Rezervă în 30 de secunde</Text>
            <Text style={[s.heroText, { marginBottom: space.md }]}>Alegi serviciul, frizerul și ora. Restul e treaba noastră.</Text>
            <Pressable onPress={() => startBooking()} style={({ pressed }) => [s.heroBtn, pressed && { opacity: 0.85 }]}>
              <Text style={s.heroBtnText}>Programează-te</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.gold} />
            </Pressable>
          </View>
        )}

        <View style={s.quickRow}>
          <Quick icon="calendar-outline" label="Programări" onPress={() => router.push('/bookings')} />
          <Quick icon="people-outline" label="Frizeri" onPress={() => router.push('/barbers')} />
          <Quick icon="cut-outline" label="Servicii" onPress={() => router.push('/services')} />
          <Quick icon="location-outline" label="Despre" onPress={() => router.push('/about')} />
        </View>

        <View style={s.sectionHead}>
          <SectionTitle>Servicii populare</SectionTitle>
          <Text style={s.link} onPress={() => router.push('/services')}>
            Vezi toate
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.md }}>
          {services.slice(0, 4).map((sv) => (
            <Pressable key={sv.id} onPress={() => startBooking(sv)} style={({ pressed }) => [s.svcCard, pressed && { opacity: 0.85 }]}>
              <View style={[s.svcBadge, { backgroundColor: sv.color }]} />
              <Text style={s.svcName} numberOfLines={2}>
                {sv.name}
              </Text>
              <View style={s.svcFoot}>
                <Text style={s.svcPrice}>{sv.price} lei</Text>
                <Text style={ui.muted}>{sv.durationMin} min</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        <SectionTitle>Echipa</SectionTitle>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {barbers.map((b) => (
            <Pressable key={b.id} onPress={() => router.push('/barbers')} style={s.barber}>
              <Avatar barber={b} size={52} />
              <View>
                <Text style={ui.cardTitle}>{b.name}</Text>
                <Text style={ui.muted}>{b.role}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {!next ? null : (
          <View style={{ marginTop: space.lg }}>
            <Button title="Programare nouă" onPress={() => startBooking()} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Quick({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.quick, pressed && { opacity: 0.8 }]}>
      <View style={s.quickIcon}>
        <Ionicons name={icon} size={22} color={colors.gold} />
      </View>
      <Text style={s.quickLabel}>{label}</Text>
    </Pressable>
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
  heroBtn: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: space.sm, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: space.lg, height: 48 },
  heroBtnText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  quickRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  quick: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: colors.card, borderRadius: radius.md, paddingVertical: space.md, borderWidth: 1, borderColor: colors.border },
  quickIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(249,161,27,0.12)', alignItems: 'center', justifyContent: 'center' },
  quickLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  link: { color: colors.gold, fontSize: 13, fontWeight: '600', marginBottom: space.xs },
  svcCard: { width: 168, height: 150, backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between' },
  svcBadge: { width: 28, height: 6, borderRadius: 3 },
  svcName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  svcFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  svcPrice: { color: colors.gold, fontSize: 16, fontWeight: '800' },
  barber: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.card, borderRadius: radius.lg, padding: space.sm, borderWidth: 1, borderColor: colors.border },
});
