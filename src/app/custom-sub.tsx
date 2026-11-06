import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, Text, View } from 'react-native';
import { api } from '@/api';
import { useLoginGate } from '@/components/LoginGate';
import { Button, Card, Screen, styles } from '@/components/ui';
import type { CustomSubConfig, CustomSubQuote } from '@/data/types';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { lei } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

// „Creează-ți abonamentul”: clientul alege singur serviciile pe o lună și de câte ori, vede reducerea pe loc
// și alege cum plătește: retragere automată lunară de pe card sau plătește el în fiecare lună.
// Prețul îl calculează serverul (aceleași reguli ca la plată).
export default function CustomSub() {
  const { token, services, business } = useApp();
  const { t } = useT();
  const gate = useLoginGate();
  const [cfg, setCfg] = useState<CustomSubConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Deschis din „Vii des?” sau din sugestia de pe Acasă: serviciile vin deja puse (`items=svc-a:2,svc-b:1`).
  const params = useLocalSearchParams<{ items?: string }>();
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      String(params.items ?? '')
        .split(',')
        .map((x) => x.split(':'))
        .filter(([id, q]) => id && Number(q) > 0)
        .map(([id, q]) => [id, Math.min(20, Math.floor(Number(q)))]),
    ),
  );
  const [quote, setQuote] = useState<CustomSubQuote | null>(null);
  const [autoRenew, setAutoRenew] = useState(true);
  const [paying, setPaying] = useState(false);
  const online = !!business?.onlinePayments;

  useEffect(() => {
    api.getCustomSub().then(setCfg, (e) => setError(errorMessage(e)));
  }, []);

  const items = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([serviceId, q]) => ({ serviceId, qty: q }));
  const visits = items.reduce((a, i) => a + i.qty, 0);
  const key = JSON.stringify(items);
  useEffect(() => {
    setQuote(null);
    if (!cfg || visits < cfg.minVisits) return;
    let live = true;
    api.quoteCustomSub(items).then(
      (q) => live && setQuote(q),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cfg]);

  const pay = async () => {
    if (!token || !quote) return;
    setPaying(true);
    try {
      const { url } = await api.payCustomSub(token, items, autoRenew);
      await Linking.openURL(url);
      router.replace('/subscriptions');
    } catch (e) {
      const m = errorMessage(e);
      Platform.OS === 'web' ? window.alert(m) : Alert.alert('TAF', m);
    } finally {
      setPaying(false);
    }
  };

  if (gate) return gate;
  if (!cfg) return <Screen edges={[]}>{error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.gold} />}</Screen>;

  const list = services.filter((s) => !cfg.serviceIds.length || cfg.serviceIds.includes(s.id));
  const tiers = Object.entries(cfg.discounts)
    .filter(([n, p]) => Number(n) >= cfg.minVisits && Number(n) <= cfg.maxVisits && p > 0)
    .sort(([a], [b]) => Number(a) - Number(b));
  const full = visits >= cfg.maxVisits;

  return (
    <Screen edges={['bottom']}>
      <Card style={{ gap: space.xs, borderColor: colors.gold }}>
        <Text style={styles.text}>{t('customSub.intro', { days: cfg.periodDays })}</Text>
        <View style={[styles.row, { flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }]}>
          {tiers.map(([n, p]) => (
            <View
              key={n}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: quote && quote.visits === Number(n) ? colors.gold : colors.border,
              }}
            >
              <Text style={[styles.muted, { fontSize: 13, color: quote && quote.visits === Number(n) ? colors.gold : colors.muted }]}>{t('customSub.tier', { n, pct: p })}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Card style={{ marginTop: space.md, gap: space.xs, alignItems: 'center' }}>
        <Text style={styles.muted}>{t('customSub.visits', { n: visits, max: cfg.maxVisits })}</Text>
        {quote ? (
          <>
            <Text style={[styles.muted, { textDecorationLine: 'line-through' }]}>{lei(quote.fullPrice)}</Text>
            <Text style={{ color: colors.gold, fontSize: 30, fontWeight: '800' }}>{t('customSub.total', { price: lei(quote.price) })}</Text>
            <Text style={styles.text}>
              {t('customSub.discount', { pct: quote.discount })} · {t('customSub.save', { amount: lei(Math.round((quote.fullPrice - quote.price) * 100) / 100) })}
            </Text>
          </>
        ) : (
          <Text style={styles.text}>{t('customSub.pickMore', { n: cfg.minVisits })}</Text>
        )}
      </Card>

      <View style={{ gap: space.sm, marginTop: space.md }}>
        {list.map((s) => {
          const q = qty[s.id] ?? 0;
          return (
            <Card key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderColor: q ? colors.gold : undefined }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{s.name}</Text>
                <Text style={[styles.muted, { fontSize: 13 }]}>{lei(s.price)}</Text>
              </View>
              <Pressable
                onPress={() => setQty({ ...qty, [s.id]: Math.max(0, q - 1) })}
                disabled={!q}
                accessibilityRole="button"
                accessibilityLabel="-"
                hitSlop={8}
              >
                <Ionicons name="remove-circle-outline" size={30} color={q ? colors.text : colors.muted} />
              </Pressable>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', minWidth: 20, textAlign: 'center' }}>{q}</Text>
              <Pressable onPress={() => setQty({ ...qty, [s.id]: q + 1 })} disabled={full} accessibilityRole="button" accessibilityLabel="+" hitSlop={8}>
                <Ionicons name="add-circle" size={30} color={full ? colors.muted : colors.gold} />
              </Pressable>
            </Card>
          );
        })}
      </View>

      {quote && online ? (
        <>
          <Text style={styles.label}>{t('customSub.payHow')}</Text>
          <View style={{ gap: space.sm }}>
            {[
              { on: true, title: t('customSub.auto'), info: t('customSub.autoInfo', { days: cfg.periodDays }) },
              { on: false, title: t('customSub.manual'), info: t('customSub.manualInfo', { days: cfg.periodDays }) },
            ].map((o) => (
              <Pressable key={String(o.on)} onPress={() => setAutoRenew(o.on)} accessibilityRole="radio" accessibilityState={{ checked: autoRenew === o.on }}>
                <Card style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', borderColor: autoRenew === o.on ? colors.gold : undefined }}>
                  <Ionicons name={autoRenew === o.on ? 'radio-button-on' : 'radio-button-off'} size={22} color={autoRenew === o.on ? colors.gold : colors.muted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.cardTitle}>{o.title}</Text>
                    <Text style={[styles.muted, { fontSize: 13 }]}>{o.info}</Text>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: space.md }}>
            <Button title={t('customSub.pay', { price: lei(quote.price) })} onPress={pay} loading={paying} />
          </View>
        </>
      ) : null}
      {quote && !online ? <Text style={[styles.text, { marginTop: space.md }]}>{t('customSub.salon')}</Text> : null}
      <Text style={[styles.muted, { fontSize: 13, marginTop: space.md }]}>{t('customSub.terms', { days: cfg.periodDays })}</Text>
    </Screen>
  );
}
