import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, styles as ui } from '@/components/ui';
import type { Booking } from '@/data/types';
import { useT } from '@/i18n';
import { formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { colors, radius, space } from '@/theme';

// Mesaj către frizer: clientul scrie despre programare („Întârzii 10 minute, sunt în trafic”) și, cu cel mult 3 ore înainte,
// poate alege și cu cât întârzie. Frizerul și salonul primesc notificare pe telefon cu textul lui, iar mesajul apare
// la programare în panou și în aplicația echipei.

export const LATE_OPTIONS = [5, 10, 15, 20, 30];
/** Mesajul se poate trimite la o programare confirmată, până la 30 de minute după oră (ca pe server). */
export const canMessage = (b: Booking, now = Date.now()) => b.status === 'confirmed' && new Date(b.start).getTime() - now >= -30 * 60_000;
/** „Întârzii X min” se poate alege cu cel mult 3 ore înainte. */
const canPickLate = (b: Booking, now = Date.now()) => new Date(b.start).getTime() - now <= 3 * 3_600_000;

export function LateSheet({ booking, onClose, onSend }: { booking: Booking; onClose: () => void; onSend: (minutes: number | null, note: string) => Promise<void> }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!minutes && !note.trim()) return;
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
              <Text style={ui.text}>{t('late.sentText', { name: booking.barberName ?? '' })}</Text>
              <Button title={t('common.close')} onPress={onClose} />
            </View>
          ) : (
            <View style={{ gap: space.sm }}>
              <Text style={s.title}>{t('late.title', { name: booking.barberName ?? '' })}</Text>
              <Text style={ui.muted}>{t('late.hint', { time: formatTime(new Date(booking.start)) })}</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t('late.notePh')}
                placeholderTextColor={colors.muted}
                style={[ui.input, { height: 96, paddingTop: 12, textAlignVertical: 'top' }]}
                maxLength={300}
                multiline
                autoFocus
              />
              {canPickLate(booking) ? <Text style={ui.label}>{t('late.pick')}</Text> : null}
              <View style={[s.options, !canPickLate(booking) && { display: 'none' }]}>
                {LATE_OPTIONS.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMinutes(minutes === m ? null : m)}
                    style={[s.option, minutes === m && s.optionOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: minutes === m }}
                  >
                    <Text style={[s.optionText, minutes === m && { color: colors.onGold }]}>{t('late.min', { n: m })}</Text>
                  </Pressable>
                ))}
              </View>
              {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
              <View style={{ marginTop: space.sm, gap: space.sm }}>
                <Button title={t('late.send')} onPress={send} disabled={!minutes && !note.trim()} loading={busy} />
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
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: space.md },
  optionOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  optionText: { color: colors.text, fontWeight: '700', fontSize: 15 },
});
