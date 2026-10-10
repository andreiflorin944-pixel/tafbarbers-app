import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { usingMock } from '@/api';
import { PasswordInput } from '@/components/PasswordLogin';
import { Button, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

/** Intrarea echipei (proprietar și frizeri) cu e-mailul și parola din panou. Folosită pe ecranul de intrare și în /staff/login. */
export function StaffLoginForm({ onDone }: { onDone: () => void }) {
  const { staffSignIn } = useStaff();
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await staffSignIn(email.trim(), password);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={[styles.muted, { marginBottom: space.sm }]}>{t('slogin.intro')}</Text>
      {usingMock ? <Text style={{ color: colors.gold, marginBottom: space.sm }}>{t('slogin.mock')}</Text> : null}
      <Text style={styles.label}>{t('account.email')}</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        style={styles.input}
        placeholder={t('slogin.emailPh')}
        placeholderTextColor={colors.muted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
      />
      <Text style={styles.label}>{t('slogin.password')}</Text>
      <PasswordInput value={password} onChange={setPassword} />
      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}
      <View style={{ marginTop: space.lg }}>
        <Button title={t('common.login')} onPress={submit} loading={busy} disabled={!email || !password || usingMock} />
      </View>
    </View>
  );
}
