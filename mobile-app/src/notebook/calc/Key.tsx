/**
 * One calculator key (NB-47a), as the design's cKey: the printed second-function labels above the
 * key (gold SHIFT meaning at the left, pink ALPHA or blue BASE-N meaning at the right; a lone gold
 * label is centered), then the key itself with a hard drop shadow. Round keys (SHIFT, ALPHA, MODE,
 * ON) are a 24 pt circle under their caption.
 *
 * Keys fire on release. A key with repeat (DEL) repeats while held.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { KEY_LABELS } from '@/notebook/core/calc/keys/keymap';
import type { KeyId } from '@/notebook/core/calc/types';
import { CALC_COLORS, nbRadius } from '@/notebook/theme';
import { tr } from '@/lib/i18n';
import { fonts } from '@/lib/theme';

import { KeyFace, MathLabel, faceName } from './KeyFace';

const LTR_ROW = { direction: 'ltr' as const, flexDirection: 'row' as const };
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 90;

/** Press, and repeat while held (when repeat is set). */
export function useKeyPress(onFire: () => void, repeat: boolean) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fire = useRef(onFire);
  useLayoutEffect(() => {
    fire.current = onFire;
  });
  const stop = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => stop, []);
  return {
    onPress: () => fire.current(),
    onLongPress: repeat
      ? () => {
          fire.current();
          stop();
          timer.current = setInterval(() => fire.current(), REPEAT_EVERY_MS);
        }
      : undefined,
    onPressOut: stop,
    delayLongPress: REPEAT_DELAY_MS,
  };
}

function a11yHint(id: KeyId): string | undefined {
  const k = KEY_LABELS[id];
  const parts: string[] = [];
  const text = (t: unknown) => (typeof t === 'string' ? t : Array.isArray(t) ? `${t[0]}${t[1]}` : '');
  if (k.shift) parts.push(`SHIFT: ${text(k.shift)}`);
  if (k.alpha) parts.push(`ALPHA: ${text(k.alpha)}`);
  if (k.blue) parts.push(`BASE-N: ${k.blue}`);
  return parts.length ? parts.join('، ') : undefined;
}

export interface KeyProps {
  id: KeyId;
  /** Column width (the key's width). */
  width: number;
  /** Height of the key body (labels excluded). */
  keyHeight: number;
  /** Height of the label row above the key. */
  labelHeight: number;
  /** Design scale (1 = the 360 pt panel). */
  scale: number;
  onPress(id: KeyId): void;
  repeat?: boolean;
}

/** A function or number key with its labels. */
export function Key({ id, width, keyHeight, labelHeight, scale, onPress, repeat = false }: KeyProps) {
  const k = KEY_LABELS[id];
  const num = k.kind === 'num';
  const fill = num ? (k.green ? CALC_COLORS.green : CALC_COLORS.num) : CALC_COLORS.fn;
  const faceColor = num ? CALC_COLORS.numText : CALC_COLORS.fnText;
  const size = (num ? (k.small ? 14 : 19) : k.small ? 10 : 12) * scale;
  const labelSize = 8 * Math.min(1.15, Math.max(0.9, scale));
  const radius = (num ? nbRadius.calcNumKey : nbRadius.calcFnKey) * Math.min(1, scale);
  const handlers = useKeyPress(() => onPress(id), repeat);
  const [down, setDown] = useState(false);
  // FRAC's gold label is empty in the design: nothing is printed.
  const gold = k.shift ? k.shift : null;
  const right = k.alpha ? { t: k.alpha, c: CALC_COLORS.pink } : k.blue ? { t: k.blue, c: CALC_COLORS.blue } : null;
  const hasGold = gold !== null;
  return (
    <View style={{ width, gap: 2 }}>
      <View style={[LTR_ROW, styles.labels, { height: labelHeight, justifyContent: hasGold && !right ? 'center' : 'space-between' }]}>
        {gold !== null ? <MathLabel label={gold} size={labelSize} color={CALC_COLORS.gold} /> : <View />}
        {right ? <MathLabel label={right.t} size={labelSize} color={right.c} /> : null}
      </View>
      <Pressable
        {...handlers}
        onPressIn={() => setDown(true)}
        onPressOut={() => {
          setDown(false);
          handlers.onPressOut();
        }}
        accessibilityRole="button"
        accessibilityLabel={faceName(k.face)}
        accessibilityHint={a11yHint(id)}
        style={{ width, height: keyHeight + 2 }}>
        <View style={[styles.shadow, { height: keyHeight, borderRadius: radius }]} />
        <View
          style={[
            styles.key,
            { height: keyHeight, borderRadius: radius, backgroundColor: fill, transform: [{ translateY: down ? 2 : 0 }] },
            down ? styles.keyDown : null,
          ]}>
          <KeyFace face={k.face} size={size} color={faceColor} scale={scale} />
        </View>
      </Pressable>
    </View>
  );
}

export interface RoundKeyProps {
  id: KeyId;
  width: number;
  scale: number;
  /** SHIFT or ALPHA is on: the key shows a ring in its color. */
  active?: boolean;
  onPress(id: KeyId): void;
}

/** SHIFT, ALPHA, MODE SETUP and ON: a caption over a 24 pt round key. */
export function RoundKey({ id, width, scale, active = false, onPress }: RoundKeyProps) {
  const k = KEY_LABELS[id];
  const tone = k.captionTone === 'gold' ? CALC_COLORS.gold : k.captionTone === 'pink' ? CALC_COLORS.pink : CALC_COLORS.ctrlText;
  const d = Math.round(24 * scale);
  const [down, setDown] = useState(false);
  const caption = k.caption ?? '';
  const label =
    id === 'MODE' ? tr('MODE، وSETUP مع SHIFT', 'MODE, SETUP with SHIFT') : id === 'ON' ? 'ON' : caption;
  return (
    <View style={[styles.round, { width }]}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.caption, { color: tone, fontSize: 8 * Math.min(1.15, Math.max(0.9, scale)) }]}>
        {caption}
      </Text>
      <Pressable
        onPress={() => onPress(id)}
        onPressIn={() => setDown(true)}
        onPressOut={() => setDown(false)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={id === 'SHIFT' || id === 'ALPHA' ? { selected: active } : undefined}
        style={{ width: d + 4, height: d + 4, alignItems: 'center', justifyContent: 'center' }}>
        <View style={[styles.roundShadow, { width: d, height: d, borderRadius: d / 2, top: 4 }]} />
        <View
          style={{
            width: d,
            height: d,
            borderRadius: d / 2,
            backgroundColor: CALC_COLORS.ctrl,
            borderWidth: active ? 2 : 0,
            borderColor: tone,
            transform: [{ translateY: down ? 2 : 0 }],
          }}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { alignItems: 'center', paddingHorizontal: 1, overflow: 'visible' },
  shadow: { position: 'absolute', left: 0, right: 0, top: 2, backgroundColor: 'rgba(0,0,0,0.35)' },
  key: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  keyDown: { opacity: 0.88 },
  round: { alignItems: 'center' },
  caption: { fontFamily: fonts.semibold, includeFontPadding: false, textAlign: 'center', lineHeight: 11, writingDirection: 'ltr' },
  roundShadow: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.4)' },
});
