/**
 * Result formatting: Norm 1 / Norm 2, Fix, Sci, ENG and ←ENG, a 10-digit mantissa, DMS, exact forms
 * (fractions, a b/c, surds, π) for the natural display, S⇔D, complex, BASE-N, matrices and vectors.
 *
 * Rules:
 * - Decimals are rounded to 10 significant digits (Fix n: n decimals; Sci n: n digits, 0 = 10).
 * - Norm 1 switches to ×10ⁿ below 10⁻² or from 10¹⁰; Norm 2 below 10⁻⁹ or from 10¹⁰.
 * - MthIO shows the exact form when there is one that fits the LCD (exact.ts displayableExact);
 *   S⇔D switches to the decimal. LineIO shows the decimal; S⇔D switches to a fraction when the value
 *   is rational (LineIO has no surd or π forms).
 * - Exact forms come from the value's exact track, else from recognize(x) (MthIO only).
 * - Minus is '−' (U+2212). The decimal mark follows SETUP Disp.
 */
import type {
  CalcSetup, CalcValue, DisplayForm, DisplayValue, Exact, FormatOptions, MathNode, MathRow, Radix, Rational, RealValue,
} from './types.ts';
import { displayableExact, exQ, recognize, toMixed } from './exact.ts';
import { babs, qFromNumber, qIsInt } from './num/rational.ts';
import { formatDms } from './dms.ts';

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};
export const MINUS = '−';

export function superscript(n: number): string {
  return String(n).split('').map((c) => SUP[c] ?? c).join('');
}

/** x = d1.d2d3… × 10^exp with p significant digits (x != 0). */
function expParts(x: number, p: number): { neg: boolean; digits: string; exp: number } {
  const s = Math.abs(x).toExponential(Math.max(0, Math.min(99, p - 1)));
  const [m, e] = s.split('e');
  return { neg: x < 0, digits: m.replace('.', ''), exp: Number(e) };
}

/** Plain decimal text of d1.d2… × 10^exp. */
function plain(digits: string, exp: number, trim: boolean): string {
  let intPart: string;
  let frac: string;
  if (exp >= 0) {
    intPart = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
    frac = digits.slice(exp + 1);
  } else {
    intPart = '0';
    frac = '0'.repeat(-exp - 1) + digits;
  }
  if (trim) frac = frac.replace(/0+$/, '');
  return frac ? `${intPart}.${frac}` : intPart;
}

function mantissaOf(digits: string, trim: boolean): string {
  const rest = trim ? digits.slice(1).replace(/0+$/, '') : digits.slice(1);
  return rest ? `${digits[0]}.${rest}` : digits[0];
}

function mark(text: string, setup: CalcSetup): string {
  return setup.decimal === 'Comma' ? text.replace('.', ',') : text;
}

function signed(neg: boolean, body: string): string {
  return neg && /[1-9]/.test(body) ? MINUS + body : body;
}

/**
 * x >= 0 with n decimals, rounded half up on its 15-significant-digit decimal form
 * (so 1.005 with 2 decimals is 1.01, as on the reference, not 1.00 as toFixed gives).
 */
export function toFixedHalfUp(x: number, n: number): string {
  if (x === 0) return n > 0 ? `0.${'0'.repeat(n)}` : '0';
  const p = expParts(x, 15);
  let digits = BigInt(p.digits); // x = digits × 10^(exp - 14)
  const k = p.exp - 14 + n;
  if (k >= 0) digits *= 10n ** BigInt(k);
  else {
    const div = 10n ** BigInt(-k);
    const rem = digits % div;
    digits /= div;
    if (rem * 2n >= div) digits += 1n;
  }
  const str = digits.toString().padStart(n + 1, '0');
  return n > 0 ? `${str.slice(0, -n)}.${str.slice(-n)}` : str;
}

export interface NumberText {
  text: string;
  sci?: { mantissa: string; exp: number };
}

function sciText(neg: boolean, mantissa: string, exp: number, setup: CalcSetup): NumberText {
  const m = signed(neg, mark(mantissa, setup));
  return { text: `${m}×10${superscript(exp)}`, sci: { mantissa: m, exp } };
}

