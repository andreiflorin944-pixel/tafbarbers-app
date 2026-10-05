import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CartBar, ProductImage, QtyControl } from '@/components/Shop';
import { styles } from '@/components/ui';
import { useCart } from '@/state/Cart';
import { colors, radius, space } from '@/theme';

export default function Shop() {
  const { products, reloadProducts } = useCart();
  // Stocul se schimbă: la fiecare intrare în magazin luăm lista din nou.
  useEffect(reloadProducts, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={[styles.muted, { marginBottom: space.sm }]}>Comanzi din aplicație, ridici din salon și plătești acolo.</Text>
        {products.length === 0 ? <Text style={styles.muted}>Momentan nu sunt produse în magazin.</Text> : null}
        <View style={s.grid}>
          {products.map((p) => (
            <View key={p.id} style={s.card}>
              <ProductImage product={p} size="100%" />
              <Text style={s.name} numberOfLines={2}>
                {p.name}
              </Text>
              {p.description ? (
                <Text style={[styles.muted, { fontSize: 12 }]} numberOfLines={2}>
                  {p.description}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={styles.price}>{p.price} lei</Text>
                {p.stock !== null && p.stock > 0 && p.stock <= 3 ? <Text style={s.low}>Ultimele {p.stock}</Text> : null}
              </View>
              <QtyControl product={p} />
            </View>
          ))}
        </View>
      </ScrollView>
      <CartBar />
    </View>
  );
}

const s = StyleSheet.create({
  content: { padding: space.md, paddingBottom: 120, width: '100%', maxWidth: 720, alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { flexBasis: '48%', flexGrow: 1, maxWidth: '49%', backgroundColor: colors.card, borderRadius: radius.lg, padding: space.sm, gap: 6, borderWidth: 1, borderColor: colors.border },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  low: { color: colors.gold, fontSize: 12, fontWeight: '700' },
});
