import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text, TextInput, View } from 'react-native';
import { staffApi, type StaffClient } from '@/api/staff';
import { BOOKING_STATUS } from '@/components/BookingSheet';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

// Fișa clientului: contact, notițe interne și istoricul programărilor.
export default function StaffClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { staff, staffToken } = useStaff();
  const [c, setC] = useState<StaffClient | null>(null);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!staffToken || !id) return;
    staffApi.client(staffToken, id).then(
      (x) => {
        setC(x);
        setNotes(x.notes ?? '');
      },
      (e) => setMsg({ ok: false, text: errorMessage(e) }),
    );
  }, [staffToken, id]);

  if (!staff || !staffToken) return null;
  if (!c) return <Screen edges={['bottom']}>{msg ? <Text style={{ color: colors.danger }}>{msg.text}</Text> : <ActivityIndicator color={colors.gold} />}</Screen>;

  const history = (c.bookings ?? []).slice().sort((a, b) => b.start.localeCompare(a.start));
  const done = history.filter((b) => b.status === 'completed' || (b.status === 'confirmed' && new Date(b.start).getTime() < Date.now()));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await staffApi.saveClient(staffToken, c.id, { notes });
      setC({ ...c, notes });
      setMsg({ ok: true, text: 'Salvat.' });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>{c.name || 'Client'}</Text>
      <Text style={[ui.muted, { marginBottom: space.md }]}>
        {c.phone}
        {c.email ? ` · ${c.email}` : ''}
      </Text>
      {c.phone ? <Button title={`Sună ${c.phone}`} variant="ghost" onPress={() => Linking.openURL(`tel:${c.phone}`)} /> : null}

      <Text style={ui.label}>Notițe (le vede doar echipa)</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        style={[ui.input, { height: 90, paddingTop: 12, textAlignVertical: 'top' }]}
        placeholder="Ex.: preferă fade 0.5, vine mereu sâmbăta"
        placeholderTextColor={colors.muted}
      />
      {notes !== (c.notes ?? '') ? (
        <View style={{ marginTop: space.sm }}>
          <Button title="Salvează notițele" onPress={save} loading={busy} />
        </View>
      ) : null}
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginTop: space.sm }}>{msg.text}</Text> : null}

      <Text style={[ui.label, { marginTop: space.lg }]}>
        Istoric · {done.length} {done.length === 1 ? 'vizită' : 'vizite'}
      </Text>
      <View style={{ gap: space.sm }}>
        {history.length === 0 ? <Text style={ui.muted}>Nicio programare încă.</Text> : null}
        {history.map((b) => (
          <Card key={b.id} style={{ gap: 2, borderLeftWidth: 5, borderLeftColor: BOOKING_STATUS[b.status].color }}>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.cardTitle}>
                {formatDate(new Date(b.start))}, {formatTime(new Date(b.start))}
              </Text>
              <Text style={{ color: BOOKING_STATUS[b.status].color, fontWeight: '700', fontSize: 12 }}>{BOOKING_STATUS[b.status].label}</Text>
            </View>
            <Text style={ui.muted}>
              {b.serviceName} · {b.barberName}
              {staff.permissions.stats ? ` · ${b.price} lei` : ''}
            </Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
