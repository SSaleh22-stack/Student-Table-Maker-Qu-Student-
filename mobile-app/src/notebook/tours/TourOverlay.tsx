/**
 * Runs one tour: waits for the targets, measures them, drops the missing ones and renumbers the rest
 * (core/tours/steps.ts availableSteps), then shows the optional welcome card and one step at a time.
 *
 * - Targets: every id of every step, from the tour target registry (ui/tourTargets.ts). The overlay
 *   waits up to waitMs (1.5 s) for them to attach and get a size, then goes on with what it has.
 *   A target entirely off screen counts as missing; a partly visible one is clipped to the window.
 * - Each step re-measures its targets when it opens and when the window size changes (rotation,
 *   Split View), so the spotlight follows the layout.
 * - Drawing: a transparent full-window Modal (it covers the header and tab bar too, and blocks every
 *   touch underneath). The dim + hole is one SVG; the card and its pointer are placed with
 *   physicalBox, because measured rects are physical.
 * - Results: 'done' after the last step's 'تم، لنبدأ', 'skipped' after 'تخطي الجولة', 'لاحقاً' or
 *   Android back, 'none' when no step could be shown (nothing was drawn). The caller writes the flag.
 * - Only one tour shows at a time (tourState claimTour); a second overlay waits until the slot is
 *   released, then starts.
 * - active=false (the screen lost focus, or the caller holds it back) stops a pending wait. A tour
 *   that is already showing is hidden and gives the slot back; when it is active again it comes back
 *   at the same step (re-measured), it does not start over.
 * - delayMs waits before looking for the targets, e.g. so another Modal (the first-time setup) has
 *   finished closing: iOS does not present a Modal while another one is still being dismissed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { isRTL } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import type { TourRect, TourTargetId } from '@/notebook/contracts/tours';
import { clipRect, isValidRect, padRect, placeCard, TOUR_CARD_WIDTH, type CardPlacement, type Rect } from '@/notebook/core/tours/placement';
import { availableSteps, stepTargetIds, type AvailableStep } from '@/notebook/core/tours/steps';
import { MODAL_ORIENTATIONS, useWidthClass } from '@/notebook/ui/layout';
import { physicalBox } from '@/notebook/ui/physical';
import { hasTourTarget, measureTarget, measureTargets, subscribeTourTargets } from '@/notebook/ui/tourTargets';

import { SPOTLIGHT_DIM_OPACITY, Spotlight } from './Spotlight';
import type { TourStepDef } from './stepText';
import { TourCard } from './TourCard';
import { claimTour, releaseTour, subscribeTourSlot } from './tourState';
import { WelcomeCard } from './WelcomeCard';

export type TourResult = 'done' | 'skipped' | 'none';

export interface TourOverlayProps {
  steps: readonly TourStepDef[];
  onFinish: (result: TourResult) => void;
  /** Show the library welcome card before the first step (Figma 24). */
  welcome?: boolean;
  /** How long to wait for the targets (default 1.5 s). */
  waitMs?: number;
  /** false stops a pending wait and hides a showing tour (e.g. the screen lost focus). Default true. */
  active?: boolean;
  /** Wait this long before looking for the targets (default 0). */
  delayMs?: number;
}

/** The welcome card's dim (the modal overlay, Figma overlay(): 42 %). */
const WELCOME_DIM = 0.42;
const RETRY_MS = 150;
/** A second measure of the current step, once the layout underneath has settled. */
const SETTLE_MS = 350;
const POINTER_W = 26;
const POINTER_H = 13;

type Phase = { kind: 'waiting' } | { kind: 'welcome' } | { kind: 'step'; index: number } | { kind: 'closed' };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Resolves when every id is attached, or at the deadline. */
function waitForAttach(ids: readonly TourTargetId[], deadline: number, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    let unsubscribe: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (cancelled() || ids.every((id) => hasTourTarget(id))) finish();
    };
    unsubscribe = subscribeTourTargets(check);
    timer = setTimeout(finish, Math.max(0, deadline - Date.now()));
    check();
  });
}

