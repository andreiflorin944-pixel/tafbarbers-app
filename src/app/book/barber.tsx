import { Redirect, router } from 'expo-router';
import { Text, View } from 'react-native';
import { Avatar, Button, Card, Empty, Screen, Steps, styles } from '@/components/ui';
import { useLoginGate } from '@/components/LoginGate';
import { barbersAt, doesService } from '@/lib/bookFlow';
import { barberPrice, lei, priceLabel } from '@/lib/price';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { space } from '@/theme';

// Pasul 2: frizerul, doar dintre cei care lucrează în locația aleasă (și fac serviciul, dacă e deja ales).
export default function ChooseBarber() {
  const { barbers, locations, draft, setDraft, serviceById, locationById } = useApp();
  const gate = useLoginGate();
  const { t } = useT();
  // Doar serviciul ales dinainte filtrează frizerii (cel ales la pasul 3 se poate schimba la întoarcere).
  const service = draft.presetService ? serviceById(draft.serviceId) : undefined;
  const location = locationById(draft.locationId);
  if (gate) return gate;
  if (!draft.locationId) return <Redirect href="/book/location" />;

  const here = barbersAt(barbers, draft.locationId, locations.length <= 1).filter((b) => !service || doesService(b, service.id));

  const pick = (barberId: string | null) => {
    setDraft({ barberId, start: null, slotBarberId: null });
    // Serviciul ales dinainte (de pe pagina lui): direct la oră.
    router.push(service ? '/book/time' : '/book/service');
  };

  return (
    <Screen edges={['bottom']}>
      <Steps current={2} />
      <Text style={[styles.muted, { marginBottom: space.sm }]}>
        {[location?.name, service ? `${service.name} · ${service.durationMin} min · ${priceLabel(service, here)}` : null].filter(Boolean).join(' · ')}
      </Text>

      {!here.length ? (
        <>
          <Empty icon="people-outline" text={t('book.noBarbers')} />
          <Button title={t('book.otherLocation')} variant="ghost" onPress={() => router.back()} />
        </>
      ) : null}

      {/* „Orice frizer” are rost doar când în locație sunt cel puțin doi. */}
      {here.length > 1 ? (
        <Card onPress={() => pick(null)} style={rowStyle}>
          <Avatar />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t('book.anyBarber')}</Text>
            <Text style={styles.muted}>{t('book.anyBarberSub')}</Text>
          </View>
        </Card>
      ) : null}

      {here.map((b) => (
        <Card key={b.id} onPress={() => pick(b.id)} selected={draft.barberId === b.id} style={rowStyle}>
          <Avatar barber={b} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{b.name}</Text>
            <Text style={styles.muted}>{b.role}</Text>
          </View>
          {service ? <Text style={styles.price}>{lei(barberPrice(service, b))}</Text> : null}
        </Card>
      ))}
    </Screen>
  );
}

const rowStyle = { flexDirection: 'row', alignItems: 'center', gap: space.md } as const;
