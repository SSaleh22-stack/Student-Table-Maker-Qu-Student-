/**
 * Calculator errors. The messages themselves are CALC_ERRORS in types.ts (shown on the LCD exactly).
 */
import { CALC_ERRORS, type CalcError } from './types.ts';

export { CALC_ERRORS };

/** A CalcError is a string; every CalcValue is an object. */
export function isCalcError(r: unknown): r is CalcError {
  return typeof r === 'string' && (CALC_ERRORS as readonly string[]).includes(r);
}

/** The lines under an error message, as on the reference LCD. Time Out and Can't Solve have no Goto. */
export function errorHint(e: CalcError): string[] {
  if (e === "Can't Solve" || e === 'Time Out' || e === 'Insufficient MEM' || e === 'Variable ERROR') return ['[AC] :Cancel'];
  return ['[AC] :Cancel', '[◀][▶]:Goto'];
}

/**
 * Internal control flow: the parser and evaluator throw a CalcFail, evaluate() catches it and returns
 * { ok: false, error, at }. Never escapes the engine.
 */
export class CalcFail extends Error {
  readonly calc: CalcError;
  readonly at: number | undefined;
  constructor(calc: CalcError, at?: number) {
    super(calc);
    this.calc = calc;
    this.at = at;
  }
}

/** Throws a CalcFail for an error result, otherwise returns the value. */
export function unwrap<T>(r: T | CalcError, at?: number): T {
  if (typeof r === 'string') throw new CalcFail(r as CalcError, at);
  return r;
}
