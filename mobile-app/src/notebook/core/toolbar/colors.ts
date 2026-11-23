/**
 * Toolbar color helpers (P13), pure.
 *
 * - effectivePenColor(color, paper): the ink color actually used on a page. Dark paper switches a dark
 *   pen (the default black and other near-black picks) to a light ink, so writing stays visible (NB-21).
 *   The stored pen color never changes: back on white or cream paper the same pen writes black again.
 * - penPalette(paper): the 5 pen swatches for that paper (on dark paper the black swatch is the light
 *   ink, so the selected ring matches what the pen draws).
 * - hex <-> HSV conversions for the color picker, normalizeHex for typed values, addCustomColor for the
 *   saved custom colors (most recent first, no duplicates, capped).
 *
 * The palettes repeat src/notebook/theme.ts (PEN_COLORS, HL_COLORS, DARK_PAPER_PEN), because core may
 * not import outside core; tests/notebook/toolbar/colors.test.ts keeps the copies equal.
 */
import { CUSTOM_COLORS_MAX, isHex } from '../model/index.ts';
import type { Hex, PaperColor } from '../model/index.ts';

/** Pen swatches in toolbar order: black, blue, red, green, teal (theme.ts PEN_COLORS). */
export const PEN_PALETTE: readonly Hex[] = ['#1B2533', '#1D4ED8', '#DC2626', '#15803D', '#0E7490'];
/** Highlighter swatches: yellow, green, pink, blue (theme.ts HL_COLORS). */
export const HL_PALETTE: readonly Hex[] = ['#FDE047', '#86EFAC', '#F9A8D4', '#93C5FD'];
/** Ink used instead of a dark pen on dark paper (theme.ts DARK_PAPER_PEN). */
export const DARK_PAPER_INK: Hex = '#F1F5F9';
/** Pens darker than this relative luminance are switched to DARK_PAPER_INK on dark paper. */
export const DARK_INK_LUMINANCE = 0.06;

/** Screen-reader names of the palettes, by index. */
export const PEN_COLOR_NAMES: readonly { ar: string; en: string }[] = [
  { ar: 'أسود', en: 'Black' },
  { ar: 'أزرق', en: 'Blue' },
  { ar: 'أحمر', en: 'Red' },
  { ar: 'أخضر', en: 'Green' },
  { ar: 'فيروزي', en: 'Teal' },
];
export const HL_COLOR_NAMES: readonly { ar: string; en: string }[] = [
  { ar: 'أصفر', en: 'Yellow' },
  { ar: 'أخضر', en: 'Green' },
  { ar: 'وردي', en: 'Pink' },
  { ar: 'أزرق', en: 'Blue' },
];
export const LIGHT_INK_NAME = { ar: 'أبيض', en: 'White' } as const;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Hue 0..360, saturation and value 0..1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** '#rgb', 'rgb', '#RRGGBB', 'RRGGBB' (any case, spaces trimmed) -> '#RRGGBB'; anything else -> null. */
export function normalizeHex(input: string): Hex | null {
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return ('#' + s.toUpperCase()) as Hex;
}

/** '#RRGGBB' or '#RRGGBBAA' -> 0..255 channels (alpha ignored); invalid -> null. */
export function hexToRgb(hex: string): Rgb | null {
  if (!isHex(hex)) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

const byte = (v: number) => {
  const n = Math.round(Math.min(255, Math.max(0, Number.isFinite(v) ? v : 0)));
  return n.toString(16).toUpperCase().padStart(2, '0');
};

export function rgbToHex(c: Rgb): Hex {
  return ('#' + byte(c.r) + byte(c.g) + byte(c.b)) as Hex;
}

export function rgbToHsv(c: Rgb): Hsv {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(c: Hsv): Rgb {
  const h = ((((Number.isFinite(c.h) ? c.h : 0) % 360) + 360) % 360) / 60;
  const s = clamp01(c.s);
  const v = clamp01(c.v);
  const chroma = v * s;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = v - chroma;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 1) [r, g, b] = [chroma, x, 0];
  else if (h < 2) [r, g, b] = [x, chroma, 0];
  else if (h < 3) [r, g, b] = [0, chroma, x];
  else if (h < 4) [r, g, b] = [0, x, chroma];
  else if (h < 5) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** Invalid input gives black (h 0, s 0, v 0). */
export function hexToHsv(hex: string): Hsv {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : { h: 0, s: 0, v: 0 };
}

export function hsvToHex(c: Hsv): Hex {
  return rgbToHex(hsvToRgb(c));
}

/** The fully saturated, full-value color of a hue (the color square's corner). */
export function hueColor(h: number): Hex {
  return hsvToHex({ h, s: 1, v: 1 });
}

/** WCAG relative luminance 0..1; invalid input counts as black. */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** True for colors that need a dark icon (or a border) on top of them. */
export function isLightColor(hex: string): boolean {
  return luminance(hex) > 0.6;
}

/** The pen color used on a page of this paper color (dark paper turns dark pens light). */
export function effectivePenColor(color: Hex, paper: PaperColor): Hex {
  if (paper !== 'dark') return color;
  return luminance(color) < DARK_INK_LUMINANCE ? DARK_PAPER_INK : color;
}

/** The 5 pen swatches as they draw on this paper. */
export function penPalette(paper: PaperColor): Hex[] {
  return PEN_PALETTE.map((c) => effectivePenColor(c, paper));
}

/** Same color, ignoring case and a missing alpha ('#1b2533' equals '#1B2533FF'). */
export function sameColor(a: string, b: string): boolean {
  const n = (h: string) => {
    const u = h.toUpperCase();
    return u.length === 9 && u.endsWith('FF') ? u.slice(0, 7) : u;
  };
  return n(a) === n(b);
}

/**
 * The saved custom colors after picking `hex`: it moves to the front, duplicates (and palette colors)
 * are dropped, and the list keeps at most `max` entries. Invalid input returns the list unchanged.
 */
export function addCustomColor(list: readonly Hex[], hex: string, max: number = CUSTOM_COLORS_MAX): Hex[] {
  const h = normalizeHex(hex) ?? (isHex(hex) ? (hex.toUpperCase() as Hex) : null);
  const clean = list.filter((c) => isHex(c));
  if (!h) return clean.slice(0, max);
  if (PEN_PALETTE.some((p) => sameColor(p, h)) || HL_PALETTE.some((p) => sameColor(p, h))) return clean.slice(0, max);
  return [h, ...clean.filter((c) => !sameColor(c, h))].slice(0, Math.max(0, max));
}

/** Screen-reader name for a swatch: the palette name when it is one, else the hex. */
export function colorName(hex: string, lang: 'ar' | 'en'): string {
  const pick = (n: { ar: string; en: string }) => (lang === 'ar' ? n.ar : n.en);
  const pi = PEN_PALETTE.findIndex((p) => sameColor(p, hex));
  if (pi >= 0) return pick(PEN_COLOR_NAMES[pi]);
  const hi = HL_PALETTE.findIndex((p) => sameColor(p, hex));
  if (hi >= 0) return pick(HL_COLOR_NAMES[hi]);
  if (sameColor(hex, DARK_PAPER_INK)) return pick(LIGHT_INK_NAME);
  return (lang === 'ar' ? 'لون ' : 'Color ') + hex.toUpperCase();
}
