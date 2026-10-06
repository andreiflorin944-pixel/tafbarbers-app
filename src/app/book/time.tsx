import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/api';
import { Button, Empty, Screen, Steps, styles as ui } from '@/components/ui';
import type { Slot } from '@/data/types';
import { addDays, dayKey, formatTime, shortDay, shortMonth, startOfDay } from '@/lib/dates';
import { useLoginGate } from '@/components/LoginGate';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

const DAYS_AHEAD = 21;

export default function ChooseTime() {
  const { draft, setDraft, serviceById, barberById, business } = useApp();
  const gate = useLoginGate();
  const service = serviceById(draft.serviceId);
  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(startOfDay(new Date()), i)), []);
  const [day, setDay] = useState(dayKey(days[0]));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);

  useEffect(() => {
    if (!service) return;
    setSlots(null);
    setSelected(null);
    api.getAvailability({ serviceId: service.id, barberId: draft.barberId, day }).then(setSlots);
  }, [service, draft.barberId, day]);

  if (gate) return gate;
  if (!service) return <Redirect href="/book/service" />;

  const barber = barberById(draft.barberId);
  const groups = groupByPart(slots ?? []);

  return (
    <Screen edges={['bottom']} scroll={false}>
      <Steps current={3} />
      <Text style={[ui.muted, { marginBottom: space.sm }]}>
        {service.name} · {barber ? barber.name : 'Orice frizer disponibil'}
      </Text>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: space.xs }}>
          {days.map((d) => {
            const key = dayKey(d);
            const closed = !business?.hours[d.getDay()];
            const active = key === day;
            return (
              <Pressable
                key={key}
                disabled={closed}
                onPress={() => setDay(key)}
                style={[s.day, active && s.dayActive, closed && { opacity: 0.35 }]}
              >
                <Text style={[s.dayName, active && { color: colors.onGold }]}>{shortDay(d)}</Text>
                <Text style={[s.dayNum, active && { color: colors.onGold }]}>{d.getDate()}</Text>
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
          <Empty icon="calendar-clear-outline" text="Nu mai sunt ore libere în această zi. Încearcă altă zi." />
        ) : (
          groups.map(([label, list]) => (
            <View key={label} style={{ gap: space.sm }}>
              <Text style={ui.section}>{label}</Text>
              <View style={s.grid}>
                {list.map((slot) => {
                  const active = selected?.start === slot.start;
                  return (
                    <Pressable key={slot.start} onPress={() => setSelected(slot)} style={[s.slot, active && s.slotActive]}>
                      <Text style={[s.slotText, active && { color: colors.onGold }]}>{formatTime(new Date(slot.start))}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Button
        title={selected ? `Continuă · ${formatTime(new Date(selected.start))}` : 'Alege o oră'}
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

function groupByPart(slots: Slot[]): Array<[string, Slot[]]> {
  const parts: Record<string, Slot[]> = { Dimineața: [], 'După-amiaza': [], Seara: [] };
  for (const sl of slots) {
    const h = new Date(sl.start).getHours();
    parts[h < 12 ? 'Dimineața' : h < 17 ? 'După-amiaza' : 'Seara'].push(sl);
  }
  return Object.entries(parts).filter(([, l]) => l.length > 0);
}

const s = StyleSheet.create({
  day: { width: 60, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', gap: 2 },
  dayActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  dayName: { color: colors.muted, fontSize: 12 },
  dayNum: { color: colors.text, fontSize: 20, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  slot: { width: '22.5%', paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center' },
  slotActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  slotText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
