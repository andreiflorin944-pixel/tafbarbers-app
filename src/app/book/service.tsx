import { router } from 'expo-router';
import { Screen, ServiceRow, Steps } from '@/components/ui';
import { useApp } from '@/state/AppState';

export default function ChooseService() {
  const { services, setDraft, draft } = useApp();

  return (
    <Screen edges={[]}>
      <Steps current={1} />
      {services.map((s) => (
        <ServiceRow
          key={s.id}
          service={s}
          selected={draft.serviceId === s.id}
          onPress={() => {
            setDraft({ serviceId: s.id, barberId: null, start: null, slotBarberId: null });
            router.push('/book/barber');
          }}
        />
      ))}
    </Screen>
  );
}
