import { Redirect, router } from 'expo-router';
import { Text, View } from 'react-native';
import { Avatar, Card, Screen, Steps, styles } from '@/components/ui';
import { useLoginGate } from '@/components/LoginGate';
import { useApp } from '@/state/AppState';
import { space } from '@/theme';

export default function ChooseBarber() {
  const { barbers, draft, setDraft, serviceById } = useApp();
  const gate = useLoginGate();
  const service = serviceById(draft.serviceId);
  if (gate) return gate;
  if (!service) return <Redirect href="/book/service" />;

  const pick = (barberId: string | null) => {
    setDraft({ barberId, start: null, slotBarberId: null });
    router.push('/book/time');
  };

  return (
    <Screen edges={[]}>
      <Steps current={2} />
      <Text style={[styles.muted, { marginBottom: space.sm }]}>
        {service.name} · {service.durationMin} min · {service.price} lei
      </Text>

      <Card onPress={() => pick(null)} selected={draft.barberId === null} style={rowStyle}>
        <Avatar />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Oricine e liber</Text>
          <Text style={styles.muted}>Îți arătăm toate orele disponibile</Text>
        </View>
      </Card>

      {barbers.map((b) => (
        <Card key={b.id} onPress={() => pick(b.id)} selected={draft.barberId === b.id} style={rowStyle}>
          <Avatar barber={b} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{b.name}</Text>
            <Text style={styles.muted}>{b.role}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const rowStyle = { flexDirection: 'row', alignItems: 'center', gap: space.md } as const;
