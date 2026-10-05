import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { panelUrl, staffApi, type StaffBarber, type StaffTimeOff } from '@/api/staff';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import { addDays, dayKey, formatDate, formatTime, pad } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

const DAYS = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
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

  const load = useCallback(() => {
    if (!staffToken) return;
    staffApi.barbers(staffToken).then((b) => setBarbers(b.filter((x) => x.active)), () => undefined);
    staffApi.listTimeOff(staffToken, new Date().toISOString()).then(setOff, () => undefined);
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
    </Screen>
  );
}
