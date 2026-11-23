/**
 * Degrees, minutes and seconds (the ° ' " key).
 * Entry: '2°30°15°' = 2 + 30/60 + 15/3600 (exact, see dmsRational). Display: 2°30'15".
 */
import type { Rational } from './types.ts';
import { q, qAdd, qDiv, qInt } from './num/rational.ts';

export interface Dms {
  neg: boolean;
  d: number;
  m: number;
  s: number;
}

/** Exact value of d°m's" (parts are rationals; the sign of d applies to the whole). */
export function dmsRational(d: Rational, m: Rational, s: Rational): Rational {
  const mm = qDiv(m, qInt(60)) ?? q(0n);
  const ss = qDiv(s, qInt(3600)) ?? q(0n);
  if (d.n < 0n) return qAdd(qAdd(d, { n: -mm.n, d: mm.d }), { n: -ss.n, d: ss.d });
  return qAdd(qAdd(d, mm), ss);
}

export function fromDms(d: number, m: number, s: number): number {
  const sign = d < 0 ? -1 : 1;
  return sign * (Math.abs(d) + m / 60 + s / 3600);
}

/**
 * Splits x into degrees, minutes and seconds. Seconds are rounded so the whole fits 10 digits,
 * carrying into minutes and degrees (59.9999999" becomes the next minute).
 */
export function toDms(x: number): Dms {
  const neg = x < 0;
  const ax = Math.abs(x);
  let d = Math.floor(ax);
  const minutes = (ax - d) * 60;
  let m = Math.floor(minutes + 1e-9);
  let s = Math.max(0, (minutes - m) * 60);
  const used = String(d).length + String(m).length;
  const decimals = Math.max(0, Math.min(9, 10 - used - 2));
  s = Number(s.toFixed(decimals));
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    d += 1;
  }
  return { neg, d, m, s: Number(s.toFixed(decimals)) };
}

/** Text form 2°30'15.5" ('−' for negatives, comma decimal mark when asked). */
export function formatDms(x: number, decimal: 'Dot' | 'Comma' = 'Dot'): string {
  const v = toDms(x);
  let s = String(v.s);
  if (s.includes('e')) s = v.s.toFixed(9).replace(/\.?0+$/, '');
  if (decimal === 'Comma') s = s.replace('.', ',');
  return `${v.neg ? '−' : ''}${v.d}°${v.m}'${s}"`;
}
