/**
 * Figma 11: the player bar for the loaded recording (NB-62).
 *
 * Reading order: play/pause, the title with '18:05 / 47:32' over the scrubber, the speed chips
 * 1x / 1.5x / 2x, the pointer ('play from here') button, then the recordings list and close buttons.
 * The scrubber fills from the reading side (the right in Arabic) and carries a tick wherever ink of
 * this recording was made. Tap or drag it to seek.
 *
 * Props only (the editor wires them): onPointer toggles the play-from tool, pointerActive is its
 * state, onOpenList shows RecordingsPanel, onClose leaves playback. While pointerActive, the tip
 * 'اضغط على أي كتابة لتسمع ما قيل لحظتها' shows above the bar until the first play-from
 * (player.playFrom).
 *
 * Phones (compact): two rows, the controls under the scrubber.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { isRTL, ltr, row } from '@/lib/rtl';
import type { PlaybackRate } from '@/notebook/contracts/audio';
import { fractionOf, msAtFraction } from '@/notebook/core/audio/timeline';
import { durationLabel } from '@/notebook/core/text/labels';
import { nbColors } from '@/notebook/theme';
import { CircleButton } from '@/notebook/ui/CircleButton';
import { useIsCompact } from '@/notebook/ui/layout';
import { NbChip } from '@/notebook/ui/LocationChips';
import { physicalLeft, physicalRight } from '@/notebook/ui/physical';

import { player } from './player';
import { usePlaybackSnapshot } from './usePlayback';

export interface PlayerBarProps {
  onPointer: () => void;
  pointerActive: boolean;
  onClose: () => void;
  onOpenList: () => void;
  style?: StyleProp<ViewStyle>;
}

const RATES: readonly PlaybackRate[] = [1, 1.5, 2];
const SEEK_STEP_MS = 10_000;
const TRACK_H = 6;
const KNOB = 18;
const SCRUB_H = 24;

interface ScrubberProps {
  positionMs: number;
  durationMs: number;
  ticks: readonly number[];
  disabled: boolean;
  onSeek: (ms: number) => void;
}

/** Fraction (from the reading side) under a physical x inside a track of width w. */
function readingFraction(x: number, w: number): number {
  const f = w > 0 ? Math.min(1, Math.max(0, x / w)) : 0;
  return isRTL ? 1 - f : f;
}

/** Physical x of a reading-side fraction. */
function physicalX(f: number, w: number): number {
  return (isRTL ? 1 - f : f) * w;
}

