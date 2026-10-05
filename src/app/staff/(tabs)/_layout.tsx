import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, View, type ColorValue } from 'react-native';
import { useStaff } from '@/state/Staff';
import { colors } from '@/theme';

// Partea de business a aplicației (proprietar și frizeri), după modelul Barberly:
// Acasă, Programare (calendarul zilei), +, Clienți, Meniu.
type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => (
  <Ionicons name={name} color={color as string} size={size} />
);

export default function StaffTabs() {
  const { staff, staffReady } = useStaff();
  if (!staffReady)
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.gold} style={{ marginTop: 120 }} />
      </View>
    );
  if (!staff) return <Redirect href="/staff/login" />;
  const p = staff.permissions;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarStyle: { height: 72, paddingTop: 8, paddingBottom: 10, borderTopColor: colors.border, backgroundColor: colors.card },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Acasă', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="calendar" options={{ title: 'Programare', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen
        name="add"
        options={{
          title: '',
          tabBarButton: () => (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              {p.bookings_create ? (
                <Pressable
                  accessibilityLabel="Programare nouă"
                  onPress={() => router.push('/staff/new')}
                  style={({ pressed }) => ({
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    backgroundColor: colors.gold,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Ionicons name="add" size={32} color={colors.onGold} />
                </Pressable>
              ) : null}
            </View>
          ),
        }}
      />
      <Tabs.Screen name="clients" options={{ title: 'Clienți', tabBarIcon: icon('people-outline'), href: p.clients ? undefined : null }} />
      <Tabs.Screen name="menu" options={{ title: 'Meniu', tabBarIcon: icon('menu-outline') }} />
    </Tabs>
  );
}