/** Engineering form. eng > 0: ENG pressed eng times; eng < 0: ←ENG pressed −eng times. */
function engText(x: number, eng: number, setup: CalcSetup): NumberText {
  if (x === 0) return { text: '0', sci: { mantissa: '0', exp: 0 } };
  const p = expParts(x, 10);
  const e0 = Math.floor(p.exp / 3) * 3;
  let expo = eng > 0 ? e0 - 3 * (eng - 1) : e0 + 3 * -eng;
  // Keep at most 10 integer digits, at most 9 leading zeros, and the exponent within ±99.
  while (p.exp - expo > 9) expo += 3;
  while (expo - p.exp > 9) expo -= 3;
  while (expo > 99) expo -= 3;
  while (expo < -99) expo += 3;
  const m = plain(p.digits, p.exp - expo, true);
  return sciText(p.neg, m, expo, setup);
}

/** A decimal in the current display format (no exact forms). */
export function formatNumber(x: number, setup: CalcSetup, eng: number = 0): NumberText {
  if (eng !== 0) return engText(x, eng, setup);
  const d = setup.disp;
  if (d.mode === 'Sci') {
    const digits = d.n === 0 ? 10 : d.n;
    if (x === 0) return sciText(false, mantissaOf('0'.repeat(digits), false), 0, setup);
    const p = expParts(x, digits);
    return sciText(p.neg, mantissaOf(p.digits, false), p.exp, setup);
  }
  if (x === 0) return { text: d.mode === 'Fix' && d.n > 0 ? mark(`0.${'0'.repeat(d.n)}`, setup) : '0' };
  const p = expParts(x, 10);
  if (p.exp >= 10) return sciText(p.neg, mantissaOf(p.digits, true), p.exp, setup);
  if (d.mode === 'Fix') {
    // At most 10 digits on the LCD: big integer parts leave fewer decimals.
    const decimals = Math.max(0, Math.min(d.n, 10 - (p.exp + 1)));
    return { text: signed(x < 0, mark(toFixedHalfUp(Math.abs(x), decimals), setup)) };
  }
  const lower = d.n === 1 ? -3 : -10; // exponent below which Norm uses ×10ⁿ (|x| < 10^-2 or 10^-9)
  if (p.exp <= lower) return sciText(p.neg, mantissaOf(p.digits, true), p.exp, setup);
  return { text: signed(p.neg, mark(plain(p.digits, p.exp, true), setup)) };
}

/** Rnd: x rounded the way the display shows it (Norm: 10 digits; Fix n: n decimals; Sci n: n digits). */
export function roundForDisplay(x: number, setup: CalcSetup): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const d = setup.disp;
  if (d.mode === 'Sci') return Number(x.toPrecision(d.n === 0 ? 10 : d.n));
  if (d.mode === 'Fix' && Math.abs(x) < 1e10) return (x < 0 ? -1 : 1) * Number(toFixedHalfUp(Math.abs(x), d.n));
  return Number(x.toPrecision(10));
}

// ===== exact forms

function digitNodes(n: bigint): MathRow {
  return babs(n).toString().split('').map((c) => ({ k: 'digit', d: c as '0' }));
}

function decimalNodes(text: string): MathRow {
  const out: MathRow = [];
  let s = text;
  if (s.startsWith(MINUS)) {
    out.push({ k: 'neg' });
    s = s.slice(1);
  }
  const sci = s.split('×10');
  for (const c of sci[0]) out.push({ k: 'digit', d: (c === ',' ? '.' : c) as '0' });
  if (sci.length > 1) {
    out.push({ k: 'post', op: 'E' });
    const rev: Record<string, string> = {};
    for (const [k, v] of Object.entries(SUP)) rev[v] = k;
    for (const c of sci[1]) {
      const r = rev[c];
      if (r === '-') out.push({ k: 'neg' });
      else if (r) out.push({ k: 'digit', d: r as '0' });
    }
  }
  return out;
}

interface Piece {
  text: string;
  math: MathRow;
  form: DisplayForm;
}

function fracPiece(r: Rational, setup: CalcSetup, frac: 'ab/c' | 'd/c'): Piece {
  const line = setup.io === 'LineIO';
  const neg = r.n < 0n;
  const sign = neg ? MINUS : '';
  const lead: MathRow = neg ? [{ k: 'neg' }] : [];
  const m = toMixed(r);
  if (frac === 'ab/c' && m.whole !== 0n) {
    const text = line ? `${sign}${m.whole}⌟${m.num}⌟${m.den}` : `${sign}${m.whole} ${m.num}/${m.den}`;
    return { text, form: 'mixed', math: [...lead, { k: 'mixed', whole: digitNodes(m.whole), num: digitNodes(m.num), den: digitNodes(m.den) }] };
  }
  const n = babs(r.n);
  const text = line ? `${sign}${n}⌟${r.d}` : `${sign}${n}/${r.d}`;
  return { text, form: 'frac', math: [...lead, { k: 'frac', num: digitNodes(n), den: digitNodes(r.d) }] };
}

