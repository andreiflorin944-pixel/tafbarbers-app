import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, Text, View } from 'react-native';
import { staffApi, type StaffOrder } from '@/api/staff';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

const STATUS: Record<StaffOrder['status'], { label: string; color: string }> = {
  new: { label: 'Nouă', color: colors.gold },
  ready: { label: 'Gata de ridicare', color: '#7FB6E6' },
  picked_up: { label: 'Ridicată', color: colors.success },
  cancelled: { label: 'Anulată', color: colors.danger },
};
const TABS = [
  { key: 'open', label: 'De pregătit' },
  { key: 'picked_up', label: 'Ridicate' },
  { key: 'cancelled', label: 'Anulate' },
];

// Comenzile din magazin: „Gata de ridicare” trimite SMS clientului, apoi „Ridicată și plătită”.
export default function StaffOrders() {
  const { staff, staffToken } = useStaff();
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
    if (Platform.OS === 'web') return window.confirm(`Anulezi comanda ${o.code}? Produsele revin în stoc.`) && yes();
    Alert.alert(`Anulezi comanda ${o.code}?`, 'Produsele revin în stoc.', [
      { text: 'Nu', style: 'cancel' },
      { text: 'Anulează', style: 'destructive', onPress: yes },
    ]);
  };

  return (
    <Screen edges={['bottom']}>
      <View style={{ flexDirection: 'row', gap: space.xs, marginBottom: space.md }}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: tab === t.key ? colors.gold : colors.card, borderWidth: 1, borderColor: tab === t.key ? colors.gold : colors.border }}
          >
            <Text style={{ color: tab === t.key ? colors.onGold : colors.text, fontWeight: '600' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={{ color: colors.danger, marginBottom: space.sm }}>{error}</Text> : null}
      {list === null ? (
        <ActivityIndicator color={colors.gold} />
      ) : list.length === 0 ? (
        <Text style={ui.muted}>{tab === 'open' ? 'Nicio comandă de pregătit.' : 'Nicio comandă aici.'}</Text>
      ) : (
        <View style={{ gap: space.sm }}>
          {list.map((o) => (
            <Card key={o.id} style={{ gap: 4 }}>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.cardTitle}>Comanda {o.code}</Text>
                <Text style={{ color: STATUS[o.status].color, fontWeight: '700', fontSize: 12 }}>{STATUS[o.status].label}</Text>
              </View>
              <Text style={ui.muted}>
                {formatDate(new Date(o.createdAt))}, {formatTime(new Date(o.createdAt))} · {o.clientName || 'client'}
              </Text>
              {o.items.map((i) => (
                <Text key={i.productId} style={ui.text}>
                  {i.qty} × {i.name}
                </Text>
              ))}
              {o.note ? <Text style={[ui.muted, { fontStyle: 'italic' }]}>„{o.note}”</Text> : null}
              <Text style={[ui.price, { marginTop: 4 }]}>{o.total} lei</Text>
              {o.status === 'new' || o.status === 'ready' ? (
                <View style={{ gap: space.sm, marginTop: space.sm }}>
                  {o.status === 'new' ? <Button title="Gata de ridicare (SMS la client)" onPress={() => set(o, 'ready')} /> : null}
                  <Button title="Ridicată și plătită" variant={o.status === 'ready' ? 'primary' : 'ghost'} onPress={() => set(o, 'picked_up')} />
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    {o.clientPhone ? (
                      <View style={{ flex: 1 }}>
                        <Button title="Sună" variant="ghost" onPress={() => Linking.openURL(`tel:${o.clientPhone}`)} />
                      </View>
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Button title="Anulează" variant="danger" onPress={() => cancel(o)} />
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
