import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiUrl, panelUrl, ROLE_LABELS, staffApi } from '@/api/staff';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { pickImage } from '@/lib/pickImage';
import { styles as ui } from '@/components/ui';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

type Item = { icon: ComponentProps<typeof Ionicons>['name']; label: string; sub?: string; to?: Href; web?: string; show: boolean };

// Meniul echipei, după modelul Barberly. Ce se lucrează des e în aplicație; setările mari
// (echipă, aspect, bannere, campanii, regulamente) se deschid în panoul web.
export default function StaffMenu() {
  const { staff, staffToken, staffSignOut, staffPatch } = useStaff();
  const { t } = useT();
  const [photoBusy, setPhotoBusy] = useState(false);
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
    { icon: 'people-outline', label: t('menu.clients'), to: '/staff/clients', show: p.clients && p.contacts },
    { icon: 'time-outline', label: t('menu.hours'), to: '/staff/hours', show: true },
    { icon: 'hourglass-outline', label: t('menu.waitlist'), sub: t('menu.waitlistSub'), web: 'waitlist', show: true },
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

  // Frizerul își pune singur poza de profil (o văd clienții când aleg frizerul).
  const photo = staff.barberPhotoUrl ? (staff.barberPhotoUrl.startsWith('/') ? `${apiUrl}${staff.barberPhotoUrl}` : staff.barberPhotoUrl) : null;
  const tellErr = (e: unknown) => (Platform.OS === 'web' ? window.alert(errorMessage(e)) : Alert.alert(errorMessage(e)));
  const upload = async (camera: boolean) => {
    if (!staffToken) return;
    try {
      const uri = await pickImage({ square: true, camera, maxPx: 600 });
      if (!uri) return;
      setPhotoBusy(true);
      const r = await staffApi.setMyPhoto(staffToken, uri);
      staffPatch({ barberPhotoUrl: r.photoUrl });
    } catch (e) {
      tellErr(e);
    } finally {
      setPhotoBusy(false);
    }
  };
  const removePhoto = async () => {
    if (!staffToken) return;
    try {
      await staffApi.removeMyPhoto(staffToken);
      staffPatch({ barberPhotoUrl: null });
    } catch (e) {
      tellErr(e);
    }
  };
  const changePhoto = () => {
    if (Platform.OS === 'web') return void upload(false);
    Alert.alert(t('menu.myPhoto'), undefined, [
      { text: t('menu.photoCamera'), onPress: () => void upload(true) },
      { text: t('menu.photoGallery'), onPress: () => void upload(false) },
      ...(photo ? [{ text: t('menu.photoRemove'), style: 'destructive' as const, onPress: () => void removePhoto() }] : []),
      { text: t('common.no'), style: 'cancel' as const },
    ]);
  };

  // Anunțurile pe telefon despre programări (nouă, anulată, mutată); pe web nu există notificări.
  const notifyOn = staff.notifyBookings !== false;
  const toggleNotify = async (on: boolean) => {
    if (!staffToken) return;
    staffPatch({ notifyBookings: on });
    try {
      await staffApi.setNotifyBookings(staffToken, on);
    } catch (e) {
      staffPatch({ notifyBookings: !on });
      tellErr(e);
    }
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
        {staff.barberId ? (
          <Pressable onPress={changePhoto} disabled={photoBusy} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.card }]}>
            <View style={s.avatar}>
              {photoBusy ? <ActivityIndicator color={colors.gold} /> : photo ? <Image source={{ uri: photo }} style={s.avatarImg} /> : <Ionicons name="camera-outline" size={22} color={colors.gold} />}
            </View>
            <View style={s.rowBody}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{t('menu.myPhoto')}</Text>
                <Text style={[ui.muted, { fontSize: 12 }]}>{t('menu.myPhotoSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </View>
          </Pressable>
        ) : null}
        {Platform.OS !== 'web' ? (
          <View style={s.row}>
            <Ionicons name="notifications-circle-outline" size={26} color={colors.gold} style={{ width: 34 }} />
            <View style={s.rowBody}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{t('menu.bookingAlerts')}</Text>
                <Text style={[ui.muted, { fontSize: 12 }]}>{t(staff.role === 'barber' ? 'menu.bookingAlertsSubMine' : 'menu.bookingAlertsSubAll')}</Text>
              </View>
              <Switch value={notifyOn} onValueChange={toggleNotify} trackColor={{ true: colors.gold, false: colors.border }} thumbColor={colors.text} />
            </View>
          </View>
        ) : null}
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
  avatar: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.gold },
  avatarImg: { width: 34, height: 34 },
});
