import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui';
import { checkForUpdate, currentVersion, dismissUpdate, openStore, type UpdateInfo } from '@/lib/appUpdate';
import { isEnglish, tr, useLang } from '@/lib/i18n';
import { colors, radius, shadow } from '@/lib/theme';

/** Check again when the app comes back to the front, but not more often than this. */
const RECHECK_MS = 30 * 60 * 1000;

/**
 * Sits on top of the whole app. A required update covers everything with no way past it;
 * an optional one is a card the student can close with "Later".
 */
export function UpdateGate() {
  useLang(); // re-render the text when the language changes
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const lastCheck = useRef(0);

  const run = useCallback(() => {
    lastCheck.current = Date.now();
    checkForUpdate().then((next) => {
      // A failed check (null) never hides a required screen that is already up.
      setInfo((prev) => (next ? next : prev?.kind === 'required' ? prev : null));
    });
  }, []);

  useEffect(() => {
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastCheck.current > RECHECK_MS) run();
    });
    return () => sub.remove();
  }, [run]);

  const required = info?.kind === 'required';

  // Android back button must not reach the screens under a required update.
  useEffect(() => {
    if (!required) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [required]);

  if (!info) return null;

  const custom = isEnglish() ? info.messageEn : info.messageAr;
  const message =
    custom ||
    (required
      ? tr(
          'هذه النسخة لم تعد مدعومة. حدّث التطبيق لتتمكن من متابعة استخدامه.',
          'This version is no longer supported. Update the app to keep using it.',
        )
      : tr(
          'نسخة جديدة من التطبيق متوفرة، فيها تحسينات وإصلاحات.',
          'A new version of the app is available with improvements and fixes.',
        ));

  const later = () => {
    dismissUpdate(info.latest);
    setInfo(null);
  };

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(150)}
      style={[StyleSheet.absoluteFill, styles.backdrop, required ? styles.backdropSolid : styles.backdropDim]}
      accessibilityViewIsModal>
      <View style={[styles.card, shadow]}>
        <Logo size={56} />
        <AppText size={19} weight="bold" align="center" style={styles.title}>
          {required ? tr('تحديث مطلوب', 'Update required') : tr('تحديث جديد متوفر', 'Update available')}
        </AppText>
        <AppText size={14.5} color={colors.muted} align="center">
          {message}
        </AppText>
        <AppText size={12} color={colors.faint} align="center" style={styles.versions}>
          {tr('نسختك', 'Your version')} {currentVersion()} · {tr('الأحدث', 'Latest')} {info.latest}
        </AppText>
        <Button
          label={tr('تحديث الآن', 'Update now')}
          icon="download"
          onPress={() => openStore(info.storeUrl)}
          style={styles.button}
        />
        {required ? null : (
          <Button label={tr('لاحقاً', 'Later')} variant="ghost" onPress={later} style={styles.button} />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 1000,
  },
  backdropSolid: { backgroundColor: colors.bg },
  backdropDim: { backgroundColor: colors.overlay },
  card: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 18,
  },
  title: { marginTop: 6 },
  versions: { marginTop: 2, marginBottom: 6 },
  button: { alignSelf: 'stretch' },
});
