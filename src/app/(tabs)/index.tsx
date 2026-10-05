import { router } from 'expo-router';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { Avatar, Button, Card, Icon, Screen, SectionTitle, ServiceRow, styles } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

const DAY_NAMES = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];

export default function Home() {
  const { business, services, barbers, loading, resetDraft, setDraft } = useApp();

  if (loading || !business) {
    return (
      <Screen scroll={false}>
        <ActivityIndicator color={colors.gold} style={{ marginTop: 80 }} />
      </Screen>
    );
  }

  const startBooking = (serviceId?: string) => {
    resetDraft();
    if (serviceId) {
      setDraft({ serviceId });
      router.push('/book/barber');
    } else {
      router.push('/services');
    }
  };

  return (
    <Screen>
      <View style={{ alignItems: 'center', paddingVertical: space.lg, gap: space.xs }}>
        <Text style={{ color: colors.gold, fontSize: 40, fontWeight: '800', letterSpacing: 4 }}>TAF</Text>
        <Text style={{ color: colors.text, fontSize: 14, letterSpacing: 6 }}>BARBERS</Text>
      </View>

      <Card>
        <Text style={[styles.text, { lineHeight: 22 }]}>{business.description}</Text>
      </Card>

      <View style={{ marginTop: space.md }}>
        <Button title="Programează-te" onPress={() => startBooking()} />
      </View>

      <SectionTitle>Servicii populare</SectionTitle>
      {services.slice(0, 3).map((s) => (
        <ServiceRow key={s.id} service={s} onPress={() => startBooking(s.id)} />
      ))}

      <SectionTitle>Echipa</SectionTitle>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {barbers.map((b) => (
          <Card key={b.id} style={{ flex: 1, alignItems: 'center', gap: space.sm }}>
            <Avatar barber={b} />
            <Text style={styles.cardTitle}>{b.name}</Text>
            <Text style={styles.muted}>{b.role}</Text>
          </Card>
        ))}
      </View>

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

      <SectionTitle>Contact</SectionTitle>
      <Card style={{ gap: space.sm }}>
        <View style={styles.row}>
          <Icon name="location" />
          <Text style={styles.text}>{business.address}</Text>
        </View>
        <View style={styles.row}>
          <Icon name="logo-instagram" />
          <Text style={[styles.text, { color: colors.gold }]} onPress={() => Linking.openURL(`https://instagram.com/${business.instagram}`)}>
            @{business.instagram}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
