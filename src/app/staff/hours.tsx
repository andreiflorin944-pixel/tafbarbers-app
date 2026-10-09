import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { BLOCK_KINDS, panelUrl, staffApi, type BlockKind, type StaffBarber, type StaffBlock, type StaffTimeOff } from '@/api/staff';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import { addDays, dayKey, formatDate, formatTime, pad } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

const DAYS = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
const SHORT = ['Du', 'Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ'];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const isHm = (v: string) => /^\d{1,2}:\d{2}$/.test(v.trim());
const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// Programul de lucru (din panou) și concediile / zilele libere, care se pot pune direct de aici.
export default function StaffHours() {
  const { staff, staffToken } = useStaff();
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
  const visibleOff = off.filter((t) => staff.owner || !t.barberId || t.barberId === staff.barberId);
  const nameOf = (id: string | null) => (id ? (barbers.find((b) => b.id === id)?.name ?? '') : 'Tot salonul');

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await staffApi.timeOff(staffToken, { fromDay: from, toDay: to, reason: reason.trim(), barberId: staff.barberId });
      setMsg({ ok: true, text: 'Adăugat. În zilele astea clienții nu mai văd ore libere.' });
      setReason('');
      load();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const remove = (t: StaffTimeOff) => {
    const yes = () => staffApi.deleteTimeOff(staffToken, t.id).then(load, (e) => setMsg({ ok: false, text: errorMessage(e) }));
    if (Platform.OS === 'web') return window.confirm('Ștergi perioada?') && yes();
    Alert.alert('Ștergi perioada?', undefined, [
      { text: 'Nu', style: 'cancel' },
      { text: 'Șterge', style: 'destructive', onPress: yes },
    ]);
  };

  return (
    <Screen edges={['bottom']}>
      <Text style={ui.label}>Program de lucru</Text>
      {mine.map((b) => (
        <Card key={b.id} style={{ gap: 4, marginBottom: space.sm }}>
          <Text style={ui.cardTitle}>{b.name}</Text>
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
            const h = b.hours.filter((x) => x.weekday === wd);
            return (
              <View key={wd} style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.text}>{DAYS[wd]}</Text>
                <Text style={h.length ? ui.text : ui.muted}>{h.length ? h.map((x) => `${hm(x.start)}–${hm(x.end)}`).join(', ') : 'Liber'}</Text>
              </View>
            );
          })}
        </Card>
      ))}
      {staff.owner && panelUrl() ? <Button title="Modifică programul în panou" variant="ghost" onPress={() => Linking.openURL(panelUrl('barbers'))} /> : null}

      <Text style={[ui.label, { marginTop: space.lg }]}>Concedii și zile libere</Text>
      {visibleOff.length === 0 ? <Text style={ui.muted}>Nimic programat.</Text> : null}
      {visibleOff.map((t) => (
        <Card key={t.id} style={[ui.row, { justifyContent: 'space-between', marginBottom: space.sm }]}>
          <View style={{ flex: 1 }}>
            <Text style={ui.cardTitle}>
              {formatDate(new Date(t.start))}
              {dayKey(new Date(t.start)) !== dayKey(addDays(new Date(t.end), -0.0001)) ? ` – ${formatDate(addDays(new Date(t.end), -0.0001))}` : ` · ${formatTime(new Date(t.start))}–${formatTime(new Date(t.end))}`}
            </Text>
            <Text style={ui.muted}>
              {nameOf(t.barberId)}
              {t.reason ? ` · ${t.reason}` : ''}
            </Text>
          </View>
          {staff.permissions.timeoff && (staff.owner || t.barberId === staff.barberId) ? (
            <Pressable onPress={() => remove(t)} hitSlop={10}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>Șterge</Text>
            </Pressable>
          ) : null}
        </Card>
      ))}

      {staff.permissions.timeoff ? (
        <>
          <Text style={[ui.label, { marginTop: space.md }]}>Adaugă zile libere {staff.barberId ? '' : '(tot salonul)'}</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>De la (AAAA-LL-ZZ)</Text>
              <TextInput value={from} onChangeText={setFrom} style={ui.input} placeholderTextColor={colors.muted} autoCorrect={false} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>Până la</Text>
              <TextInput value={to} onChangeText={setTo} style={ui.input} placeholderTextColor={colors.muted} autoCorrect={false} />
            </View>
          </View>
          <TextInput value={reason} onChangeText={setReason} style={[ui.input, { marginTop: space.sm }]} placeholder="Motiv (opțional), ex.: concediu" placeholderTextColor={colors.muted} />
          <View style={{ marginTop: space.sm }}>
            <Button title="Adaugă" onPress={add} loading={busy} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from} />
          </View>
        </>
      ) : null}
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginTop: space.sm }}>{msg.text}</Text> : null}

      <BlocksSection blocks={blocks} nameOf={(id) => (id ? nameOf(id) : 'Toți frizerii')} onChange={load} />
    </Screen>
  );
}

