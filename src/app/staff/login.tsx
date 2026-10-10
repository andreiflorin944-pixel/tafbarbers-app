import { router } from 'expo-router';
import { Screen } from '@/components/ui';
import { StaffLoginForm } from '@/components/StaffLoginForm';

export default function StaffLogin() {
  return (
    <Screen edges={['bottom']}>
      <StaffLoginForm onDone={() => router.replace('/staff')} />
    </Screen>
  );
}
