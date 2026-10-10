import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, Share, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { api } from '@/api';
import { useLoginGate } from '@/components/LoginGate';
import { Button, Empty, Screen, styles } from '@/components/ui';
import type { BeforeAfter } from '@/data/types';
import { formatDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { useT } from '@/i18n';
import { colors, radius, space } from '@/theme';

/** Numele de Instagram al salonului, din linkul sau din textul din setări (ex. „@tafbarbers”). */
function handleOf(instagram: string | undefined) {
  const m = (instagram ?? '').trim().match(/(?:instagram\.com\/)?@?([A-Za-z0-9._]+)\/?$/);
  return m ? `@${m[1]}` : '@tafbarbers';
}

// „Tunsorile mele”: pozele înainte/după puse de frizer, gata de pus pe Instagram, cu eticheta salonului pe ele.
export default function BeforeAfterScreen() {
  const { token, business } = useApp();
  const gate = useLoginGate();
  const { t } = useT();
  const [list, setList] = useState<BeforeAfter[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) api.getBeforeAfter(token).then(setList, (e) => setError(errorMessage(e)));
  }, [token]);

  if (gate) return gate;
  if (!list) return <Screen edges={[]}>{error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.gold} />}</Screen>;
  const tag = handleOf(business?.instagram);

  return (
    <Screen edges={['bottom']}>
      {list.length === 0 ? (
        <Empty icon="images-outline" text={t('ba.empty')} />
      ) : (
        <>
          <Text style={[styles.muted, { marginBottom: space.sm }]}>{t('ba.tagUs', { tag })}</Text>
          <View style={{ gap: space.lg }}>
            {list.map((p) => (
              <Pair key={p.id} p={p} tag={tag} shop={business?.name ?? 'TAF Barbers'} token={token} />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

function Pair({ p, tag, shop, token }: { p: BeforeAfter; tag: string; shop: string; token: string | null }) {
  const ref = useRef<View>(null);
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Perechea arătată altor clienți ca exemplu (consilierul AI): clientul vede asta și o poate opri oricând.
  const [example, setExample] = useState(!!p.showExample);
  const [exampleMsg, setExampleMsg] = useState<string | null>(null);

  const stopExample = () => {
    const go = () => {
      if (!token) return;
      setError(null);
      api.hideBeforeAfterExample(token, p.id).then(
        () => {
          setExample(false);
          setExampleMsg(t('ba.exampleStopped'));
        },
        (e) => setError(errorMessage(e)),
      );
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('ba.exampleStopAsk'))) go();
    } else {
      Alert.alert(t('ba.exampleStop'), t('ba.exampleStopAsk'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.yes'), onPress: go },
      ]);
    }
  };

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      if (Platform.OS === 'web' || !(await Sharing.isAvailableAsync())) {
        await Share.share({ message: `${t('ba.shareText', { shop, tag })}\n${p.after}` });
      } else {
        const uri = await captureRef(ref, { format: 'jpg', quality: 0.92, width: 1080 });
        await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: t('ba.shareTitle', { tag }), UTI: 'public.jpeg' });
      }
    } catch (e) {
      setError(errorMessage(e, t('ba.shareFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      {/* Tot ce e în acest chenar devine poza distribuită (format 4:5, cum îl vrea Instagram). */}
      <View ref={ref} collapsable={false} style={{ aspectRatio: 4 / 5, backgroundColor: '#000', borderRadius: radius.md, overflow: 'hidden' }}>
        <View style={{ flex: 1, flexDirection: 'row', gap: 2 }}>
          {[
            { uri: p.before, label: t('ba.before') },
            { uri: p.after, label: t('ba.after') },
          ].map((x) => (
            <View key={x.label} style={{ flex: 1 }}>
              <Image source={{ uri: x.uri }} style={{ flex: 1 }} resizeMode="cover" />
              <Text
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  color: '#fff',
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                  fontWeight: '800',
                  fontSize: 12,
                  letterSpacing: 1,
                }}
              >
                {x.label}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 10, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <Text style={{ color: colors.gold, fontWeight: '900', fontSize: 18, letterSpacing: 2 }}>TAF</Text>
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{tag}</Text>
        </View>
      </View>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={styles.muted}>
          {formatDate(new Date(p.createdAt))}
          {p.barberName ? ` · ${p.barberName}` : ''}
        </Text>
        <Ionicons name="logo-instagram" size={18} color={colors.muted} />
      </View>
      <Button title={t('ba.share')} onPress={share} loading={busy} />
      {example ? (
        <View style={{ gap: 4 }}>
          <Text style={[styles.muted, { fontSize: 13 }]}>{t('ba.example')}</Text>
          <Pressable onPress={stopExample} accessibilityRole="button">
            <Text style={[styles.muted, { fontSize: 13, textDecorationLine: 'underline' }]}>{t('ba.exampleStop')}</Text>
          </Pressable>
        </View>
      ) : null}
      {exampleMsg ? <Text style={{ color: colors.success, fontSize: 13 }}>{exampleMsg}</Text> : null}
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </View>
  );
}
