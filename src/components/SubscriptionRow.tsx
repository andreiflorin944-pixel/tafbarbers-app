import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { Card, styles } from '@/components/ui';
import type { Subscription } from '@/data/types';
import { formatDate } from '@/lib/dates';
import { colors, space } from '@/theme';

export const SUB_STATE: Record<Subscription['state'], { label: string; color: string }> = {
  active: { label: 'Activ', color: '#4CAF7A' },
  upcoming: { label: 'Urmează', color: colors.gold },
  used_up: { label: 'Tunsori epuizate', color: colors.muted },
  expired: { label: 'Expirat', color: colors.muted },
  cancelled: { label: 'Anulat', color: colors.danger },
};

/** Câte tunsori mai are: „3 din 4 tunsori rămase” sau „tunsori nelimitate”. */
export const cutsText = (s: Pick<Subscription, 'cutsTotal' | 'cutsLeft'>) =>
  s.cutsTotal === null ? 'tunsori nelimitate' : `${s.cutsLeft} din ${s.cutsTotal} ${s.cutsTotal === 1 ? 'tunsoare rămasă' : 'tunsori rămase'}`;

/** Un abonament: numele, perioada, tunsorile rămase și starea. */
export function SubscriptionRow({ s, staff }: { s: Subscription; staff?: boolean }) {
  const st = SUB_STATE[s.state];
  const live = s.state === 'active' || s.state === 'upcoming';
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: live ? 1 : 0.6 }}>
      <Ionicons name="ribbon" size={24} color={live ? colors.gold : colors.muted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle}>{s.name}</Text>
        <Text style={[styles.muted, { fontSize: 13 }]}>
          {formatDate(new Date(s.startsAt))} – {formatDate(new Date(s.endsAt))} · {s.cutsTotal === null ? 'nelimitat' : `${s.cutsUsed} din ${s.cutsTotal} folosite`}
          {staff ? ` · ${s.price} lei${s.createdByName ? `, activat de ${s.createdByName}` : ''}` : ''}
        </Text>
      </View>
      <Text style={{ color: st.color, fontWeight: '700', fontSize: 12 }}>{st.label}</Text>
    </Card>
  );
}
