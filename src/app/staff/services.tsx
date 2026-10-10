import { Linking, Text, View } from 'react-native';
import { panelUrl } from '@/api/staff';
import { Button, Screen, ServiceRow, styles as ui } from '@/components/ui';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { space } from '@/theme';

// Serviciile, cum le văd clienții. Prețurile, duratele și pozele se schimbă din panou.
export default function StaffServices() {
  const { services } = useApp();
  const { staff } = useStaff();
  const { t } = useT();
  return (
    <Screen edges={['bottom']}>
      <View style={{ gap: space.xs }}>
        {services.map((s) => (
          <ServiceRow key={s.id} service={s} />
        ))}
      </View>
      {staff?.owner && panelUrl() ? (
        <View style={{ marginTop: space.md }}>
          <Text style={[ui.muted, { marginBottom: space.sm }]}>{t('ssvc.hint')}</Text>
          <Button title={t('ssvc.edit')} variant="ghost" onPress={() => Linking.openURL(panelUrl('services'))} />
        </View>
      ) : null}
    </Screen>
  );
}
