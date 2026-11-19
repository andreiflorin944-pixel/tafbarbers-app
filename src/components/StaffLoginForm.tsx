import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { usingMock } from '@/api';
import { staffApi } from '@/api/staff';
import { useCaptcha } from '@/components/Captcha';
import { PasswordInput } from '@/components/PasswordLogin';
import { Button, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

/** Parola conturilor din echipă are cel puțin 10 caractere (ca în panou). */
const STAFF_PASSWORD_MIN = 10;

type Step = 'login' | 'forgot' | 'reset';

/**
 * Intrarea echipei (proprietar și frizeri) cu e-mailul și parola din panou. Folosită pe ecranul de intrare și în /staff/login.
 * „Am uitat parola”: cod pe e-mailul contului (cu bifa „nu sunt robot”, cât e pornită din panou), apoi parola nouă.
 */
export function StaffLoginForm({ onDone }: { onDone: () => void }) {
  const { staffSignIn, staffSignInToken } = useStaff();
  const { t } = useT();
  const [step, setStep] = useState<Step>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captcha = useCaptcha();

  const mail = email.trim().toLowerCase();
  const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      await staffSignIn(mail, password);
      onDone();
    });

  const sendReset = () =>
    run(async () => {
      let r: Awaited<ReturnType<typeof staffApi.forgotPassword>>;
      try {
        r = await staffApi.forgotPassword(mail, captcha.token);
      } finally {
        if (captcha.required) captcha.reset();
      }
      setDevCode(r.devCode);
      setCode('');
      setNewPassword('');
      setStep('reset');
      setNotice(t('slogin.sent'));
    });

  const reset = () =>
    run(async () => {
      const { token } = await staffApi.resetPassword(mail, code, newPassword);
      await staffSignInToken(token);
      onDone();
    });

  const go = (s: Step) => {
    setStep(s);
    setError(null);
    if (s !== 'reset') setNotice(null);
  };

  const link = (title: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ marginTop: space.md, alignItems: 'center' }} accessibilityRole="button">
      <Text style={{ color: colors.gold, fontSize: 14, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );

  return (
    <View>
      {step === 'login' ? (
        <Text style={[styles.muted, { marginBottom: space.sm }]}>{t('slogin.intro')}</Text>
      ) : (
        <>
          <Text style={[styles.label, { fontSize: 17 }]}>{t('pw.forgotTitle')}</Text>
          <Text style={[styles.muted, { marginBottom: space.sm }]}>{t('slogin.forgotSub')}</Text>
        </>
      )}
      {usingMock ? <Text style={{ color: colors.gold, marginBottom: space.sm }}>{t('slogin.mock')}</Text> : null}
      {notice ? <Text style={[styles.muted, { color: colors.gold, marginBottom: space.sm }]}>{notice}</Text> : null}
      <Text style={styles.label}>{t('account.email')}</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        editable={step !== 'reset'}
        style={[styles.input, step === 'reset' ? { opacity: 0.6 } : null]}
        placeholder={t('slogin.emailPh')}
        placeholderTextColor={colors.muted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
      />
      {step === 'login' ? (
        <>
          <Text style={styles.label}>{t('slogin.password')}</Text>
          <PasswordInput value={password} onChange={setPassword} />
        </>
      ) : null}
      {step === 'reset' ? (
        <>
          <Text style={styles.label}>{t('pw.code')}</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            placeholder="• • • • • •"
            placeholderTextColor={colors.muted}
            style={[styles.input, { letterSpacing: 6, fontSize: 20, textAlign: 'center' }]}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
          />
          {devCode ? <Text style={styles.muted}>{t('login.devCode', { code: devCode })}</Text> : null}
          <Text style={styles.label}>{t('pw.newPassword')}</Text>
          <PasswordInput value={newPassword} onChange={setNewPassword} placeholder={t('slogin.newPasswordPh')} autoComplete="new-password" />
          <Text style={[styles.muted, { fontSize: 12, marginTop: 4 }]}>{t('slogin.rule')}</Text>
        </>
      ) : null}
      {step === 'forgot' ? captcha.element : null}
      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}
      <View style={{ marginTop: space.lg }}>
        {step === 'login' ? (
          <Button title={t('common.login')} onPress={submit} loading={busy} disabled={!email || !password || usingMock} />
        ) : step === 'forgot' ? (
          <Button title={t('pw.sendCode')} onPress={sendReset} loading={busy} disabled={!mailOk || !captcha.ready || usingMock} />
        ) : (
          <Button title={t('pw.resetSubmit')} onPress={reset} loading={busy} disabled={code.length !== 6 || newPassword.length < STAFF_PASSWORD_MIN} />
        )}
      </View>
      {step === 'login' ? link(t('pw.forgot'), () => go('forgot')) : null}
      {step === 'reset' ? link(t('pw.resend'), () => go('forgot')) : null}
      {step !== 'login' ? link(t('pw.back'), () => go('login')) : null}
    </View>
  );
}
