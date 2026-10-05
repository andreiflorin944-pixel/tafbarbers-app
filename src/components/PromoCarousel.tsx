import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { Promo } from '@/data/types';
import { colors, radius, space } from '@/theme';

const AUTO_MS = 5000;

export function PromoCarousel({ promos, onPress }: { promos: Promo[]; onPress: (p: Promo) => void }) {
  const { width: screen } = useWindowDimensions();
  const width = Math.min(screen, 720) - space.md * 2;
  const ref = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const touching = useRef(false);

  useEffect(() => {
    if (promos.length < 2) return;
    const id = setInterval(() => {
      if (touching.current) return;
      setIndex((i) => {
        const next = (i + 1) % promos.length;
        ref.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [promos.length, width]);

  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
    touching.current = false;
  };

  return (
    <View>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => (touching.current = true)}
        onMomentumScrollEnd={onEnd}
        style={{ width, borderRadius: radius.lg }}
      >
        {promos.map((p, i) => {
          const accent = i % 2 === 0;
          const fg = accent ? colors.onGold : colors.text;
          return (
            <View key={p.id} style={[s.slide, { width, backgroundColor: accent ? colors.gold : colors.cardAlt }]}>
              <Ionicons name={p.icon} size={120} color={accent ? 'rgba(0,0,0,0.08)' : 'rgba(249,161,27,0.10)'} style={s.bgIcon} />
              <Text style={[s.kicker, { color: fg }]}>{p.kicker}</Text>
              <Text style={[s.title, { color: accent ? fg : colors.gold }]}>{p.title}</Text>
              <Text style={[s.text, { color: fg }]}>{p.text}</Text>
              <Pressable
                onPress={() => onPress(p)}
                style={({ pressed }) => [s.btn, { backgroundColor: accent ? colors.bg : colors.gold }, pressed && { opacity: 0.85 }]}
              >
                <Text style={[s.btnText, { color: accent ? colors.text : colors.onGold }]}>{p.cta}</Text>
                <Ionicons name="arrow-forward" size={16} color={accent ? colors.gold : colors.onGold} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      <View style={s.dots}>
        {promos.map((p, i) => (
          <View key={p.id} style={[s.dot, i === index && s.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  slide: { minHeight: 200, padding: space.lg, gap: 4, overflow: 'hidden', borderRadius: radius.lg },
  bgIcon: { position: 'absolute', right: -10, bottom: -10 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, opacity: 0.75 },
  title: { fontSize: 28, fontWeight: '800', marginVertical: 2 },
  text: { fontSize: 15, maxWidth: '85%' },
  btn: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: space.sm, borderRadius: radius.pill, paddingHorizontal: space.md, height: 42, marginTop: space.md },
  btnText: { fontSize: 15, fontWeight: '700' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { width: 18, backgroundColor: colors.gold },
});
