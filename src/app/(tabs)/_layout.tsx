import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { Pressable, Text, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tabBarInset, tabBarSpace } from '@/components/ui';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { colors } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
// Iconița plină pe tabul deschis, conturul pe celelalte.
const icon = (on: IconName, off: IconName) => ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
  <Ionicons name={focused ? on : off} color={color as string} size={size} />
);

export default function TabsLayout() {
  const { resetDraft } = useApp();
  const { t } = useT();
  // Bara stă lipită jos, pe toată lățimea, dar deasupra barei de navigare a telefonului (butoane sau gesturi), nu sub ea.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.text,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          height: tabBarSpace(insets.bottom),
          paddingTop: 6,
          paddingBottom: tabBarInset(insets.bottom),
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.bgSolid,
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tab.home'), tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="services" options={{ title: t('tab.services'), tabBarIcon: icon('cut', 'cut-outline') }} />
      <Tabs.Screen
        name="new"
        options={{
          title: t('tab.book'),
          tabBarButton: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('nav.newBooking')}
              onPress={() => {
                // Programarea începe mereu cu locația, apoi frizerul, serviciul și ora.
                resetDraft();
                router.push('/book/location');
              }}
              style={({ pressed }) => ({ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, opacity: pressed ? 0.85 : 1 })}
            >
              {/* Butonul din mijloc: pătrat rotunjit în culoarea principală, cu „Rezervă” dedesubt. */}
              <View style={{ width: 46, height: 32, borderRadius: 10, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="add" size={26} color={colors.onGold} />
              </View>
              <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>
                {t('tab.book')}
              </Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen name="bookings" options={{ title: t('tab.bookings'), tabBarIcon: icon('calendar', 'calendar-outline') }} />
      <Tabs.Screen name="account" options={{ title: t('tab.account'), tabBarIcon: icon('person', 'person-outline') }} />
      {/* „Despre salon” se deschide din Cont și de pe Acasă; nu mai are buton în bară. */}
      <Tabs.Screen name="about" options={{ href: null, title: t('tab.about') }} />
    </Tabs>
  );
}
