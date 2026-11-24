import { router, useLocalSearchParams } from 'expo-router';
import { barberDuration } from '@/lib/price';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { staffApi, type StaffClient } from '@/api/staff';
import { ApiError } from '@/api/client';
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
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [barberId, setBarberId] = useState((canPickBarber && params.barberId) || staff?.barberId || barbers[0]?.id || '');
  const firstDay = params.day && params.day >= dayKey(new Date()) ? params.day : dayKey(new Date());
  const days = useMemo(() => Array.from({ length: 30 }, (_, i) => addDays(startOfDay(fromDayKey(firstDay)), i)), [firstDay]);
  const [day, setDay] = useState(firstDay);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  // O singură rubrică de căutare (nume sau număr), ca în panou, plus „+” pentru client nou.
  const [picked, setPicked] = useState<Pick<StaffClient, 'id' | 'name' | 'phone' | 'visits'> | null>(params.clientId ? { id: params.clientId, name: params.clientName ?? '' } : null);
  // Client nou care se creează odată cu programarea (fără dreptul de a vedea datele de contact).
  const [staged, setStaged] = useState<{ name: string; phone: string } | null>(null);
  const [hits, setHits] = useState<StaffClient[] | null>(null);
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState<{ name: string; phone: string } | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
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
    if (!staffToken || !staff?.permissions.clients || picked || staged || adding || q.replace(/\s/g, '').length < 3) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      staffApi.clients(staffToken, q).then(
        (r) => setHits(r.slice(0, 6)),
        () => setHits([]),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [term, picked, staged, adding, staffToken, staff]);

  if (!staff || !staffToken) return null;
  const ok = (!!picked || !!staged) && !!start;

  // „+”: ce ai scris deja în căutare trece în rubrica potrivită (cifre → telefon, litere → nume).
  const openAdd = () => {
    const q = term.trim();
    const isPhone = /^[\d+\s().-]+$/.test(q) && q.replace(/\D/g, '').length >= 3;
    setAddError(null);
    setAdding({ name: isPhone ? '' : q, phone: isPhone ? q : '' });
    setHits(null);
  };
  const saveNew = async () => {
    if (!adding) return;
    const nm = adding.name.trim();
    const ph = adding.phone.trim();
    setAddBusy(true);
    setAddError(null);
    try {
      if (staff.permissions.clients && staff.permissions.contacts) {
        try {
          const r = await staffApi.addClient(staffToken, { name: nm, phone: ph });
          setPicked({ id: r.id, name: nm, phone: ph, visits: 0 });
        } catch (e) {
          if (!(e instanceof ApiError) || e.code !== 'client_exists') throw e;
          // Numărul e deja în bază: alegem direct clientul existent.
          const found = await staffApi.clients(staffToken, ph);
          if (!found[0]) throw e;
          setPicked(found[0]);
        }
      } else {
        // Fără dreptul de date de contact, contul se face odată cu programarea.
        if (ph.replace(/\D/g, '').length < 9) throw new ApiError('invalid_phone', 400);
        setStaged({ name: nm, phone: ph });
      }
      setAdding(null);
      setTerm('');
    } catch (e) {
      setAddError(errorMessage(e, t('snew.saveFailed')));
    } finally {
      setAddBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await staffApi.create(staffToken, { ...(picked ? { clientId: picked.id } : { phone: staged?.phone ?? '', name: staged?.name ?? '' }), serviceId, barberId, start: start!, notify });
      router.back();
    } catch (e) {
      setError(errorMessage(e, t('snew.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      {picked || staged ? (
        <Card style={[ui.row, { justifyContent: 'space-between', marginTop: space.sm }]}>
          <View style={{ flex: 1 }}>
            <Text style={ui.cardTitle}>{(picked ?? staged)?.name || t('scl.noName')}</Text>
            <Text style={ui.muted}>
              {picked
                ? [picked.phone, picked.visits ? (picked.visits === 1 ? t('scl.visitOne') : t('scl.visitMany', { n: picked.visits })) : params.clientId === picked.id ? '' : t('snew.noVisits')].filter(Boolean).join(' · ')
                : `${staged?.phone} · ${t('snew.staged')}`}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setPicked(null);
              setStaged(null);
            }}
            hitSlop={8}
          >
            <Text style={{ color: colors.gold, fontWeight: '700' }}>{t('snew.otherClient')}</Text>
          </Pressable>
        </Card>
      ) : adding ? (
        <Card style={{ marginTop: space.sm }}>
          <Text style={ui.cardTitle}>{t('snew.newClient')}</Text>
          <Text style={ui.label}>{t('snew.nameOnly')}</Text>
          <TextInput value={adding.name} onChangeText={(v) => setAdding({ ...adding, name: v })} style={ui.input} autoFocus={!adding.name} placeholderTextColor={colors.muted} />
          <Text style={ui.label}>{t('snew.phoneOnly')}</Text>
          <TextInput
            value={adding.phone}
            onChangeText={(v) => setAdding({ ...adding, phone: v })}
            style={ui.input}
            keyboardType="phone-pad"
            placeholder="07xx xxx xxx"
            placeholderTextColor={colors.muted}
            autoFocus={!!adding.name}
          />
          <Text style={[ui.muted, { fontSize: 12, marginTop: space.xs }]}>{t('snew.noMsg')}</Text>
          {addError ? <Text style={{ color: colors.danger, marginTop: space.xs }}>{addError}</Text> : null}
          <View style={[ui.row, { justifyContent: 'flex-end', gap: space.md, marginTop: space.sm }]}>
            <Pressable onPress={() => setAdding(null)} hitSlop={8}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>{t('snew.cancel')}</Text>
            </Pressable>
            <Button title={t('snew.addClient')} onPress={saveNew} loading={addBusy} disabled={!adding.name.trim() || adding.phone.replace(/\D/g, '').length < 9} />
          </View>
        </Card>
      ) : (
        <>
          <Text style={ui.label}>{t('snew.client')}</Text>
          <View style={[ui.row, { gap: space.sm }]}>
            {staff.permissions.clients ? (
              <TextInput
                value={term}
                onChangeText={setTerm}
                style={[ui.input, { flex: 1 }]}
                placeholder={t('snew.search')}
                placeholderTextColor={colors.muted}
                autoCorrect={false}
              />
            ) : (
              <Text style={[ui.muted, { flex: 1 }]}>{t('snew.addHint')}</Text>
            )}
            <Pressable onPress={openAdd} style={s.add} accessibilityLabel={t('snew.newClient')} hitSlop={6}>
              <Text style={s.addText}>+</Text>
            </Pressable>
          </View>
          {hits ? (
            <View style={{ marginTop: space.sm, gap: space.xs }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>{hits.length ? t('snew.found') : t('snew.notFound')}</Text>
              {hits.map((h) => (
                <Card key={h.id} onPress={() => setPicked(h)}>
                  <Text style={ui.cardTitle}>{h.name || t('scl.noName')}</Text>
                  <Text style={ui.muted}>
                    {[h.phone, h.visits ? (h.visits === 1 ? t('scl.visitOne') : t('scl.visitMany', { n: h.visits })) : t('snew.noVisits')].filter(Boolean).join(' · ')}
                  </Text>
                </Card>
              ))}
              <Card onPress={openAdd}>
                <Text style={[ui.cardTitle, { color: colors.gold }]}>+ {t('snew.newClient')} „{term.trim()}”</Text>
              </Card>
            </View>
          ) : null}
        </>
      )}

      <Text style={ui.label}>{t('snew.service')}</Text>
      <View style={s.wrap}>
        {services.map((sv) => (
          <Pressable key={sv.id} onPress={() => setServiceId(sv.id)} style={[s.chip, sv.id === serviceId && s.chipOn]}>
            <Text style={[s.chipText, sv.id === serviceId && { color: colors.onGold }]}>
              {sv.name.split(' / ')[0]} · {barberDuration(sv, barbers.find((b) => b.id === barberId))}m
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
  add: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#3fae5a', alignItems: 'center', justifyContent: 'center' },
  addText: { color: '#fff', fontSize: 26, fontWeight: '700', lineHeight: 28 },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  day: { width: 56, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  dayOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  small: { color: colors.muted, fontSize: 11 },
  num: { color: colors.text, fontSize: 18, fontWeight: '800' },
});
