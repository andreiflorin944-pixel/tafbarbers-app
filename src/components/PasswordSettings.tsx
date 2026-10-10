import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api, usingMock } from '@/api';
import { PASSWORD_MIN, PasswordInput } from '@/components/PasswordLogin';
import { Button, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

/**
 * Parola contului, din ecranul Cont. Prima parolă se pune direct (clientul e deja în cont); schimbarea cere parola
 * de acum sau un cod proaspăt primit pe e-mail. La schimbare, celelalte dispozitive ies din cont.
 */
export function PasswordSettings() {
  const { user, token, updateMe } = useApp();
  const { lang, t } = useT();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState<{ to: string; devCode?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!user || !token) return null;
  const has = !!user.hasPassword;

  const reset = () => {
    setCurrent('');
    setNext('');
    setCode('');
    setCodeSent(null);
  };

  const sendCode = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.passwordCode(token, lang);
      setCodeSent({ to: r.sentTo, devCode: r.devCode });
      setCode('');
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.setPassword(token, { password: next, ...(has && (codeSent ? { code } : { current })) });
      await updateMe({});
      setMsg({ ok: true, text: t(has ? 'pw.saved' : 'pw.savedFirst') });
      reset();
      setOpen(false);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const proofOk = !has || (codeSent ? code.length === 6 : current.length > 0);

  return (
    <View style={{ marginTop: space.lg }}>
      <Text style={[styles.label, { color: colors.gold }]}>{t('pw.section')}</Text>
      <Text style={styles.muted}>{t(has ? 'pw.has' : 'pw.noneYet')}</Text>
      {!open ? (
        <View style={{ marginTop: space.md }}>
          <Button
            title={t(has ? 'pw.change' : 'pw.set')}
            variant="ghost"
            onPress={() => {
              setOpen(true);
              setMsg(null);
            }}
          />
        </View>
      ) : (
        <>
          {has && !codeSent ? (
            <>
              <Text style={styles.label}>{t('pw.current')}</Text>
              <PasswordInput value={current} onChange={setCurrent} />
              <Pressable onPress={sendCode} disabled={busy} accessibilityRole="button" style={{ marginTop: space.sm }}>
                <Text style={{ color: colors.gold, fontSize: 13, fontWeight: '600' }}>{t('pw.useCode')}</Text>
              </Pressable>
            </>
          ) : null}
          {has && codeSent ? (
            <>
              <Text style={styles.label}>{t('pw.codeSentTo', { to: codeSent.to })}</Text>
              <TextInput
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
                placeholder="• • • • • •"
                placeholderTextColor={colors.muted}
                style={[styles.input, { letterSpacing: 6, textAlign: 'center', fontWeight: '800' }]}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
              />
              {usingMock ? (
                <Text style={[styles.muted, { fontSize: 12 }]}>{t('login.mockCode')}</Text>
              ) : codeSent.devCode ? (
                <Text style={[styles.muted, { fontSize: 12 }]}>{t('login.devCode', { code: codeSent.devCode })}</Text>
              ) : null}
              <Pressable onPress={() => setCodeSent(null)} accessibilityRole="button" style={{ marginTop: space.sm }}>
                <Text style={{ color: colors.gold, fontSize: 13, fontWeight: '600' }}>{t('pw.useCurrent')}</Text>
              </Pressable>
            </>
          ) : null}
          <Text style={styles.label}>{t('pw.newPassword')}</Text>
          <PasswordInput value={next} onChange={setNext} placeholder={t('pw.newPasswordPh')} autoComplete="new-password" />
          <Text style={[styles.muted, { fontSize: 12, marginTop: 4 }]}>{t('pw.rule')}</Text>
          <View style={{ marginTop: space.md, gap: space.sm }}>
            <Button title={t(has ? 'pw.change' : 'pw.set')} disabled={next.length < PASSWORD_MIN || !proofOk} loading={busy} onPress={save} />
            <Button
              title={t('account.cancel')}
              variant="ghost"
              onPress={() => {
                reset();
                setOpen(false);
                setMsg(null);
              }}
            />
          </View>
        </>
      )}
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginTop: space.sm }}>{msg.text}</Text> : null}
    </View>
  );
}
