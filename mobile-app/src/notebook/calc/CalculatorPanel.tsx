/**
 * The scientific calculator panel (NB-47a; Figma 22 docked, 23 floating).
 *
 * Header: 'الحاسبة العلمية', then 'عائمة' (docked: turn into a floating window) or 'تثبيت'
 * (floating: dock it again), and close. Under it the calculator body (LCD + keypad). There is no
 * history list. It only calculates; nothing is written onto the page.
 *
 * - docked: fills its parent (the editor docks it on the PHYSICAL LEFT in every language, full height,
 *   CALC_DOCK_WIDTH wide). The border is on the edge that faces the page (its physical right).
 *   Phones (compact): P29 gives it the bottom CALC_PHONE_DOCK_FRACTION of the height; the keys
 *   squeeze to fit and the rest scrolls.
 * - floating: render it in an overlay that fills the editor (it fills its parent itself, with
 *   pointerEvents box-none). Tablets: a CALC_FLOAT_WIDTH window dragged by its top (handle and
 *   header), clamped inside the parent, placed with physicalLeft(0) plus translate transforms, with
 *   the hint 'اسحب من الأعلى لنقلها' for a few seconds. The position is saved ONLY as
 *   setSettings({ calc: { float } }) when a drag ends. Phones: a full-width bottom sheet.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useNotebookSettings } from '@/notebook/store/hooks';
import { CALC_COLORS, nbColors, nbRadius } from '@/notebook/theme';
import { CircleButton, PHYSICAL_ORIGIN, PHYSICAL_SWAP, physicalSides, useWidthClass } from '@/notebook/ui';
import { tr } from '@/lib/i18n';
import { useScreenInsets } from '@/lib/insets';
import { row } from '@/lib/rtl';
import { shadow } from '@/lib/theme';

import { Keypad } from './Keypad';
import { Lcd, lcdGeometry } from './Lcd';
import { useCalculator } from './useCalculator';

export type CalcPanelMode = 'docked' | 'floating';

/** Docked panel width on tablets (Figma 22). */
export const CALC_DOCK_WIDTH = 360;
/** Floating window width on tablets (Figma 23). */
export const CALC_FLOAT_WIDTH = 360;
/** Phones: the docked panel's share of the editor height. */
export const CALC_PHONE_DOCK_FRACTION = 0.45;

const PANEL_PAD = 12;
const BODY_PAD = 12;
const GAP = 12;
const HEADER_H = 34;
const HANDLE_H = 5;
const HINT_MS = 3500;
/** Gap kept between a floating window and its parent's edges. */
const EDGE = 8;

export interface CalculatorPanelProps {
  mode: CalcPanelMode;
  onModeChange(mode: CalcPanelMode): void;
  onClose(): void;
}

// ===== pieces

function Header({ mode, onModeChange, onClose }: CalculatorPanelProps) {
  const docked = mode === 'docked';
  const label = docked ? tr('عائمة', 'Float') : tr('تثبيت', 'Dock');
  return (
    <View style={[styles.header, { flexDirection: row }]}>
      <AppText size={17} weight="bold" numberOfLines={1} style={styles.title}>
        {tr('الحاسبة العلمية', 'Scientific calculator')}
      </AppText>
      <Pressable
        onPress={() => onModeChange(docked ? 'floating' : 'docked')}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={docked ? tr('تحويل الحاسبة إلى نافذة متحركة', 'Turns the calculator into a movable window') : tr('تثبيت الحاسبة بجانب الصفحة', 'Docks the calculator beside the page')}
        hitSlop={6}
        style={({ pressed }) => [styles.modeBtn, { flexDirection: row }, pressed ? styles.pressed : null]}>
        <Icon name={docked ? 'popOut' : 'dock'} size={18} color={nbColors.accentDark} />
        <AppText size={13} weight="semibold" color={nbColors.accentDark}>
          {label}
        </AppText>
      </Pressable>
      <CircleButton icon="x" label={tr('إغلاق الحاسبة', 'Close calculator')} onPress={onClose} tone="muted" size={HEADER_H} iconSize={16} />
    </View>
  );
}

/** Top of the dark body: the LCD. It stays in view (sticky) while the keys scroll. */
function BodyTop({ width, dense }: { width: number; dense?: boolean }) {
  const calc = useCalculator();
  return (
    <View style={[styles.bodyTop, { width, padding: BODY_PAD, paddingBottom: GAP }]}>
      <Lcd machine={calc.machine} width={width - 2 * BODY_PAD} dense={dense} onTapInput={calc.setCursor} />
    </View>
  );
}

/** Height of BodyTop for a body width. */
const bodyTopHeight = (width: number, dense?: boolean): number => BODY_PAD + GAP + lcdGeometry(width - 2 * BODY_PAD, dense).height;

