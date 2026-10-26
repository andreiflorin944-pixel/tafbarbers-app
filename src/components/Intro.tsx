import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Platform, StyleSheet, View } from 'react-native';

// Ecranul de pornire nativ rămâne până îl înlocuiește intro-ul, ca să nu clipească nimic între ele.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Aceeași culoare ca fundalul ecranului de pornire din app.json.
const BG = '#0B0B0C';
// Logo-ul (921 × 959) și mustața decupată din el, cu poziția ei în logo.
const LOGO_W = 200;
const LOGO_H = (LOGO_W * 959) / 921;
const MUSTACHE = { left: 249 / 921, top: 189 / 959, width: 347 / 921, height: 253 / 959 };
// Pe Android ecranul nativ arată logo-ul mic, în cerc; pornim de la mărimea aceea și creștem.
const START_SCALE = Platform.OS === 'android' ? 0.49 : 1;

/**
 * Intro-ul animat de la pornire: logo-ul crește, mustața se rotește o dată și se mișcă puțin,
 * apoi totul dispare și rămâne aplicația. Durează cam 2 secunde.
 */
export function Intro() {
  const [done, setDone] = useState(Platform.OS === 'web');
  const scale = useRef(new Animated.Value(START_SCALE)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const started = useRef(false);

  useEffect(() => {
    if (done) void SplashScreen.hideAsync().catch(() => {});
  }, [done]);

  const start = async () => {
    if (started.current) return;
    started.current = true;
    await SplashScreen.hideAsync().catch(() => {});
    const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
    const out = Animated.timing(fade, { toValue: 0, duration: 350, useNativeDriver: true });
    if (reduceMotion) {
      Animated.sequence([Animated.delay(400), out]).start(() => setDone(true));
      return;
    }
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }),
        Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(wiggle, { toValue: 1, duration: 110, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -1, duration: 160, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 110, useNativeDriver: true }),
      ]),
      Animated.delay(250),
      Animated.parallel([
        out,
        Animated.timing(scale, { toValue: 1.15, duration: 350, useNativeDriver: true }),
      ]),
    ]).start(() => setDone(true));
  };

  if (done) return null;
  const rotate = Animated.add(spin, Animated.multiply(wiggle, 0.04)).interpolate({
    inputRange: [-1, 1],
    outputRange: ['-360deg', '360deg'],
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.wrap, { opacity: fade }]} onLayout={() => void start()}>
      <Animated.View style={{ width: LOGO_W, height: LOGO_H, transform: [{ scale }] }}>
        <Image source={require('../../assets/intro-logo.png')} style={StyleSheet.absoluteFill} resizeMode="contain" />
        <View
          style={{
            position: 'absolute',
            left: MUSTACHE.left * LOGO_W,
            top: MUSTACHE.top * LOGO_H,
            width: MUSTACHE.width * LOGO_W,
            height: MUSTACHE.height * LOGO_H,
          }}
        >
          <Animated.Image
            source={require('../../assets/intro-mustache.png')}
            style={{ width: '100%', height: '100%', transform: [{ rotate }] }}
            resizeMode="contain"
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: BG, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
});
