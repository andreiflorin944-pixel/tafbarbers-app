import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { mediaUrl } from '@/api/staff';
import { Button } from '@/components/ui';
import type { Promo } from '@/data/types';
import { useT } from '@/i18n';
import { storage } from '@/lib/storage';
import { colors, radius, space } from '@/theme';

const SEEN_KEY = 'taf.seasonSeen';

/**
 * Campania de sezon (Crăciun, Paște...) ca pop-up la intrarea în aplicație, când e bifat în panou.
 * Apare o singură dată pe campanie: o campanie nouă (altă temă, alt titlu, altă perioadă) are alt id și apare din nou.
 */
export function SeasonPopup({ promo, onOpen }: { promo: Promo | undefined; onOpen: (p: Promo) => void }) {
  const { t } = useT();
  const [show, setShow] = useState(false);
  const id = promo?.popup ? promo.id : null;

  useEffect(() => {
    if (!id) return;
    let on = true;
    // Puțin după ce s-a încărcat prima pagină, ca să nu acopere intro-ul.
    const timer = setTimeout(() => {
      storage.get(SEEN_KEY).then((seen) => on && seen !== id && setShow(true));
    }, 1200);
    return () => {
      on = false;
      clearTimeout(timer);
    };
  }, [id]);

  if (!promo || !show) return null;
  const close = () => {
    setShow(false);
    storage.set(SEEN_KEY, promo.id);
  };
  const image = mediaUrl(promo.imageUrl);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={s.backdrop}>
        <View style={s.card}>
          {image ? <Image source={{ uri: image }} style={s.image} resizeMode="cover" accessibilityLabel={promo.title} /> : null}
          <Pressable onPress={close} style={s.close} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={10}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <View style={s.body}>
            {promo.kicker ? <Text style={s.kicker}>{promo.kicker}</Text> : null}
            <Text style={s.title}>{promo.title}</Text>
            {promo.text ? <Text style={s.text}>{promo.text}</Text> : null}
            <Button
              title={promo.cta}
              onPress={() => {
                close();
                onOpen(promo);
              }}
            />
            <Pressable onPress={close} accessibilityRole="button" style={{ alignSelf: 'center', padding: space.sm }}>
              <Text style={s.later}>{t('season.later')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.bgSolid, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.gold, overflow: 'hidden' },
  image: { width: '100%', aspectRatio: 1.6 },
  close: { position: 'absolute', top: 10, right: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.lg, gap: space.sm },
  kicker: { color: colors.gold, fontWeight: '800', letterSpacing: 1.5, fontSize: 12 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  text: { color: colors.muted, fontSize: 15, lineHeight: 21, marginBottom: space.xs },
  later: { color: colors.muted, fontWeight: '600' },
});
