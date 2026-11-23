/**
 * Seedable random numbers for Ran# and RanInt#. The state is a uint32 kept in CalcContext.seed, so
 * evaluation stays pure: every draw returns the next seed. mulberry32.
 */

/** One draw: a float in [0, 1) and the next state. */
export function nextRandom(seed: number): { value: number; seed: number } {
  const s = (seed + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: s };
}

/** Ran#: a three-decimal number 0.000 to 0.999, as on the reference. Returns thousandths too. */
export function ranHash(seed: number): { value: number; thousandths: number; seed: number } {
  const r = nextRandom(seed);
  const k = Math.floor(r.value * 1000);
  return { value: k / 1000, thousandths: k, seed: r.seed };
}

/** RanInt#(a, b): a uniform integer from a to b inclusive (a <= b, both integers). */
export function ranInt(a: number, b: number, seed: number): { value: number; seed: number } {
  const r = nextRandom(seed);
  return { value: a + Math.floor(r.value * (b - a + 1)), seed: r.seed };
}

/** A starting seed from an injected random source (Math.random in the app, a fixed one in tests). */
export function seedFrom(rand: () => number): number {
  return Math.floor(rand() * 4294967296) >>> 0;
}

export const DEFAULT_SEED = 0x2545f491;
