import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { staffApi, type StaffBarber, type StaffBooking, type StaffTimeOff } from '@/api/staff';
import { BOOKING_STATUS, BookingSheet } from '@/components/BookingSheet';
import { styles as ui } from '@/components/ui';
import { addDays, dayKey, fromDayKey, formatDate, pad, shortDay, startOfDay } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

// Calendarul zilei, ca în Barberly: un rând pe slot (pasul din Setări), programările ca blocuri
// cât durează, orele închise și concediile hașurate. Atingi un slot liber ca să adaugi o programare.
const ROW = 34;
const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
type Range = { start: number; end: number };

export default function StaffCalendar() {
  const params = useLocalSearchParams<{ day?: string }>();
  const { staff, staffToken } = useStaff();
  const { business } = useApp();
  const step = (business as { slotStepMin?: number } | null)?.slotStepMin || 15;
  const today = dayKey(new Date());
  const [day, setDay] = useState(params.day ?? today);
  const [barbers, setBarbers] = useState<StaffBarber[]>([]);
  const canAll = !!staff && (staff.permissions.bookings_all || !staff.barberId);
  const [sel, setSel] = useState<string>(staff?.barberId ?? 'all');
  const [bookings, setBookings] = useState<StaffBooking[] | null>(null);
  const [timeOff, setTimeOff] = useState<StaffTimeOff[]>([]);
  const [open, setOpen] = useState<StaffBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 60 }, (_, i) => addDays(startOfDay(new Date()), i - 14)), []);
  const strip = useRef<ScrollView>(null);

  useEffect(() => {
    if (params.day) setDay(params.day);
  }, [params.day]);

  // Ziua aleasă rămâne la vedere în bandă.
  useEffect(() => {
    const i = days.findIndex((d) => dayKey(d) === day);
    if (i >= 0) strip.current?.scrollTo({ x: Math.max(0, i * 52 - 140), animated: true });
  }, [day, days]);

  useEffect(() => {
    if (staffToken) staffApi.barbers(staffToken).then((b) => setBarbers(b.filter((x) => x.active)), () => undefined);
  }, [staffToken]);

  const load = useCallback(async () => {
    if (!staffToken) return;
    const from = fromDayKey(day);
    setError(null);
    try {
      const [b, t] = await Promise.all([
        staffApi.bookings(staffToken, from.toISOString(), addDays(from, 1).toISOString()),
        staffApi.listTimeOff(staffToken, from.toISOString()),
      ]);
      setBookings(b);
      setTimeOff(t);
    } catch (e) {
      setError(errorMessage(e));
      setBookings([]);
    }
  }, [staffToken, day]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!staff || !staffToken) return null;
  const p = staff.permissions;
  const dayStart = fromDayKey(day);
  const weekday = dayStart.getDay();
  const toMin = (iso: string) => Math.round((new Date(iso).getTime() - dayStart.getTime()) / 60000);

  const shown = barbers.filter((b) => (canAll ? sel === 'all' || b.id === sel : b.id === staff.barberId));
  const active = (bookings ?? []).filter((b) => b.status !== 'cancelled');

  // Intervalul afișat: de la prima la ultima oră de lucru a zilei (sau programare), rotunjit la oră.
  const work = shown.flatMap((b) => b.hours.filter((h) => h.weekday === weekday));
  const bks = active.filter((b) => shown.some((x) => x.id === b.barberId));
  const starts = [...work.map((h) => h.start), ...bks.map((b) => toMin(b.start))];
  const ends = [...work.map((h) => h.end), ...bks.map((b) => toMin(b.end))];
  const gStart = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 9 * 60;
  const gEnd = ends.length ? Math.ceil(Math.max(...ends) / 60) * 60 : 20 * 60;
  const rows = Array.from({ length: Math.max(1, (gEnd - gStart) / step) }, (_, i) => gStart + i * step);
  const y = (m: number) => ((m - gStart) / step) * ROW;

  const blockedFor = (b: StaffBarber): Range[] => {
    const open = b.hours.filter((h) => h.weekday === weekday).sort((x, z) => x.start - z.start);
    const out: Range[] = [];
    let cur = gStart;
    for (const h of open) {
      if (h.start > cur) out.push({ start: cur, end: Math.min(h.start, gEnd) });
      cur = Math.max(cur, h.end);
    }
    if (cur < gEnd) out.push({ start: cur, end: gEnd });
    for (const t of timeOff.filter((t) => !t.barberId || t.barberId === b.id)) {
      const s = Math.max(gStart, toMin(t.start));
      const e = Math.min(gEnd, toMin(t.end));
      if (e > s) out.push({ start: s, end: e });
    }
    return out;
  };

  const nowMin = day === today ? toMin(new Date().toISOString()) : -1;
  const ownName = barbers.find((b) => b.id === staff.barberId)?.name ?? staff.name;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={s.header}>
        <Text style={s.headerSide} numberOfLines={1}>
          {canAll ? (sel === 'all' ? 'Echipa' : barbers.find((b) => b.id === sel)?.name) : ownName}
        </Text>
        <Text style={s.headerTitle}>{formatDate(dayStart)}</Text>
        <Pressable onPress={() => setDay(today)} hitSlop={8} style={[s.headerSide, { alignItems: 'flex-end' }]} accessibilityLabel="Azi">
          <Text style={{ color: day === today ? colors.muted : colors.gold, fontWeight: '700' }}>Azi</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={strip}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.sm }}
        contentOffset={{ x: 12 * 52, y: 0 }}
        style={{ flexGrow: 0, flexShrink: 0, height: 76, borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        {days.map((d) => {
          const key = dayKey(d);
          const on = key === day;
          return (
            <Pressable key={key} onPress={() => setDay(key)} style={[s.day, on && s.dayOn]} accessibilityLabel={`Ziua ${d.getDate()}`}>
              <Text style={[s.dayName, on && { color: colors.onGold }]}>{shortDay(d)}</Text>
              <Text style={[s.dayNum, on && { color: colors.onGold }]}>{pad(d.getDate())}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {canAll && barbers.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 54 }} contentContainerStyle={{ gap: space.xs, padding: space.sm, alignItems: 'center' }}>
          {['all', ...barbers.map((b) => b.id)].map((id) => (
            <Pressable key={id} onPress={() => setSel(id)} style={[s.chip, sel === id && s.chipOn]}>
              <Text style={[s.chipText, sel === id && { color: colors.onGold }]}>{id === 'all' ? 'Toți' : barbers.find((b) => b.id === id)?.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {error ? <Text style={{ color: colors.danger, padding: space.md }}>{error}</Text> : null}
      {bookings === null || !barbers.length ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: space.xl }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {shown.length > 1 ? (
            <View style={{ flexDirection: 'row', paddingLeft: 60 }}>
              {shown.map((b) => (
                <Text key={b.id} style={s.colHead} numberOfLines={1}>
                  {b.name}
                </Text>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: 60 }}>
              {rows.map((m) => (
                <View key={m} style={s.timeCell}>
                  <Text style={s.timeText}>{hm(m)}</Text>
                </View>
              ))}
            </View>
            {shown.map((b) => (
              <View key={b.id} style={[s.col, { height: rows.length * ROW }]}>
                {rows.map((m) => (
                  <Pressable
                    key={m}
                    accessibilityLabel={`Slot ${hm(m)} ${b.name}`}
                    disabled={!p.bookings_create}
                    onPress={() => router.push({ pathname: '/staff/new', params: { day, time: hm(m), barberId: b.id } })}
                    style={({ pressed }) => [s.slot, { top: y(m) }, pressed && { backgroundColor: colors.cardAlt }]}
                  />
                ))}
                {blockedFor(b).map((r, i) => (
                  <Hatch key={i} top={y(r.start)} height={y(r.end) - y(r.start)} />
                ))}
                {bks
                  .filter((x) => x.barberId === b.id)
                  .map((x) => {
                    const s0 = toMin(x.start);
                    const e0 = toMin(x.end);
                    const st = BOOKING_STATUS[x.status];
                    const h = Math.max(ROW, y(e0) - y(s0)) - 3;
                    return (
                      <Pressable key={x.id} onPress={() => setOpen(x)} style={[s.booking, { top: y(s0) + 1.5, height: h, borderLeftColor: st.color }]} accessibilityLabel={`Programare ${x.clientName}`}>
                        <Text style={s.bName} numberOfLines={1}>
                          {x.clientName || x.clientPhone}
                        </Text>
                        {h > 40 ? (
                          <Text style={s.bLine} numberOfLines={1}>
                            {hm(s0)} – {hm(e0)}, {e0 - s0} min
                          </Text>
                        ) : null}
                        {h > 60 ? (
                          <Text style={s.bLine} numberOfLines={2}>
                            {x.serviceName}
                          </Text>
                        ) : null}
                        {x.status !== 'confirmed' ? <Text style={[s.bLine, { color: st.color, fontWeight: '700' }]}>{st.label}</Text> : null}
                      </Pressable>
                    );
                  })}
                {nowMin > gStart && nowMin < gEnd ? <View style={[s.now, { top: y(nowMin) }]} pointerEvents="none" /> : null}
              </View>
            ))}
          </View>
          {!work.length ? <Text style={[ui.muted, { textAlign: 'center', marginTop: space.md }]}>Zi liberă (închis).</Text> : null}
        </ScrollView>
      )}

      <BookingSheet booking={open} onClose={() => setOpen(null)} onChange={(u) => setBookings((l) => (l ?? []).map((x) => (x.id === u.id ? u : x)))} />
    </SafeAreaView>
  );
}

/** Interval închis: gri cu dungi, ca în Barberly. */
function Hatch({ top, height }: { top: number; height: number }) {
  if (height <= 0) return null;
  return (
    <View pointerEvents="none" style={[s.hatch, { top, height }]}>
      {Array.from({ length: 70 }, (_, i) => (
        <View key={i} style={[s.stripe, { left: i * 14 - height, height: height * 3 + 40, top: -height - 20 }]} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm },
  headerSide: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '600' },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center', flex: 2 },
  day: { width: 48, marginHorizontal: 2, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', marginBottom: space.sm },
  dayOn: { backgroundColor: colors.gold },
  dayName: { color: colors.muted, fontSize: 12 },
  dayNum: { color: colors.text, fontSize: 19, fontWeight: '800', marginTop: 2 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.text, fontWeight: '600' },
  colHead: { flex: 1, color: colors.text, fontWeight: '700', textAlign: 'center', paddingVertical: 6 },
  timeCell: { height: ROW, justifyContent: 'center', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, borderRightWidth: 1, borderRightColor: colors.border },
  timeText: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  col: { flex: 1, position: 'relative', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  slot: { position: 'absolute', left: 0, right: 0, height: ROW, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  hatch: { position: 'absolute', left: 3, right: 3, overflow: 'hidden', backgroundColor: colors.cardAlt, borderRadius: 4, opacity: 0.9 },
  stripe: { position: 'absolute', width: 4, backgroundColor: colors.border, transform: [{ rotate: '45deg' }] },
  booking: { position: 'absolute', left: 4, right: 4, backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 5, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  bName: { color: colors.text, fontWeight: '800', fontSize: 14 },
  bLine: { color: colors.muted, fontSize: 12, marginTop: 1 },
  now: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: colors.danger },
});
