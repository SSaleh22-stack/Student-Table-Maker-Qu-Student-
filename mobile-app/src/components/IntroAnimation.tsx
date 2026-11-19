import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Logo } from '@/components/Logo';
import { isRTL } from '@/lib/rtl';
import { colors } from '@/lib/theme';

/** Same size as the native splash image (app.json → expo-splash-screen imageWidth), so the hand-off is seamless. */
const LOGO = 96;
/** Space between the logo and the name once they sit side by side. */
const GAP = 16;

const HOLD = 300; // logo alone, as on the splash screen
const MOVE = 650; // logo slides aside
const NAME_DELAY = HOLD + 150; // the name starts coming out once the logo is moving
const NAME_IN = 550;
const SHOW = 1750; // when the whole thing starts fading into the app
const FADE = 350;

const ease = Easing.out(Easing.cubic);

/**
 * Opening animation, played once when the app starts: the logo alone in the middle (exactly what
 * the native splash screen shows), then it slides to the reading-start side (right in Arabic) while
 * "QU Student" comes out from behind it on the other side; then everything fades into the app.
 * With "Reduce Motion" on, the logo and name simply show side by side, then fade.
 */
export function IntroAnimation({ onDone }: { onDone: () => void }) {
  const reduceMotion = useReducedMotion();
  // The name's width decides where both end up, so the animation starts once it is measured.
  const [nameW, setNameW] = useState(0);

  // Logo on the reading-start side: right in Arabic (+1), left in English (-1).
  const side = isRTL ? 1 : -1;
  const logoEnd = (side * (nameW + GAP)) / 2;
  const nameEnd = (-side * (LOGO + GAP)) / 2;

  const logoX = useSharedValue(0);
  const nameX = useSharedValue(0);
  const nameOpacity = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!nameW) return;
    if (reduceMotion) {
      logoX.value = logoEnd;
      nameX.value = nameEnd;
      nameOpacity.value = 1;
    } else {
      // The name starts tucked behind the logo and slides out to its place.
      nameX.value = nameEnd + side * 40;
      logoX.value = withDelay(HOLD, withTiming(logoEnd, { duration: MOVE, easing: ease }));
      nameX.value = withDelay(NAME_DELAY, withTiming(nameEnd, { duration: NAME_IN, easing: ease }));
      nameOpacity.value = withDelay(NAME_DELAY, withTiming(1, { duration: NAME_IN, easing: ease }));
    }
    const fadeAt = reduceMotion ? 700 : SHOW;
    // A plain fade is fine with Reduce Motion, so it always plays (by default Reanimated would skip
    // both the wait and the fade, and the logo and name would never show).
    opacity.value = withDelay(
      fadeAt,
      withTiming(0, { duration: FADE, reduceMotion: ReduceMotion.Never }),
      ReduceMotion.Never,
    );
    const done = setTimeout(onDone, fadeAt + FADE + 30);
    return () => clearTimeout(done);
    // Runs once, when the name has been measured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameW]);

  const screenStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const logoStyle = useAnimatedStyle(() => ({ transform: [{ translateX: logoX.value }] }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ translateX: nameX.value }],
  }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.screen, screenStyle]}
      pointerEvents="auto"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {/* The name, centred, then moved beside the logo. Drawn first so the logo covers it as it slides out. */}
      <View style={styles.center}>
        <Animated.View
          style={nameStyle}
          onLayout={(e) => {
            const w = Math.round(e.nativeEvent.layout.width);
            if (w && !nameW) setNameW(w);
          }}>
          <AppText size={32} weight="bold" color={colors.text} style={styles.name}>
            QU <AppText size={32} weight="bold" color={colors.accent}>Student</AppText>
          </AppText>
        </Animated.View>
      </View>
      <View style={styles.center}>
        <Animated.View style={[styles.logo, logoStyle]}>
          <Logo size={LOGO} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The splash screen's background (app.json → expo-splash-screen backgroundColor)
  screen: { backgroundColor: colors.bg, zIndex: 1000, elevation: 1000 },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  logo: { backgroundColor: colors.bg, borderRadius: 26 },
  name: { lineHeight: 42, writingDirection: 'ltr' },
});
