import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { BLOCK_KINDS, blockLabel, panelUrl, staffApi, type BlockKind, type StaffBarber, type StaffBlock, type StaffTimeOff } from '@/api/staff';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import { useT } from '@/i18n';
import { addDays, dayKey, dayName, formatDate, formatTime, pad } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const isHm = (v: string) => /^\d{1,2}:\d{2}$/.test(v.trim());
const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// Programul de lucru (din panou) și concediile / zilele libere, care se pot pune direct de aici.
export default function StaffHours() {
  const { staff, staffToken } = useStaff();
  const { t } = useT();
  const [barbers, setBarbers] = useState<StaffBarber[]>([]);
  const [off, setOff] = useState<StaffTimeOff[]>([]);
  const [from, setFrom] = useState(dayKey(addDays(new Date(), 1)));
  const [to, setTo] = useState(dayKey(addDays(new Date(), 1)));
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [blocks, setBlocks] = useState<StaffBlock[]>([]);
  const load = useCallback(() => {
    if (!staffToken) return;
    staffApi.barbers(staffToken).then((b) => setBarbers(b.filter((x) => x.active)), () => undefined);
    staffApi.listTimeOff(staffToken, new Date().toISOString()).then(setOff, () => undefined);
    staffApi.listBlocks(staffToken).then(setBlocks, () => undefined);
  }, [staffToken]);
  useEffect(load, [load]);

  if (!staff || !staffToken) return null;
  const mine = staff.barberId ? barbers.filter((b) => b.id === staff.barberId) : barbers;
  const visibleOff = off.filter((o) => staff.owner || !o.barberId || o.barberId === staff.barberId);
  const nameOf = (id: string | null) => (id ? (barbers.find((b) => b.id === id)?.name ?? '') : t('hours.wholeSalon'));

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await staffApi.timeOff(staffToken, { fromDay: from, toDay: to, reason: reason.trim(), barberId: staff.barberId });
      setMsg({ ok: true, text: t('hours.offAdded') });
      setReason('');
      load();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const remove = (o: StaffTimeOff) => {
    const yes = () => staffApi.deleteTimeOff(staffToken, o.id).then(load, (e) => setMsg({ ok: false, text: errorMessage(e) }));
    if (Platform.OS === 'web') return window.confirm(t('hours.offDeleteAsk')) && yes();
    Alert.alert(t('hours.offDeleteAsk'), undefined, [
      { text: t('common.no'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: yes },
    ]);
  };

  return (
    <Screen edges={['bottom']}>
      <Text style={ui.label}>{t('hours.schedule')}</Text>
      {mine.map((b) => (
        <Card key={b.id} style={{ gap: 4, marginBottom: space.sm }}>
          <Text style={ui.cardTitle}>{b.name}</Text>
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
            const h = b.hours.filter((x) => x.weekday === wd);
            return (
              <View key={wd} style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={[ui.text, { textTransform: 'capitalize' }]}>{dayName(wd, true)}</Text>
                <Text style={h.length ? ui.text : ui.muted}>{h.length ? h.map((x) => `${hm(x.start)}–${hm(x.end)}`).join(', ') : t('hours.free')}</Text>
              </View>
            );
          })}
        </Card>
      ))}
      {staff.owner && panelUrl() ? <Button title={t('hours.editInPanel')} variant="ghost" onPress={() => Linking.openURL(panelUrl('barbers'))} /> : null}

      <Text style={[ui.label, { marginTop: space.lg }]}>{t('hours.timeOff')}</Text>
      {visibleOff.length === 0 ? <Text style={ui.muted}>{t('hours.nothing')}</Text> : null}
      {visibleOff.map((o) => (
        <Card key={o.id} style={[ui.row, { justifyContent: 'space-between', marginBottom: space.sm }]}>
          <View style={{ flex: 1 }}>
            <Text style={ui.cardTitle}>
              {formatDate(new Date(o.start))}
              {dayKey(new Date(o.start)) !== dayKey(addDays(new Date(o.end), -0.0001)) ? ` – ${formatDate(addDays(new Date(o.end), -0.0001))}` : ` · ${formatTime(new Date(o.start))}–${formatTime(new Date(o.end))}`}
            </Text>
            <Text style={ui.muted}>
              {nameOf(o.barberId)}
              {o.reason ? ` · ${o.reason}` : ''}
            </Text>
          </View>
          {staff.permissions.timeoff && (staff.owner || o.barberId === staff.barberId) ? (
            <Pressable onPress={() => remove(o)} hitSlop={10}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>{t('common.delete')}</Text>
            </Pressable>
          ) : null}
        </Card>
      ))}

      {staff.permissions.timeoff ? (
        <>
          <Text style={[ui.label, { marginTop: space.md }]}>
            {t('hours.addOff')} {staff.barberId ? '' : t('hours.wholeSalonParen')}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>{t('hours.fromDate')}</Text>
              <TextInput value={from} onChangeText={setFrom} style={ui.input} placeholderTextColor={colors.muted} autoCorrect={false} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>{t('hours.to')}</Text>
              <TextInput value={to} onChangeText={setTo} style={ui.input} placeholderTextColor={colors.muted} autoCorrect={false} />
            </View>
          </View>
          <TextInput value={reason} onChangeText={setReason} style={[ui.input, { marginTop: space.sm }]} placeholder={t('hours.reasonPh')} placeholderTextColor={colors.muted} />
          <View style={{ marginTop: space.sm }}>
            <Button title={t('common.add')} onPress={add} loading={busy} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from} />
          </View>
        </>
      ) : null}
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginTop: space.sm }}>{msg.text}</Text> : null}

      <BlocksSection blocks={blocks} nameOf={(id) => (id ? nameOf(id) : t('hours.allBarbers'))} onChange={load} />
    </Screen>
  );
}

