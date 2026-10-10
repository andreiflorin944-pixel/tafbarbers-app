import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { Card, styles } from '@/components/ui';
import type { Subscription } from '@/data/types';
import { tr, useT, type Key } from '@/i18n';
import { formatDate } from '@/lib/dates';
import { lei } from '@/lib/price';
import { colors, space } from '@/theme';

export const SUB_STATE: Record<Subscription['state'], { label: Key; color: string }> = {
  active: { label: 'subs.st.active', color: '#4CAF7A' },
  upcoming: { label: 'subs.st.upcoming', color: colors.gold },
  used_up: { label: 'subs.st.usedUp', color: colors.muted },
  expired: { label: 'subs.st.expired', color: colors.muted },
  cancelled: { label: 'subs.st.cancelled', color: colors.danger },
};

/** Câte tunsori mai are: „3 din 4 tunsori rămase” sau „tunsori nelimitate”. */
export const cutsText = (s: Pick<Subscription, 'cutsTotal' | 'cutsLeft'>) =>
  s.cutsTotal === null
    ? tr('subs.leftUnlimited')
    : tr(s.cutsTotal === 1 ? 'subs.leftOne' : 'subs.leftMany', { left: s.cutsLeft ?? 0, total: s.cutsTotal });

/** Un abonament: numele, perioada, tunsorile rămase și starea. */
export function SubscriptionRow({ s, staff }: { s: Subscription; staff?: boolean }) {
  const { t } = useT();
  const st = SUB_STATE[s.state];
  const live = s.state === 'active' || s.state === 'upcoming';
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: live ? 1 : 0.6 }}>
      <Ionicons name="ribbon" size={24} color={live ? colors.gold : colors.muted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle}>{s.name}</Text>
        <Text style={[styles.muted, { fontSize: 13 }]}>
          {formatDate(new Date(s.startsAt))} – {formatDate(new Date(s.endsAt))} · {s.cutsTotal === null ? t('subs.unlimitedLow') : t('subs.used', { used: s.cutsUsed, total: s.cutsTotal })}
          {staff ? ` · ${lei(s.price)}${s.createdByName ? t('subs.activatedBy', { name: s.createdByName }) : ''}` : ''}
        </Text>
      </View>
      <Text style={{ color: st.color, fontWeight: '700', fontSize: 12 }}>{t(st.label)}</Text>
    </Card>
  );
}
