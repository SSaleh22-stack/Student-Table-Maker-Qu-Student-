/**
 * Mode extension registry. P18's installModes() calls setModeOps(ops) and setConstTable(table) once;
 * the engine never imports calc/modes. Module state, so it is shared by every caller.
 */
import type { ConstEntry, ModeOps } from './types.ts';

let ops: ModeOps | null = null;
let constTable: ConstEntry[] = [];

export function setModeOps(o: ModeOps | null): void {
  ops = o;
}

export function getModeOps(): ModeOps | null {
  return ops;
}

/** The CONST list (code 1..40). CONST n is read from here first, then from ModeOps.constValue. */
export function setConstTable(t: ConstEntry[]): void {
  constTable = t.slice();
}

export function getConstTable(): readonly ConstEntry[] {
  return constTable;
}

export function constByCode(code: number): ConstEntry | undefined {
  return constTable.find((c) => c.code === code);
}

/** Tests: forget everything registered. */
export function resetRegistry(): void {
  ops = null;
  constTable = [];
}
