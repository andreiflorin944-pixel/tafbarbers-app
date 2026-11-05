import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { api } from '@/api';
import { BonusRow } from '@/components/BonusRow';
import { Button, Card, Screen, styles } from '@/components/ui';
import type { Bonus, SocialLinks } from '@/data/types';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const NETWORKS: Array<[keyof SocialLinks, IconName, string]> = [
  ['facebook', 'logo-facebook', 'Facebook'],
  ['instagram', 'logo-instagram', 'Instagram'],
  ['tiktok', 'logo-tiktok', 'TikTok'],
];

// „Urmărește-ne pe rețele și deblochezi X% reducere la o ședință”: linkurile spre rețele și butonul de deblocare.
// Reducerea e un bonus dat o singură dată pe cont (serverul se asigură de asta); îl arată la plată, ca pe orice bonus.
export default function Social() {
  const { business, user, token, refreshMe } = useApp();
  const { t } = useT();
  const [opened, setOpened] = useState<string[]>([]);
  const [bonus, setBonus] = useState<Bonus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promo = business?.socialPromo;
  const networks = NETWORKS.filter(([k]) => promo?.links[k]);

  if (!promo || !networks.length)
    return (
      <Screen edges={['bottom']}>
        <Text style={styles.muted}>{t('social.off')}</Text>
      </Screen>
    );

  const open = (k: keyof SocialLinks) => {
    setOpened((o) => (o.includes(k) ? o : [...o, k]));
    Linking.openURL(promo.links[k]!).catch(() => undefined);
  };
  const allOpened = networks.every(([k]) => opened.includes(k));
  const locked = promo.requireTaps && !allOpened;
  const claimed = !!bonus || !!user?.socialPromoClaimed;

  const unlock = async () => {
    if (!user || !token) return router.push({ pathname: '/login', params: { next: '/social' } });
    setBusy(true);
    setError(null);
    try {
      const r = await api.claimSocialPromo(token);
      setBonus(r.bonus);
      refreshMe().catch(() => undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Card style={{ alignItems: 'center', gap: space.sm, borderColor: colors.gold }}>
        <Text style={{ color: colors.gold, fontSize: 44, fontWeight: '800' }}>-{promo.percent}%</Text>
        <Text style={[styles.cardTitle, { textAlign: 'center' }]}>{t('social.title')}</Text>
        <Text style={[styles.muted, { textAlign: 'center', lineHeight: 20 }]}>{t('social.text', { n: promo.percent })}</Text>
      </Card>

      <Text style={[styles.label, { marginTop: space.lg }]}>{t('social.step1')}</Text>
      <View style={{ gap: space.sm }}>
        {networks.map(([k, icon, name]) => {
          const done = opened.includes(k);
          return (
            <Pressable
              key={k}
              onPress={() => open(k)}
              accessibilityRole="link"
              style={({ pressed }) => [
                { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: done ? colors.gold : colors.border, backgroundColor: colors.card },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Ionicons name={icon} size={26} color={colors.gold} />
              <Text style={[styles.cardTitle, { flex: 1 }]}>{name}</Text>
              <Text style={{ color: done ? colors.gold : colors.muted, fontWeight: '600' }}>{done ? t('social.opened') : t('social.follow')}</Text>
              <Ionicons name={done ? 'checkmark-circle' : 'open-outline'} size={20} color={done ? colors.gold : colors.muted} />
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.label, { marginTop: space.lg }]}>{t('social.step2')}</Text>
      {claimed ? (
        <View style={{ gap: space.sm }}>
          <Text style={[styles.cardTitle, { color: colors.gold }]}>{t('social.done')}</Text>
          {bonus ? <BonusRow b={bonus} /> : null}
          <Text style={styles.muted}>{t('social.doneText')}</Text>
          <Button title={t('social.seeRewards')} variant="ghost" onPress={() => router.push('/rewards')} />
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Button title={user ? t('social.unlock', { n: promo.percent }) : t('social.login')} onPress={unlock} loading={busy} disabled={locked} />
          {locked ? <Text style={[styles.muted, { textAlign: 'center' }]}>{t('social.tapAll')}</Text> : null}
          {error ? <Text style={{ color: colors.danger, textAlign: 'center' }}>{error}</Text> : null}
          <Text style={[styles.muted, { fontSize: 12, textAlign: 'center' }]}>
            {t('social.once')}
            {promo.validDays ? ` ${t('social.valid', { n: promo.validDays })}` : ''}
          </Text>
        </View>
      )}
    </Screen>
  );
}
