import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { isRTL } from '@/lib/rtl';
import { colors } from '@/lib/theme';

type Shape =
  { d: string } | { cx: number; cy: number; r: number } | { x: number; y: number; w: number; h: number; rx?: number };

/** Stroke icons on a 24×24 grid (same drawings as the extension's Icon set). */
const ICONS = {
  calendar: [{ x: 3, y: 4, w: 18, h: 18, rx: 2 }, { d: 'M16 2v4M8 2v4M3 10h18' }],
  calendarPlus: [{ x: 3, y: 4, w: 18, h: 18, rx: 2 }, { d: 'M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4' }],
  calculator: [
    { x: 4, y: 2, w: 16, h: 20, rx: 2 },
    { d: 'M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8' },
  ],
  userMinus: [{ cx: 15, cy: 7, r: 4 }, { d: 'M21 21v-2a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4v2M8 11H2' }],
  star: [{ d: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z' }],
  menu: [{ d: 'M4 6h16M4 12h16M4 18h16' }],
  download: [{ d: 'M12 3v12M7 10l5 5 5-5M5 21h14' }],
  share: [{ d: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13' }],
  search: [{ cx: 11, cy: 11, r: 7 }, { d: 'M21 21l-4.3-4.3' }],
  check: [{ d: 'M20 6L9 17l-5-5' }],
  x: [{ d: 'M18 6L6 18M6 6l12 12' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  minus: [{ d: 'M5 12h14' }],
  book: [{ d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5V21h16' }],
  more: [{ d: 'M5 12h.01M12 12h.01M19 12h.01' }],
  tablet: [{ x: 4, y: 2, w: 16, h: 20, rx: 2.5 }, { d: 'M11 18h2' }],
  chevronDown: [{ d: 'M6 9l6 6 6-6' }],
  chevronUp: [{ d: 'M18 15l-6-6-6 6' }],
  /** Points right: "back" in a right-to-left app. */
  back: [{ d: 'M9 18l6-6-6-6' }],
  /** Points left: "forward / open" in a right-to-left app. */
  forward: [{ d: 'M15 18l-6-6 6-6' }],
  clock: [{ cx: 12, cy: 12, r: 10 }, { d: 'M12 6v6l4 2' }],
  mapPin: [{ d: 'M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z' }, { cx: 12, cy: 10, r: 2.5 }],
  user: [{ cx: 12, cy: 8, r: 4 }, { d: 'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1' }],
  fileText: [{ d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }, { d: 'M14 2v6h6M8 13h8M8 17h5' }],
  alert: [{ d: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01' }],
  lock: [{ x: 4, y: 11, w: 16, h: 10, rx: 2 }, { d: 'M8 11V7a4 4 0 0 1 8 0v4' }],
  eye: [{ d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }, { cx: 12, cy: 12, r: 3 }],
  refresh: [{ d: 'M21 12a9 9 0 1 1-2.6-6.4L21 8' }, { d: 'M21 3v5h-5' }],
  undo: [{ d: 'M9 14L4 9l5-5' }, { d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11' }],
  grid: [
    { x: 3, y: 3, w: 7, h: 7, rx: 1.5 },
    { x: 14, y: 3, w: 7, h: 7, rx: 1.5 },
    { x: 3, y: 14, w: 7, h: 7, rx: 1.5 },
    { x: 14, y: 14, w: 7, h: 7, rx: 1.5 },
  ],
  list: [{ d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }],
  trash: [{ d: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }],
  info: [{ cx: 12, cy: 12, r: 10 }, { d: 'M12 16v-4M12 8h.01' }],
  clipboardCheck: [{ d: 'M9 11l3 3L22 4' }, { d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' }],
  mail: [{ x: 2, y: 4, w: 20, h: 16, rx: 2 }, { d: 'M22 6l-10 7L2 6' }],
  help: [{ cx: 12, cy: 12, r: 10 }, { d: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01' }],
  sliders: [{ d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }],
  /** A gear: settings. */
  settings: [
    {
      d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    },
    { cx: 12, cy: 12, r: 3 },
  ],
  external: [{ d: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
  image: [{ x: 3, y: 3, w: 18, h: 18, rx: 2 }, { cx: 8.5, cy: 8.5, r: 1.5 }, { d: 'M21 15l-5-5L5 21' }],
  globe: [{ cx: 12, cy: 12, r: 10 }, { d: 'M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' }],
  play: [{ cx: 12, cy: 12, r: 10 }, { d: 'M10 8.5v7l6-3.5z' }],
  home: [{ d: 'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' }],
  calendarDays: [
    { x: 3, y: 4, w: 18, h: 18, rx: 2 },
    { d: 'M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01' },
  ],
  sun: [
    { cx: 12, cy: 12, r: 4 },
    { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' },
  ],
  table: [{ x: 3, y: 3, w: 18, h: 18, rx: 2 }, { d: 'M3 9h18M3 15h18M9 3v18' }],
  printer: [
    { d: 'M6 9V2h12v7' },
    { d: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' },
    { x: 6, y: 14, w: 12, h: 8 },
  ],
  copy: [{ x: 9, y: 9, w: 13, h: 13, rx: 2 }, { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  message: [{ d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }],
  hash: [{ d: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18' }],
  bell: [{ d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }, { d: 'M13.73 21a2 2 0 0 1-3.46 0' }],
  /** Chat bubble with a phone handset (WhatsApp). */
  whatsapp: [
    { d: 'M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9z' },
    { d: 'M9.2 8.6c-.4 2.6 2.6 5.8 5.2 5.4l.9-1.3-1.8-1-.9.8a3 3 0 0 1-1.8-1.8l.8-.9-1-1.8z' },
  ],
  /** Paper plane (Telegram). */
  telegram: [{ d: 'M22 3L2 10.5l7 2.5 2.5 7L22 3z' }, { d: 'M9 13l5-4' }],
  /** The X (Twitter) logo: a slanted bar crossed by a stroke. */
  x_logo: [{ d: 'M4 4l11.7 16H20L8.3 4z' }, { d: 'M20 4l-6.6 7.5M4 20l6.6-7.5' }],
  /** Columned building (a university). */
  university: [{ d: 'M12 2.5l9 5H3z' }, { d: 'M5 10.5v7M9.7 10.5v7M14.3 10.5v7M19 10.5v7M3 21h18' }],

  // ---- Notebook (المذكرات): copied from design-options/notebook-figma-plugin/code.js ICONS ----
  /** Arrow curving to the right. In notebook toolbars use 'redoAction', which follows the language. */
  redo: [{ d: 'M15 14l5-5-5-5' }, { d: 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13' }],
  moreV: [{ d: 'M12 5h.01M12 12h.01M12 19h.01' }],
  scissors: [{ cx: 6, cy: 6, r: 3 }, { cx: 6, cy: 18, r: 3 }, { d: 'M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12' }],
  notebookPen: [
    { d: 'M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4' },
    { d: 'M2 6h4M2 10h4M2 14h4M2 18h4' },
    { d: 'M21.4 5.6a2.1 2.1 0 1 0-3-3l-5 5a2 2 0 0 0-.5.85l-.84 2.87a.5.5 0 0 0 .62.62l2.87-.84a2 2 0 0 0 .85-.5z' },
  ],
  pen: [
    { d: 'M12 20h9' },
    { d: 'M16.4 3.6a2.1 2.1 0 0 1 3 3L7.4 18.6a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.86z' },
  ],
  highlighter: [{ d: 'M9 11l-6 6v3h9l3-3' }, { d: 'M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4' }],
  eraser: [
    { d: 'M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21' },
    { d: 'M22 21H7M5 11l9 9' },
  ],
  lasso: [
    { d: 'M7 22a5 5 0 0 1-2-4' },
    { d: 'M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1' },
    { cx: 5, cy: 16, r: 2 },
  ],
  shapes: [{ x: 3, y: 3, w: 8, h: 8, rx: 1 }, { d: 'M17.5 3l4 7h-8z' }, { cx: 17.5, cy: 17.5, r: 3.5 }, { d: 'M4 20L11 13' }],
  ruler: [
    { d: 'M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z' },
    { d: 'M14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2' },
  ],
  type: [{ d: 'M4 7V4h16v3M9 20h6M12 4v16' }],
  mic: [{ x: 9, y: 2, w: 6, h: 12, rx: 3 }, { d: 'M19 10v2a7 7 0 0 1-14 0v-2M12 19v3' }],
  pause: [{ x: 6, y: 4, w: 4, h: 16, rx: 1 }, { x: 14, y: 4, w: 4, h: 16, rx: 1 }],
  stop: [{ x: 5, y: 5, w: 14, h: 14, rx: 2 }],
  playSolid: [{ d: 'M7 4v16l13-8z' }],
  folder: [
    { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z' },
  ],
  folderPlus: [
    { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z' },
    { d: 'M12 10v6M9 13h6' },
  ],
  scan: [{ d: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10' }],
  camera: [
    { d: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z' },
    { cx: 12, cy: 13, r: 3 },
  ],
  layers: [{ d: 'M12 2l10 5-10 5L2 7z' }, { d: 'M2 17l10 5 10-5M2 12l10 5 10-5' }],
  sort: [{ d: 'M21 16l-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16' }],
  cloud: [{ d: 'M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z' }],
  wifi: [{ d: 'M12 20h.01M2 8.8a15 15 0 0 1 20 0M5 12.9a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0' }],
  restore: [{ d: 'M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8' }, { d: 'M3 3v5h5' }],
  hand: [
    { d: 'M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8' },
    { d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15' },
  ],
  drive: [
    { d: 'M22 12H2' },
    { d: 'M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z' },
    { d: 'M6 16h.01M10 16h.01' },
  ],
  wave: [{ d: 'M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3' }],
  pointer: [{ d: 'M4 4l7 17 2.5-7.5L21 11z' }],
  bold: [{ d: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z' }],
  phone: [{ x: 5, y: 2, w: 14, h: 20, rx: 2 }, { d: 'M12 18h.01' }],
  pencilTip: [{ d: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z' }, { d: 'M15 5l4 4' }],
  zoom: [{ cx: 11, cy: 11, r: 7 }, { d: 'M21 21l-4.3-4.3M11 8v6M8 11h6' }],
  /** Two columns of dots (vertical toolbar handle). */
  grip: [{ d: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01' }],
  /** Two rows of dots (horizontal toolbar handle). */
  gripH: [{ d: 'M6 9h.01M12 9h.01M18 9h.01M6 15h.01M12 15h.01M18 15h.01' }],
  popOut: [{ d: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
  dock: [{ x: 3, y: 3, w: 18, h: 18, rx: 2 }, { d: 'M9 3v18' }],
  history: [{ d: 'M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8' }, { d: 'M3 3v5h5M12 7v5l4 2' }],
  // ---- Notebook icons not in the Figma set, drawn on the same 24 grid ----
  /** Straight line (shape tool). */
  line: [{ d: 'M5 19L19 5' }],
  /** Arrow (shape tool). Named arrowShape so it is not mistaken for navigation. */
  arrowShape: [{ d: 'M5 19L19 5M10 5h9v9' }],
  /** Rectangle (shape tool). */
  square: [{ x: 4, y: 4, w: 16, h: 16, rx: 2 }],
  /** Ellipse (shape tool). */
  circle: [{ cx: 12, cy: 12, r: 8 }],
  /** Triangle (shape tool). */
  triangle: [{ d: 'M12 4l9 16H3z' }],
  crop: [{ d: 'M6 2v14a2 2 0 0 0 2 2h14' }, { d: 'M18 22V8a2 2 0 0 0-2-2H2' }],
} satisfies Record<string, Shape[]>;

/**
 * Undo and redo for the notebook, which follow the reading direction (NB-T3: undo on the right
 * in Arabic). In Arabic (RTL) undoAction points right and redoAction points left; in English they
 * point the usual way. The plain 'undo' and 'redo' drawings never flip.
 */
type DirectionalIcon = 'undoAction' | 'redoAction';

export type IconName = keyof typeof ICONS | DirectionalIcon;

/** The drawing for an icon name in the current language (read at render time, after setLang). */
function iconShapes(name: IconName): readonly Shape[] {
  if (name === 'undoAction') return isRTL ? ICONS.redo : ICONS.undo;
  if (name === 'redoAction') return isRTL ? ICONS.undo : ICONS.redo;
  // "back" and "forward" point the other way in left-to-right (English) layout.
  if (!isRTL && name === 'back') return ICONS.forward;
  if (!isRTL && name === 'forward') return ICONS.back;
  return ICONS[name];
}

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  filled?: boolean;
}

export function Icon({ name, size = 20, color = colors.text, strokeWidth = 2, filled = false }: IconProps) {
  // Filled icons (pause, stop, playSolid) keep the stroke too, so their corners stay round as in Figma.
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: filled ? color : 'none',
  };
  const shapes = iconShapes(name);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {shapes.map((shape, i) => {
        if ('d' in shape) return <Path key={i} d={shape.d} {...common} />;
        if ('r' in shape) return <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} {...common} />;
        return <Rect key={i} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx ?? 0} {...common} />;
      })}
    </Svg>
  );
}
