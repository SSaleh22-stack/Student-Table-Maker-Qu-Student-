/**
 * Paragraph direction for text boxes (NB-46: automatic direction per paragraph). Pure, worklet-safe.
 *
 * paragraphDirection follows the Unicode bidi rules P2/P3: the first strong character decides
 * (Arabic, Hebrew and the other right-to-left scripts, RLM and ALM -> 'rtl'; Latin and the other
 * letters, LRM -> 'ltr'). Digits, punctuation, spaces, symbols, emoji and Arabic marks are neutral,
 * and text inside isolates (LRI/RLI/FSI .. PDI) is skipped. With no strong character the fallback
 * is used. Users: P16 textLayout (Skia paragraphs), P28 TextEditorOverlay (writingDirection).
 */

export type TextDir = 'rtl' | 'ltr';

const STRONG_NONE = 0;
const STRONG_LTR = 1;
const STRONG_RTL = 2;

/** The strong bidi class of one code point (approximate table, exact for Arabic, Hebrew and Latin). */
function strongOf(cp: number): number {
  'worklet';
  // ASCII
  if (cp < 0x80) return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ? STRONG_LTR : STRONG_NONE;
  // Explicit marks
  if (cp === 0x200e) return STRONG_LTR;
  if (cp === 0x200f || cp === 0x061c) return STRONG_RTL;
  // Latin-1 letters (not × or ÷), Latin Extended, IPA
  if (cp === 0xaa || cp === 0xb5 || cp === 0xba) return STRONG_LTR;
  if (cp >= 0xc0 && cp <= 0x2b8) return cp === 0xd7 || cp === 0xf7 ? STRONG_NONE : STRONG_LTR;
  if (cp < 0x370) return STRONG_NONE; // spacing modifiers, combining marks
  // Greek, Cyrillic, Armenian
  if (cp < 0x590) return cp === 0x37e || cp === 0x387 ? STRONG_NONE : STRONG_LTR;
  // Hebrew 0590-05FF: letters and punctuation are R, points are marks
  if (cp < 0x600) return cp >= 0x591 && cp <= 0x5c7 && cp !== 0x5be && cp !== 0x5c0 && cp !== 0x5c3 && cp !== 0x5c6 ? STRONG_NONE : STRONG_RTL;
  // Arabic 0600-06FF
  if (cp < 0x700) {
    if (cp <= 0x605 || cp === 0x609 || cp === 0x60a) return STRONG_NONE; // number signs, per mille
    if (cp === 0x60c || cp === 0x60e || cp === 0x60f) return STRONG_NONE; // comma (CS), poetic signs
    if (cp >= 0x610 && cp <= 0x61a) return STRONG_NONE; // marks
    if (cp >= 0x64b && cp <= 0x669) return STRONG_NONE; // harakat, Arabic-Indic digits
    if (cp >= 0x66a && cp <= 0x66c) return STRONG_NONE; // percent sign, decimal and thousands separators
    if (cp === 0x670) return STRONG_NONE; // superscript alef
    if (cp >= 0x6d6 && cp <= 0x6ed && cp !== 0x6e5 && cp !== 0x6e6) return STRONG_NONE; // Quranic marks
    if (cp >= 0x6f0 && cp <= 0x6f9) return STRONG_NONE; // Extended Arabic-Indic digits
    return STRONG_RTL;
  }
  // Syriac, Arabic Supplement, Thaana, NKo, Samaritan, Mandaic, Arabic Extended-B/A (marks are rare in notes)
  if (cp < 0x900) {
    if (cp >= 0x8d3 && cp <= 0x8ff) return STRONG_NONE; // Arabic Extended-A marks
    return STRONG_RTL;
  }
  // Indic, Southeast Asian, Georgian, Hangul Jamo, Ethiopic, ..., Latin Extended Additional, Greek Extended
  if (cp < 0x2000) return STRONG_LTR;
  // General punctuation, super/subscripts, currency, letterlike, arrows, math, box drawing, dingbats, ...
  if (cp < 0x2c00) return STRONG_NONE;
  if (cp >= 0x2e00 && cp <= 0x2e7f) return STRONG_NONE; // supplemental punctuation
  if (cp >= 0x3000 && cp <= 0x303f) return STRONG_NONE; // CJK symbols and punctuation
  // Hebrew and Arabic presentation forms
  if (cp >= 0xfb1d && cp <= 0xfdff) return cp === 0xfb29 || (cp >= 0xfd3e && cp <= 0xfd3f) ? STRONG_NONE : STRONG_RTL;
  if (cp >= 0xfe00 && cp <= 0xfe6f) return STRONG_NONE; // variation selectors, half marks, small forms
  if (cp >= 0xfe70 && cp <= 0xfefe) return STRONG_RTL;
  if (cp >= 0xff00 && cp <= 0xffff) return (cp >= 0xff21 && cp <= 0xff3a) || (cp >= 0xff41 && cp <= 0xff5a) || (cp >= 0xff66 && cp <= 0xffdc) ? STRONG_LTR : STRONG_NONE;
  if (cp < 0x10000) return STRONG_LTR; // Glagolitic .. CJK .. Hangul syllables
  // Astral: RTL historic scripts and Arabic math, CJK extensions are L, emoji and symbols are neutral
  if ((cp >= 0x10800 && cp <= 0x10fff) || (cp >= 0x1e800 && cp <= 0x1efff)) return STRONG_RTL;
  if (cp >= 0x1f000 && cp <= 0x1ffff) return STRONG_NONE;
  if (cp >= 0xe0000) return STRONG_NONE; // tags, variation selectors supplement
  return STRONG_LTR;
}

