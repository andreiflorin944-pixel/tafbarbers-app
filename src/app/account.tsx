import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Platform, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '@/api';
import { formatBirth, parseBirth } from '@/lib/dates';
import { pickImage } from '@/lib/pickImage';
import { Avatar, Button, Card, Icon, Screen, Segmented, styles } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { colors, space } from '@/theme';

// Un singur loc de cont, cu două părți: Client (rezervări) și Echipă (proprietar / frizeri).
export default function Account() {
  const { staff } = useStaff();
  const [tab, setTab] = useState(staff ? 1 : 0);
  return (
    <Screen edges={[]}>
      <Segmented options={['Client', 'Echipă']} value={tab} onChange={setTab} />
      {tab === 0 ? <ClientAccount /> : <StaffAccount />}
    </Screen>
  );
}

function StaffAccount() {
  const { staff, staffSignOut } = useStaff();
  if (!staff) {
    return (
      <>
        <Text style={[styles.muted, { marginBottom: space.md }]}>
          Pentru proprietar și frizeri: agenda zilei, programări noi, anulări. Fiecare frizer vede doar ce i-ai permis din panou.
        </Text>
        <Button title="Intră ca echipă" onPress={() => router.push('/staff/login')} />
      </>
    );
  }
  const p = staff.permissions;
  const rights = [
    p.bookings_all ? 'vede programările tuturor' : 'vede programările lui',
    p.bookings_create && 'adaugă programări',
    p.bookings_manage && 'anulează / marchează',
    p.clients && 'vede clienții',
    p.timeoff && 'își pune concedii',
    p.stats && 'vede încasările',
  ].filter(Boolean);
  return (
    <>
      <Card style={{ gap: 4 }}>
        <Text style={styles.cardTitle}>{staff.name || staff.email}</Text>
        <Text style={styles.muted}>{staff.owner ? 'Proprietar, acces complet' : `Frizer: ${rights.join(', ')}`}</Text>
      </Card>
      <View style={{ marginTop: space.md, gap: space.sm }}>
        <Button title="Deschide agenda" onPress={() => router.push('/staff')} />
        <Button title="Ieși din contul de echipă" variant="ghost" onPress={staffSignOut} />
      </View>
    </>
  );
}

