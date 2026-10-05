import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { Pressable, View, type ColorValue } from 'react-native';
import { useApp } from '@/state/AppState';
import { colors } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => (
  <Ionicons name={name} color={color as string} size={size} />
);

export default function TabsLayout() {
  const { resetDraft } = useApp();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, height: 84, paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Acasă', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="services" options={{ title: 'Servicii', tabBarIcon: icon('cut') }} />
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
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  marginTop: -22,
                  backgroundColor: colors.gold,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Ionicons name="add" size={38} color={colors.onGold} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen name="bookings" options={{ title: 'Programări', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="about" options={{ title: 'Despre', tabBarIcon: icon('storefront') }} />
    </Tabs>
  );
}
