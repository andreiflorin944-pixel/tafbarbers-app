import { router } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { usingMock } from '@/api';
import { Button, Screen, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

export default function StaffLogin() {
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
      await staffSignIn(email, password);
      router.replace('/staff');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Text style={[styles.muted, { marginBottom: space.sm }]}>{t('slogin.intro')}</Text>
      {usingMock ? (
        <Text style={{ color: colors.gold, marginBottom: space.sm }}>{t('slogin.mock')}</Text>
      ) : null}
      <Text style={styles.label}>{t('account.email')}</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        style={styles.input}
        placeholder={t('slogin.emailPh')}
        placeholderTextColor={colors.muted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <Text style={styles.label}>{t('slogin.password')}</Text>
      <TextInput value={password} onChangeText={setPassword} style={styles.input} secureTextEntry autoComplete="password" placeholderTextColor={colors.muted} />
      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}
      <View style={{ marginTop: space.lg }}>
        <Button title={t('common.login')} onPress={submit} loading={busy} disabled={!email || !password || usingMock} />
      </View>
    </Screen>
  );
}
