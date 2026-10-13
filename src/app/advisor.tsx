import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/api';
import type { AdvisorResult, AdvisorStyle } from '@/api/client';
import { mediaUrl } from '@/api/staff';
import { useLoginGate } from '@/components/LoginGate';
import { Button, Empty, Screen, styles as ui } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { pickImage } from '@/lib/pickImage';
import { lei, usePriceLabel } from '@/lib/price';
import { useApp } from '@/state/AppState';
import { colors, radius, space } from '@/theme';

// Consilierul de tunsori: clientul acceptă folosirea pozei, face un selfie (sau alege o poză), iar AI-ul îi recomandă
// 2-4 tunsori concrete, fiecare cu o poză de exemplu, de ce i se potrivește, ce să-i spună frizerului și „Programează”.
// Poza rămâne doar pe telefon; serverul o folosește pentru analiză și n-o păstrează.

export default function Advisor() {
  const { token, business, serviceById, resetDraft, setDraft } = useApp();
  const gate = useLoginGate();
  const { t, lang } = useT();
  const [agreed, setAgreed] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdvisorResult | null>(null);

  if (gate) return gate;
  if (business && !business.advisor) return <Screen edges={['bottom']}><Empty icon="sparkles-outline" text={t('advisor.off')} /></Screen>;

  const start = async (camera: boolean) => {
    setError(null);
    if (!agreed) {
      setError(t('advisor.needConsent'));
      return;
    }
    // Poza se micșorează pe telefon (cât îi trebuie AI-ului), ca să plece repede.
    const uri = await pickImage({ camera, maxPx: 896 }).catch(() => null);
    if (!uri || !token) return;
    setPhoto(uri);
    setResult(null);
    setBusy(true);
    try {
      setResult(await api.advisor(uri, lang, token));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const book = (x: AdvisorStyle) => {
    // Cu serviciul ales de consilier urmează locația, frizerul și ora; fără el, clientul alege serviciul.
    resetDraft();
    if (x.service) setDraft({ serviceId: x.service.id, presetService: true });
    router.push('/book/location');
  };

  const again = () => {
    setResult(null);
    setPhoto(null);
    setError(null);
  };

  return (
    <Screen edges={['bottom']}>
      {!result ? (
        <>
          <View style={s.hero}>
            <View style={s.heroIcon}>
              <Ionicons name="sparkles-outline" size={28} color={colors.gold} />
            </View>
            <Text style={s.title}>{t('advisor.title')}</Text>
            <Text style={[ui.muted, { textAlign: 'center' }]}>{t('advisor.intro')}</Text>
          </View>

          {photo ? <Image source={{ uri: photo }} style={s.preview} accessibilityIgnoresInvertColors /> : null}

          {busy ? (
            <View style={[ui.row, { justifyContent: 'center', paddingVertical: space.md }]}>
              <ActivityIndicator color={colors.gold} />
              <Text style={ui.text}>{t('advisor.busy')}</Text>
            </View>
          ) : (
            <>
              {/* Acordul pentru poză, înainte de orice poză. */}
              <Pressable onPress={() => (setAgreed((v) => !v), setError(null))} style={s.consent} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
                <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={24} color={agreed ? colors.gold : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={ui.text}>{t('advisor.consent')}</Text>
                  <Text style={[ui.muted, { fontWeight: '700', color: agreed ? colors.gold : colors.muted }]}>{t('advisor.agree')}</Text>
                </View>
              </Pressable>
              <Button title={t('advisor.selfie')} onPress={() => start(true)} disabled={!agreed} />
              <Button title={t('advisor.pick')} variant="ghost" onPress={() => start(false)} disabled={!agreed} />
            </>
          )}
          {error ? <Text style={{ color: colors.danger, textAlign: 'center' }}>{error}</Text> : null}
        </>
      ) : (
        <>
          <View style={[ui.row, { alignItems: 'flex-start' }]}>
            {photo ? <Image source={{ uri: photo }} style={s.thumb} /> : null}
            <Text style={[ui.text, { flex: 1, lineHeight: 21 }]}>{result.summary}</Text>
          </View>
          <Text style={ui.section}>{t('advisor.forYou')}</Text>
          {result.styles.map((x) => (
            <StyleCard key={x.key} x={x} onBook={() => book(x)} price={x.service ? serviceById(x.service.id) : undefined} />
          ))}
          <Text style={[ui.muted, { textAlign: 'center', marginTop: space.sm }]}>{t('advisor.note')}</Text>
          <Text style={[ui.muted, { textAlign: 'center' }]}>{t('advisor.left', { n: result.left })}</Text>
          <Button title={t('advisor.again')} variant="ghost" onPress={again} />
        </>
      )}
    </Screen>
  );
}

function StyleCard({ x, onBook, price }: { x: AdvisorStyle; onBook: () => void; price: ReturnType<ReturnType<typeof useApp>['serviceById']> }) {
  const { t } = useT();
  const priceText = usePriceLabel();
  // Prima dată poza de exemplu se generează pe server (câteva secunde), apoi vine imediat.
  const [img, setImg] = useState<'loading' | 'ok' | 'none'>('loading');
  const ex = x.examples[0];
  return (
    <View style={[ui.card, { gap: space.sm }]}>
      <View>
        <View style={s.styleImg}>
          {img !== 'none' ? (
            <Image
              source={{ uri: mediaUrl(x.imageUrl)! }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onLoad={() => setImg('ok')}
              onError={() => setImg('none')}
              accessibilityLabel={x.name}
            />
          ) : null}
          {img === 'loading' ? <ActivityIndicator color={colors.gold} /> : null}
          {img === 'none' ? (
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Ionicons name="cut-outline" size={32} color={colors.muted} />
              <Text style={[ui.muted, { fontSize: 12 }]}>{t('advisor.noImage')}</Text>
            </View>
          ) : null}
        </View>
        {img === 'ok' ? <Text style={[ui.muted, { fontSize: 11, marginTop: 4 }]}>{t('advisor.aiImage')}</Text> : null}
      </View>
      <Text style={ui.cardTitle}>{x.name}</Text>
      {x.reason ? <Text style={[ui.text, { lineHeight: 21 }]}>{x.reason}</Text> : null}
      {x.ask ? (
        <View style={s.ask}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.gold} />
          <View style={{ flex: 1 }}>
            <Text style={[ui.muted, { fontWeight: '700', fontSize: 12 }]}>{t('advisor.ask')}</Text>
            <Text style={[ui.text, { lineHeight: 20 }]}>{x.ask}</Text>
          </View>
        </View>
      ) : null}
      {ex ? (
        <View>
          <View style={s.pair}>
            {[
              { uri: mediaUrl(ex.before)!, label: t('ba.before') },
              { uri: mediaUrl(ex.after)!, label: t('ba.after') },
            ].map((p) => (
              <View key={p.label} style={{ flex: 1 }}>
                <Image source={{ uri: p.uri }} style={{ flex: 1 }} resizeMode="cover" />
                <Text style={s.tag}>{p.label}</Text>
              </View>
            ))}
          </View>
          <Text style={[ui.muted, { fontSize: 12, marginTop: 4 }]}>{t('advisor.examples')}</Text>
        </View>
      ) : null}
      {x.service ? (
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <Text style={[ui.muted, { flex: 1 }]}>
            {x.service.name} · {x.service.durationMin} min
          </Text>
          {/* Prețul ca în lista de servicii (cu „de la” când frizerii au prețuri diferite). */}
          <Text style={ui.price}>{price ? priceText(price) : lei(x.service.price)}</Text>
        </View>
      ) : null}
      <Button title={t('advisor.book')} onPress={onBook} />
    </View>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  heroIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.goldDark, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  preview: { width: 180, height: 225, borderRadius: radius.md, alignSelf: 'center' },
  thumb: { width: 64, height: 80, borderRadius: radius.sm },
  consent: { flexDirection: 'row', gap: space.sm, alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md },
  pair: { flexDirection: 'row', gap: 2, aspectRatio: 8 / 5, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#000' },
  tag: { position: 'absolute', top: 8, left: 8, color: '#fff', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, fontWeight: '800', fontSize: 11 },
  styleImg: { width: '100%', aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  ask: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: space.sm },
});
