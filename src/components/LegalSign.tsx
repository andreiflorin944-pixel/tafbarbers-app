import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api';
import type { LegalSignature } from '@/api/client';
import { Button, styles } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { colors, radius, space } from '@/theme';

type Doc = { title: string; body: string; version?: string; translated?: boolean };

/** Cel puțin 3 litere (aceeași regulă ca pe server). */
const signatureOk = (s: string) => (s.match(/\p{L}/gu) ?? []).length >= 3;

/**
 * Termenii și politica de confidențialitate, de semnat (GDPR art. 7): clientul derulează ambele documente până jos,
 * abia apoi poate bifa că le-a citit și le acceptă, scrie numele ca semnătură și apasă „Semnez”.
 * `onSign` face trimiterea (la contul nou, odată cu crearea lui; altfel separat) și aruncă eroarea, care apare aici.
 */
export function LegalSign({
  visible,
  onSign,
  onClose,
  closeLabel,
  intro,
}: {
  visible: boolean;
  onSign: (s: LegalSignature) => Promise<void>;
  onClose: () => void;
  /** Butonul de jos din stânga: „Înapoi” la contul nou, „Ieși din cont” când semnarea e obligatorie. */
  closeLabel: string;
  /** Textul de sus (ex. „Am actualizat termenii”). */
  intro?: string;
}) {
  const { lang, t } = useT();
  const [docs, setDocs] = useState<{ terms: Doc; privacy: Doc } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [read, setRead] = useState(false);
  const [agree, setAgree] = useState(false);
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setDocs(null);
    setLoadError(false);
    setRead(false);
    setAgree(false);
    setError(null);
    Promise.all([api.getLegal('terms', lang), api.getLegal('privacy', lang)]).then(
      ([terms, privacy]) => setDocs({ terms, privacy }),
      () => setLoadError(true),
    );
  }, [visible, lang, attempt]);

  const sign = async () => {
    if (!docs?.terms.version || !docs.privacy.version) return;
    setBusy(true);
    setError(null);
    try {
      await onSign({ signature: signature.replace(/\s+/g, ' ').trim(), termsVersion: docs.terms.version, privacyVersion: docs.privacy.version });
    } catch (e) {
      // Documentele s-au schimbat cât le citea: le încărcăm din nou, de citit de la capăt.
      if ((e as { code?: string })?.code === 'legal_changed') setAttempt((n) => n + 1);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = read && agree && signatureOk(signature);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={local.head}>
            <Text style={local.title}>{t('sign.title')}</Text>
            <Text style={[styles.muted, { fontSize: 13 }]}>{intro ?? t('sign.intro')}</Text>
          </View>
          {loadError ? (
            <View style={{ padding: space.md, gap: space.md }}>
              <Text style={styles.muted}>{t('legal.loadFailed')}</Text>
              <Button title={t('sign.retry')} variant="ghost" onPress={() => setAttempt((n) => n + 1)} />
            </View>
          ) : !docs ? (
            <ActivityIndicator color={colors.gold} style={{ marginTop: space.xl }} />
          ) : (
            <ScrollView
              style={local.doc}
              contentContainerStyle={{ padding: space.md, gap: space.sm }}
              scrollEventThrottle={100}
              onScroll={({ nativeEvent: n }) => {
                if (n.layoutMeasurement.height + n.contentOffset.y >= n.contentSize.height - 40) setRead(true);
              }}
              onContentSizeChange={(_, h) => {
                // Textul scurt care încape fără derulare (nu se întâmplă cu documentele reale) se socotește citit.
                if (h > 0 && h < 400) setRead(true);
              }}
            >
              {docs.terms.translated ? <Text style={[styles.muted, { fontSize: 12 }]}>{t('legal.translated')}</Text> : null}
              <Text style={local.docTitle}>{docs.terms.title}</Text>
              <Text style={local.body}>{docs.terms.body}</Text>
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.md }} />
              <Text style={local.docTitle}>{docs.privacy.title}</Text>
              <Text style={local.body}>{docs.privacy.body}</Text>
              <Text style={[styles.muted, { textAlign: 'center', marginTop: space.md }]}>{t('sign.end')}</Text>
            </ScrollView>
          )}
          <View style={local.foot}>
            {!read ? <Text style={[styles.muted, { fontSize: 13, textAlign: 'center' }]}>{t('sign.scroll')}</Text> : null}
            <Pressable
              onPress={() => read && setAgree((a) => !a)}
              disabled={!read}
              style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', opacity: read ? 1 : 0.4 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agree, disabled: !read }}
              accessibilityLabel={t('sign.agree')}
            >
              <Ionicons name={agree ? 'checkbox' : 'square-outline'} size={22} color={agree ? colors.gold : colors.muted} />
              <Text style={[styles.text, { flex: 1, fontSize: 14, lineHeight: 20 }]}>{t('sign.agree')}</Text>
            </Pressable>
            <TextInput
              value={signature}
              onChangeText={setSignature}
              editable={read && agree}
              placeholder={t('sign.placeholder')}
              placeholderTextColor={colors.muted}
              autoCapitalize="words"
              autoComplete="name"
              maxLength={120}
              style={[local.input, { opacity: read && agree ? 1 : 0.4 }]}
              accessibilityLabel={t('sign.placeholder')}
            />
            {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button title={closeLabel} variant="ghost" onPress={onClose} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={t('sign.submit')} disabled={!ready} loading={busy} onPress={sign} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const local = StyleSheet.create({
  head: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm, gap: 4 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  doc: { flex: 1, marginHorizontal: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card },
  docTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  foot: { padding: space.md, gap: space.sm },
  input: {
    backgroundColor: colors.cardAlt,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
    fontStyle: 'italic',
  },
});
