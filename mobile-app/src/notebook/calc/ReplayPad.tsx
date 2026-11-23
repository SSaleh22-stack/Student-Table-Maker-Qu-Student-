/**
 * The round replay (cursor) pad (NB-47a), as the design's replay-pad: a ring with a darker center and
 * four chevrons. A touch picks the arrow of the quarter it lands in (physical directions: the pad
 * never mirrors); holding repeats. Screen readers get four named actions.
 */
import { useRef, useState } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { KeyId } from '@/notebook/core/calc/types';
import { CALC_COLORS } from '@/notebook/theme';
import { tr } from '@/lib/i18n';

import { useKeyPress } from './Key';

type Dir = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/** Chevron paths in a 24 box, pointing up, down, left and right. */
const CHEVRON: Record<Dir, string> = {
  UP: 'M6 15l6-6 6 6',
  DOWN: 'M6 9l6 6 6-6',
  LEFT: 'M15 6l-6 6 6 6',
  RIGHT: 'M9 6l6 6-6 6',
};

function Arrow({ dir, x, y, size, active }: { dir: Dir; x: number; y: number; size: number; active: boolean }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={CHEVRON[dir]} stroke={active ? '#FFFFFF' : CALC_COLORS.padArrow} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}

export interface ReplayPadProps {
  /** Diameter in pt. */
  size: number;
  onPress(id: KeyId): void;
}

export function ReplayPad({ size, onPress }: ReplayPadProps) {
  const d = size;
  const dir = useRef<Dir | null>(null);
  const [active, setActive] = useState<Dir | null>(null);
  const handlers = useKeyPress(() => {
    if (dir.current) onPress(dir.current);
  }, true);

  const pick = (e: GestureResponderEvent) => {
    const dx = e.nativeEvent.locationX - d / 2;
    const dy = e.nativeEvent.locationY - d / 2;
    if (Math.hypot(dx, dy) < d * 0.12) {
      dir.current = null;
    } else if (Math.abs(dx) > Math.abs(dy)) {
      dir.current = dx < 0 ? 'LEFT' : 'RIGHT';
    } else {
      dir.current = dy < 0 ? 'UP' : 'DOWN';
    }
    setActive(dir.current);
  };

  const arrow = Math.max(12, Math.round(d * 0.19));
  return (
    // The pad's own coordinates are physical: force left-to-right so locationX means the same in Arabic.
    <View style={{ width: d, height: d, direction: 'ltr' }}>
      <View style={{ position: 'absolute', left: 0, top: 2, width: d, height: d, borderRadius: d / 2, backgroundColor: 'rgba(0,0,0,0.4)' }} />
      <Pressable
        {...handlers}
        onPressIn={pick}
        onPressOut={() => {
          setActive(null);
          handlers.onPressOut();
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={tr('أزرار المؤشر', 'Cursor keys')}
        accessibilityActions={[
          { name: 'up', label: tr('أعلى', 'Up') },
          { name: 'down', label: tr('أسفل', 'Down') },
          { name: 'left', label: tr('يسار', 'Left') },
          { name: 'right', label: tr('يمين', 'Right') },
          { name: 'increment', label: tr('أعلى', 'Up') },
          { name: 'decrement', label: tr('أسفل', 'Down') },
        ]}
        onAccessibilityAction={(e) => {
          const n = e.nativeEvent.actionName;
          const map: Record<string, Dir> = { up: 'UP', increment: 'UP', down: 'DOWN', decrement: 'DOWN', left: 'LEFT', right: 'RIGHT' };
          const k = map[n];
          if (k) onPress(k);
        }}
        style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: CALC_COLORS.pad }}>
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: d * 0.33, top: d * 0.33, width: d * 0.34, height: d * 0.34, borderRadius: d * 0.17, backgroundColor: CALC_COLORS.padCenter }}
        />
        <Arrow dir="UP" x={d / 2} y={d * 0.15} size={arrow} active={active === 'UP'} />
        <Arrow dir="DOWN" x={d / 2} y={d * 0.85} size={arrow} active={active === 'DOWN'} />
        <Arrow dir="LEFT" x={d * 0.15} y={d / 2} size={arrow} active={active === 'LEFT'} />
        <Arrow dir="RIGHT" x={d * 0.85} y={d / 2} size={arrow} active={active === 'RIGHT'} />
      </Pressable>
    </View>
  );
}
