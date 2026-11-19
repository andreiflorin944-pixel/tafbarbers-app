import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Icon, styles as ui } from '@/components/ui';
import type { Barber, Booking, Service } from '@/data/types';
import { useT } from '@/i18n';
import { doesService } from '@/lib/bookFlow';
import { errorMessage } from '@/lib/errors';
import { barberDuration, barberPrice, lei } from '@/lib/price';
import { colors, radius, space } from '@/theme';

// „+ Adaugă serviciu”: la o programare deja făcută se mai pune un serviciu (ex. Vopsit barbă după tuns).
// Programarea se prelungește cu durata lui și prețul crește, dacă frizerul are timp liber după.

/** Câte servicii se pot adăuga la aceeași programare (ca pe server). */
export const MAX_EXTRAS = 3;

/** Serviciile care se mai pot adăuga: le face frizerul, nu sunt deja pe programare. */
export function addableServices(b: Booking, services: Service[], barber: Barber | undefined, opts: { hideMembersOnly?: boolean } = {}) {
  if ((b.extras?.length ?? 0) >= MAX_EXTRAS) return [];
  return services.filter(
    (s) =>
      s.id !== b.serviceId &&
      !b.extras?.some((e) => e.serviceId === s.id) &&
      (!barber || doesService(barber, s.id)) &&
      !(opts.hideMembersOnly && s.membersOnly),
  );
}

export function ExtraSheet({
  booking,
  services,
  barber,
  onClose,
  onAdd,
}: {
  booking: Booking;
  services: Service[];
  barber: Barber | undefined;
  onClose: () => void;
  onAdd: (serviceId: string) => Promise<void>;
}) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = addableServices(booking, services, barber, { hideMembersOnly: true });

  const add = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await onAdd(id);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, s.backdrop]} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={[s.sheet, { paddingBottom: space.xl + insets.bottom }]}>
          <View style={s.handle} />
          <Text style={s.title}>{t('extra.title')}</Text>
          <Text style={[ui.muted, { marginBottom: space.sm }]}>{t('extra.hint')}</Text>
          <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: space.sm }}>
            {list.map((x) => (
              <Card key={x.id} onPress={busy ? undefined : () => add(x.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, opacity: busy && busy !== x.id ? 0.5 : 1 }}>
                <Icon name="add-circle" color={colors.gold} />
                <View style={{ flex: 1 }}>
                  <Text style={ui.cardTitle}>{x.name}</Text>
                  <Text style={ui.muted}>
                    +{barberDuration(x, barber)} min · +{lei(barberPrice(x, barber))}
                  </Text>
                </View>
                {busy === x.id ? <Text style={ui.muted}>…</Text> : null}
              </Card>
            ))}
            {!list.length ? <Text style={ui.muted}>{t('extra.none')}</Text> : null}
          </ScrollView>
          {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}
          <View style={{ marginTop: space.md }}>
            <Button title={t('common.close')} variant="ghost" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: space.md },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
});
