/**
 * Ids for notebooks, pages, items, assets and recordings: 16 characters of [a-z2-7] (80 random bits),
 * safe in file names and URIs.
 *
 * JS-only: never call newId in a worklet. Worklets send plain payloads to JS, which creates the ids.
 */
import type { Id } from './types.ts';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const ID_LENGTH = 16;
export const ID_PATTERN = /^[a-z2-7]{16}$/;

type RandomSource = { getRandomValues?: (a: Uint8Array) => Uint8Array };

function cryptoSource(): RandomSource | null {
  const c = (globalThis as { crypto?: RandomSource }).crypto;
  return c && typeof c.getRandomValues === 'function' ? c : null;
}

/**
 * A new random id. rand (0 <= r < 1) is used when given (tests, injected randomness); otherwise
 * globalThis.crypto.getRandomValues; when neither exists (Hermes has no Web Crypto), Math.random.
 */
export function newId(rand?: () => number): Id {
  let out = '';
  if (rand) {
    for (let i = 0; i < ID_LENGTH; i++) {
      const r = rand();
      const v = Number.isFinite(r) ? Math.floor(Math.abs(r) * 32) % 32 : 0;
      out += ALPHABET[v];
    }
    return out;
  }
  const c = cryptoSource();
  if (c && c.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(ID_LENGTH));
    for (let i = 0; i < ID_LENGTH; i++) out += ALPHABET[bytes[i] & 31];
    return out;
  }
  for (let i = 0; i < ID_LENGTH; i++) out += ALPHABET[Math.floor(Math.random() * 32) % 32];
  return out;
}

/**
 * True for any id this app accepts in a file name: non-empty, at most 64 chars, [A-Za-z0-9_-] only.
 * '__proto__' is refused: ids are also Record keys (notebook.assets, manifests).
 */
export function isSafeId(v: unknown): v is Id {
  return typeof v === 'string' && v !== '__proto__' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}