/** One term c·√r or c·π (sym given) as text and nodes, without its sign. */
function termPiece(c: Rational, core: { text: string; nodes: MathRow } | null): { text: string; math: MathRow } {
  const n = babs(c.n);
  const top: MathRow = [];
  let topText = '';
  if (!core || n !== 1n) {
    top.push(...digitNodes(n));
    topText += n.toString();
  }
  if (core) {
    top.push(...core.nodes);
    topText += core.text;
  }
  if (c.d === 1n) return { text: topText, math: top };
  return { text: `${topText}/${c.d}`, math: [{ k: 'frac', num: top, den: digitNodes(c.d) }] };
}

function exactPiece(e: Exact, setup: CalcSetup, frac: 'ab/c' | 'd/c'): Piece {
  if (e.k === 'q') return fracPiece(e.q, setup, frac);
  if (e.k === 'pi') {
    const t = termPiece(e.q, { text: 'π', nodes: [{ k: 'sym', name: 'π' }] });
    const neg = e.q.n < 0n;
    return { text: (neg ? MINUS : '') + t.text, math: [...(neg ? [{ k: 'neg' } as MathNode] : []), ...t.math], form: 'pi' };
  }
  let text = '';
  const math: MathRow = [];
  // Lead with a positive term when there is one (√6/4−√2/4, not −√2/4+√6/4).
  const terms = e.terms.slice();
  const firstPos = terms.findIndex((t) => t.c.n > 0n);
  if (firstPos > 0) terms.unshift(...terms.splice(firstPos, 1));
  terms.forEach((term, i) => {
    const neg = term.c.n < 0n;
    if (i === 0) {
      if (neg) {
        text += MINUS;
        math.push({ k: 'neg' });
      }
    } else {
      text += neg ? MINUS : '+';
      math.push({ k: 'op', op: neg ? '-' : '+' });
    }
    const core = term.r === 1n ? null : { text: `√${term.r}`, nodes: [{ k: 'fn', name: '√', args: [digitNodes(term.r)] } as MathNode] };
    const t = termPiece(term.c, core);
    text += t.text;
    math.push(...t.math);
  });
  return { text, math, form: 'surd' };
}

/** The exact form a real value can show, or null (integers and decimals have none). */
export function exactFormOf(v: RealValue, setup: CalcSetup, frac: 'ab/c' | 'd/c' = setup.frac): Exact | null {
  let e: Exact | null = v.exact ?? null;
  if (!e && setup.io === 'MthIO') e = recognize(v.x);
  if (!e) return null;
  if (setup.io === 'LineIO' && e.k !== 'q') {
    // LineIO shows only fractions; a surd or π value has no LineIO exact form.
    return null;
  }
  if (e.k === 'q' && qIsInt(e.q)) return null;
  return displayableExact(e, frac) ? e : null;
}

function realPiece(x: number, exact: Exact | null, setup: CalcSetup, o: FormatOptions, frac: 'ab/c' | 'd/c'): Piece {
  const ex = exact;
  const exactDefault = setup.io === 'MthIO';
  const showExact = ex && (o.eng ?? 0) === 0 && (o.sd ? !exactDefault : exactDefault);
  if (showExact && ex) return exactPiece(ex, setup, frac);
  const n = formatNumber(x, setup, o.eng ?? 0);
  return { text: n.text, math: decimalNodes(n.text), form: 'dec' };
}