async function measureAll(ids: readonly TourTargetId[]): Promise<Map<string, Rect | null>> {
  const rects = await Promise.all(ids.map((id) => measureTarget(id)));
  return new Map(ids.map((id, i) => [id, rects[i]]));
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

export function TourOverlay({ steps, onFinish, welcome = false, waitMs = 1500, active = true, delayMs = 0 }: TourOverlayProps) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = useWidthClass() === 'compact';

  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const [available, setAvailable] = useState<AvailableStep<TourStepDef>[]>([]);
  /** The overlay's real size (the Modal can differ from the window on Android). */
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  /** The current step's fresh rect (re-measured when the step opens or the window changes). */
  const [live, setLive] = useState<{ key: string; rect: Rect } | null>(null);
  /** The card height for a step key, once laid out. */
  const [cardSize, setCardSize] = useState<{ key: string; height: number } | null>(null);

  const [owner] = useState<object>(() => ({}));
  /** This overlay holds the one-tour slot (tourState). */
  const [hasSlot, setHasSlot] = useState(false);
  const finished = useRef(false);
  /** The steps were measured and the first card (or the welcome card) was shown. */
  const started = useRef(false);
  const onFinishRef = useRef(onFinish);
  const winRef = useRef(win);
  useEffect(() => {
    onFinishRef.current = onFinish;
    winRef.current = win;
  });

  const finish = useCallback(
    (result: TourResult) => {
      if (finished.current) return;
      finished.current = true;
      setPhase({ kind: 'closed' });
      releaseTour(owner);
      onFinishRef.current(result);
    },
    [owner],
  );

  // Hold the slot while active; wait for it when another tour has it. Inactive gives it back.
  useEffect(() => {
    if (!active || finished.current) return;
    let unsubscribe: () => void = () => {};
    const tryClaim = (): boolean => {
      if (finished.current || !claimTour(owner)) return false;
      unsubscribe();
      setHasSlot(true);
      return true;
    };
    if (!tryClaim()) unsubscribe = subscribeTourSlot(tryClaim);
    return () => {
      unsubscribe();
      releaseTour(owner);
      setHasSlot(false);
    };
  }, [active, owner]);

  const visible = active && hasSlot;

  // Wait for the targets, measure, renumber. Runs once: a tour that was shown and then hidden
  // (inactive) comes back at the same step. The window size at the end of the wait is what counts.
  useEffect(() => {
    if (!visible || finished.current || started.current) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    const ids = stepTargetIds(steps) as TourTargetId[];
    (async () => {
      if (delayMs > 0) await delay(delayMs);
      if (cancelled) return;
      const deadline = Date.now() + waitMs;
      await waitForAttach(ids, deadline, isCancelled);
      if (cancelled) return;
      await nextFrame();
      let measured = await measureAll(ids);
      while (!cancelled && Date.now() < deadline && ids.some((id) => !isValidRect(measured.get(id)))) {
        await delay(RETRY_MS);
        if (cancelled) return;
        measured = await measureAll(ids);
      }
      if (cancelled) return;
      const { width, height } = winRef.current;
      const found = availableSteps(steps, measured, { x: 0, y: 0, width, height });
      if (!found.length) {
        finish('none');
        return;
      }
      started.current = true;
      setAvailable(found);
      setPhase(welcome ? { kind: 'welcome' } : { kind: 'step', index: 0 });
    })().catch(() => {
      if (!cancelled) finish('none');
    });
    return () => {
      cancelled = true;
    };
  }, [visible, waitMs, delayMs, welcome, steps, finish]);

  const current = phase.kind === 'step' ? available[phase.index] : undefined;
  const viewW = box?.width ?? win.width;
  const viewH = box?.height ?? win.height;

  // Re-measure the current step when it opens, when the window changes size and when the tour is
  // shown again after being hidden.
  useEffect(() => {
    if (!current || !visible) return;
    let alive = true;
    const key = current.step.key;
    const measure = () => {
      measureTargets(current.step.targets).then(
        (r: TourRect | null) => {
          if (!alive || !isValidRect(r)) return;
          const clipped = clipRect(r, { x: 0, y: 0, width: viewW, height: viewH });
          if (!clipped) return;
          setLive((prev) => (prev && prev.key === key && sameRect(prev.rect, clipped) ? prev : { key, rect: clipped }));
        },
        () => {},
      );
    };
    measure();
    // The window size changes before the screen underneath has laid out again (rotation, Split
    // View), and a toolbar may still be animating in: measure once more when the layout settled.
    const again = setTimeout(measure, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(again);
    };
  }, [current, viewW, viewH, visible]);

  const placed = useMemo(() => {
    if (!current) return null;
    const rect = live && live.key === current.step.key ? live.rect : current.rect;
    const hole = padRect(rect, current.step.pad);
    const cardWidth = Math.min(TOUR_CARD_WIDTH, viewW - 40);
    const height = cardSize && cardSize.key === current.step.key ? cardSize.height : null;
    const at: CardPlacement | null =
      height === null ? null : placeCard(hole, { width: cardWidth, height }, { width: viewW, height: viewH }, { prefer: current.step.prefer, insets });
    return { rect, hole, cardWidth, height, at };
  }, [current, live, cardSize, viewW, viewH, insets]);

  if (phase.kind === 'waiting' || phase.kind === 'closed' || !visible) return null;

  const onRootLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (!box || box.width !== width || box.height !== height)) setBox({ width, height });
  };

  const next = () => {
    if (phase.kind === 'welcome') {
      setPhase({ kind: 'step', index: 0 });
      return;
    }
    if (phase.kind !== 'step') return;
    if (phase.index >= available.length - 1) finish('done');
    else setPhase({ kind: 'step', index: phase.index + 1 });
  };
  const skip = () => finish('skipped');

  const welcomeWidth = compact ? viewW - 40 : Math.min(560, viewW - 40);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={skip}
      supportedOrientations={MODAL_ORIENTATIONS}
      statusBarTranslucent
      navigationBarTranslucent>
      <View style={styles.root} onLayout={onRootLayout}>
        <Spotlight
          width={viewW}
          height={viewH}
          hole={placed ? placed.hole : null}
          radius={current ? current.step.radius : 0}
          opacity={phase.kind === 'welcome' ? WELCOME_DIM : SPOTLIGHT_DIM_OPACITY}
        />

        {phase.kind === 'welcome' ? (
          <View style={[StyleSheet.absoluteFill, styles.center, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
            <WelcomeCard count={available.length} onStart={next} onLater={skip} width={welcomeWidth} compact={compact} />
          </View>
        ) : null}

        {current && placed
          ? (() => {
              const key = current.step.key;
              const card = (
                <TourCard
                  number={current.number}
                  total={current.total}
                  title={current.step.title({ rect: placed.rect, isRTL })}
                  body={current.step.body({ rect: placed.rect, isRTL })}
                  last={current.last}
                  onNext={next}
                  onSkip={skip}
                  width={placed.cardWidth}
                  onLayout={(e) => {
                    const h = Math.round(e.nativeEvent.layout.height);
                    setCardSize((prev) => (prev && prev.key === key && prev.height === h ? prev : { key, height: h }));
                  }}
                />
              );
              // First a hidden pass to learn the card's height, then the placed card fades in.
              if (!placed.at) {
                return (
                  <View key={`measure:${key}`} style={[physicalBox(20, 0, placed.cardWidth), styles.hidden]} pointerEvents="none">
                    {card}
                  </View>
                );
              }
              return (
                <>
                  <Pointer at={placed.at} cardWidth={placed.cardWidth} cardHeight={placed.height ?? 0} />
                  <Animated.View key={key} entering={FadeIn.duration(180)} style={physicalBox(placed.at.x, placed.at.y, placed.cardWidth)}>
                    {card}
                  </Animated.View>
                </>
              );
            })()
          : null}
      </View>
    </Modal>
  );
}

