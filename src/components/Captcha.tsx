import { createElement, useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { apiUrl } from "@/api";
import { useT } from "@/i18n";
import { useApp } from "@/state/AppState";

// Verificarea „nu sunt robot” (Cloudflare Turnstile) înainte de trimiterea unui cod pe SMS sau e-mail.
// Apare doar după ce proprietarul pune cheile în Panou → Setări → Protecție anti-robot. De obicei se bifează singură
// în 1-2 secunde; rareori cere o atingere. Fiecare bifă merge pentru un singur cod, apoi se reface.

type Msg = { type: "token"; token: string } | { type: "expired" } | { type: "error" };

function parse(data: unknown): Msg | null {
  try {
    const m = JSON.parse(String(data)) as Msg;
    return m && typeof m.type === "string" ? m : null;
  } catch {
    return null;
  }
}

function CaptchaBox({ onToken }: { onToken: (t: string | null) => void }) {
  const { lang } = useT();
  const uri = `${apiUrl}/v1/captcha?lang=${lang}&theme=dark`;
  const onMsg = (m: Msg | null) => {
    if (!m) return;
    onToken(m.type === "token" ? m.token : null);
  };

  // Versiunea web (rar folosită): aceeași pagină într-un iframe.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const h = (e: MessageEvent) => {
      if (apiUrl && !apiUrl.startsWith(e.origin)) return;
      onMsg(parse(e.data));
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ height: 70, marginTop: 12, overflow: "hidden" }}>
      {Platform.OS === "web" ? (
        createElement("iframe", { src: uri, style: { border: 0, width: "100%", height: 70, background: "transparent" }, title: "captcha" })
      ) : (
        <WebView
          source={{ uri }}
          style={{ backgroundColor: "transparent" }}
          containerStyle={{ backgroundColor: "transparent" }}
          scrollEnabled={false}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          onMessage={(e: WebViewMessageEvent) => onMsg(parse(e.nativeEvent.data))}
          onError={() => onToken(null)}
        />
      )}
    </View>
  );
}

/**
 * `element` se pune deasupra butonului care trimite codul; `token` se trimite la server, iar după fiecare cerere
 * (reușită sau nu) se cheamă `reset()`, pentru o bifă nouă. Fără cheie în panou: nimic de afișat, `ready` e mereu adevărat.
 */
export function useCaptcha() {
  const { business } = useApp();
  const siteKey = business?.captchaSiteKey ?? null;
  const [token, setToken] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setRound((n) => n + 1);
  }, []);
  return {
    required: !!siteKey,
    ready: !siteKey || !!token,
    token: siteKey && token ? token : undefined,
    reset,
    element: siteKey ? <CaptchaBox key={round} onToken={setToken} /> : null,
  };
}
