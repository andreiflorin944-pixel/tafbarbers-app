import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { api } from '@/api';
import { useLoginGate } from '@/components/LoginGate';
import { cutsText, SubscriptionRow } from '@/components/SubscriptionRow';
import { Card, Screen, styles } from '@/components/ui';
import type { Plan, Subscription } from '@/data/types';
import { formatDate } from '@/lib/dates';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { lei } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

// Abonamentele clientului: cel activ (cu tunsorile rămase), ce abonamente oferă salonul și istoricul.
export default function Subscriptions() {
  const { token, services } = useApp();
  const { t } = useT();
  const gate = useLoginGate();
  const [data, setData] = useState<{ plans: Plan[]; subscriptions: Subscription[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) api.getSubscriptions(token).then(setData, (e) => setError(errorMessage(e)));
  }, [token]);

  if (gate) return gate;
  if (!data) return <Screen edges={[]}>{error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.gold} />}</Screen>;

  const live = data.subscriptions.filter((s) => s.state === 'active' || s.state === 'upcoming');
  const past = data.subscriptions.filter((s) => s.state !== 'active' && s.state !== 'upcoming');
  const covers = (ids: string[]) =>
    ids.length ? ids.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean).join(', ') : t('subs.allServices');

  return (
    <Screen edges={['bottom']}>
      {live.map((s) => (
        <Card key={s.id} style={{ alignItems: 'center', gap: space.xs, borderColor: colors.gold, marginBottom: space.sm }}>
          <Ionicons name="ribbon" size={30} color={colors.gold} />
          <Text style={[styles.cardTitle, { textAlign: 'center' }]}>{s.name}</Text>
          <Text style={{ color: colors.gold, fontSize: 28, fontWeight: '800', textAlign: 'center' }}>
            {s.cutsTotal === null ? t('subs.unlimited') : `${s.cutsLeft} / ${s.cutsTotal}`}
          </Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            {s.state === 'upcoming' ? t('subs.startsOn', { date: formatDate(new Date(s.startsAt)) }) : cutsText(s)} · {t('common.until', { date: formatDate(new Date(s.endsAt)) })}
          </Text>
          <Text style={[styles.muted, { fontSize: 13, textAlign: 'center' }]}>{t('subs.for', { list: covers(s.serviceIds) })}</Text>
        </Card>
      ))}

      <Text style={[styles.label, { color: colors.gold }]}>{live.length ? t('subs.renew') : t('subs.title')}</Text>
      {data.plans.length === 0 ? <Text style={styles.muted}>{t('subs.none')}</Text> : null}
      <View style={{ gap: space.sm }}>
        {data.plans.map((p) => (
          <Card key={p.id} style={{ gap: 4 }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.cardTitle, { flex: 1 }]}>{p.name}</Text>
              <Text style={{ color: colors.gold, fontWeight: '800', fontSize: 18 }}>{lei(p.price)}</Text>
            </View>
            {p.description ? <Text style={styles.text}>{p.description}</Text> : null}
            <Text style={[styles.muted, { fontSize: 13 }]}>
              {p.cuts === null ? t('subs.unlimitedCuts') : p.cuts === 1 ? t('subs.cutOne') : t('subs.cutMany', { n: p.cuts })} · {t('subs.days', { n: p.periodDays })} ·{' '}
              {covers(p.serviceIds)}
            </Text>
          </Card>
        ))}
      </View>
      {data.plans.length ? (
        <Text style={[styles.muted, { marginTop: space.sm }]}>{t('subs.payInfo')}</Text>
      ) : null}

      {past.length ? (
        <>
          <Text style={styles.label}>{t('subs.previous')}</Text>
          <View style={{ gap: space.sm }}>
            {past.map((s) => (
              <SubscriptionRow key={s.id} s={s} />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
