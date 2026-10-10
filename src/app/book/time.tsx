import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/api';
import { ApiError } from '@/api/client';
import { Button, Card, Empty, Screen, Steps, styles as ui } from '@/components/ui';
import type { DayPart, Slot, WaitlistEntry } from '@/data/types';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { addDays, dayKey, dayOfMonth, formatTime, hourOf, shortDay, shortMonth, startOfDay, weekdayOf } from '@/lib/dates';
import { useLoginGate } from '@/components/LoginGate';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

// Zilele arătate: de azi până la ultima zi în care se poate programa (din setările salonului), cel mult 60.
const daysAhead = (n: number | undefined) => Math.min(60, Math.max(1, (n ?? 30) + 1));

export default function ChooseTime() {
  const { draft, setDraft, serviceById, barberById, locationById, business, token } = useApp();
  const gate = useLoginGate();
  const { t } = useT();
  // Linkul din mesajul „s-a eliberat un loc” deschide direct ziua din lista de așteptare.
  const params = useLocalSearchParams<{ day?: string }>();
  const service = serviceById(draft.serviceId);
  const days = useMemo(() => Array.from({ length: daysAhead(business?.maxDaysAhead) }, (_, i) => addDays(startOfDay(new Date()), i)), [business?.maxDaysAhead]);
  const [day, setDay] = useState(() => (days.some((d) => dayKey(d) === params.day) ? params.day! : dayKey(days[0])));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  // Locația aleasă nu mai primește programări (dezactivată între timp): mesaj clar, nu doar „nicio oră liberă”.
  const [goneLocation, setGoneLocation] = useState(false);
  // „Orice frizer”: orele frizerilor din locația aleasă (cu frizer ales, locația e a lui).
  const locationId = draft.barberId ? null : draft.locationId;

  useEffect(() => {
    if (token) api.getWaitlist(token).then(setWaitlist, () => undefined);
  }, [token]);

  useEffect(() => {
    if (!service) return;
    setSlots(null);
    setSelected(null);
    setGoneLocation(false);
    api.getAvailability({ serviceId: service.id, barberId: draft.barberId, locationId, day, token }).then(setSlots, (e) => {
      setGoneLocation(e instanceof ApiError && e.code === 'location_not_found');
      setSlots([]);
    });
  }, [service, draft.barberId, locationId, day, token]);

  if (gate) return gate;
  if (!service) return <Redirect href="/book/location" />;

  const barber = barberById(draft.barberId);
  const location = locationById(draft.locationId ?? barber?.locationId);
  const groups = groupByPart(slots ?? []);

  return (
    <Screen edges={['bottom']} scroll={false}>
      <Steps current={4} />
      <Text style={[ui.muted, { marginBottom: space.sm }]}>
        {[location?.name, service.name, barber ? barber.name : t('book.anyBarber')].filter(Boolean).join(' · ')}
      </Text>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: space.xs }}>
          {days.map((d) => {
            const key = dayKey(d);
            const closed = !business?.hours[weekdayOf(d)];
            const active = key === day;
            return (
              <Pressable
                key={key}
                disabled={closed}
                onPress={() => setDay(key)}
                style={[s.day, active && s.dayActive, closed && { opacity: 0.35 }]}
              >
                <Text style={[s.dayName, active && { color: colors.onGold }]}>{shortDay(d)}</Text>
                <Text style={[s.dayNum, active && { color: colors.onGold }]}>{dayOfMonth(d)}</Text>
                <Text style={[s.dayName, active && { color: colors.onGold }]}>{shortMonth(d)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: space.md, gap: space.md }}>
        {slots === null ? (
          <ActivityIndicator color={colors.gold} style={{ marginTop: space.xl }} />
        ) : slots.length === 0 ? (
          <>
            <Empty icon="calendar-clear-outline" text={goneLocation ? t('err.location_not_found') : t('book.noSlots')} />
            {token && !goneLocation ? (
              <WaitlistOffer
                token={token}
                serviceId={service.id}
                barberId={draft.barberId}
                locationId={locationId}
                day={day}
                entry={waitlist.find(
                  (w) => w.active && w.day === day && w.serviceId === service.id && w.barberId === draft.barberId && (draft.barberId || (w.locationId ?? null) === locationId),
                )}
                onJoined={(w) => setWaitlist((l) => [...l.filter((x) => x.id !== w.id), w])}
                t={t}
              />
            ) : null}
          </>
        ) : (
          <>
            {slots.some((x) => x.membersOnly) ? <Text style={[ui.muted, { fontSize: 13 }]}>★ {t('time.membersHint')}</Text> : null}
            {groups.map(([label, list]) => (
              <View key={label} style={{ gap: space.sm }}>
                <Text style={ui.section}>{t(label)}</Text>
                <View style={s.grid}>
                  {list.map((slot) => {
                    const active = selected?.start === slot.start;
                    return (
                      <Pressable
                        key={slot.start}
                        onPress={() => setSelected(slot)}
                        style={[s.slot, slot.membersOnly && s.slotMembers, active && s.slotActive]}
                        accessibilityLabel={slot.membersOnly ? `${formatTime(new Date(slot.start))}, ${t('time.membersOnly')}` : undefined}
                      >
                        <Text style={[s.slotText, active && { color: colors.onGold }]}>{formatTime(new Date(slot.start))}</Text>
                        {slot.membersOnly ? <Text style={[s.slotBadge, active && { color: colors.onGold }]}>★ {t('time.membersOnly')}</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Button
        title={selected ? t('book.continueAt', { time: formatTime(new Date(selected.start)) }) : t('book.pickTime')}
        disabled={!selected}
        onPress={() => {
          if (!selected) return;
          setDraft({ start: selected.start, slotBarberId: selected.barberId });
          router.push('/book/confirm');
        }}
      />
    </Screen>
  );
}

const PARTS: DayPart[] = ['any', 'morning', 'afternoon', 'evening'];

/** Ziua e plină: clientul cere să fie anunțat dacă se eliberează un loc (alege și intervalul din zi). */
function WaitlistOffer({
  token,
  serviceId,
  barberId,
  locationId,
  day,
  entry,
  onJoined,
  t,
}: {
  token: string;
  serviceId: string;
  barberId: string | null;
  locationId: string | null;
  day: string;
  entry?: WaitlistEntry;
  onJoined: (w: WaitlistEntry) => void;
  t: ReturnType<typeof useT>['t'];
}) {
  const [part, setPart] = useState<DayPart>('any');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [day]);

  if (entry) {
    return (
      <Card style={{ gap: space.xs, borderColor: colors.gold }}>
        <Text style={ui.cardTitle}>{t('wait.joined')}</Text>
        <Text style={ui.muted}>{t('wait.joinedText', { part: t(`wait.${entry.part}`).toLowerCase() })}</Text>
      </Card>
    );
  }
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      onJoined(await api.joinWaitlist(token, { serviceId, barberId, locationId, day, part }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: space.sm }}>
      <Text style={ui.cardTitle}>{t('wait.offer')}</Text>
      <Text style={ui.muted}>{t('wait.offerText')}</Text>
      <Text style={[ui.text, { marginTop: space.xs }]}>{t('wait.when')}</Text>
      <View style={s.grid}>
        {PARTS.map((p) => (
          <Pressable key={p} onPress={() => setPart(p)} style={[s.part, part === p && s.slotActive]}>
            <Text style={[s.slotText, { fontSize: 14 }, part === p && { color: colors.onGold }]}>{t(`wait.${p}`)}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <Button title={t('wait.join')} onPress={join} loading={busy} />
    </Card>
  );
}

type PartKey = 'wait.morning' | 'wait.afternoon' | 'wait.evening';
/** Orele grupate pe dimineață, după-amiază și seară (cheia textului din i18n). */
function groupByPart(slots: Slot[]): Array<[PartKey, Slot[]]> {
  const parts: Record<PartKey, Slot[]> = { 'wait.morning': [], 'wait.afternoon': [], 'wait.evening': [] };
  for (const sl of slots) {
    const h = hourOf(new Date(sl.start));
    parts[h < 12 ? 'wait.morning' : h < 17 ? 'wait.afternoon' : 'wait.evening'].push(sl);
  }
  return (Object.entries(parts) as Array<[PartKey, Slot[]]>).filter(([, l]) => l.length > 0);
}

const s = StyleSheet.create({
  day: { width: 60, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', gap: 2 },
  dayActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  dayName: { color: colors.muted, fontSize: 12 },
  dayNum: { color: colors.text, fontSize: 20, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  slot: { width: '22.5%', paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center' },
  slotActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  slotMembers: { borderColor: colors.gold },
  slotBadge: { color: colors.gold, fontSize: 10, fontWeight: '700', marginTop: 2 },
  slotText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  part: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center' },
});
