import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet } from 'react-native';
import { colors } from '@/theme';

/** Lumânarea de pe programările făcute de ziua clientului. */
export function Candle({ size = 16 }: { size?: number }) {
  return <MaterialCommunityIcons name="candle" size={size} color={colors.gold} accessibilityLabel="Ziua de naștere a clientului" />;
}

/** Chenar auriu care pulsează peste un card (programare de ziua clientului). Se pune ca ultim copil, cu părintele `position: relative`. */
export function BirthdayGlow({ radius = 10 }: { radius?: number }) {
  const v = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(v, { toValue: 0.25, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderWidth: 2, borderColor: colors.gold, borderRadius: radius, opacity: v }]} />;
}
