/**
 * The calculator keypad (NB-47a), laid out as the design's calcBody (P19 KEY_LAYOUT):
 * - the top block: SHIFT, ALPHA, the replay pad over columns 2 and 3, MODE SETUP and ON, with CALC,
 *   ∫, x⁻¹ and log□ under columns 0, 1, 4 and 5;
 * - three rows of six function keys;
 * - four rows of five number keys (DEL and AC in green).
 *
 * The keypad ALWAYS reads left to right (direction 'ltr'), in Arabic too, like the real calculator.
 * Sizes follow the 312 pt design width and scale with the width; a height limit (phones) squeezes the
 * key heights down to 72 percent, never the labels.
 */
import { memo } from 'react';
import { View } from 'react-native';

import { KEY_LAYOUT } from '@/notebook/core/calc/keys/keymap';
import type { KeyId } from '@/notebook/core/calc/types';

import { Key, RoundKey } from './Key';
import { ReplayPad } from './ReplayPad';

/** Keypad width in the design (360 pt panel, 12 pt panel padding, 12 pt body padding). */
export const KEYPAD_DESIGN_WIDTH = 312;
/** Keys that repeat while held. */
const REPEAT: ReadonlySet<KeyId> = new Set<KeyId>(['DEL']);

export interface KeypadMetrics {
  width: number;
  scale: number;
  fnW: number;
  numW: number;
  fnGap: number;
  numGap: number;
  labelH: number;
  fnH: number;
  numH: number;
  fnRowGap: number;
  numRowGap: number;
  sectionGap: number;
  /** Top block: caption + round key row, gap, key row. */
  roundRowH: number;
  topGap: number;
  topH: number;
  padD: number;
  height: number;
}

function metricsFor(width: number, v: number): KeypadMetrics {
  const s = Math.max(0.8, Math.min(1.5, width / KEYPAD_DESIGN_WIDTH));
  const fnGap = Math.round(5 * s);
  const numGap = Math.round(8 * s);
  const fnW = Math.floor((width - 5 * fnGap) / 6);
  const numW = Math.floor((width - 4 * numGap) / 5);
  const labelH = Math.round(10 * Math.max(0.95, Math.min(1.2, s)));
  const fnH = Math.round(26 * s * v);
  const numH = Math.round(38 * s * v);
  const fnRowGap = Math.round(5 * s * v);
  const numRowGap = Math.round(6 * s * v);
  const sectionGap = Math.round(12 * s * v);
  const roundRowH = 12 + Math.round(24 * s) + 4;
  const topGap = Math.round(6 * s * v);
  const topH = roundRowH + topGap + labelH + 2 + fnH + 2;
  const padD = Math.min(2 * fnW + fnGap, Math.round(84 * s), topH);
  const fnBlock = 3 * (labelH + 2 + fnH + 2) + 2 * fnRowGap;
  const numBlock = 4 * (labelH + 2 + numH + 2) + 3 * numRowGap;
  const height = topH + sectionGap + fnBlock + sectionGap + numBlock;
  return { width, scale: s, fnW, numW, fnGap, numGap, labelH, fnH, numH, fnRowGap, numRowGap, sectionGap, roundRowH, topGap, topH, padD, height };
}

/** Keypad sizes for a width; maxHeight squeezes the key heights (down to 72 percent). */
export function keypadMetrics(width: number, maxHeight?: number): KeypadMetrics {
  const full = metricsFor(width, 1);
  if (maxHeight === undefined || maxHeight >= full.height) return full;
  // Height that does not scale with v: labels, round key row, shadows.
  const fixed = metricsFor(width, 0).height;
  const v = Math.max(0.72, Math.min(1, (maxHeight - fixed) / Math.max(1, full.height - fixed)));
  return metricsFor(width, v);
}

export interface KeypadProps {
  width: number;
  maxHeight?: number;
  shift: boolean;
  alpha: boolean;
  onPress(id: KeyId): void;
}

/** Memoized: a key press re-renders the LCD, not the 50 keys (they only change with SHIFT and ALPHA). */
export const Keypad = memo(function Keypad({ width, maxHeight, shift, alpha, onPress }: KeypadProps) {
  const m = keypadMetrics(width, maxHeight);
  const colX = (col: number) => col * (m.fnW + m.fnGap);
  const key = (id: KeyId, w: number, h: number) => (
    <Key key={id} id={id} width={w} keyHeight={h} labelHeight={m.labelH} scale={m.scale} onPress={onPress} repeat={REPEAT.has(id)} />
  );
  return (
    <View style={{ width: m.width, direction: 'ltr', gap: m.sectionGap }}>
      <View style={{ width: m.width, height: m.topH }}>
        {KEY_LAYOUT.topRound.map(({ col, id }) => (
          <View key={id} style={{ position: 'absolute', left: colX(col), top: 0 }}>
            <RoundKey id={id} width={m.fnW} scale={m.scale} active={(id === 'SHIFT' && shift) || (id === 'ALPHA' && alpha)} onPress={onPress} />
          </View>
        ))}
        {KEY_LAYOUT.topKeys.map(({ col, id }) => (
          <View key={id} style={{ position: 'absolute', left: colX(col), top: m.roundRowH + m.topGap }}>
            {key(id, m.fnW, m.fnH)}
          </View>
        ))}
        <View style={{ position: 'absolute', left: colX(2) + (2 * m.fnW + m.fnGap - m.padD) / 2, top: (m.topH - m.padD) / 2 }}>
          <ReplayPad size={m.padD} onPress={onPress} />
        </View>
      </View>
      <View style={{ gap: m.fnRowGap }}>
        {KEY_LAYOUT.fnRows.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: m.fnGap, alignItems: 'flex-end' }}>
            {r.map((id) => key(id, m.fnW, m.fnH))}
          </View>
        ))}
      </View>
      <View style={{ gap: m.numRowGap }}>
        {KEY_LAYOUT.numRows.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: m.numGap, alignItems: 'flex-end' }}>
            {r.map((id) => key(id, m.numW, m.numH))}
          </View>
        ))}
      </View>
    </View>
  );
});