function radixText(n: number, base: Radix): string {
  if (base === 10) return n < 0 ? MINUS + String(-n) : String(n);
  if (base === 16) return (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  if (base === 8) return (n >>> 0).toString(8).padStart(11, '0');
  return (n & 0xffff).toString(2).padStart(16, '0');
}

/** A cell of a matrix, vector or table, or a Pol/Rec part. */
export function formatCell(x: number, setup: CalcSetup): string {
  const real: RealValue = { t: 'real', x };
  const ex = exactFormOf(real, setup);
  return ex ? exactPiece(ex, setup, setup.frac).text : formatNumber(x, setup).text;
}

function angleFrom(rad: number, setup: CalcSetup): number {
  if (setup.angle === 'Deg') return (rad * 180) / Math.PI;
  if (setup.angle === 'Gra') return (rad * 200) / Math.PI;
  return rad;
}

/** Formats any CalcValue for the LCD. */
export function formatValue(v: CalcValue, setup: CalcSetup, o: FormatOptions = {}): DisplayValue {
  const frac = o.frac ?? setup.frac;
  switch (v.t) {
    case 'real': {
      if (o.dms) return { form: 'dms', text: formatDms(v.x, setup.decimal), canSD: false };
      const ex = exactFormOf(v, setup, frac);
      const p = realPiece(v.x, ex, setup, o, frac);
      const out: DisplayValue = { form: p.form, text: p.text, canSD: ex !== null };
      if (p.form !== 'dec') out.math = p.math;
      else {
        const n = formatNumber(v.x, setup, o.eng ?? 0);
        if (n.sci) out.sci = n.sci;
      }
      return out;
    }
    case 'cplx': {
      const polar = v.polar ?? setup.cmplx === 'r∠θ';
      let parts: { x: number; ex: Exact | null }[];
      if (polar) {
        const r = Math.hypot(v.re, v.im);
        const th = angleFrom(Math.atan2(v.im, v.re), setup);
        parts = [r, th].map((x) => ({ x, ex: exactFormOf({ t: 'real', x }, setup, frac) }));
      } else {
        parts = [
          { x: v.re, ex: v.exact ? exQ(v.exact.re) : null },
          { x: v.im, ex: v.exact ? exQ(v.exact.im) : null },
        ].map((p) => {
          const real: RealValue = p.ex ? { t: 'real', x: p.x, exact: p.ex } : { t: 'real', x: p.x };
          return { x: p.x, ex: exactFormOf(real, setup, frac) };
        });
      }
      const canSD = parts.some((p) => p.ex !== null);
      const [a, b] = parts.map((p) => realPiece(p.x, p.ex, setup, o, frac));
      if (polar) {
        return { form: 'cplx', text: `${a.text}∠${b.text}`, math: [...a.math, { k: 'op', op: '∠' }, ...b.math], canSD };
      }
      const imNeg = v.im < 0;
      const imAbs = imNeg ? realPiece(-v.im, parts[1].ex ? negEx(parts[1].ex) : null, setup, o, frac) : b;
      const imOne = Math.abs(v.im) === 1 && imAbs.form !== 'mixed';
      const iNode: MathNode = { k: 'sym', name: 'i' };
      const imText = (imOne ? '' : imAbs.text) + 'i';
      const imMath: MathRow = imOne ? [iNode] : [...imAbs.math, iNode];
      if (v.re === 0) {
        return { form: 'cplx', text: (imNeg ? MINUS : '') + imText, math: [...(imNeg ? [{ k: 'neg' } as MathNode] : []), ...imMath], canSD };
      }
      return {
        form: 'cplx',
        text: `${a.text}${imNeg ? MINUS : '+'}${imText}`,
        math: [...a.math, { k: 'op', op: imNeg ? '-' : '+' }, ...imMath],
        canSD,
      };
    }
    case 'pair': {
      const names = v.kind === 'pol' ? ['r', 'θ'] : ['X', 'Y'];
      const lines = [`${names[0]}=${formatCell(v.a, setup)}`, `${names[1]}=${formatCell(v.b, setup)}`];
      return { form: 'pair', text: lines.join(', '), lines, canSD: false };
    }
    case 'base': {
      const text = radixText(v.n, o.base ?? 10);
      return { form: 'base', text, canSD: false };
    }
    case 'mat': {
      const grid = v.m.map((row) => row.map((x) => formatCell(x, setup)));
      return { form: 'mat', text: grid.map((r) => `[${r.join(',')}]`).join(''), grid, canSD: false };
    }
    case 'vct': {
      const grid = [v.v.map((x) => formatCell(x, setup))];
      return { form: 'vct', text: `[${grid[0].join(',')}]`, grid, canSD: false };
    }
  }
}

function negEx(e: Exact): Exact {
  if (e.k === 'q') return { k: 'q', q: { n: -e.q.n, d: e.q.d } };
  if (e.k === 'pi') return { k: 'pi', q: { n: -e.q.n, d: e.q.d } };
  return { k: 'surd', terms: e.terms.map((t) => ({ c: { n: -t.c.n, d: t.c.d }, r: t.r })) };
}

/** Exact decimal rational of the value the display shows (for Rnd). */
export function displayedRational(x: number, setup: CalcSetup): Rational | null {
  return qFromNumber(roundForDisplay(x, setup));
}
