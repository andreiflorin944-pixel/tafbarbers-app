import { router } from 'expo-router';
import { Screen, ServiceRow, Title } from '@/components/ui';
import { useApp } from '@/state/AppState';

export default function Services() {
  const { services } = useApp();

  return (
    <Screen tab>
      <Title sub="Prețuri și durate">Servicii</Title>
      {services.map((s) => (
        <ServiceRow key={s.id} service={s} onPress={() => router.push({ pathname: '/service/[id]', params: { id: s.id } })} />
      ))}
    </Screen>
  );
}
