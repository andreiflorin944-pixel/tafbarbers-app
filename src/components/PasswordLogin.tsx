import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, usingMock } from '@/api';
import { ApiError } from '@/api/client';
import { Button, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { colors, radius, space } from '@/theme';

type Step = 'login' | 'forgot' | 'reset';

export const PASSWORD_MIN = 8;

/** Câmp de parolă cu butonul „arată / ascunde”. */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: 'current-password' | 'new-password';
}) {
  const { t } = useT();
  const [show, setShow] = useState(false);
  return (
    <View style={{ justifyContent: 'center' }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, { paddingRight: 48 }]}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={autoComplete}
        textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
        maxLength={200}
      />
      <Pressable
        onPress={() => setShow((s) => !s)}
        style={local.eye}
        accessibilityRole="button"
        accessibilityLabel={t(show ? 'pw.hide' : 'pw.show')}
        hitSlop={8}
      >
        <Ionicons name={show ? 'eye-off' : 'eye'} size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

/**
 * Intrarea cu e-mail (sau telefon) și parolă, plus „Am uitat parola”: codul de recuperare vine pe e-mailul contului,
 * apoi codul + parola nouă intră direct în cont.
 */
export function PasswordLogin({ onDone }: { onDone: (token: string) => Promise<void> }) {
  const { lang, t } = useT();
  const [step, setStep] = useState<Step>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = identifier.trim();
  const idOk = id.includes('@') ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id) : /^\+?\d{9,15}$/.test(id.replace(/[\s\-().]/g, ''));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // Date greșite: un singur mesaj, fie e-mail, fie telefon.
      setError(e instanceof ApiError && e.code === 'wrong_credentials' ? t('pw.wrong') : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const login = () =>
    run(async () => {
      const { token } = await api.passwordLogin({ identifier: id, password });
      await onDone(token);
    });

  const sendReset = () =>
    run(async () => {
      const r = await api.forgotPassword({ identifier: id }, lang);
      setDevCode(r.devCode);
      setCode('');
      setStep('reset');
      setNotice(t('pw.sent'));
    });

  const reset = () =>
    run(async () => {
      // Acordul e cel din textul de sub formular (pentru clienții adăugați din panou, care nu l-au dat încă).
      const { token } = await api.resetPassword({
        identifier: id,
        code,
        password: newPassword,
        acceptTerms: true,
        lang,
      });
      await onDone(token);
    });

  const go = (s: Step) => {
    setStep(s);
    setError(null);
    if (s !== 'reset') setNotice(null);
  };

  const field = (label: string, el: ReactNode, hint?: string | null) => (
    <View style={{ marginTop: space.md }}>
      <Text style={local.label}>{label}</Text>
      {el}
      {hint ? <Text style={local.hint}>{hint}</Text> : null}
    </View>
  );

  const link = (title: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ marginTop: space.md, alignItems: 'center' }} accessibilityRole="button">
      <Text style={{ color: colors.gold, fontSize: 14, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );

  return (
    <View>
      {step !== 'login' ? (
        <>
          <Text style={[local.label, { fontSize: 17, marginTop: space.sm }]}>{t('pw.forgotTitle')}</Text>
          <Text style={local.sub}>{t('pw.forgotSub')}</Text>
        </>
      ) : null}

      {notice ? (
        <View style={local.notice}>
          <Ionicons name="information-circle" size={18} color={colors.gold} />
          <Text style={[styles.text, { flex: 1, fontSize: 13 }]}>{notice}</Text>
        </View>
      ) : null}

      {field(
        t('pw.identifier'),
        <TextInput
          value={identifier}
          onChangeText={setIdentifier}
          editable={step !== 'reset'}
          placeholder={t('pw.identifierPh')}
          placeholderTextColor={colors.muted}
          style={[styles.input, step === 'reset' ? { opacity: 0.6 } : null]}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
        />,
      )}

      {step === 'login' ? field(t('pw.password'), <PasswordInput value={password} onChange={setPassword} placeholder={t('pw.passwordPh')} />) : null}

      {step === 'reset' ? (
        <>
          {field(
            t('pw.code'),
            <TextInput
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
              placeholder="• • • • • •"
              placeholderTextColor={colors.muted}
              style={[styles.input, local.code]}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
            />,
            usingMock ? t('login.mockCode') : devCode ? t('login.devCode', { code: devCode }) : null,
          )}
          {field(
            t('pw.newPassword'),
            <PasswordInput value={newPassword} onChange={setNewPassword} placeholder={t('pw.newPasswordPh')} autoComplete="new-password" />,
            t('pw.rule'),
          )}
        </>
      ) : null}

      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}

      <View style={{ marginTop: space.lg }}>
        {step === 'login' ? (
          <Button title={t('login.submitLogin')} disabled={!idOk || !password} loading={busy} onPress={login} />
        ) : step === 'forgot' ? (
          <Button title={t('pw.sendCode')} disabled={!idOk} loading={busy} onPress={sendReset} />
        ) : (
          <Button title={t('pw.resetSubmit')} disabled={code.length !== 6 || newPassword.length < PASSWORD_MIN} loading={busy} onPress={reset} />
        )}
      </View>

      {step === 'login' ? (
        <>
          {link(t('pw.forgot'), () => go('forgot'))}
          <Text style={[local.hint, { textAlign: 'center', marginTop: space.sm }]}>{t('pw.noPassword')}</Text>
        </>
      ) : (
        <>
          {step === 'reset' ? link(t('pw.resend'), () => go('forgot')) : null}
          {link(t('pw.back'), () => go('login'))}
        </>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 5 },
  eye: {
    position: 'absolute',
    right: 12,
    height: 52,
    justifyContent: 'center',
  },
  notice: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.md,
    borderWidth: 1,
    borderColor: colors.goldDark,
  },
  code: {
    fontSize: 26,
    letterSpacing: 8,
    textAlign: 'center',
    fontWeight: '800',
  },
});
