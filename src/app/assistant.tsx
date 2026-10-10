import { Ionicons } from '@expo/vector-icons';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import type { AssistantMsg, AssistantProposal } from '@/api/client';
import { Button } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { lei } from '@/lib/price';
import { say, stopSpeaking } from '@/lib/voice';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

// Asistentul TAF: clientul scrie sau vorbește, asistentul răspunde și poate propune o programare,
// pe care clientul o confirmă cu un buton (aceeași programare ca din pașii obișnuiți).

type Item = AssistantMsg & { proposal?: AssistantProposal; booked?: boolean };


export default function Assistant() {
  const { token, addBooking, locations, business } = useApp();
  const { lang, t } = useT();
  const tx = {
    hello: t('assist.hello'),
    examples: [t('assist.ex1'), t('assist.ex2'), t('assist.ex3')],
    placeholder: t('assist.placeholder'),
    listening: t('assist.listening'),
    confirm: t('assist.confirm'),
    booked: t('assist.booked'),
    login: t('assist.login'),
    voice: t('assist.voice'),
    micDenied: t('assist.micDenied'),
  };
  const [items, setItems] = useState<Item[]>([{ role: 'assistant', content: tx.hello }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [speak, setSpeak] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => stopSpeaking, []);
  // Altă limbă înainte de prima întrebare: salutul se schimbă și el.
  useEffect(() => {
    setItems((x) => (x.length === 1 && x[0].role === 'assistant' ? [{ role: 'assistant', content: tx.hello }] : x));
  }, [tx.hello]);
  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  }, [items, busy]);

  const send = async (text: string, viaVoice = false) => {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    setInput('');
    const next: Item[] = [...items, { role: 'user', content }];
    setItems(next);
    setBusy(true);
    try {
      // Mesajul de bun venit nu e trimis; restul conversației da, ca asistentul să știe contextul.
      const history = next.slice(1).map(({ role, content: c }) => ({ role, content: c }));
      const r = await api.assistant({ messages: history, lang }, token);
      setItems((x) => [...x, { role: 'assistant', content: r.reply, proposal: r.proposal }]);
      if (speak || viaVoice) void say(r.reply, lang);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = async () => {
    setError(null);
    if (recording) {
      setRecording(false);
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) return;
        setBusy(true);
        const { text } = await api.assistantVoice(uri, lang, token);
        setBusy(false);
        if (text) {
          setSpeak(true);
          await send(text, true);
        }
      } catch (e) {
        setBusy(false);
        setError(errorMessage(e));
      }
      return;
    }
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError(tx.micDenied);
      return;
    }
    stopSpeaking();
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  };

  const confirm = async (i: number, p: AssistantProposal) => {
    if (!token) {
      setItems((x) => [...x, { role: 'assistant', content: tx.login }]);
      router.push('/login');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const b = await api.createBooking(token, { serviceId: p.serviceId, barberId: p.barberId, start: p.start });
      addBooking(b);
      setItems((x) => [...x.map((it, j) => (j === i ? { ...it, booked: true } : it)), { role: 'assistant', content: tx.booked }]);
      if (speak) void say(tx.booked, lang);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scroll} contentContainerStyle={s.list}>
        {items.map((m, i) => (
          <View key={i} style={[s.bubble, m.role === 'user' ? s.me : s.bot]}>
            <Text style={m.role === 'user' ? s.meText : s.botText}>{m.content}</Text>
            {m.proposal ? (
              <View style={s.proposal}>
                <Text style={s.propTitle}>{m.proposal.serviceName}</Text>
                <Text style={s.propLine}>
                  {m.proposal.barberName} · {m.proposal.when}
                </Text>
                {/* Locația apare doar când salonul are mai multe. */}
                {m.proposal.locationName && locations.length > 1 ? <Text style={s.propLine}>{m.proposal.locationName}</Text> : null}
                <Text style={s.propLine}>{lei(m.proposal.price)}</Text>
                {m.booked ? (
                  <Text style={[s.propLine, { color: colors.gold, fontWeight: '700' }]}>✓</Text>
                ) : (
                  <View style={{ marginTop: space.sm }}>
                    <Button title={tx.confirm} onPress={() => m.proposal && confirm(i, m.proposal)} loading={busy} />
                  </View>
                )}
              </View>
            ) : null}
          </View>
        ))}
        {items.length === 1 ? (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            {tx.examples.map((e) => (
              <Pressable key={e} onPress={() => send(e)} style={s.example} accessibilityRole="button">
                <Text style={{ color: colors.text }}>{e}</Text>
              </Pressable>
            ))}
            {/* Consilierul de tunsori (cu o poză), când e pornit în panou. */}
            {business?.advisor ? (
              <Pressable onPress={() => router.push('/advisor')} style={[s.example, { flexDirection: 'row', alignItems: 'center', gap: 6, borderColor: colors.goldDark }]} accessibilityRole="button">
                <Ionicons name="camera-outline" size={16} color={colors.gold} />
                <Text style={{ color: colors.text }}>{t('advisor.assistChip')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {busy ? <ActivityIndicator color={colors.gold} style={{ alignSelf: 'flex-start', marginTop: space.sm }} /> : null}
        {error ? <Text style={{ color: colors.danger, marginTop: space.sm }}>{error}</Text> : null}
      </ScrollView>

      <Pressable onPress={() => (setSpeak((v) => !v), stopSpeaking())} style={s.voiceToggle} accessibilityRole="switch" accessibilityState={{ checked: speak }}>
        <Ionicons name={speak ? 'volume-high' : 'volume-mute'} size={16} color={speak ? colors.gold : colors.muted} />
        <Text style={{ color: speak ? colors.gold : colors.muted, fontSize: 12 }}>{tx.voice}</Text>
      </Pressable>
      <View style={s.bar}>
        {business?.advisor && !recording ? (
          <Pressable onPress={() => router.push('/advisor')} style={s.camera} accessibilityRole="button" accessibilityLabel={t('advisor.title')} disabled={busy}>
            <Ionicons name="camera-outline" size={22} color={colors.gold} />
          </Pressable>
        ) : null}
        {recording ? (
          <Text style={[s.input, { color: colors.gold, paddingTop: 12 }]}>{tx.listening}</Text>
        ) : (
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={tx.placeholder}
            placeholderTextColor={colors.muted}
            style={s.input}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
            editable={!busy}
          />
        )}
        {input.trim() && !recording ? (
          <Pressable onPress={() => send(input)} style={s.round} accessibilityRole="button" accessibilityLabel={t('assist.send')}>
            <Ionicons name="send" size={20} color={colors.onGold} />
          </Pressable>
        ) : (
          <Pressable onPress={toggleMic} style={[s.round, recording && { backgroundColor: colors.danger }]} accessibilityRole="button" accessibilityLabel={t('assist.mic')} disabled={busy && !recording}>
            <Ionicons name={recording ? 'stop' : 'mic'} size={22} color={colors.onGold} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  list: { padding: space.md, paddingBottom: space.lg, gap: space.sm, width: '100%', maxWidth: 720, alignSelf: 'center' },
  bubble: { maxWidth: '86%', borderRadius: radius.lg, padding: space.md },
  me: { alignSelf: 'flex-end', backgroundColor: colors.gold },
  bot: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  meText: { color: colors.onGold, fontSize: 15, lineHeight: 21 },
  botText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  proposal: { marginTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm, gap: 2 },
  propTitle: { color: colors.text, fontWeight: '800', fontSize: 15 },
  propLine: { color: colors.muted, fontSize: 14 },
  example: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  voiceToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 4 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  input: { flex: 1, minHeight: 46, borderRadius: 23, backgroundColor: colors.card, color: colors.text, paddingHorizontal: 16, fontSize: 15 },
  round: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  camera: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
});
