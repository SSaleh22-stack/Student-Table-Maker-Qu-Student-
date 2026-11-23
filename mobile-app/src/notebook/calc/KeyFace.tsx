/**
 * Calculator key faces and printed labels (NB-47a), drawn as in the design's keyFace / mathLabel:
 * - '#frac', '#sqrt', '#int', '#xpow', '#logb' are template faces with little drawn boxes (SVG
 *   slots: outlined = a place to type, filled = the box the key fills in);
 * - a [base, raised] pair is one label with a superscript (x⁻¹, 10ˣ, eˣ, ×10ˣ);
 * - anything else is plain text.
 * Every face reads left to right in both languages (the keypad never mirrors).
 */
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import type { KeyText } from '@/notebook/core/calc/keys/keymap';
import { fonts } from '@/lib/theme';

const LTR = { direction: 'ltr' as const, flexDirection: 'row' as const };

/** A little template box: outlined (to type into) or filled. */
export function Slot({ w, h, filled, color }: { w: number; h: number; filled: boolean; color: string }) {
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {filled ? (
        <Rect x={0} y={0} width={w} height={h} rx={1} fill={color} />
      ) : (
        <Rect x={0.5} y={0.5} width={Math.max(0, w - 1)} height={Math.max(0, h - 1)} rx={1} fill="none" stroke={color} strokeWidth={1} />
      )}
    </Svg>
  );
}

function Glyph({ text, size, color }: { text: string; size: number; color: string }) {
  return (
    <Text allowFontScaling={false} style={[styles.glyph, { fontSize: size, lineHeight: Math.round(size * 1.25), color }]}>
      {text}
    </Text>
  );
}

/** A printed label: text, or [base, raised] with the second part as a superscript. */
export function MathLabel({ label, size, color }: { label: KeyText; size: number; color: string }) {
  if (typeof label === 'string') return <Glyph text={label} size={size} color={color} />;
  const sup = Math.max(6, Math.round(size * 0.62));
  return (
    <View style={[LTR, styles.top, { gap: 1 }]}>
      <Glyph text={label[0]} size={size} color={color} />
      <Glyph text={label[1]} size={sup} color={color} />
    </View>
  );
}

/** The face printed on a key. scale multiplies the design sizes (1 = the 360 pt panel). */
export function KeyFace({ face, size, color, scale = 1 }: { face: KeyText; size: number; color: string; scale?: number }) {
  const u = (n: number) => Math.max(1, Math.round(n * scale * 10) / 10);
  switch (face) {
    case '#frac':
      return (
        <View style={[styles.center, { gap: u(1.5) }]}>
          <Slot w={u(8)} h={u(6)} filled={false} color={color} />
          <View style={{ width: u(11), height: u(1.4), backgroundColor: color }} />
          <Slot w={u(8)} h={u(6)} filled={false} color={color} />
        </View>
      );
    case '#sqrt':
      return (
        <View style={[LTR, styles.middle, { gap: u(1) }]}>
          <Glyph text="√" size={size} color={color} />
          <Slot w={u(7)} h={u(8)} filled={false} color={color} />
        </View>
      );
    case '#int':
      return (
        <View style={[LTR, styles.middle, { gap: u(2) }]}>
          <Glyph text="∫" size={size + 2 * scale} color={color} />
          <View style={{ gap: u(5) }}>
            <Slot w={u(4)} h={u(4)} filled color={color} />
            <Slot w={u(4)} h={u(4)} filled={false} color={color} />
          </View>
          <Slot w={u(8)} h={u(6)} filled color={color} />
        </View>
      );
    case '#xpow':
      return (
        <View style={[LTR, styles.top, { gap: u(1) }]}>
          <Glyph text="x" size={size} color={color} />
          <View style={{ paddingTop: u(2) }}>
            <Slot w={u(5)} h={u(5)} filled color={color} />
          </View>
        </View>
      );
    case '#logb':
      return (
        <View style={[LTR, styles.middle, { gap: u(1) }]}>
          <Glyph text="log" size={size - 1 * scale} color={color} />
          <View style={{ paddingTop: u(6) }}>
            <Slot w={u(4)} h={u(4)} filled color={color} />
          </View>
          <Slot w={u(7)} h={u(8)} filled={false} color={color} />
        </View>
      );
    default:
      return <MathLabel label={face} size={size} color={color} />;
  }
}

/** Plain words for a face, for screen readers. */
export function faceName(face: KeyText): string {
  switch (face) {
    case '#frac': return 'a/b';
    case '#sqrt': return '√';
    case '#int': return '∫';
    case '#xpow': return 'xⁿ';
    case '#logb': return 'log▫';
    default: return typeof face === 'string' ? face : `${face[0]}${face[1]}`;
  }
}

const styles = StyleSheet.create({
  glyph: { fontFamily: fonts.semibold, includeFontPadding: false, textAlign: 'center', writingDirection: 'ltr' },
  center: { alignItems: 'center', justifyContent: 'center' },
  middle: { alignItems: 'center' },
  top: { alignItems: 'flex-start' },
});
