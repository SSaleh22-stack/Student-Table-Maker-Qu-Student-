/**
 * The pages grid with drag reorder (Figma 13, NB-24).
 *
 * Layout: cells are placed absolutely from core/pages/reorder.ts (gridMetrics, cellOrigin), first
 * page at the reading start. Only the rows around the viewport mount (visibleRange), so a notebook
 * with hundreds of pages keeps a few dozen PageThumbs (cached PNGs, no Skia canvas per cell).
 *
 * Gestures:
 * - A tap on a page calls onTap (the screen jumps or toggles the selection).
 * - With onMenu, each page has a round ⋮ button on its top corner (physical right) that opens the
 *   page's options (the screen's menu: add after, duplicate, paper, PDF, delete).
 * - In normal mode a 350 ms long press LIFTS the page: one RNGH v3 usePanGesture with
 *   activateAfterLongPress over the whole grid (it cancels the cell's tap once it activates). The
 *   lifted copy follows the finger, rotated −4° with a shadow; the page's own cell fades to 0.35, and
 *   the accent drop bar shows where it will land (dropBar). Near the top or bottom edge the grid
 *   scrolls by itself (autoScrollStep, a UI-thread frame callback with scrollTo). On release the
 *   screen gets onMove(pageId, toIndex) (moveIndex) and calls session.movePage: one undo step.
 * - Select mode (or a read-only notebook) turns the lift off.
 * - Screen readers: each page has 'نقل إلى موضع سابق' / 'نقل إلى موضع لاحق' actions.
 *
 * Threads: worklets only touch shared values and the pure reorder math; every hop to JS is
 * scheduleOnRN with plain numbers.
 */
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { isRTL } from '@/lib/rtl';
import type { Id, PaperSpec } from '@/notebook/core/model';
import {
  DROP_BAR_W,
  autoScrollStep,
  cellAt,
  cellOrigin,
  clampScroll,
  contentHeight,
  dropBar,
  moveIndex,
  slotAt,
  visibleRange,
  type GridMetrics,
} from '@/notebook/core/pages/reorder';
import type { NotebookSession } from '@/notebook/core/session/types';
import { nbColors } from '@/notebook/theme';
import { physicalLeft, physicalRight } from '@/notebook/ui/physical';
import type { AnchorRect } from '@/notebook/ui/Popover';

import { AddPageTile } from './AddPageTile';
import { PageThumb } from './PageThumb';

const LIFT_MS = 350;
const SPRING = { damping: 18, stiffness: 260, mass: 0.6 };
/** Cells mounted beyond the viewport, in viewports. */
const OVERSCAN = 1;

export interface ReorderGridProps {
  session: NotebookSession;
  pageIds: readonly Id[];
  metrics: GridMetrics;
  current: Id | null;
  selectMode: boolean;
  selected: ReadonlySet<Id>;
  defaults: PaperSpec;
  readOnly: boolean;
  onTap: (pageId: Id) => void;
  onMove: (pageId: Id, toIndex: number) => void;
  onAddEnd: () => void;
  /** Horizontal padding around the grid (the grid itself is metrics.width wide). */
  padX: number;
  /** Room under the grid for the overlaid action bar. */
  bottomInset: number;
  /** Scroll so this page is visible once, after the first layout. */
  initialPageId?: Id | null;
  /** Shown above the grid, inside the scroll view. */
  header?: ReactNode;
  /** The ⋮ button on each page (window rect of the button); none when not given. */
  onMenu?: (pageId: Id, anchor: AnchorRect) => void;
}

interface Lifted {
  id: Id;
  index: number;
}

function pageA11yLabel(index: number, current: boolean, selectMode: boolean, selected: boolean): string {
  const n = index + 1;
  const base = tr(`صفحة ${n}`, `Page ${n}`);
  const parts = [base];
  if (current) parts.push(tr('الحالية', 'current'));
  if (selectMode && selected) parts.push(tr('محددة', 'selected'));
  return parts.join(tr('، ', ', '));
}

interface CellProps {
  session: NotebookSession;
  pageId: Id;
  index: number;
  count: number;
  version: number;
  metrics: GridMetrics;
  x: number;
  y: number;
  current: boolean;
  selectMode: boolean;
  selected: boolean;
  defaults: PaperSpec;
  dimmed: boolean;
  canMove: boolean;
  onTap: (pageId: Id) => void;
  onMove: (pageId: Id, toIndex: number) => void;
  onMenu?: (pageId: Id, anchor: AnchorRect) => void;
}

