import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { staffApi, type StaffClient } from '@/api/staff';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import type { Slot } from '@/data/types';
import { addDays, dayKey, dayOfMonth, fromDayKey, formatTime, shortDay, shortMonth, startOfDay } from '@/lib/dates';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { useStaffServices } from '@/lib/useStaffServices';
import { colors, radius, space } from '@/theme';

export default function StaffNewBooking() {
  // Din calendar: ziua, ora și frizerul slotului atins vin precompletate. Din fișa clientului: clientul (`clientId`).
  const params = useLocalSearchParams<{ day?: string; time?: string; barberId?: string; clientId?: string; clientName?: string }>();
  const { staff, staffToken } = useStaff();
  const { t } = useT();
  const { barbers } = useApp();
  const services = useStaffServices();
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
  // Clientul ales din bază (căutat după nume sau numărul complet), ca în panou; fără el se face client nou din telefon + nume.
  const [picked, setPicked] = useState<Pick<StaffClient, 'id' | 'name' | 'phone' | 'visits'> | null>(params.clientId ? { id: params.clientId, name: params.clientName ?? '' } : null);
  const [hits, setHits] = useState<StaffClient[]>([]);
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serviceId || !barberId) return;
    setSlots(null);
    setStart(null);
    api.getAvailability({ serviceId, barberId, day, token: staffToken }).then(
      (list) => {
        setSlots(list);
        const wanted = day === params.day && params.time ? list.find((x) => formatTime(new Date(x.start)) === params.time) : undefined;
        if (wanted) setStart(wanted.start);
      },
      () => setSlots([]),
    );
  }, [serviceId, barberId, day]);

  useEffect(() => {
    const q = term.trim();
    if (!staffToken || !staff?.permissions.clients || picked || q.replace(/\s/g, '').length < 3) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      staffApi.clients(staffToken, q).then(
        (r) => setHits(r.slice(0, 6)),
        () => setHits([]),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [term, picked, staffToken, staff]);

  if (!staff || !staffToken) return null;
  const ok = (!!picked || phone.replace(/\D/g, '').length >= 9) && !!start;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await staffApi.create(staffToken, { ...(picked ? { clientId: picked.id } : { phone, name: name.trim() }), serviceId, barberId, start: start!, notify });
      router.back();
    } catch (e) {
      setError(errorMessage(e, t('snew.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      {picked ? (
        <Card style={[ui.row, { justifyContent: 'space-between', marginTop: space.sm }]}>
          <View style={{ flex: 1 }}>
            <Text style={ui.cardTitle}>{picked.name || t('scl.noName')}</Text>
            <Text style={ui.muted}>
              {[picked.phone, picked.visits ? (picked.visits === 1 ? t('scl.visitOne') : t('scl.visitMany', { n: picked.visits })) : params.clientId === picked.id ? '' : t('snew.noVisits')].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Pressable onPress={() => setPicked(null)} hitSlop={8}>
            <Text style={{ color: colors.gold, fontWeight: '700' }}>{t('snew.otherClient')}</Text>
          </Pressable>
        </Card>
      ) : (
        <>
          <Text style={ui.label}>{t('snew.phone')}</Text>
          <TextInput
            value={phone}
            onChangeText={(v) => {
              setPhone(v);
              setTerm(v);
            }}
            style={ui.input}
            keyboardType="phone-pad"
            placeholder="07xx xxx xxx"
            placeholderTextColor={colors.muted}
          />
          <Text style={ui.label}>{staff.permissions.clients ? t('snew.nameSearch') : t('snew.name')}</Text>
          <TextInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              setTerm(v);
            }}
            style={ui.input}
            placeholder={t('snew.optional')}
            placeholderTextColor={colors.muted}
          />
          {hits.length ? (
            <View style={{ marginTop: space.sm, gap: space.xs }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>{t('snew.found')}</Text>
              {hits.map((h) => (
                <Card key={h.id} onPress={() => setPicked(h)}>
                  <Text style={ui.cardTitle}>{h.name || t('scl.noName')}</Text>
                  <Text style={ui.muted}>
                    {[h.phone, h.visits ? (h.visits === 1 ? t('scl.visitOne') : t('scl.visitMany', { n: h.visits })) : t('snew.noVisits')].filter(Boolean).join(' · ')}
                  </Text>
                </Card>
              ))}
            </View>
          ) : null}
        </>
      )}

      <Text style={ui.label}>{t('snew.service')}</Text>
      <View style={s.wrap}>
        {services.map((sv) => (
          <Pressable key={sv.id} onPress={() => setServiceId(sv.id)} style={[s.chip, sv.id === serviceId && s.chipOn]}>
            <Text style={[s.chipText, sv.id === serviceId && { color: colors.onGold }]}>
              {sv.name.split(' / ')[0]} · {sv.durationMin}m
            </Text>
          </Pressable>
        ))}
      </View>

      {canPickBarber ? (
        <>
          <Text style={ui.label}>{t('snew.barber')}</Text>
          <View style={s.wrap}>
            {barbers.map((b) => (
              <Pressable key={b.id} onPress={() => setBarberId(b.id)} style={[s.chip, b.id === barberId && s.chipOn]}>
                <Text style={[s.chipText, b.id === barberId && { color: colors.onGold }]}>{b.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <Text style={ui.label}>{t('snew.day')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {days.map((d) => {
          const key = dayKey(d);
          const on = key === day;
          return (
            <Pressable key={key} onPress={() => setDay(key)} style={[s.day, on && s.dayOn]}>
              <Text style={[s.small, on && { color: colors.onGold }]}>{shortDay(d)}</Text>
              <Text style={[s.num, on && { color: colors.onGold }]}>{dayOfMonth(d)}</Text>
              <Text style={[s.small, on && { color: colors.onGold }]}>{shortMonth(d)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={ui.label}>{t('snew.time')}</Text>
      {slots === null ? (
        <ActivityIndicator color={colors.gold} />
      ) : slots.length === 0 ? (
        <Text style={ui.muted}>{t('snew.noSlots')}</Text>
      ) : (
        <View style={s.wrap}>
          {slots.map((sl) => (
            <Pressable key={sl.start} onPress={() => setStart(sl.start)} style={[s.chip, sl.start === start && s.chipOn]}>
              <Text style={[s.chipText, sl.start === start && { color: colors.onGold }]}>{formatTime(new Date(sl.start))}{sl.membersOnly ? ' ★' : ''}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={[ui.row, { justifyContent: 'space-between', marginTop: space.md }]}>
        <Text style={ui.text}>{t('snew.sms')}</Text>
        <Switch value={notify} onValueChange={setNotify} trackColor={{ true: colors.gold, false: colors.border }} thumbColor={colors.text} />
      </View>
      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}
      <View style={{ marginTop: space.lg }}>
        <Button title={t('snew.save')} onPress={save} loading={busy} disabled={!ok} />
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
