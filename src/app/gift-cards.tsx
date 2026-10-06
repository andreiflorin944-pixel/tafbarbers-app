import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, Share, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { useLoginGate } from '@/components/LoginGate';
import { Button, Card, Screen, styles } from '@/components/ui';
import type { GiftCard, GiftCards } from '@/data/types';
import { formatDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

const STATUS: Record<GiftCard['status'], string> = {
  pending: 'Neplătit',
  active: 'Activ',
  used: 'Folosit',
  cancelled: 'Anulat',
  expired: 'Expirat',
};

// Card cadou: clientul alege suma și cui îl dă, plătește la salon, iar destinatarul primește codul.
export default function GiftCardsScreen() {
  const { token, business } = useApp();
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
          <Text style={[styles.label, { color: colors.gold }]}>Ai primit</Text>
          <View style={{ gap: space.sm }}>
            {data.received.map((g) => (
              <GiftRow key={g.id} g={g} from={g.buyerName} shop={business?.name} />
            ))}
          </View>
        </>
      ) : null}

      {data.enabled ? (
        <>
          <Text style={[styles.label, { color: colors.gold }]}>Fă cadou o tunsoare</Text>
          <Card style={{ gap: space.sm }}>
            <Text style={styles.muted}>Alege suma</Text>
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
                  <Text style={{ color: amount === a ? '#000' : colors.text, fontWeight: '700' }}>{a} lei</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Pentru cine (nume)" placeholderTextColor={colors.muted} maxLength={80} />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              style={styles.input}
              placeholder="Telefonul lui (primește codul prin SMS)"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
            />
            <TextInput value={message} onChangeText={setMessage} style={styles.input} placeholder="O urare (opțional)" placeholderTextColor={colors.muted} maxLength={200} />
            <Text style={[styles.muted, { fontSize: 13 }]}>
              {online ? 'Îl plătești acum cu cardul sau la salon.' : 'Plătești cardul la salon.'} După plată, cel care îl primește are codul prin SMS și în aplicație. E valabil {data.validMonths} luni și se poate
              folosi la orice serviciu.
            </Text>
            <Button title={amount ? `Comandă cardul de ${amount} lei` : 'Alege suma'} onPress={buy} disabled={!amount || !name.trim()} loading={busy} />
            {done ? (
              <Text style={{ color: colors.success }}>
                {online
                  ? 'Gata! Apasă „Plătește online” mai jos sau plătește-l la următoarea vizită, iar codul pleacă imediat.'
                  : 'Gata! Cardul te așteaptă la salon: îl plătești la următoarea vizită și pleacă imediat codul.'}
              </Text>
            ) : null}
          </Card>
        </>
      ) : (
        <Text style={styles.muted}>Momentan salonul nu vinde carduri cadou din aplicație.</Text>
      )}
      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}

      {data.bought.length ? (
        <>
          <Text style={[styles.label, { color: colors.gold }]}>Cardurile date de tine</Text>
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
  const share = () =>
    Share.share({
      message: `Card cadou ${shop ?? 'TAF Barbers'}: ${g.amount} lei${to ? ` pentru ${to}` : ''}. Cod: ${g.code}${g.expiresAt ? `, valabil până pe ${formatDate(new Date(g.expiresAt))}` : ''}.`,
    });
  return (
    <Card style={{ gap: 4, borderColor: g.status === 'active' ? colors.gold : colors.border }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <View style={[styles.row, { gap: 8, flex: 1 }]}>
          <Ionicons name="gift" size={22} color={colors.gold} />
          <Text style={styles.cardTitle}>
            {g.amount} lei{to ? ` · pentru ${to}` : from ? ` · de la ${from.split(' ')[0]}` : ''}
          </Text>
        </View>
        <Text style={{ color: g.status === 'active' ? colors.success : colors.muted, fontWeight: '700', fontSize: 13 }}>{STATUS[g.status]}</Text>
      </View>
      {g.code ? (
        <Text selectable style={{ color: colors.gold, fontSize: 22, fontWeight: '800', letterSpacing: 1 }}>
          {g.code}
        </Text>
      ) : null}
      {g.status === 'active' ? (
        <Text style={styles.muted}>
          Mai are {g.balance} lei{g.expiresAt ? ` · valabil până pe ${formatDate(new Date(g.expiresAt))}` : ''}. Spune codul la plată.
        </Text>
      ) : null}
      {g.message ? <Text style={[styles.text, { fontStyle: 'italic' }]}>„{g.message}”</Text> : null}
      <View style={[styles.row, { gap: space.sm, marginTop: 4 }]}>
        {g.code && to ? (
          <View style={{ flex: 1 }}>
            <Button title="Trimite codul" variant="ghost" onPress={share} />
          </View>
        ) : null}
        {onPay ? (
          <View style={{ flex: 1 }}>
            <Button title="Plătește online" onPress={onPay} />
          </View>
        ) : null}
        {onCancel ? (
          <View style={{ flex: 1 }}>
            <Button title="Anulează" variant="ghost" onPress={onCancel} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}
