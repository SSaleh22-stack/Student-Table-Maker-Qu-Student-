/**
 * BASE-N (MODE 4): signed 32-bit integers shown in DEC, HEX, BIN or OCT, and the logic operators.
 *
 * Ranges (as on the reference):
 * - DEC: −2147483648 to 2147483647
 * - HEX: 00000000 to FFFFFFFF (80000000 and up are the negative values, two's complement)
 * - OCT: 00000000000 to 37777777777 (20000000000 and up are negative)
 * - BIN: 16 bits only, 0000000000000000 to 1111111111111111 (1000000000000000 and up are negative),
 *   so in BIN the values are −32768 to 32767.
 * A result outside the range of the current radix is Math ERROR. Division drops the fraction
 * (toward zero). A real value (a variable stored outside BASE-N) counts as its integer part.
 */
import type { BaseValue, CalcContext, CalcError, CalcValue, FnName, ModeBinOp, PostOp, Radix } from '../types.ts';

export const INT32_MIN = -2147483648;
export const INT32_MAX = 2147483647;
export const BIN_MIN = -32768;
export const BIN_MAX = 32767;

/** Most digits a literal may have in each radix. */
export const RADIX_DIGITS: Record<Radix, number> = { 2: 16, 8: 11, 10: 10, 16: 8 };

/** The BASE logic menu (SHIFT 3 in BASE-N), in menu order: 1 and, 2 or, 3 xor, 4 xnor, 5 Not(, 6 Neg(. */
export const BASE_LOGIC_MENU = ['and', 'or', 'xor', 'xnor', 'Not', 'Neg'] as const satisfies readonly (ModeBinOp | FnName)[];

/** The radix each conversion suffix switches to. */
export const RADIX_OF_SUFFIX: Record<'▶Dec' | '▶Hex' | '▶Bin' | '▶Oct', Radix> = { '▶Dec': 10, '▶Hex': 16, '▶Bin': 2, '▶Oct': 8 };

/** The status-line name of a radix. */
export function radixName(r: Radix): 'Dec' | 'Hex' | 'Bin' | 'Oct' {
  return r === 10 ? 'Dec' : r === 16 ? 'Hex' : r === 2 ? 'Bin' : 'Oct';
}

/** Whether a signed value can be shown in radix r (BIN has 16 bits, the others 32). */
export function fitsRadix(n: number, r: Radix): boolean {
  if (!Number.isInteger(n)) return false;
  if (r === 2) return n >= BIN_MIN && n <= BIN_MAX;
  return n >= INT32_MIN && n <= INT32_MAX;
}

export function baseValue(n: number): BaseValue {
  return { t: 'base', n: n === 0 ? 0 : n };
}

function digitValue(c: string): number {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

/**
 * Reads a BASE-N literal (the digit characters 0–9 and A–F) in radix r.
 * A digit the radix does not have is Syntax ERROR; a value too big for the radix is Math ERROR.
 */
export function parseBase(digits: string, r: Radix): CalcValue | CalcError {
  if (digits.length === 0) return 'Syntax ERROR';
  let value = 0;
  let significant = 0;
  for (const c of digits) {
    const d = digitValue(c);
    if (d < 0 || d >= r) return 'Syntax ERROR';
    if (significant > 0 || d > 0) significant++;
    if (significant > RADIX_DIGITS[r]) return 'Math ERROR';
    value = value * r + d;
  }
  if (r === 10) return value > INT32_MAX ? 'Math ERROR' : baseValue(value);
  if (r === 2) {
    if (value > 0xffff) return 'Math ERROR';
    return baseValue(value >= 0x8000 ? value - 0x10000 : value);
  }
  if (value > 0xffffffff) return 'Math ERROR';
  return baseValue(value | 0);
}

/** The integer a value stands for in BASE-N, or Math ERROR. null when it is not a number at all. */
export function toBaseInt(v: CalcValue): number | CalcError | null {
  if (v.t === 'base') return v.n;
  if (v.t === 'real') {
    const n = Math.trunc(v.x);
    return n >= INT32_MIN && n <= INT32_MAX ? (n === 0 ? 0 : n) : 'Math ERROR';
  }
  if (v.t === 'cplx') return 'Math ERROR';
  return null;
}

function checked(n: number, ctx: CalcContext): BaseValue | CalcError {
  return fitsRadix(n, ctx.base) ? baseValue(n) : 'Math ERROR';
}

/** Arithmetic and logic on BASE-N values. null when an operand is a matrix or vector. */
export function baseBinary(op: ModeBinOp, a: CalcValue, b: CalcValue, ctx: CalcContext): CalcValue | CalcError | null {
  const x = toBaseInt(a);
  const y = toBaseInt(b);
  if (x === null || y === null) return null;
  if (typeof x === 'string') return x;
  if (typeof y === 'string') return y;
  switch (op) {
    case '+':
      return checked(x + y, ctx);
    case '-':
      return checked(x - y, ctx);
    case '×':
      return checked(x * y, ctx);
    case '÷':
      if (y === 0) return 'Math ERROR';
      return checked(Math.trunc(x / y), ctx);
    case 'and':
      return checked(x & y, ctx);
    case 'or':
      return checked(x | y, ctx);
    case 'xor':
      return checked(x ^ y, ctx);
    case 'xnor':
      return checked(~(x ^ y), ctx);
    case '·':
      return 'Syntax ERROR';
  }
}

/** Not, Neg and the ▶Dec / ▶Hex / ▶Bin / ▶Oct conversions on a BASE-N value. */
export function baseUnary(name: FnName | PostOp, a: CalcValue, ctx: CalcContext): CalcValue | CalcError | null {
  const x = toBaseInt(a);
  if (x === null) return null;
  if (typeof x === 'string') return x;
  switch (name) {
    case 'Neg':
      return checked(-x, ctx);
    case 'Not':
      return checked(~x, ctx);
    case '▶Dec':
    case '▶Hex':
    case '▶Bin':
    case '▶Oct':
      return fitsRadix(x, RADIX_OF_SUFFIX[name]) ? baseValue(x) : 'Math ERROR';
    case 'Abs':
      return checked(Math.abs(x), ctx);
    case 'Int':
    case 'Intg':
      return baseValue(x);
    default:
      // Every other function (sin, √, x² …) is not available on BASE-N values.
      return 'Math ERROR';
  }
}

/** The text of a value in radix r: 8 hex digits, 11 octal, 16 binary, or signed decimal (minus U+2212). */
export function baseText(n: number, r: Radix): string {
  if (r === 10) return n < 0 ? '−' + String(-n) : String(n);
  if (r === 16) return (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  if (r === 8) return (n >>> 0).toString(8).padStart(11, '0');
  return (n & 0xffff).toString(2).padStart(16, '0');
}
