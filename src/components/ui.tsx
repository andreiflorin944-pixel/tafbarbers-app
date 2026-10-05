import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Barber, Service } from '@/data/types';
import { colors, radius, space } from '@/theme';

export function Screen({ children, scroll = true, edges }: { children: ReactNode; scroll?: boolean; edges?: Array<'top' | 'bottom'> }) {
  return (
    <SafeAreaView style={styles.screen} edges={edges ?? ['top']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll}>{children}</ScrollView>
      ) : (
        <View style={[styles.scroll, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={styles.title}>{children}</Text>
      {sub ? <Text style={styles.muted}>{sub}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Card({ children, style, onPress, selected }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; selected?: boolean }) {
  const s = [styles.card, selected && styles.cardSelected, style];
  if (!onPress) return <View style={s}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [...s, pressed && { opacity: 0.8 }]}>
      {children}
    </Pressable>
  );
}

export function Button({ title, onPress, variant = 'primary', disabled, loading }: { title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; loading?: boolean }) {
  const bg = variant === 'primary' ? colors.gold : 'transparent';
  const fg = variant === 'primary' ? colors.onGold : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'primary' ? colors.gold : variant === 'danger' ? colors.danger : colors.border },
        (disabled || pressed) && { opacity: disabled ? 0.4 : 0.8 },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Icon(props: ComponentProps<typeof Ionicons>) {
  return <Ionicons color={colors.muted} size={18} {...props} />;
}

export function Avatar({ barber, size = 56 }: { barber?: Barber; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {barber ? (
        <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{barber.initials}</Text>
      ) : (
        <Ionicons name="people" size={size * 0.45} color={colors.gold} />
      )}
    </View>
  );
}

export function ServiceRow({ service, onPress, selected }: { service: Service; onPress?: () => void; selected?: boolean }) {
  return (
    <Card onPress={onPress} selected={selected} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={[styles.swatch, { backgroundColor: service.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{service.name}</Text>
        <Text style={styles.muted} numberOfLines={2}>
          {service.description}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.price}>{service.price} lei</Text>
        <Text style={styles.muted}>{service.durationMin} min</Text>
      </View>
    </Card>
  );
}

export function Steps({ current }: { current: 1 | 2 | 3 | 4 }) {
  const labels = ['Serviciu', 'Frizer', 'Ora', 'Confirmare'];
  return (
    <View style={styles.steps}>
      {labels.map((l, i) => (
        <View key={l} style={{ flex: 1, gap: 6 }}>
          <View style={[styles.stepBar, i < current && { backgroundColor: colors.gold }]} />
          <Text style={[styles.stepLabel, i + 1 === current && { color: colors.text }]}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

export function Empty({ icon, text }: { icon: ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={colors.goldDark} />
      <Text style={[styles.muted, { textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space.md, gap: space.sm, paddingBottom: space.xl, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  section: { color: colors.gold, fontSize: 13, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: space.md, marginBottom: space.xs },
  muted: { color: colors.muted, fontSize: 14 },
  text: { color: colors.text, fontSize: 15 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border },
  cardSelected: { borderColor: colors.gold, backgroundColor: colors.cardAlt },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 2 },
  price: { color: colors.gold, fontSize: 16, fontWeight: '700' },
  swatch: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  button: { height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1, paddingHorizontal: space.lg },
  buttonText: { fontSize: 16, fontWeight: '700' },
  avatar: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.goldDark, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.gold, fontWeight: '700' },
  steps: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  stepBar: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  stepLabel: { color: colors.muted, fontSize: 11 },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, fontSize: 16, paddingHorizontal: space.md, height: 52 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6, marginTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  menuButton: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.gold, borderRadius: radius.pill, paddingHorizontal: space.lg, height: 72 },
  menuButtonText: { flex: 1, color: colors.onGold, fontSize: 22, fontWeight: '600' },
  segmented: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md, padding: 4, marginBottom: space.md },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.sm },
});

// Text version of the TAF Barber's logo until we get the real image file.
export function Logo({ size = 1 }: { size?: number }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: colors.text, fontSize: 72 * size, fontWeight: '800', letterSpacing: 6 * size, lineHeight: 80 * size }}>TAF</Text>
      <View style={{ height: 2, backgroundColor: colors.text, alignSelf: 'stretch', marginVertical: 6 * size }} />
      <Text style={{ color: colors.text, fontSize: 44 * size, fontWeight: '700', fontStyle: 'italic', fontFamily: 'Georgia' }}>Barber’s</Text>
      <View style={{ height: 2, backgroundColor: colors.text, alignSelf: 'stretch', marginTop: 6 * size }} />
    </View>
  );
}

export function MenuButton({ icon, title, onPress }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuButton, pressed && { opacity: 0.85 }]}>
      <Ionicons name={icon} size={30} color={colors.onGold} />
      <Text style={styles.menuButtonText}>{title}</Text>
      <Ionicons name="chevron-forward" size={22} color={colors.onGold} />
    </Pressable>
  );
}

export function Segmented({ options, value, onChange }: { options: string[]; value: number; onChange: (i: number) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o, i) => (
        <Pressable key={o} onPress={() => onChange(i)} style={[styles.segment, value === i && { backgroundColor: colors.gold }]}>
          <Text style={{ color: value === i ? colors.onGold : colors.text, fontSize: 15, fontWeight: '600' }}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}
