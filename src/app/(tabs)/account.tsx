import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '@/api';
import { formatBirth, parseBirth } from '@/lib/dates';
import { pickImage } from '@/lib/pickImage';
import { PasswordSettings } from '@/components/PasswordSettings';
import { Avatar, Button, Card, Icon, Screen, Segmented, Title, styles } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { useStaff } from '@/state/Staff';
import { useT } from '@/i18n';
import { colors, space } from '@/theme';

// Un singur loc de cont. Fără cont: alegi Client (rezervări) sau Echipă (proprietar / frizeri).
// Clientul în cont vede doar contul lui; echipa ajunge la intrarea ei din linkul discret de la final.
export default function Account() {
  const { staff } = useStaff();
  const { user } = useApp();
  const { t } = useT();
  const [tab, setTab] = useState(staff ? 1 : 0);
  if (user) {
    return (
      <Screen tab>
        <Title>{t('account.yours')}</Title>
        <ClientAccount />
        <Pressable
          onPress={() => router.push(staff ? '/staff' : '/staff/login')}
          accessibilityRole="link"
          style={{ marginTop: space.xl, paddingVertical: space.sm, alignSelf: 'center' }}
        >
          <Text style={[styles.muted, { fontSize: 12, textDecorationLine: 'underline' }]}>{t('account.staffLink')}</Text>
        </Pressable>
      </Screen>
    );
  }
  return (
    <Screen tab>
      <Title>{t('account.title')}</Title>
      <Segmented options={[t('account.client'), t('account.team')]} value={tab} onChange={setTab} />
      {tab === 0 ? <ClientAccount /> : <StaffAccount />}
    </Screen>
  );
}

function StaffAccount() {
  const { staff, staffSignOut } = useStaff();
  const { t } = useT();
  if (!staff) {
    return (
      <>
        <Text style={[styles.muted, { marginBottom: space.md }]}>
          {t('account.staffIntro')}
        </Text>
        <Button title={t('account.staffAccess')} onPress={() => router.push('/staff/login')} />
      </>
    );
  }
  const p = staff.permissions;
  const rights = [
    p.bookings_all ? t('account.rightAll') : t('account.rightOwn'),
    p.bookings_create && t('account.rightCreate'),
    p.bookings_manage && t('account.rightManage'),
    p.clients && t('account.rightClients'),
    p.timeoff && t('account.rightTimeoff'),
    p.stats && t('account.rightStats'),
  ].filter(Boolean);
  return (
    <>
      <Card style={{ gap: 4 }}>
        <Text style={styles.cardTitle}>{staff.name || staff.email}</Text>
        <Text style={styles.muted}>{staff.owner ? t('account.owner') : t('account.barberRights', { rights: rights.join(', ') })}</Text>
      </Card>
      <View style={{ marginTop: space.md, gap: space.sm }}>
        <Button title={t('account.openAgenda')} onPress={() => router.push('/staff')} />
        <Button title={t('account.staffSignOut')} variant="ghost" onPress={staffSignOut} />
      </View>
    </>
  );
}

