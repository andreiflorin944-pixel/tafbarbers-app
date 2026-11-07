import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, styles as ui } from '@/components/ui';
import type { Booking } from '@/data/types';
import { useT } from '@/i18n';
import { formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { colors, radius, space } from '@/theme';

// „Întârzii”: clientul alege cu cât întârzie (și poate scrie o notiță); frizerul și salonul primesc anunț pe telefon,
// iar în panou și în aplicația echipei apare întârzierea la programare.

export const LATE_OPTIONS = [5, 10, 15, 20, 30];
/** Butonul apare cu cel mult 3 ore înainte și până la 30 de minute după ora programării (ca pe server). */
export const canReportLate = (b: Booking, now = Date.now()) => {
  if (b.status !== 'confirmed') return false;
  const left = new Date(b.start).getTime() - now;
  return left <= 3 * 3_600_000 && left >= -30 * 60_000;
};

export function LateSheet({ booking, onClose, onSend }: { booking: Booking; onClose: () => void; onSend: (minutes: number, note: string) => Promise<void> }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [minutes, setMinutes] = useState<number | null>(booking.lateMin ?? null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!minutes) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(minutes, note.trim());
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, s.backdrop]} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={[s.sheet, { paddingBottom: space.xl + insets.bottom }]}>
          <View style={s.handle} />
          {sent ? (
            <View style={{ gap: space.md }}>
              <Text style={s.title}>{t('late.sentTitle')}</Text>
              <Text style={ui.text}>{t('late.sentText', { n: minutes ?? 0, name: booking.barberName ?? '' })}</Text>
              <Button title={t('common.close')} onPress={onClose} />
            </View>
          ) : (
            <View style={{ gap: space.sm }}>
              <Text style={s.title}>{t('late.title')}</Text>
              <Text style={ui.muted}>{t('late.hint', { time: formatTime(new Date(booking.start)) })}</Text>
              <View style={s.options}>
                {LATE_OPTIONS.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMinutes(m)}
                    style={[s.option, minutes === m && s.optionOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: minutes === m }}
                  >
                    <Text style={[s.optionText, minutes === m && { color: colors.onGold }]}>{t('late.min', { n: m })}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={ui.label}>{t('late.note')}</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t('late.notePh')}
                placeholderTextColor={colors.muted}
                style={ui.input}
                maxLength={200}
                returnKeyType="done"
              />
              {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
              <View style={{ marginTop: space.sm, gap: space.sm }}>
                <Button title={t('late.send')} onPress={send} disabled={!minutes} loading={busy} />
                <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: space.md },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: space.md },
  optionOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  optionText: { color: colors.text, fontWeight: '700', fontSize: 15 },
});
