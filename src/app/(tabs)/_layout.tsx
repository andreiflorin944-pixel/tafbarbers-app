import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { colors } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => (
  <Ionicons name={name} color={color as string} size={size} />
);

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Acasă', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="services" options={{ title: 'Rezervă', tabBarIcon: icon('cut') }} />
      <Tabs.Screen name="bookings" options={{ title: 'Programări', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="account" options={{ title: 'Cont', tabBarIcon: icon('person') }} />
    </Tabs>
  );
}