/** The rest of the dark body: the keypad. */
function BodyKeys({ width, maxHeight }: { width: number; maxHeight?: number }) {
  const calc = useCalculator();
  return (
    <View style={[styles.bodyKeys, { width, paddingHorizontal: BODY_PAD, paddingBottom: BODY_PAD }]}>
      <Keypad
        width={width - 2 * BODY_PAD}
        maxHeight={maxHeight === undefined ? undefined : maxHeight - BODY_PAD}
        shift={calc.machine.shift}
        alpha={calc.machine.alpha}
        onPress={calc.press}
      />
    </View>
  );
}

function Handle() {
  return (
    <View style={styles.handleRow}>
      <View style={styles.handle} />
    </View>
  );
}

// ===== docked

function DockedPanel(props: CalculatorPanelProps) {
  const compact = useWidthClass() === 'compact';
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((p) => (p && p.w === width && p.h === height ? p : { w: width, h: height }));
  };
  // Border on the edge facing the page: the dock is on the physical left, so its physical right edge
  // (the logical 'right' style edge is swapped in RTL when the platform swaps left and right).
  const border = compact ? { borderTopWidth: 1 } : PHYSICAL_SWAP ? { borderLeftWidth: 1 } : { borderRightWidth: 1 };
  const bodyW = size ? size.w - 2 * PANEL_PAD : 0;
  // Phones: the keys should fit under the header and the LCD; they squeeze down to 72 percent and
  // the rest scrolls under the LCD, which stays in view.
  const keysMax = compact && size ? size.h - 2 * PANEL_PAD - HEADER_H - GAP - bodyTopHeight(bodyW, true) : undefined;
  return (
    <View style={[styles.docked, border, { padding: PANEL_PAD, gap: GAP }]} onLayout={onLayout}>
      <Header {...props} />
      {size && bodyW > 120 ? (
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 4 }} stickyHeaderIndices={[0]} showsVerticalScrollIndicator={false}>
          <BodyTop width={bodyW} dense={compact} />
          <BodyKeys width={bodyW} maxHeight={keysMax} />
        </ScrollView>
      ) : null}
    </View>
  );
}

// ===== floating

function MoveHint() {
  return (
    <View style={[styles.hint, { flexDirection: row }]} pointerEvents="none">
      <Icon name="hand" size={16} color={nbColors.white} />
      <AppText size={12} weight="medium" color={nbColors.white}>
        {tr('اسحب من الأعلى لنقلها', 'Drag from the top to move it')}
      </AppText>
    </View>
  );
}

const clampTo = (v: number, lo: number, hi: number): number => {
  'worklet';
  return Math.max(lo, Math.min(Math.max(lo, hi), v));
};