/** The small white triangle between the card and the hole (Figma tour/pointer). */
function Pointer({ at, cardWidth, cardHeight }: { at: CardPlacement; cardWidth: number; cardHeight: number }) {
  const vertical = at.side === 'above' || at.side === 'below';
  const w = vertical ? POINTER_W : POINTER_H;
  const h = vertical ? POINTER_H : POINTER_W;
  let x: number;
  let y: number;
  let d: string;
  if (at.side === 'below') {
    x = at.pointer - POINTER_W / 2;
    y = at.y - POINTER_H + 1;
    d = `M0 ${POINTER_H} L${POINTER_W / 2} 0 L${POINTER_W} ${POINTER_H} Z`;
  } else if (at.side === 'above') {
    x = at.pointer - POINTER_W / 2;
    y = at.y + cardHeight - 1;
    d = `M0 0 L${POINTER_W / 2} ${POINTER_H} L${POINTER_W} 0 Z`;
  } else if (at.side === 'right') {
    x = at.x - POINTER_H + 1;
    y = at.pointer - POINTER_W / 2;
    d = `M${POINTER_H} 0 L0 ${POINTER_W / 2} L${POINTER_H} ${POINTER_W} Z`;
  } else {
    x = at.x + cardWidth - 1;
    y = at.pointer - POINTER_W / 2;
    d = `M0 0 L${POINTER_H} ${POINTER_W / 2} L0 ${POINTER_W} Z`;
  }
  return (
    <View pointerEvents="none" style={physicalBox(x, y, w, h)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={w} height={h}>
        <Path d={d} fill={colors.surface} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  hidden: { opacity: 0 },
});
