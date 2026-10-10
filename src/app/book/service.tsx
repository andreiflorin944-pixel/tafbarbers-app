import { Redirect, router } from 'expo-router';
import { Text } from 'react-native';
import { Button, Empty, Screen, ServiceRow, Steps, styles } from '@/components/ui';
import { useLoginGate } from '@/components/LoginGate';
import { barbersAt, servicesFor } from '@/lib/bookFlow';
import { barberDuration, barberPrice, lei, priceLabel } from '@/lib/price';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { space } from '@/theme';

// Pasul 3: serviciul. Cu frizer ales, doar serviciile lui, cu prețul și durata lui; cu „orice frizer”,
// serviciile pe care le face măcar un frizer din locație.
export default function ChooseService() {
  const { services, barbers, locations, setDraft, draft, barberById, locationById } = useApp();
  const gate = useLoginGate();
  const { t } = useT();
  if (gate) return gate;
  const barber = barberById(draft.barberId);
  if (!draft.locationId && !barber) return <Redirect href="/book/location" />;

  const locationId = draft.locationId ?? barber?.locationId ?? null;
  const here = barbersAt(barbers, locationId, locations.length <= 1);
  const list = servicesFor(services, barber, here);
  const location = locationById(locationId);

  return (
    <Screen edges={['bottom']}>
      <Steps current={3} />
      <Text style={[styles.muted, { marginBottom: space.sm }]}>
        {[location?.name, barber ? barber.name : t('book.anyBarber')].filter(Boolean).join(' · ')}
      </Text>
      {!list.length ? (
        <>
          <Empty icon="cut-outline" text={t('book.noServices')} />
          <Button title={t('nav.pickBarber')} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/book/location'))} />
        </>
      ) : null}
      {list.map((s) => (
        <ServiceRow
          key={s.id}
          service={s}
          selected={draft.serviceId === s.id}
          price={barber ? lei(barberPrice(s, barber)) : priceLabel(s, here)}
          duration={barber ? barberDuration(s, barber) : undefined}
          onPress={() => {
            setDraft({ serviceId: s.id, start: null, slotBarberId: null });
            router.push('/book/time');
          }}
        />
      ))}
    </Screen>
  );
}