function ClientAccount() {
  const { user, token, signOut, bookings, updateMe } = useApp();
  const { t } = useT();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [birth, setBirth] = useState(formatBirth(user?.birthDate));
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [offersMsg, setOffersMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setBirth(formatBirth(user?.birthDate));
  }, [user?.id]);

  if (!user) {
    return (
      <>
        <Text style={[styles.muted, { marginBottom: space.md }]}>
          {t('account.guestIntro')}
        </Text>
        <Button title={t('common.register')} onPress={() => router.push({ pathname: '/login', params: { mode: 'register' } })} />
        <View style={{ marginTop: space.sm, gap: space.sm }}>
          <Button title={t('common.login')} variant="ghost" onPress={() => router.push('/login')} />
          <Button title={t('account.shop')} variant="ghost" onPress={() => router.push('/shop')} />
          <Button title={t('account.about')} variant="ghost" onPress={() => router.push('/about')} />
        </View>
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
      setMsg({ ok: true, text: t('account.saved') });
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
        await Share.share({ title: t('account.myData'), message: json });
      }
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  const deleteAccount = () => {
    const text = t('account.deleteText');
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
      if (window.confirm(`${t('account.deleteAsk')}\n\n${text}`)) go();
    } else {
      Alert.alert(t('account.deleteAsk'), text, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: go },
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

  // Acordul pentru oferte se dă o singură dată, cu bifa de la crearea contului. Aici doar se retrage
  // (toate canalele odată) sau se dă din nou; serverul păstrează dovada fiecărei schimbări.
  const offersOn = user.marketing.push || user.marketing.email || user.marketing.sms;
  const toggleOffers = () => {
    const on = !offersOn;
    const go = () => {
      setOffersMsg(null);
      updateMe({ marketing: { push: on, email: on, sms: on } }).then(
        () => setOffersMsg({ ok: true, text: t(on ? 'account.offersStarted' : 'account.offersStopped') }),
        (e) => setOffersMsg({ ok: false, text: errorMessage(e) }),
      );
    };
    const title = t(on ? 'account.offersStart' : 'account.offersStop');
    const text = t(on ? 'account.offersStartAsk' : 'account.offersStopAsk');
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}?\n\n${text}`)) go();
    } else {
      Alert.alert(`${title}?`, text, [
        { text: t('account.cancel'), style: 'cancel' },
        { text: t('account.confirm'), onPress: go },
      ]);
    }
  };

  return (
    <>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Pressable onPress={changePhoto} accessibilityLabel={t('account.changePhoto')}>
          <Avatar barber={{ id: 'me', name: user.name, role: '', initials: (user.name || '?').charAt(0).toUpperCase(), photoUrl: user.photoUrl }} size={64} />
          <View style={s.camBadge}>{photoBusy ? <ActivityIndicator size="small" color={colors.onGold} /> : <Ionicons name="camera" size={14} color={colors.onGold} />}</View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{user.name || t('account.client')}</Text>
          <Text style={styles.muted}>{user.phone}</Text>
        </View>
      </Card>

      <Pressable onPress={() => router.push('/identity')}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: colors.gold }}>
          <Ionicons name="images" size={26} color={colors.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t('account.identity')}</Text>
            <Text style={styles.muted}>{t('account.identitySub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Card>
      </Pressable>

      <Card style={{ gap: space.sm }}>
        <View style={styles.row}>
          <Icon name="calendar" />
          <Text style={styles.text}>
            {active === 1 ? t('account.upcomingOne') : t('account.upcomingMany', { n: active })}
          </Text>
        </View>
        <Pressable style={styles.row} onPress={() => router.push('/rewards')} accessibilityRole="button">
          <Icon name="star" />
          <Text style={[styles.text, { flex: 1 }]}>{t('account.rewards')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
        <Pressable style={styles.row} onPress={() => router.push('/subscriptions')} accessibilityRole="button">
          <Icon name="ribbon" />
          <Text style={[styles.text, { flex: 1 }]}>{t('account.subscriptions')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
        <Pressable style={styles.row} onPress={() => router.push('/gift-cards')} accessibilityRole="button">
          <Icon name="gift" />
          <Text style={[styles.text, { flex: 1 }]}>{t('account.giftCards')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
        <Pressable style={styles.row} onPress={() => router.push('/before-after')} accessibilityRole="button">
          <Icon name="images" />
          <Text style={[styles.text, { flex: 1 }]}>{t('account.beforeAfter')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
        <Pressable style={styles.row} onPress={() => router.push('/shop')} accessibilityRole="button">
          <Icon name="bag-handle" />
          <Text style={[styles.text, { flex: 1 }]}>{t('account.shopCart')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
        <Pressable style={styles.row} onPress={() => router.push('/about')} accessibilityRole="button">
          <Icon name="storefront" />
          <Text style={[styles.text, { flex: 1 }]}>{t('account.about')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      </Card>

      <Text style={[styles.label, { marginTop: space.lg, color: colors.gold }]}>{t('account.myData')}</Text>
      <Text style={styles.label}>{t('account.name')}</Text>
      <TextInput value={name} onChangeText={setName} style={styles.input} placeholder={t('account.namePh')} placeholderTextColor={colors.muted} />
      <Text style={styles.label}>{t('account.birth')}</Text>
      {/* Odată salvată, data nașterii (de care ține cadoul de ziua ta) se schimbă doar la salon. */}
      <TextInput
        value={birth}
        onChangeText={setBirth}
        editable={!user.birthDate}
        style={[styles.input, !!user.birthDate && { opacity: 0.6 }]}
        placeholder={t('login.birthPh')}
        placeholderTextColor={colors.muted}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      {user.birthDate ? <Text style={[styles.muted, { fontSize: 12 }]}>{t('account.birthLocked')}</Text> : null}
      <Text style={styles.label}>{t('account.email')}</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        style={styles.input}
        placeholder={t('account.emailPh')}
        placeholderTextColor={colors.muted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      {dirty ? (
        <View style={{ marginTop: space.md }}>
          <Button title={t('common.save')} onPress={save} loading={saving} />
        </View>
      ) : null}
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginTop: space.sm }}>{msg.text}</Text> : null}

      <PasswordSettings />

      <View style={{ marginTop: space.md }}>
        <Button title={t('account.myOrders')} variant="ghost" onPress={() => router.push('/shop/orders')} />
      </View>

      <View style={{ marginTop: space.lg }}>
        <Button title={t('account.signOut')} variant="ghost" onPress={signOut} />
      </View>

      <Text style={[styles.label, { marginTop: space.lg }]}>{t('account.myData')}</Text>
      <View style={{ gap: space.sm }}>
        <Button title={t('account.download')} variant="ghost" onPress={downloadData} />
        <Button title={t('account.delete')} variant="ghost" onPress={deleteAccount} />
        <Button title={t('account.privacy')} variant="ghost" onPress={() => router.push('/legal/privacy')} />
      </View>
      <Pressable onPress={toggleOffers} accessibilityRole="button" style={{ marginTop: space.md, paddingVertical: space.xs, alignSelf: 'center' }}>
        <Text style={[styles.muted, { fontSize: 13, textDecorationLine: 'underline' }]}>{t(offersOn ? 'account.offersStop' : 'account.offersStart')}</Text>
      </Pressable>
      {offersMsg ? <Text style={{ color: offersMsg.ok ? colors.success : colors.danger, textAlign: 'center', fontSize: 13 }}>{offersMsg.text}</Text> : null}
    </>
  );
}

const s = StyleSheet.create({
  camBadge: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.card },
});
