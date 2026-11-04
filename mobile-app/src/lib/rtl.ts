/**
 * Layout-direction helpers.
 *
 * Arabic lays out right-to-left, English left-to-right. Release builds force RTL natively
 * (expo-localization `forcesRTL`), while Expo Go and the web preview stay LTR, so each helper
 * compares the native direction with the wanted one and flips only when they differ. Using
 * these keeps the screens identical everywhere.
 *
 * The values are live exports: `applyDirection` (called by `@/lib/i18n` when the language
 * changes) reassigns them before the screens remount. Read them at render time, never inside
 * `StyleSheet.create`, which runs once.
 */
import { I18nManager } from 'react-native';

/** The native layout direction (fixed for the app's lifetime). */
export const isNativeRTL = !!I18nManager.isRTL;

/** Whether the app is currently laid out right-to-left (Arabic). */
export let isRTL = true;

/** A horizontal row that starts on the reading side (right in Arabic, left in English). */
export let row: 'row' | 'row-reverse' = 'row';

/** Text aligned to the start of the line. React Native swaps left/right in native RTL. */
export let textStart: 'left' | 'right' = 'left';

/** Text aligned to the end of the line. */
export let textEnd: 'left' | 'right' = 'right';

/** Flex alignment for "start" on the cross axis of a column. */
export let alignStart: 'flex-start' | 'flex-end' = 'flex-start';

/** Pushes an item in a `row` to the far end, like `margin-inline-start: auto`. */
export let pushToEnd: object = {};

/** Absolute position measured from the start edge (right in Arabic, left in English). */
export const fromStart = (value: number | `${number}%`): object => {
  if (isNativeRTL) return isRTL ? { start: value } : { end: value };
  return isRTL ? { right: value } : { left: value };
};

/** Absolute position measured from the end edge. */
export const fromEnd = (value: number | `${number}%`): object => {
  if (isNativeRTL) return isRTL ? { end: value } : { start: value };
  return isRTL ? { left: value } : { right: value };
};

/** Padding on the start edge. */
export const padStart = (value: number): object => {
  if (isNativeRTL) return isRTL ? { paddingStart: value } : { paddingEnd: value };
  return isRTL ? { paddingRight: value } : { paddingLeft: value };
};

/** Padding on the end edge. */
export const padEnd = (value: number): object => {
  if (isNativeRTL) return isRTL ? { paddingEnd: value } : { paddingStart: value };
  return isRTL ? { paddingLeft: value } : { paddingRight: value };
};

/**
 * Whether a horizontal ScrollView already starts at the reading side by itself. Native RTL
 * scroll views start on the right; elsewhere they start on the left.
 */
export let scrollStartsAtReadingSide = true;

export function applyDirection(rtl: boolean) {
  isRTL = rtl;
  const same = isNativeRTL === rtl;
  row = same ? 'row' : 'row-reverse';
  textStart = same ? 'left' : 'right';
  textEnd = same ? 'right' : 'left';
  alignStart = same ? 'flex-start' : 'flex-end';
  pushToEnd = isNativeRTL
    ? rtl
      ? { marginStart: 'auto' }
      : { marginEnd: 'auto' }
    : rtl
      ? { marginRight: 'auto' }
      : { marginLeft: 'auto' };
  scrollStartsAtReadingSide = same;
}

applyDirection(true);

/**
 * Keeps a Latin/number run (grades like "A+", times like "08:00–09:30", "25%") in
 * left-to-right order inside Arabic text, using Unicode isolate marks (works on every platform).
 */
export const ltr = (text: string | number) => `⁦${text}⁩`;

/** Text-input alignment and direction for the current language (apply inline, at render). */
export const inputDir = (): { textAlign: 'left' | 'right'; writingDirection: 'rtl' | 'ltr' } => ({
  textAlign: textStart,
  writingDirection: isRTL ? 'rtl' : 'ltr',
});
