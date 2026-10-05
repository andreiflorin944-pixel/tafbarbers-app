import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { staffApi } from '@/api/staff';
import { Button, Screen, styles as ui } from '@/components/ui';
import type { Slot } from '@/data/types';
import { addDays, dayKey, fromDayKey, formatTime, shortDay, shortMonth, startOfDay } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { colors, radius, space } from '@/theme';

export default function StaffNewBooking() {
  // Din calendar: ziua, ora și frizerul slotului atins vin precompletate.
  const params = useLocalSearchParams<{ day?: string; time?: string; barberId?: string }>();
  const { staff, staffToken } = useStaff();
  const { services, barbers } = useApp();
  const canPickBarber = !!staff && (staff.permissions.bookings_all || !staff.barberId);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [barberId, setBarberId] = useState((canPickBarber && params.barberId) || staff?.barberId || barbers[0]?.id || '');
  const firstDay = params.day && params.day >= dayKey(new Date()) ? params.day : dayKey(new Date());
  const days = useMemo(() => Array.from({ length: 30 }, (_, i) => addDays(startOfDay(fromDayKey(firstDay)), i)), [firstDay]);
  const [day, setDay] = useState(firstDay);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serviceId || !barberId) return;
    setSlots(null);
    setStart(null);
    api.getAvailability({ serviceId, barberId, day }).then(
      (list) => {
        setSlots(list);
        const wanted = day === params.day && params.time ? list.find((x) => formatTime(new Date(x.start)) === params.time) : undefined;
        if (wanted) setStart(wanted.start);
      },
      () => setSlots([]),
    );
  }, [serviceId, barberId, day]);

  if (!staff || !staffToken) return null;
  const ok = phone.replace(/\D/g, '').length >= 9 && !!start;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await staffApi.create(staffToken, { phone, name: name.trim(), serviceId, barberId, start: start!, notify });
      router.back();
    } catch (e) {
      setError(errorMessage(e, 'Nu am putut salva programarea.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Text style={ui.label}>Telefon client</Text>
      <TextInput value={phone} onChangeText={setPhone} style={ui.input} keyboardType="phone-pad" placeholder="07xx xxx xxx" placeholderTextColor={colors.muted} />
      <Text style={ui.label}>Nume (pentru client nou)</Text>
      <TextInput value={name} onChangeText={setName} style={ui.input} placeholder="Opțional" placeholderTextColor={colors.muted} />

      <Text style={ui.label}>Serviciu</Text>
      <View style={s.wrap}>
        {services.map((sv) => (
          <Pressable key={sv.id} onPress={() => setServiceId(sv.id)} style={[s.chip, sv.id === serviceId && s.chipOn]}>
            <Text style={[s.chipText, sv.id === serviceId && { color: colors.bg }]}>
              {sv.name.split(' / ')[0]} · {sv.durationMin}m
            </Text>
          </Pressable>
        ))}
      </View>

      {canPickBarber ? (
        <>
          <Text style={ui.label}>Frizer</Text>
          <View style={s.wrap}>
            {barbers.map((b) => (
              <Pressable key={b.id} onPress={() => setBarberId(b.id)} style={[s.chip, b.id === barberId && s.chipOn]}>
                <Text style={[s.chipText, b.id === barberId && { color: colors.bg }]}>{b.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <Text style={ui.label}>Ziua</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {days.map((d) => {
          const key = dayKey(d);
          const on = key === day;
          return (
            <Pressable key={key} onPress={() => setDay(key)} style={[s.day, on && s.dayOn]}>
              <Text style={[s.small, on && { color: colors.bg }]}>{shortDay(d)}</Text>
              <Text style={[s.num, on && { color: colors.bg }]}>{d.getDate()}</Text>
              <Text style={[s.small, on && { color: colors.bg }]}>{shortMonth(d)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={ui.label}>Ora</Text>
      {slots === null ? (
        <ActivityIndicator color={colors.gold} />
      ) : slots.length === 0 ? (
        <Text style={ui.muted}>Nicio oră liberă în ziua asta.</Text>
      ) : (
        <View style={s.wrap}>
          {slots.map((sl) => (
            <Pressable key={sl.start} onPress={() => setStart(sl.start)} style={[s.chip, sl.start === start && s.chipOn]}>
              <Text style={[s.chipText, sl.start === start && { color: colors.bg }]}>{formatTime(new Date(sl.start))}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={[ui.row, { justifyContent: 'space-between', marginTop: space.md }]}>
        <Text style={ui.text}>SMS de confirmare către client</Text>
        <Switch value={notify} onValueChange={setNotify} trackColor={{ true: colors.gold, false: colors.border }} thumbColor={colors.text} />
      </View>
      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}
      <View style={{ marginTop: space.lg }}>
        <Button title="Salvează programarea" onPress={save} loading={busy} disabled={!ok} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  day: { width: 56, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  dayOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  small: { color: colors.muted, fontSize: 11 },
  num: { color: colors.text, fontSize: 18, fontWeight: '800' },
});
