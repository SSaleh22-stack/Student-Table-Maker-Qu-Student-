/**
 * The library tour's welcome card (Figma 24): centred over the dimmed library, 560 pt wide (the window
 * minus 40 on phones), radius 28, padding 32, gap 18.
 *
 *   notebook-pen art (140 pt accent-soft disc, 96 pt white disc, 46 pt icon)
 *   'أهلاً بك في المذكرات' + Beta pill
 *   two lines of text with the step count
 *   [ 'ابدأ الجولة' (primary, play icon) ] [ 'لاحقاً' ]   (stacked full width on compact)
 */
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors, shadow } from '@/lib/theme';
import { stepsPhrase } from '@/notebook/core/tours/steps';
import { nbRadius } from '@/notebook/theme';
import { BetaBadge } from '@/notebook/ui/BetaBadge';
import { PillButton } from '@/notebook/ui/CircleButton';

export interface WelcomeCardProps {
  /** How many tour steps will follow (after renumbering). */
  count: number;
  onStart: () => void;
  onLater: () => void;
  /** Card width (560 on tablets, the window minus 40 on phones). */
  width: number;
  compact: boolean;
}

export function WelcomeCard({ count, onStart, onLater, width, compact }: WelcomeCardProps) {
  const steps = stepsPhrase(count);
  const body = tr(
    `اكتب بالقلم، علّق على ملفات PDF، وسجّل المحاضرة وأنت تكتب.\nخذ جولة سريعة من ${steps.ar} لتعرف مكان كل شيء.`,
    `Write with a pen, mark up PDFs, and record the lecture while you write.\nTake a quick ${Math.max(0, Math.floor(count))}-step tour to see where everything is.`,
  );
  return (
    <View accessibilityViewIsModal style={[styles.card, shadow, { width, padding: compact ? 24 : 32 }]}>
      <View style={styles.artOuter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.artInner, shadow]}>
          <Icon name="notebookPen" size={46} color={colors.accent} />
        </View>
      </View>

      <View style={[styles.titleRow, { flexDirection: row }]}>
        <AppText size={compact ? 22 : 26} weight="bold" align="center" accessibilityRole="header" style={styles.shrink}>
          {tr('أهلاً بك في المذكرات', 'Welcome to Notebook')}
        </AppText>
        <BetaBadge size={13} />
      </View>

      <AppText size={16} color={colors.muted} align="center" style={styles.body}>
        {body}
      </AppText>

      <View style={compact ? styles.buttonsCompact : [styles.buttons, { flexDirection: row }]}>
        <PillButton
          label={tr('ابدأ الجولة', 'Start the tour')}
          icon="play"
          onPress={onStart}
          block={compact}
          style={compact ? null : styles.primary}
        />
        <PillButton label={tr('لاحقاً', 'Later')} variant="neutral" onPress={onLater} block={compact} style={compact ? null : styles.secondary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: nbRadius.modal, gap: 18, alignItems: 'center' },
  artOuter: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artInner: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
  body: { lineHeight: 26 },
  buttons: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  buttonsCompact: { alignSelf: 'stretch', gap: 10 },
  primary: { width: 240 },
  secondary: { width: 160 },
});
