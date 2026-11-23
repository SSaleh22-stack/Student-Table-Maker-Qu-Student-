/**
 * The LCD status line (NB-47a): P19's indicators in LCD order (S A M STO RCL STAT CMPLX MAT VCT
 * D/R/G FIX SCI Math ▼ ▲, then Dec/Hex/Bin/Oct), plus the menu and screen ▲ ▼ arrows. Always left to
 * right, drawn at the end side of the glass as in the design.
 */
import { StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/lib/theme';

export interface StatusLineProps {
  flags: string[];
  /** Menu or screen has more above / below. */
  more?: { up: boolean; down: boolean };
  color: string;
  /** Font size in pt. */
  size: number;
}

export function StatusLine({ flags, more, color, size }: StatusLineProps) {
  const items = flags.slice();
  if (more) {
    if (more.down && !items.includes('▼')) items.push('▼');
    if (more.up && !items.includes('▲')) items.push('▲');
  }
  return (
    <View style={[styles.row, { height: Math.round(size * 1.3), gap: Math.round(size) }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {items.map((f, i) => (
        <Text key={`${f}-${i}`} allowFontScaling={false} style={[styles.flag, { color, fontSize: size, lineHeight: Math.round(size * 1.3) }]}>
          {f}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { direction: 'ltr', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', overflow: 'hidden' },
  flag: { fontFamily: fonts.medium, includeFontPadding: false, writingDirection: 'ltr' },
});
