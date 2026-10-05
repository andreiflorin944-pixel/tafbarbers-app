import { Redirect, usePathname } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useApp } from '@/state/AppState';
import { colors } from '@/theme';

/**
 * Programările se fac doar din cont. Pus la începutul fiecărui pas de rezervare:
 * fără cont, trimite la login și apoi înapoi exact la pasul acesta (alegerile rămân).
 */
export function useLoginGate() {
  const { user, sessionReady } = useApp();
  const path = usePathname();
  if (user) return null;
  if (!sessionReady)
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.gold} style={{ marginTop: 80 }} />
      </View>
    );
  return <Redirect href={{ pathname: '/login', params: { next: path, reason: 'book' } }} />;
}
