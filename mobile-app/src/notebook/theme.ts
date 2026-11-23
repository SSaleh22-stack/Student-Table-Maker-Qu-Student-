/**
 * Notebook (المذكرات) design tokens, copied from the Figma plugin tables
 * (design-options/notebook-figma-plugin/code.js: C and CALC). The shared UI colors match
 * src/lib/theme.ts; the extra entries are the canvas, paper and ink colors.
 */

/** Plugin table C. */
export const nbColors = {
  bg: '#EEF3F8',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F6F9',
  inputBg: '#F7F9FB',
  border: '#E3E9F0',
  borderStrong: '#DCE4EC',
  divider: '#EEF2F6',
  text: '#1B2533',
  muted: '#4A5668',
  faint: '#5B6676',
  placeholder: '#6B7686',
  accent: '#0E7490',
  accentDark: '#155E75',
  accentSoft: '#DDF0F4',
  accentTint: '#E9F6F9',
  accentLight: '#7FD3E3',
  accentBorder: '#9ED3DF',
  success: '#166534',
  successSoft: '#E3F5EA',
  warning: '#92400E',
  warningSoft: '#FEF3C7',
  warningBar: '#F59E0B',
  /** Border of the warning banners (continue recording, low storage). */
  warningBorder: '#F5D58A',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
  dangerBar: '#E5484D',
  white: '#FFFFFF',
  /** The grey area around the pages in the editor. */
  canvas: '#E4EAF1',
  /** Lines of lined and grid paper on white and cream paper. */
  paperLine: '#D6E2EE',
  /** Cream paper. */
  cream: '#FBF6E9',
  /** Dark paper. */
  dark: '#1F2937',
  inkBlack: '#1B2533',
  inkBlue: '#1D4ED8',
  inkRed: '#DC2626',
  inkGreen: '#15803D',
  hlYellow: '#FDE047',
  hlGreen: '#86EFAC',
  hlPink: '#F9A8D4',
  hlBlue: '#93C5FD',
} as const;

/** Pen swatches, in toolbar order: black, blue, red, green, teal. */
export const PEN_COLORS = ['#1B2533', '#1D4ED8', '#DC2626', '#15803D', '#0E7490'] as const;

/** Highlighter swatches, in toolbar order: yellow, green, pink, blue. */
export const HL_COLORS = ['#FDE047', '#86EFAC', '#F9A8D4', '#93C5FD'] as const;

/** Default pen color on dark paper (black ink would not show). */
export const DARK_PAPER_PEN = '#F1F5F9';

/** Plugin table CALC, plus the few literal colors the calculator drawing uses. */
export const CALC_COLORS = {
  body: '#1F2433',
  fn: '#2D3344',
  fnText: '#F1F3F7',
  num: '#5E6473',
  /** Number-key text. */
  numText: '#FFFFFF',
  green: '#7CC242',
  ctrl: '#4F5667',
  /** Labels of the MODE SETUP and ON keys. */
  ctrlText: '#D9DDE5',
  gold: '#E2B24A',
  pink: '#E8587F',
  blue: '#4E9BE6',
  lcd: '#CEDBC6',
  lcdText: '#1C221C',
  lcdEdge: '#11151E',
  /** Replay (cursor) pad ring, its center and its arrows. */
  pad: '#3E4556',
  padCenter: '#2A2F3D',
  padArrow: '#C9CED8',
} as const;

/** Corner radii used by the Figma screens. */
export const nbRadius = {
  /** Lasso selection box, LCD frame, page thumbnails. */
  thumb: 10,
  /** Tool buttons and small icon tiles. */
  tool: 12,
  /** Larger icon tiles, popover rows, small banners. */
  tile: 14,
  /** Inputs, menus, info banners. */
  input: 16,
  /** Choice cards (setup, receive), low-storage banner. */
  choice: 18,
  /** Folder cards, the calculator body, drop zones. */
  folder: 20,
  /** Cards, groups, toolbars, popovers, tour cards. */
  card: 22,
  /** Player bar, page actions bar. */
  bar: 24,
  /** Modals and sheets. */
  modal: 28,
  /** Calculator number keys. */
  calcNumKey: 9,
  /** Calculator function keys. */
  calcFnKey: 7,
  /** Calculator LCD glass. */
  lcd: 6,
  pill: 999,
} as const;
