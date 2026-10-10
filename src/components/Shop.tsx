import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { mediaUrl } from '@/api/staff';
import type { Product } from '@/data/types';
import { useT } from '@/i18n';
import { lei } from '@/lib/price';
import { useCart } from '@/state/Cart';
import { colors, radius, space } from '@/theme';

export function ProductImage({ product, size }: { product: Product; size: number | '100%' }) {
  const uri = mediaUrl(product.imageUrl);
  const box = { width: size, height: size === '100%' ? undefined : size, aspectRatio: size === '100%' ? 1 : undefined } as const;
  return uri ? (
    <Image source={{ uri }} style={[box, { borderRadius: radius.md }]} accessibilityLabel={product.name} />
  ) : (
    <View style={[box, s.placeholder]}>
      <Ionicons name="bag-handle-outline" size={28} color={colors.goldDark} />
    </View>
  );
}

/** „Adaugă” sau − cantitate +. */
export function QtyControl({ product }: { product: Product }) {
  const { qty, setQty } = useCart();
  const { t } = useT();
  const q = qty(product.id);
  const soldOut = product.stock === 0;
  const atMax = q >= Math.min(10, product.stock ?? 10);
  if (soldOut) return <Text style={s.soldOut}>{t('shop.soldOut')}</Text>;
  if (!q)
    return (
      <Pressable onPress={() => setQty(product.id, 1)} style={s.add} accessibilityLabel={t('shop.addLabel', { name: product.name })}>
        <Ionicons name="add" size={18} color={colors.onGold} />
        <Text style={s.addText}>{t('common.add')}</Text>
      </Pressable>
    );
  return (
    <View style={s.qty}>
      <Pressable onPress={() => setQty(product.id, q - 1)} hitSlop={8} style={s.qtyBtn} accessibilityLabel={t('shop.less')}>
        <Ionicons name={q === 1 ? 'trash-outline' : 'remove'} size={18} color={colors.text} />
      </Pressable>
      <Text style={s.qtyText}>{q}</Text>
      <Pressable onPress={() => setQty(product.id, q + 1)} hitSlop={8} style={[s.qtyBtn, atMax && { opacity: 0.35 }]} disabled={atMax} accessibilityLabel={t('shop.more')}>
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

/** Bara de jos cu coșul, când are ceva în el. */
export function CartBar() {
  const { count, total } = useCart();
  const { t } = useT();
  if (!count) return null;
  return (
    <Pressable onPress={() => router.push('/shop/cart')} style={s.bar} accessibilityLabel={t('shop.viewCart')}>
      <View style={s.barCount}>
        <Text style={s.barCountText}>{count}</Text>
      </View>
      <Text style={s.barText}>{t('shop.viewCart')}</Text>
      <Text style={s.barTotal} numberOfLines={1}>{lei(total)}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  placeholder: { borderRadius: radius.md, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.gold, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 12 },
  addText: { color: colors.onGold, fontWeight: '800', fontSize: 14 },
  soldOut: { color: colors.muted, fontWeight: '700', paddingVertical: 8, textAlign: 'center' },
  qty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cardAlt, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 4, borderWidth: 1, borderColor: colors.border },
  qtyBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  qtyText: { color: colors.text, fontWeight: '800', fontSize: 16, minWidth: 20, textAlign: 'center' },
  bar: { position: 'absolute', left: space.md, right: space.md, bottom: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.gold, borderRadius: radius.pill, paddingVertical: 14, paddingHorizontal: space.md, maxWidth: 688, alignSelf: 'center' },
  barCount: { backgroundColor: colors.onGold, borderRadius: 12, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  barCountText: { color: colors.gold, fontWeight: '800' },
  barText: { color: colors.onGold, fontWeight: '800', fontSize: 16, flex: 1 },
  barTotal: { color: colors.onGold, fontWeight: '800', fontSize: 16 },
});
