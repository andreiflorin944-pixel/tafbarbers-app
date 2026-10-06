import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Text, TextInput, View } from 'react-native';
import { staffApi, type StaffClient } from '@/api/staff';
import { BOOKING_STATUS } from '@/components/BookingSheet';
import { PhotoGrid, PhotoViewer } from '@/components/PhotoViewer';
import { Avatar, Button, Card, Screen, styles as ui } from '@/components/ui';
import type { Bonus, IdentityPhoto } from '@/data/types';
import { BonusRow } from '@/components/BonusRow';
import { ageFrom, formatBirth, formatDate, formatTime } from '@/lib/dates';
import { pickImage } from '@/lib/pickImage';
import { errorMessage } from '@/lib/errors';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

// Fișa clientului: contact, TAF Identity (de la client), poze și notițe doar pentru echipă, istoric.
export default function StaffClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { staff, staffToken } = useStaff();
  const [c, setC] = useState<StaffClient | null>(null);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [view, setView] = useState<{ list: IdentityPhoto[]; i: number } | null>(null);

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

  const identity = c.identity ?? { note: '', photos: [], staffPhotos: [] };
  const staffPhotos = identity.staffPhotos ?? [];
  const age = ageFrom(c.birthDate);
  const activeBonuses = (c.bonuses ?? []).filter((b) => b.status === 'active');

  const markUsed = (b: Bonus) => {
    const go = async () => {
      try {
        await staffApi.useBonus(staffToken, b.id);
        setC({ ...c, bonuses: (c.bonuses ?? []).map((x) => (x.id === b.id ? { ...x, status: 'used', usedAt: new Date().toISOString() } : x)) });
      } catch (e) {
        setMsg({ ok: false, text: errorMessage(e) });
      }
    };
    const text = `Marchezi „${b.title}” ca folosit?`;
    if (Platform.OS === 'web') return window.confirm(text) && go();
    Alert.alert('Bonus folosit', text, [
      { text: 'Nu', style: 'cancel' },
      { text: 'Da', onPress: go },
    ]);
  };

  const addPhoto = async () => {
    setMsg(null);
    try {
      const uri = await pickImage();
      if (!uri) return;
      setPhotoBusy(true);
      const p = await staffApi.addClientPhoto(staffToken, c.id, uri);
      setC({ ...c, identity: { ...identity, staffPhotos: [...staffPhotos, { ...p, addedBy: staff.name }] } });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setPhotoBusy(false);
    }
  };

  const removeStaffPhoto = (p: IdentityPhoto) => {
    const go = async () => {
      try {
        await staffApi.deleteClientPhoto(staffToken, c.id, p.id);
        setView(null);
        setC({ ...c, identity: { ...identity, staffPhotos: staffPhotos.filter((x) => x.id !== p.id) } });
      } catch (e) {
        setMsg({ ok: false, text: errorMessage(e) });
      }
    };
    if (Platform.OS === 'web') return window.confirm('Ștergi poza?') && go();
    Alert.alert('Ștergi poza?', undefined, [
      { text: 'Nu', style: 'cancel' },
      { text: 'Șterge', style: 'destructive', onPress: go },
    ]);
  };

  return (
    <Screen edges={['bottom']}>
      <View style={[ui.row, { gap: space.md, marginBottom: space.md }]}>
        <Avatar barber={{ id: c.id, name: c.name, role: '', initials: (c.name || '?').charAt(0).toUpperCase(), photoUrl: c.photoUrl }} size={64} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>{c.name || 'Client'}</Text>
          <Text style={ui.muted}>
            {c.phone}
            {c.email ? ` · ${c.email}` : ''}
          </Text>
          {c.birthDate ? (
            <Text style={ui.muted}>
              Născut pe {formatBirth(c.birthDate)}
              {age !== null ? ` · ${age} ani` : ''}
            </Text>
          ) : null}
        </View>
      </View>
      {c.phone ? <Button title={`Sună ${c.phone}`} variant="ghost" onPress={() => Linking.openURL(`tel:${c.phone}`)} /> : null}

      {activeBonuses.length ? (
        <>
          <Text style={[ui.label, { color: colors.gold }]}>Bonusuri active</Text>
          <View style={{ gap: space.sm }}>
            {activeBonuses.map((b) => (
              <BonusRow key={b.id} b={b} action={<View style={{ width: 104 }}><Button title="Folosit" variant="ghost" onPress={() => markUsed(b)} /></View>} />
            ))}
          </View>
        </>
      ) : null}
      {c.referredBy || c.referredCount ? (
        <Text style={[ui.muted, { marginTop: space.sm }]}>
          {c.referredBy ? `Recomandat de ${c.referredBy.name || 'un client'}. ` : ''}
          {c.referredCount ? `A adus ${c.referredCount} ${c.referredCount === 1 ? 'client nou' : 'clienți noi'}.` : ''}
        </Text>
      ) : null}

      <Text style={[ui.label, { color: colors.gold }]}>TAF Identity (de la client)</Text>
      {identity.note ? (
        <Card>
          <Text style={ui.text}>{identity.note}</Text>
        </Card>
      ) : null}
      {identity.photos.length ? (
        <View style={{ marginTop: space.sm }}>
          <PhotoGrid photos={identity.photos} onOpen={(i) => setView({ list: identity.photos, i })} />
        </View>
      ) : null}
      {!identity.note && !identity.photos.length ? <Text style={ui.muted}>Clientul nu a pus încă poze sau o descriere.</Text> : null}

      <Text style={[ui.label, { marginTop: space.lg }]}>Doar pentru echipă: poze</Text>
      <PhotoGrid photos={staffPhotos} onOpen={(i) => setView({ list: staffPhotos, i })} onAdd={addPhoto} busy={photoBusy} />

      <Text style={ui.label}>Doar pentru echipă: notițe</Text>
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
      <PhotoViewer
        photos={view?.list ?? []}
        index={view?.i ?? null}
        onIndex={(i) => setView((v) => v && { ...v, i })}
        onClose={() => setView(null)}
        onDelete={view && view.list === staffPhotos ? removeStaffPhoto : undefined}
      />
    </Screen>
  );
}
