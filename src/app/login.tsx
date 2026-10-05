import { router } from 'expo-router';
import { PhoneLogin } from '@/components/PhoneLogin';
import { Screen } from '@/components/ui';

export default function Login() {
  return (
    <Screen edges={['bottom']}>
      <PhoneLogin onDone={() => router.back()} />
    </Screen>
  );
}
