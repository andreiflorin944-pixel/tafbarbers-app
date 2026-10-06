import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Text } from 'react-native';
import { PhoneLogin } from '@/components/PhoneLogin';
import { Screen, styles } from '@/components/ui';
import { space } from '@/theme';

export default function Login() {
  // `next`: unde revii după login (ex. pasul de programare de unde ai venit).
  const { next, reason, ref, mode } = useLocalSearchParams<{ next?: string; reason?: string; ref?: string; mode?: string }>();
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  return (
    <Screen edges={['bottom']}>
      {reason === 'book' ? (
        <Text style={[styles.muted, { marginBottom: space.md }]}>
          Programările se fac din contul tău. Intri o singură dată cu un cod, apoi alegi serviciul, frizerul și ora. N-ai cont? Apasă „Creează cont”.
        </Text>
      ) : null}
      <PhoneLogin initialMode={mode === 'register' ? 'register' : undefined} initialRef={typeof ref === 'string' ? ref : undefined} onDone={() => (safeNext ? router.replace(safeNext as Href) : router.canGoBack() ? router.back() : router.replace('/'))} />
    </Screen>
  );
}
