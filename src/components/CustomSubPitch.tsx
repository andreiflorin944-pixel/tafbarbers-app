import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '@/api';
import { Card, styles } from '@/components/ui';
import type { CustomSubHint, CustomSubItem } from '@/data/types';
import { useT } from '@/i18n';
import { lei } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

// Promovarea abonamentului personalizat, în momentele în care clientul e cel mai dispus să-l cumpere:
// imediat după o programare (cu serviciul tocmai ales) și pe Acasă, pentru cei care au venit des în ultima lună.

const itemsParam = (items: CustomSubItem[]) => items.map((i) => `${i.serviceId}:${i.qty}`).join(',');

/** Cardul cu economia; apăsat, deschide „Creează-ți abonamentul” cu aceleași servicii deja puse. */
function PitchCard({ title, text, items, onOpen }: { title: string; text: string; items: CustomSubItem[]; onOpen?: () => void }) {
  const { t } = useT();
  return (
    <Pressable
      onPress={() => {
        onOpen?.();
        router.push({ pathname: '/custom-sub', params: { items: itemsParam(items) } });
      }}
      accessibilityRole="button"
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: colors.gold }}>
        <Ionicons name="ribbon" size={28} color={colors.gold} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={[styles.muted, { fontSize: 13 }]}>{text}</Text>
          <Text style={{ color: colors.gold, fontWeight: '700', marginTop: 2 }}>{t('customSub.cta')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Card>
    </Pressable>
  );
}

/** După programare: „Vii des? Cu 4 × Skin Fade pe lună plătești 238 lei în loc de 280”. Nu apare celor cu abonament activ. */
export function AfterBookingPitch({ serviceId, onOpen }: { serviceId: string; onOpen?: () => void }) {
  const { token, serviceById } = useApp();
  const { t } = useT();
  const [offer, setOffer] = useState<{ qty: number; price: number; full: number } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const cfg = await api.getCustomSub();
        if (!cfg.enabled || (cfg.serviceIds.length && !cfg.serviceIds.includes(serviceId))) return;
        if (token) {
          const subs = await api.getSubscriptions(token);
          if (subs.subscriptions.some((s) => s.state === 'active' || s.state === 'upcoming')) return;
        }
        const q = await api.quoteCustomSub([{ serviceId, qty: cfg.maxVisits }]);
        if (live && q.fullPrice > q.price) setOffer({ qty: q.visits, price: q.price, full: q.fullPrice });
      } catch {
        // Fără ofertă dacă ceva nu merge: ecranul de confirmare rămâne la fel.
      }
    })();
    return () => {
      live = false;
    };
  }, [serviceId, token]);
  if (!offer) return null;
  return (
    <PitchCard
      title={t('customSub.afterTitle')}
      text={t('customSub.afterText', { n: offer.qty, name: serviceById(serviceId)?.name ?? '', price: lei(offer.price), full: lei(offer.full) })}
      items={[{ serviceId, qty: offer.qty }]}
      onOpen={onOpen}
    />
  );
}

/** Pe Acasă, pentru clienții fideli: „Luna asta ai venit de 3 ori. Cu abonament economiseai 18 lei.” */
export function LoyalPitch() {
  const { token } = useApp();
  const { t } = useT();
  const [hint, setHint] = useState<CustomSubHint | null>(null);
  useEffect(() => {
    if (!token) return setHint(null);
    let live = true;
    api.customSubHint(token).then(
      (h) => live && setHint(h),
      () => live && setHint(null),
    );
    return () => {
      live = false;
    };
  }, [token]);
  if (!hint) return null;
  return (
    <View style={{ marginTop: space.md }}>
      <PitchCard title={t('customSub.loyalTitle', { n: hint.visits })} text={t('customSub.loyalText', { amount: lei(hint.save), price: lei(hint.price) })} items={hint.items} />
    </View>
  );
}
