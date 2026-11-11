import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { api } from '@/api';
import { Button, Logo, styles as ui } from '@/components/ui';
import { useT } from '@/i18n';
import { storage } from '@/lib/storage';
import { colors, radius, space } from '@/theme';

// Versiunea nouă din magazine nu se poate instala singură pe toate telefoanele: Apple și Google o pun automat doar dacă
// telefonul are pornite „Actualizări automate”. Aici aplicația întreabă serverul ce versiune cere salonul
// (Panou → Aplicații → „Cere actualizarea în aplicație”) și, dacă a ei e mai veche, arată:
// - „Actualizare obligatorie”: ecran care nu se poate închide, cu butonul spre App Store / Google Play;
// - „Actualizare disponibilă”: se poate închide și apare din nou peste o zi.
// Tot aici: actualizările rapide (EAS Update) se descarcă și când aplicația revine din fundal, nu doar la pornire,
// și se aplică la următoarea revenire după o pauză lungă, ca să nu se întrerupă clientul în mijlocul unei programări.

const SNOOZE_KEY = 'taf.updateSnooze';
const DAY = 86_400_000;
const CHECK_EVERY = 30 * 60_000;
/** După cât timp în fundal se aplică o actualizare rapidă deja descărcată (aplicația repornește). */
const RELOAD_AFTER_BG = 15 * 60_000;

export const cmpVersion = (a: string, b: string) => {
  const x = a.split('.').map((n) => parseInt(n, 10) || 0);
  const y = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

type Need = { kind: 'required' | 'recommended'; latest: string; url: string; message: string } | null;

export function UpdateGate() {
  const { t } = useT();
  const [need, setNeed] = useState<Need>(null);
  const lastCheck = useRef(0);
  const otaReady = useRef(false);
  const bgSince = useRef<number | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const mine = Application.nativeApplicationVersion;

    const checkStore = async () => {
      if (!mine) return;
      try {
        const v = await api.getAppVersion();
        const p = Platform.OS === 'ios' ? v.ios : v.android;
        if (!p?.url) return;
        if (p.min && cmpVersion(mine, p.min) < 0) {
          setNeed({ kind: 'required', latest: p.latest || p.min, url: p.url, message: v.message });
          return;
        }
        if (p.latest && cmpVersion(mine, p.latest) < 0) {
          const snooze = await storage.get(SNOOZE_KEY);
          const [ver, at] = (snooze ?? '').split('|');
          if (ver === p.latest && Date.now() - Number(at) < DAY) return;
          setNeed({ kind: 'recommended', latest: p.latest, url: p.url, message: v.message });
          return;
        }
        setNeed(null);
      } catch {
        // fără rețea: încercăm la următoarea revenire în aplicație
      }
    };

    const checkOta = async () => {
      if (!Updates.isEnabled || __DEV__ || otaReady.current) return;
      try {
        const r = await Updates.checkForUpdateAsync();
        if (!r.isAvailable) return;
        const f = await Updates.fetchUpdateAsync();
        if (f.isNew) otaReady.current = true;
      } catch {
        // actualizarea rapidă se reîncearcă data viitoare
      }
    };

    const check = () => {
      lastCheck.current = Date.now();
      void checkStore();
      void checkOta();
    };

    // Puțin după pornire, ca să nu se suprapună cu intro-ul.
    const first = setTimeout(check, 4000);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') {
        bgSince.current = Date.now();
        return;
      }
      if (st !== 'active') return;
      const away = bgSince.current ? Date.now() - bgSince.current : 0;
      bgSince.current = null;
      if (otaReady.current && away >= RELOAD_AFTER_BG) {
        void Updates.reloadAsync().catch(() => undefined);
        return;
      }
      if (Date.now() - lastCheck.current >= CHECK_EVERY) check();
    });
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, []);

  if (!need) return null;
  const required = need.kind === 'required';
  const later = () => {
    void storage.set(SNOOZE_KEY, `${need.latest}|${Date.now()}`);
    setNeed(null);
  };
  const store = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

  return (
    <Modal visible transparent={!required} animationType="fade" onRequestClose={required ? () => undefined : later}>
      <View style={[s.wrap, required ? { backgroundColor: colors.bg } : s.dim]}>
        <View style={[s.card, required && s.full]}>
          {required ? <Logo /> : null}
          <Text style={s.title}>{required ? t('upd.requiredTitle') : t('upd.title')}</Text>
          <Text style={[ui.text, { textAlign: 'center', lineHeight: 22 }]}>
            {required ? t('upd.requiredText', { store }) : t('upd.text', { store })}
          </Text>
          {need.message ? <Text style={[ui.muted, { textAlign: 'center' }]}>{need.message}</Text> : null}
          <View style={{ alignSelf: 'stretch', gap: space.sm, marginTop: space.sm }}>
            <Button title={t('upd.button', { store })} onPress={() => void Linking.openURL(need.url).catch(() => undefined)} />
            {required ? null : <Button title={t('upd.later')} variant="ghost" onPress={later} />}
          </View>
          {required ? <Text style={[ui.muted, { textAlign: 'center', fontSize: 12 }]}>{t('upd.autoHint')}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  dim: { backgroundColor: 'rgba(0,0,0,0.6)' },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    alignItems: 'center',
    gap: space.md,
  },
  full: { backgroundColor: 'transparent', borderWidth: 0 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
});
