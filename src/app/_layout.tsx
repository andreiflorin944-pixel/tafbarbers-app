import { DarkTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PushLink } from '@/components/PushLink';
import { installCrashReporter, reportError } from '@/lib/crash';
import { QrLink } from '@/components/QrLink';
import { I18nProvider, useT } from '@/i18n';
// Importat aici ca sarcina de fundal să fie definită și când sistemul pornește aplicația doar pentru ea.
import { syncNearby } from '@/lib/nearby';
import { AppStateProvider } from '@/state/AppState';
import { CartProvider } from '@/state/Cart';
import { StaffProvider } from '@/state/Staff';
import { colors } from '@/theme';

installCrashReporter();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.gold, text: colors.text, border: colors.border },
};

export default function RootLayout() {
  useEffect(() => {
    syncNearby();
  }, []);
  return (
    <SafeAreaProvider>
      <I18nProvider>
      <AppStateProvider>
      <StaffProvider>
      <CartProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <QrLink />
          <PushLink />
          <RootStack />
        </ThemeProvider>
      </CartProvider>
      </StaffProvider>
      </AppStateProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

/**
 * Un ecran care nu se poate afișa nu mai închide aplicația: apare mesajul ăsta, eroarea ajunge la noi,
 * iar „Încearcă din nou” redesenează ecranul. Fără traduceri aici: și ele pot fi cauza.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    void reportError(error, true);
  }, [error]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>Ceva nu a mers</Text>
      <Text style={{ color: colors.muted, textAlign: 'center' }}>Am trimis eroarea echipei. Încearcă din nou.</Text>
      <Pressable onPress={() => void retry()} style={{ backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 }}>
        <Text style={{ color: colors.bg, fontWeight: '700' }}>Încearcă din nou</Text>
      </Pressable>
    </View>
  );
}

/** Ecranele aplicației; titlurile lor în limba aleasă. */
function RootStack() {
  const { t } = useT();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.gold,
        headerTitleAlign: 'center',
        headerTitleStyle: { fontWeight: '700', color: colors.text },
        headerShadowVisible: false,
        headerBackTitle: t('nav.back'),
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="book/location" options={{ title: t('nav.pickLocation') }} />
      <Stack.Screen name="book/service" options={{ title: t('nav.pickService') }} />
      <Stack.Screen name="book/barber" options={{ title: t('nav.pickBarber') }} />
      <Stack.Screen name="book/time" options={{ title: t('nav.pickTime') }} />
      <Stack.Screen name="book/confirm" options={{ title: t('nav.confirm') }} />
      <Stack.Screen name="book/success" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="login" options={{ title: 'TAF Barber’s', presentation: 'modal' }} />
      <Stack.Screen name="identity" options={{ title: t('account.identity') }} />
      <Stack.Screen name="assistant" options={{ title: t('nav.assistant') }} />
      <Stack.Screen name="advisor" options={{ title: t('nav.advisor') }} />
      <Stack.Screen name="rewards" options={{ title: t('nav.rewards') }} />
      <Stack.Screen name="subscriptions" options={{ title: t('nav.subscriptions') }} />
      <Stack.Screen name="gift-cards" options={{ title: t('nav.giftCards') }} />
      <Stack.Screen name="before-after" options={{ title: t('nav.beforeAfter') }} />
      <Stack.Screen name="book/index" options={{ headerShown: false }} />
      <Stack.Screen name="barbers" options={{ title: t('nav.barbers') }} />
      <Stack.Screen name="service/[id]" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="legal/[doc]" options={{ title: '' }} />
      <Stack.Screen name="staff/login" options={{ title: t('nav.staffLogin'), presentation: 'modal' }} />
      <Stack.Screen name="staff/(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="staff/client/[id]" options={{ title: t('nav.clientFile') }} />
      <Stack.Screen name="staff/orders" options={{ title: t('nav.shopOrders') }} />
      <Stack.Screen name="staff/stats" options={{ title: t('nav.dashboard') }} />
      <Stack.Screen name="staff/reports" options={{ title: t('nav.reports') }} />
      <Stack.Screen name="staff/register" options={{ title: t('nav.register') }} />
      <Stack.Screen name="staff/notes" options={{ title: t('nav.myNotes') }} />
      <Stack.Screen name="staff/hours" options={{ title: t('nav.hours') }} />
      <Stack.Screen name="staff/services" options={{ title: t('nav.services') }} />
      <Stack.Screen name="staff/new" options={{ title: t('nav.newBooking') }} />
      <Stack.Screen name="shop/index" options={{ title: t('nav.shop') }} />
      <Stack.Screen name="shop/cart" options={{ title: t('nav.cart') }} />
      <Stack.Screen name="shop/orders" options={{ title: t('nav.myOrders') }} />
    </Stack>
  );
}

