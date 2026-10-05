import { router } from 'expo-router';
import { Screen, ServiceRow, Title } from '@/components/ui';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';

export default function Services() {
  const { services } = useApp();
  const { t } = useT();

  return (
    <Screen tab>
      <Title sub={t('services.sub')}>{t('services.title')}</Title>
      {services.map((s) => (
        <ServiceRow key={s.id} service={s} onPress={() => router.push({ pathname: '/service/[id]', params: { id: s.id } })} />
      ))}
    </Screen>
  );
}
