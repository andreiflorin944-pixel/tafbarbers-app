import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { panelUrl } from '@/api/staff';
import { styles as ui } from '@/components/ui';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

type Item = { icon: ComponentProps<typeof Ionicons>['name']; label: string; sub?: string; to?: Href; web?: string; show: boolean };

// Meniul echipei, după modelul Barberly. Ce se lucrează des e în aplicație; setările mari
// (echipă, aspect, bannere, campanii, regulamente) se deschid în panoul web.
export default function StaffMenu() {
  const { staff, staffSignOut } = useStaff();
  if (!staff) return null;
  const p = staff.permissions;
  const owner = staff.owner;

  const items: Item[] = [
    { icon: 'people-circle-outline', label: 'Membrii echipei', sub: 'Conturi și drepturi', web: 'settings', show: owner },
    { icon: 'cut-outline', label: 'Servicii', sub: 'Prețuri și durate', to: '/staff/services', show: true },
    { icon: 'people-outline', label: 'Clienți', to: '/staff/clients', show: p.clients },
    { icon: 'time-outline', label: 'Ore de lucru și concedii', to: '/staff/hours', show: true },
    { icon: 'bag-handle-outline', label: 'Comenzi magazin', to: '/staff/orders', show: p.shop },
    { icon: 'color-palette-outline', label: 'Aspect aplicație', sub: 'Culori, logo, poze', web: 'appearance', show: owner },
    { icon: 'megaphone-outline', label: 'Bannere și campanii', web: 'promos', show: owner },
    { icon: 'document-text-outline', label: 'Regulamente și GDPR', web: 'legal', show: owner },
    { icon: 'settings-outline', label: 'Setări', sub: 'Salon, reguli de programare, parolă', web: 'settings', show: true },
  ];

  const go = (it: Item) => {
    if (it.to) return router.push(it.to);
    const url = panelUrl(it.web);
    if (url) Linking.openURL(url);
  };
  const signOut = () => {
    const yes = () => staffSignOut().then(() => router.replace('/account'));
    if (Platform.OS === 'web') return window.confirm('Ieși din contul de echipă?') && yes();
    Alert.alert('Ieși din contul de echipă?', undefined, [
      { text: 'Nu', style: 'cancel' },
      { text: 'Ieși', style: 'destructive', onPress: yes },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        <Text style={s.title}>Meniu</Text>
        {items
          .filter((i) => i.show)
          .map((it) => (
            <Pressable key={it.label} onPress={() => go(it)} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.card }]}>
              <Ionicons name={it.icon} size={26} color={colors.gold} style={{ width: 34 }} />
              <View style={s.rowBody}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{it.label}</Text>
                  {it.sub ? <Text style={[ui.muted, { fontSize: 12 }]}>{it.sub}</Text> : null}
                </View>
                <Ionicons name={it.web ? 'open-outline' : 'chevron-forward'} size={18} color={colors.muted} />
              </View>
            </Pressable>
          ))}
        <Pressable onPress={() => router.push('/')} style={s.row}>
          <Ionicons name="phone-portrait-outline" size={26} color={colors.muted} style={{ width: 34 }} />
          <View style={s.rowBody}>
            <Text style={[s.label, { color: colors.muted }]}>Vezi aplicația ca un client</Text>
          </View>
        </Pressable>
        <Pressable onPress={signOut} style={s.row}>
          <Ionicons name="log-out-outline" size={26} color={colors.danger} style={{ width: 34 }} />
          <View style={s.rowBody}>
            <Text style={[s.label, { color: colors.danger }]}>Ieși din contul de echipă</Text>
          </View>
        </Pressable>
        <Text style={[ui.muted, { fontSize: 12, textAlign: 'center', marginTop: space.lg }]}>
          {staff.name || staff.email} · {owner ? 'Proprietar' : 'Frizer'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 26, fontWeight: '800', padding: space.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.md },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingRight: space.md, marginLeft: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  label: { color: colors.text, fontSize: 17 },
});
