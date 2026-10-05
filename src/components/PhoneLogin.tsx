import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api, usingMock } from '@/api';
import { Button, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

/** Login cu numărul de telefon și cod primit pe SMS. Folosit la „Intră în cont” și la confirmarea programării. */
export function PhoneLogin({ submitTitle, onDone }: { submitTitle?: string; onDone: (token: string) => void | Promise<void> }) {
  const { signIn } = useApp();
  const { lang } = useT();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanPhone = phone.replace(/[\s\-().]/g, '');
  const phoneOk = /^\+?\d{9,15}$/.test(cleanPhone) && name.trim().length >= 2;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestCode(cleanPhone, lang);
      setSentTo(r.phone);
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
      const { token } = await api.verifyCode({ phone: sentTo!, code, name: name.trim(), lang });
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

      {sentTo ? (
        <>
          <Text style={styles.label}>Codul primit pe SMS la {sentTo}</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            placeholder="1234"
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="number-pad"
            autoComplete="sms-otp"
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
            <Text style={{ color: colors.gold, fontSize: 13 }}>Schimbă numărul sau retrimite codul</Text>
          </Pressable>
        </>
      ) : null}

      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}

      <View style={{ marginTop: space.lg }}>
        {sentTo ? (
          <Button title={submitTitle ?? 'Confirmă'} disabled={code.length !== 4} loading={busy} onPress={verify} />
        ) : (
          <Button title="Trimite codul pe SMS" disabled={!phoneOk} loading={busy} onPress={send} />
        )}
      </View>
    </View>
  );
}
