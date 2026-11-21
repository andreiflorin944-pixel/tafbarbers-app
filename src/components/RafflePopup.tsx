import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import type { RaffleWin } from '@/data/types';
import { useT } from '@/i18n';
import { storage } from '@/lib/storage';
import { colors, radius, space } from '@/theme';

const SEEN_KEY = 'taf.raffleSeen';

/** „Felicitări! Ai câștigat la tombolă”: o singură dată pentru fiecare premiu încă de ridicat. Nu se trimite niciun mesaj; îl vede la intrarea în aplicație. */
export function RafflePopup({ wins }: { wins: RaffleWin[] | undefined }) {
  const { t } = useT();
  const [win, setWin] = useState<RaffleWin | null>(null);
  const fresh = (wins ?? []).find((w) => w.status === 'active');
  const id = fresh?.id ?? null;

  useEffect(() => {
    if (!id || !fresh) return;
    let on = true;
    const timer = setTimeout(() => {
      storage.get(SEEN_KEY).then((seen) => on && !(seen ?? '').split(',').includes(id) && setWin(fresh));
    }, 1500);
    return () => {
      on = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!win) return null;
  const close = () => {
    setWin(null);
    storage.get(SEEN_KEY).then((seen) => storage.set(SEEN_KEY, [...(seen ?? '').split(',').filter(Boolean).slice(-20), win.id].join(',')));
  };
  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <Pressable onPress={close} style={s.close} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
          <Text style={{ fontSize: 54, textAlign: 'center' }}>🎉</Text>
          <Text style={s.title}>{t('raffle.won')}</Text>
          <Text style={s.prize}>{win.prize}</Text>
          <Text style={s.text}>{t('raffle.wonText', { prize: win.prize })}</Text>
          <Button
            title={t('raffle.see')}
            onPress={() => {
              close();
              router.push('/raffle');
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.bgSolid, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.gold, padding: space.lg, gap: space.sm },
  close: { position: 'absolute', top: 10, right: 10, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  prize: { color: colors.gold, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  text: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: space.xs },
});