function Scrubber({ positionMs, durationMs, ticks, disabled, onSeek }: ScrubberProps) {
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const frac = drag ?? fractionOf(positionMs, durationMs);

  const at = (e: GestureResponderEvent) => {
    const f = readingFraction(e.nativeEvent.locationX, w);
    dragRef.current = f;
    setDrag(f);
  };
  const end = () => {
    const f = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (f !== null) onSeek(msAtFraction(f, durationMs));
  };

  const fillW = frac * w;
  const knobX = physicalX(frac, w);
  return (
    <View
      style={styles.scrub}
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !disabled && durationMs > 0}
      onMoveShouldSetResponder={() => !disabled && durationMs > 0}
      onResponderGrant={at}
      onResponderMove={at}
      onResponderRelease={end}
      onResponderTerminate={end}
      onResponderTerminationRequest={() => false}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={tr('موضع التشغيل', 'Playback position')}
      accessibilityValue={{ min: 0, max: Math.round(durationMs / 1000), now: Math.round(positionMs / 1000), text: durationLabel(positionMs) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onSeek(Math.min(durationMs, positionMs + SEEK_STEP_MS));
        if (e.nativeEvent.actionName === 'decrement') onSeek(Math.max(0, positionMs - SEEK_STEP_MS));
      }}>
      {/* Children never take the touch, so locationX is always measured on the track itself. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.track, styles.trackBg]} />
        <View style={[styles.track, styles.trackFill, isRTL ? physicalRight(0) : physicalLeft(0), { width: fillW }]} />
        {w > 0
          ? ticks.map((t, i) => <View key={i} style={[styles.tick, physicalLeft(Math.round(physicalX(t, w) - 1))]} />)
          : null}
        {w > 0 ? <View style={[styles.knob, physicalLeft(Math.round(knobX - KNOB / 2))]} /> : null}
      </View>
    </View>
  );
}

export function PlayerBar({ onPointer, pointerActive, onClose, onOpenList, style }: PlayerBarProps) {
  const snap = usePlaybackSnapshot();
  const compact = useIsCompact();

  // The tip shows while the pointer tool is on, until the first play-from of this bar.
  const [tipDone, setTipDone] = useState(false);
  const seenCount = useRef(snap.playFromCount);
  useEffect(() => {
    if (snap.playFromCount !== seenCount.current) {
      if (snap.playFromCount > seenCount.current && pointerActive) setTipDone(true);
      seenCount.current = snap.playFromCount;
    }
  }, [snap.playFromCount, pointerActive]);
  const showTip = pointerActive && !tipDone;

  const time = `${durationLabel(snap.positionMs)} / ${durationLabel(snap.durationMs)}`;
  const playLabel = snap.playing ? tr('إيقاف مؤقت', 'Pause') : tr('تشغيل', 'Play');

  const playBtn = (
    <Pressable
      onPress={() => (snap.playing ? player.pause() : player.play())}
      disabled={!snap.playable}
      accessibilityRole="button"
      accessibilityLabel={playLabel}
      accessibilityState={{ disabled: !snap.playable }}
      style={({ pressed }) => [styles.play, compact && styles.playCompact, (pressed || !snap.playable) && { opacity: snap.playable ? 0.85 : 0.45 }]}>
      <Icon name={snap.playing ? 'pause' : 'playSolid'} size={compact ? 20 : 22} color={nbColors.white} filled />
    </Pressable>
  );

  const info = (
    <View style={styles.info}>
      <View style={[styles.infoRow, { flexDirection: row }]}>
        <AppText size={14} weight="bold" color={nbColors.text} numberOfLines={1} style={styles.title}>
          {snap.title ?? ''}
        </AppText>
        <AppText size={13} color={nbColors.faint} style={styles.time}>
          {ltr(time)}
        </AppText>
      </View>
      <Scrubber positionMs={snap.positionMs} durationMs={snap.durationMs} ticks={snap.ticks} disabled={!snap.playable} onSeek={(ms) => void player.seek(ms).catch(() => {})} />
    </View>
  );

  const rates = (
    <View style={[styles.rates, { flexDirection: row }]} accessibilityRole="radiogroup" accessibilityLabel={tr('سرعة التشغيل', 'Playback speed')}>
      {RATES.map((r) => (
        <NbChip key={r} label={`${r}x`} size={13} selected={snap.rate === r} onPress={() => player.setRate(r)} style={styles.chip} />
      ))}
    </View>
  );

  const pointer = (
    <Pressable
      onPress={onPointer}
      accessibilityRole="button"
      accessibilityLabel={tr('التشغيل من الكتابة', 'Play from writing')}
      accessibilityHint={tr('اضغط بعدها على أي كتابة', 'Then tap any writing')}
      accessibilityState={{ selected: pointerActive }}
      style={({ pressed }) => [styles.pointer, pointerActive && styles.pointerOn, pressed && { opacity: 0.8 }]}>
      <Icon name="pointer" size={20} color={pointerActive ? nbColors.white : nbColors.accent} />
    </Pressable>
  );

  const tools = (
    <View style={[styles.tools, { flexDirection: row }]}>
      <CircleButton icon="list" tone="clear" size={36} label={tr('التسجيلات', 'Recordings')} onPress={onOpenList} />
      <CircleButton icon="x" tone="clear" size={36} label={tr('إغلاق المشغّل', 'Close player')} onPress={onClose} />
    </View>
  );

  return (
    <View style={[styles.wrap, style]} pointerEvents="box-none">
      {showTip ? (
        <View style={[styles.tip, { flexDirection: row }]} accessibilityLiveRegion="polite">
          <Icon name="pointer" size={16} color={nbColors.white} />
          <AppText size={13} weight="medium" color={nbColors.white}>
            {tr('اضغط على أي كتابة لتسمع ما قيل لحظتها', 'Tap any writing to hear what was said at that moment')}
          </AppText>
        </View>
      ) : null}
      {compact ? (
        <View style={[styles.bar, styles.barCompact]}>
          <View style={[styles.line, { flexDirection: row }]}>
            {playBtn}
            {info}
          </View>
          <View style={[styles.line, styles.controls, { flexDirection: row }]}>
            {rates}
            {pointer}
            <View style={styles.spacer} />
            {tools}
          </View>
        </View>
      ) : (
        <View style={[styles.bar, { flexDirection: row }]}>
          {playBtn}
          {info}
          {rates}
          {pointer}
          {tools}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  tip: {
    alignItems: 'center',
    gap: 6,
    backgroundColor: nbColors.accentDark,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  bar: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: nbColors.surface,
    maxWidth: 820,
    alignSelf: 'center',
    shadowColor: '#1B2533',
    shadowOpacity: 0.1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  barCompact: { alignSelf: 'stretch', maxWidth: undefined, gap: 10, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'stretch' },
  line: { alignItems: 'center', gap: 12 },
  controls: { gap: 8 },
  spacer: { flex: 1 },
  play: { width: 52, height: 52, borderRadius: 26, backgroundColor: nbColors.accent, alignItems: 'center', justifyContent: 'center' },
  playCompact: { width: 46, height: 46, borderRadius: 23 },
  info: { flex: 1, minWidth: 180, gap: 4 },
  infoRow: { alignItems: 'center', gap: 8 },
  title: { flex: 1 },
  time: { fontVariant: ['tabular-nums'] },
  rates: { gap: 4, alignItems: 'center' },
  chip: { paddingHorizontal: 10, paddingVertical: 6 },
  pointer: { padding: 10, borderRadius: 12, backgroundColor: nbColors.accentTint },
  pointerOn: { backgroundColor: nbColors.accent },
  tools: { alignItems: 'center', gap: 2 },
  scrub: { height: SCRUB_H, alignSelf: 'stretch', justifyContent: 'center' },
  track: { position: 'absolute', top: (SCRUB_H - TRACK_H) / 2, height: TRACK_H, borderRadius: TRACK_H / 2 },
  trackBg: { left: 0, right: 0, backgroundColor: nbColors.accentSoft },
  trackFill: { backgroundColor: nbColors.accent },
  tick: { position: 'absolute', top: 6, width: 2, height: 12, backgroundColor: nbColors.accentDark, opacity: 0.35 },
  knob: {
    position: 'absolute',
    top: (SCRUB_H - KNOB) / 2,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: nbColors.white,
    borderWidth: 3,
    borderColor: nbColors.accent,
  },
});
