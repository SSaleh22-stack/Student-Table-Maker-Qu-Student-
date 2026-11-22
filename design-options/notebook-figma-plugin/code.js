// QU Student — المذكرات (Notebook) beta screens, iPad portrait, Arabic RTL.
// Rebuilds the page "المذكرات — iPad" from scratch each run.

const PAGE_NAME = 'المذكرات — iPad';
const SW = 834, SH = 1194; // iPad 11" portrait
const PAD = 32;
const CW = SW - 2 * PAD;

const C = {
  bg: '#EEF3F8', surface: '#FFFFFF', surfaceMuted: '#F3F6F9', inputBg: '#F7F9FB',
  border: '#E3E9F0', borderStrong: '#DCE4EC', divider: '#EEF2F6',
  text: '#1B2533', muted: '#4A5668', faint: '#5B6676', placeholder: '#6B7686',
  accent: '#0E7490', accentDark: '#155E75', accentSoft: '#DDF0F4', accentTint: '#E9F6F9',
  accentLight: '#7FD3E3', accentBorder: '#9ED3DF',
  success: '#166534', successSoft: '#E3F5EA', warning: '#92400E', warningSoft: '#FEF3C7', warningBar: '#F59E0B',
  danger: '#B42318', dangerSoft: '#FDECEA', dangerBar: '#E5484D', white: '#FFFFFF',
  canvas: '#E4EAF1', paperLine: '#D6E2EE', cream: '#FBF6E9', dark: '#1F2937',
  inkBlack: '#1B2533', inkBlue: '#1D4ED8', inkRed: '#DC2626', inkGreen: '#15803D',
  hlYellow: '#FDE047', hlGreen: '#86EFAC', hlPink: '#F9A8D4', hlBlue: '#93C5FD',
};

