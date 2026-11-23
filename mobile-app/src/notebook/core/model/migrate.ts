/**
 * Format versions. Every saved envelope has version: 1 today.
 *
 * MIGRATIONS[n] turns a version-n object into version n + 1. Version 1 is the identity (there is no
 * older format). A version NEWER than CURRENT_VERSION (saved by a newer app) is read as well as
 * possible and flagged readOnly: it is never saved over and never repaired.
 */

export const CURRENT_VERSION = 1;

export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/** The integer version of a raw object; a missing or malformed version counts as 1. */
export function versionOf(raw: Record<string, unknown>): number {
  const v = raw.version;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1;
}

export function migrate(raw: Record<string, unknown>): { raw: Record<string, unknown>; readOnly: boolean } {
  let v = versionOf(raw);
  if (v > CURRENT_VERSION) return { raw, readOnly: true };
  let out = raw;
  while (v < CURRENT_VERSION) {
    const step = MIGRATIONS[v];
    out = step ? step(out) : { ...out, version: v + 1 };
    v += 1;
  }
  return { raw: out, readOnly: false };
}
