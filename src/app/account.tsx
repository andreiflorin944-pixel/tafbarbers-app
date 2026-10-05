import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { Avatar, Button, Card, Icon, Screen, styles } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

export default function Account() {
  const { user, signOut, bookings, updateMe } = useApp();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
  }, [user?.id]);

  if (!user) {
    return (
      <Screen edges={[]}>
        <Text style={[styles.muted, { marginBottom: space.md }]}>Salvează-ți datele și vezi istoricul programărilor.</Text>
        <Button title="Intră în cont cu telefonul" onPress={() => router.push('/login')} />
      </Screen>
    );
  }

  const active = bookings.filter((b) => b.status === 'confirmed' && new Date(b.start).getTime() > Date.now()).length;
  const dirty = name.trim() !== user.name || (email.trim() || null) !== (user.email || null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await updateMe({ name: name.trim(), email: email.trim() || null });
      setMsg({ ok: true, text: 'Salvat.' });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const toggle = (ch: 'sms' | 'email' | 'push') => (v: boolean) => {
    updateMe({ marketing: { [ch]: v } }).catch((e) => setMsg({ ok: false, text: errorMessage(e) }));
  };

  return (
    <Screen edges={[]}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar barber={{ id: 'me', name: user.name, role: '', initials: (user.name || '?').charAt(0).toUpperCase() }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{user.name || 'Client'}</Text>
          <Text style={styles.muted}>{user.phone}</Text>
        </View>
      </Card>

      <Card style={{ gap: space.sm }}>
        <View style={styles.row}>
          <Icon name="calendar" />
          <Text style={styles.text}>
            {active} {active === 1 ? 'programare viitoare' : 'programări viitoare'}
          </Text>
        </View>
        <View style={styles.row}>
          <Icon name="star" />
          <Text style={styles.text}>Program de loialitate (în curând)</Text>
        </View>
      </Card>

      <Text style={styles.label}>Nume</Text>
      <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Numele tău" placeholderTextColor={colors.muted} />
      <Text style={styles.label}>E-mail (pentru oferte)</Text>
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
    </Screen>
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
