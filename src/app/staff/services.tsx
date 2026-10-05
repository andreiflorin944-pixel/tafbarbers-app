import { Linking, Text, View } from 'react-native';
import { panelUrl } from '@/api/staff';
import { Button, Screen, ServiceRow, styles as ui } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { space } from '@/theme';

// Serviciile, cum le văd clienții. Prețurile, duratele și pozele se schimbă din panou.
export default function StaffServices() {
  const { services } = useApp();
  const { staff } = useStaff();
  return (
    <Screen edges={['bottom']}>
      <View style={{ gap: space.xs }}>
        {services.map((s) => (
          <ServiceRow key={s.id} service={s} />
        ))}
      </View>
      {staff?.owner && panelUrl() ? (
        <View style={{ marginTop: space.md }}>
          <Text style={[ui.muted, { marginBottom: space.sm }]}>Prețurile, duratele și pozele le schimbi din panou.</Text>
          <Button title="Modifică în panou" variant="ghost" onPress={() => Linking.openURL(panelUrl('services'))} />
        </View>
      ) : null}
    </Screen>
  );
}
