/**
 * Labels, hints and icons of every toolbar button (P13). The toolbar, the more menu and the option
 * popovers read their screen-reader names from here (PRD 9 accessibility: every toolbar button has a
 * label and a hint). Labels match the Figma TOOLS table (قلم، تظليل، ممحاة، تحديد، أشكال، مسطرة، نص،
 * صورة، آلة حاسبة).
 *
 * Call the functions at render time (tr() follows the current language).
 */
import type { IconName } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import type { ShapeKind } from '@/notebook/core/model';

/** Every button the toolbar can show, in the full (tablet) order. */
export type ToolbarItemId =
  'grip' | 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shapes' | 'ruler' | 'text' | 'image' | 'calculator' | 'undo' | 'redo' | 'more';

export interface ToolMeta {
  icon: IconName;
  label: string;
  hint: string;
}

/** Items in the full bar, in Figma order (colors, separators and the record slot are added by Toolbar). */
export const FULL_TOOL_ORDER: readonly ToolbarItemId[] = [
  'pen',
  'highlighter',
  'eraser',
  'lasso',
  'shapes',
  'ruler',
  'text',
  'image',
  'calculator',
];

/** Tools on the compact (phone) bar; the rest are in the more menu. */
export const COMPACT_TOOL_ORDER: readonly ToolbarItemId[] = ['pen', 'highlighter', 'eraser', 'lasso'];

/** Tools that live in the more menu on the compact bar, in menu order. */
export const MORE_MENU_ORDER: readonly ToolbarItemId[] = ['shapes', 'ruler', 'text', 'image', 'calculator'];

export function toolMeta(id: ToolbarItemId): ToolMeta {
  switch (id) {
    case 'grip':
      return {
        icon: 'grip',
        label: tr('نقل شريط الأدوات', 'Move toolbar'),
        hint: tr('اضغط مطولاً على الشريط، ثم اسحبه وأفلته عند أي حافة', 'Long-press the toolbar, then drag it to any edge'),
      };
    case 'pen':
      return { icon: 'pen', label: tr('قلم', 'Pen'), hint: tr('اضغط مرة أخرى لخيارات القلم', 'Tap again for pen options') };
    case 'highlighter':
      return {
        icon: 'highlighter',
        label: tr('تظليل', 'Highlighter'),
        hint: tr('اضغط مرة أخرى لخيارات التظليل', 'Tap again for highlighter options'),
      };
    case 'eraser':
      return {
        icon: 'eraser',
        label: tr('ممحاة', 'Eraser'),
        hint: tr('اضغط مرة أخرى لخيارات الممحاة', 'Tap again for eraser options'),
      };
    case 'lasso':
      return {
        icon: 'lasso',
        label: tr('تحديد', 'Lasso'),
        hint: tr('ارسم حول الكتابة لتحديدها ثم نقلها أو تعديلها', 'Draw around ink to select, move or edit it'),
      };
    case 'shapes':
      return {
        icon: 'shapes',
        label: tr('أشكال', 'Shapes'),
        hint: tr('اضغط مرة أخرى لاختيار الشكل', 'Tap again to choose the shape'),
      };
    case 'ruler':
      return {
        icon: 'ruler',
        label: tr('مسطرة', 'Ruler'),
        hint: tr('يُظهر المسطرة أو يخفيها. حرّكها وأدرها بإصبعين', 'Shows or hides the ruler. Move and turn it with two fingers'),
      };
    case 'text':
      return { icon: 'type', label: tr('نص', 'Text'), hint: tr('اضغط على الصفحة لإضافة مربع نص', 'Tap the page to add a text box') };
    case 'image':
      return {
        icon: 'image',
        label: tr('صورة', 'Image'),
        hint: tr('أضف صورة من الصور أو الكاميرا', 'Add a picture from Photos or the camera'),
      };
    case 'calculator':
      return {
        icon: 'calculator',
        label: tr('آلة حاسبة', 'Calculator'),
        hint: tr('يفتح الآلة الحاسبة أو يغلقها', 'Opens or closes the calculator'),
      };
    case 'undo':
      return { icon: 'undoAction', label: tr('تراجع', 'Undo'), hint: tr('يلغي آخر تغيير', 'Undoes the last change') };
    case 'redo':
      return { icon: 'redoAction', label: tr('إعادة', 'Redo'), hint: tr('يعيد ما تراجعت عنه', 'Redoes what you undid') };
    case 'more':
      return {
        icon: 'more',
        label: tr('أدوات أخرى', 'More tools'),
        hint: tr('الأشكال والمسطرة والنص والصورة والآلة الحاسبة', 'Shapes, ruler, text, image and calculator'),
      };
  }
}

/** Labels of the drop zones and the move actions (Figma 18). */
export function positionLabel(pos: 'top' | 'bottom' | 'left' | 'right'): string {
  switch (pos) {
    case 'top':
      return tr('أعلى', 'Top');
    case 'bottom':
      return tr('أسفل', 'Bottom');
    case 'left':
      return tr('يسار', 'Left');
    case 'right':
      return tr('يمين', 'Right');
  }
}

/** The screen-reader action that moves the bar to a position. */
export function moveActionLabel(pos: 'top' | 'bottom' | 'left' | 'right'): string {
  switch (pos) {
    case 'top':
      return tr('نقل الشريط إلى الأعلى', 'Move toolbar to the top');
    case 'bottom':
      return tr('نقل الشريط إلى الأسفل', 'Move toolbar to the bottom');
    case 'left':
      return tr('نقل الشريط إلى اليسار', 'Move toolbar to the left');
    case 'right':
      return tr('نقل الشريط إلى اليمين', 'Move toolbar to the right');
  }
}

/** The drag hint pill (Figma 18). */
export function dragHintText(): string {
  return tr('اضغط مطولاً على الشريط، ثم اسحبه وأفلته عند أي حافة', 'Long-press the toolbar, then drag and drop it at any edge');
}

export type DrawShapeKind = Exclude<ShapeKind, 'polygon'>;

/** The shapes the shape tool draws, in picker order. */
export const SHAPE_KINDS: readonly DrawShapeKind[] = ['line', 'arrow', 'rect', 'ellipse', 'triangle'];

export function shapeKindMeta(k: DrawShapeKind): { icon: IconName; label: string } {
  switch (k) {
    case 'line':
      return { icon: 'line', label: tr('خط', 'Line') };
    case 'arrow':
      return { icon: 'arrowShape', label: tr('سهم', 'Arrow') };
    case 'rect':
      return { icon: 'square', label: tr('مستطيل', 'Rectangle') };
    case 'ellipse':
      return { icon: 'circle', label: tr('دائرة', 'Ellipse') };
    case 'triangle':
      return { icon: 'triangle', label: tr('مثلث', 'Triangle') };
  }
}

/** Popover titles. */
export const panelTitle = {
  pen: () => tr('القلم', 'Pen'),
  highlighter: () => tr('التظليل', 'Highlighter'),
  eraser: () => tr('الممحاة', 'Eraser'),
  shapes: () => tr('الأشكال', 'Shapes'),
  more: () => tr('أدوات أخرى', 'More tools'),
} as const;
