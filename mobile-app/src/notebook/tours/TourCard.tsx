/**
 * The tour step card (Figma tourCard): white, radius 22, padding 18, gap 14, 352 pt wide.
 *
 *   [ 'N من M' pill ............................. 'تخطي الجولة' ]
 *   [ title 19 bold                                              ]
 *   [ body 15 muted, line height 24                               ]
 *   [ progress dots ............................ 'التالي' → / 'تم، لنبدأ' ]
 *
 * Rows start on the reading side. The last step has no skip link and its button reads 'تم، لنبدأ'.
 */
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors, shadow } from '@/lib/theme';
import { stepCountLabel } from '@/notebook/core/tours/steps';
import { nbRadius } from '@/notebook/theme';

import { tourText } from './stepText';

export interface TourCardProps {
  number: number;
  total: number;
  title: string;
  body: string;
  last: boolean;
  onNext: () => void;
  onSkip: () => void;
  width: number;
  onLayout?: (e: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
}

function Dots({ number, total }: { number: number; total: number }) {
  return (
    <View style={[styles.dots, { flexDirection: row }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[styles.dot, i === number - 1 ? { width: 18, backgroundColor: colors.accent } : { width: 7, backgroundColor: colors.borderStrong }]}
        />
      ))}
    </View>
  );
}

export function TourCard({ number, total, title, body, last, onNext, onSkip, width, onLayout, style }: TourCardProps) {
  const count = stepCountLabel(number, total);
  const countText = tr(count.ar, count.en);
  const nextLabel = last ? tourText.finish() : tourText.next();
  return (
    <View onLayout={onLayout} accessibilityViewIsModal style={[styles.card, shadow, { width }, style]}>
      <View style={[styles.line, { flexDirection: row }]}>
        <View style={styles.pill}>
          <AppText size={12} weight="semibold" color={colors.accentDark}>
            {countText}
          </AppText>
        </View>
        <View style={styles.flex} />
        {last ? null : (
          <Pressable onPress={onSkip} hitSlop={10} accessibilityRole="button" accessibilityLabel={tourText.skip()}>
            {({ pressed }) => (
              <AppText size={14} weight="semibold" color={colors.faint} style={pressed ? styles.pressed : null}>
                {tourText.skip()}
              </AppText>
            )}
          </Pressable>
        )}
      </View>

      <View style={styles.texts} accessible accessibilityLabel={`${countText}. ${title}. ${body}`}>
        <AppText size={19} weight="bold" accessibilityRole="header">
          {title}
        </AppText>
        <AppText size={15} color={colors.muted} style={styles.body}>
          {body}
        </AppText>
      </View>

      <View style={[styles.line, { flexDirection: row }]}>
        <Dots number={number} total={total} />
        <View style={styles.flex} />
        <Pressable
          onPress={onNext}
          accessibilityRole="button"
          accessibilityLabel={nextLabel}
          style={({ pressed }) => [styles.next, { flexDirection: row }, pressed && styles.pressed]}>
          <AppText size={15} weight="bold" color="#FFFFFF" numberOfLines={1}>
            {nextLabel}
          </AppText>
          {last ? null : <Icon name="forward" size={16} color="#FFFFFF" />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: nbRadius.card, padding: 18, gap: 14 },
  line: { alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  pill: { backgroundColor: colors.accentTint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  texts: { gap: 6 },
  body: { lineHeight: 24 },
  dots: { alignItems: 'center', gap: 5 },
  dot: { height: 7, borderRadius: 4 },
  next: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  pressed: { opacity: 0.85 },
});
