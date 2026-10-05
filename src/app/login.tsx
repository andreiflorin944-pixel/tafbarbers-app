import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Text } from 'react-native';
import { PhoneLogin } from '@/components/PhoneLogin';
import { Screen, styles } from '@/components/ui';
import { space } from '@/theme';

export default function Login() {
  // `next`: unde revii după login (ex. pasul de programare de unde ai venit).
  const { next, reason } = useLocalSearchParams<{ next?: string; reason?: string }>();
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  return (
    <Screen edges={['bottom']}>
      {reason === 'book' ? (
        <Text style={[styles.muted, { marginBottom: space.md }]}>
          Programările se fac din contul tău. Intri o singură dată cu numărul de telefon, apoi alegi serviciul, frizerul și ora.
        </Text>
      ) : null}
      <PhoneLogin onDone={() => (safeNext ? router.replace(safeNext as Href) : router.canGoBack() ? router.back() : router.replace('/'))} />
    </Screen>
  );
}
