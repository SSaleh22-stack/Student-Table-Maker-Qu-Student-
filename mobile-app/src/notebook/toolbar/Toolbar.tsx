/**
 * The notebook toolbar (P13, Figma 06 and 19-21, NB-39 to NB-48, NB-51).
 *
 * Full bar, in Figma order along the reading direction (right to left in Arabic, top to bottom when
 * vertical): grip, pen, highlighter, eraser, lasso, shapes, ruler (toggle), text, image (an ACTION
 * calling onImage, not a tool), calculator (toggle), separator, 5 pen colors, separator, undo and redo,
 * separator, recordSlot.
 * - The pen and highlighter buttons carry a small dot in their current color (Figma 06). On dark paper
 *   the pen dot and the black swatch show the light ink the pen draws there (NB-21).
 * - Undo comes before redo in reading order: in Arabic undo is the RIGHT button (its arrow points
 *   right, Icon 'undoAction'); in a vertical bar undo is on top (NB-48).
 * - A tap on a tool selects it; a second tap on the selected pen, highlighter, eraser or shapes opens
 *   its options card, placed away from the writing hand (core/toolbar/hand.ts).
 *
 * Compact bar (compact = phone width, or the full bar does not fit its slot: dock.ts fitsInline):
 * grip, pen, highlighter, eraser, lasso, more, separator, undo, redo, separator, recordSlot. The colors
 * are not on the bar: the pen button shows the current color, and the second tap on the pen opens the
 * pen options with the color row first. The more menu holds shapes, ruler, text, image and calculator.
 *
 * Tour targets: ed.toolbar (the bar), ed.grip (the grip) and ed.undo (undo + redo). ed.record is on
 * the recordSlot wrapper the editor passes in (P29).
 *
 * Accessibility: every button has a label and a hint from toolMeta; toggles announce their state;
 * the grip offers screen-reader actions to move the bar to the other edges (onMoveTo).
 */
import { useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/Icon';
import { getLang } from '@/lib/i18n';
import { row } from '@/lib/rtl';
import { colors } from '@/lib/theme';
import { TOUR_TARGETS } from '@/notebook/contracts/tours';
import type { PaperColor } from '@/notebook/core/model';
import { PEN_PALETTE, colorName, effectivePenColor, penPalette, sameColor } from '@/notebook/core/toolbar/colors';
import { BAR, isVertical, TOOLBAR_POSITIONS, type ToolbarPos } from '@/notebook/core/toolbar/dock';
import type { Hand } from '@/notebook/core/toolbar/hand';
import { nbRadius } from '@/notebook/theme';
import { ColorDot, useTourTarget, type AnchorRect } from '@/notebook/ui';

import { EraserOptions } from './EraserOptions';
import { HighlighterOptions } from './HighlighterOptions';
import { MoreToolsMenu } from './MoreToolsMenu';
import { PenOptions } from './PenOptions';
import { ShapeOptions } from './ShapeOptions';
import { moveActionLabel, toolMeta, type ToolbarItemId } from './toolMeta';
import { useToolState } from './toolState';
import { BarSeparator, measureAnchor, ToolButton, type ViewNode } from './ToolButton';

export interface ToolbarProps {
  /** The position the bar is shown at (already the effective one: editorFrames().pos). */
  pos: ToolbarPos;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  calcOpen: boolean;
  onToggleCalc: () => void;
  /** The record button (P12), wrapped by the editor in the ed.record tour target. */
  recordSlot?: ReactNode;
  /** The image action (P27 useImageTool().openSource). */
  onImage: () => void;
  /** Paper color of the current page (dark paper shows the light pen ink). */
  paperColor: PaperColor;
  /** Phone layout: true on compact windows or when the full bar does not fit (dock.ts fitsInline). */
  compact: boolean;
  /** The writing hand: option cards open away from it. */
  hand: Hand;
  /** Button size (default 40, or 36 when compact); pass dock.ts fitButtonSize for tight slots. */
  buttonSize?: number;
  /** Screen-reader actions on the grip move the bar here (MovableToolbar passes it). */
  onMoveTo?: (pos: ToolbarPos) => void;
  /** Positions the move actions offer (default all four; portrait phones only top and bottom). */
  positions?: readonly ToolbarPos[];
  style?: StyleProp<ViewStyle>;
}

type Panel = 'pen' | 'highlighter' | 'eraser' | 'shapes' | 'more';

const BAR_SHADOW = Platform.select({
  ios: { shadowColor: '#1B2533', shadowOpacity: 0.1, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  android: { elevation: 6 },
  default: { boxShadow: '0 8px 24px rgba(27, 37, 51, 0.10)' },
}) as object;

export function Toolbar({
  pos,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  calcOpen,
  onToggleCalc,
  recordSlot,
  onImage,
  paperColor,
  compact,
  hand,
  buttonSize,
  onMoveTo,
  positions = TOOLBAR_POSITIONS,
  style,
}: ToolbarProps) {
  const { state, actions } = useToolState();
  const vertical = isVertical(pos);
  const size = buttonSize ?? (compact ? BAR.compactButton : BAR.button);
  const barRef = useTourTarget(TOUR_TARGETS.edToolbar);
  const gripRef = useTourTarget(TOUR_TARGETS.edGrip);
  const undoRef = useTourTarget(TOUR_TARGETS.edUndo);

  const refs = {
    pen: useRef<ViewNode>(null),
    highlighter: useRef<ViewNode>(null),
    eraser: useRef<ViewNode>(null),
    shapes: useRef<ViewNode>(null),
    more: useRef<ViewNode>(null),
  };
  const [panel, setPanel] = useState<{ id: Panel; anchor: AnchorRect } | null>(null);
  const close = () => setPanel(null);

  const open = (id: Panel, anchorRef: ViewNode | null) => {
    void measureAnchor(anchorRef).then((anchor) => {
      if (anchor) setPanel({ id, anchor });
    });
  };

  const penDot = effectivePenColor(state.pen.color, paperColor);

  const pressTool = (id: ToolbarItemId) => {
    switch (id) {
      case 'pen':
      case 'highlighter':
      case 'eraser':
      case 'shapes':
        if (state.tool === id) open(id, refs[id].current);
        else actions.setTool(id);
        return;
      case 'lasso':
        actions.setTool('lasso');
        return;
      case 'text':
        actions.setTool('text');
        return;
      case 'ruler':
        actions.toggleRuler();
        return;
      case 'image':
        onImage();
        return;
      case 'calculator':
        onToggleCalc();
        return;
      case 'more':
        open('more', refs.more.current);
        return;
      default:
        return;
    }
  };

  const toolButton = (id: ToolbarItemId) => {
    const m = toolMeta(id);
    const isOptionTool = id === 'pen' || id === 'highlighter' || id === 'eraser' || id === 'shapes';
    const active =
      id === 'more'
        ? state.tool === 'shapes' || state.tool === 'text'
        : id === 'ruler'
          ? state.rulerOn
          : id === 'calculator'
            ? calcOpen
            : id === 'image'
              ? false
              : state.tool === id;
    const checked = id === 'ruler' ? state.rulerOn : id === 'calculator' ? calcOpen : undefined;
    return (
      <ToolButton
        key={id}
        ref={isOptionTool || id === 'more' ? refs[id as Panel] : undefined}
        icon={m.icon}
        label={m.label}
        hint={m.hint}
        active={active}
        checked={checked}
        size={size}
        dotColor={id === 'pen' ? penDot : id === 'highlighter' ? state.highlighter.color : undefined}
        onPress={() => pressTool(id)}
      />
    );
  };

  const lang = getLang();
  const swatches = penPalette(paperColor).map((shown, i) => {
    const stored = PEN_PALETTE[i];
    return (
      <ColorDot
        key={stored}
        color={shown}
        size={Math.round(size * 0.6)}
        selected={sameColor(state.pen.color, stored)}
        label={colorName(shown, lang)}
        onPress={() => {
          actions.setPen({ color: stored });
          if (state.tool !== 'pen' && state.tool !== 'shapes' && state.tool !== 'text') actions.setTool('pen');
        }}
      />
    );
  });

  const gripMeta = toolMeta('grip');
  const moveTargets = positions.filter((p) => p !== pos);
  const onGripAction = (e: AccessibilityActionEvent) => {
    const target = moveTargets.find((p) => p === e.nativeEvent.actionName);
    if (target && onMoveTo) onMoveTo(target);
  };

  const sep = (key: string) => <BarSeparator key={key} vertical={vertical} length={Math.round(size * 0.7)} />;
  const tools = compact
    ? (['pen', 'highlighter', 'eraser', 'lasso', 'more'] as const)
    : (['pen', 'highlighter', 'eraser', 'lasso', 'shapes', 'ruler', 'text', 'image', 'calculator'] as const);
  const undoMeta = toolMeta('undo');
  const redoMeta = toolMeta('redo');
  const direction = vertical ? 'column' : row;

  return (
    <>
      <View
        ref={barRef}
        collapsable={false}
        style={[
          styles.bar,
          BAR_SHADOW,
          {
            flexDirection: direction,
            gap: BAR.gap,
            paddingHorizontal: vertical ? BAR.padCross : BAR.padMain,
            paddingVertical: vertical ? BAR.padMain : BAR.padCross,
          },
          style,
        ]}>
        <View
          ref={gripRef}
          collapsable={false}
          accessible
          accessibilityLabel={gripMeta.label}
          accessibilityHint={gripMeta.hint}
          accessibilityActions={onMoveTo ? moveTargets.map((p) => ({ name: p, label: moveActionLabel(p) })) : undefined}
          onAccessibilityAction={onMoveTo ? onGripAction : undefined}
          style={[styles.grip, vertical ? { width: size, height: BAR.grip } : { width: BAR.grip, height: size }]}>
          <Icon name={vertical ? 'gripH' : 'grip'} size={18} color={colors.placeholder} strokeWidth={2.8} />
        </View>

        {tools.map((id) => toolButton(id))}

        {compact ? null : (
          <>
            {sep('s1')}
            {swatches}
          </>
        )}
        {sep('s2')}
        <View ref={undoRef} collapsable={false} style={[styles.pair, { flexDirection: direction, gap: BAR.gap }]}>
          <ToolButton icon={undoMeta.icon} label={undoMeta.label} hint={undoMeta.hint} size={size} disabled={!canUndo} onPress={onUndo} />
          <ToolButton icon={redoMeta.icon} label={redoMeta.label} hint={redoMeta.hint} size={size} disabled={!canRedo} onPress={onRedo} />
        </View>
        {recordSlot ? (
          <>
            {sep('s3')}
            {recordSlot}
          </>
        ) : null}
      </View>

      <PenOptions
        visible={panel?.id === 'pen'}
        anchor={panel?.id === 'pen' ? panel.anchor : null}
        barPos={pos}
        hand={hand}
        paperColor={paperColor}
        colorsFirst={compact}
        onClose={close}
      />
      <HighlighterOptions
        visible={panel?.id === 'highlighter'}
        anchor={panel?.id === 'highlighter' ? panel.anchor : null}
        barPos={pos}
        hand={hand}
        onClose={close}
      />
      <EraserOptions
        visible={panel?.id === 'eraser'}
        anchor={panel?.id === 'eraser' ? panel.anchor : null}
        barPos={pos}
        hand={hand}
        onClose={close}
      />
      <ShapeOptions
        visible={panel?.id === 'shapes'}
        anchor={panel?.id === 'shapes' ? panel.anchor : null}
        barPos={pos}
        hand={hand}
        onClose={close}
      />
      <MoreToolsMenu
        visible={panel?.id === 'more'}
        anchor={panel?.id === 'more' ? panel.anchor : null}
        barPos={pos}
        hand={hand}
        onClose={close}
        calcOpen={calcOpen}
        onToggleCalc={onToggleCalc}
        onImage={onImage}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderRadius: nbRadius.card,
    alignItems: 'center',
    alignSelf: 'center',
  },
  grip: { alignItems: 'center', justifyContent: 'center' },
  pair: { alignItems: 'center' },
});
