import { Text, type TextProps } from 'react-native';

import { isRTL, textStart } from '@/lib/rtl';
import { colors, fonts, type FontWeightName } from '@/lib/theme';

interface AppTextProps extends TextProps {
  weight?: FontWeightName;
  size?: number;
  color?: string;
  align?: 'start' | 'center' | 'end';
}

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
      ]}
    />
  );
}