// ---------- helpers ----------
const rgb = (hex) => { const h = hex.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const solid = (hex, opacity) => { const p = { type: 'SOLID', color: rgb(hex) }; if (opacity !== undefined) p.opacity = opacity; return p; };
const SHADOW = [{ type: 'DROP_SHADOW', color: { r: 0.106, g: 0.145, b: 0.2, a: 0.10 }, offset: { x: 0, y: 8 }, radius: 24, spread: 0, visible: true, blendMode: 'NORMAL' }];
const SHADOW_SM = [{ type: 'DROP_SHADOW', color: { r: 0.106, g: 0.145, b: 0.2, a: 0.08 }, offset: { x: 0, y: 3 }, radius: 10, spread: 0, visible: true, blendMode: 'NORMAL' }];

let FAM = 'IBM Plex Sans Arabic';
const W = {};
let HAND_AR = null, HAND_EN = null, LCD_FONT = null;

async function setupFonts() {
  const all = await figma.listAvailableFontsAsync();
  const stylesOf = (fam) => all.filter((f) => f.fontName.family === fam).map((f) => f.fontName.style);
  let st = stylesOf(FAM);
  if (!st.length) { FAM = 'Noto Sans Arabic'; st = stylesOf(FAM); }
  if (!st.length) { FAM = 'Inter'; st = stylesOf(FAM); }
  const pick = (res, fb) => st.find((s) => res.some((r) => r.test(s))) || fb;
  W.regular = { family: FAM, style: pick([/^Regular$/], st[0]) };
  W.medium = { family: FAM, style: pick([/^Medium$/], W.regular.style) };
  W.semibold = { family: FAM, style: pick([/^Semi ?Bold$/i], W.medium.style) };
  W.bold = { family: FAM, style: pick([/^Bold$/], W.semibold.style) };
  for (const k of Object.keys(W)) await figma.loadFontAsync(W[k]);
  const tryFont = async (fam) => {
    const s = stylesOf(fam);
    if (!s.length) return null;
    const f = { family: fam, style: s.includes('Regular') ? 'Regular' : s[0] };
    await figma.loadFontAsync(f);
    return f;
  };
  HAND_AR = (await tryFont('Aref Ruqaa')) || (await tryFont('Reem Kufi')) || W.medium;
  HAND_EN = (await tryFont('Caveat')) || (await tryFont('Kalam')) || W.medium;
  LCD_FONT = (await tryFont('Share Tech Mono')) || (await tryFont('Roboto Mono')) || { family: 'Inter', style: 'Regular' };
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
}

function T(str, o = {}) {
  const t = figma.createText();
  t.fontName = o.font || W[o.w || 'regular'];
  t.characters = str;
  t.fontSize = o.size || 15;
  t.fills = [solid(o.color || C.text, o.opacity)];
  t.textAlignHorizontal = o.align || 'RIGHT';
  if (o.lh) t.lineHeight = { unit: 'PIXELS', value: o.lh };
  if (o.width) { t.resize(o.width, t.height); t.textAutoResize = 'HEIGHT'; } else t.textAutoResize = 'WIDTH_AND_HEIGHT';
  if (o.name) t.name = o.name;
  return t;
}

function setPad(f, o) {
  const px = o.px !== undefined ? o.px : (o.pad || 0);
  const py = o.py !== undefined ? o.py : (o.pad || 0);
  f.paddingLeft = o.pl !== undefined ? o.pl : px;
  f.paddingRight = o.pr !== undefined ? o.pr : px;
  f.paddingTop = o.pt !== undefined ? o.pt : py;
  f.paddingBottom = o.pb !== undefined ? o.pb : py;
}

// Auto-layout frame. `kids` are given right-to-left for HORIZONTAL (RTL), top-to-bottom for VERTICAL.
function AL(dir, kids = [], o = {}) {
  const f = figma.createFrame();
  f.name = o.name || (dir === 'HORIZONTAL' ? 'row' : 'col');
  f.layoutMode = dir;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.itemSpacing = o.gap || 0;
  setPad(f, o);
  f.fills = o.fill ? [solid(o.fill, o.fillOpacity)] : [];
  if (o.radius) f.cornerRadius = o.radius;
  if (o.stroke) { f.strokes = [solid(o.stroke)]; f.strokeWeight = o.strokeW || 1; f.strokeAlign = 'INSIDE'; if (o.dash) f.dashPattern = o.dash; }
  f.primaryAxisAlignItems = o.align || 'MIN';
  f.counterAxisAlignItems = o.cross || (dir === 'HORIZONTAL' ? 'CENTER' : 'MAX');
  if (o.wrap) { f.layoutWrap = 'WRAP'; f.counterAxisSpacing = o.wrapGap || o.gap || 0; }
  if (o.shadow) f.effects = o.shadow === 'sm' ? SHADOW_SM : SHADOW;
  f.clipsContent = false;
  const list = dir === 'HORIZONTAL' && !o.ltr ? [...kids].reverse() : kids;
  for (const k of list) if (k) add(f, k);
  if (o.w) fixW(f, o.w);
  if (o.h) fixH(f, o.h);
  if (o.opacity !== undefined) f.opacity = o.opacity;
  return f;
}
const H = (kids, o) => AL('HORIZONTAL', kids, o);
const V = (kids, o) => AL('VERTICAL', kids, o);

// Children may carry layout hints: { node, fill: true, grow: true }
function add(parent, k) {
  if (k && k.__hint) {
    parent.appendChild(k.node);
    if (k.fillW) k.node.layoutSizingHorizontal = 'FILL';
    if (k.fillH) k.node.layoutSizingVertical = 'FILL';
    if (k.grow) k.node.layoutGrow = 1;
    return k.node;
  }
  parent.appendChild(k);
  return k;
}
const fillW = (node) => ({ __hint: true, node, fillW: true });
const grow = (node) => ({ __hint: true, node, grow: true });
const spacer = () => { const s = figma.createFrame(); s.name = 'spacer'; s.fills = []; s.resize(1, 1); return grow(s); };

function fixW(f, w) { f.resize(w, Math.max(f.height, 1)); if (f.layoutMode === 'HORIZONTAL') f.primaryAxisSizingMode = 'FIXED'; else if (f.layoutMode === 'VERTICAL') f.counterAxisSizingMode = 'FIXED'; }
function fixH(f, h) { f.resize(Math.max(f.width, 1), h); if (f.layoutMode === 'VERTICAL') f.primaryAxisSizingMode = 'FIXED'; else if (f.layoutMode === 'HORIZONTAL') f.counterAxisSizingMode = 'FIXED'; }

function R(w, h, fill, o = {}) {
  const r = figma.createRectangle();
  r.resize(w, h);
  r.fills = fill ? [solid(fill, o.opacity)] : [];
  if (o.radius) r.cornerRadius = o.radius;
  if (o.stroke) { r.strokes = [solid(o.stroke)]; r.strokeWeight = o.strokeW || 1; if (o.dash) r.dashPattern = o.dash; }
  if (o.name) r.name = o.name;
  return r;
}
function E(d, fill, o = {}) {
  const e = figma.createEllipse();
  e.resize(d, d);
  e.fills = fill ? [solid(fill, o.opacity)] : [];
  if (o.stroke) { e.strokes = [solid(o.stroke)]; e.strokeWeight = o.strokeW || 1; }
  return e;
}
function place(parent, node, x, y) { parent.appendChild(node); node.x = x; node.y = y; return node; }

// ---------- icons (24x24 stroke grid, same style as src/components/Icon.tsx) ----------
const ICONS = {
  home: [{ d: 'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' }],
  calendar: [{ x: 3, y: 4, w: 18, h: 18, rx: 2 }, { d: 'M16 2v4M8 2v4M3 10h18' }],
  calendarDays: [{ x: 3, y: 4, w: 18, h: 18, rx: 2 }, { d: 'M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01' }],
  download: [{ d: 'M12 3v12M7 10l5 5 5-5M5 21h14' }],
  calculator: [{ x: 4, y: 2, w: 16, h: 20, rx: 2 }, { d: 'M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8' }],
  userMinus: [{ cx: 15, cy: 7, r: 4 }, { d: 'M21 21v-2a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4v2M8 11H2' }],
  star: [{ d: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z' }],
  clipboardCheck: [{ d: 'M9 11l3 3L22 4' }, { d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' }],
  play: [{ cx: 12, cy: 12, r: 10 }, { d: 'M10 8.5v7l6-3.5z' }],
  menu: [{ d: 'M4 6h16M4 12h16M4 18h16' }],
  search: [{ cx: 11, cy: 11, r: 7 }, { d: 'M21 21l-4.3-4.3' }],
  check: [{ d: 'M20 6L9 17l-5-5' }],
  x: [{ d: 'M18 6L6 18M6 6l12 12' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  more: [{ d: 'M5 12h.01M12 12h.01M19 12h.01' }],
  moreV: [{ d: 'M12 5h.01M12 12h.01M12 19h.01' }],
  back: [{ d: 'M9 18l6-6-6-6' }],
  forward: [{ d: 'M15 18l-6-6 6-6' }],
  chevronDown: [{ d: 'M6 9l6 6 6-6' }],
  chevronUp: [{ d: 'M18 15l-6-6-6 6' }],
  clock: [{ cx: 12, cy: 12, r: 10 }, { d: 'M12 6v6l4 2' }],
  fileText: [{ d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }, { d: 'M14 2v6h6M8 13h8M8 17h5' }],
  image: [{ x: 3, y: 3, w: 18, h: 18, rx: 2 }, { cx: 8.5, cy: 8.5, r: 1.5 }, { d: 'M21 15l-5-5L5 21' }],
  share: [{ d: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13' }],
  trash: [{ d: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }],
  info: [{ cx: 12, cy: 12, r: 10 }, { d: 'M12 16v-4M12 8h.01' }],
  undo: [{ d: 'M9 14L4 9l5-5' }, { d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11' }],
  redo: [{ d: 'M15 14l5-5-5-5' }, { d: 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13' }],
  grid: [{ x: 3, y: 3, w: 7, h: 7, rx: 1.5 }, { x: 14, y: 3, w: 7, h: 7, rx: 1.5 }, { x: 3, y: 14, w: 7, h: 7, rx: 1.5 }, { x: 14, y: 14, w: 7, h: 7, rx: 1.5 }],
  sliders: [{ d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }],
  message: [{ d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }],
  copy: [{ x: 9, y: 9, w: 13, h: 13, rx: 2 }, { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  scissors: [{ cx: 6, cy: 6, r: 3 }, { cx: 6, cy: 18, r: 3 }, { d: 'M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12' }],
  notebookPen: [{ d: 'M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4' }, { d: 'M2 6h4M2 10h4M2 14h4M2 18h4' }, { d: 'M21.4 5.6a2.1 2.1 0 1 0-3-3l-5 5a2 2 0 0 0-.5.85l-.84 2.87a.5.5 0 0 0 .62.62l2.87-.84a2 2 0 0 0 .85-.5z' }],
  pen: [{ d: 'M12 20h9' }, { d: 'M16.4 3.6a2.1 2.1 0 0 1 3 3L7.4 18.6a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.86z' }],
  highlighter: [{ d: 'M9 11l-6 6v3h9l3-3' }, { d: 'M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4' }],
  eraser: [{ d: 'M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21' }, { d: 'M22 21H7M5 11l9 9' }],
  lasso: [{ d: 'M7 22a5 5 0 0 1-2-4' }, { d: 'M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1' }, { cx: 5, cy: 16, r: 2 }],
  shapes: [{ x: 3, y: 3, w: 8, h: 8, rx: 1 }, { d: 'M17.5 3l4 7h-8z' }, { cx: 17.5, cy: 17.5, r: 3.5 }, { d: 'M4 20L11 13' }],
  ruler: [{ d: 'M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z' }, { d: 'M14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2' }],
  type: [{ d: 'M4 7V4h16v3M9 20h6M12 4v16' }],
  mic: [{ x: 9, y: 2, w: 6, h: 12, rx: 3 }, { d: 'M19 10v2a7 7 0 0 1-14 0v-2M12 19v3' }],
  pause: [{ x: 6, y: 4, w: 4, h: 16, rx: 1 }, { x: 14, y: 4, w: 4, h: 16, rx: 1 }],
  stop: [{ x: 5, y: 5, w: 14, h: 14, rx: 2 }],
  playSolid: [{ d: 'M7 4v16l13-8z' }],
  folder: [{ d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z' }],
  folderPlus: [{ d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z' }, { d: 'M12 10v6M9 13h6' }],
  scan: [{ d: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10' }],
  camera: [{ d: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z' }, { cx: 12, cy: 13, r: 3 }],
  layers: [{ d: 'M12 2l10 5-10 5L2 7z' }, { d: 'M2 17l10 5 10-5M2 12l10 5 10-5' }],
  sort: [{ d: 'M21 16l-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16' }],
  cloud: [{ d: 'M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z' }],
  wifi: [{ d: 'M12 20h.01M2 8.8a15 15 0 0 1 20 0M5 12.9a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0' }],
  restore: [{ d: 'M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8' }, { d: 'M3 3v5h5' }],
  hand: [{ d: 'M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8' }, { d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15' }],
  drive: [{ d: 'M22 12H2' }, { d: 'M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z' }, { d: 'M6 16h.01M10 16h.01' }],
  wave: [{ d: 'M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3' }],
  pointer: [{ d: 'M4 4l7 17 2.5-7.5L21 11z' }],
  bold: [{ d: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z' }],
  phone: [{ x: 5, y: 2, w: 14, h: 20, rx: 2 }, { d: 'M12 18h.01' }],
  pencilTip: [{ d: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z' }, { d: 'M15 5l4 4' }],
  lock: [{ x: 4, y: 11, w: 16, h: 10, rx: 2 }, { d: 'M8 11V7a4 4 0 0 1 8 0v4' }],
  alert: [{ d: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01' }],
  zoom: [{ cx: 11, cy: 11, r: 7 }, { d: 'M21 21l-4.3-4.3M11 8v6M8 11h6' }],
  grip: [{ d: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01' }],
  gripH: [{ d: 'M6 9h.01M12 9h.01M18 9h.01M6 15h.01M12 15h.01M18 15h.01' }],
  popOut: [{ d: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
  dock: [{ x: 3, y: 3, w: 18, h: 18, rx: 2 }, { d: 'M9 3v18' }],
  history: [{ d: 'M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8' }, { d: 'M3 3v5h5M12 7v5l4 2' }],
};

function svgFor(name, color, sw, filled) {
  let inner = '';
  for (const s of ICONS[name]) {
    if (s.d) inner += `<path d="${s.d}"/>`;
    else if (s.r !== undefined) inner += `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`;
    else inner += `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx || 0}"/>`;
  }
  const paint = filled ? `fill="${color}" stroke="${color}"` : `fill="none" stroke="${color}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ${paint} stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
function I(name, size = 20, color = C.text, o = {}) {
  const n = figma.createNodeFromSvg(svgFor(name, color, o.sw || 2, o.filled));
  n.name = 'icon/' + name;
  n.fills = [];
  n.rescale(size / 24);
  return n;
}
// Free-form ink stroke from an SVG path (in a w x h box).
function ink(d, w, h, color, sw = 3, opacity) {
  const n = figma.createNodeFromSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none"><path d="${d}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  n.name = 'ink';
  n.fills = [];
  if (opacity !== undefined) n.opacity = opacity;
  return n;
}

// ---------- shared UI parts ----------
function circleBtn(icon, o = {}) {
  const f = H([I(icon, o.isz || 20, o.color || C.text)], { name: 'btn/' + icon, fill: o.fill || C.surface, radius: 999, align: 'CENTER', cross: 'CENTER', w: o.size || 44, h: o.size || 44, stroke: o.stroke === false ? null : (o.stroke || C.border) });
  return f;
}
function chip(label, o = {}) {
  const on = !!o.on;
  const kids = [];
  if (o.icon) kids.push(I(o.icon, o.isz || 16, on ? C.white : (o.iconColor || C.muted)));
  kids.push(T(label, { size: o.size || 14, w: on ? 'semibold' : 'medium', color: on ? C.white : (o.color || C.muted) }));
  return H(kids, { name: 'chip', gap: 6, px: o.px || 16, py: o.py || 8, radius: 999, fill: on ? (o.onFill || C.accent) : (o.fill || C.surface), stroke: on ? null : (o.stroke || C.border), cross: 'CENTER' });
}
function pill(label, fill, color, o = {}) {
  const kids = [];
  if (o.icon) kids.push(I(o.icon, o.isz || 12, color));
  kids.push(T(label, { size: o.size || 12, w: 'semibold', color }));
  return H(kids, { name: 'pill', gap: 4, px: o.px || 10, py: o.py || 3, radius: 999, fill, cross: 'CENTER' });
}
function toggle(on) {
  const f = figma.createFrame();
  f.name = on ? 'switch/on' : 'switch/off';
  f.resize(52, 32); f.cornerRadius = 16; f.fills = [solid(on ? C.accent : '#CBD5E1')];
  const k = E(26, C.white); k.effects = SHADOW_SM; place(f, k, on ? 3 : 23, 3); // RTL: on = knob on the left
  return f;
}
function primaryBtn(label, o = {}) {
  const kids = [];
  if (o.icon) kids.push(I(o.icon, 20, o.danger ? C.white : C.white));
  kids.push(T(label, { size: o.size || 17, w: 'bold', color: C.white }));
  return H(kids, { name: 'button/primary', gap: 8, px: 28, py: o.py || 15, radius: 999, fill: o.danger ? C.danger : C.accent, align: 'CENTER', cross: 'CENTER', w: o.w });
}
function secondaryBtn(label, o = {}) {
  const kids = [];
  if (o.icon) kids.push(I(o.icon, 18, o.color || C.accentDark));
  kids.push(T(label, { size: o.size || 16, w: 'semibold', color: o.color || C.accentDark }));
  return H(kids, { name: 'button/secondary', gap: 8, px: 24, py: o.py || 13, radius: 999, fill: o.fill || C.accentSoft, align: 'CENTER', cross: 'CENTER', w: o.w });
}
function card(kids, o = {}) {
  return V(kids, Object.assign({ name: 'card', fill: C.surface, radius: 22, stroke: C.border, pad: 22, gap: 14 }, o));
}
function sectionTitle(label, extra, sub) {
  return H([T(label, { size: 18, w: 'bold' }), sub ? T(sub, { size: 13, color: C.faint }) : null, spacer(), extra || null], { name: 'section-title', gap: 10, w: CW, cross: 'CENTER' });
}
function showAll(n) {
  return H([T('عرض الكل (' + n + ')', { size: 14, w: 'bold', color: C.accent }), I('forward', 16, C.accent)], { name: 'show-all', gap: 4, cross: 'CENTER' });
}
function betaPill(size = 12) { return pill('تجريبي', C.warningSoft, C.warning, { size, px: 10, py: 3 }); }

let STATUS_COMP = null;
function statusBar(scr, dark) {
  const inst = STATUS_COMP.createInstance();
  place(scr, inst, 0, 0);
  if (dark) for (const n of inst.findAll((x) => x.type === 'TEXT')) n.fills = [solid(C.white)];
  if (dark) for (const n of inst.findAll((x) => x.name === 'battery-fill')) n.fills = [solid(C.white)];
  return inst;
}
function buildStatusComponent(page) {
  const c = figma.createComponent();
  c.name = 'iPad / Status bar';
  c.resize(SW, 28); c.fills = [];
  place(c, T('9:41', { size: 13, w: 'semibold', align: 'LEFT', font: { family: 'Inter', style: 'Semi Bold' } }), 22, 6);
  place(c, T('الأحد 22 نوفمبر', { size: 13, w: 'semibold', align: 'LEFT' }), 62, 5);
  const bat = figma.createFrame(); bat.name = 'battery'; bat.resize(27, 13); bat.cornerRadius = 4; bat.fills = []; bat.strokes = [solid(C.text, 0.5)]; bat.strokeWeight = 1;
  const fill = R(21, 9, C.text, { radius: 2, name: 'battery-fill' }); place(bat, fill, 3, 2);
  place(c, bat, SW - 50, 8);
  place(c, T('100%', { size: 12, w: 'semibold', align: 'LEFT', font: { family: 'Inter', style: 'Semi Bold' } }), SW - 92, 6);
  page.appendChild(c);
  c.x = -1200; c.y = 0;
  c.description = 'iPad status bar (system UI, not mirrored in RTL).';
  return c;
}

function screen(name, col, row, bg = C.bg, w = SW, h = SH) {
  const f = figma.createFrame();
  f.name = name;
  f.resize(w, h);
  f.fills = [solid(bg)];
  f.clipsContent = true;
  PAGE.appendChild(f);
  f.x = col * (SW + 140);
  f.y = row * (SH + 220);
  return f;
}

// Nav header used on in-app pages: [back, title block] on the right, actions on the left.
function navBar(title, o = {}) {
  const titleKids = [H([T(title, { size: o.tsize || 28, w: 'bold' }), o.badge || null], { gap: 10, cross: 'CENTER' })];
  if (o.sub) titleKids.push(T(o.sub, { size: 14, color: C.faint }));
  const left = (o.actions || []);
  const right = [o.noBack ? null : circleBtn('back', { size: 44 }), V(titleKids, { gap: 2, cross: 'MAX' })];
  return H([...right, spacer(), ...left], { name: 'nav', gap: 14, w: CW, cross: 'CENTER' });
}

function tabBar(scr, active = 0) {
  const tabs = [['home', 'الرئيسية'], ['calendar', 'الجدول'], ['clipboardCheck', 'مهامي'], ['star', 'قيم'], ['menu', 'المزيد']];
  const items = tabs.map(([ic, lb], i) => V([I(ic, 26, i === active ? C.accent : C.placeholder), T(lb, { size: 13, w: i === active ? 'bold' : 'medium', color: i === active ? C.accent : C.placeholder, align: 'CENTER' })], { gap: 4, cross: 'CENTER', w: 120 }));
  const bar = H(items, { name: 'tab-bar', fill: C.surface, align: 'SPACE_BETWEEN', cross: 'CENTER', px: 60, pt: 12, pb: 26, w: SW });
  bar.strokes = [solid(C.border)]; bar.strokeWeight = 1; bar.strokeTopWeight = 1; bar.strokeBottomWeight = 0; bar.strokeLeftWeight = 0; bar.strokeRightWeight = 0;
  place(scr, bar, 0, SH - bar.height);
  return bar;
}

// Paper backgrounds
function paper(w, h, style, color = C.white, o = {}) {
  const f = figma.createFrame();
  f.name = 'paper/' + style;
  f.resize(w, h);
  f.fills = [solid(color)];
  f.cornerRadius = o.radius || 4;
  f.clipsContent = true;
  if (o.shadow !== false) f.effects = SHADOW_SM;
  const lineC = color === C.dark ? '#374151' : C.paperLine;
  const step = o.step || 32;
  if (style === 'lined') { for (let y = o.top || 72; y < h - 10; y += step) place(f, R(w, 1, lineC), 0, y); place(f, R(1.5, h, '#F3B4B4'), w - (o.margin || 64), 0); }
  if (style === 'grid') { for (let y = step; y < h; y += step) place(f, R(w, 1, lineC), 0, y); for (let x = step; x < w; x += step) place(f, R(1, h, lineC), x, 0); }
  if (style === 'dotted') { for (let y = step; y < h; y += step) for (let x = step; x < w; x += step) place(f, E(o.dot || 3, lineC), x - 1, y - 1); }
  return f;
}

// Notebook thumbnail card (library grids)
function notebookCard(title, sub, o = {}) {
  const thumb = paper(o.tw || 168, o.th || 214, o.style || 'lined', o.color || C.white, { step: 14, top: 30, margin: 24, shadow: false, radius: 10 });
  thumb.strokes = [solid(C.border)]; thumb.strokeWeight = 1;
  if (o.pdf) {
    place(thumb, R((o.tw || 168) - 28, 30, C.accentSoft, { radius: 4 }), 14, 16);
    place(thumb, T('PDF', { size: 10, w: 'bold', color: C.accentDark, align: 'LEFT', font: { family: 'Inter', style: 'Semi Bold' } }), 22, 24);
    for (let i = 0; i < 6; i++) place(thumb, R(90 - (i % 3) * 18, 5, '#CBD5E1', { radius: 3 }), (o.tw || 168) - 14 - (90 - (i % 3) * 18), 62 + i * 16);
    place(thumb, R(80, 8, C.hlYellow, { opacity: 0.6, radius: 2 }), (o.tw || 168) - 96, 76);
  }
  if (!o.pdf && o.style !== 'blank') {
    place(thumb, ink('M8 14 C 30 6, 52 20, 74 10 S 110 14, 128 8', 136, 22, C.inkBlue, 2.2), 18, 30);
    place(thumb, ink('M6 10 C 24 4, 40 16, 60 8 S 88 12, 100 6', 108, 18, C.inkBlack, 2), 40, 58);
    place(thumb, ink('M6 10 C 22 3, 36 14, 54 7 S 76 10, 90 5', 96, 18, C.inkBlack, 2), 50, 86);
  }
  if (o.mic) place(thumb, H([I('mic', 12, C.white)], { fill: C.danger, radius: 999, pad: 5 }), 8, 8);
  const meta = [T(title, { size: 15, w: 'semibold', width: o.tw || 168 })];
  if (sub) meta.push(T(sub, { size: 12, color: C.faint, width: o.tw || 168 }));
  const c = V([thumb, ...meta], { name: 'notebook-card', gap: 8, cross: 'MAX' });
  return c;
}

function folderCard(code, name, count, o = {}) {
  const top = H([pill(code, o.course ? C.accentSoft : C.surfaceMuted, o.course ? C.accentDark : C.muted, { size: 12 }), spacer(), I(o.course ? 'notebookPen' : 'folder', 22, o.course ? C.accent : C.faint)], { w: 145, cross: 'CENTER' });
  return V([top, T(name, { size: 16, w: 'bold', width: 145 }), T(count, { size: 13, color: C.faint, width: 145 })], { name: 'folder-card', fill: C.surface, radius: 20, stroke: C.border, pad: 18, gap: 8, cross: 'MAX', w: 181 });
}

function overlay(scr) { const o = R(SW, SH, '#1B2533', { opacity: 0.42, name: 'overlay' }); place(scr, o, 0, 0); return o; }
function modal(scr, kids, w = 620, o = {}) {
  const m = V(kids, { name: 'modal', fill: C.surface, radius: 28, pad: 28, gap: 20, w, shadow: true, cross: 'MAX' });
  place(scr, m, (SW - w) / 2, o.y !== undefined ? o.y : Math.max(60, (SH - m.height) / 2));
  return m;
}
function modalHeader(title, sub) {
  const t = [T(title, { size: 22, w: 'bold' })];
  if (sub) t.push(T(sub, { size: 14, color: C.faint }));
  return H([V(t, { gap: 2, cross: 'MAX' }), spacer(), circleBtn('x', { size: 40, fill: C.surfaceMuted, stroke: false, isz: 18 })], { w: 564, cross: 'CENTER' });
}
function fieldLabel(s) { return T(s, { size: 14, w: 'semibold', color: C.muted }); }
function input(value, o = {}) {
  return H([o.icon ? I(o.icon, 18, C.placeholder) : null, T(value, { size: 16, color: o.placeholder ? C.placeholder : C.text }), spacer()], { name: 'input', gap: 10, px: 18, py: 14, radius: 16, fill: C.inputBg, stroke: o.focus ? C.accent : C.border, strokeW: o.focus ? 2 : 1, w: o.w || 564, cross: 'CENTER' });
}
function listRow(icon, label, o = {}) {
  const right = [];
  if (icon) right.push(H([I(icon, 20, o.iconColor || C.accent)], { fill: o.iconFill || C.accentTint, radius: 12, pad: 9 }));
  const lab = [T(label, { size: 16, w: 'medium', color: o.labelColor || C.text })];
  if (o.sub) lab.push(T(o.sub, { size: 13, color: C.faint }));
  right.push(V(lab, { gap: 2, cross: 'MAX' }));
  const left = [];
  if (o.value) left.push(T(o.value, { size: 15, color: C.faint }));
  if (o.toggle !== undefined) left.push(toggle(o.toggle));
  if (o.chevron) left.push(I('forward', 18, C.placeholder));
  return H([...right, spacer(), ...left], { name: 'row', gap: 12, px: 20, py: 14, w: o.w || CW, cross: 'CENTER' });
}
function divider(w) { return R(w, 1, C.divider, { name: 'divider' }); }
function group(rows, w = CW) {
  const kids = [];
  rows.forEach((r, i) => { if (i) kids.push(divider(w)); kids.push(r); });
  return V(kids, { name: 'group', fill: C.surface, radius: 22, stroke: C.border, w, cross: 'MAX' });
}

// ---------- editor chrome ----------
const TOOLS = [['pen', 'قلم'], ['highlighter', 'تظليل'], ['eraser', 'ممحاة'], ['lasso', 'تحديد'], ['shapes', 'أشكال'], ['ruler', 'مسطرة'], ['type', 'نص'], ['image', 'صورة'], ['calculator', 'آلة حاسبة']];
function toolButton(icon, active, o = {}) {
  const kids = [I(icon, 22, active ? C.white : C.text)];
  const b = V(kids, { name: 'tool/' + icon, fill: active ? C.accent : null, radius: 12, align: 'CENTER', cross: 'CENTER', w: 40, h: 40 });
  if (o.dot) { const d = E(8, o.dot); d.strokes = [solid(C.white)]; d.strokeWeight = 1.5; b.appendChild(d); d.layoutPositioning = 'ABSOLUTE'; d.x = 28; d.y = 28; }
  return b;
}
function vsep() { return R(1, 28, C.border, { name: 'sep' }); }
function colorDot(hex, on, size = 28) { const f = figma.createFrame(); f.name = 'color'; f.resize(size, size); f.cornerRadius = size / 2; f.fills = [solid(hex)]; if (on) { f.strokes = [solid(C.accent)]; f.strokeWeight = 3; f.strokeAlign = 'OUTSIDE'; } return f; }

// Icons only: back on the right, pages / share / more on the left, floating over the canvas.
function editorTopBar(scr, o = {}) {
  const btn = (ic) => circleBtn(ic, { size: 40, stroke: false, fill: C.surface });
  const back = btn('back'); back.effects = SHADOW_SM; back.name = 'btn/back';
  place(scr, back, SW - 16 - 40, 34);
  const left = H([btn('layers'), btn('share'), btn('moreV')], { name: 'editor-actions', fill: C.surface, radius: 999, gap: 2, px: 4, shadow: 'sm', cross: 'CENTER' });
  place(scr, left, 16, 34);
  return left;
}
function editorToolbar(scr, o = {}) {
  const pos = o.pos || 'top';
  const vertical = pos === 'left' || pos === 'right';
  const active = o.active || 'pen';
  const sep = () => (vertical ? R(26, 1, C.border, { name: 'sep' }) : vsep());
  const tools = TOOLS.map(([ic]) => toolButton(ic, ic === active || (ic === 'calculator' && o.calcOpen), { dot: ic === 'pen' ? (o.penColor || C.inkBlue) : ic === 'highlighter' ? C.hlYellow : null }));
  const colors = [C.inkBlack, C.inkBlue, C.inkRed, C.inkGreen, C.accent].map((c, i) => colorDot(c, i === (o.colorIdx === undefined ? 1 : o.colorIdx), 24));
  const rec = o.recording
    ? H([E(10, C.white), T(o.recTime || '12:47', { size: 14, w: 'bold', color: C.white, font: { family: 'Inter', style: 'Semi Bold' } }), I('pause', 14, C.white, { filled: true }), I('stop', 14, C.white, { filled: true })], { name: 'record/active', gap: 6, px: 10, py: 10, radius: 999, fill: C.danger, cross: 'CENTER' })
    : H([I('mic', 20, C.danger)], { name: 'record', fill: C.dangerSoft, radius: 999, pad: 10 });
  const grip = (vertical ? V : H)([I(vertical ? 'gripH' : 'grip', 18, C.placeholder, { sw: 2.8 })], { name: 'grip (long-press to move)', w: vertical ? 40 : 20, h: vertical ? 20 : 40, align: 'CENTER', cross: 'CENTER' });
  const items = [grip, ...tools, sep(), ...colors, sep(), toolButton('undo', false), toolButton('redo', false), sep(), rec];
  const props = { name: 'toolbar/' + pos, fill: C.surface, radius: 22, gap: 3, px: vertical ? 7 : 10, py: vertical ? 10 : 7, shadow: true, cross: 'CENTER', align: 'MIN' };
  const bar = vertical ? V(items, props) : H(items, props);
  let x, y;
  if (pos === 'top') { x = (SW - bar.width) / 2; y = o.y || 84; }
  else if (pos === 'bottom') { x = (SW - bar.width) / 2; y = SH - 62 - bar.height; }
  else if (pos === 'right') { x = SW - 14 - bar.width; y = 120 + (SH - 200 - bar.height) / 2; }
  else if (pos === 'left') { x = 14; y = 120 + (SH - 200 - bar.height) / 2; }
  else { x = o.x; y = o.y; }
  place(scr, bar, x, y);
  if (o.lifted) { bar.effects = [{ type: 'DROP_SHADOW', color: { r: 0.106, g: 0.145, b: 0.2, a: 0.28 }, offset: { x: 0, y: 20 }, radius: 44, spread: 0, visible: true, blendMode: 'NORMAL' }]; bar.rotation = -2; }
  return bar;
}
function pageFooter(scr, label = '3 / 8') {
  const p = H([I('layers', 16, C.muted), T(label, { size: 14, w: 'semibold', color: C.muted, font: { family: 'Inter', style: 'Semi Bold' } })], { gap: 6, px: 14, py: 8, radius: 999, fill: C.surface, shadow: 'sm', cross: 'CENTER' });
  place(scr, p, SW - p.width - 18, SH - 50);
  const z = H([T('100%', { size: 14, w: 'semibold', color: C.muted, font: { family: 'Inter', style: 'Semi Bold' } }), I('zoom', 16, C.muted)], { gap: 6, px: 14, py: 8, radius: 999, fill: C.surface, shadow: 'sm', cross: 'CENTER' });
  place(scr, z, 18, SH - 50);
}

// The lecture page used on several editor screens (lined A4 with handwriting).
const PAGE_W = 640, PAGE_H = 905;
const K = 1.1; // the page is drawn 10% bigger now that the editor header is icons-only
function lecturePage(o = {}) {
  const p = paper(PAGE_W, PAGE_H, 'lined', C.white, { step: 36, top: 120, margin: 70 });
  p.name = 'page/lined';
  const dim = (n, late) => { if (o.dimAfter && late) n.opacity = 0.28; return n; };
  place(p, dim(T('المصفوفات — Matrices', { size: 40, font: HAND_AR, color: C.inkBlue, align: 'RIGHT' }), false), PAGE_W - 90 - 360, 42).resize(360, 60);
  place(p, ink('M4 8 C 80 2, 180 12, 300 5', 304, 14, C.inkBlue, 2.5), PAGE_W - 90 - 300, 100);
  const lines = [
    ['• المصفوفة جدول من الأعداد مرتب في صفوف وأعمدة', C.inkBlack, false],
    ['• الرتبة = عدد الصفوف × عدد الأعمدة  (2 × 2)', C.inkBlack, false],
    ['• الضرب ممكن فقط إذا كانت أعمدة الأولى = صفوف الثانية', C.inkRed, true],
  ];
  lines.forEach(([s, c, late], i) => {
    const t = T(s, { size: 25, font: HAND_AR, color: c, width: PAGE_W - 150 });
    place(p, dim(t, late), 70, 132 + i * 72 - 6);
  });
  if (o.highlight !== false) { const hl = R(330, 26, C.hlYellow, { opacity: 0.5, radius: 4, name: 'highlight' }); place(p, hl, PAGE_W - 90 - 330, 208); p.insertChild(1, hl); }
  const m1 = T('A = [ 1  2 ]', { size: 34, font: HAND_EN, color: C.inkBlack, align: 'LEFT' });
  const m2 = T('       [ 3  4 ]', { size: 34, font: HAND_EN, color: C.inkBlack, align: 'LEFT' });
  place(p, dim(m1, true), 110, 380); place(p, dim(m2, true), 110, 418);
  place(p, dim(T('2 × 2', { size: 28, font: HAND_EN, color: C.inkRed, align: 'LEFT' }), true), 300, 400);
  place(p, dim(ink('M6 30 C 30 6, 70 4, 96 26 L 86 22 M 96 26 L 92 14', 104, 40, C.inkRed, 2.5), true), 226, 396);
  place(p, dim(ink('M10 40 C 10 12, 120 4, 170 20 C 220 36, 200 70, 120 74 C 50 78, 8 66, 10 40 Z', 210, 84, C.accent, 2.5), true), 92, 372);
  place(p, dim(T('مثال: احسب A × A', { size: 25, font: HAND_AR, color: C.inkBlack, width: PAGE_W - 150 }), true), 70, 510);
  place(p, dim(T('= [ 7  10 ]', { size: 32, font: HAND_EN, color: C.inkBlue, align: 'LEFT' }), true), 130, 572);
  place(p, dim(T('   [ 15  22 ]', { size: 32, font: HAND_EN, color: C.inkBlue, align: 'LEFT' }), true), 130, 610);
  if (o.extra) o.extra(p);
  return p;
}
function canvasArea(scr, top = 180) { const a = R(SW, SH - top, C.canvas, { name: 'canvas' }); place(scr, a, 0, top); return a; }

// ---------- screens ----------
let PAGE;

function sHome() {
  const s = screen('01 · الرئيسية — أيقونة المذكرات (تجريبي)', 0, 0);
  const header = R(SW, 330, C.accent, { name: 'teal-header' }); place(s, header, 0, 0);
  statusBar(s, true);
  place(s, T('أهلاً بك', { size: 34, w: 'bold', color: C.white }), 0, 0);
  const hello = s.children[s.children.length - 1]; hello.x = SW - PAD - hello.width; hello.y = 70;
  const date = T('الأحد، 22 نوفمبر · الأسبوع 12', { size: 16, color: '#CFEFF5' }); place(s, date, SW - PAD - date.width, 120);
  const next = H([V([T('المحاضرة القادمة', { size: 13, color: '#CFEFF5' }), T('البرمجة 2 · CS102', { size: 20, w: 'bold', color: C.white }), T('10:00 ص · مبنى 11 · قاعة 204', { size: 14, color: '#CFEFF5' })], { gap: 2, cross: 'MAX' }), spacer(), pill('بعد 25 دقيقة', '#FFFFFF', C.accentDark, { size: 13, px: 12, py: 5 })], { fill: C.accentDark, radius: 20, px: 20, py: 16, w: CW, cross: 'CENTER' });
  place(s, next, PAD, 158);

  const features = [['calendar', 'جدولي'], ['download', 'الاستيراد'], ['calendarDays', 'التقويم'], ['calculator', 'المعدل'], ['userMinus', 'الغياب'], ['star', 'قيم'], ['clipboardCheck', 'تقييم المقررات'], ['play', 'مقاطع الشرح'], ['notebookPen', 'المذكرات']];
  const cellW = Math.floor((CW - 28) / 4);
  const cell = ([ic, lb], isNew) => {
    const circle = H([I(ic, 28, isNew ? C.white : C.accentDark)], { name: 'icon-circle', fill: isNew ? C.accent : C.accentTint, radius: 999, w: 64, h: 64, align: 'CENTER', cross: 'CENTER' });
    if (isNew) { const b = betaPill(11); circle.appendChild(b); b.layoutPositioning = 'ABSOLUTE'; b.x = -26; b.y = -8; }
    return V([circle, T(lb, { size: 14, w: 'semibold', align: 'CENTER' })], { name: isNew ? 'cell/المذكرات (new)' : 'cell', gap: 10, cross: 'CENTER', w: cellW, py: 14 });
  };
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const slice = features.slice(r * 4, r * 4 + 4);
    if (!slice.length) break;
    rows.push(H(slice.map((f) => cell(f, f[0] === 'notebookPen')), { gap: 0 }));
  }
  const services = V(rows, { name: 'services-card', fill: C.surface, radius: 26, stroke: C.border, px: 14, py: 8, gap: 0, shadow: true, w: CW, cross: 'MAX' });
  place(s, services, PAD, 290);
  // annotation
  const note = H([I('info', 18, C.warning), T('ملاحظة للتصميم (NB-3): الأيقونة التاسعة تبدأ صفاً ثالثاً على iPad العمودي (4 أعمدة). راجع ترتيب الشبكة.', { size: 13, color: C.warning, width: CW - 70 })], { gap: 8, fill: C.warningSoft, radius: 14, px: 16, py: 12, w: CW, cross: 'MIN' });
  place(s, note, PAD, 290 + services.height + 16);
  const ann = card([H([T('الإعلانات', { size: 18, w: 'bold' }), spacer(), T('عرض الكل', { size: 14, w: 'semibold', color: C.accent })], { w: CW - 44 }), H([V([T('جديد: المذكرات', { size: 17, w: 'bold' }), T('اكتب بالقلم، علّق على ملفات PDF، وسجّل المحاضرة — مجاناً.', { size: 14, color: C.faint, width: 520 })], { gap: 4, cross: 'MAX' }), spacer(), H([I('notebookPen', 26, C.accent)], { fill: C.accentTint, radius: 16, pad: 14 })], { w: CW - 44, cross: 'CENTER' })], { w: CW });
  place(s, ann, PAD, note.y + note.height + 20);
  tabBar(s, 0);
}

function libraryContent(s, o = {}) {
  statusBar(s);
  const nav = navBar('المذكرات', { badge: betaPill(13), sub: '12 مذكرة · آخر تعديل اليوم', noBack: false, actions: [circleBtn('sliders'), circleBtn('sort')] });
  place(s, nav, PAD, 44);
  const search = input('ابحث في المذكرات', { icon: 'search', placeholder: true, w: CW });
  place(s, search, PAD, 140);
  const fb = H([H([I('message', 18, C.accentDark)], { fill: C.surface, radius: 10, pad: 7 }), T('المذكرات ميزة تجريبية — شاركنا رأيك أو أبلغ عن مشكلة', { size: 14, w: 'medium', color: C.accentDark }), spacer(), T('أرسل ملاحظة', { size: 14, w: 'bold', color: C.accent })], { name: 'beta-feedback', gap: 10, fill: C.accentTint, stroke: C.accentBorder, radius: 16, px: 14, py: 10, w: CW, cross: 'CENTER' });
  place(s, fb, PAD, 206);
  let y = 280;
  const st1 = sectionTitle('موادي', showAll(6), 'من جدولك'); place(s, st1, PAD, y); y += 40;
  const courses = H([folderCard('CS102', 'البرمجة 2', '4 مذكرات', { course: true }), folderCard('MATH106', 'التفاضل والتكامل', '3 مذكرات', { course: true }), folderCard('PHYS101', 'فيزياء عامة 1', '2 مذكرة', { course: true }), folderCard('ARAB101', 'مهارات لغوية', 'لا توجد مذكرات', { course: true })], { gap: 15 });
  place(s, courses, SW - PAD - courses.width, y); y += courses.height + 22;
  const addFolder = H([I('folderPlus', 18, C.accent), T('مجلد جديد', { size: 14, w: 'bold', color: C.accent })], { name: 'new-folder', gap: 6, cross: 'CENTER' });
  const st2 = sectionTitle('مجلداتي', H([showAll(5), R(1, 16, C.border), addFolder], { gap: 14, cross: 'CENTER' })); place(s, st2, PAD, y); y += 40;
  const mine = H([folderCard('مجلد', 'مراجعة الاختبارات', '5 مذكرات'), folderCard('مجلد', 'مشروع التخرج', 'مذكرتان'), folderCard('مجلد', 'التدريب الصيفي', '3 مذكرات'), folderCard('مجلد', 'نادي البرمجة', 'مذكرة واحدة')], { gap: 15 });
  place(s, mine, SW - PAD - mine.width, y); y += mine.height + 22;
  const st3 = sectionTitle('بدون مجلد', showAll(9)); place(s, st3, PAD, y); y += 40;
  const loose = H([notebookCard('أفكار سريعة', 'اليوم 10:32 ص', { mic: false }), notebookCard('اختبار 2023 — محلول', 'أمس', { pdf: true }), notebookCard('ملاحظات الإرشاد', '18 نوفمبر', { style: 'dotted' }), notebookCard('محاضرة مسجلة', '15 نوفمبر', { mic: true })], { gap: 32, cross: 'MIN' });
  place(s, loose, SW - PAD - loose.width, y); y += loose.height + 18;
  const del = H([I('trash', 18, C.faint), T('المحذوفة مؤخراً (3)', { size: 15, w: 'medium', color: C.faint }), spacer(), I('forward', 18, C.placeholder)], { gap: 8, w: CW, cross: 'CENTER', px: 4 });
  place(s, del, PAD, Math.min(y, SH - 160));
  const fab = H([I('plus', 22, C.white), T('مذكرة جديدة', { size: 17, w: 'bold', color: C.white })], { name: 'fab', gap: 8, px: 24, py: 16, radius: 999, fill: C.accent, shadow: true, cross: 'CENTER' });
  place(s, fab, PAD, SH - 100);
  return s;
}

function sLibrary() { libraryContent(screen('02 · مكتبة المذكرات', 1, 0)); }

function sFolder() {
  const s = screen('03 · مجلد المادة — CS102', 2, 0);
  statusBar(s);
  place(s, navBar('البرمجة 2', { sub: 'CS102 · 4 مذكرات · مجلد من جدولك', actions: [circleBtn('sort'), circleBtn('more')] }), PAD, 44);
  const sorts = H([chip('آخر تعديل', { on: true }), chip('الاسم'), chip('تاريخ الإنشاء')], { gap: 8 });
  place(s, sorts, SW - PAD - sorts.width, 142);
  const g = H([
    notebookCard('محاضرة 5 — المصفوفات', 'اليوم 11:05 ص · 8 صفحات', { mic: true, tw: 230, th: 300 }),
    notebookCard('محاضرة 4 — الاستدعاء الذاتي', 'أمس · 12 صفحة', { pdf: true, tw: 230, th: 300 }),
    notebookCard('واجب 3 — حلول', '19 نوفمبر · 3 صفحات', { style: 'grid', tw: 230, th: 300 }),
  ], { gap: 40, cross: 'MIN' });
  place(s, g, PAD, 206);
  const g2 = H([notebookCard('ملخص الاختبار النصفي', '10 نوفمبر · 6 صفحات', { color: C.cream, tw: 230, th: 300 })], { gap: 40 });
  place(s, g2, SW - PAD - g2.width, 206 + g.height + 32);
  const fab = H([I('plus', 22, C.white), T('مذكرة جديدة في CS102', { size: 17, w: 'bold', color: C.white })], { name: 'fab', gap: 8, px: 24, py: 16, radius: 999, fill: C.accent, shadow: true, cross: 'CENTER' });
  place(s, fab, PAD, SH - 100);
}

function paperTile(label, style, on) {
  const p = paper(96, 124, style, C.white, { step: 12, top: 18, margin: 16, shadow: false, radius: 8, dot: 2 });
  p.strokes = [solid(on ? C.accent : C.border)]; p.strokeWeight = on ? 2.5 : 1;
  return V([p, T(label, { size: 14, w: on ? 'bold' : 'medium', color: on ? C.accent : C.muted, align: 'CENTER' })], { gap: 8, cross: 'CENTER' });
}
function swatch(hex, label, on) {
  const d = E(40, hex, { stroke: on ? C.accent : C.borderStrong, strokeW: on ? 3 : 1 });
  return V([d, T(label, { size: 13, w: on ? 'bold' : 'medium', color: on ? C.accent : C.muted, align: 'CENTER' })], { gap: 6, cross: 'CENTER' });
}
function sourceTile(icon, label, sub) {
  return V([H([I(icon, 24, C.accent)], { fill: C.accentTint, radius: 14, pad: 11 }), T(label, { size: 15, w: 'bold', align: 'CENTER' }), T(sub, { size: 12, color: C.faint, align: 'CENTER' })], { gap: 6, cross: 'CENTER', fill: C.surface, stroke: C.border, radius: 18, py: 16, w: 176 });
}

function sNewNotebook() {
  const s = screen('04 · مذكرة جديدة — الورق أو الاستيراد', 3, 0);
  libraryContent(s);
  overlay(s);
  const W2 = 564;
  modal(s, [
    modalHeader('مذكرة جديدة'),
    V([fieldLabel('اسم المذكرة'), input('محاضرة 6 — المحددات', { focus: true })], { gap: 8, cross: 'MAX' }),
    V([fieldLabel('الحفظ في'), H([chip('CS102', { on: true, icon: 'notebookPen' }), chip('MATH106'), chip('PHYS101'), chip('مجلداتي', { icon: 'folder' }), chip('بدون مجلد')], { gap: 8 })], { gap: 8, cross: 'MAX' }),
    V([fieldLabel('نوع الورق'), H([paperTile('مسطر', 'lined', true), paperTile('فارغ', 'blank'), paperTile('مربعات', 'grid'), paperTile('نقاط', 'dotted')], { gap: 18 })], { gap: 10, cross: 'MAX' }),
    H([
      V([fieldLabel('لون الورق'), H([swatch(C.white, 'أبيض', true), swatch(C.cream, 'كريمي'), swatch(C.dark, 'داكن')], { gap: 14 })], { gap: 10, cross: 'MAX' }),
      spacer(),
      V([fieldLabel('حجم الصفحة'), H([chip('A4 عمودي', { on: true, size: 13, px: 12 }), chip('A4 أفقي', { size: 13, px: 12 })], { gap: 6 }), H([chip('Letter', { size: 13, px: 12 }), chip('عريض 16:9', { size: 13, px: 12 })], { gap: 6 })], { gap: 8, cross: 'MAX' }),
    ], { w: W2, cross: 'MIN' }),
    H([R(200, 1, C.border), T('أو ابدأ من ملف', { size: 13, w: 'medium', color: C.faint }), R(200, 1, C.border)], { gap: 12, w: W2, align: 'CENTER', cross: 'CENTER' }),
    H([sourceTile('fileText', 'استيراد PDF', 'من تطبيق الملفات'), sourceTile('scan', 'مسح بالكاميرا', 'حواف وقص تلقائي'), sourceTile('image', 'من الصور', 'صورة أو أكثر')], { gap: 18 }),
    fillWBtn(primaryBtn('إنشاء المذكرة', { icon: 'check' }), W2),
  ], 620, { y: 70 });
}
function fillWBtn(btn, w) { fixW(btn, w); return btn; }

function sReceivePdf() {
  const s = screen('05 · استلام PDF من تطبيق آخر', 4, 0);
  libraryContent(s);
  overlay(s);
  const W2 = 564;
  const file = H([H([I('fileText', 26, C.danger)], { fill: C.dangerSoft, radius: 14, pad: 12 }), V([T('Lecture-07-Recursion.pdf', { size: 16, w: 'bold', font: { family: 'Inter', style: 'Semi Bold' } }), T('24 صفحة · 3.2 ميجابايت · من واتساب', { size: 13, color: C.faint })], { gap: 2, cross: 'MAX' }), spacer()], { gap: 12, fill: C.surfaceMuted, radius: 18, pad: 14, w: W2, cross: 'CENTER' });
  const radio = (label, sub, on) => H([H([on ? E(12, C.accent) : null], { w: 24, h: 24, radius: 999, stroke: on ? C.accent : C.borderStrong, strokeW: 2, align: 'CENTER', cross: 'CENTER' }), V([T(label, { size: 16, w: on ? 'bold' : 'medium' }), sub ? T(sub, { size: 13, color: C.faint }) : null], { gap: 2, cross: 'MAX' }), spacer()], { gap: 12, px: 16, py: 14, radius: 16, stroke: on ? C.accent : C.border, strokeW: on ? 2 : 1, fill: on ? C.accentTint : C.surface, w: W2, cross: 'CENTER' });
  const progress = V([H([T('جارٍ الاستيراد… 6 من 24 صفحة', { size: 14, w: 'semibold', color: C.accentDark }), spacer(), T('25%', { size: 14, w: 'bold', color: C.accentDark, font: { family: 'Inter', style: 'Semi Bold' } })], { w: W2 }), progressBar(W2, 0.25), T('يمكنك البدء بالكتابة على الصفحة الأولى الآن، والباقي يكتمل في الخلفية.', { size: 13, color: C.faint, width: W2 })], { gap: 8, cross: 'MAX' });
  modal(s, [
    modalHeader('استلام ملف PDF', 'اختر أين تريد حفظه'),
    file,
    V([radio('مذكرة جديدة', 'تُنشأ مذكرة باسم الملف', true), radio('إضافة إلى مذكرة موجودة', 'تُضاف الصفحات في نهاية المذكرة', false)], { gap: 10, cross: 'MAX' }),
    V([fieldLabel('الحفظ في'), H([chip('CS102', { on: true, icon: 'notebookPen' }), chip('MATH106'), chip('PHYS101'), chip('مجلداتي', { icon: 'folder' })], { gap: 8 })], { gap: 8, cross: 'MAX' }),
    progress,
    H([secondaryBtn('إلغاء', { w: 170, fill: C.surfaceMuted, color: C.muted }), spacer(), primaryBtn('فتح والبدء بالكتابة', { icon: 'pen', w: 370 })], { w: W2, cross: 'CENTER' }),
  ], 620);
}
function progressBar(w, frac, color = C.accent) {
  const f = figma.createFrame(); f.name = 'progress'; f.resize(w, 8); f.cornerRadius = 4; f.fills = [solid(C.accentSoft)];
  const b = R(Math.max(8, w * frac), 8, color, { radius: 4 }); place(f, b, w - b.width, 0); // fills from the right (RTL)
  return f;
}

function editorBase(name, col, row, o = {}) {
  const s = screen(name, col, row, C.canvas);
  canvasArea(s, 0);
  const pg = (o.page || lecturePage)(o);
  pg.rescale(K);
  const side = o.pos === 'left' || o.pos === 'right' ? 68 : 0;
  const px = o.pos === 'left' ? side + (SW - side - pg.width) / 2 : (SW - side - pg.width) / 2;
  place(s, pg, px, o.pos === 'bottom' || side ? 84 : 146);
  editorTopBar(s, o);
  statusBar(s);
  if (!o.noToolbar) editorToolbar(s, o);
  pageFooter(s, o.footer);
  return { s, pg };
}

function sEditor() { editorBase('06 · المحرر — الكتابة بالقلم', 0, 1); }

function sPenOptions() {
  const { s } = editorBase('07 · خيارات القلم', 1, 1);
  const presets = H([1, 2, 3].map((i) => V([E(i * 6 + 6, [C.inkBlue, C.inkBlack, C.inkRed][i - 1]), T(['أزرق ناعم', 'أسود', 'أحمر عريض'][i - 1], { size: 12, color: C.muted, align: 'CENTER' })], { gap: 6, cross: 'CENTER', w: 86, py: 10, radius: 14, fill: i === 1 ? C.accentTint : null, stroke: i === 1 ? C.accentBorder : null, align: 'MAX' })), { gap: 8 });
  const cols = H([colorDot(C.inkBlack), colorDot(C.inkBlue, true), colorDot(C.inkRed), colorDot(C.inkGreen), colorDot(C.accent), H([I('plus', 16, C.muted)], { w: 28, h: 28, radius: 999, stroke: C.borderStrong, dash: [3, 3], align: 'CENTER', cross: 'CENTER' })], { gap: 12 });
  const widths = H([2, 3, 5, 7, 10].map((w, i) => H([R(36, w, C.text, { radius: w / 2 })], { w: 52, h: 40, radius: 12, fill: i === 1 ? C.accentTint : C.surfaceMuted, stroke: i === 1 ? C.accent : null, align: 'CENTER', cross: 'CENTER' })), { gap: 8 });
  const pop = V([
    H([T('القلم', { size: 18, w: 'bold' }), spacer(), T('تعديل', { size: 14, w: 'semibold', color: C.accent })], { w: 316 }),
    V([fieldLabel('أقلامي المحفوظة'), presets], { gap: 8, cross: 'MAX' }),
    V([fieldLabel('اللون'), cols], { gap: 8, cross: 'MAX' }),
    V([fieldLabel('السُمك'), widths], { gap: 8, cross: 'MAX' }),
    divider(316),
    H([toggle(true), spacer(), T('حساسية الضغط', { size: 15, w: 'medium' })], { w: 316, cross: 'CENTER' }),
    H([toggle(false), spacer(), T('الرسم بالإصبع', { size: 15, w: 'medium' })], { w: 316, cross: 'CENTER' }),
  ], { name: 'pen-popover', fill: C.surface, radius: 22, pad: 20, gap: 16, shadow: true, cross: 'MAX' });
  const tb = s.findOne((n) => n.name.startsWith('toolbar/'));
  const penBtn = tb.findOne((n) => n.name === 'tool/pen');
  place(s, pop, tb.x + tb.width - pop.width - 4, tb.y + tb.height + 12);
  const caret = R(16, 16, C.surface); caret.rotation = 45; place(s, caret, tb.x + tb.width - 40, tb.y + tb.height + 6);
  void penBtn;
}

function pdfPage(o = {}) {
  const p = figma.createFrame(); p.name = 'page/pdf'; p.resize(PAGE_W, PAGE_H); p.fills = [solid(C.white)]; p.cornerRadius = 4; p.effects = SHADOW_SM; p.clipsContent = true;
  place(p, R(PAGE_W, 110, C.accentDark), 0, 0);
  place(p, T('Lecture 7: Recursion', { size: 30, font: { family: 'Inter', style: 'Semi Bold' }, color: C.white, align: 'LEFT' }), 40, 34);
  place(p, T('CS102 — Programming II', { size: 14, font: { family: 'Inter', style: 'Regular' }, color: '#CFEFF5', align: 'LEFT' }), 40, 76);
  const bullets = ['A function that calls itself', 'Every recursion needs a base case', 'Each call gets its own stack frame', 'Example: factorial(n) = n × factorial(n − 1)', 'Too deep → StackOverflowError'];
  bullets.forEach((b, i) => place(p, T('•  ' + b, { size: 20, font: { family: 'Inter', style: 'Regular' }, color: C.text, align: 'LEFT' }), 44, 150 + i * 52));
  const hl1 = R(388, 30, C.hlYellow, { opacity: 0.5, radius: 3, name: 'highlight' }); place(p, hl1, 40, 196);
  const hl2 = R(470, 30, C.hlGreen, { opacity: 0.45, radius: 3, name: 'highlight' }); place(p, hl2, 40, 352);
  // code box
  const code = V([T('int factorial(int n) {', { size: 16, font: { family: 'Inter', style: 'Regular' }, color: C.text, align: 'LEFT' }), T('    if (n <= 1) return 1;', { size: 16, font: { family: 'Inter', style: 'Regular' }, color: C.text, align: 'LEFT' }), T('    return n * factorial(n - 1);', { size: 16, font: { family: 'Inter', style: 'Regular' }, color: C.text, align: 'LEFT' }), T('}', { size: 16, font: { family: 'Inter', style: 'Regular' }, color: C.text, align: 'LEFT' })], { fill: C.surfaceMuted, radius: 8, pad: 18, gap: 4, cross: 'MIN', w: 420 });
  place(p, code, 44, 440);
  // handwritten notes on the PDF
  place(p, T('الحالة الأساسية!', { size: 28, font: HAND_AR, color: C.inkRed, align: 'RIGHT' }), 400, 486);
  place(p, ink('M4 30 C 30 26, 60 14, 92 4 L 80 4 M 92 4 L 86 14', 100, 36, C.inkRed, 2.5), 350, 470);
  place(p, ink('M6 8 C 60 2, 140 12, 230 6', 236, 14, C.inkRed, 3), 60, 500);
  place(p, T('مثال: مضروب العدد 4 يساوي 24', { size: 28, font: HAND_AR, color: C.inkBlue, width: 520 }), 80, 650);
  if (o.extra) o.extra(p);
  return p;
}

function sPdfLasso() {
  const { s, pg } = editorBase('08 · تعليق على PDF + تحديد بالحبل', 2, 1, { page: pdfPage, active: 'lasso', sub: 'CS102 · Lecture-07-Recursion.pdf · صفحة 4 من 24', title: 'محاضرة 7 — الاستدعاء الذاتي', footer: '4 / 24' });
  // lasso selection around the handwritten note "مثال..."
  const selX = pg.x + 64 * K, selY = pg.y + 630 * K, selW = 540 * K, selH = 80 * K;
  const sel = R(selW, selH, C.accent, { opacity: 0.06, radius: 10, stroke: C.accent, strokeW: 1.5, dash: [6, 5], name: 'lasso-selection' });
  place(s, sel, selX, selY);
  for (const [hx, hy] of [[0, 0], [selW, 0], [0, selH], [selW, selH]]) { const h = E(12, C.white, { stroke: C.accent, strokeW: 2 }); place(s, h, selX + hx - 6, selY + hy - 6); }
  const menuItem = (ic, lb, danger) => H([I(ic, 18, danger ? C.danger : C.text), T(lb, { size: 14, w: 'medium', color: danger ? C.danger : C.text })], { gap: 6, px: 12, py: 10, cross: 'CENTER' });
  const menu = H([menuItem('copy', 'نسخ'), menuItem('scissors', 'قص'), H([colorDot(C.inkRed), T('اللون', { size: 14, w: 'medium' })], { gap: 6, px: 12, py: 8, cross: 'CENTER' }), menuItem('zoom', 'تغيير الحجم'), menuItem('trash', 'حذف', true)], { name: 'selection-menu', fill: C.surface, radius: 16, px: 6, py: 2, gap: 0, shadow: true, cross: 'CENTER' });
  place(s, menu, selX + selW / 2 - menu.width / 2, selY - menu.height - 14);
}

function shapesPage() {
  const p = paper(PAGE_W, PAGE_H, 'grid', C.white, { step: 32 });
  p.name = 'page/grid';
  place(p, T('الأشكال الهندسية', { size: 40, font: HAND_AR, color: C.inkBlue, align: 'RIGHT' }), PAGE_W - 60 - 300, 36).resize(300, 60);
  place(p, ink('M4 8 C 80 2, 180 12, 280 5', 284, 14, C.inkBlue, 2.5), PAGE_W - 60 - 280, 96);
  // snapped shapes
  place(p, ink('M4 150 L 95 4 L 186 150 Z', 190, 154, C.inkGreen, 3), 380, 150);
  place(p, T('a', { size: 28, font: HAND_EN, color: C.inkGreen, align: 'LEFT' }), 410, 200);
  place(p, T('b', { size: 28, font: HAND_EN, color: C.inkGreen, align: 'LEFT' }), 540, 200);
  place(p, T('c', { size: 28, font: HAND_EN, color: C.inkGreen, align: 'LEFT' }), 466, 304);
  place(p, ink('M2 2 H 200 V 130 H 2 Z', 204, 134, C.inkBlue, 3), 70, 160);
  place(p, T('4 cm', { size: 26, font: HAND_EN, color: C.inkBlue, align: 'LEFT' }), 140, 118);
  place(p, T('2 cm', { size: 26, font: HAND_EN, color: C.inkBlue, align: 'LEFT' }), 284, 206);
  const circ = E(150, null, { stroke: C.inkRed, strokeW: 3 }); place(p, circ, 100, 360);
  place(p, ink('M2 2 L 75 75', 80, 80, C.inkRed, 2.5), 175, 365);
  place(p, T('r', { size: 28, font: HAND_EN, color: C.inkRed, align: 'LEFT' }), 214, 382);
  place(p, ink('M6 60 C 60 10, 140 0, 200 30 L 186 20 M 200 30 L 188 42', 206, 66, C.inkBlack, 2.5), 280, 380);
  place(p, T('المساحة = π r²', { size: 28, font: HAND_AR, color: C.inkRed, width: 260 }), 300, 470);
  return p;
}

function sShapesText() {
  const { s, pg } = editorBase('09 · الأشكال والمسطرة والنص والصور', 3, 1, { active: 'ruler', page: shapesPage, sub: 'MATH106 · التفاضل والتكامل · صفحة 2 من 4', title: 'تمارين الهندسة', footer: '2 / 4' });
  // ruler overlay across the lower part of the page
  const ruler = figma.createFrame(); ruler.name = 'ruler'; ruler.resize(600, 72); ruler.fills = [solid('#F1F5F9', 0.9)]; ruler.cornerRadius = 8; ruler.strokes = [solid(C.borderStrong)]; ruler.strokeWeight = 1; ruler.effects = SHADOW_SM;
  for (let i = 0; i <= 58; i++) place(ruler, R(1.2, i % 10 === 0 ? 22 : i % 5 === 0 ? 15 : 9, C.muted), 10 + i * 10, 0);
  for (let i = 0; i <= 5; i++) place(ruler, T(String(i * 2), { size: 11, color: C.muted, align: 'LEFT', font: { family: 'Inter', style: 'Regular' } }), 7 + i * 100, 26);
  ruler.rescale(K);
  place(s, ruler, pg.x + 20 * K, pg.y + 640 * K);
  ruler.rotation = 8;
  const line = ink('M2 4 L 616 4', 620, 8, C.inkBlue, 3); place(s, line, pg.x + 36 * K, pg.y + 630 * K); line.rotation = 8;
  const ang = pill('8°', C.text, C.white, { size: 13, px: 10, py: 4 }); place(s, ang, pg.x + 290 * K, pg.y + 676 * K);
  // text box (selected) with its format bar
  const tb = V([T('ملاحظة: راجع تمارين 3.2 قبل الاختبار القصير يوم الثلاثاء', { size: 18, w: 'medium', color: C.text, width: 250 })], { name: 'text-box', pad: 10, stroke: C.accent, strokeW: 1.5, radius: 6, cross: 'MAX' });
  place(s, tb, pg.x + pg.width - 44 - tb.width, pg.y + 770 * K);
  const fmt = H([H([T('Aa', { size: 15, w: 'bold', font: { family: 'Inter', style: 'Semi Bold' } }), T('18', { size: 14, color: C.muted, font: { family: 'Inter', style: 'Regular' } }), I('chevronDown', 14, C.muted)], { gap: 6, px: 10, py: 8, cross: 'CENTER' }), vsep(), colorDot(C.text, true), I('bold', 18, C.text), vsep(), I('trash', 18, C.danger)], { name: 'text-format-bar', gap: 10, fill: C.surface, radius: 14, px: 10, py: 4, shadow: true, cross: 'CENTER' });
  place(s, fmt, tb.x + tb.width - fmt.width, tb.y - fmt.height - 10);
  // inserted image (whiteboard photo placeholder)
  const img = V([I('image', 34, C.faint), T('صورة السبورة', { size: 13, color: C.faint, align: 'CENTER' })], { name: 'inserted-image', fill: '#D9E2EC', radius: 6, w: 200, h: 136, align: 'CENTER', cross: 'CENTER', gap: 6 });
  place(s, img, pg.x + 50 * K, pg.y + 750 * K);
  img.rotation = -3;
  const hint = H([I('info', 16, C.accentDark), T('اضغط مطولاً في نهاية الخط ليصبح شكلاً مستقيماً', { size: 13, w: 'medium', color: C.accentDark })], { gap: 6, fill: C.accentTint, radius: 999, px: 14, py: 8, cross: 'CENTER' });
  place(s, hint, (SW - hint.width) / 2, 156);
}

function sRecording() {
  const { s } = editorBase('10 · تسجيل المحاضرة أثناء الكتابة', 4, 1, { recording: true, recTime: '12:47' });
  const toast = H([I('info', 18, C.white), T('الشاشة تبقى مضاءة أثناء التسجيل', { size: 14, w: 'medium', color: C.white })], { gap: 8, fill: C.text, radius: 999, px: 18, py: 10, cross: 'CENTER', opacity: 0.92 });
  place(s, toast, (SW - toast.width) / 2, SH - 120);
}

function sPlayback() {
  const { s } = editorBase('11 · تشغيل التسجيل مع الحبر', 0, 2, { dimAfter: true, active: 'pen' });
  // player bar
  const scrubW = 400;
  const scrub = figma.createFrame(); scrub.name = 'scrubber'; scrub.resize(scrubW, 24); scrub.fills = [];
  place(scrub, R(scrubW, 6, C.accentSoft, { radius: 3 }), 0, 9);
  place(scrub, R(scrubW * 0.38, 6, C.accent, { radius: 3 }), scrubW - scrubW * 0.38, 9);
  const knob = E(18, C.white, { stroke: C.accent, strokeW: 3 }); place(scrub, knob, scrubW - scrubW * 0.38 - 9, 3);
  for (const fx of [0.12, 0.31, 0.55, 0.8]) place(scrub, R(2, 12, C.accentDark, { opacity: 0.35 }), scrubW - scrubW * fx, 6);
  const bar = H([
    H([I('pause', 22, C.white, { filled: true })], { fill: C.accent, radius: 999, w: 52, h: 52, align: 'CENTER', cross: 'CENTER' }),
    V([H([T('تسجيل 1 · محاضرة 5', { size: 14, w: 'bold' }), spacer(), T('18:05 / 47:32', { size: 13, color: C.faint, font: { family: 'Inter', style: 'Regular' } })], { w: scrubW }), scrub], { gap: 4, cross: 'MAX' }),
    H([chip('1x', { size: 13, px: 10, py: 6 }), chip('1.5x', { on: true, size: 13, px: 10, py: 6 }), chip('2x', { size: 13, px: 10, py: 6 })], { gap: 4 }),
    H([I('pointer', 20, C.accent)], { fill: C.accentTint, radius: 12, pad: 10 }),
  ], { name: 'player-bar', fill: C.surface, radius: 24, gap: 16, px: 16, py: 12, shadow: true, cross: 'CENTER' });
  place(s, bar, (SW - bar.width) / 2, SH - bar.height - 80);
  const tip = H([I('pointer', 16, C.white), T('اضغط على أي كتابة لتسمع ما قيل لحظتها', { size: 13, w: 'medium', color: C.white })], { gap: 6, fill: C.accentDark, radius: 999, px: 14, py: 8, cross: 'CENTER' });
  place(s, tip, (SW - tip.width) / 2, bar.y - tip.height - 10);
  // recordings list panel (left side in RTL)
  const recRow = (t, d, len, on) => H([V([T(t, { size: 15, w: on ? 'bold' : 'medium', color: on ? C.accent : C.text }), T(d + ' · ' + len, { size: 12, color: C.faint })], { gap: 2, cross: 'MAX' }), spacer(), I('moreV', 18, C.placeholder)], { gap: 8, px: 14, py: 12, radius: 14, fill: on ? C.accentTint : null, w: 236, cross: 'CENTER' });
  const panel = V([
    H([T('التسجيلات', { size: 17, w: 'bold' }), spacer(), pill('3', C.accentSoft, C.accentDark)], { w: 236, cross: 'CENTER' }),
    recRow('تسجيل 1', 'اليوم 10:02 ص', '47:32', true),
    recRow('تسجيل 2 — المراجعة', 'اليوم 11:00 ص', '08:14', false),
    recRow('شرح الواجب', 'أمس', '15:40', false),
  ], { name: 'recordings-panel', fill: C.surface, radius: 22, pad: 14, gap: 6, shadow: true, cross: 'MAX' });
  place(s, panel, 16, 156);
}

function sContinue() {
  const { s } = editorBase('12 · العودة للتطبيق — متابعة التسجيل', 1, 2, { recording: false });
  const banner = H([
    H([I('pause', 20, C.white, { filled: true })], { fill: C.warningBar, radius: 999, pad: 10 }),
    V([T('توقف التسجيل مؤقتاً عند مغادرة التطبيق', { size: 16, w: 'bold' }), T('تسجيل 1 · 31:08 — يُكمل في نفس التسجيل', { size: 13, color: C.faint })], { gap: 2, cross: 'MAX' }),
    spacer(),
    primaryBtn('متابعة التسجيل', { icon: 'mic', size: 15, py: 11 }),
    secondaryBtn('إنهاء', { size: 15, py: 11, fill: C.surfaceMuted, color: C.muted }),
  ], { name: 'continue-banner', fill: C.warningSoft, stroke: '#F5D58A', radius: 20, gap: 12, px: 16, py: 14, w: CW, shadow: 'sm', cross: 'CENTER' });
  place(s, banner, PAD, SH - banner.height - 84);
}

function sPages() {
  const s = screen('13 · صفحات المذكرة — ترتيب وإضافة', 2, 2);
  statusBar(s);
  place(s, navBar('صفحات المذكرة', { sub: 'محاضرة 5 — المصفوفات · 8 صفحات', actions: [T('تم', { size: 17, w: 'bold', color: C.accent })] }), PAD, 44);
  const thumb = (n, style, o = {}) => {
    const p = o.pdf ? (() => { const f = figma.createFrame(); f.resize(160, 226); f.fills = [solid(C.white)]; f.cornerRadius = 8; place(f, R(160, 30, C.accentDark), 0, 0); for (let i = 0; i < 5; i++) place(f, R(110 - (i % 2) * 30, 5, '#CBD5E1', { radius: 3 }), 14, 50 + i * 18); return f; })() : paper(160, 226, style, o.color || C.white, { step: 14, top: 30, margin: 24, shadow: false, radius: 8, dot: 2 });
    p.strokes = [solid(o.sel ? C.accent : C.border)]; p.strokeWeight = o.sel ? 3 : 1;
    if (o.drag) { p.effects = SHADOW; p.rotation = -4; }
    if (!o.pdf && style === 'lined') { place(p, ink('M6 10 C 30 2, 60 16, 90 6 S 120 10, 130 6', 136, 18, C.inkBlue, 2), 12, 30); place(p, ink('M6 10 C 24 4, 40 14, 60 8 S 84 10, 96 6', 100, 16, C.inkBlack, 2), 40, 58); }
    const lbl = H([o.sel ? pill('الحالية', C.accent, C.white, { size: 11 }) : null, T(String(n), { size: 14, w: 'semibold', color: C.muted, font: { family: 'Inter', style: 'Semi Bold' } })], { gap: 6, cross: 'CENTER' });
    return V([p, lbl], { gap: 8, cross: 'CENTER', opacity: o.ghost ? 0.35 : 1 });
  };
  const row1 = H([thumb(1, 'lined'), thumb(2, 'lined'), thumb(3, 'lined', { sel: true }), thumb(4, null, { pdf: true })], { gap: 30, cross: 'MIN' });
  const row2 = H([thumb(5, null, { pdf: true }), thumb(6, 'grid'), thumb(7, 'blank', { ghost: true }), thumb(8, 'lined', { color: C.cream })], { gap: 30, cross: 'MIN' });
  place(s, row1, PAD + 20, 150); place(s, row2, PAD + 20, 150 + row1.height + 36);
  const r2y = 150 + row1.height + 36;
  const ins = R(4, 226, C.accent, { radius: 2, name: 'drop-indicator' }); place(s, ins, PAD + 20 + 190 * 3 - 17, r2y);
  const dragged = thumb(7, 'blank', { drag: true }); place(s, dragged, PAD + 20 + 190 * 3 - 120, r2y - 26);
  const addBtn = V([I('plus', 26, C.accent), T('صفحة جديدة', { size: 14, w: 'semibold', color: C.accent, align: 'CENTER' })], { gap: 6, radius: 10, stroke: C.accentBorder, dash: [6, 5], strokeW: 1.5, w: 160, h: 226, align: 'CENTER', cross: 'CENTER' });
  place(s, addBtn, SW - PAD - 20 - 160, 150 + (row1.height + 36) * 2);
  const actions = H([['plus', 'إضافة صفحة'], ['copy', 'تكرار'], ['fileText', 'تغيير الورق'], ['fileText', 'إدراج PDF'], ['trash', 'حذف']].map(([ic, lb], i) => V([I(ic, 22, i === 4 ? C.danger : C.text), T(lb, { size: 13, w: 'medium', color: i === 4 ? C.danger : C.muted, align: 'CENTER' })], { gap: 4, cross: 'CENTER', w: 120 })), { name: 'page-actions', fill: C.surface, radius: 24, px: 20, py: 14, shadow: true, align: 'SPACE_BETWEEN', w: CW });
  place(s, actions, PAD, SH - actions.height - 40);
  const hint = T('اسحب الصفحة لتغيير ترتيبها', { size: 13, color: C.faint, align: 'CENTER' }); place(s, hint, (SW - hint.width) / 2, actions.y - 34);
}

function sExport() {
  const { s } = editorBase('14 · المشاركة والتصدير', 3, 2);
  overlay(s);
  const W2 = 564;
  const opt = (icon, title, sub, on, extra) => V([H([H([I(icon, 22, on ? C.white : C.accent)], { fill: on ? C.accent : C.accentTint, radius: 12, pad: 10 }), V([T(title, { size: 17, w: 'bold' }), T(sub, { size: 13, color: C.faint, width: 420 })], { gap: 2, cross: 'MAX' }), spacer(), H([on ? E(12, C.accent) : null], { w: 24, h: 24, radius: 999, stroke: on ? C.accent : C.borderStrong, strokeW: 2, align: 'CENTER', cross: 'CENTER' })], { gap: 12, w: W2 - 32, cross: 'CENTER' }), extra || null], { gap: 12, pad: 16, radius: 18, stroke: on ? C.accent : C.border, strokeW: on ? 2 : 1, fill: on ? C.accentTint : C.surface, w: W2, cross: 'MAX' });
  modal(s, [
    modalHeader('مشاركة وتصدير', 'محاضرة 5 — المصفوفات'),
    opt('fileText', 'ملف PDF مع الكتابة', 'الكتابة تُرسم على الصفحات، ونص ملفات PDF الأصلية يبقى قابلاً للتحديد', false),
    opt('image', 'الصفحة كصورة PNG', 'الصفحة الحالية بدقة عالية', false),
    opt('notebookPen', 'ملف المذكرة القابل للتعديل', 'بصيغة qunote — يفتحه زميلك في تطبيق QU Student ويكمل الكتابة', true,
      V([divider(W2 - 32), H([toggle(true), spacer(), V([T('تضمين التسجيلات', { size: 15, w: 'semibold' }), T('مع التسجيلات 48.6 ميجابايت · بدونها 6.2 ميجابايت', { size: 13, color: C.faint })], { gap: 2, cross: 'MAX' })], { w: W2 - 32, cross: 'CENTER' })], { gap: 12, cross: 'MAX' })),
    V([fieldLabel('الصفحات'), H([chip('كل الصفحات', { on: true }), chip('الصفحة الحالية'), chip('نطاق: 2 – 5')], { gap: 8 })], { gap: 8, cross: 'MAX' }),
    fillWBtn(primaryBtn('مشاركة', { icon: 'share' }), W2),
  ], 620);
}

function sSettings() {
  const s = screen('15 · إعدادات المذكرات — النسخ الاحتياطي والتخزين', 4, 2);
  statusBar(s);
  place(s, navBar('إعدادات المذكرات', { sub: 'تُحفظ على جهازك' }), PAD, 44);
  let y = 146;
  const lab = (t) => { const x = T(t, { size: 14, w: 'semibold', color: C.faint }); place(s, x, SW - PAD - x.width - 8, y); y += 30; };
  lab('النسخ الاحتياطي');
  const g1 = group([
    listRow('cloud', 'النسخ الاحتياطي إلى iCloud Drive', { sub: 'مجلد "QU Student" يظهر في تطبيق الملفات', toggle: true }),
    listRow('check', 'آخر نسخة: اليوم 9:12 ص', { sub: '12 مذكرة · 1.4 جيجابايت', iconColor: C.success, iconFill: C.successSoft }),
    listRow('wifi', 'عبر Wi-Fi فقط', { sub: 'لا تستخدم بيانات الجوال للنسخ', toggle: true }),
    listRow('restore', 'استعادة من النسخة الاحتياطية', { chevron: true }),
  ]);
  place(s, g1, PAD, y); y += g1.height + 26;
  lab('الكتابة');
  const g2 = group([
    listRow('pencilTip', 'النقر المزدوج على Apple Pencil', { value: 'التبديل إلى الممحاة', chevron: true }),
    listRow('hand', 'الرسم بالإصبع', { sub: 'عند توصيل قلم، الإصبع للتمرير فقط', toggle: false }),
  ]);
  place(s, g2, PAD, y); y += g2.height + 26;
  lab('التخزين');
  const segW = CW - 40;
  const seg = figma.createFrame(); seg.name = 'storage-bar'; seg.resize(segW, 14); seg.cornerRadius = 7; seg.fills = [solid(C.surfaceMuted)]; seg.clipsContent = true;
  const parts = [[0.42, C.accent], [0.3, C.warningBar], [0.08, '#8B5CF6']];
  let x = segW; for (const [f, c] of parts) { const w = segW * f; x -= w; place(seg, R(w, 14, c), x, 0); }
  const legend = (c, l, v) => H([E(10, c), T(l, { size: 14, w: 'medium' }), T(v, { size: 14, color: C.faint, font: { family: 'Inter', style: 'Regular' } })], { gap: 6, cross: 'CENTER' });
  const storage = V([
    H([T('1.4 جيجابايت', { size: 22, w: 'bold' }), spacer(), T('متاح على الجهاز: 38 جيجابايت', { size: 13, color: C.faint })], { w: segW, cross: 'CENTER' }),
    seg,
    H([legend(C.accent, 'ملفات PDF', '590 MB'), legend(C.warningBar, 'التسجيلات', '420 MB'), legend('#8B5CF6', 'الكتابة والصور', '110 MB')], { gap: 22 }),
  ], { name: 'storage', fill: C.surface, radius: 22, stroke: C.border, pad: 20, gap: 14, w: CW, cross: 'MAX' });
  place(s, storage, PAD, y); y += storage.height + 26;
  const g3 = group([
    listRow('trash', 'المحذوفة مؤخراً', { value: '3', chevron: true }),
    listRow('message', 'أرسل ملاحظاتك عن المذكرات', { sub: 'ميزة تجريبية — رأيك يهمنا', chevron: true }),
  ]);
  place(s, g3, PAD, y);
}

function sDeleted() {
  const s = screen('16 · المحذوفة مؤخراً (30 يوماً)', 0, 3);
  statusBar(s);
  place(s, navBar('المحذوفة مؤخراً', { sub: '3 مذكرات', actions: [T('حذف الكل', { size: 16, w: 'bold', color: C.danger })] }), PAD, 44);
  const info = H([I('info', 18, C.accentDark), T('تُحذف المذكرات نهائياً بعد 30 يوماً من حذفها. يمكنك استعادتها قبل ذلك.', { size: 14, color: C.accentDark, width: CW - 70 })], { gap: 8, fill: C.accentTint, radius: 16, px: 16, py: 12, w: CW, cross: 'CENTER' });
  place(s, info, PAD, 142);
  const dcard = (t, left, o) => V([notebookCard(t, null, Object.assign({ tw: 210, th: 270 }, o)), pill(left, C.warningSoft, C.warning, { size: 12, icon: 'clock' }), H([secondaryBtn('استعادة', { icon: 'restore', size: 14, py: 9 }), H([I('trash', 18, C.danger)], { fill: C.dangerSoft, radius: 999, pad: 10 })], { gap: 8, cross: 'CENTER' })], { gap: 10, cross: 'MAX' });
  const g = H([dcard('مسودة الواجب 2', 'يتبقى 27 يوماً', {}), dcard('محاضرة 1 (مكررة)', 'يتبقى 12 يوماً', { style: 'grid' }), dcard('Syllabus-CS102.pdf', 'يتبقى يومان', { pdf: true })], { gap: 34, cross: 'MIN' });
  place(s, g, SW - PAD - g.width, 226);
}

function sEmpty() {
  const s = screen('17 · المكتبة فارغة + تحذير التخزين', 1, 3);
  statusBar(s);
  place(s, navBar('المذكرات', { badge: betaPill(13), sub: 'ابدأ أول مذكرة لك' }), PAD, 44);
  const ring = V([H([I('notebookPen', 54, C.accent)], { fill: C.surface, radius: 999, w: 120, h: 120, align: 'CENTER', cross: 'CENTER', shadow: 'sm' })], { fill: C.accentSoft, radius: 999, w: 180, h: 180, align: 'CENTER', cross: 'CENTER' });
  const block = V([
    ring,
    T('لا توجد مذكرات بعد', { size: 26, w: 'bold', align: 'CENTER' }),
    T('اكتب بالقلم أو الإصبع، استورد ملفات PDF وعلّق عليها،\nوسجّل المحاضرة وأنت تكتب. مجلد لكل مادة جاهز من جدولك.', { size: 16, color: C.faint, align: 'CENTER', lh: 26 }),
    H([secondaryBtn('استيراد PDF', { icon: 'fileText' }), primaryBtn('مذكرة جديدة', { icon: 'plus' })].reverse(), { gap: 12 }),
  ], { gap: 18, cross: 'CENTER' });
  place(s, block, (SW - block.width) / 2, 260);
  const warn = H([H([I('alert', 22, C.warning)], { fill: C.surface, radius: 12, pad: 9 }), V([T('مساحة الجهاز منخفضة', { size: 16, w: 'bold', color: C.warning }), T('متاح 900 ميجابايت فقط. قد لا يكتمل استيراد ملفات PDF الكبيرة أو التسجيلات الطويلة.', { size: 14, color: C.warning, width: 560 })], { gap: 2, cross: 'MAX' }), spacer(), T('عرض التخزين', { size: 14, w: 'bold', color: C.warning })], { name: 'low-storage', gap: 12, fill: C.warningSoft, stroke: '#F5D58A', radius: 18, px: 16, py: 14, w: CW, cross: 'CENTER' });
  place(s, warn, PAD, SH - 200);
}


function sToolbarDrag() {
  const { s } = editorBase('18 · نقل شريط الأدوات — ضغط مطوّل ثم سحب', 2, 3, { noToolbar: true });
  place(s, R(SW, SH - 80, C.white, { opacity: 0.45, name: 'dim' }), 0, 80);
  const zone = (x, y, w, h, label, on) => {
    place(s, R(w, h, on ? C.accent : C.accentLight, { opacity: on ? 0.2 : 0.12, radius: 20, stroke: C.accent, strokeW: on ? 2.5 : 1.5, dash: [8, 6], name: 'drop-zone/' + label }), x, y);
    const p = pill(label, on ? C.accent : C.surface, on ? C.white : C.accentDark, { size: 13, px: 12, py: 5 });
    place(s, p, x + (w - p.width) / 2, h > 200 ? y + 24 : y + (h - p.height) / 2);
  };
  zone(16, 82, SW - 32, 66, 'أعلى', false);
  zone(16, SH - 146, SW - 32, 70, 'أسفل', false);
  zone(12, 160, 70, SH - 160 - 162, 'يسار', false);
  zone(SW - 82, 160, 70, SH - 160 - 162, 'يمين', true);
  const bar = editorToolbar(s, { pos: 'float', x: 70, y: 560, lifted: true });
  place(s, I('hand', 40, C.text), bar.x + bar.width - 36, bar.y + 30);
  const hint = H([I('info', 16, C.white), T('اضغط مطولاً على الشريط، ثم اسحبه وأفلته عند أي حافة', { size: 14, w: 'medium', color: C.white })], { gap: 8, fill: C.text, radius: 999, px: 16, py: 9, cross: 'CENTER' });
  place(s, hint, (SW - hint.width) / 2, 170);
}

function sToolbarRight() { editorBase('19 · شريط الأدوات على اليمين (عمودي)', 3, 3, { pos: 'right' }); }
function sToolbarBottom() { editorBase('20 · شريط الأدوات في الأسفل', 4, 3, { pos: 'bottom' }); }
function sToolbarLeft() { editorBase('21 · شريط الأدوات على اليسار (عمودي)', 0, 4, { pos: 'left' }); }

// ---------- scientific calculator (key layout of a classic exam calculator, no brand marks) ----------
const INTER_SB = { family: 'Inter', style: 'Semi Bold' };
const INTER_R = { family: 'Inter', style: 'Regular' };
const CALC = { body: '#1F2433', fn: '#2D3344', fnText: '#F1F3F7', num: '#5E6473', green: '#7CC242', ctrl: '#4F5667', gold: '#E2B24A', pink: '#E8587F', blue: '#4E9BE6', lcd: '#CEDBC6', lcdText: '#1C221C', lcdEdge: '#11151E' };
function mathLabel(l, size, color) {
  if (Array.isArray(l)) return H([T(l[0], { size, font: INTER_SB, color, align: 'LEFT' }), T(l[1], { size: Math.max(6, Math.round(size * 0.62)), font: INTER_SB, color, align: 'LEFT' })], { ltr: true, cross: 'MIN', gap: 1, name: 'label' });
  return T(l, { size, font: INTER_SB, color, align: 'CENTER' });
}
function slot(w, h, filled, color) { return R(w, h, filled ? color : null, { stroke: filled ? null : color, strokeW: 1, radius: 1 }); }
// Key faces that need little drawn boxes, like the printed keys.
function keyFace(f, size, color) {
  if (f === '#frac') return V([slot(8, 6, false, color), R(11, 1.4, color), slot(8, 6, false, color)], { gap: 1.5, cross: 'CENTER', name: 'face/fraction' });
  if (f === '#sqrt') return H([T('√', { size, font: INTER_SB, color }), slot(7, 8, false, color)], { ltr: true, gap: 1, cross: 'CENTER', name: 'face/sqrt' });
  if (f === '#int') return H([T('∫', { size: size + 2, font: INTER_SB, color }), V([slot(4, 4, true, color), slot(4, 4, false, color)], { gap: 5 }), slot(8, 6, true, color)], { ltr: true, gap: 2, cross: 'CENTER', name: 'face/integral' });
  if (f === '#xpow') return H([T('x', { size, font: INTER_SB, color }), slot(5, 5, true, color)], { ltr: true, gap: 1, cross: 'MIN', name: 'face/x-power' });
  if (f === '#logb') return H([T('log', { size: size - 1, font: INTER_SB, color }), V([R(1, 6, null), slot(4, 4, true, color)], { gap: 0 }), slot(7, 8, false, color)], { ltr: true, gap: 1, cross: 'CENTER', name: 'face/log-base' });
  return mathLabel(f, size, color);
}
// Printed second-function labels above a key: gold (SHIFT) on the left, pink (ALPHA) or blue on the right.
function secLabel(k, w) {
  const left = k.g ? mathLabel(k.g, 8, CALC.gold) : null;
  const right = k.p ? mathLabel(k.p, 8, CALC.pink) : k.b ? mathLabel(k.b, 8, CALC.blue) : null;
  if (!left && !right) return R(w, 10, null, { name: 'no-label' });
  if (left && !right) return H([left], { ltr: true, w, h: 10, align: 'CENTER', cross: 'CENTER' });
  return H([left || R(1, 1, null), spacer(), right], { ltr: true, w, h: 10, cross: 'CENTER' });
}
function cKey(k, w, h, kind) {
  const fill = kind === 'num' ? (k.green ? CALC.green : CALC.num) : CALC.fn;
  const size = kind === 'num' ? (k.small ? 14 : 19) : (k.small ? 10 : 12);
  const key = V([keyFace(k.l, size, kind === 'num' ? '#FFFFFF' : CALC.fnText)], { name: 'key', fill, radius: kind === 'num' ? 9 : 7, w, h, align: 'CENTER', cross: 'CENTER' });
  key.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.35 }, offset: { x: 0, y: 2 }, radius: 0, spread: 0, visible: true, blendMode: 'NORMAL' }];
  return V([secLabel(k, w), key], { gap: 2, cross: 'CENTER', name: 'key+labels' });
}
const ROWS_FN = [
  [{ l: '#frac', g: '' }, { l: '#sqrt', g: '∛' }, { l: 'x²', g: 'x³', b: 'DEC' }, { l: '#xpow', g: 'ʸ√x', b: 'HEX' }, { l: 'log', g: ['10', 'x'], b: 'BIN' }, { l: 'ln', g: ['e', 'x'], b: 'OCT' }],
  [{ l: '(−)', g: '∠', p: 'A' }, { l: "° ' \"", g: '←', p: 'B', small: true }, { l: 'hyp', g: 'Abs', p: 'C' }, { l: 'sin', g: ['sin', '−1'], p: 'D' }, { l: 'cos', g: ['cos', '−1'], p: 'E' }, { l: 'tan', g: ['tan', '−1'], p: 'F' }],
  [{ l: 'RCL', g: 'STO' }, { l: 'ENG', g: '←', p: 'i' }, { l: '(', g: '%' }, { l: ')', g: ',', p: 'X' }, { l: 'S⇔D', g: 'a b/c', p: 'Y', small: true }, { l: 'M+', g: 'M−', p: 'M' }],
];
const ROWS_NUM = [
  [{ l: '7', g: 'CONST' }, { l: '8', g: 'CONV' }, { l: '9', g: 'CLR' }, { l: 'DEL', g: 'INS', green: true, small: true }, { l: 'AC', g: 'OFF', green: true, small: true }],
  [{ l: '4', g: 'MATRIX' }, { l: '5', g: 'VECTOR' }, { l: '6' }, { l: '×', g: 'nPr' }, { l: '÷', g: 'nCr' }],
  [{ l: '1', g: 'STAT' }, { l: '2', g: 'CMPLX' }, { l: '3', g: 'BASE' }, { l: '+', g: 'Pol' }, { l: '−', g: 'Rec' }],
  [{ l: '0', g: 'Rnd' }, { l: '•', g: 'Ran#' }, { l: ['×10', 'x'], g: 'π', p: 'e', small: true }, { l: 'Ans', g: 'DRG', small: true }, { l: '=' }],
];

function lcd(w) {
  const lt = (str, size, o = {}) => T(str, { size, font: o.inter ? INTER_R : LCD_FONT, color: CALC.lcdText, align: o.align || 'LEFT' });
  const status = H([lt('D', 10, { inter: true }), lt('Math ▲', 10, { inter: true })], { ltr: true, gap: 10, cross: 'CENTER' });
  const limits = V([lt('π', 11, { inter: true }), R(10, 1, CALC.lcdText), lt('2', 11), R(1, 8, null), lt('0', 12)], { gap: 0, cross: 'CENTER' });
  const expr = H([lt('∫', 36, { inter: true }), limits, lt('cos(X)dx', 22)], { ltr: true, gap: 4, cross: 'CENTER' });
  const screenIn = V([H([spacer(), status], { ltr: true, w: w - 24 }), expr, H([spacer(), lt('1', 30)], { ltr: true, w: w - 24 })], { name: 'lcd', fill: CALC.lcd, radius: 6, px: 12, py: 8, gap: 0, cross: 'MIN', w });
  return V([screenIn], { name: 'lcd-frame', fill: CALC.lcdEdge, radius: 10, pad: 5, cross: 'CENTER' });
}

function calcBody(W) {
  const inner = W - 24;
  const fkw = Math.floor((inner - 5 * 5) / 6);
  const nkw = Math.floor((inner - 4 * 8) / 5);
  const colX = (i) => i * (fkw + 5);
  // Top block: SHIFT ALPHA · replay pad · MODE ON, and CALC ∫ · x⁻¹ log under them.
  const top = figma.createFrame(); top.name = 'top-keys'; top.fills = []; top.resize(inner, 86); top.clipsContent = false;
  const roundKey = (col, label, color) => {
    const t = T(label, { size: 8, font: INTER_SB, color, align: 'CENTER' }); place(top, t, colX(col) + (fkw - t.width) / 2, 0);
    const c = E(24, CALC.ctrl); c.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.4 }, offset: { x: 0, y: 2 }, radius: 0, spread: 0, visible: true, blendMode: 'NORMAL' }];
    place(top, c, colX(col) + (fkw - 24) / 2, 12);
  };
  roundKey(0, 'SHIFT', CALC.gold); roundKey(1, 'ALPHA', CALC.pink); roundKey(4, 'MODE SETUP', '#D9DDE5'); roundKey(5, 'ON', '#D9DDE5');
  const r1 = [[0, { l: 'CALC', g: 'SOLVE', p: '=', small: true }], [1, { l: '#int', g: 'd/dx', p: ':' }], [4, { l: ['x', '−1'], g: 'x!' }], [5, { l: '#logb', g: 'Σ' }]];
  for (const [col, k] of r1) place(top, cKey(k, fkw, 26, 'fn'), colX(col), 46);
  // replay (cursor) pad between the two columns pairs
  const padD = Math.min(2 * fkw + 5, 84);
  const pad = figma.createFrame(); pad.name = 'replay-pad'; pad.resize(padD, padD); pad.cornerRadius = padD / 2; pad.fills = [solid('#3E4556')]; pad.clipsContent = false;
  pad.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.4 }, offset: { x: 0, y: 2 }, radius: 0, spread: 0, visible: true, blendMode: 'NORMAL' }];
  place(pad, E(padD * 0.34, '#2A2F3D'), padD * 0.33, padD * 0.33);
  const arr = (ic, x, y) => place(pad, I(ic, 16, '#C9CED8', { sw: 2.6 }), x - 8, y - 8);
  arr('chevronUp', padD / 2, padD * 0.15); arr('chevronDown', padD / 2, padD * 0.85); arr('forward', padD * 0.15, padD / 2); arr('back', padD * 0.85, padD / 2);
  place(top, pad, colX(2) + (2 * fkw + 5 - padD) / 2, (86 - padD) / 2);
  const fnRows = ROWS_FN.map((r) => H(r.map((k) => cKey(k, fkw, 26, 'fn')), { ltr: true, gap: 5, cross: 'MAX' }));
  const numRows = ROWS_NUM.map((r) => H(r.map((k) => cKey(k, nkw, 38, 'num')), { ltr: true, gap: 8, cross: 'MAX' }));
  return V([lcd(inner), top, V(fnRows, { gap: 5, cross: 'MIN' }), V(numRows, { gap: 6, cross: 'MIN' })], { name: 'calculator-body', fill: CALC.body, radius: 20, pad: 12, gap: 12, cross: 'CENTER', w: W });
}

function calcPanel(W, mode) {
  const inner = W - 24;
  const header = H([
    T('الحاسبة العلمية', { size: 17, w: 'bold' }), spacer(),
    H([I(mode === 'docked' ? 'popOut' : 'dock', 18, C.accentDark), T(mode === 'docked' ? 'عائمة' : 'تثبيت', { size: 13, w: 'semibold', color: C.accentDark })], { gap: 6, px: 12, py: 8, radius: 999, fill: C.accentTint, cross: 'CENTER', name: mode === 'docked' ? 'btn/float' : 'btn/dock' }),
    circleBtn('x', { size: 34, fill: C.surfaceMuted, stroke: false, isz: 16 }),
  ], { w: inner, gap: 8, cross: 'CENTER' });
  const kids = [];
  if (mode === 'floating') kids.push(H([R(44, 5, C.borderStrong, { radius: 3 })], { w: inner, align: 'CENTER', name: 'drag-handle' }));
  kids.push(header, calcBody(inner));
  if (mode === 'docked') {
    const hist = (e, r) => H([T(r, { size: 15, font: INTER_SB, align: 'RIGHT' }), spacer(), T(e, { size: 14, font: INTER_R, color: C.faint, align: 'LEFT' })], { w: inner, px: 4, cross: 'CENTER' });
    kids.push(V([H([I('history', 16, C.faint), T('السجل', { size: 14, w: 'semibold', color: C.faint })], { gap: 6, cross: 'CENTER' }), divider(inner), hist('cos(60)', '0.5'), hist('5 nCr 2', '10')], { gap: 10, cross: 'MAX', name: 'history' }));
  }
  return V(kids, { name: 'calculator/' + mode, fill: C.surface, pad: 12, gap: 12, w: W, cross: 'MAX', radius: mode === 'floating' ? 24 : 0, shadow: mode === 'floating' ? true : undefined });
}

function sCalcDocked() {
  const { s, pg } = editorBase('22 · الآلة الحاسبة العلمية — مثبتة جانبياً (افتراضي)', 1, 4, { calcOpen: true, active: 'pen' });
  const panelW = 360;
  pg.rescale((SW - panelW - 40) / pg.width);
  pg.x = panelW + (SW - panelW - pg.width) / 2; pg.y = 150;
  const panel = calcPanel(panelW, 'docked');
  fixH(panel, SH - 140);
  panel.strokes = [solid(C.border)]; panel.strokeWeight = 1; panel.strokeTopWeight = 0; panel.strokeLeftWeight = 0; panel.strokeBottomWeight = 0; panel.strokeRightWeight = 1;
  place(s, panel, 0, 140);
  const tb = s.findOne((n) => n.name.startsWith('toolbar/'));
  s.appendChild(tb);
}

function sCalcFloating() {
  const { s, pg } = editorBase('23 · الآلة الحاسبة — نافذة عائمة قابلة للنقل', 2, 4, { calcOpen: true, active: 'pen' });
  const panel = calcPanel(360, 'floating');
  place(s, panel, 30, SH - panel.height - 64);
  const moveHint = H([I('hand', 16, C.white), T('اسحب من الأعلى لنقلها', { size: 12, w: 'medium', color: C.white })], { gap: 6, fill: C.text, radius: 999, px: 12, py: 6, cross: 'CENTER', opacity: 0.92 });
  place(s, moveHint, panel.x + (panel.width - moveHint.width) / 2, panel.y - moveHint.height - 10);
  void pg;
}

function sCover() {
  const f = figma.createFrame();
  f.name = '00 · Cover';
  f.resize(SW, 520); f.fills = [solid(C.accent)]; f.cornerRadius = 28;
  PAGE.appendChild(f); f.x = -SW - 140 - 0; f.y = 140;
  const col = V([
    H([betaPill(14), T('QU Student', { size: 18, w: 'semibold', color: '#CFEFF5', font: { family: 'Inter', style: 'Semi Bold' } })], { gap: 10, cross: 'CENTER' }),
    T('المذكرات', { size: 54, w: 'bold', color: C.white }),
    T('Notebook · Beta', { size: 22, w: 'semibold', color: '#CFEFF5', font: { family: 'Inter', style: 'Semi Bold' } }),
    T('تصاميم iPad بالعربية (من اليمين لليسار)، مبنية على notebook-prd.md', { size: 18, color: '#CFEFF5', width: 700 }),
    T('01 الرئيسية · 02–05 المكتبة والاستيراد · 06–12 المحرر والأدوات والتسجيل · 13 الصفحات · 14 المشاركة · 15 الإعدادات · 16 المحذوفة · 17 الحالة الفارغة · 18–21 نقل شريط الأدوات · 22–23 الآلة الحاسبة العلمية', { size: 16, color: C.white, lh: 28, width: 700 }),
  ], { gap: 16, cross: 'MAX' });
  place(f, col, SW - 56 - col.width, 90);
  STATUS_COMP.x = f.x; STATUS_COMP.y = f.y + f.height + 80;
}

// ---------- main ----------
async function main() {
  await setupFonts();
  let page = figma.root.children.find((p) => p.name === PAGE_NAME);
  if (!page) { page = figma.root.children[0]; page.name = PAGE_NAME; }
  await figma.setCurrentPageAsync(page);
  for (const n of [...page.children]) n.remove();
  PAGE = page;
  STATUS_COMP = buildStatusComponent(page);
  const steps = [sCover, sHome, sLibrary, sFolder, sNewNotebook, sReceivePdf, sEditor, sPenOptions, sPdfLasso, sShapesText, sRecording, sPlayback, sContinue, sPages, sExport, sSettings, sDeleted, sEmpty, sToolbarDrag, sToolbarRight, sToolbarBottom, sToolbarLeft, sCalcDocked, sCalcFloating];
  const errors = [];
  for (const fn of steps) {
    try { fn(); } catch (e) { errors.push(fn.name + ': ' + (e && e.message ? e.message : String(e))); }
  }
  figma.viewport.scrollAndZoomIntoView(page.children);
  const fonts = `${FAM} / ${HAND_AR.family} / ${HAND_EN.family}`;
  figma.closePlugin(errors.length ? ('Errors: ' + errors.join(' | ')).slice(0, 380) : `Done: ${steps.length - 1} screens · fonts: ${fonts}`);
}

main().catch((e) => figma.closePlugin('Failed: ' + (e && e.message ? e.message : String(e))));
