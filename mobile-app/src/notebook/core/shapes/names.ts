/**
 * Shape names and the hold-to-snap texts (NB-44, Figma 36 and 37).
 *
 * Core cannot call tr(), so every function returns { ar, en }; the UI picks one with
 * tr(t.ar, t.en). Arabic uses the accusative after سيصبح (مستطيلاً, دائرةً) and the genitive after
 * إلى (تحوّل إلى مستطيل), exactly as in the Figma screens:
 * - hint (first 3 snaps only): 'ثبّت القلم لحظة… سيصبح مستطيلاً'
 * - toast after the snap: 'تحوّل إلى مستطيل' followed by the action SNAP_UNDO_LABEL ('تراجع')
 */
import type { ShapeItem } from '../model/index.ts';
import type { ShapeCandidate, ShapeVariant } from './recognize.ts';

export interface ShapeText {
  ar: string;
  en: string;
}

interface NameForms {
  /** Nominative / genitive (after إلى). */
  ar: string;
  /** Accusative (after سيصبح). */
  acc: string;
  en: string;
  /** English indefinite article. */
  an: boolean;
}

const LINE: NameForms = { ar: 'خط مستقيم', acc: 'خطاً مستقيماً', en: 'straight line', an: false };
const ARROW: NameForms = { ar: 'سهم', acc: 'سهماً', en: 'arrow', an: true };
const RECT: NameForms = { ar: 'مستطيل', acc: 'مستطيلاً', en: 'rectangle', an: false };
const SQUARE: NameForms = { ar: 'مربع', acc: 'مربعاً', en: 'square', an: false };
const ELLIPSE: NameForms = { ar: 'شكل بيضاوي', acc: 'شكلاً بيضاوياً', en: 'ellipse', an: true };
const CIRCLE: NameForms = { ar: 'دائرة', acc: 'دائرةً', en: 'circle', an: false };
const TRIANGLE: NameForms = { ar: 'مثلث', acc: 'مثلثاً', en: 'triangle', an: false };
const POLYGON: NameForms = { ar: 'مضلع', acc: 'مضلعاً', en: 'polygon', an: false };
/** By number of sides (4 is a quadrilateral that is not a rectangle). */
const BY_SIDES: Record<number, NameForms> = {
  4: { ar: 'شكل رباعي', acc: 'شكلاً رباعياً', en: 'quadrilateral', an: false },
  5: { ar: 'شكل خماسي', acc: 'شكلاً خماسياً', en: 'pentagon', an: false },
  6: { ar: 'شكل سداسي', acc: 'شكلاً سداسياً', en: 'hexagon', an: false },
  7: { ar: 'شكل سباعي', acc: 'شكلاً سباعياً', en: 'heptagon', an: false },
  8: { ar: 'شكل ثماني', acc: 'شكلاً ثمانياً', en: 'octagon', an: true },
};

/** The undo action next to doneText in the snap toast. */
export const SNAP_UNDO_LABEL: ShapeText = { ar: 'تراجع', en: 'Undo' };

/** Something that can be named: a recognition candidate, a shape item, or a variant (plus sides for polygons). */
export type Nameable = ShapeCandidate | Pick<ShapeItem, 'shape' | 'pts' | 'box'> | { variant: ShapeVariant; sides?: number };

/** square and circle are told apart from rect and ellipse by their exactly equal sides after the snap. */
export function variantOf(s: Nameable): { variant: ShapeVariant; sides: number } {
  'worklet';
  if ('variant' in s) return { variant: s.variant, sides: s.sides ?? 0 };
  const box = s.box;
  const equal = !!box && Math.abs(box.w - box.h) <= 1e-6 * Math.max(1, box.w, box.h);
  switch (s.shape) {
    case 'rect':
      return { variant: equal ? 'square' : 'rect', sides: 4 };
    case 'ellipse':
      return { variant: equal ? 'circle' : 'ellipse', sides: 0 };
    case 'line':
      return { variant: 'line', sides: 2 };
    case 'arrow':
      return { variant: 'arrow', sides: 2 };
    case 'triangle':
      return { variant: 'triangle', sides: 3 };
    default:
      return { variant: 'polygon', sides: s.pts ? Math.floor(s.pts.length / 2) : 0 };
  }
}

function formsOf(s: Nameable): NameForms {
  'worklet';
  const v = variantOf(s);
  switch (v.variant) {
    case 'line':
      return LINE;
    case 'arrow':
      return ARROW;
    case 'rect':
      return RECT;
    case 'square':
      return SQUARE;
    case 'ellipse':
      return ELLIPSE;
    case 'circle':
      return CIRCLE;
    case 'triangle':
      return TRIANGLE;
    default:
      return v.sides === 3 ? TRIANGLE : (BY_SIDES[v.sides] ?? POLYGON);
  }
}

/** The shape's name: { ar: 'مستطيل', en: 'rectangle' }. This is ShapeSnapEvent.name. */
export function shapeName(s: Nameable): ShapeText {
  'worklet';
  const f = formsOf(s);
  return { ar: f.ar, en: f.en };
}

/** The hint above the pen while holding: 'ثبّت القلم لحظة… سيصبح مستطيلاً'. */
export function hintText(s: Nameable): ShapeText {
  'worklet';
  const f = formsOf(s);
  return { ar: `ثبّت القلم لحظة… سيصبح ${f.acc}`, en: `Hold still… it will become ${f.an ? 'an' : 'a'} ${f.en}` };
}

/** The toast text after the snap: 'تحوّل إلى مستطيل' (the undo action is SNAP_UNDO_LABEL). */
export function doneText(s: Nameable): ShapeText {
  'worklet';
  const f = formsOf(s);
  return { ar: `تحوّل إلى ${f.ar}`, en: `Turned into ${f.an ? 'an' : 'a'} ${f.en}` };
}
