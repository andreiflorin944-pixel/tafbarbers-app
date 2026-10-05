import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiUrl } from '@/api';
import { staffApi, type StaffBooking } from '@/api/staff';
import { Button, styles as ui } from '@/components/ui';
import { addDays, dayKey, formatTime, shortDay, shortMonth, startOfDay } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

const STATUS: Record<string, string> = { confirmed: 'Confirmată', completed: 'Finalizată', no_show: 'Neprezentare', cancelled: 'Anulată' };

export default function StaffAgenda() {
  const { staff, staffToken, staffSignOut } = useStaff();
  const { barbers } = useApp();
  const days = useMemo(() => Array.from({ length: 45 }, (_, i) => addDays(startOfDay(new Date()), i - 7)), []);
  const [day, setDay] = useState(dayKey(new Date()));
  const [list, setList] = useState<StaffBooking[] | null>(null);
  const [barberFilter, setBarberFilter] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!staffToken) return;
    const [y, m, d] = day.split('-').map(Number);
    const from = new Date(y, m - 1, d);
    setError(null);
    try {
      setList(await staffApi.bookings(staffToken, from.toISOString(), addDays(from, 1).toISOString()));
    } catch (e) {
      setError(errorMessage(e));
      setList([]);
    }
  }, [staffToken, day]);

  // Reîncarcă la revenirea pe ecran (ex. după o programare nouă).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!staff || !staffToken) return <Redirect href="/staff/login" />;
  const p = staff.permissions;

  const visible = (list ?? [])
    .filter((b) => !barberFilter || b.barberId === barberFilter)
    .sort((a, b) => a.start.localeCompare(b.start));
  const active = visible.filter((b) => b.status !== 'cancelled');
  const barberIds = [...new Set((list ?? []).map((b) => b.barberId))];
  const total = active.reduce((s, b) => s + b.price, 0);

  const notify = (msg: string) => (Platform.OS === 'web' ? window.alert(msg) : Alert.alert('TAF', msg));
  const ask = (msg: string, yes: () => void) => {
    if (Platform.OS === 'web') return window.confirm(msg) && yes();
    Alert.alert('Confirmare', msg, [
      { text: 'Nu', style: 'cancel' },
      { text: 'Da', style: 'destructive', onPress: yes },
    ]);
  };
  const setStatus = async (b: StaffBooking, status: string) => {
    try {
      const u = await staffApi.setStatus(staffToken, b.id, status);
      setList((l) => (l ?? []).map((x) => (x.id === b.id ? { ...x, ...u } : x)));
      setOpenId(null);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.md }}>
        <View style={[ui.row, { justifyContent: 'space-between', marginBottom: space.sm }]}>
          <View>
            <Text style={ui.muted}>{staff.owner ? 'Proprietar' : 'Frizer'}</Text>
            <Text style={ui.cardTitle}>{staff.name || staff.email}</Text>
          </View>
          <Pressable onPress={() => ask('Ieși din contul de echipă?', () => staffSignOut().then(() => router.back()))} hitSlop={10}>
            <Text style={{ color: colors.muted }}>Ieși</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm, paddingVertical: space.xs }}
          contentOffset={{ x: 7 * 64, y: 0 }}
        >
          {days.map((d) => {
            const key = dayKey(d);
            const on = key === day;
            return (
              <Pressable key={key} onPress={() => setDay(key)} style={[s.day, on && s.dayOn]}>
                <Text style={[s.dayName, on && { color: colors.bg }]}>{shortDay(d)}</Text>
                <Text style={[s.dayNum, on && { color: colors.bg }]}>{d.getDate()}</Text>
                <Text style={[s.dayName, on && { color: colors.bg }]}>{shortMonth(d)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {barberIds.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs, paddingVertical: space.sm }}>
            {[null, ...barberIds].map((id) => (
              <Pressable key={id ?? 'all'} onPress={() => setBarberFilter(id)} style={[s.chip, barberFilter === id && s.chipOn]}>
                <Text style={[s.chipText, barberFilter === id && { color: colors.bg }]}>
                  {id ? (barbers.find((b) => b.id === id)?.name ?? list?.find((b) => b.barberId === id)?.barberName) : 'Toți'}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <Text style={[ui.muted, { marginVertical: space.xs }]}>
          {active.length} {active.length === 1 ? 'programare' : 'programări'}
          {p.stats && active.length ? ` · ${total} lei` : ''}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.md, paddingTop: space.xs, gap: space.sm, paddingBottom: 120 }}>
        {list === null ? (
          <ActivityIndicator color={colors.gold} style={{ marginTop: space.xl }} />
        ) : error ? (
          <Text style={{ color: colors.danger }}>{error}</Text>
        ) : visible.length === 0 ? (
          <Text style={[ui.muted, { textAlign: 'center', marginTop: space.xl }]}>Nicio programare în ziua asta.</Text>
        ) : (
          visible.map((b) => {
            const open = openId === b.id;
            const past = new Date(b.start).getTime() < Date.now();
            return (
              <Pressable key={b.id} onPress={() => setOpenId(open ? null : b.id)} style={[s.card, b.status === 'cancelled' && { opacity: 0.5 }]}>
                <View style={[ui.row, { justifyContent: 'space-between' }]}>
                  <Text style={s.time}>
                    {formatTime(new Date(b.start))}
                    <Text style={ui.muted}> – {formatTime(new Date(b.end))}</Text>
                  </Text>
                  <Text style={[s.status, (b.status === 'cancelled' || b.status === 'no_show') && { color: colors.danger }, b.status === 'completed' && { color: colors.success }]}>
                    {STATUS[b.status]}
                  </Text>
                </View>
                <Text style={ui.text}>{b.clientName || b.clientPhone}</Text>
                <Text style={ui.muted}>
                  {b.serviceName}
                  {barberIds.length > 1 || p.bookings_all ? ` · ${b.barberName}` : ''}
                  {p.stats ? ` · ${b.price} lei` : ''}
                </Text>
                {b.note ? <Text style={[ui.muted, { fontStyle: 'italic' }]}>„{b.note}”</Text> : null}
                {open ? (
                  <View style={{ gap: space.sm, marginTop: space.sm }}>
                    <Button title={`Sună ${b.clientPhone}`} variant="ghost" onPress={() => Linking.openURL(`tel:${b.clientPhone}`)} />
                    {p.bookings_manage && b.status === 'confirmed' && past ? (
                      <>
                        <Button title="Finalizată" onPress={() => setStatus(b, 'completed')} />
                        <Button title="Nu s-a prezentat" variant="ghost" onPress={() => setStatus(b, 'no_show')} />
                      </>
                    ) : null}
                    {p.bookings_manage && b.status === 'confirmed' ? (
                      <Button title="Anulează (clientul primește SMS)" variant="danger" onPress={() => ask('Anulezi programarea?', () => setStatus(b, 'cancelled'))} />
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })
        )}

        {staff.owner && apiUrl ? (
          <Pressable onPress={() => Linking.openURL(apiUrl)} style={[ui.row, { justifyContent: 'center', marginTop: space.lg }]}>
            <Ionicons name="desktop-outline" size={16} color={colors.gold} />
            <Text style={{ color: colors.gold }}>Panoul complet (servicii, bannere, campanii)</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {p.bookings_create ? (
        <Pressable onPress={() => router.push({ pathname: '/staff/new', params: { day } })} style={s.fab} accessibilityLabel="Programare nouă">
          <Ionicons name="add" size={30} color={colors.onGold} />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  day: { width: 56, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  dayOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  dayName: { color: colors.muted, fontSize: 11 },
  dayNum: { color: colors.text, fontSize: 18, fontWeight: '800' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.text, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: 4 },
  time: { color: colors.text, fontSize: 20, fontWeight: '800' },
  status: { color: colors.gold, fontSize: 12, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 36,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
