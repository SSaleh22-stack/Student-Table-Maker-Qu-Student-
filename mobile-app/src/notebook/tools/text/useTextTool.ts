/**
 * Text boxes (P28, NB-46, Figma 09).
 *
 * useTextTool(ctx) returns the 'text' ToolPlugin:
 * - handler.onTap (JS, through scheduleOnRN while 'text' is the tool): a tap on a text box opens it for
 *   editing; a tap on empty space starts a new box there: TEXT_DEFAULT_WIDTH (240 pt) wide, size 18,
 *   the pen color as it shows on this page, not bold, with the recording mark (ctx.recMark()). A new
 *   box grows from the tap toward the end of the reading direction: in Arabic its right edge is at the
 *   tap, in English its left edge. Its first line is centred on the tap.
 * - overlay: <TextEditorOverlay/> (TextInput over the page plus the TextFormatBar). Render it with the
 *   other canvas overlays.
 * - onActivate starts loading the Skia text fonts; onDeactivate writes the box being edited.
 *
 * Editing itself (draft, one undo step per edit, box.h from the Skia layout, selection.hidden) is in
 * TextEditorOverlay.tsx; everything is re-exported here.
 *
 * RESIZING (P27 handles): a text box changes only box.w and REFLOWS (the font size stays). After such
 * a change call reflowTextItem(item, newW) (or fitTextBox(item) when box.w is already set) before
 * session.updateItems, so box.h follows the new wrapping.
 */
import { createElement, useEffect, useMemo } from 'react';

import { getLang } from '@/lib/i18n';
import type { PagePoint, ToolContext, ToolPlugin, UseTextTool } from '@/notebook/contracts/tools';
import { pointInBox } from '@/notebook/core/ink/bounds';
import { newId, type Hex, type Page, type PaperColor, type RecMark, type TextItem } from '@/notebook/core/model';
import type { NotebookSession } from '@/notebook/core/session/types';
import { effectivePenColor } from '@/notebook/core/toolbar/colors';
import { loadNotebookFonts } from '@/notebook/ink';
import { getToolState } from '@/notebook/toolbar/toolState';

import { commitTextEdit, openTextEditor, TEXT_LINE_FACTOR, TextEditorOverlay, textEditStore } from './TextEditorOverlay';

export {
  TEXT_HISTORY_LABEL,
  TEXT_LINE_FACTOR,
  TEXT_MAX_LENGTH,
  TextEditorOverlay,
  commitTextEdit,
  deleteTextEdit,
  fitTextBox,
  openTextEditor,
  reflowTextItem,
  textEditStore,
  updateTextDraft,
  type TextEditState,
  type TextEditorOverlayProps,
} from './TextEditorOverlay';
export { TEXT_MAX_SIZE, TEXT_MIN_SIZE, TEXT_SIZES, TextFormatBar, type TextFormatBarProps } from './TextFormatBar';

/** Width of a new text box (page points). */
export const TEXT_DEFAULT_WIDTH = 240;
/** Font size of a new text box (points). */
export const TEXT_DEFAULT_SIZE = 18;
/** How close (page points) a tap must be to a text box to open it. */
export const TEXT_TAP_PAD = 6;

/** The top-most text box at (x, y) on the page, or null. */
export function textAt(page: Page | undefined, x: number, y: number, pad: number = TEXT_TAP_PAD): TextItem | null {
  if (!page) return null;
  for (let i = page.items.length - 1; i >= 0; i--) {
    const it = page.items[i];
    if (it.kind === 'text' && pointInBox(it.box, x, y, pad)) return it;
  }
  return null;
}

function paperOf(page: Page | undefined): PaperColor {
  if (!page) return 'white';
  return page.background.kind === 'pdf' ? 'white' : page.background.paper.color;
}

/**
 * A new, empty box for a tap at (x, y): its first line centred on the tap, its reading-start edge at
 * the tap (rtl: the right edge), kept on the page.
 */
export function newTextItem(page: Page | undefined, x: number, y: number, color: Hex, rec: RecMark | undefined, rtl: boolean): TextItem {
  const w = TEXT_DEFAULT_WIDTH;
  const lineH = TEXT_DEFAULT_SIZE * TEXT_LINE_FACTOR;
  let bx = rtl ? x - w : x;
  let by = y - lineH / 2;
  if (page) {
    bx = Math.min(Math.max(0, bx), Math.max(0, page.size.w - w));
    by = Math.min(Math.max(0, by), Math.max(0, page.size.h - lineH));
  }
  const item: TextItem = {
    id: newId(),
    kind: 'text',
    box: { x: bx, y: by, w, h: lineH, rot: 0 },
    text: '',
    size: TEXT_DEFAULT_SIZE,
    color,
    bold: false,
    at: Date.now(),
  };
  if (rec) item.rec = { recordingId: rec.recordingId, ms: rec.ms };
  return item;
}

function makeHandler(session: NotebookSession, recMark: () => RecMark | undefined) {
  return {
    onTap(p: PagePoint) {
      if (session.readOnly) return;
      const page = session.getPage(p.pageId);
      const hit = textAt(page, p.x, p.y);
      if (hit) {
        openTextEditor(session, p.pageId, hit, false);
        return;
      }
      if (textEditStore.get()) {
        // A tap beside the open box only closes it.
        commitTextEdit();
        return;
      }
      const color = effectivePenColor(getToolState().state.pen.color, paperOf(page));
      openTextEditor(session, p.pageId, newTextItem(page, p.x, p.y, color, recMark(), getLang() === 'ar'), true);
    },
  };
}

export const useTextTool: UseTextTool = (ctx: ToolContext): ToolPlugin => {
  const { session, recMark } = ctx;

  // Leaving the editor or switching notebooks writes the open box.
  useEffect(() => () => commitTextEdit(), [session]);

  // The handler keeps no state, so a new recMark function simply builds a new one.
  const handler = useMemo(() => makeHandler(session, recMark), [session, recMark]);
  const overlay = useMemo(() => createElement(TextEditorOverlay, { session }), [session]);

  return {
    tool: 'text',
    handler,
    overlay,
    onActivate: () => {
      void loadNotebookFonts();
    },
    onDeactivate: () => commitTextEdit(),
  };
};
