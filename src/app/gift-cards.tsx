import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Image, Linking, Pressable, Share, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { mediaUrl } from '@/api/staff';
import { useLoginGate } from '@/components/LoginGate';
import { Button, Card, Screen, styles } from '@/components/ui';
import type { GiftCard, GiftCards, GiftPromoQuote } from '@/data/types';
import { useT, type Key } from '@/i18n';
import { formatDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { lei } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

/** Lei cu bani: 149,99 (în engleză 149.99); sumele întregi rămân 180. */
const money = (n: number, lang: string) => (n % 1 ? n.toFixed(2).replace('.', lang === 'en' ? '.' : ',') : String(n));

const STATUS: Record<GiftCard['status'], Key> = {
  pending: 'gift.st.pending',
  active: 'gift.st.active',
  used: 'gift.st.used',
  cancelled: 'gift.st.cancelled',
  expired: 'gift.st.expired',
};

// Card cadou: clientul alege suma și cui îl dă, plătește la salon, iar destinatarul primește codul.
export default function GiftCardsScreen() {
  const { token, business } = useApp();
  const { t, lang } = useT();
  const gate = useLoginGate();
  const [data, setData] = useState<GiftCards | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Codul de reducere (generat din panou): clientul îl scrie, noi arătăm cât plătește.
  const [promo, setPromo] = useState('');
  const [quote, setQuote] = useState<GiftPromoQuote | null>(null);
  const [promoErr, setPromoErr] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const applyPromo = useCallback(
    async (code: string, amt: number | null) => {
      setPromoErr(null);
      if (!code.trim() || !amt) {
        setQuote(null);
        return;
      }
      setPromoBusy(true);
      try {
        setQuote(await api.quoteGiftPromo(code.trim(), amt));
      } catch (e) {
        setQuote(null);
        setPromoErr(errorMessage(e));
      } finally {
        setPromoBusy(false);
      }
    },
    [],
  );

  const load = useCallback(() => {
    if (token) api.getGiftCards(token, lang).then(setData, (e) => setError(errorMessage(e)));
  }, [token, lang]);
  useEffect(load, [load]);
  // În campania de sezon (ex. Crăciun) urarea e gata scrisă; clientul o poate schimba sau șterge.
  // Și suma campaniei (ex. voucherul de Crăciun de 120 lei) e aleasă din oficiu.
  const seasonWish = data?.season?.wish ?? '';
  const seasonAmount = data?.season?.amount ?? null;
  // Pachetul de sezon cu preț de ofertă (ex. Experiența TAF, 180 lei → 149,99): se vinde doar pachetul.
  const pkg = data?.enabled && data.season?.packagePrice && seasonAmount ? { name: data.season.packageName ?? '', items: (data.season.packageItems ?? '').split(',').map((x) => x.trim()).filter(Boolean), value: seasonAmount, price: data.season.packagePrice } : null;
  const [wishSet, setWishSet] = useState(false);
  useEffect(() => {
    if ((seasonWish || seasonAmount) && !wishSet) {
      if (seasonWish) setMessage((m) => m || seasonWish);
      if (seasonAmount) setAmount((a) => a ?? seasonAmount);
      setWishSet(true);
    }
  }, [seasonWish, seasonAmount, wishSet]);
  // După plata online clientul revine din browser: reîncărcăm ca să apară codul.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load());
    return () => sub.remove();
  }, [load]);

  if (gate) return gate;
  const online = !!business?.onlinePayments;
  if (!data) return <Screen edges={[]}>{error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.gold} />}</Screen>;

  const buy = async () => {
    if (!token || !amount) return;
    setBusy(true);
    setError(null);
    try {
      await api.buyGiftCard(token, { amount, recipientName: name.trim(), recipientPhone: phone.trim() || undefined, message: message.trim() || undefined, promoCode: quote?.code });
      setDone(true);
      setAmount(seasonAmount);
      setName('');
      setPhone('');
      setMessage(seasonWish);
      setPromo('');
      setQuote(null);
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pay = async (g: GiftCard) => {
    if (!token) return;
    setError(null);
    try {
      const { url } = await api.payGiftCard(token, g.id);
      await Linking.openURL(url);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const cancel = async (g: GiftCard) => {
    if (!token) return;
    try {
      await api.cancelGiftCard(token, g.id);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const season = data.enabled ? data.season : null;
  const seasonImg = mediaUrl(season?.imageUrl);
  return (
    <Screen edges={['bottom']}>
      {season ? (
        // Campania de sezon: poza festivă și textul din panou, deasupra formularului.
        <Card style={{ padding: 0, overflow: 'hidden', borderColor: colors.gold }}>
          {seasonImg ? <Image source={{ uri: seasonImg }} style={{ width: '100%', aspectRatio: 2 }} resizeMode="cover" accessibilityLabel={season.title} /> : null}
          <View style={{ padding: space.md, gap: 4 }}>
            {season.kicker ? <Text style={{ color: colors.gold, fontWeight: '800', letterSpacing: 1.5, fontSize: 12 }}>{season.kicker}</Text> : null}
            <Text style={[styles.cardTitle, { fontSize: 20 }]}>{season.title}</Text>
            {season.text ? <Text style={styles.muted}>{season.text}</Text> : null}
          </View>
        </Card>
      ) : null}
      {data.received.length ? (
        <>
          <Text style={[styles.label, { color: colors.gold }]}>{t('gift.received')}</Text>
          <View style={{ gap: space.sm }}>
            {data.received.map((g) => (
              <GiftRow key={g.id} g={g} from={g.buyerName} shop={business?.name} />
            ))}
          </View>
        </>
      ) : null}

      {data.enabled ? (
        <>
          <Text style={[styles.label, { color: colors.gold }]}>{t('gift.give')}</Text>
          <Card style={{ gap: space.sm }}>
            {pkg ? (
              <View style={{ borderWidth: 2, borderColor: colors.gold, borderRadius: radius.lg, padding: space.md, gap: 4 }}>
                <Text style={[styles.cardTitle, { fontSize: 20 }]}>{pkg.name}</Text>
                {pkg.items.map((x) => (
                  <Text key={x} style={styles.text}>
                    <Text style={{ color: colors.gold, fontWeight: '800' }}>✓ </Text>
                    {x}
                  </Text>
                ))}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                  <Text style={{ color: colors.muted, textDecorationLine: 'line-through', fontSize: 18, fontWeight: '700' }}>{t('common.lei', { n: money(pkg.value, lang) })}</Text>
                  <Text style={quote ? { color: colors.muted, textDecorationLine: 'line-through', fontSize: 18, fontWeight: '700' } : { color: colors.text, fontSize: 30, fontWeight: '800' }}>
                    {t('common.lei', { n: money(pkg.price, lang) })}
                  </Text>
                </View>
                {quote ? <Text style={{ color: colors.gold, fontSize: 32, fontWeight: '800' }}>{t('common.lei', { n: money(quote.price, lang) })}</Text> : null}
                <Text style={{ color: colors.success, fontWeight: '700' }}>{t('gift.save', { n: money(Math.round((pkg.value - (quote?.price ?? pkg.price)) * 100) / 100, lang) })}</Text>
              </View>
            ) : null}
            {pkg ? null : <Text style={styles.muted}>{t('gift.pickAmount')}</Text>}
            {pkg ? null : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {data.amounts.map((a) => (
                <Pressable
                  key={a}
                  onPress={() => {
                    setAmount(a);
                    setDone(false);
                    if (promo.trim()) applyPromo(promo, a);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: amount === a }}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 18,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: amount === a ? colors.gold : colors.border,
                    backgroundColor: amount === a ? colors.gold : 'transparent',
                  }}
                >
                  <Text style={{ color: amount === a ? '#000' : colors.text, fontWeight: '700' }}>{lei(a)}</Text>
                </Pressable>
              ))}
            </View>
            )}
            <TextInput value={name} onChangeText={setName} style={styles.input} placeholder={t('gift.forWho')} placeholderTextColor={colors.muted} maxLength={80} />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              style={styles.input}
              placeholder={t('gift.phone')}
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
            />
            <TextInput value={message} onChangeText={setMessage} style={styles.input} placeholder={t('gift.wish')} placeholderTextColor={colors.muted} maxLength={200} />
            <Text style={styles.muted}>{t('gift.promo')}</Text>
            <View style={[styles.row, { gap: space.sm }]}>
              <TextInput
                value={promo}
                onChangeText={(v) => {
                  setPromo(v.toUpperCase());
                  setQuote(null);
                  setPromoErr(null);
                }}
                onSubmitEditing={() => applyPromo(promo, amount)}
                style={[styles.input, { flex: 1 }]}
                placeholder="CRACIUN-AB12C"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
              />
              <View style={{ width: 110 }}>
                <Button title={t('gift.promoApply')} variant="ghost" onPress={() => applyPromo(promo, amount)} disabled={!promo.trim() || !amount} loading={promoBusy} />
              </View>
            </View>
            {quote ? <Text style={{ color: colors.success }}>{pkg ? t('gift.promoOkPkg', { off: money(quote.discount, lang), price: money(quote.price, lang) }) : t('gift.promoOk', { amount: quote.amount, price: money(quote.price, lang) })}</Text> : null}
            {promoErr ? <Text style={{ color: colors.danger }}>{promoErr}</Text> : null}
            <Text style={[styles.muted, { fontSize: 13 }]}>
              {online ? t('gift.payOnlineOr') : t('gift.payAtSalon')} {t('gift.info', { months: data.validMonths })}
            </Text>
            <Button title={pkg ? `${data.season?.cta || pkg.name} · ${t('common.lei', { n: money(quote?.price ?? pkg.price, lang) })}` : amount ? (quote ? t('gift.orderPrice', { n: amount, p: money(quote.price, lang) }) : t('gift.order', { n: amount })) : t('gift.pickAmount')} onPress={buy} disabled={!amount || !name.trim()} loading={busy} />
            {done ? (
              <Text style={{ color: colors.success }}>
                {online
                  ? t('gift.doneOnline')
                  : t('gift.doneSalon')}
              </Text>
            ) : null}
          </Card>
        </>
      ) : (
        <Text style={styles.muted}>{t('gift.off')}</Text>
      )}
      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}

      {data.bought.length ? (
        <>
          <Text style={[styles.label, { color: colors.gold }]}>{t('gift.bought')}</Text>
          <View style={{ gap: space.sm }}>
            {data.bought.map((g) => (
              <GiftRow
                key={g.id}
                g={g}
                to={g.recipientName}
                onCancel={g.status === 'pending' ? () => cancel(g) : undefined}
                onPay={g.status === 'pending' && online ? () => pay(g) : undefined}
                shop={business?.name}
              />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function GiftRow({ g, from, to, onCancel, onPay, shop }: { g: GiftCard; from?: string | null; to?: string; onCancel?: () => void; onPay?: () => void; shop?: string }) {
  const { t, lang } = useT();
  const until = g.expiresAt ? t('common.until', { date: formatDate(new Date(g.expiresAt)) }) : '';
  const share = () =>
    Share.share({
      message: `${t('gift.shareMsg', { shop: shop ?? 'TAF Barbers', amount: g.amount })}${to ? t('gift.shareFor', { name: to }) : ''}. ${t('gift.shareCode', { code: g.code ?? '' })}${until ? `, ${until}` : ''}.`,
    });
  return (
    <Card style={{ gap: 4, borderColor: g.status === 'active' ? colors.gold : colors.border }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <View style={[styles.row, { gap: 8, flex: 1 }]}>
          <Ionicons name="gift" size={22} color={colors.gold} />
          <Text style={styles.cardTitle}>
            {g.packageName || lei(g.amount)}
            {to ? t('gift.for', { name: to }) : from ? t('gift.from', { name: from.split(' ')[0] }) : ''}
          </Text>
        </View>
        <Text style={{ color: g.status === 'active' ? colors.success : colors.muted, fontWeight: '700', fontSize: 13 }}>{t(STATUS[g.status])}</Text>
      </View>
      {g.code ? (
        <Text selectable style={{ color: colors.gold, fontSize: 22, fontWeight: '800', letterSpacing: 1 }}>
          {g.code}
        </Text>
      ) : null}
      {g.status === 'active' ? (
        <Text style={styles.muted}>
          {t('gift.balance', { n: g.balance })}
          {until ? ` · ${until}` : ''}. {t('gift.sayCode')}
        </Text>
      ) : null}
      {g.promoCode && g.price != null && g.price !== g.amount ? <Text style={[styles.muted, { fontSize: 13 }]}>{t('gift.paidWith', { p: money(g.price, lang), code: g.promoCode })}</Text> : null}
      {g.message ? <Text style={[styles.text, { fontStyle: 'italic' }]}>„{g.message}”</Text> : null}
      <View style={[styles.row, { gap: space.sm, marginTop: 4 }]}>
        {g.code && to ? (
          <View style={{ flex: 1 }}>
            <Button title={t('gift.send')} variant="ghost" onPress={share} />
          </View>
        ) : null}
        {onPay ? (
          <View style={{ flex: 1 }}>
            <Button title={t('common.payOnline')} onPress={onPay} />
          </View>
        ) : null}
        {onCancel ? (
          <View style={{ flex: 1 }}>
            <Button title={t('bookings.cancel')} variant="ghost" onPress={onCancel} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}