function ClientAccount() {
  const { user, token, signOut, bookings, updateMe } = useApp();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [birth, setBirth] = useState(formatBirth(user?.birthDate));
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setBirth(formatBirth(user?.birthDate));
  }, [user?.id]);

  if (!user) {
    return (
      <>
        <Text style={[styles.muted, { marginBottom: space.md }]}>Salvează-ți datele și vezi istoricul programărilor.</Text>
        <Button title="Intră în cont cu telefonul" onPress={() => router.push('/login')} />
      </>
    );
  }

  const active = bookings.filter((b) => b.status === 'confirmed' && new Date(b.start).getTime() > Date.now()).length;
  const birthIso = birth.trim() ? parseBirth(birth) : null;
  const dirty = name.trim() !== user.name || (email.trim() || null) !== (user.email || null) || (birthIso ?? null) !== (user.birthDate ?? null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      if (birth.trim() && !birthIso) throw new ApiError('invalid_birth_date', 400);
      await updateMe({ name: name.trim(), email: email.trim() || null, birthDate: birthIso });
      setMsg({ ok: true, text: 'Salvat.' });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const downloadData = async () => {
    if (!token) return;
    setMsg(null);
    try {
      const json = JSON.stringify(await api.exportMe(token), null, 2);
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'datele-mele-tafbarbers.json';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ title: 'Datele mele', message: json });
      }
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  const deleteAccount = () => {
    const text = 'Contul, numele, telefonul și e-mailul tău se șterg definitiv, iar programările viitoare se anulează.';
    const go = async () => {
      if (!token) return;
      try {
        await api.deleteMe(token);
        await signOut();
      } catch (e) {
        setMsg({ ok: false, text: errorMessage(e) });
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Ștergi contul?\n\n${text}`)) go();
    } else {
      Alert.alert('Ștergi contul?', text, [
        { text: 'Renunță', style: 'cancel' },
        { text: 'Șterge', style: 'destructive', onPress: go },
      ]);
    }
  };

  const changePhoto = async () => {
    if (!token) return;
    setMsg(null);
    try {
      const uri = await pickImage({ square: true });
      if (!uri) return;
      setPhotoBusy(true);
      await api.setProfilePhoto(token, uri);
      await updateMe({});
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setPhotoBusy(false);
    }
  };

  const toggle = (ch: 'sms' | 'email' | 'push') => (v: boolean) => {
    updateMe({ marketing: { [ch]: v } }).catch((e) => setMsg({ ok: false, text: errorMessage(e) }));
  };

  return (
    <>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Pressable onPress={changePhoto} accessibilityLabel="Schimbă poza de profil">
          <Avatar barber={{ id: 'me', name: user.name, role: '', initials: (user.name || '?').charAt(0).toUpperCase(), photoUrl: user.photoUrl }} size={64} />
          <View style={s.camBadge}>{photoBusy ? <ActivityIndicator size="small" color={colors.onGold} /> : <Ionicons name="camera" size={14} color={colors.onGold} />}</View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{user.name || 'Client'}</Text>
          <Text style={styles.muted}>{user.phone}</Text>
        </View>
      </Card>

      <Pressable onPress={() => router.push('/identity')}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: colors.gold }}>
          <Ionicons name="images" size={26} color={colors.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>TAF Identity</Text>
            <Text style={styles.muted}>Pozele și descrierea tunsorii tale, ca să le arăți simplu frizerului</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Card>
      </Pressable>

      <Card style={{ gap: space.sm }}>
        <View style={styles.row}>
          <Icon name="calendar" />
          <Text style={styles.text}>
            {active} {active === 1 ? 'programare viitoare' : 'programări viitoare'}
          </Text>
        </View>
        <Pressable style={styles.row} onPress={() => router.push('/rewards')} accessibilityRole="button">
          <Icon name="star" />
          <Text style={[styles.text, { flex: 1 }]}>Bonusuri și recomandări</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      </Card>

      <Text style={styles.label}>Nume</Text>
      <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Numele tău" placeholderTextColor={colors.muted} />
      <Text style={styles.label}>Data nașterii</Text>
      <TextInput value={birth} onChangeText={setBirth} style={styles.input} placeholder="ZZ.LL.AAAA" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" maxLength={10} />
      <Text style={styles.label}>E-mail</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        style={styles.input}
        placeholder="nume@exemplu.ro"
        placeholderTextColor={colors.muted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      {dirty ? (
        <View style={{ marginTop: space.md }}>
          <Button title="Salvează" onPress={save} loading={saving} />
        </View>
      ) : null}
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginTop: space.sm }}>{msg.text}</Text> : null}

      <View style={{ marginTop: space.md }}>
        <Button title="Comenzile mele din magazin" variant="ghost" onPress={() => router.push('/shop/orders')} />
      </View>

      <Text style={[styles.label, { marginTop: space.lg }]}>Vreau să primesc oferte prin</Text>
      <Card style={{ gap: space.sm }}>
        <Toggle label="Notificări în aplicație" value={user.marketing.push} onChange={toggle('push')} />
        <Toggle label="E-mail" value={user.marketing.email} onChange={toggle('email')} disabled={!user.email} />
        <Toggle label="SMS" value={user.marketing.sms} onChange={toggle('sms')} />
      </Card>
      <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>
        Confirmările și reamintirile pentru programări vin oricum pe SMS.
      </Text>

      <View style={{ marginTop: space.lg }}>
        <Button title="Ieși din cont" variant="ghost" onPress={signOut} />
      </View>

      <Text style={[styles.label, { marginTop: space.lg }]}>Datele mele</Text>
      <View style={{ gap: space.sm }}>
        <Button title="Descarcă datele mele" variant="ghost" onPress={downloadData} />
        <Button title="Șterge contul" variant="ghost" onPress={deleteAccount} />
        <Button title="Confidențialitate" variant="ghost" onPress={() => router.push('/legal/privacy')} />
      </View>
    </>
  );
}

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: disabled ? 0.5 : 1 }}>
      <Text style={styles.text}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.gold, false: colors.border }}
        thumbColor={colors.text}
        // react-native-web colorează altfel butonul activ
        {...({ activeThumbColor: colors.text } as object)}
        accessibilityLabel={label}
      />
    </View>
  );
}

const s = StyleSheet.create({
  camBadge: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.card },
});
