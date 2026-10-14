import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Linking, Platform, Text, View } from 'react-native';
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
  const fail = (e: unknown) => {
    const m = errorMessage(e);
    Platform.OS === 'web' ? window.alert(m) : Alert.alert('TAF', m);
  };
  const buy = async (p: Plan) => {
    if (!token) return;
    setPaying(p.id);
    try {
      const { url } = await api.paySubscription(token, p.id);
      await Linking.openURL(url);
    } catch (e) {
      fail(e);
    } finally {
      setPaying(null);
    }
  };
  /** Întrebare cu Da / Nu înainte de a opri sau porni plata automată. */
  const ask = (msg: string, yes: () => void) => {
    if (Platform.OS === 'web') return window.confirm(msg) && yes();
    Alert.alert(t('common.confirmTitle'), msg, [
      { text: t('common.no'), style: 'cancel' },
      { text: t('common.yes'), onPress: yes },
    ]);
  };
  // Oprește / pornește reînnoirea automată. Pornită după ce abonamentul Stripe s-a încheiat: se deschide pagina de plată.
  const toggle = (s: Subscription, on: boolean) =>
    ask(
      on
        ? s.renewal && !s.renewal.ended
          ? t('subs.resumeConfirm', { price: lei(s.renewal.price), date: formatDate(new Date(s.renewal.at ?? s.endsAt)) })
          : t('subs.startRenewConfirm', { date: formatDate(new Date(s.endsAt)) })
        : t('subs.stopRenewConfirm', { date: formatDate(new Date(s.endsAt)) }),
      async () => {
        if (!token) return;
        setPaying(s.id);
        try {
          const r = await api.setSubscriptionRenewal(token, s.id, on);
          if (r.url) await Linking.openURL(r.url);
          load();
        } catch (e) {
          fail(e);
        } finally {
          setPaying(null);
        }
      },
    );
  const changeCard = async () => {
    if (!token) return;
    setPaying('card');
    try {
      const { url } = await api.changeSubscriptionCard(token);
      await Linking.openURL(url);
    } catch (e) {
      fail(e);
    } finally {
      setPaying(null);
    }
  };

  if (gate) return gate;
  if (!data) return <Screen edges={[]}>{error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.gold} />}</Screen>;

  const live = data.subscriptions.filter((s) => s.state === 'active' || s.state === 'upcoming');
  const past = data.subscriptions.filter((s) => s.state !== 'active' && s.state !== 'upcoming');
  // Reînnoirea se arată o singură dată pe plan: pe ultima perioadă (cea care se termină ultima), nu și pe cea de acum dacă urmează alta.
  const lastOfPlan = (s: Subscription) => !live.some((o) => o.id !== s.id && o.planId === s.planId && o.endsAt > s.endsAt);
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
          {s.renewal && lastOfPlan(s) ? (
            <Text style={[styles.text, { textAlign: 'center', color: s.renewal.on ? colors.gold : colors.muted }]}>
              {s.renewal.on
                ? t('subs.renewsOn', { date: formatDate(new Date(s.renewal.at ?? s.endsAt)), price: lei(s.renewal.price) })
                : t('subs.renewOff', { date: formatDate(new Date(s.endsAt)) })}
            </Text>
          ) : null}
          {s.renewal?.on && s.renewal.failed && lastOfPlan(s) ? <Text style={{ color: colors.danger, textAlign: 'center' }}>{t('subs.renewFailed')}</Text> : null}
          {online && lastOfPlan(s) && (s.renewal?.on || (s.renewal && !s.renewal.ended) || s.renewable) ? (
            <View style={{ alignSelf: 'stretch', gap: space.xs, marginTop: space.xs }}>
              {s.renewal?.on ? (
                <Button title={t('subs.stopRenew')} variant="ghost" onPress={() => toggle(s, false)} loading={paying === s.id} />
              ) : (
                <Button title={t('subs.startRenew')} onPress={() => toggle(s, true)} loading={paying === s.id} />
              )}
              {s.renewal && !s.renewal.ended ? (
                <Button title={t('subs.changeCard')} variant={s.renewal.failed ? 'primary' : 'ghost'} onPress={changeCard} loading={paying === 'card'} />
              ) : null}
            </View>
          ) : null}
        </Card>
      ))}

      <Text style={[styles.label, { color: colors.gold }]}>{live.length ? t('subs.renew') : t('subs.title')}</Text>
      {data.plans.length === 0 ? <Text style={styles.muted}>{t('subs.none')}</Text> : null}
      <View style={{ gap: space.sm }}>
        {data.plans.map((p) => (
          <Card key={p.id} style={{ gap: 4, overflow: 'hidden' }}>
            {p.photoUrl ? (
              <Image
                source={{ uri: p.photoUrl }}
                style={{ marginTop: -space.md, marginHorizontal: -space.md, marginBottom: space.sm, aspectRatio: 16 / 9 }}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : null}
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
