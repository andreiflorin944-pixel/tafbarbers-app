import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { Pressable, View, type ColorValue } from 'react-native';
import { useT } from '@/i18n';
import { useApp } from '@/state/AppState';
import { colors } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => (
  <Ionicons name={name} color={color as string} size={size} />
);

export default function TabsLayout() {
  const { resetDraft } = useApp();
  const { t } = useT();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarStyle: {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 16,
          height: 68,
          paddingTop: 8,
          paddingBottom: 8,
          borderRadius: 24,
          borderTopWidth: 0,
          backgroundColor: colors.cardAlt,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tab.home'), tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="services" options={{ title: t('tab.services'), tabBarIcon: icon('cut-outline') }} />
      <Tabs.Screen
        name="new"
        options={{
          title: '',
          tabBarButton: () => (
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Pressable
                accessibilityLabel="Programare nouă"
                onPress={() => {
                  resetDraft();
                  router.push('/book/service');
                }}
                style={({ pressed }) => ({
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  marginTop: -18,
                  borderWidth: 4,
                  borderColor: colors.bg,
                  backgroundColor: colors.gold,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Ionicons name="add" size={32} color={colors.onGold} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen name="bookings" options={{ title: t('tab.bookings'), tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="about" options={{ title: t('tab.about'), tabBarIcon: icon('storefront-outline') }} />
    </Tabs>
  );
}
