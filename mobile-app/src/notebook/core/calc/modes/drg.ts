/**
 * DRG (SHIFT Ans): the angle-unit suffixes ° ʳ ᵍ. The engine applies them (functions.ts
 * convertAngle: the value is read in that unit and converted to the SETUP angle unit). This file
 * holds the menu and a plain-number conversion for the mode tests and tools.
 */
import type { AngleUnit, PostOp } from '../types.ts';
import { convertAngle } from '../functions.ts';
import { real } from '../num/value.ts';

/** The DRG menu in order: 1 °, 2 r, 3 g, with the unit each suffix means. */
export const DRG_MENU: { op: Extract<PostOp, '°' | 'ʳ' | 'ᵍ'>; label: string; unit: AngleUnit }[] = [
  { op: '°', label: '°', unit: 'Deg' },
  { op: 'ʳ', label: 'r', unit: 'Rad' },
  { op: 'ᵍ', label: 'g', unit: 'Gra' },
];

/** The unit a DRG suffix stands for. */
export function unitOfSuffix(op: '°' | 'ʳ' | 'ᵍ'): AngleUnit {
  return op === '°' ? 'Deg' : op === 'ʳ' ? 'Rad' : 'Gra';
}

/** Converts an angle between units (exact at whole turn fractions, as the engine does). */
export function drgConvert(x: number, from: AngleUnit, to: AngleUnit): number {
  return convertAngle(real(x), from, to).x;
}