/** Pauze și ore speciale (pauză de masă, liber, curs, altceva, doar membri), o dată sau în fiecare săptămână. */
function BlocksSection({ blocks, nameOf, onChange }: { blocks: StaffBlock[]; nameOf: (id: string | null) => string; onChange: () => void }) {
  const { staff, staffToken } = useStaff();
  const { t } = useT();
  const SHORT = t('hours.daysShort').split(',');
  const [kind, setKind] = useState<BlockKind>('lunch');
  const [label, setLabel] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [day, setDay] = useState(dayKey(new Date()));
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState('13:00');
  const [end, setEnd] = useState('14:00');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!staff || !staffToken) return null;

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await staffApi.addBlock(staffToken, {
        barberId: staff.barberId,
        kind,
        label: label.trim(),
        repeat,
        ...(repeat ? { weekdays } : { day: day.trim() }),
        start: start.trim(),
        end: end.trim(),
      });
      setLabel('');
      setMsg({ ok: true, text: !r.conflicts ? t('hours.blockAdded') : r.conflicts === 1 ? t('hours.blockConflictOne') : t('hours.blockConflictMany', { n: r.conflicts }) });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const remove = (b: StaffBlock) => {
    const yes = () => staffApi.deleteBlock(staffToken, b.id).then(onChange, (e) => setMsg({ ok: false, text: errorMessage(e) }));
    if (Platform.OS === 'web') return window.confirm(t('hours.blockDeleteAsk')) && yes();
    Alert.alert(t('hours.blockDeleteAsk'), t('hours.blockFreed'), [
      { text: t('common.no'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: yes },
    ]);
  };
  const colorOf = (k: BlockKind) => BLOCK_KINDS.find((x) => x.kind === k)?.color ?? colors.muted;
  const ok = isHm(start) && isHm(end) && (repeat ? weekdays.length > 0 : /^\d{4}-\d{2}-\d{2}$/.test(day.trim())) && (kind !== 'other' || !!label.trim());

  return (
    <>
      <Text style={[ui.label, { marginTop: space.lg }]}>{t('hours.blocks')}</Text>
      {blocks.length === 0 ? <Text style={ui.muted}>{t('hours.noBlocks')}</Text> : null}
      {blocks.map((b) => (
        <Card key={b.id} style={[ui.row, { justifyContent: 'space-between', marginBottom: space.sm }]}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colorOf(b.kind), marginRight: space.sm }} />
          <View style={{ flex: 1 }}>
            <Text style={ui.cardTitle}>
              {blockLabel(b)} · {b.start}–{b.end}
            </Text>
            <Text style={ui.muted}>
              {b.repeat ? WEEK.filter((d) => b.weekdays.includes(d)).map((d) => SHORT[d]).join(', ') + (b.untilDay ? t('hours.untilDate', { date: formatDate(new Date(b.untilDay + 'T12:00:00')) }) : '') : formatDate(new Date(b.day + 'T12:00:00'))}
              {' · '}
              {nameOf(b.barberId)}
            </Text>
          </View>
          {staff.permissions.timeoff && (staff.owner || b.barberId === staff.barberId) ? (
            <Pressable onPress={() => remove(b)} hitSlop={10}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>{t('common.delete')}</Text>
            </Pressable>
          ) : null}
        </Card>
      ))}
      {staff.permissions.timeoff ? (
        <>
          <Text style={[ui.label, { marginTop: space.md }]}>
            {t('hours.addBlock')} {staff.barberId ? '' : t('hours.allBarbersParen')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {BLOCK_KINDS.map((k) => (
              <Pressable key={k.kind} onPress={() => setKind(k.kind)} style={[chip, kind === k.kind && { borderColor: k.color, backgroundColor: k.color + '33' }]}>
                <Text style={ui.text}>{t(k.label)}</Text>
              </Pressable>
            ))}
          </View>
          {kind === 'members' ? <Text style={[ui.muted, { fontSize: 12, marginTop: 4 }]}>{t('hours.membersHint')}</Text> : null}
          {kind === 'other' ? (
            <TextInput value={label} onChangeText={setLabel} style={[ui.input, { marginTop: space.sm }]} placeholder={t('hours.otherPh')} placeholderTextColor={colors.muted} maxLength={60} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Pressable onPress={() => setRepeat(false)} style={[chip, !repeat && chipOn]}>
              <Text style={ui.text}>{t('hours.once')}</Text>
            </Pressable>
            <Pressable onPress={() => setRepeat(true)} style={[chip, repeat && chipOn]}>
              <Text style={ui.text}>{t('hours.weekly')}</Text>
            </Pressable>
          </View>
          {repeat ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
              {WEEK.map((d) => (
                <Pressable key={d} onPress={() => setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d])} style={[chip, weekdays.includes(d) && chipOn]}>
                  <Text style={ui.text}>{SHORT[d]}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={{ marginTop: space.sm }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>{t('hours.day')}</Text>
              <TextInput value={day} onChangeText={setDay} style={ui.input} placeholderTextColor={colors.muted} autoCorrect={false} />
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>{t('hours.fromTime')}</Text>
              <TextInput value={start} onChangeText={setStart} style={ui.input} placeholderTextColor={colors.muted} autoCorrect={false} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>{t('hours.to')}</Text>
              <TextInput value={end} onChangeText={setEnd} style={ui.input} placeholderTextColor={colors.muted} autoCorrect={false} />
            </View>
          </View>
          <View style={{ marginTop: space.sm }}>
            <Button title={t('hours.addBlockBtn')} onPress={add} loading={busy} disabled={!ok} />
          </View>
        </>
      ) : null}
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginTop: space.sm }}>{msg.text}</Text> : null}
    </>
  );
}

const chip = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border } as const;
const chipOn = { borderColor: colors.gold, backgroundColor: colors.gold + '33' } as const;
