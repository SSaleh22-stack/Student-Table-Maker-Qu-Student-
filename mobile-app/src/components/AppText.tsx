import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { isRTL, textStart } from '@/lib/rtl';
import { colors, fonts, type FontWeightName } from '@/lib/theme';

interface AppTextProps extends TextProps {
  weight?: FontWeightName;
  size?: number;
  color?: string;
  align?: 'start' | 'center' | 'end';
}

/**
 * IBM Plex Sans Arabic draws down to 0.60em below the baseline (the dots under ي, ب, ج), but its
 * line box only reaches 0.415em. With a lineHeight set, Android cuts the text at that box, so the
 * lowest dots come out clipped. This is the extra room the glyphs need below the line box, for a
 * given size and line height (a line height under 1.5em trims the box further).
 */
const androidBottomRoom = (size: number, lineHeight: number) =>
  Math.ceil(size * 0.2 + Math.max(0, size * 1.5 - lineHeight) / 2);

/**
 * Text in IBM Plex Sans Arabic (it covers Latin too). Custom fonts pick their weight by family name
 * (fontWeight doesn't switch files on Android), so weight is a prop here.
 */
export function AppText({
  weight = 'regular',
  size = 14,
  color = colors.text,
  align = 'start',
  style,
  ...props
}: AppTextProps) {
  const textAlign = align === 'center' ? 'center' : align === 'start' ? textStart : textStart === 'right' ? 'left' : 'right';
  let fix = null;
  if (Platform.OS === 'android') {
    const own = StyleSheet.flatten(style) ?? {};
    const room = androidBottomRoom(size, typeof own.lineHeight === 'number' ? own.lineHeight : Math.round(size * 1.5));
    const num = (...v: unknown[]) => (v.find((x) => typeof x === 'number') as number | undefined) ?? 0;
    // Added on top of any bottom padding/margin the caller already set.
    fix = {
      paddingBottom: num(own.paddingBottom, own.paddingVertical, own.padding) + room,
      marginBottom: num(own.marginBottom, own.marginVertical, own.margin) - room,
    };
  }
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: fonts[weight],
          fontSize: size,
          lineHeight: Math.round(size * 1.5),
          color,
          textAlign,
          writingDirection: isRTL ? 'rtl' : 'ltr',
        },
        style,
        // Padding lets the dots draw; the matching negative margin keeps the layout as it was.
        fix,
      ]}
    />
  );
}