function FloatingWindow(props: CalculatorPanelProps) {
  const [settings, setSettings] = useNotebookSettings();
  const saved = settings.calc.float;
  const [bounds, setBounds] = useState<{ w: number; h: number } | null>(null);
  const [panelH, setPanelH] = useState(0);
  const [hint, setHint] = useState(true);
  const x = useSharedValue(saved.x);
  const y = useSharedValue(saved.y);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const maxX = useSharedValue(0);
  const maxY = useSharedValue(0);

  // Clamp against the parent and the window's own height (rotation, split view, a saved spot from
  // a bigger screen). Only a drag writes the position.
  useEffect(() => {
    if (!bounds) return;
    const mx = bounds.w - CALC_FLOAT_WIDTH - EDGE;
    const my = bounds.h - Math.min(panelH, bounds.h) - EDGE;
    maxX.set(mx);
    maxY.set(my);
    x.set(clampTo(saved.x, EDGE, mx));
    y.set(clampTo(saved.y, EDGE, my));
  }, [bounds, panelH, saved.x, saved.y, maxX, maxY, x, y]);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(t);
  }, []);

  const save = useCallback(
    (nx: number, ny: number) => {
      setSettings({ calc: { float: { x: Math.round(nx), y: Math.round(ny) } } });
    },
    [setSettings],
  );
  const hideHint = useCallback(() => setHint(false), []);

  const pan = usePanGesture({
    minDistance: 4,
    onBegin: () => {
      'worklet';
      sx.set(x.get());
      sy.set(y.get());
    },
    onActivate: () => {
      'worklet';
      scheduleOnRN(hideHint);
    },
    onUpdate: (e) => {
      'worklet';
      x.set(clampTo(sx.get() + e.translationX, EDGE, maxX.get()));
      y.set(clampTo(sy.get() + e.translationY, EDGE, maxY.get()));
    },
    onDeactivate: () => {
      'worklet';
      scheduleOnRN(save, x.get(), y.get());
    },
  });

  const place = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }] }));

  const maxH = bounds ? bounds.h - 2 * EDGE : undefined;
  const bodyW = CALC_FLOAT_WIDTH - 2 * PANEL_PAD;
  // Room above the window for the hint (from the saved spot; the hint hides once a drag starts).
  const hintAbove = saved.y > 48;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBounds((p) => (p && p.w === width && p.h === height ? p : { w: width, h: height }));
      }}>
      {bounds ? (
        <Animated.View style={[styles.floatPlace, PHYSICAL_ORIGIN, { width: CALC_FLOAT_WIDTH }, place]} pointerEvents="box-none">
          {hint && hintAbove ? (
            <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.hintAbove} pointerEvents="none">
              <MoveHint />
            </Animated.View>
          ) : null}
          <View
            style={[styles.floating, shadow, { maxHeight: maxH, padding: PANEL_PAD, gap: GAP }]}
            onLayout={(e) => {
              const h = Math.round(e.nativeEvent.layout.height);
              setPanelH((p) => (p === h ? p : h));
            }}>
            <GestureDetector gesture={pan}>
              <View collapsable={false} style={{ gap: GAP }} accessibilityHint={tr('اسحب من الأعلى لنقلها', 'Drag from the top to move it')}>
                <Handle />
                <Header {...props} />
              </View>
            </GestureDetector>
            <ScrollView style={styles.scroll} stickyHeaderIndices={[0]} showsVerticalScrollIndicator={false} bounces={false}>
              <BodyTop width={bodyW} />
              <BodyKeys width={bodyW} />
            </ScrollView>
          </View>
          {hint && !hintAbove ? (
            <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.hintBelow} pointerEvents="none">
              <MoveHint />
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Phones: the floating calculator is a full-width bottom sheet. */
function FloatingSheet(props: CalculatorPanelProps) {
  const insets = useScreenInsets();
  const [w, setW] = useState(0);
  const side = Math.max(insets.left, insets.right);
  const sheetBodyW = Math.min(w - 2 * PANEL_PAD - 2 * side, 480);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View
        style={[styles.sheet, shadow, physicalSides(0, 0), { paddingBottom: insets.bottom + PANEL_PAD, paddingTop: PANEL_PAD, gap: GAP }]}
        onLayout={(e) => {
          const width = Math.round(e.nativeEvent.layout.width);
          setW((p) => (p === width ? p : width));
        }}>
        <View style={{ paddingHorizontal: PANEL_PAD + side, gap: GAP }}>
          <Handle />
          <Header {...props} />
        </View>
        {w > 0 ? (
          <ScrollView style={styles.scroll} contentContainerStyle={{ alignItems: 'center' }} stickyHeaderIndices={[0]} showsVerticalScrollIndicator={false} bounces={false}>
            <BodyTop width={sheetBodyW} />
            <BodyKeys width={sheetBodyW} />
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

// ===== panel

export function CalculatorPanel(props: CalculatorPanelProps) {
  const compact = useWidthClass() === 'compact';
  if (props.mode === 'docked') return <DockedPanel {...props} />;
  return compact ? <FloatingSheet {...props} /> : <FloatingWindow {...props} />;
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: 8, height: HEADER_H },
  title: { flex: 1 },
  modeBtn: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: nbRadius.pill,
    backgroundColor: nbColors.accentTint,
  },
  pressed: { opacity: 0.75 },
  bodyTop: {
    backgroundColor: CALC_COLORS.body,
    borderTopLeftRadius: nbRadius.folder,
    borderTopRightRadius: nbRadius.folder,
    alignItems: 'center',
  },
  bodyKeys: {
    backgroundColor: CALC_COLORS.body,
    borderBottomLeftRadius: nbRadius.folder,
    borderBottomRightRadius: nbRadius.folder,
    alignItems: 'center',
  },
  docked: { flex: 1, backgroundColor: nbColors.surface, borderColor: nbColors.border },
  scroll: { flexGrow: 0, flexShrink: 1 },
  handleRow: { alignItems: 'center' },
  handle: { width: 44, height: HANDLE_H, borderRadius: 3, backgroundColor: nbColors.borderStrong },
  floatPlace: { position: 'absolute', top: 0 },
  floating: { backgroundColor: nbColors.surface, borderRadius: nbRadius.bar },
  sheet: {
    position: 'absolute',
    bottom: 0,
    maxHeight: '92%',
    backgroundColor: nbColors.surface,
    borderTopLeftRadius: nbRadius.bar,
    borderTopRightRadius: nbRadius.bar,
  },
  hint: {
    alignItems: 'center',
    gap: 6,
    backgroundColor: nbColors.text,
    borderRadius: nbRadius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    opacity: 0.92,
  },
  hintAbove: { position: 'absolute', bottom: '100%', marginBottom: 10, width: CALC_FLOAT_WIDTH, alignItems: 'center' },
  hintBelow: { marginTop: 10, alignItems: 'center' },
});
