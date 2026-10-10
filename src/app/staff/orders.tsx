import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, Text, View } from 'react-native';
import { staffApi, type StaffOrder } from '@/api/staff';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import { useT, type Key } from '@/i18n';
import { formatDate, formatTime } from '@/lib/dates';
import { lei } from '@/lib/price';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

const STATUS: Record<StaffOrder['status'], { label: Key; color: string }> = {
  new: { label: 'sord.st.new', color: colors.gold },
  ready: { label: 'orders.st.ready', color: '#7FB6E6' },
  picked_up: { label: 'orders.st.pickedUp', color: colors.success },
  cancelled: { label: 'orders.st.cancelled', color: colors.danger },
};
const TABS: Array<{ key: string; label: Key }> = [
  { key: 'open', label: 'sord.open' },
  { key: 'picked_up', label: 'sord.pickedUp' },
  { key: 'cancelled', label: 'sord.cancelled' },
];

// Comenzile din magazin: „Gata de ridicare” trimite SMS clientului, apoi „Ridicată și plătită”.
export default function StaffOrders() {
  const { staff, staffToken } = useStaff();
  const { t } = useT();
  const [tab, setTab] = useState('open');
  const [list, setList] = useState<StaffOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!staffToken) return;
    setList(null);
    staffApi.orders(staffToken, tab).then(setList, (e) => {
      setError(errorMessage(e));
      setList([]);
    });
  }, [staffToken, tab]);
  useEffect(load, [load]);

  if (!staff || !staffToken) return null;

  const set = async (o: StaffOrder, status: string) => {
    try {
      await staffApi.setOrderStatus(staffToken, o.id, status);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const cancel = (o: StaffOrder) => {
    const yes = () => set(o, 'cancelled');
    const ask = t('orders.cancelAsk', { code: o.code });
    if (Platform.OS === 'web') return window.confirm(`${ask} ${t('sord.stockBack')}`) && yes();
    Alert.alert(ask, t('sord.stockBack'), [
      { text: t('common.no'), style: 'cancel' },
      { text: t('bookings.cancel'), style: 'destructive', onPress: yes },
    ]);
  };

  return (
    <Screen edges={['bottom']}>
      <View style={{ flexDirection: 'row', gap: space.xs, marginBottom: space.md }}>
        {TABS.map((x) => (
          <Pressable
            key={x.key}
            onPress={() => setTab(x.key)}
            style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: tab === x.key ? colors.gold : colors.card, borderWidth: 1, borderColor: tab === x.key ? colors.gold : colors.border }}
          >
            <Text style={{ color: tab === x.key ? colors.onGold : colors.text, fontWeight: '600' }}>{t(x.label)}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={{ color: colors.danger, marginBottom: space.sm }}>{error}</Text> : null}
      {list === null ? (
        <ActivityIndicator color={colors.gold} />
      ) : list.length === 0 ? (
        <Text style={ui.muted}>{tab === 'open' ? t('sord.noneOpen') : t('sord.none')}</Text>
      ) : (
        <View style={{ gap: space.sm }}>
          {list.map((o) => (
            <Card key={o.id} style={{ gap: 4 }}>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.cardTitle}>{t('orders.order', { code: o.code })}</Text>
                <Text style={{ color: STATUS[o.status].color, fontWeight: '700', fontSize: 12 }}>{t(STATUS[o.status].label)}</Text>
              </View>
              <Text style={ui.muted}>
                {formatDate(new Date(o.createdAt))}, {formatTime(new Date(o.createdAt))} · {o.clientName || t('sord.client')}
              </Text>
              {o.items.map((i) => (
                <Text key={i.productId} style={ui.text}>
                  {i.qty} × {i.name}
                </Text>
              ))}
              {o.note ? <Text style={[ui.muted, { fontStyle: 'italic' }]}>„{o.note}”</Text> : null}
              <Text style={[ui.price, { marginTop: 4 }]}>{lei(o.total)}</Text>
              {o.status === 'new' || o.status === 'ready' ? (
                <View style={{ gap: space.sm, marginTop: space.sm }}>
                  {o.status === 'new' ? <Button title={t('sord.ready')} onPress={() => set(o, 'ready')} /> : null}
                  <Button title={t('sord.paid')} variant={o.status === 'ready' ? 'primary' : 'ghost'} onPress={() => set(o, 'picked_up')} />
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    {o.clientPhone ? (
                      <View style={{ flex: 1 }}>
                        <Button title={t('common.call')} variant="ghost" onPress={() => Linking.openURL(`tel:${o.clientPhone}`)} />
                      </View>
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Button title={t('bookings.cancel')} variant="danger" onPress={() => cancel(o)} />
                    </View>
                  </View>
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
