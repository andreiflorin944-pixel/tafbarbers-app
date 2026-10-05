import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider } from '@/i18n';
import { AppStateProvider } from '@/state/AppState';
import { colors } from '@/theme';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.gold, text: colors.text, border: colors.border },
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
      <AppStateProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.gold,
              headerTitleAlign: 'center',
              headerTitleStyle: { fontWeight: '700', color: colors.text },
              headerShadowVisible: false,
              headerBackTitle: 'Înapoi',
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="book/service" options={{ title: 'Alege serviciul' }} />
            <Stack.Screen name="book/barber" options={{ title: 'Alege frizerul' }} />
            <Stack.Screen name="book/time" options={{ title: 'Alege ora' }} />
            <Stack.Screen name="book/confirm" options={{ title: 'Confirmare' }} />
            <Stack.Screen name="book/success" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="login" options={{ title: 'Intră în cont', presentation: 'modal' }} />
            <Stack.Screen name="account" options={{ title: 'Cont' }} />
            <Stack.Screen name="barbers" options={{ title: 'Frizeri' }} />
            <Stack.Screen name="service/[id]" options={{ title: '', headerTransparent: true }} />
          </Stack>
        </ThemeProvider>
      </AppStateProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
