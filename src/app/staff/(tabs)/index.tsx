import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ROLE_LABELS, staffApi, type StaffBooking, type StaffStats } from '@/api/staff';
import { BOOKING_STATUS, BookingSheet } from '@/components/BookingSheet';
import { BirthdayGlow, Candle } from '@/components/Birthday';
import { Card, styles as ui } from '@/components/ui';
import { locale, useT } from '@/i18n';
import { SALON_TZ, dayKey, formatTime, salonMidnight } from '@/lib/dates';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

// Acasă (echipă): ziua de azi pe scurt, următoarele programări, cifrele lunii și comenzile de pregătit.
export default function StaffHome() {
  const { staff, staffToken } = useStaff();
  const { t } = useT();
  const [today, setToday] = useState<StaffBooking[] | null>(null);
  const [stats, setStats] = useState<StaffStats | null>(null);
  const [orders, setOrders] = useState<number | null>(null);
  const [open, setOpen] = useState<StaffBooking | null>(null);
  const [unclosed, setUnclosed] = useState<StaffBooking[]>([]);
  const [todo, setTodo] = useState(0);
  const [requests, setRequests] = useState<StaffBooking[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!staffToken || !staff) return;
      // Azi, ca zi a salonului (de la miezul nopții, ora României, timp de 24 de ore).
      const d0 = salonMidnight(dayKey(new Date()));
      staffApi.bookings(staffToken, d0.toISOString(), new Date(d0.getTime() + 86_400_000).toISOString()).then(setToday, () => setToday([]));
      staffApi.stats(staffToken).then(setStats, () => undefined);
      staffApi.unclosed(staffToken).then(setUnclosed, () => undefined);
      staffApi.notes(staffToken, 'open').then((n) => setTodo(n.length), () => undefined);
      if (staff.permissions.bookings_manage) staffApi.requests(staffToken).then((r) => setRequests(r.items), () => undefined);
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
  const hello = t(hour < 12 ? 'sh.morning' : hour < 18 ? 'sh.day' : 'sh.evening');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={ui.muted}>{hello},</Text>
        <Text style={s.name}>{staff.name || staff.email}</Text>
        <Text style={[ui.muted, { marginBottom: space.md }]}>{t(ROLE_LABELS[staff.role ?? (staff.owner ? 'org_admin' : 'barber')])}</Text>

        <View style={s.tiles}>
          <Tile label={t('sh.today')} value={String(list.length)} sub={t(list.length === 1 ? 'sh.bookingOne' : 'sh.bookingMany')} onPress={() => router.push('/staff/calendar')} />
          {seesMoney ? (
            <Tile label={t('sh.collectedToday')} value={`${revenue}`} sub={t('sh.currency')} onPress={() => router.push('/staff/register')} />
          ) : (
            <Tile label={t('sh.upcoming')} value={String(stats?.upcoming ?? '–')} sub={t('sh.bookingMany')} />
          )}
          {orders !== null ? <Tile label={t('sh.orders')} value={String(orders)} sub={t('sh.toPrepare')} onPress={() => router.push('/staff/orders')} /> : null}
        </View>

        {todo ? (
          <Pressable onPress={() => router.push('/staff/notes')} style={{ marginTop: space.md }}>
            <Card style={[s.row, { borderLeftWidth: 5, borderLeftColor: colors.gold }]}>
              <Ionicons name="clipboard-outline" size={22} color={colors.gold} />
              <Text style={[ui.cardTitle, { flex: 1 }]}>{todo === 1 ? t('sh.taskOne') : t('sh.taskMany', { n: todo })}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        ) : null}

        {requests.length ? (
          <>
            <Text style={[ui.label, { marginTop: space.lg, color: BOOKING_STATUS.requested.color }]}>
              {requests.length === 1 ? t('sh.requestOne') : t('sh.requestMany', { n: requests.length })}
            </Text>
            <Text style={[ui.muted, { fontSize: 13, marginBottom: space.xs }]}>{t('sh.requestHint')}</Text>
            <View style={{ gap: space.sm }}>
              {requests.slice(0, 10).map((b) => (
                <Pressable key={b.id} onPress={() => setOpen(b)}>
                  <Card style={[s.row, { borderLeftWidth: 5, borderLeftColor: BOOKING_STATUS.requested.color }]}>
                    <Ionicons name="hourglass-outline" size={22} color={BOOKING_STATUS.requested.color} />
                    <View style={{ flex: 1 }}>
                      <Text style={ui.cardTitle} numberOfLines={1}>
                        {b.clientName || b.clientPhone}
                      </Text>
                      <Text style={ui.muted} numberOfLines={1}>
                        {new Date(b.start).toLocaleDateString(locale(), { timeZone: SALON_TZ, weekday: 'short', day: 'numeric', month: 'short' })}, {formatTime(new Date(b.start))} · {b.serviceName}
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

        {unclosed.length ? (
          <>
            <Text style={[ui.label, { marginTop: space.lg, color: colors.danger }]}>
              {unclosed.length === 1 ? t('sh.unclosedOne') : t('sh.unclosedMany', { n: unclosed.length })}
            </Text>
            <Text style={[ui.muted, { fontSize: 13, marginBottom: space.xs }]}>{t('sh.unclosedHint')}</Text>
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
                        {new Date(b.start).toLocaleDateString(locale(), { timeZone: SALON_TZ, day: 'numeric', month: 'short' })} · {b.serviceName}
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

        <Text style={[ui.label, { marginTop: space.lg }]}>{t('sh.nextToday')}</Text>
        {today === null ? null : upcoming.length === 0 ? (
          <Text style={ui.muted}>{t('sh.noneLeft')}</Text>
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
              <Text style={[ui.label, { marginTop: 0, marginBottom: 0 }]}>{t('stats.last30')}</Text>
              {staff.permissions.reports ? (
                <Pressable onPress={() => router.push('/staff/stats')} hitSlop={10}>
                  <Text style={{ color: colors.gold, fontWeight: '600' }}>{t('sh.dashboardLink')}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={s.tiles}>
              <Tile label={t('stats.bookingsTab')} value={String(stats.last30.bookings)} />
              {stats.last30.revenue !== null ? <Tile label={t('stats.revenueTab')} value={`${stats.last30.revenue}`} sub={t('sh.currency')} /> : null}
              <Tile label={t('sh.noShows')} value={String(stats.last30.noShow)} />
              {stats.last30.newClients !== null ? <Tile label={t('sh.newClients')} value={String(stats.last30.newClients)} /> : null}
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
          setRequests((l) => l.filter((x) => x.id !== u.id || u.status === 'requested'));
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
