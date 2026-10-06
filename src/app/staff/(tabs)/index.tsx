import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ROLE_LABELS, staffApi, type StaffBooking, type StaffStats } from '@/api/staff';
import { BOOKING_STATUS, BookingSheet } from '@/components/BookingSheet';
import { BirthdayGlow, Candle } from '@/components/Birthday';
import { Card, styles as ui } from '@/components/ui';
import { addDays, formatTime, startOfDay } from '@/lib/dates';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

// Acasă (echipă): ziua de azi pe scurt, următoarele programări, cifrele lunii și comenzile de pregătit.
export default function StaffHome() {
  const { staff, staffToken } = useStaff();
  const [today, setToday] = useState<StaffBooking[] | null>(null);
  const [stats, setStats] = useState<StaffStats | null>(null);
  const [orders, setOrders] = useState<number | null>(null);
  const [open, setOpen] = useState<StaffBooking | null>(null);
  const [unclosed, setUnclosed] = useState<StaffBooking[]>([]);
  const [todo, setTodo] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!staffToken || !staff) return;
      const d0 = startOfDay(new Date());
      staffApi.bookings(staffToken, d0.toISOString(), addDays(d0, 1).toISOString()).then(setToday, () => setToday([]));
      staffApi.stats(staffToken).then(setStats, () => undefined);
      staffApi.unclosed(staffToken).then(setUnclosed, () => undefined);
      staffApi.notes(staffToken, 'open').then((n) => setTodo(n.length), () => undefined);
      if (staff.permissions.shop) staffApi.orders(staffToken, 'open').then((o) => setOrders(o.length), () => undefined);
    }, [staffToken, staff]),
  );

  if (!staff) return null;
  const list = (today ?? []).filter((b) => b.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = list.filter((b) => new Date(b.end).getTime() > Date.now());
  // Doar ce s-a încasat deja azi (programările închise ca plătite); tunsorile pe abonament nu intră.
  const revenue = list.reduce((s, b) => s + (b.payment === 'paid' ? (b.paidAmount ?? 0) : 0), 0);
  const seesMoney = staff.permissions.stats || !staff.permissions.bookings_all;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Bună dimineața' : hour < 18 ? 'Bună ziua' : 'Bună seara';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={ui.muted}>{hello},</Text>
        <Text style={s.name}>{staff.name || staff.email}</Text>
        <Text style={[ui.muted, { marginBottom: space.md }]}>{ROLE_LABELS[staff.role ?? (staff.owner ? 'org_admin' : 'barber')]}</Text>

        <View style={s.tiles}>
          <Tile label="Azi" value={String(list.length)} sub={list.length === 1 ? 'programare' : 'programări'} onPress={() => router.push('/staff/calendar')} />
          {seesMoney ? (
            <Tile label="Încasat azi" value={`${revenue}`} sub="lei" onPress={() => router.push('/staff/register')} />
          ) : (
            <Tile label="Viitoare" value={String(stats?.upcoming ?? '–')} sub="programări" />
          )}
          {orders !== null ? <Tile label="Comenzi" value={String(orders)} sub="de pregătit" onPress={() => router.push('/staff/orders')} /> : null}
        </View>

        {todo ? (
          <Pressable onPress={() => router.push('/staff/notes')} style={{ marginTop: space.md }}>
            <Card style={[s.row, { borderLeftWidth: 5, borderLeftColor: colors.gold }]}>
              <Ionicons name="clipboard-outline" size={22} color={colors.gold} />
              <Text style={[ui.cardTitle, { flex: 1 }]}>{todo === 1 ? 'Ai o sarcină de făcut' : `Ai ${todo} sarcini de făcut`}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        ) : null}

        {unclosed.length ? (
          <>
            <Text style={[ui.label, { marginTop: space.lg, color: colors.danger }]}>
              {unclosed.length === 1 ? 'O programare trecută nu e închisă' : `${unclosed.length} programări trecute nu sunt închise`}
            </Text>
            <Text style={[ui.muted, { fontSize: 13, marginBottom: space.xs }]}>Apasă și alege: încheiată (cu plata), nu a venit sau anulată.</Text>
            <View style={{ gap: space.sm }}>
              {unclosed.slice(0, 5).map((b) => (
                <Pressable key={b.id} onPress={() => setOpen(b)}>
                  <Card style={[s.row, { borderLeftWidth: 5, borderLeftColor: colors.danger }]}>
                    <Text style={s.time}>{formatTime(new Date(b.start))}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={ui.cardTitle} numberOfLines={1}>
                        {b.clientName || b.clientPhone}
                      </Text>
                      <Text style={ui.muted} numberOfLines={1}>
                        {new Date(b.start).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })} · {b.serviceName}
                        {staff.permissions.bookings_all ? ` · ${b.barberName}` : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </Card>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={[ui.label, { marginTop: space.lg }]}>Urmează azi</Text>
        {today === null ? null : upcoming.length === 0 ? (
          <Text style={ui.muted}>Nicio programare rămasă azi.</Text>
        ) : (
          <View style={{ gap: space.sm }}>
            {upcoming.slice(0, 6).map((b) => (
              <Pressable key={b.id} onPress={() => setOpen(b)}>
                <Card style={[s.row, { borderLeftWidth: 5, borderLeftColor: BOOKING_STATUS[b.status].color }]}>
                  <Text style={s.time}>{formatTime(new Date(b.start))}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={[ui.row, { gap: 4 }]}>
                      {b.clientBirthday ? <Candle /> : null}
                      <Text style={[ui.cardTitle, { flexShrink: 1 }]} numberOfLines={1}>
                        {b.clientName || b.clientPhone}
                      </Text>
                    </View>
                    <Text style={ui.muted} numberOfLines={1}>
                      {b.serviceName}
                      {staff.permissions.bookings_all ? ` · ${b.barberName}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  {b.clientBirthday ? <BirthdayGlow radius={radius.md} /> : null}
                </Card>
              </Pressable>
            ))}
          </View>
        )}

        {stats ? (
          <>
            <View style={[ui.row, { justifyContent: 'space-between', marginTop: space.lg }]}>
              <Text style={[ui.label, { marginTop: 0, marginBottom: 0 }]}>Ultimele 30 de zile</Text>
              {staff.permissions.reports ? (
                <Pressable onPress={() => router.push('/staff/stats')} hitSlop={10}>
                  <Text style={{ color: colors.gold, fontWeight: '600' }}>Tablou de bord ›</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={s.tiles}>
              <Tile label="Programări" value={String(stats.last30.bookings)} />
              {stats.last30.revenue !== null ? <Tile label="Încasări" value={`${stats.last30.revenue}`} sub="lei" /> : null}
              <Tile label="Absențe" value={String(stats.last30.noShow)} />
              {stats.last30.newClients !== null ? <Tile label="Clienți noi" value={String(stats.last30.newClients)} /> : null}
            </View>
          </>
        ) : null}
      </ScrollView>
      <BookingSheet
        booking={open}
        onClose={() => setOpen(null)}
        onChange={(u) => {
          setToday((l) => (l ?? []).map((x) => (x.id === u.id ? u : x)));
          setUnclosed((l) => (u.status === 'confirmed' ? l.map((x) => (x.id === u.id ? u : x)) : l.filter((x) => x.id !== u.id)));
        }}
      />
    </SafeAreaView>
  );
}

function Tile({ label, value, sub, onPress }: { label: string; value: string; sub?: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={s.tile}>
      <Text style={ui.muted}>{label}</Text>
      <Text style={s.tileValue}>{value}</Text>
      {sub ? <Text style={[ui.muted, { fontSize: 12 }]}>{sub}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  content: { padding: space.md, paddingBottom: 40, width: '100%', maxWidth: 720, alignSelf: 'center' },
  name: { color: colors.text, fontSize: 26, fontWeight: '800' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { flexGrow: 1, flexBasis: '30%', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md },
  tileValue: { color: colors.gold, fontSize: 26, fontWeight: '800', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  time: { color: colors.text, fontSize: 18, fontWeight: '800', width: 56 },
});
