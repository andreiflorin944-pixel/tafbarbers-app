import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api, usingMock } from '@/api';
import { Button, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { parseBirth } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

/** Login cu numărul de telefon și un cod primit pe e-mail (principal) sau pe SMS (alternativă). */
export function PhoneLogin({ submitTitle, onDone }: { submitTitle?: string; onDone: (token: string) => void | Promise<void> }) {
  const { signIn } = useApp();
  const { lang } = useT();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [phoneSent, setPhoneSent] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [birth, setBirth] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanPhone = phone.replace(/[\s\-().]/g, '');
  const cleanEmail = email.trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
  const birthOk = !!parseBirth(birth);
  const phoneOk = /^\+?\d{9,15}$/.test(cleanPhone) && name.trim().length >= 2;

  const send = async (via: 'email' | 'sms') => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestCode({ phone: cleanPhone, email: emailOk ? cleanEmail : undefined, channel: via }, lang);
      setChannel(r.channel);
      setSentTo(r.sentTo);
      setPhoneSent(r.phone);
      setIsNew(!!r.newAccount);
      setDevCode(r.devCode);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.verifyCode({
        phone: phoneSent!,
        code,
        name: name.trim(),
        lang,
        acceptTerms: accepted,
        birthDate: parseBirth(birth) ?? undefined,
        email: emailOk ? cleanEmail : undefined,
      });
      await signIn(token);
      await onDone(token);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={styles.label}>Nume</Text>
      <TextInput value={name} onChangeText={setName} editable={!sentTo} placeholder="Numele tău" placeholderTextColor={colors.muted} style={styles.input} autoComplete="name" />
      <Text style={styles.label}>Telefon</Text>
      <TextInput value={phone} onChangeText={setPhone} editable={!sentTo} placeholder="07xx xxx xxx" placeholderTextColor={colors.muted} style={styles.input} keyboardType="phone-pad" autoComplete="tel" />
      <Text style={styles.label}>E-mail</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        editable={!sentTo}
        placeholder="nume@exemplu.ro"
        placeholderTextColor={colors.muted}
        style={styles.input}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
      />

      {sentTo ? (
        <>
          {isNew ? (
            <>
              <Text style={styles.label}>Data nașterii (cont nou)</Text>
              <TextInput
                value={birth}
                onChangeText={setBirth}
                placeholder="ZZ.LL.AAAA"
                placeholderTextColor={colors.muted}
                style={styles.input}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
              {birth.length >= 8 && !birthOk ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>Scrie data așa: 17.05.1990</Text> : null}
              {!emailOk ? <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>Pentru cont nou avem nevoie și de e-mail. Apasă „Schimbă datele” și completează-l.</Text> : null}
            </>
          ) : null}
          <Text style={styles.label}>Codul primit pe {channel === 'email' ? 'e-mail' : 'SMS'} la {sentTo}</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            placeholder="1234"
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="number-pad"
            autoComplete={channel === 'sms' ? 'sms-otp' : 'one-time-code'}
            textContentType="oneTimeCode"
            maxLength={4}
          />
          {usingMock ? (
            <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>Versiune de test: orice cod din 4 cifre e acceptat.</Text>
          ) : devCode ? (
            <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>Server de test, codul este {devCode}.</Text>
          ) : null}
          <Pressable
            onPress={() => {
              setSentTo(null);
              setCode('');
            }}
            style={{ marginTop: space.sm }}
          >
            <Text style={{ color: colors.gold, fontSize: 13 }}>Schimbă datele sau retrimite codul</Text>
          </Pressable>
        </>
      ) : null}

      <Pressable
        onPress={() => setAccepted((a) => !a)}
        style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginTop: space.md }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel="Sunt de acord cu termenii și politica de confidențialitate"
      >
        <Ionicons name={accepted ? 'checkbox' : 'square-outline'} size={22} color={accepted ? colors.gold : colors.muted} />
        <Text style={[styles.muted, { flex: 1, fontSize: 13, lineHeight: 19 }]}>
          Sunt de acord cu{' '}
          <Text style={{ color: colors.gold }} onPress={() => router.push('/legal/terms')}>
            Termenii și condițiile
          </Text>{' '}
          și cu{' '}
          <Text style={{ color: colors.gold }} onPress={() => router.push('/legal/privacy')}>
            Politica de confidențialitate
          </Text>
          .
        </Text>
      </Pressable>

      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}

      <View style={{ marginTop: space.lg }}>
        {sentTo ? (
          <Button title={submitTitle ?? 'Confirmă'} disabled={code.length !== 4 || !accepted || (isNew && (!birthOk || !emailOk))} loading={busy} onPress={verify} />
        ) : (
          <>
            <Button title="Trimite codul pe e-mail" disabled={!phoneOk || !emailOk || !accepted} loading={busy} onPress={() => send('email')} />
            <Pressable
              onPress={() => send('sms')}
              disabled={!phoneOk || !accepted || busy}
              style={{ marginTop: space.md, alignItems: 'center', opacity: !phoneOk || !accepted ? 0.4 : 1 }}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.gold, fontSize: 14, fontWeight: '600' }}>Nu ai acces la e-mail? Primește codul pe SMS</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}
