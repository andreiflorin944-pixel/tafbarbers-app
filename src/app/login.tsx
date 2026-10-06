import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Text } from 'react-native';
import { PhoneLogin } from '@/components/PhoneLogin';
import { Screen, styles } from '@/components/ui';
import { space } from '@/theme';

export default function Login() {
  // `next`: unde revii după login (ex. pasul de programare de unde ai venit).
  const { next, reason, ref } = useLocalSearchParams<{ next?: string; reason?: string; ref?: string }>();
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  return (
    <Screen edges={['bottom']}>
      {reason === 'book' ? (
        <Text style={[styles.muted, { marginBottom: space.md }]}>
          Programările se fac din contul tău. Intri o singură dată cu un cod primit pe e-mail, apoi alegi serviciul, frizerul și ora.
        </Text>
      ) : null}
      <PhoneLogin initialRef={typeof ref === 'string' ? ref : undefined} onDone={() => (safeNext ? router.replace(safeNext as Href) : router.canGoBack() ? router.back() : router.replace('/'))} />
    </Screen>
  );
}
