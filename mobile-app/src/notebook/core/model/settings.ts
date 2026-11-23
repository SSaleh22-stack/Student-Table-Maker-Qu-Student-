/**
 * Notebook settings defaults and the deep merge used by every settings writer.
 *
 * Writers pass only the fields they own (setSettings({ calc: { float } })), and the store merges the
 * patch into the LATEST settings with deepMerge, so a stale patch never clobbers sibling fields.
 */
import { DEFAULT_PAPER } from './paper.ts';
import type { NotebookSettings, PenPreset } from './types.ts';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Pen widths in points, indexed by settings.pen.widthIndex. */
export const PEN_WIDTHS = [2, 3, 5, 7, 10] as const;
/** Highlighter widths in points, indexed by settings.highlighter.widthIndex. */
export const HL_WIDTHS = [10, 14, 18, 24, 30] as const;
export const PEN_PRESET_NAME_MAX = 40;
export const CUSTOM_COLORS_MAX = 24;
export const ERASER_SIZE_MIN = 4;
export const ERASER_SIZE_MAX = 80;

/**
 * Localized default names of the three saved pens (Figma 07), by index. Core has no tr(), so the UI
 * shows tr(PEN_PRESET_DEFAULT_NAMES[i].ar, PEN_PRESET_DEFAULT_NAMES[i].en) when a preset has no name.
 */
export const PEN_PRESET_DEFAULT_NAMES: readonly { ar: string; en: string }[] = [
  { ar: 'أزرق ناعم', en: 'Fine blue' },
  { ar: 'أسود', en: 'Black' },
  { ar: 'أحمر عريض', en: 'Bold red' },
];

const DEFAULT_PRESETS: readonly PenPreset[] = [
  { color: '#1D4ED8', width: 2 },
  { color: '#1B2533', width: 3 },
  { color: '#DC2626', width: 7 },
];

/** Defaults for a tablet (Pen input). Use defaultsFor(isTablet) to get a fresh, device-specific copy. */
export const DEFAULT_SETTINGS: Readonly<NotebookSettings> = buildDefaults(true);

function buildDefaults(isTablet: boolean): NotebookSettings {
  return {
    version: 1,
    // Phones have no stylus: finger input with finger drawing on (NB-51, NB-T2 skip).
    input: isTablet ? 'pen' : 'finger',
    fingerDraws: !isTablet,
    hand: 'right',
    pencilDoubleTap: 'eraser',
    pencilSqueeze: 'eraser',
    pressure: true,
    defaultPaper: { style: DEFAULT_PAPER.style, color: DEFAULT_PAPER.color, size: DEFAULT_PAPER.size },
    toolbarPos: 'top',
    shapeSnap: true,
    snapHintsShown: 0,
    rulerHintShown: false,
    pen: {
      presets: [{ ...DEFAULT_PRESETS[0] }, { ...DEFAULT_PRESETS[1] }, { ...DEFAULT_PRESETS[2] }],
      color: '#1B2533',
      widthIndex: 1,
    },
    highlighter: { color: '#FDE047', widthIndex: 2, straight: true },
    eraser: { mode: 'stroke', highlighterOnly: false, size: 20 },
    customColors: [],
    sort: 'updated',
    // Backup is OFF until the student turns it on (NB-85); Wi-Fi only by default (NB-86b).
    backup: { enabled: false, wifiOnly: true },
    tours: { library: 'unseen', setup: 'unseen', editor: 'unseen' },
    calc: { open: false, docked: true, float: { x: 24, y: 120 } },
  };
}

/** A fresh copy of the defaults for this device class. */
export function defaultsFor(isTablet: boolean): NotebookSettings {
  return buildDefaults(isTablet);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function clonePlain(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clonePlain);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = clonePlain(v[k]);
    return out;
  }
  return v;
}

/**
 * Merges patch into base and returns a new object (base is not changed).
 * - plain objects merge recursively
 * - arrays and tuples are REPLACED (copied)
 * - undefined values in the patch are skipped; null is a value
 */
export function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  return mergeValue(base, patch) as T;
}

function mergeValue(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return clonePlain(base);
  if (!isPlainObject(patch)) return clonePlain(patch);
  if (!isPlainObject(base)) return clonePlain(patch);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(base)) out[k] = clonePlain(base[k]);
  for (const k of Object.keys(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const pv = patch[k];
    if (pv === undefined) continue;
    out[k] = mergeValue(base[k], pv);
  }
  return out;
}
