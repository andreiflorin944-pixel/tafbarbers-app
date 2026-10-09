import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, usingMock } from '@/api';
import { ApiError } from '@/api/client';
import { SocialLogin, type SocialResult } from '@/components/SocialLogin';
import { Button, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { parseBirth } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';
import { clearQr, pendingQr } from '@/lib/campaign';

type Mode = 'login' | 'register';

/**
 * Intrare în cont și cont nou, pe două taburi clare. Intrarea: telefon + e-mailul din cont, apoi codul primit.
 * Contul nou: nume, telefon, e-mail, ziua de naștere și (opțional) codul de recomandare de la un prieten.
 */
export function PhoneLogin({
  submitTitle,
  onDone,
  initialRef,
  initialMode,
}: {
  submitTitle?: string;
  onDone: (token: string) => void | Promise<void>;
  initialRef?: string;
  initialMode?: Mode;
}) {
  const { signIn, business } = useApp();
  const { lang, t } = useT();
  const [mode, setMode] = useState<Mode>(initialMode ?? (initialRef ? 'register' : 'login'));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [phoneSent, setPhoneSent] = useState<string | null>(null);
  const [birth, setBirth] = useState('');
  const [ref, setRef] = useState(initialRef?.toUpperCase() ?? '');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [accepted, setAccepted] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Prima logare cu Apple / Google: tichetul până completăm contul cu telefonul. `needCode`: numărul trebuie confirmat cu cod.
  const [social, setSocial] = useState<{ ticket: string; email: string | null } | null>(null);
  const [needCode, setNeedCode] = useState(false);

  const register = mode === 'register';
  const cleanPhone = phone.replace(/[\s\-().]/g, '');
  const cleanEmail = email.trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
  const birthOk = !!parseBirth(birth);
  const phoneOk = /^\+?\d{9,15}$/.test(cleanPhone);
  const nameOk = name.trim().length >= 2;
  const canSend = register ? phoneOk && nameOk && emailOk && birthOk && accepted : phoneOk;

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const send = async (via: 'email' | 'sms') => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.requestCode({ phone: cleanPhone, email: emailOk ? cleanEmail : undefined, channel: via }, lang);
      setChannel(r.channel);
      setSentTo(r.sentTo);
      setPhoneSent(r.phone);
      setDevCode(r.devCode);
      // Numărul spune dacă e cont nou sau nu; trecem singuri pe tabul potrivit, fără să pierdem ce ai scris.
      if (r.newAccount && !register) {
        setMode('register');
        setNotice(t('login.noAccount'));
      } else if (!r.newAccount && register) {
        setMode('login');
        setNotice(t('login.hasAccount'));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (token: string) => {
    void clearQr();
    await signIn(token);
    await onDone(token);
  };

  const onSocial = async (r: SocialResult) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.socialSignIn(r);
      if (res.token) return await finish(res.token);
      if (!res.ticket) return;
      setSocial({ ticket: res.ticket, email: res.email ?? null });
      setNeedCode(false);
      setMode('register');
      if (res.name) setName(res.name);
      if (res.email) setEmail(res.email);
      setNotice(t('login.socialMore'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Contul nou din Apple / Google: e-mailul e confirmat de ei, deci nu mai trimitem cod.
  const completeSocial = async () => {
    if (!social) return;
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.socialComplete({
        ticket: social.ticket,
        phone: cleanPhone,
        name: name.trim(),
        lang,
        acceptTerms: accepted,
        marketing,
        birthDate: parseBirth(birth) ?? undefined,
        ref: ref.trim() || undefined,
        qr: await pendingQr(),
      });
      await finish(token);
    } catch (e) {
      // Numărul are deja cont (sau e-mailul nu e confirmat): îl confirmăm o dată cu codul, iar contul extern se leagă.
      if (e instanceof ApiError && (e.code === 'phone_has_account' || e.code === 'code_required')) {
        setNeedCode(true);
        if (e.code === 'phone_has_account') setMode('login');
        setNotice(errorMessage(e));
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.verifyCode({
        phone: phoneSent!,
        code,
        name: name.trim(),
        lang,
        // La intrare, acordul e cel din textul de sub buton (pentru clienții adăugați din panou, care nu l-au dat încă).
        acceptTerms: register ? accepted : true,
        marketing: register ? marketing : false,
        birthDate: register ? (parseBirth(birth) ?? undefined) : undefined,
        email: emailOk ? cleanEmail : undefined,
        ref: register ? ref.trim() || undefined : undefined,
        qr: await pendingQr(),
        socialTicket: social?.ticket,
      });
      await finish(token);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, el: ReactNode, hint?: string | null) => (
    <View style={{ marginTop: space.md }}>
      <Text style={local.label}>{label}</Text>
      {el}
      {hint ? <Text style={local.hint}>{hint}</Text> : null}
    </View>
  );

  const socialOnly = !!social && !needCode;

  return (
    <View>
      {!social && !sentTo ? <SocialLogin social={business?.social} busy={busy} onToken={(r) => void onSocial(r)} /> : null}
      <View style={local.tabs} accessibilityRole="tablist">
        {(['login', 'register'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => switchMode(m)}
            style={[local.tab, mode === m && local.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
          >
            <Text style={[local.tabText, mode === m && local.tabTextOn]}>{t(m === 'login' ? 'login.tabLogin' : 'login.tabRegister')}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={local.headline}>{t(register ? 'login.titleRegister' : 'login.titleLogin')}</Text>
      <Text style={local.sub}>
        {t(register ? 'login.subRegister' : 'login.subLogin')}
      </Text>

      {notice ? (
        <View style={local.notice}>
          <Ionicons name="information-circle" size={18} color={colors.gold} />
          <Text style={[styles.text, { flex: 1, fontSize: 13 }]}>{notice}</Text>
        </View>
      ) : null}

      {register
        ? field(t('login.name'), <TextInput value={name} onChangeText={setName} placeholder={t('login.namePh')} placeholderTextColor={colors.muted} style={styles.input} autoComplete="name" />)
        : null}
      {field(
        t('login.phone'),
        <TextInput value={phone} onChangeText={setPhone} editable={!sentTo} placeholder="07xx xxx xxx" placeholderTextColor={colors.muted} style={[styles.input, sentTo ? local.locked : null]} keyboardType="phone-pad" autoComplete="tel" />,
      )}
      {field(
        t(register ? 'login.email' : 'login.emailLogin'),
        <TextInput
          value={email}
          onChangeText={setEmail}
          editable={!sentTo && !social?.email}
          placeholder="nume@exemplu.ro"
          placeholderTextColor={colors.muted}
          style={[styles.input, sentTo || social?.email ? local.locked : null]}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
        />,
        t(register ? 'login.emailHintRegister' : 'login.emailHintLogin'),
      )}
      {register ? (
        <>
          {field(
            t('login.birth'),
            <TextInput value={birth} onChangeText={setBirth} placeholder={t('login.birthPh')} placeholderTextColor={colors.muted} style={styles.input} keyboardType="numbers-and-punctuation" maxLength={10} />,
            t(birth.length >= 8 && !birthOk ? 'login.birthBad' : 'login.birthHint'),
          )}
          {field(
            t('login.ref'),
            <TextInput
              value={ref}
              onChangeText={(v) => setRef(v.toUpperCase())}
              placeholder="Ex. ANDREI7K"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
            />,
            t('login.refHint'),
          )}
        </>
      ) : null}

      {sentTo ? (
        <View style={local.codeBox}>
          <Text style={local.label}>{t(channel === 'email' ? 'login.codeEmail' : 'login.codeSms', { to: sentTo })}</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            placeholder="• • • • • •"
            placeholderTextColor={colors.muted}
            style={[styles.input, local.code]}
            keyboardType="number-pad"
            autoComplete={channel === 'sms' ? 'sms-otp' : 'one-time-code'}
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
          />
          {usingMock ? (
            <Text style={local.hint}>Versiune de test: orice cod din 6 cifre e acceptat.</Text>
          ) : devCode ? (
            <Text style={local.hint}>Server de test, codul este {devCode}.</Text>
          ) : null}
          <Pressable
            onPress={() => {
              setSentTo(null);
              setCode('');
              setNotice(null);
            }}
            style={{ marginTop: space.sm }}
          >
            <Text style={{ color: colors.gold, fontSize: 13, fontWeight: '600' }}>{t('login.change')}</Text>
          </Pressable>
        </View>
      ) : null}

      {register ? (
        <>
          <Check checked={accepted} onPress={() => setAccepted((a) => !a)} label={`${t('login.agree')} ${t('login.terms')} ${t('login.and')} ${t('login.privacy')}`}>
            {t('login.agree')}{' '}
            <Text style={{ color: colors.gold }} onPress={() => router.push('/legal/terms')}>
              {t('login.terms')}
            </Text>{' '}
            {t('login.and')}{' '}
            <Text style={{ color: colors.gold }} onPress={() => router.push('/legal/privacy')}>
              {t('login.privacy')}
            </Text>
            .
          </Check>
          <Check checked={marketing} onPress={() => setMarketing((m) => !m)} label={t('login.marketing')}>
            {t('login.marketing')}
          </Check>
        </>
      ) : null}

      {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}

      <View style={{ marginTop: space.lg }}>
        {socialOnly && register ? (
          <Button title={t('login.socialDone')} disabled={!phoneOk || !nameOk || !birthOk || !accepted} loading={busy} onPress={completeSocial} />
        ) : sentTo ? (
          <Button
            title={submitTitle ?? t(register ? 'login.submitRegister' : 'login.submitLogin')}
            disabled={code.length !== 6 || (register && (!accepted || !birthOk || !emailOk || !nameOk))}
            loading={busy}
            onPress={verify}
          />
        ) : (
          <>
            <Button title={t(register ? 'login.continue' : 'login.sendCode')} disabled={!canSend || !emailOk} loading={busy} onPress={() => send('email')} />
            {business?.otpSms === false ? null : (
            <Pressable
              onPress={() => send('sms')}
              disabled={!canSend || busy}
              style={{ marginTop: space.md, alignItems: 'center', opacity: !canSend ? 0.4 : 1 }}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.gold, fontSize: 14, fontWeight: '600' }}>{t('login.sendSms')}</Text>
            </Pressable>
            )}
          </>
        )}
      </View>

      {!register ? (
        <Text style={[local.hint, { textAlign: 'center', marginTop: space.md }]}>
          {t('login.implicit')}{' '}
          <Text style={{ color: colors.gold }} onPress={() => router.push('/legal/terms')}>
            {t('login.terms')}
          </Text>{' '}
          {t('login.and')}{' '}
          <Text style={{ color: colors.gold }} onPress={() => router.push('/legal/privacy')}>
            {t('login.privacy')}
          </Text>
          .
        </Text>
      ) : null}

      <Pressable onPress={() => switchMode(register ? 'login' : 'register')} style={{ marginTop: space.lg, alignItems: 'center' }} accessibilityRole="button">
        <Text style={styles.muted}>
          {t(register ? 'login.haveAccount' : 'login.noAccountYet')}{' '}
          <Text style={{ color: colors.gold, fontWeight: '700' }}>{t(register ? 'login.tabLogin' : 'login.tabRegister')}</Text>
        </Text>
      </Pressable>
    </View>
  );
}

function Check({ checked, onPress, label, children }: { checked: boolean; onPress: () => void; label: string; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginTop: space.md }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.gold : colors.muted} />
      <Text style={[styles.muted, { flex: 1, fontSize: 13, lineHeight: 19 }]}>{children}</Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: colors.cardAlt, borderRadius: radius.pill, padding: 4, marginBottom: space.lg },
  tab: { flex: 1, paddingVertical: 11, borderRadius: radius.pill, alignItems: 'center' },
  tabOn: { backgroundColor: colors.gold },
  tabText: { color: colors.muted, fontWeight: '700', fontSize: 15 },
  tabTextOn: { color: colors.onGold },
  headline: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 6 },
  label: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 6 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 5 },
  locked: { opacity: 0.6 },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: space.sm, marginTop: space.md, borderWidth: 1, borderColor: colors.goldDark },
  codeBox: { marginTop: space.lg, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.card },
  code: { fontSize: 26, letterSpacing: 8, textAlign: 'center', fontWeight: '800' },
});
