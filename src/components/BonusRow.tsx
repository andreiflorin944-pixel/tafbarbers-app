import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { Card, styles } from '@/components/ui';
import type { Bonus } from '@/data/types';
import { useT, type Key } from '@/i18n';
import { formatDate } from '@/lib/dates';
import { colors, space } from '@/theme';

const STATUS: Record<Bonus['status'], { label: Key; color: string }> = {
  active: { label: 'bonus.st.active', color: '#4CAF7A' },
  used: { label: 'bonus.st.used', color: colors.muted },
  expired: { label: 'bonus.st.expired', color: colors.muted },
};

/** Un bonus: titlul, de unde vine și până când e valabil. `action` = butonul echipei („Folosit”). */
export function BonusRow({ b, action }: { b: Bonus; action?: React.ReactNode }) {
  const { t } = useT();
  const st = STATUS[b.status];
  const dim = b.status !== 'active';
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: dim ? 0.6 : 1 }}>
      <Ionicons name={b.source === 'referral' ? 'people' : 'gift'} size={24} color={dim ? colors.muted : colors.gold} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle}>{b.title}</Text>
        <Text style={[styles.muted, { fontSize: 13 }]}>
          {b.source === 'referral' ? `${t('bonus.referral')}${b.referralName ? `: ${b.referralName}` : ''}` : t('bonus.fromTaf')}
          {b.status === 'active' && b.expiresAt ? ` · ${t('common.until', { date: formatDate(new Date(b.expiresAt)) })}` : ''}
          {b.status === 'used' && b.usedAt ? t('bonus.usedOn', { date: formatDate(new Date(b.usedAt)) }) : ''}
        </Text>
      </View>
      {action ?? <Text style={{ color: st.color, fontWeight: '700', fontSize: 12 }}>{t(st.label)}</Text>}
    </Card>
  );
}
