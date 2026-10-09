import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Business } from '@/data/types';
import { useT } from '@/i18n';
import { colors, radius, space } from '@/theme';

WebBrowser.maybeCompleteAuthSession();

export type SocialResult = { provider: 'apple' | 'google'; idToken: string; nonce?: string; name?: string };

/** Butoanele „Continuă cu Apple / Google”. Apple doar pe iPhone; Google doar cu id-urile de client puse pe server. */
export function SocialLogin({ social, busy, onToken }: { social: Business['social']; busy: boolean; onToken: (r: SocialResult) => void }) {
  const { t } = useT();
  const [apple, setApple] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !social?.apple) return;
    AppleAuthentication.isAvailableAsync().then(setApple, () => setApple(false));
  }, [social?.apple]);

  const google = social?.google && (Platform.OS === 'ios' ? social.google.iosClientId : Platform.OS === 'android' ? social.google.androidClientId : social.google.webClientId);
  if (!apple && !google) return null;

  const signInApple = async () => {
    // Nonce: Apple pune în token hash-ul lui, serverul îl compară cu cel trimis de noi (tokenul nu poate fi refolosit).
    const nonce = Crypto.randomUUID();
    const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashed,
      });
      if (!cred.identityToken) return;
      // Apple dă numele doar la prima logare.
      const name = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ');
      onToken({ provider: 'apple', idToken: cred.identityToken, nonce, name: name || undefined });
    } catch (e) {
      if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return;
      throw e;
    }
  };

  return (
    <View style={{ gap: space.sm, marginBottom: space.md }}>
      {apple ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={radius.pill}
          style={{ height: 50, opacity: busy ? 0.5 : 1 }}
          onPress={() => (busy ? undefined : void signInApple().catch(() => undefined))}
        />
      ) : null}
      {google && social?.google ? <GoogleButton cfg={social.google} busy={busy} onToken={onToken} label={t('login.google')} /> : null}
      <View style={local.or}>
        <View style={local.line} />
        <Text style={local.orText}>{t('login.orPhone')}</Text>
        <View style={local.line} />
      </View>
    </View>
  );
}

function GoogleButton({ cfg, busy, onToken, label }: { cfg: NonNullable<Business['social']>['google'] & object; busy: boolean; onToken: (r: SocialResult) => void; label: string }) {
  const [request, response, prompt] = Google.useIdTokenAuthRequest({
    iosClientId: cfg.iosClientId ?? undefined,
    androidClientId: cfg.androidClientId ?? undefined,
    webClientId: cfg.webClientId ?? undefined,
  });
  useEffect(() => {
    if (response?.type !== 'success') return;
    const idToken = response.params.id_token;
    if (idToken) onToken({ provider: 'google', idToken, nonce: request?.nonce });
  }, [response]);
  return (
    <Pressable onPress={() => void prompt()} disabled={!request || busy} style={[local.google, (!request || busy) && { opacity: 0.5 }]} accessibilityRole="button">
      {!request ? <ActivityIndicator color="#111" /> : <Ionicons name="logo-google" size={18} color="#111" />}
      <Text style={local.googleText}>{label}</Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  google: { height: 50, borderRadius: radius.pill, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  googleText: { color: '#111', fontSize: 17, fontWeight: '600' },
  or: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  orText: { color: colors.muted, fontSize: 13 },
});