/** The round ⋮ on a page's corner. */
const MENU_D = 30;

function MenuDot({ pageId, index, onMenu }: { pageId: Id; index: number; onMenu: (pageId: Id, anchor: AnchorRect) => void }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  return (
    <View ref={ref} collapsable={false} style={[styles.menuDot, physicalRight(6)]}>
      <Pressable
        onPress={() => ref.current?.measureInWindow((x, y, width, height) => onMenu(pageId, { x, y, width, height }))}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={tr(`خيارات الصفحة ${index + 1}`, `Page ${index + 1} options`)}
        style={({ pressed }) => [styles.menuDotInner, pressed && { opacity: 0.7 }]}>
        <Icon name="moreV" size={16} color={nbColors.text} />
      </Pressable>
    </View>
  );
}

const Cell = memo(function Cell({
  session,
  pageId,
  index,
  count,
  version,
  metrics,
  x,
  y,
  current,
  selectMode,
  selected,
  defaults,
  dimmed,
  canMove,
  onTap,
  onMove,
  onMenu,
}: CellProps) {
  const actions = canMove
    ? [
        ...(index > 0 ? [{ name: 'moveEarlier', label: tr('نقل إلى موضع سابق', 'Move earlier') }] : []),
        ...(index < count - 1 ? [{ name: 'moveLater', label: tr('نقل إلى موضع لاحق', 'Move later') }] : []),
      ]
    : [];
  return (
    <Pressable
      onPress={() => onTap(pageId)}
      accessibilityRole={selectMode ? 'checkbox' : 'button'}
      accessibilityLabel={pageA11yLabel(index, current, selectMode, selected)}
      accessibilityHint={selectMode ? undefined : tr('يفتح هذه الصفحة', 'Opens this page')}
      accessibilityState={selectMode ? { checked: selected } : { selected: current }}
      accessibilityActions={actions.length ? actions : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'moveEarlier') onMove(pageId, index - 1);
        else if (e.nativeEvent.actionName === 'moveLater') onMove(pageId, index + 1);
      }}
      style={({ pressed }) => [
        styles.cell,
        { top: y, width: metrics.cellW, opacity: dimmed ? 0.35 : pressed ? 0.75 : 1 },
        physicalLeft(x),
      ]}>
      <PageThumb
        session={session}
        pageId={pageId}
        index={index}
        boxW={metrics.cellW}
        boxH={metrics.thumbH}
        labelH={metrics.labelH}
        version={version}
        defaults={defaults}
        current={current}
        selectMode={selectMode}
        selected={selected}
      />
      {onMenu && !selectMode ? <MenuDot pageId={pageId} index={index} onMenu={onMenu} /> : null}
    </Pressable>
  );
});

