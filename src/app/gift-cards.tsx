import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, Share, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { useLoginGate } from '@/components/LoginGate';
import { Button, Card, Screen, styles } from '@/components/ui';
import type { GiftCard, GiftCards } from '@/data/types';
import { useT, type Key } from '@/i18n';
import { formatDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { lei } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

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
  const { t } = useT();
  const gate = useLoginGate();
  const [data, setData] = useState<GiftCards | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(() => {
    if (token) api.getGiftCards(token).then(setData, (e) => setError(errorMessage(e)));
  }, [token]);
  useEffect(load, [load]);
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
      await api.buyGiftCard(token, { amount, recipientName: name.trim(), recipientPhone: phone.trim() || undefined, message: message.trim() || undefined });
      setDone(true);
      setAmount(null);
      setName('');
      setPhone('');
      setMessage('');
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

  return (
    <Screen edges={['bottom']}>
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
            <Text style={styles.muted}>{t('gift.pickAmount')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {data.amounts.map((a) => (
                <Pressable
                  key={a}
                  onPress={() => {
                    setAmount(a);
                    setDone(false);
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
            <Text style={[styles.muted, { fontSize: 13 }]}>
              {online ? t('gift.payOnlineOr') : t('gift.payAtSalon')} {t('gift.info', { months: data.validMonths })}
            </Text>
            <Button title={amount ? t('gift.order', { n: amount }) : t('gift.pickAmount')} onPress={buy} disabled={!amount || !name.trim()} loading={busy} />
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
  const { t } = useT();
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
            {lei(g.amount)}
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
