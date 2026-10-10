import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, Text, View } from 'react-native';
import { api } from '@/api';
import { useLoginGate } from '@/components/LoginGate';
import { cutsText, SubscriptionRow } from '@/components/SubscriptionRow';
import { Button, Card, Screen, styles } from '@/components/ui';
import type { Plan, Subscription } from '@/data/types';
import { formatDate } from '@/lib/dates';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { lei } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

// Abonamentele clientului: cel activ (cu tunsorile rămase), ce abonamente oferă salonul și istoricul.
export default function Subscriptions() {
  const { token, services, business } = useApp();
  const { t } = useT();
  const gate = useLoginGate();
  const [data, setData] = useState<{ plans: Plan[]; subscriptions: Subscription[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [paying, setPaying] = useState<string | null>(null);
  const load = useCallback(() => {
    if (token) api.getSubscriptions(token).then(setData, (e) => setError(errorMessage(e)));
  }, [token]);
  useEffect(load, [load]);
  // La întoarcerea de pe pagina de plată, abonamentul cumpărat apare imediat (se activează prin webhook).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && load());
    return () => sub.remove();
  }, [load]);
  const online = !!business?.onlinePayments;
  const buy = async (p: Plan) => {
    if (!token) return;
    setPaying(p.id);
    try {
      const { url } = await api.paySubscription(token, p.id);
      await Linking.openURL(url);
    } catch (e) {
      const m = errorMessage(e);
      Platform.OS === 'web' ? window.alert(m) : Alert.alert('TAF', m);
    } finally {
      setPaying(null);
    }
  };

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
            {online ? (
              <View style={{ marginTop: space.sm }}>
                <Button title={t('subs.buyOnline', { price: lei(p.price) })} onPress={() => buy(p)} loading={paying === p.id} />
              </View>
            ) : null}
          </Card>
        ))}
      </View>
      {data.plans.length ? (
        <Text style={[styles.muted, { marginTop: space.sm }]}>{online ? t('subs.payInfoOnline') : t('subs.payInfo')}</Text>
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