const PDI = 0x2069;

function firstStrong(text: string): number {
  'worklet';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = (cp - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (cp === 0x2066 || cp === 0x2067 || cp === 0x2068) {
      depth += 1;
      continue;
    }
    if (cp === PDI) {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth > 0) continue;
    const s = strongOf(cp);
    if (s !== STRONG_NONE) return s;
  }
  return STRONG_NONE;
}

/**
 * The direction of a paragraph from its first strong character; `fallback` when it has none (an empty
 * line, digits only). For a multi-paragraph string it gives the direction of the first paragraph that
 * has a strong character, which is what a single-direction TextInput needs.
 */
export function paragraphDirection(text: string, fallback: TextDir = 'rtl'): TextDir {
  'worklet';
  const s = firstStrong(text);
  if (s === STRONG_RTL) return 'rtl';
  if (s === STRONG_LTR) return 'ltr';
  return fallback;
}

/** true when the text has at least one strong character (its direction does not depend on the fallback). */
export function hasStrongDirection(text: string): boolean {
  'worklet';
  return firstStrong(text) !== STRONG_NONE;
}

/**
 * Splits text into paragraphs at paragraph separators: CRLF, LF, CR, NEL (U+0085), U+2029 and the
 * file/group/record separators (U+001C..U+001E). Separators are removed; n separators give n + 1
 * paragraphs, so '' gives [''] and 'a\n' gives ['a', ''].
 */
export function splitParagraphs(text: string): string[] {
  'worklet';
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a || c === 0x0d || c === 0x85 || c === 0x2029 || (c >= 0x1c && c <= 0x1e)) {
      out.push(text.slice(start, i));
      if (c === 0x0d && text.charCodeAt(i + 1) === 0x0a) i += 1;
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

export interface DirectedParagraph {
  text: string;
  dir: TextDir;
  /** Offset of the paragraph's first character in the original string. */
  start: number;
}

/**
 * splitParagraphs plus each paragraph's direction. A paragraph with no strong character (an empty
 * line, a line of numbers) takes the direction of the paragraph before it, so a new empty line keeps
 * the caret on the side the student was writing; the first one takes `fallback`.
 */
export function directedParagraphs(text: string, fallback: TextDir = 'rtl'): DirectedParagraph[] {
  const parts = splitParagraphs(text);
  const out: DirectedParagraph[] = [];
  let prev = fallback;
  let offset = 0;
  for (const p of parts) {
    const dir = paragraphDirection(p, prev);
    out.push({ text: p, dir, start: offset });
    prev = dir;
    offset += p.length;
    // Skip the separator that ended this paragraph (two code units for CRLF).
    if (offset < text.length) offset += text.charCodeAt(offset) === 0x0d && text.charCodeAt(offset + 1) === 0x0a ? 2 : 1;
  }
  return out;
}
