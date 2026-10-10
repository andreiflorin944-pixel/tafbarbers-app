import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Text } from 'react-native';
import { PhoneLogin } from '@/components/PhoneLogin';
import { Screen, styles } from '@/components/ui';
import { space } from '@/theme';
import { useT } from '@/i18n';

export default function Login() {
  // `next`: unde revii după login (ex. pasul de programare de unde ai venit).
  const { next, reason, ref, mode } = useLocalSearchParams<{ next?: string; reason?: string; ref?: string; mode?: string }>();
  const { t } = useT();
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  return (
    <Screen edges={['bottom']}>
      {reason === 'book' ? (
        <Text style={[styles.muted, { marginBottom: space.md }]}>
          {t('login.bookReason')}
        </Text>
      ) : null}
      <PhoneLogin initialMode={mode === 'register' ? 'register' : undefined} initialRef={typeof ref === 'string' ? ref : undefined} onDone={() => (safeNext ? router.replace(safeNext as Href) : router.canGoBack() ? router.back() : router.replace('/'))} />
    </Screen>
  );
}
