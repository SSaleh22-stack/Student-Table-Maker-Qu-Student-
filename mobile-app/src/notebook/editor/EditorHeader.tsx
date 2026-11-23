/**
 * The editor's icons-only header (NB-49a, Figma 06 editorTopBar): no title bar, only round buttons
 * floating over the canvas.
 *
 * - Back: a white 40 pt circle with a small shadow at the reading-start top corner (top right in
 *   Arabic). The editor flushes the notebook, then goes back (or opens the library).
 * - The pill at the other corner: pages, share and more in reading order, in one white pill
 *   (padding 4, gap 2, small shadow). The whole pill is the 'ed.actions' tour target (Figma 35
 *   spotlights it as one pill), attached exactly once, here.
 * - Compact windows: 36 pt buttons. The top follows the safe area (`top` is computed by the editor
 *   from the safe inset and the 60 pt header band of editorFrames).
 *
 * A top toolbar on a tablet sits in this same row, between the back button and the pill (headerReserve
 * gives the room they take).
 *
 * Placement is physical: the editor passes the physical left / right offsets (safe insets, or a
 * docked calculator's width on its side), and this file decides which corner is the reading start.
 */
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { tr } from '@/lib/i18n';
import { isRTL, row } from '@/lib/rtl';
import { shadow } from '@/lib/theme';
import { measureAnchor, type ViewNode } from '@/notebook/toolbar/ToolButton';
import { nbColors } from '@/notebook/theme';
import { CircleButton } from '@/notebook/ui/CircleButton';
import { NB_EDGE, useIsCompact } from '@/notebook/ui/layout';
import { physicalLeft, physicalRight } from '@/notebook/ui/physical';
import type { AnchorRect } from '@/notebook/ui/Popover';
import { useTourTarget } from '@/notebook/ui/tourTargets';

/** Distance of the buttons from the screen (or dock) edge (Figma: 16; the same on every notebook screen). */
export const HEADER_SIDE = NB_EDGE;
/** Gap between the header buttons and a toolbar in the same row. */
export const HEADER_BAR_GAP = 12;
const PILL_PAD = 4;
const PILL_GAP = 2;

/**
 * Room the back button (start, reading side) and the actions pill (end) take along the header row,
 * edge gap and the gap to a toolbar in the same row included.
 */
export function headerReserve(size: number): { start: number; end: number } {
  return {
    start: HEADER_SIDE + size + HEADER_BAR_GAP,
    end: HEADER_SIDE + 2 * PILL_PAD + 3 * size + 2 * PILL_GAP + HEADER_BAR_GAP,
  };
}

export interface EditorHeaderProps {
  /** y of the buttons' top edge in the editor container. */
  top: number;
  /** Physical offsets of the two corners from the container's left and right edges. */
  left: number;
  right: number;
  onBack: () => void;
  onPages: () => void;
  onShare: () => void;
  /** Called with the more button's window rect (the menu is anchored to it). */
  onMore: (anchor: AnchorRect | null) => void;
  /** Buttons that cannot be used yet (for example while the notebook is still opening). */
  disabled?: { pages?: boolean; share?: boolean };
}

export function EditorHeader({ top, left, right, onBack, onPages, onShare, onMore, disabled }: EditorHeaderProps) {
  const compact = useIsCompact();
  const size = compact ? 36 : 40;
  const actionsTarget = useTourTarget('ed.actions');
  const moreRef = useRef<ViewNode>(null);

  // Reading start = physical right in Arabic, physical left in English.
  const startPlace = isRTL ? physicalRight(right + HEADER_SIDE) : physicalLeft(left + HEADER_SIDE);
  const endPlace = isRTL ? physicalLeft(left + HEADER_SIDE) : physicalRight(right + HEADER_SIDE);

  const openMore = () => {
    void measureAnchor(moreRef.current).then(onMore);
  };

  return (
    <>
      <View style={[styles.slot, { top }, startPlace]} pointerEvents="box-none">
        <CircleButton
          icon="back"
          label={tr('رجوع', 'Back')}
          hint={tr('يحفظ المذكرة ويعود إلى المكتبة', 'Saves the notebook and goes back to the library')}
          tone="clear"
          size={size}
          onPress={onBack}
          style={[styles.round, { width: size, height: size, borderRadius: size / 2 }]}
        />
      </View>
      <View style={[styles.slot, { top }, endPlace]} pointerEvents="box-none">
        <View ref={actionsTarget} collapsable={false} style={[styles.pill, { flexDirection: row }]}>
          <CircleButton
            icon="layers"
            label={tr('الصفحات', 'Pages')}
            hint={tr('يعرض صفحات المذكرة لترتيبها وإضافة صفحات', 'Shows the pages to reorder and add pages')}
            tone="clear"
            size={size}
            disabled={disabled?.pages}
            onPress={onPages}
          />
          <CircleButton
            icon="share"
            label={tr('مشاركة وتصدير', 'Share and export')}
            tone="clear"
            size={size}
            disabled={disabled?.share}
            onPress={onShare}
          />
          <View ref={moreRef} collapsable={false}>
            <CircleButton icon="moreV" label={tr('المزيد', 'More')} tone="clear" size={size} onPress={openMore} />
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute' },
  round: { backgroundColor: nbColors.surface, ...shadow },
  pill: {
    alignItems: 'center',
    gap: PILL_GAP,
    paddingHorizontal: PILL_PAD,
    borderRadius: 999,
    backgroundColor: nbColors.surface,
    ...shadow,
  },
});