/** Pauze și ore speciale (pauză de masă, liber, curs, altceva, doar membri), o dată sau în fiecare săptămână. */
function BlocksSection({ blocks, nameOf, onChange }: { blocks: StaffBlock[]; nameOf: (id: string | null) => string; onChange: () => void }) {
  const { staff, staffToken } = useStaff();
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
      setMsg({ ok: true, text: r.conflicts ? `Adăugat. Atenție: ${r.conflicts} ${r.conflicts === 1 ? 'programare deja făcută se suprapune' : 'programări deja făcute se suprapun'}; verifică-le în calendar.` : 'Adăugat.' });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const remove = (b: StaffBlock) => {
    const yes = () => staffApi.deleteBlock(staffToken, b.id).then(onChange, (e) => setMsg({ ok: false, text: errorMessage(e) }));
    if (Platform.OS === 'web') return window.confirm('Ștergi blocul?') && yes();
    Alert.alert('Ștergi blocul?', 'Orele redevin libere.', [
      { text: 'Nu', style: 'cancel' },
      { text: 'Șterge', style: 'destructive', onPress: yes },
    ]);
  };
  const colorOf = (k: BlockKind) => BLOCK_KINDS.find((x) => x.kind === k)?.color ?? colors.muted;
  const ok = isHm(start) && isHm(end) && (repeat ? weekdays.length > 0 : /^\d{4}-\d{2}-\d{2}$/.test(day.trim())) && (kind !== 'other' || !!label.trim());

  return (
    <>
      <Text style={[ui.label, { marginTop: space.lg }]}>Pauze și ore speciale</Text>
      {blocks.length === 0 ? <Text style={ui.muted}>Niciun bloc în program.</Text> : null}
      {blocks.map((b) => (
        <Card key={b.id} style={[ui.row, { justifyContent: 'space-between', marginBottom: space.sm }]}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colorOf(b.kind), marginRight: space.sm }} />
          <View style={{ flex: 1 }}>
            <Text style={ui.cardTitle}>
              {b.label} · {b.start}–{b.end}
            </Text>
            <Text style={ui.muted}>
              {b.repeat ? WEEK.filter((d) => b.weekdays.includes(d)).map((d) => SHORT[d]).join(', ') + (b.untilDay ? `, până pe ${formatDate(new Date(b.untilDay + 'T12:00:00'))}` : '') : formatDate(new Date(b.day + 'T12:00:00'))}
              {' · '}
              {nameOf(b.barberId)}
            </Text>
          </View>
          {staff.permissions.timeoff && (staff.owner || b.barberId === staff.barberId) ? (
            <Pressable onPress={() => remove(b)} hitSlop={10}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>Șterge</Text>
            </Pressable>
          ) : null}
        </Card>
      ))}
      {staff.permissions.timeoff ? (
        <>
          <Text style={[ui.label, { marginTop: space.md }]}>Adaugă un bloc {staff.barberId ? '' : '(toți frizerii)'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {BLOCK_KINDS.map((k) => (
              <Pressable key={k.kind} onPress={() => setKind(k.kind)} style={[chip, kind === k.kind && { borderColor: k.color, backgroundColor: k.color + '33' }]}>
                <Text style={ui.text}>{k.label}</Text>
              </Pressable>
            ))}
          </View>
          {kind === 'members' ? <Text style={[ui.muted, { fontSize: 12, marginTop: 4 }]}>Orele rămân libere doar pentru clienții cu abonament activ sau marcați ca membri.</Text> : null}
          {kind === 'other' ? (
            <TextInput value={label} onChangeText={setLabel} style={[ui.input, { marginTop: space.sm }]} placeholder="Nume, ex.: ședință foto" placeholderTextColor={colors.muted} maxLength={60} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Pressable onPress={() => setRepeat(false)} style={[chip, !repeat && chipOn]}>
              <Text style={ui.text}>O singură dată</Text>
            </Pressable>
            <Pressable onPress={() => setRepeat(true)} style={[chip, repeat && chipOn]}>
              <Text style={ui.text}>În fiecare săptămână</Text>
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
              <Text style={[ui.muted, { fontSize: 12 }]}>Ziua (AAAA-LL-ZZ)</Text>
              <TextInput value={day} onChangeText={setDay} style={ui.input} placeholderTextColor={colors.muted} autoCorrect={false} />
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>De la (ex. 13:00)</Text>
              <TextInput value={start} onChangeText={setStart} style={ui.input} placeholderTextColor={colors.muted} autoCorrect={false} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ui.muted, { fontSize: 12 }]}>Până la</Text>
              <TextInput value={end} onChangeText={setEnd} style={ui.input} placeholderTextColor={colors.muted} autoCorrect={false} />
            </View>
          </View>
          <View style={{ marginTop: space.sm }}>
            <Button title="Adaugă blocul" onPress={add} loading={busy} disabled={!ok} />
          </View>
        </>
      ) : null}
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginTop: space.sm }}>{msg.text}</Text> : null}
    </>
  );
}

const chip = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border } as const;
const chipOn = { borderColor: colors.gold, backgroundColor: colors.gold + '33' } as const;
