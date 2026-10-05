import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo, MenuButton } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function Home() {
  const { loading } = useApp();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.gold }}>
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md }}>
          <Text style={{ color: colors.onGold, fontSize: 15, fontWeight: '600', width: 32 }}>RO</Text>
          <Text style={{ color: colors.onGold, fontSize: 18, fontWeight: '700' }}>Bine ați venit</Text>
          <Pressable onPress={() => router.push('/account')} hitSlop={10} accessibilityLabel="Cont">
            <Ionicons name="person-circle-outline" size={32} color={colors.onGold} />
          </Pressable>
        </View>
      </SafeAreaView>

      {loading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: 80 }} />
      ) : (
        <View style={{ flex: 1, justifyContent: 'space-between', padding: space.md, paddingBottom: space.lg, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: space.xl }}>
            <Logo />
          </View>
          <View style={{ gap: space.sm }}>
            <MenuButton icon="calendar-outline" title="Programări" onPress={() => router.push('/bookings')} />
            <MenuButton icon="people-outline" title="Frizeri" onPress={() => router.push('/barbers')} />
            <MenuButton icon="cut-outline" title="Servicii" onPress={() => router.push('/services')} />
          </View>
        </View>
      )}
    </View>
  );
}
