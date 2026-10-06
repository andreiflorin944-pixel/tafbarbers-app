import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, Text, View } from 'react-native';
import { api } from '@/api';
import { Button, Card, Icon, Screen, styles } from '@/components/ui';
import type { Order, OrderStatus } from '@/data/types';
import { formatDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { useCart } from '@/state/Cart';
import { colors, radius, space } from '@/theme';

const STATUS: Record<OrderStatus, { label: string; color: string }> = {
  new: { label: 'Se pregătește', color: colors.gold },
  ready: { label: 'Gata de ridicare', color: '#7FB6E6' },
  picked_up: { label: 'Ridicată', color: colors.success },
  cancelled: { label: 'Anulată', color: colors.danger },
};

export default function Orders() {
  const { token, business } = useApp();
  const { reloadProducts } = useCart();
  const { placed } = useLocalSearchParams<{ placed?: string }>();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return setOrders([]);
    api.listOrders(token).then(setOrders, (e) => setError(errorMessage(e)));
  }, [token]);
  useEffect(load, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load());
    return () => sub.remove();
  }, [load]);

  const pay = async (o: Order) => {
    setError(null);
    try {
      const { url } = await api.payOrder(token!, o.id);
      await Linking.openURL(url);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const cancel = (o: Order) => {
    const go = async () => {
      try {
        await api.cancelOrder(token!, o.id);
        reloadProducts();
        load();
      } catch (e) {
        setError(errorMessage(e));
      }
    };
    const text = `Anulezi comanda ${o.code}?`;
    if (Platform.OS === 'web') {
      if (window.confirm(text)) go();
    } else {
      Alert.alert(text, undefined, [
        { text: 'Nu', style: 'cancel' },
        { text: 'Anulează comanda', style: 'destructive', onPress: go },
      ]);
    }
  };

  if (!token) {
    return (
      <Screen edges={['bottom']}>
        <Text style={[styles.muted, { marginBottom: space.md }]}>Intră în cont ca să-ți vezi comenzile.</Text>
        <Button title="Intră în cont cu telefonul" onPress={() => router.push('/login')} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      {placed ? (
        <Card style={{ borderColor: colors.gold, gap: space.xs, marginBottom: space.sm }}>
          <View style={styles.row}>
            <Icon name="checkmark-circle" color={colors.gold} />
            <Text style={styles.cardTitle}>Comanda {placed} a fost trimisă</Text>
          </View>
          <Text style={styles.muted}>
            {business?.onlinePayments
              ? 'Îți trimitem SMS când e gata. O poți plăti acum online sau la salon, la ridicare.'
              : 'Îți trimitem SMS când e gata. O ridici din salon și plătești acolo.'}
          </Text>
        </Card>
      ) : null}
      {error ? <Text style={{ color: colors.danger, marginBottom: space.sm }}>{error}</Text> : null}
      {!orders ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: space.lg }} />
      ) : orders.length === 0 ? (
        <>
          <Text style={[styles.muted, { marginBottom: space.md }]}>Nu ai comenzi încă.</Text>
          <Button title="Mergi la magazin" onPress={() => router.replace('/shop')} />
        </>
      ) : (
        <View style={{ gap: space.sm }}>
          {orders.map((o) => (
            <Card key={o.id} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.cardTitle}>Comanda {o.code}</Text>
                <Text style={{ color: STATUS[o.status].color, fontWeight: '700', fontSize: 13, borderRadius: radius.pill }}>{STATUS[o.status].label}</Text>
              </View>
              <Text style={styles.muted}>{formatDate(new Date(o.createdAt))}</Text>
              {o.items.map((i) => (
                <Text key={i.productId} style={styles.text}>
                  {i.qty} × {i.name}
                </Text>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xs }}>
                <Text style={styles.price}>{o.total} lei</Text>
                {o.paidAt && o.payMethod === 'online' ? <Text style={{ color: colors.success, fontWeight: '700' }}>Plătită online</Text> : null}
                {o.status === 'new' && !o.paidAt ? (
                  <Text style={{ color: colors.danger, fontWeight: '700' }} onPress={() => cancel(o)}>
                    Anulează
                  </Text>
                ) : null}
              </View>
              {business?.onlinePayments && !o.paidAt && (o.status === 'new' || o.status === 'ready') ? <Button title="Plătește online" onPress={() => pay(o)} /> : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
