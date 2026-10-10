import { router } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { PhoneLogin } from '@/components/PhoneLogin';
import { ProductImage, QtyControl } from '@/components/Shop';
import { Button, Card, Screen, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { lei } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { useCart } from '@/state/Cart';
import { colors, space } from '@/theme';

export default function CartScreen() {
  const { user, token } = useApp();
  const { t } = useT();
  const { lines, total, clear, reloadProducts } = useCart();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const order = async (tok: string) => {
    setBusy(true);
    setError(null);
    try {
      const o = await api.createOrder(tok, { items: lines.map((l) => ({ productId: l.product.id, qty: l.qty })), note: note.trim() || undefined });
      clear();
      reloadProducts();
      router.replace({ pathname: '/shop/orders', params: { placed: o.code } });
    } catch (e) {
      setError(errorMessage(e, t('cart.sendFailed')));
      reloadProducts();
    } finally {
      setBusy(false);
    }
  };

  if (!lines.length) {
    return (
      <Screen edges={['bottom']}>
        <Text style={[styles.muted, { marginBottom: space.md }]}>{t('cart.empty')}</Text>
        <Button title={t('cart.backToShop')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/shop'))} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <Card style={{ gap: space.md }}>
        {lines.map(({ product, qty }) => (
          <View key={product.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <ProductImage product={product} size={56} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {product.name}
              </Text>
              <Text style={styles.muted}>{lei(product.price * qty)}</Text>
            </View>
            <View style={{ width: 120 }}>
              <QtyControl product={product} />
            </View>
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.text}>{t('cart.total')}</Text>
          <Text style={styles.price}>{lei(total)}</Text>
        </View>
      </Card>

      <Text style={styles.label}>{t('cart.note')}</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        style={styles.input}
        placeholder={t('cart.notePh')}
        placeholderTextColor={colors.muted}
        maxLength={300}
      />
      <Text style={[styles.muted, { fontSize: 12, marginTop: space.sm }]}>{t('cart.payInfo')}</Text>
      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}

      <View style={{ marginTop: space.md }}>
        {user && token ? (
          <Button title={t('cart.sendTotal', { total: lei(total) })} onPress={() => order(token)} loading={busy} />
        ) : (
          <>
            <Text style={[styles.muted, { marginBottom: space.xs }]}>{t('cart.smsOnce')}</Text>
            <PhoneLogin submitTitle={t('cart.send')} onDone={order} />
          </>
        )}
      </View>
    </Screen>
  );
}
