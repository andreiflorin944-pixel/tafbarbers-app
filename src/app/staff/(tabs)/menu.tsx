import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { panelUrl, ROLE_LABELS, staffApi } from '@/api/staff';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { styles as ui } from '@/components/ui';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

type Item = { icon: ComponentProps<typeof Ionicons>['name']; label: string; sub?: string; to?: Href; web?: string; show: boolean };

// Meniul echipei, după modelul Barberly. Ce se lucrează des e în aplicație; setările mari
// (echipă, aspect, bannere, campanii, regulamente) se deschid în panoul web.
export default function StaffMenu() {
  const { staff, staffToken, staffSignOut } = useStaff();
  const { t } = useT();
  if (!staff) return null;
  const p = staff.permissions;
  const owner = staff.owner;

  const items: Item[] = [
    { icon: 'clipboard-outline', label: staff.role === 'barber' ? t('menu.myNotes') : t('menu.teamNotes'), sub: t('menu.notesSub'), to: '/staff/notes', show: true },
    { icon: 'stats-chart-outline', label: t('menu.dashboard'), sub: t('menu.dashboardSub'), to: '/staff/stats', show: p.reports },
    { icon: 'document-text-outline', label: t('stats.reports'), sub: t('menu.reportsSub'), to: '/staff/reports', show: p.reports },
    { icon: 'cash-outline', label: t('menu.register'), sub: t('menu.registerSub'), to: '/staff/register', show: p.reports || !!staff.barberId },
    { icon: 'cube-outline', label: t('menu.stock'), sub: t('menu.stockSub'), web: 'stock', show: p.shop },
    { icon: 'gift-outline', label: t('account.giftCards'), web: 'giftcards', show: p.bookings_manage },
    { icon: 'notifications-outline', label: t('menu.notifications'), sub: t('menu.notificationsSub'), web: 'notifications', show: owner },
    { icon: 'people-circle-outline', label: t('menu.team'), sub: t('menu.teamSub'), web: 'settings', show: owner },
    { icon: 'cut-outline', label: t('menu.services'), sub: t('menu.servicesSub'), to: '/staff/services', show: true },
    { icon: 'people-outline', label: t('menu.clients'), to: '/staff/clients', show: p.clients },
    { icon: 'time-outline', label: t('menu.hours'), to: '/staff/hours', show: true },
    { icon: 'bag-handle-outline', label: t('menu.orders'), to: '/staff/orders', show: p.shop },
    { icon: 'color-palette-outline', label: t('menu.appearance'), sub: t('menu.appearanceSub'), web: 'appearance', show: owner },
    { icon: 'megaphone-outline', label: t('menu.promos'), web: 'promos', show: owner },
    { icon: 'shield-checkmark-outline', label: t('menu.legal'), web: 'legal', show: owner },
    { icon: 'settings-outline', label: t('menu.settings'), sub: t('menu.settingsSub'), web: 'settings', show: true },
  ];

  const go = (it: Item) => {
    if (it.to) return router.push(it.to);
    const url = panelUrl(it.web);
    if (url) Linking.openURL(url);
  };
  const signOut = () => {
    const yes = () => staffSignOut().then(() => router.replace('/account'));
    if (Platform.OS === 'web') return window.confirm(t('menu.signOutAsk')) && yes();
    Alert.alert(t('menu.signOutAsk'), undefined, [
      { text: t('common.no'), style: 'cancel' },
      { text: t('menu.signOutYes'), style: 'destructive', onPress: yes },
    ]);
  };

  const signOutOthers = async () => {
    if (!staffToken) return;
    const tell = (m: string) => (Platform.OS === 'web' ? window.alert(m) : Alert.alert(m));
    try {
      const r = await staffApi.logoutOthers(staffToken);
      tell(!r.loggedOut ? t('menu.noOthers') : r.loggedOut === 1 ? t('menu.loggedOutOne') : t('menu.loggedOutMany', { n: r.loggedOut }));
    } catch (e) {
      tell(errorMessage(e));
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        <Text style={s.title}>{t('menu.title')}</Text>
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
          <Ionicons name="person-outline" size={26} color={colors.muted} style={{ width: 34 }} />
          <View style={s.rowBody}>
            <Text style={[s.label, { color: colors.muted }]}>{t('menu.asClient')}</Text>
          </View>
        </Pressable>
        <Pressable onPress={signOutOthers} style={s.row}>
          <Ionicons name="phone-portrait-outline" size={26} color={colors.muted} style={{ width: 34 }} />
          <View style={s.rowBody}>
            <Text style={[s.label, { color: colors.muted }]}>{t('menu.signOutOthers')}</Text>
          </View>
        </Pressable>
        <Pressable onPress={signOut} style={s.row}>
          <Ionicons name="log-out-outline" size={26} color={colors.danger} style={{ width: 34 }} />
          <View style={s.rowBody}>
            <Text style={[s.label, { color: colors.danger }]}>{t('account.staffSignOut')}</Text>
          </View>
        </Pressable>
        <Text style={[ui.muted, { fontSize: 12, textAlign: 'center', marginTop: space.lg }]}>
          {staff.name || staff.email} · {t(ROLE_LABELS[staff.role ?? (owner ? 'org_admin' : 'barber')])}
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