export function ReorderGrid({
  session,
  pageIds,
  metrics: m,
  current,
  selectMode,
  selected,
  defaults,
  readOnly,
  onTap,
  onMove,
  onAddEnd,
  padX,
  bottomInset,
  initialPageId,
  header,
  onMenu,
}: ReorderGridProps) {
  const count = pageIds.length;
  const slots = count + 1;
  const rtl = isRTL;
  const reorderOn = !selectMode && !readOnly;
  const gridH = contentHeight(m, slots);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const viewportH = useSharedValue(0);
  const viewportTop = useSharedValue(0);
  const headerH = useSharedValue(0);
  const totalH = useSharedValue(0);
  const rangeFirst = useSharedValue(0);
  const rangeLast = useSharedValue(-1);

  // Drag state (UI runtime).
  const dragging = useSharedValue(-1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScroll = useSharedValue(0);
  const transX = useSharedValue(0);
  const transY = useSharedValue(0);
  const pointerAbsY = useSharedValue(0);
  const slot = useSharedValue(-1);
  const lift = useSharedValue(0);

  // The scroll offset as JS last heard it (only when the mounted rows change).
  const [jsScroll, setJsScroll] = useState(0);
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const [viewH, setViewH] = useState(0);
  const [hdrH, setHdrH] = useState(0);
  const outerRef = useRef<ComponentRef<typeof View>>(null);
  const scrolledInitially = useRef(false);

  // Keep the UI-side copies in step with layout.
  useEffect(() => {
    totalH.set(hdrH + gridH + bottomInset);
  }, [hdrH, gridH, bottomInset, totalH]);
  useEffect(() => {
    headerH.set(hdrH);
  }, [hdrH, headerH]);

  const range = visibleRange(m, jsScroll - hdrH, viewH || 900, slots, OVERSCAN);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      'worklet';
      scrollY.set(e.contentOffset.y);
      const r = visibleRange(m, e.contentOffset.y - headerH.get(), viewportH.get() || 900, slots, OVERSCAN);
      if (r.first !== rangeFirst.get() || r.last !== rangeLast.get()) {
        rangeFirst.set(r.first);
        rangeLast.set(r.last);
        scheduleOnRN(setJsScroll, e.contentOffset.y);
      }
    },
  });

  const measureViewport = useCallback(() => {
    outerRef.current?.measureInWindow((_x, y) => {
      viewportTop.set(y);
    });
  }, [viewportTop]);

  const onViewportLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      viewportH.set(h);
      setViewH(h);
      measureViewport();
    },
    [viewportH, measureViewport],
  );

  // Show the current page once the grid has its size.
  useEffect(() => {
    if (scrolledInitially.current || !viewH || !initialPageId) return;
    const i = pageIds.indexOf(initialPageId);
    if (i < 0) return;
    scrolledInitially.current = true;
    const o = cellOrigin(m, i, rtl);
    const rowBottom = hdrH + o.y + m.thumbH + m.labelH;
    if (rowBottom <= viewH - bottomInset) return;
    const target = clampScroll(hdrH + o.y - m.padTop - 24, hdrH + gridH + bottomInset, viewH);
    const node = scrollRef.current as unknown as { scrollTo?: (o: { y: number; animated: boolean }) => void } | null;
    node?.scrollTo?.({ y: target, animated: false });
  }, [viewH, initialPageId, pageIds, m, rtl, hdrH, gridH, bottomInset, scrollRef]);

  // ----- drag (JS side)

  const pageIdsRef = useRef(pageIds);
  const liftedRef = useRef<Lifted | null>(null);
  useLayoutEffect(() => {
    pageIdsRef.current = pageIds;
    liftedRef.current = lifted;
  });

  const onLifted = useCallback(
    (index: number) => {
      const id = pageIdsRef.current[index];
      if (!id) return;
      setLifted({ id, index });
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [],
  );

  const onDropped = useCallback(
    (fromIndex: number, dropSlot: number, cancelled: boolean) => {
      const ids = pageIdsRef.current;
      // The lifted page (or, when the drop came before the lift re-rendered, the page at the index).
      const id = liftedRef.current?.id ?? ids[fromIndex];
      setLifted(null);
      if (!id || cancelled) return;
      // Pages may have been added meanwhile (a background import): use the page's index now.
      const from = ids.indexOf(id);
      const to = moveIndex(from, dropSlot, ids.length);
      if (to >= 0) onMove(id, to);
    },
    [onMove],
  );

  // ----- drag (UI side)

  const updateSlot = (absY: number) => {
    'worklet';
    const scrollDelta = scrollY.get() - startScroll.get();
    const cx = startX.get() + transX.get();
    const cy = startY.get() + transY.get() + scrollDelta;
    slot.set(slotAt(m, cx, cy, count, rtl));
    pointerAbsY.set(absY);
  };

  const pan = usePanGesture({
    enabled: reorderOn,
    activateAfterLongPress: LIFT_MS,
    onActivate: (e) => {
      'worklet';
      const index = cellAt(m, e.x, e.y, count, rtl);
      if (index < 0) {
        dragging.set(-1);
        return;
      }
      dragging.set(index);
      startX.set(e.x);
      startY.set(e.y);
      startScroll.set(scrollY.get());
      transX.set(0);
      transY.set(0);
      slot.set(index);
      pointerAbsY.set(e.absoluteY);
      lift.set(withSpring(1, SPRING));
      scheduleOnRN(onLifted, index);
    },
    onUpdate: (e) => {
      'worklet';
      if (dragging.get() < 0) return;
      transX.set(e.translationX);
      transY.set(e.translationY);
      updateSlot(e.absoluteY);
    },
    onDeactivate: (e) => {
      'worklet';
      const from = dragging.get();
      if (from < 0) return;
      dragging.set(-1);
      lift.set(withTiming(0, { duration: 120 }));
      scheduleOnRN(onDropped, from, slot.get(), e.canceled === true);
    },
    onFinalize: () => {
      'worklet';
      const from = dragging.get();
      if (from < 0) return;
      // Cancelled while lifted (another gesture took over, the app went to the background).
      dragging.set(-1);
      lift.set(withTiming(0, { duration: 120 }));
      scheduleOnRN(onDropped, from, -1, true);
    },
  });

  // Auto-scroll near the viewport edges while a page is lifted.
  const autoScroll = useFrameCallback(() => {
    'worklet';
    if (dragging.get() < 0) return;
    const step = autoScrollStep(pointerAbsY.get() - viewportTop.get(), viewportH.get());
    if (step === 0) return;
    const next = clampScroll(scrollY.get() + step, totalH.get(), viewportH.get());
    if (next === scrollY.get()) return;
    scrollTo(scrollRef, 0, next, false);
    scrollY.set(next);
    updateSlot(pointerAbsY.get());
  }, false);

  useEffect(() => {
    autoScroll.setActive(lifted !== null);
  }, [lifted, autoScroll]);

  const ghostStyle = useAnimatedStyle(() => {
    const l = lift.get();
    const dy = transY.get() + scrollY.get() - startScroll.get();
    return {
      transform: [{ translateX: transX.get() }, { translateY: dy }, { scale: 1 + 0.04 * l }, { rotate: `${-4 * l}deg` }],
    };
  });

  const barStyle = useAnimatedStyle(() => {
    const from = dragging.get();
    const s = slot.get();
    const moving = from >= 0 && moveIndex(from, s, count) >= 0;
    const b = dropBar(m, s < 0 ? 0 : s, count, rtl);
    return { ...physicalLeft(b.x), top: b.y, height: b.h, opacity: moving ? 1 : 0 };
  });

  // ----- cells

  const cells: ReactNode[] = [];
  const last = Math.min(range.last, count - 1);
  for (let i = Math.max(0, range.first); i <= last; i++) {
    const id = pageIds[i];
    const o = cellOrigin(m, i, rtl);
    cells.push(
      <Cell
        key={id}
        session={session}
        pageId={id}
        index={i}
        count={count}
        version={session.pageVersion(id)}
        metrics={m}
        x={o.x}
        y={o.y}
        current={id === current}
        selectMode={selectMode}
        selected={selected.has(id)}
        defaults={defaults}
        dimmed={lifted?.id === id}
        canMove={reorderOn}
        onTap={onTap}
        onMove={onMove}
        onMenu={onMenu}
      />,
    );
  }
  const addAt = cellOrigin(m, count, rtl);
  const ghostAt = lifted ? cellOrigin(m, Math.min(lifted.index, Math.max(0, count - 1)), rtl) : null;

  const grid = useMemo(() => ({ width: m.width, height: gridH }), [m.width, gridH]);

  return (
    <View ref={outerRef} collapsable={false} style={styles.flex} onLayout={onViewportLayout}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={lifted === null}
        contentContainerStyle={{ paddingHorizontal: padX, paddingBottom: bottomInset }}
        showsVerticalScrollIndicator>
        <View onLayout={(e) => setHdrH(e.nativeEvent.layout.height)}>{header}</View>
        <GestureDetector gesture={pan}>
          <View collapsable={false} style={[styles.grid, grid]}>
            {cells}
            <View style={[styles.cell, { top: addAt.y, width: m.cellW }, physicalLeft(addAt.x)]}>
              <AddPageTile boxW={m.cellW} boxH={m.thumbH} onPress={onAddEnd} disabled={readOnly} />
            </View>
            <Animated.View pointerEvents="none" style={[styles.dropBar, barStyle]} />
            {lifted && ghostAt ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.cell, styles.ghost, { top: ghostAt.y, width: m.cellW }, physicalLeft(ghostAt.x), ghostStyle]}>
                <PageThumb
                  session={session}
                  pageId={lifted.id}
                  index={lifted.index}
                  boxW={m.cellW}
                  boxH={m.thumbH}
                  labelH={m.labelH}
                  version={session.pageVersion(lifted.id)}
                  defaults={defaults}
                  current={lifted.id === current}
                  lifted
                />
              </Animated.View>
            ) : null}
          </View>
        </GestureDetector>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { position: 'relative', alignSelf: 'center' },
  cell: { position: 'absolute' },
  menuDot: { position: 'absolute', top: 6 },
  menuDotInner: {
    width: MENU_D,
    height: MENU_D,
    borderRadius: MENU_D / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: nbColors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1B2533',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  ghost: { zIndex: 10, elevation: 12 },
  dropBar: { position: 'absolute', width: DROP_BAR_W, borderRadius: 2, backgroundColor: nbColors.accent, zIndex: 9 },
});
