/**
 * A thin progress bar (Figma progressBar: 8 pt, accent on accent-soft) that fills from the READING
 * side: from the right in Arabic, from the left in English. Any fraction above 0 shows at least the
 * bar's height, as in Figma.
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { tr } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';

export interface ProgressBarProps {
  /** 0..1 (clamped). */
  value: number;
  height?: number;
  color?: string;
  trackColor?: string;
  /** Screen-reader name, e.g. 'استيراد الصفحات'. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({ value, height = 8, color = colors.accent, trackColor = colors.accentSoft, label, style }: ProgressBarProps) {
  const frac = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const pct = Math.round(frac * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? tr('التقدم', 'Progress')}
      accessibilityValue={{ min: 0, max: 100, now: pct, text: `${pct}%` }}
      style={[
        { flexDirection: row, height, borderRadius: height / 2, backgroundColor: trackColor, overflow: 'hidden' },
        style,
      ]}>
      {frac > 0 ? (
        <View style={{ width: `${frac * 100}%`, minWidth: height, height, borderRadius: height / 2, backgroundColor: color }} />
      ) : null}
    </View>
  );
}
