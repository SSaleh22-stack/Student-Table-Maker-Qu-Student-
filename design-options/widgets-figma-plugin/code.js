// QU Student — home-screen and lock-screen widgets for iOS and Android, Arabic RTL.
// Widgets: الجدول (today's lectures), مهامي (tasks), المحاضرة القادمة (next-lecture countdown).
// Rebuilds the page "الودجات — iOS و Android" from scratch on each run.

const PAGE_NAME = 'الودجات — iOS و Android';
const LRM = '‎';
const RLM = '‏';
const LINES = new Map(); // text node id -> max lines, re-applied once the text has its final width
const rng = (s, e) => LRM + s + '–' + e + LRM;
const tm = (s) => LRM + s + LRM;

// ---------- colors (mobile-app/src/lib/theme.ts + course palette from src/lib/courses.ts) ----------
const PALETTE = {
  CS101: { bg: '#DCEBFF', text: '#1E3A8A', bar: '#3B82F6' },
  MATH201: { bg: '#D8F3E8', text: '#065F46', bar: '#10B981' },
  PHYS101: { bg: '#FFE7CC', text: '#9A3412', bar: '#F59E0B' },
  ENG101: { bg: '#E9E3FF', text: '#4C1D95', bar: '#8B5CF6' },
  ISL101: { bg: '#F6DDF0', text: '#86198F', bar: '#EC4899' },
};
const TINT = '#F4C38A'; // sample tint; on a real phone the student picks it

const MODES = {
  light: {
    key: 'light', label: 'فاتح', bg: '#FFFFFF', bgOp: 1, text: '#1B2533', muted: '#4A5668', faint: '#6B7686',
    accent: '#0E7490', onAccent: '#FFFFFF', soft: '#DDF0F4', softOp: 1, divider: '#E3E9F0', track: '#E3E9F0',
    now: '#E5484D', board: ['#D3E6EF', '#F1E7DC'], boardText: '#1B2533', boardMuted: '#4A5668',
    course: (c) => ({ bg: PALETTE[c].bg, bgOp: 1, text: PALETTE[c].text, bar: PALETTE[c].bar }),
  },
  dark: {
    key: 'dark', label: 'داكن', bg: '#18222D', bgOp: 1, text: '#EEF3F8', muted: '#AAB6C4', faint: '#8794A3',
    accent: '#7FD3E3', onAccent: '#0B1A22', soft: '#7FD3E3', softOp: 0.16, divider: '#2A3644', track: '#2C3947',
    now: '#FF7A7A', board: ['#0B141B', '#1C1626'], boardText: '#EEF3F8', boardMuted: '#AAB6C4',
    course: (c) => ({ bg: PALETTE[c].bar, bgOp: 0.22, text: '#EEF3F8', bar: PALETTE[c].bar }),
  },
  tinted: {
    key: 'tinted', label: 'ملوّن (Tinted)', bg: '#2B241E', bgOp: 0.74, blur: true, text: TINT, muted: '#CFA97F', faint: '#A88B6B',
    accent: TINT, onAccent: '#2B241E', soft: TINT, softOp: 0.16, divider: '#4A3F35', track: '#4A3F35',
    now: TINT, board: ['#3A2A1E', '#120D09'], boardText: '#F6EBDD', boardMuted: '#CFA97F',
    course: () => ({ bg: TINT, bgOp: 0.14, text: TINT, bar: TINT }),
  },
};

// ---------- sample data (from mobile-app/src/lib/sampleCourses.ts), Sunday 22 November, 9:41 AM ----------
const SUNDAY = [
  { code: 'CS101', name: 'مقدمة في علوم الحاسب', s: '8:00', e: '9:30', room: 'مبنى 5 · 201', type: 'نظري', sec: '01', inst: 'د. أحمد علي', done: true },
  { code: 'MATH201', name: 'التفاضل والتكامل 2', s: '10:00', e: '11:30', room: 'مبنى 3 · 105', type: 'نظري', sec: '03', inst: 'د. سارة الأحمد' },
  { code: 'PHYS101', name: 'الفيزياء العامة 1', s: '12:00', e: '1:30', room: 'مبنى 7 · 112', type: 'نظري', sec: '08', inst: 'د. خالد فهد' },
  { code: 'ENG101', name: 'مهارات اللغة الإنجليزية', s: '2:00', e: '3:30', room: 'مبنى 2 · 014', type: 'نظري', sec: '02', inst: 'د. جون سميث' },
];
const MONDAY = [
  { code: 'ISL101', name: 'الثقافة الإسلامية 1', s: '10:00', e: '11:00', room: 'مبنى 1 · 12', type: 'نظري', sec: '01', inst: 'د. عبدالله صالح' },
  { code: 'CS101', name: 'مقدمة في علوم الحاسب', s: '2:00', e: '3:40', room: 'معمل 5 · 103', type: 'عملي', sec: '51', inst: 'أ. سعد العتيبي' },
];
// minutes from midnight, for the iPad week grid
const WEEK = [
  ['أحد', [['CS101', 480, 570], ['MATH201', 600, 690], ['PHYS101', 720, 810], ['ENG101', 840, 930]]],
  ['اثنين', [['ISL101', 600, 660], ['CS101', 840, 940]]],
  ['ثلاثاء', [['CS101', 480, 570], ['PHYS101', 720, 810], ['PHYS101', 840, 940]]],
  ['أربعاء', [['MATH201', 600, 690]]],
  ['خميس', [['ISL101', 600, 660], ['ENG101', 840, 930]]],
];
const TODAY_TASKS = [
  { t: 'حل واجب الفصل الثالث', code: 'MATH201', due: '11:59 م' },
  { t: 'تسليم تقرير المعمل', code: 'CS101', due: '2:00 م' },
  { t: 'قراءة المحاضرة الخامسة', code: 'PHYS101', due: 'اليوم', done: true },
  { t: 'طباعة ملخص المراجعة', due: '5:00 م' },
];
const UPCOMING_TASKS = [
  { t: 'اختبار قصير', code: 'ENG101', due: 'الثلاثاء 10:00 ص' },
  { t: 'مشروع البرمجة – المرحلة 1', code: 'CS101', due: 'الأربعاء' },
  { t: 'مراجعة الفصل الرابع', code: 'MATH201', due: 'الخميس' },
];

// ---------- sizes ----------
const IOS = {
  S: { key: 'S', w: 170, h: 170, cap: 'صغير · ' + tm('170×170') },
  M: { key: 'M', w: 364, h: 170, cap: 'متوسط · ' + tm('364×170') },
  L: { key: 'L', w: 364, h: 382, cap: 'كبير · ' + tm('364×382') },
  XL: { key: 'XL', w: 724, h: 340, cap: 'كبير جدًا (iPad) · ' + tm('724×340') },
};
const AND = {
  '2x1': { key: '2x1', w: 172, h: 88, cap: tm('2×1') + ' · ' + tm('172×88dp') },
  '4x1': { key: '4x1', w: 360, h: 88, cap: tm('4×1') + ' · ' + tm('360×88dp') },
  '2x2': { key: '2x2', w: 172, h: 184, cap: tm('2×2') + ' · ' + tm('172×184dp') },
  '4x2': { key: '4x2', w: 360, h: 184, cap: tm('4×2') + ' · ' + tm('360×184dp') },
  '4x4': { key: '4x4', w: 360, h: 376, cap: tm('4×4') + ' · ' + tm('360×376dp') },
};
const P_IOS = { plat: 'ios', radius: 24, pad: 16 };
const P_AND = { plat: 'android', radius: 28, pad: 14 };
const kindOf = (sz) => (sz.w > 600 ? 'xl' : sz.w < 200 ? 'small' : sz.h < 200 ? 'medium' : 'large');

// ---------- helpers ----------
const rgb = (hex) => { const h = hex.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const solid = (hex, opacity) => { const p = { type: 'SOLID', color: rgb(hex) }; if (opacity !== undefined && opacity !== 1) p.opacity = opacity; return p; };
const grad = (a, b) => ({ type: 'GRADIENT_LINEAR', gradientTransform: [[0, 1, 0], [-1, 0, 1]], gradientStops: [{ position: 0, color: Object.assign(rgb(a), { a: 1 }) }, { position: 1, color: Object.assign(rgb(b), { a: 1 }) }] });
const SHADOW = [{ type: 'DROP_SHADOW', color: { r: 0.05, g: 0.1, b: 0.15, a: 0.12 }, offset: { x: 0, y: 6 }, radius: 18, spread: 0, visible: true, blendMode: 'NORMAL' }];

let FAM = 'IBM Plex Sans Arabic';
const W = {};
let CLOCK = null;

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
  CLOCK = W.bold;
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
}

function T(str, o = {}) {
  const t = figma.createText();
  t.fontName = o.font || W[o.w || 'regular'];
  t.characters = o.ltr ? str : RLM + str;
  t.fontSize = o.size || 13;
  t.fills = [solid(o.color || '#1B2533', o.opacity)];
  t.textAlignHorizontal = o.align || 'RIGHT';
  t.lineHeight = { unit: 'PIXELS', value: o.lh || Math.round((o.size || 13) * 1.42) };
  if (o.width) { t.resize(o.width, t.height); t.textAutoResize = 'HEIGHT'; } else t.textAutoResize = 'WIDTH_AND_HEIGHT';
  if (o.lines) { LINES.set(t.id, o.lines); t.textTruncation = 'ENDING'; t.maxLines = o.lines; }
  if (o.strike) t.textDecoration = 'STRIKETHROUGH';
  if (o.name) t.name = o.name;
  return t;
}

function setPad(f, o) {
  const px = o.px !== undefined ? o.px : (o.pad || 0);
  const py = o.py !== undefined ? o.py : (o.pad || 0);
  f.paddingLeft = px; f.paddingRight = px; f.paddingTop = o.pt !== undefined ? o.pt : py; f.paddingBottom = o.pb !== undefined ? o.pb : py;
}

// Auto-layout frame. HORIZONTAL kids are given right-to-left (RTL); VERTICAL top-to-bottom.
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
  if (o.stroke) { f.strokes = [solid(o.stroke, o.strokeOp)]; f.strokeWeight = o.strokeW || 1; f.strokeAlign = 'INSIDE'; }
  f.primaryAxisAlignItems = o.align || 'MIN';
  f.counterAxisAlignItems = o.cross || (dir === 'HORIZONTAL' ? 'CENTER' : 'MAX');
  f.clipsContent = !!o.clip;
  if (o.w) fixW(f, o.w);
  if (o.h) fixH(f, o.h);
  const list = dir === 'HORIZONTAL' ? [...kids].reverse() : kids;
  for (const k of list) if (k) add(f, k);
  if (o.opacity !== undefined) f.opacity = o.opacity;
  return f;
}
const H = (kids, o) => AL('HORIZONTAL', kids, o);
const V = (kids, o) => AL('VERTICAL', kids, o);

function add(parent, k) {
  if (k && k.__hint) {
    parent.appendChild(k.node);
    if (k.fillW) k.node.layoutSizingHorizontal = 'FILL';
    if (k.fillH) k.node.layoutSizingVertical = 'FILL';
    if (k.grow) k.node.layoutGrow = 1;
    if (k.node.type === 'TEXT' && (k.fillW || (k.grow && parent.layoutMode === 'HORIZONTAL'))) {
      k.node.textAutoResize = 'HEIGHT';
      const n = LINES.get(k.node.id);
      if (n) { k.node.textTruncation = 'ENDING'; k.node.maxLines = n; }
    }
    return k.node;
  }
  parent.appendChild(k);
  return k;
}
const fillW = (node) => ({ __hint: true, node, fillW: true });
const fillH = (node) => ({ __hint: true, node, fillH: true });
const grow = (node) => ({ __hint: true, node, grow: true });
const growFill = (node) => ({ __hint: true, node, grow: true, fillW: true });
const growFillH = (node) => ({ __hint: true, node, grow: true, fillH: true });
const spacer = () => { const s = figma.createFrame(); s.name = 'spacer'; s.fills = []; s.resize(1, 1); return grow(s); };

function fixW(f, w) { f.resize(w, Math.max(f.height, 1)); if (f.layoutMode === 'HORIZONTAL') f.primaryAxisSizingMode = 'FIXED'; else f.counterAxisSizingMode = 'FIXED'; }
function fixH(f, h) { f.resize(Math.max(f.width, 1), h); if (f.layoutMode === 'VERTICAL') f.primaryAxisSizingMode = 'FIXED'; else f.counterAxisSizingMode = 'FIXED'; }

function R(w, h, fill, o = {}) {
  const r = figma.createRectangle();
  r.resize(w, h);
  r.fills = fill ? [solid(fill, o.opacity)] : [];
  if (o.radius) r.cornerRadius = o.radius;
  if (o.name) r.name = o.name;
  return r;
}
function E(d, fill, o = {}) {
  const e = figma.createEllipse();
  e.resize(d, d);
  e.fills = fill ? [solid(fill, o.opacity)] : [];
  if (o.stroke) { e.strokes = [solid(o.stroke, o.strokeOp)]; e.strokeWeight = o.strokeW || 1; }
  return e;
}
function place(parent, node, x, y) { parent.appendChild(node); node.x = x; node.y = y; return node; }
const hdiv = (M) => fillW(R(10, 1, M.divider, { name: 'divider' }));
const vdiv = (M) => fillH(R(1, 10, M.divider, { name: 'divider' }));

// ---------- icons (24x24 stroke grid, like src/components/Icon.tsx) ----------
const ICONS = {
  calendar: [{ x: 3, y: 4, w: 18, h: 18, rx: 2 }, { d: 'M16 2v4M8 2v4M3 10h18' }],
  calendarCheck: [{ x: 3, y: 4, w: 18, h: 18, rx: 2 }, { d: 'M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4' }],
  clock: [{ cx: 12, cy: 12, r: 10 }, { d: 'M12 6v6l4 2' }],
  check: [{ d: 'M20 6L9 17l-5-5' }],
  checkCircle: [{ cx: 12, cy: 12, r: 10 }, { d: 'M8 12.5l2.5 2.5L16 9.5' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  mapPin: [{ d: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z' }, { cx: 12, cy: 10, r: 3 }],
  user: [{ cx: 12, cy: 7, r: 4 }, { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }],
  list: [{ d: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01' }],
  search: [{ cx: 11, cy: 11, r: 7 }, { d: 'M21 21l-4.3-4.3' }],
  flashlight: [{ d: 'M18 6l-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10L6 6zM6 2h12v4H6zM12 13v2' }],
  camera: [{ d: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z' }, { cx: 12, cy: 13, r: 3 }],
  lock: [{ x: 4, y: 11, w: 16, h: 10, rx: 2 }, { d: 'M8 11V7a4 4 0 0 1 8 0v4' }],
  hand: [{ d: 'M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8' }, { d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15' }],
};
function svgFor(name, color, sw) {
  let inner = '';
  for (const s of ICONS[name]) {
    if (s.d) inner += `<path d="${s.d}"/>`;
    else if (s.r !== undefined) inner += `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`;
    else inner += `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx || 0}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
function I(name, size, color, o = {}) {
  const n = figma.createNodeFromSvg(svgFor(name, color, o.sw || 2));
  n.name = 'icon/' + name;
  n.fills = [];
  n.rescale(size / 24);
  if (o.opacity !== undefined) n.opacity = o.opacity;
  return n;
}

// Progress ring (clockwise from the top) with optional centered content.
function ring(size, pct, color, track, sw, center, o = {}) {
  const r = (size - sw) / 2, c = size / 2;
  const a = Math.min(pct, 0.9999) * 2 * Math.PI;
  const x = c + r * Math.sin(a), y = c - r * Math.cos(a);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">` +
    `<circle cx="${c}" cy="${c}" r="${r}" stroke="${track}" stroke-opacity="${o.trackOp !== undefined ? o.trackOp : 1}" stroke-width="${sw}"/>` +
    `<path d="M ${c} ${c - r} A ${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
  const f = figma.createFrame();
  f.name = 'ring'; f.resize(size, size); f.fills = []; f.clipsContent = false;
  const n = figma.createNodeFromSvg(svg); n.fills = []; n.name = 'ring-arc';
  place(f, n, 0, 0);
  if (center) { const box = V(center, { w: size, h: size, align: 'CENTER', cross: 'CENTER', gap: 0, name: 'ring-center' }); place(f, box, 0, 0); }
  return f;
}

// Progress bar, filled from the right (RTL).
function bar(w, h, pct, color, track) {
  return H([R(Math.max(h, Math.round(w * pct)), h, color, { radius: h / 2 })], { name: 'progress', w, h, fill: track, radius: h / 2, align: 'MAX' });
}

// ---------- shared widget parts ----------
function shell(name, sz, P, M, kids, o = {}) {
  const f = V(kids, { name, w: sz.w, h: sz.h, pad: o.pad !== undefined ? o.pad : P.pad, gap: o.gap !== undefined ? o.gap : 8, radius: P.radius, fill: M.bg, fillOpacity: M.bgOp, cross: o.cross, align: o.align, clip: true });
  const fx = [];
  if (M.blur) fx.push({ type: 'BACKGROUND_BLUR', radius: 24, visible: true });
  if (P.plat === 'android' && M.key === 'light') fx.push(SHADOW[0]);
  if (fx.length) f.effects = fx;
  if (M.key === 'tinted') { f.strokes = [solid(TINT, 0.18)]; f.strokeWeight = 1; f.strokeAlign = 'INSIDE'; }
  return f;
}
function pillN(label, M, o = {}) {
  return H([T(label, { size: o.size || 10, w: 'bold', color: M.onAccent })], { name: 'pill', px: o.px || 8, py: o.py || 2, radius: 999, fill: M.accent });
}
function iconTile(icon, M, s = 32, isz) {
  return H([I(icon, isz || Math.round(s * 0.5), M.accent)], { name: 'icon-tile', w: s, h: s, radius: Math.round(s * 0.32), fill: M.soft, fillOpacity: M.softOp, align: 'CENTER', cross: 'CENTER' });
}
function brand(M) { // Android widget header mark
  return H([I('calendar', 11, M.onAccent, { sw: 2.5 })], { name: 'app-mark', w: 20, h: 20, radius: 6, fill: M.accent, align: 'CENTER', cross: 'CENTER' });
}
function checkbox(done, M, s = 18) {
  if (done) return H([I('check', Math.round(s * 0.62), M.onAccent, { sw: 3 })], { name: 'checkbox/done', w: s, h: s, radius: 999, fill: M.accent, align: 'CENTER', cross: 'CENTER' });
  return H([], { name: 'checkbox/open', w: s, h: s, radius: 999, stroke: M.faint, strokeW: 1.6 });
}
function addBtn(M, s = 24) {
  return H([I('plus', Math.round(s * 0.62), M.onAccent, { sw: 2.6 })], { name: 'button/add-task', w: s, h: s, radius: 999, fill: M.accent, align: 'CENTER', cross: 'CENTER' });
}
function segs(total, done, M) {
  const kids = [];
  for (let i = 0; i < total; i++) kids.push(R(14, 4, i < done ? M.track : M.accent, { radius: 2 }));
  return H(kids, { gap: 3, name: 'day-progress' });
}

// A list row for a lecture: color bar, name, time and room, optional pill.
function lecRow(L, M, o = {}) {
  const cc = M.course(L.code);
  const col = V([
    fillW(T(L.name, { size: o.nsize || 13, w: 'semibold', color: o.hl ? cc.text : M.text, lines: 1 })),
    fillW(T(rng(L.s, L.e) + ' · ' + L.room, { size: o.msize || 11, color: o.hl ? cc.text : M.muted, opacity: o.hl ? 0.85 : 1, lines: 1 })),
  ], { gap: 1 });
  const kids = [fillH(R(3, 10, cc.bar, { radius: 2 })), grow(col)];
  if (o.pill) kids.push(pillN(o.pill, M));
  const row = H(kids, Object.assign({ name: 'lecture/' + L.code, gap: 8, cross: 'CENTER' }, o.hl ? { fill: cc.bg, fillOpacity: cc.bgOp, radius: 10, px: 8, py: 6 } : {}));
  if (L.done) row.opacity = 0.45;
  return row;
}
// A timeline row: start/end on the right, a colored block on the left.
function lecLine(L, M, o = {}) {
  const cc = M.course(L.code);
  const col = V([
    fillW(T(L.name, { size: o.nsize || 13, w: 'semibold', color: cc.text, lines: 1 })),
    fillW(T(L.room + ' · ' + L.type, { size: 11, color: cc.text, opacity: 0.8, lines: 1 })),
  ], { gap: 1 });
  const kids = [grow(col)];
  if (o.pill) kids.push(pillN(o.pill, M));
  const block = H(kids, { name: 'block', gap: 6, fill: cc.bg, fillOpacity: cc.bgOp, radius: 12, px: 10, py: o.py || 8, cross: 'CENTER' });
  if (o.next) { block.strokes = [solid(M.accent)]; block.strokeWeight = 1.5; block.strokeAlign = 'INSIDE'; }
  const times = V([T(tm(L.s), { size: 12, w: 'semibold', color: M.text }), T(tm(L.e), { size: 10, color: M.faint })], { w: 40, gap: 0 });
  const row = H([times, grow(block)], { name: 'lecture/' + L.code, gap: 10, cross: 'MIN' });
  if (L.done) row.opacity = 0.45;
  return row;
}
function nowLine(M) {
  const lbl = V([T('9:41', { size: 10, w: 'bold', color: M.now })], { w: 40 });
  return H([lbl, E(7, M.now), grow(R(10, 1.5, M.now))], { name: 'now-line', gap: 0, cross: 'CENTER' });
}

// ---------- الجدول (today's timetable) ----------
function timetable(sz, P, M, variant = 'normal') {
  const kind = kindOf(sz);
  const name = `الجدول · ${sz.cap} · ${M.label}` + (variant === 'normal' ? '' : variant === 'tomorrow' ? ' · اليوم التالي' : ' · لا محاضرات');
  const cw = sz.w - 2 * P.pad;
  const and = P.plat === 'android';
  if (variant === 'none') return ttNone(name, sz, P, M, kind, cw);
  const tmr = variant === 'tomorrow';
  const list = tmr ? MONDAY : SUNDAY;
  const up = list.filter((l) => !l.done);
  const dayName = tmr ? 'الاثنين' : 'الأحد';
  const date = tmr ? '23 نوفمبر' : '22 نوفمبر';

  if (kind === 'small') {
    const n = up[0], cc = M.course(n.code);
    const head = H([
      and ? brand(M) : null,
      T(tmr ? 'غدًا · الاثنين' : 'الأحد', { size: 13, w: 'bold', color: M.accent }),
      spacer(),
      tmr ? T('محاضرتان', { size: 11, color: M.faint }) : pillN('بعد 19 د', M),
    ], { gap: 6 });
    const card = V([
      fillW(T(n.name, { size: 14, w: 'bold', color: cc.text, lines: 2 })),
      fillW(T(rng(n.s, n.e), { size: 11, color: cc.text, opacity: 0.85, lines: 1 })),
      fillW(T(n.room, { size: 11, color: cc.text, opacity: 0.85, lines: 1 })),
    ], { name: 'next-lecture', gap: 3, pad: 10, radius: 14, fill: cc.bg, fillOpacity: cc.bgOp });
    const more = up.slice(1, sz.h > 176 ? 3 : 2).map((l) => H([E(6, M.course(l.code).bar), grow(T(l.name, { size: 11, w: 'medium', color: M.text, lines: 1 })), T(tm(l.s), { size: 11, w: 'semibold', color: M.muted })], { gap: 6, name: 'later/' + l.code }));
    return shell(name, sz, P, M, [fillW(head), fillW(card), ...more.map(fillW)]);
  }

  if (kind === 'medium') {
    const rc = V([
      and ? brand(M) : null,
      tmr ? T('غدًا', { size: 12, w: 'semibold', color: M.accent }) : null,
      T(dayName, { size: 22, w: 'bold', color: M.text }),
      T(date, { size: 12, color: M.muted }),
      spacer(),
      tmr ? T('انتهت محاضرات اليوم', { size: 10, color: M.faint, width: 78 }) : segs(4, 1, M),
      tmr ? null : T('3 من 4 متبقية', { size: 10, color: M.faint }),
    ], { name: 'day', w: 78, gap: 3 });
    const rows = up.slice(0, 3).map((l, i) => fillW(lecRow(l, M, i === 0 ? { hl: true, pill: tmr ? null : 'بعد 19 د' } : {})));
    const listCol = V(rows, { name: 'lectures', gap: 6 });
    return shell(name, sz, P, M, [growFill(H([fillH(rc), vdiv(M), growFillH(listCol)], { gap: 12, cross: 'MIN' }))]);
  }

  if (kind === 'large') {
    const head = H([
      and ? brand(M) : null,
      V([T(tmr ? 'غدًا · الاثنين' : 'الأحد', { size: 20, w: 'bold', color: M.text }), T(tmr ? '23 نوفمبر · محاضرتان' : '22 نوفمبر · 4 محاضرات', { size: 12, color: M.muted })], { gap: 0 }),
      spacer(),
      and ? null : iconTile('calendar', M),
    ], { gap: 8, cross: 'CENTER' });
    const body = [];
    if (tmr) {
      body.push(fillW(H([I('checkCircle', 16, M.accent), grow(T('انتهت محاضرات اليوم، وهذا جدول الغد', { size: 12, w: 'medium', color: M.accent, lines: 1 }))], { gap: 6, px: 10, py: 8, radius: 12, fill: M.soft, fillOpacity: M.softOp })));
      list.forEach((l, i) => body.push(fillW(lecLine(l, M, { next: i === 0 }))));
    } else {
      list.forEach((l, i) => {
        body.push(fillW(lecLine(l, M, i === 1 ? { next: true, pill: 'بعد 19 دقيقة', py: 6 } : { py: 6 })));
        if (i === 0) body.push(fillW(nowLine(M)));
      });
    }
    const foot = H([I('calendar', 13, M.faint), grow(T(tmr ? 'بعدها: الثلاثاء · 3 محاضرات' : 'غدًا: الثقافة الإسلامية 1 · ' + tm('10:00'), { size: 11, color: M.muted, lines: 1 }))], { gap: 6 });
    return shell(name, sz, P, M, [fillW(head), ...body, spacer(), hdiv(M), fillW(foot)], { gap: 6 });
  }

  // xl (iPad): today's timeline on the right, the week grid on the left.
  const todayW = 320;
  const head = H([V([T('الأحد', { size: 20, w: 'bold', color: M.text }), T('22 نوفمبر · 4 محاضرات', { size: 12, color: M.muted })], { gap: 0 }), spacer(), pillN('بعد 19 دقيقة', M, { size: 11, px: 10, py: 3 })], { gap: 8 });
  const rows = [];
  SUNDAY.forEach((l, i) => { rows.push(fillW(lecLine(l, M, i === 1 ? { next: true, py: 6 } : { py: 6 }))); if (i === 0) rows.push(fillW(nowLine(M))); });
  const today = V([fillW(head), ...rows], { name: 'today', w: todayW, gap: 7 });
  const gw = cw - todayW - 1 - 32;
  const grid = weekGrid(gw, sz.h - 2 * P.pad, M);
  return shell(name, sz, P, M, [growFill(H([fillH(today), vdiv(M), grid], { gap: 16, cross: 'MIN' }))]);
}

function weekGrid(w, h, M) {
  const f = figma.createFrame();
  f.name = 'week-grid'; f.resize(w, h); f.fills = []; f.clipsContent = true;
  const labelW = 24, headH = 22;
  const colW = (w - labelW) / 5;
  const ph = (h - headH - 4) / 8; // 8 AM → 4 PM
  const yOf = (min) => headH + ((min - 480) / 60) * ph;
  // today's column
  place(f, R(colW, h - headH + 2, M.soft, { opacity: M.softOp * (M.key === 'light' ? 0.7 : 1), radius: 10, name: 'today-column' }), w - labelW - colW, headH - 4);
  // hour lines and labels
  [[480, '8'], [600, '10'], [720, '12'], [840, '2'], [960, '4']].forEach(([m, lbl]) => {
    place(f, R(w - labelW, 1, M.divider), 0, yOf(m));
    const t = T(lbl, { size: 9, color: M.faint, width: labelW - 4 }); place(f, t, w - labelW + 4, yOf(m) - 6);
  });
  WEEK.forEach(([day, blocks], i) => {
    const x = w - labelW - (i + 1) * colW;
    const t = T(day, { size: 10, w: i === 0 ? 'bold' : 'medium', color: i === 0 ? M.accent : M.muted, align: 'CENTER', width: colW });
    place(f, t, x, 0);
    for (const [code, s, e] of blocks) {
      const cc = M.course(code);
      const bh = ((e - s) / 60) * ph - 2;
      const b = V([T(code, { size: 9, w: 'semibold', color: cc.text, lines: 1 })], { name: 'block/' + code, w: colW - 4, h: bh, pad: 4, radius: 6, fill: cc.bg, fillOpacity: cc.bgOp });
      if (i === 0 && s === 600) { b.strokes = [solid(M.accent)]; b.strokeWeight = 1.5; b.strokeAlign = 'INSIDE'; }
      if (i === 0 && s === 480) b.opacity = 0.45;
      place(f, b, x + 2, yOf(s) + 1);
    }
  });
  const ny = yOf(581);
  place(f, R(colW, 1.5, M.now), w - labelW - colW, ny);
  place(f, E(6, M.now), w - labelW - 3, ny - 2.25);
  return f;
}

function ttNone(name, sz, P, M, kind, cw) {
  const and = P.plat === 'android';
  if (kind === 'small') {
    return shell(name, sz, P, M, [
      iconTile('calendarCheck', M, 44),
      T('لا محاضرات متبقية اليوم', { size: 14, w: 'bold', color: M.text, align: 'CENTER', width: cw }),
      T('الأحد 22 نوفمبر', { size: 11, color: M.faint, align: 'CENTER' }),
    ], { align: 'CENTER', cross: 'CENTER', gap: 8 });
  }
  if (kind === 'medium') {
    const row = H([iconTile('calendarCheck', M, 56), V([T('لا محاضرات متبقية اليوم', { size: 17, w: 'bold', color: M.text }), T('الأحد 22 نوفمبر', { size: 12, color: M.muted })], { gap: 2 })], { gap: 14 });
    return shell(name, sz, P, M, [and ? brand(M) : null, spacer(), row, spacer()], { cross: 'CENTER' });
  }
  return shell(name, sz, P, M, [
    and ? brand(M) : null,
    spacer(),
    iconTile('calendarCheck', M, 72),
    T('لا محاضرات متبقية اليوم', { size: 19, w: 'bold', color: M.text, align: 'CENTER' }),
    T('الأحد 22 نوفمبر', { size: 13, color: M.muted, align: 'CENTER' }),
    spacer(),
  ], { cross: 'CENTER', gap: 10 });
}

// ---------- مهامي (tasks) ----------
function taskRow(t, M, o = {}) {
  const meta = [];
  if (t.code) { meta.push(E(6, M.course(t.code).bar)); meta.push(T(t.code, { size: 10, w: 'semibold', color: M.muted })); meta.push(T('·', { size: 10, color: M.faint })); }
  meta.push(T(t.due, { size: 10, color: M.faint }));
  const col = V([
    fillW(T(t.t, { size: o.ts || 13, w: 'medium', color: t.done ? M.faint : M.text, lines: 1, strike: !!t.done })),
    o.noMeta ? null : H(meta, { gap: 4 }),
  ], { gap: 1 });
  return H([checkbox(!!t.done, M, o.cs || 18), grow(col)], { name: 'task' + (t.done ? '/done' : ''), gap: 8, cross: 'CENTER' });
}
function taskHead(M, P, o = {}) {
  return H([
    P.plat === 'android' ? brand(M) : null,
    T('مهامي', { size: o.size || 14, w: 'bold', color: o.accentTitle ? M.accent : M.text }),
    o.sub ? T(o.sub, { size: 12, color: M.muted }) : null,
    spacer(),
    o.count ? T(o.count, { size: 11, color: M.faint }) : null,
    addBtn(M, o.btn || 24),
  ], { gap: 6, name: 'header' });
}
function sectionLabel(label, M) { return T(label, { size: 11, w: 'bold', color: M.accent }); }

function tasks(sz, P, M, variant = 'normal') {
  const kind = kindOf(sz);
  const name = `مهامي · ${sz.cap} · ${M.label}` + (variant === 'done' ? ' · لا مهام متبقية' : '');
  const cw = sz.w - 2 * P.pad;
  if (variant === 'done') return tkDone(name, sz, P, M, kind, cw);
  const open = TODAY_TASKS.filter((t) => !t.done);

  if (kind === 'small') {
    const rows = open.slice(0, sz.h > 176 ? 4 : 3).map((t) => fillW(taskRow(t, M, { ts: 12, cs: 18 })));
    return shell(name, sz, P, M, [fillW(taskHead(M, P, { size: 13, accentTitle: true, btn: 24 })), ...rows], { gap: 8 });
  }
  if (kind === 'medium') {
    const a = V([fillW(taskRow(TODAY_TASKS[0], M)), fillW(taskRow(TODAY_TASKS[1], M))], { gap: 10 });
    const b = V([fillW(taskRow(TODAY_TASKS[2], M)), fillW(taskRow(TODAY_TASKS[3], M))], { gap: 10 });
    return shell(name, sz, P, M, [
      fillW(taskHead(M, P, { sub: 'اليوم', count: '1 من 4 منجزة' })),
      bar(cw, 4, 0.25, M.accent, M.track),
      fillW(H([grow(a), grow(b)], { gap: 14, cross: 'MIN' })),
    ], { gap: 10 });
  }
  if (kind === 'large') {
    return shell(name, sz, P, M, [
      fillW(taskHead(M, P, { sub: 'اليوم', count: '1 من 4 منجزة' })),
      bar(cw, 4, 0.25, M.accent, M.track),
      sectionLabel('اليوم', M),
      ...TODAY_TASKS.map((t) => fillW(taskRow(t, M))),
      hdiv(M),
      sectionLabel('القادمة', M),
      ...UPCOMING_TASKS.slice(0, 2).map((t) => fillW(taskRow(t, M))),
      T('+1 مهمة أخرى', { size: 11, w: 'medium', color: M.faint }),
    ], { gap: 6 });
  }
  // xl
  const colA = V([sectionLabel('اليوم', M), ...TODAY_TASKS.map((t) => fillW(taskRow(t, M)))], { gap: 10 });
  const colB = V([sectionLabel('القادمة', M), ...UPCOMING_TASKS.map((t) => fillW(taskRow(t, M)))], { gap: 10 });
  return shell(name, sz, P, M, [
    fillW(taskHead(M, P, { size: 16, count: '1 من 4 منجزة اليوم', btn: 28 })),
    bar(cw, 5, 0.25, M.accent, M.track),
    growFill(H([growFillH(colA), vdiv(M), growFillH(colB)], { gap: 18, cross: 'MIN' })),
  ], { gap: 12 });
}

function tkDone(name, sz, P, M, kind, cw) {
  const newBtn = () => H([I('plus', 14, M.accent, { sw: 2.5 }), T('مهمة جديدة', { size: 12, w: 'semibold', color: M.accent })], { name: 'button/new-task', gap: 4, px: 12, py: 6, radius: 999, fill: M.soft, fillOpacity: M.softOp });
  if (kind === 'small') {
    return shell(name, sz, P, M, [
      iconTile('checkCircle', M, 44),
      T('أنجزت كل مهام اليوم', { size: 14, w: 'bold', color: M.text, align: 'CENTER', width: cw }),
      addBtn(M, 26),
    ], { align: 'CENTER', cross: 'CENTER', gap: 8 });
  }
  if (kind === 'medium') {
    const row = H([iconTile('checkCircle', M, 56), V([T('أنجزت كل مهام اليوم', { size: 17, w: 'bold', color: M.text }), T('3 مهام قادمة هذا الأسبوع', { size: 12, color: M.muted }), newBtn()], { gap: 6 })], { gap: 14 });
    return shell(name, sz, P, M, [P.plat === 'android' ? brand(M) : null, spacer(), row, spacer()], { cross: 'CENTER' });
  }
  return shell(name, sz, P, M, [
    fillW(taskHead(M, P, {})),
    spacer(),
    iconTile('checkCircle', M, 72),
    T('أنجزت كل مهام اليوم', { size: 19, w: 'bold', color: M.text, align: 'CENTER' }),
    T('3 مهام قادمة هذا الأسبوع', { size: 13, color: M.muted, align: 'CENTER' }),
    spacer(),
    hdiv(M),
    sectionLabel('القادمة', M),
    ...UPCOMING_TASKS.slice(0, 2).map((t) => fillW(taskRow(t, M))),
  ], { cross: 'CENTER', gap: 10 });
}

// ---------- المحاضرة القادمة (countdown) ----------
function countdown(sz, P, M, variant = 'next') {
  const kind = kindOf(sz);
  const now = variant === 'now';
  const name = `المحاضرة القادمة · ${sz.cap} · ${M.label}` + (now ? ' · أثناء المحاضرة' : '');
  const cw = sz.w - 2 * P.pad;
  const L = SUNDAY[1], cc = M.course(L.code);
  const mins = now ? '49' : '19';
  const pct = now ? 0.46 : 0.37;
  const label = now ? 'تنتهي بعد' : 'المحاضرة القادمة';
  const big = (size) => H([T(mins, { size, w: 'bold', color: M.accent, lh: Math.round(size * 1.1) }), T('دقيقة', { size: Math.round(size * 0.32), w: 'semibold', color: M.muted })], { gap: 4, cross: 'MAX', name: 'minutes' });
  const and = P.plat === 'android';

  if (sz.h < 100 && sz.w < 200) { // Android 2x1
    const n = V([T(mins, { size: 26, w: 'bold', color: M.accent, lh: 30 }), T('دقيقة', { size: 10, color: M.muted })], { w: 38, gap: 0, cross: 'CENTER' });
    const d = V([fillW(T(L.name, { size: 13, w: 'bold', color: M.text, lines: 2, lh: 17 })), fillW(T(tm(L.s) + ' · ' + L.room, { size: 10, color: M.muted, lines: 1 })), now ? pillN('الآن', M) : null], { gap: 2 });
    return shell(name, sz, P, M, [growFill(H([n, vdiv(M), grow(d)], { gap: 8 }))], { pad: 12 });
  }
  if (sz.h < 100) { // Android 4x1
    const d = V([
      fillW(T(now ? 'الآن · تنتهي بعد 49 دقيقة' : 'المحاضرة القادمة · بعد 19 دقيقة', { size: 11, w: 'semibold', color: M.accent, lines: 1 })),
      fillW(T(L.name, { size: 15, w: 'bold', color: M.text, lines: 1 })),
      fillW(T(rng(L.s, L.e) + ' · ' + L.room, { size: 11, color: M.muted, lines: 1 })),
    ], { gap: 1 });
    const r = ring(54, pct, M.accent, M.track, 5, [T(mins, { size: 17, w: 'bold', color: M.text, lh: 20 }), T('دقيقة', { size: 8, color: M.muted })]);
    return shell(name, sz, P, M, [growFill(H([brand(M), grow(d), r], { gap: 12 }))]);
  }
  if (kind === 'small') {
    const head = H([and ? brand(M) : E(8, cc.bar), now ? pillN('الآن', M) : null, T(label, { size: 11, w: 'semibold', color: M.muted })], { gap: 6 });
    return shell(name, sz, P, M, [
      fillW(head),
      spacer(),
      big(40),
      fillW(T(L.name, { size: 14, w: 'bold', color: M.text, lines: 1 })),
      fillW(T(now ? 'حتى ' + tm(L.e) + ' · ' + L.room : tm(L.s) + ' · ' + L.room, { size: 11, color: M.muted, lines: 1 })),
      bar(cw, 4, pct, M.accent, M.track),
    ], { gap: 4 });
  }
  // medium
  const left = V([
    H([now ? pillN('الآن', M) : null, T(label, { size: 11, w: 'semibold', color: M.muted })], { gap: 6 }),
    spacer(),
    big(44),
    T(now ? 'حتى ' + tm(L.e) : 'تبدأ ' + tm(L.s), { size: 11, color: M.muted }),
    bar(112, 4, pct, M.accent, M.track),
  ], { name: 'countdown', w: 112, gap: 4 });
  const meta = (icon, text) => H([I(icon, 13, M.faint), grow(T(text, { size: 12, color: M.muted, lines: 1 }))], { gap: 6 });
  const right = V([
    fillW(T(L.name, { size: 17, w: 'bold', color: M.text, lines: 1 })),
    fillW(T(L.code + ' · شعبة ' + L.sec + ' · ' + L.type, { size: 11, color: M.faint, lines: 1 })),
    fillW(meta('mapPin', L.room)),
    fillW(meta('user', L.inst)),
    spacer(),
    hdiv(M),
    fillW(H([T('بعدها', { size: 11, w: 'bold', color: M.accent }), E(6, M.course('PHYS101').bar), grow(T('الفيزياء العامة 1 · ' + tm('12:00'), { size: 11, color: M.muted, lines: 1 }))], { gap: 6 })),
  ], { name: 'details', gap: 4 });
  return shell(name, sz, P, M, [and ? fillW(H([brand(M), spacer()], {})) : null, growFill(H([fillH(left), vdiv(M), growFillH(right)], { gap: 14, cross: 'MIN' }))]);
}

// ---------- iOS Lock Screen (monochrome) ----------
const WH = '#FFFFFF';
function lockCircle(kind) {
  const f = figma.createFrame();
  f.name = 'قفل · دائري · ' + kind; f.resize(72, 72); f.cornerRadius = 36; f.fills = [solid(WH, 0.16)]; f.clipsContent = false;
  f.effects = [{ type: 'BACKGROUND_BLUR', radius: 20, visible: true }];
  let inner;
  if (kind === 'countdown') inner = ring(62, 0.37, WH, WH, 5, [T('19', { size: 22, w: 'bold', color: WH, lh: 26 }), T('دقيقة', { size: 9, w: 'semibold', color: WH, opacity: 0.8 })], { trackOp: 0.25 });
  else if (kind === 'tasks') inner = ring(62, 0.25, WH, WH, 5, [I('checkCircle', 12, WH), T('3', { size: 20, w: 'bold', color: WH, lh: 24 })], { trackOp: 0.25 });
  else inner = V([I('calendar', 14, WH), T('3', { size: 20, w: 'bold', color: WH, lh: 24 }), T('محاضرات', { size: 9, w: 'semibold', color: WH, opacity: 0.8 })], { w: 62, h: 62, align: 'CENTER', cross: 'CENTER', gap: 0 });
  place(f, inner, 5, 5);
  return f;
}
function lockRect(kind) {
  let kids;
  const line = (time, text) => fillW(H([T(tm(time), { size: 12, w: 'bold', color: WH, lh: 15 }), grow(T(text, { size: 12, w: 'medium', color: WH, lines: 1, lh: 15 }))], { gap: 6 }));
  if (kind === 'timetable') {
    kids = [H([I('calendar', 11, WH, { opacity: 0.8 }), T('الأحد · 3 متبقية', { size: 11, w: 'semibold', color: WH, opacity: 0.8, lh: 14 })], { gap: 4 }), line('10:00', 'التفاضل والتكامل 2'), line('12:00', 'الفيزياء العامة 1'), line('2:00', 'مهارات اللغة الإنجليزية')];
  } else if (kind === 'countdown') {
    kids = [H([I('clock', 12, WH), T('بعد 19 دقيقة', { size: 12, w: 'bold', color: WH })], { gap: 4 }), fillW(T('التفاضل والتكامل 2', { size: 15, w: 'bold', color: WH, lines: 1 })), fillW(T(tm('10:00') + ' · مبنى 3 · 105', { size: 12, color: WH, opacity: 0.8, lines: 1 }))];
  } else {
    const tl = (t) => fillW(H([E(10, null, { stroke: WH, strokeW: 1.4 }), grow(T(t, { size: 12, w: 'medium', color: WH, lines: 1, lh: 15 }))], { gap: 6 }));
    kids = [H([I('checkCircle', 11, WH, { opacity: 0.8 }), T('مهامي · 3 متبقية', { size: 11, w: 'semibold', color: WH, opacity: 0.8, lh: 14 })], { gap: 4 }), tl('حل واجب الفصل الثالث'), tl('تسليم تقرير المعمل'), tl('طباعة ملخص المراجعة')];
  }
  return V(kids, { name: 'قفل · مستطيل · ' + kind, w: 172, h: 76, gap: 1, align: 'CENTER', clip: true });
}
function lockInline(text, icon) {
  return H([I(icon, 14, WH), T(text, { size: 15, w: 'semibold', color: WH })], { name: 'قفل · سطري', gap: 5 });
}

// ---------- device mocks ----------
function statusBar(w, color, android) {
  const f = figma.createFrame(); f.name = 'status-bar'; f.resize(w, 44); f.fills = [];
  place(f, T(android ? '9:41' : '9:41', { size: 15, w: 'semibold', color, font: { family: 'Inter', style: 'Semi Bold' }, align: 'LEFT' }), android ? 22 : 40, android ? 12 : 15);
  const bat = figma.createFrame(); bat.name = 'battery'; bat.resize(25, 12); bat.cornerRadius = 3.5; bat.fills = []; bat.strokes = [solid(color, 0.5)]; bat.strokeWeight = 1;
  place(bat, R(19, 8, color, { radius: 2 }), 3, 2);
  place(f, bat, w - (android ? 46 : 54), android ? 15 : 18);
  return f;
}
function appIcon(s, fill, op, radius) { return R(s, s, fill, { opacity: op, radius }); }

function iphoneHome(M) {
  const f = figma.createFrame();
  f.name = 'iPhone · الشاشة الرئيسية · ' + M.label; f.resize(402, 874); f.cornerRadius = 54; f.clipsContent = true;
  f.fills = [grad(M.board[0], M.board[1])];
  const fg = M.key === 'light' ? '#1B2533' : '#FFFFFF';
  place(f, statusBar(402, fg), 0, 8);
  place(f, timetable(IOS.M, P_IOS, M), 19, 70);
  place(f, countdown(IOS.S, P_IOS, M), 213, 262);
  place(f, tasks(IOS.S, P_IOS, M), 19, 262);
  const iconFill = M.key === 'light' ? '#FFFFFF' : '#FFFFFF';
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) place(f, appIcon(62, iconFill, M.key === 'light' ? 0.6 : 0.16, 15), 27 + c * 92, 470 + r * 98);
  const dots = H([E(7, fg, { opacity: 0.9 }), E(7, fg, { opacity: 0.35 })], { gap: 8 });
  place(f, dots, 186, 690);
  const dock = R(370, 92, '#FFFFFF', { opacity: M.key === 'light' ? 0.35 : 0.12, radius: 36 }); place(f, dock, 16, 762);
  for (let c = 0; c < 4; c++) place(f, appIcon(62, iconFill, M.key === 'light' ? 0.75 : 0.2, 15), 27 + c * 92, 777);
  return f;
}
function iphoneLock(variant) {
  const f = figma.createFrame();
  f.name = 'iPhone · شاشة القفل · ' + variant; f.resize(402, 874); f.cornerRadius = 54; f.clipsContent = true;
  f.fills = [grad(variant === 1 ? '#0E5466' : '#3A2A55', variant === 1 ? '#13233B' : '#0F1A2C')];
  place(f, statusBar(402, WH), 0, 8);
  place(f, I('lock', 18, WH), 192, 58);
  const inline = variant === 1 ? H([T('الأحد 22', { size: 15, w: 'semibold', color: WH }), lockInline('التفاضل والتكامل 2 · ' + tm('10:00'), 'clock')], { gap: 10 }) : H([T('الأحد 22', { size: 15, w: 'semibold', color: WH }), lockInline('3 مهام متبقية', 'checkCircle')], { gap: 10 });
  place(f, inline, 0, 92); inline.x = (402 - inline.width) / 2;
  const clock = T('9:41', { size: 104, w: 'bold', color: WH, align: 'CENTER', width: 402, lh: 120 });
  place(f, clock, 0, 108);
  const row = variant === 1 ? H([lockRect('timetable'), lockCircle('countdown'), lockCircle('tasks')], { gap: 10, cross: 'CENTER' }) : H([lockRect('countdown'), lockRect('tasks')], { gap: 10, cross: 'CENTER' });
  place(f, row, 0, 248); row.x = (402 - row.width) / 2;
  place(f, H([I('flashlight', 22, WH)], { w: 50, h: 50, radius: 25, fill: '#000000', fillOpacity: 0.35, align: 'CENTER', cross: 'CENTER' }), 46, 764);
  place(f, H([I('camera', 22, WH)], { w: 50, h: 50, radius: 25, fill: '#000000', fillOpacity: 0.35, align: 'CENTER', cross: 'CENTER' }), 306, 764);
  place(f, R(140, 5, WH, { radius: 3 }), 131, 852);
  return f;
}
function androidHome(M) {
  const f = figma.createFrame();
  f.name = 'Android · الشاشة الرئيسية · ' + M.label; f.resize(412, 915); f.cornerRadius = 40; f.clipsContent = true;
  f.fills = [grad(M.board[0], M.board[1])];
  const fg = M.key === 'light' ? '#1B2533' : '#FFFFFF';
  place(f, statusBar(412, fg, true), 0, 4);
  place(f, timetable(AND['4x2'], P_AND, M), 26, 84);
  place(f, countdown(AND['2x2'], P_AND, M), 214, 288);
  place(f, tasks(AND['2x2'], P_AND, M), 26, 288);
  for (let c = 0; c < 4; c++) place(f, appIcon(58, '#FFFFFF', M.key === 'light' ? 0.7 : 0.18, 29), 36 + c * 92, 700);
  const search = H([I('search', 20, M.muted), spacer()], { w: 364, h: 54, radius: 27, px: 18, fill: M.key === 'light' ? '#FFFFFF' : '#26313D', fillOpacity: 0.9 });
  place(f, search, 24, 806);
  place(f, R(108, 4, fg, { radius: 2, opacity: 0.6 }), 152, 892);
  return f;
}

// ---------- boards ----------
let PAGE = null;
let Y = 0;
function item(node, cap, color) { return V([node, T(cap, { size: 13, w: 'medium', color, align: 'CENTER' })], { name: 'item', gap: 10, cross: 'CENTER' }); }
function board(title, sub, rows, M) {
  const kids = [T(title, { size: 30, w: 'bold', color: M.boardText }), sub ? T(sub, { size: 15, color: M.boardMuted, width: 1400 }) : null];
  for (const r of rows) {
    kids.push(R(10, 8, null));
    kids.push(T(r.label, { size: 19, w: 'bold', color: M.boardText }));
    kids.push(H(r.items.map(([n, cap]) => item(n, cap, M.boardMuted)), { gap: 36, cross: 'MIN' }));
  }
  const b = V(kids, { name: title, pad: 56, gap: 18, radius: 36 });
  b.fills = [grad(M.board[0], M.board[1])];
  PAGE.appendChild(b);
  b.x = -b.width; b.y = Y; // RTL: boards share a right edge at x = 0
  Y += b.height + 120;
  return b;
}

function sCover() {
  const M = MODES.light;
  const notes = [
    'ثلاث ودجات: الجدول (محاضرات اليوم)، مهامي، المحاضرة القادمة.',
    'iOS: صغير 170×170، متوسط 364×170، كبير 364×382، كبير جدًا للآيباد 724×340، وشاشة القفل (دائري 72×72، مستطيل 172×76، سطري). المقاسات لآيفون بعرض 402 نقطة وتختلف قليلًا حسب الجهاز.',
    'Android: الودجات قابلة لتغيير الحجم، ورُسمت عند 2×1 و4×1 و2×2 و4×2 و4×4.',
    'الأوضاع: فاتح وداكن وملوّن (Tinted) في iOS، وفاتح وداكن بألوان التطبيق في Android. لون الوضع الملوّن يختاره المستخدم، والكهرماني هنا مثال فقط.',
    'التفاعل: الضغط على دائرة المهمة يُنجزها من الودجت مباشرة دون فتح التطبيق. زر + يفتح «مهمة جديدة». الضغط على محاضرة يفتح الجدول.',
    'بعد انتهاء محاضرات اليوم (أو في يوم بلا محاضرات) يعرض الجدول رسالة «لا محاضرات متبقية اليوم».',
    'البيانات من الشُّعب التجريبية في التطبيق، والوقت المفترض: الأحد 22 نوفمبر، الساعة 9:41 صباحًا.',
  ];
  const kids = [T('ودجات QU Student', { size: 40, w: 'bold', color: M.boardText }), T('تصاميم iOS وAndroid بعدة مقاسات · عربي', { size: 18, color: M.boardMuted })];
  for (const n of notes) kids.push(H([E(8, M.accent), T(n, { size: 16, color: M.boardText, width: 1100, lh: 28 })], { gap: 12, cross: 'MIN' }));
  const b = V(kids, { name: 'ملاحظات', pad: 56, gap: 16, radius: 36, fill: '#FFFFFF' });
  PAGE.appendChild(b); b.x = -b.width; b.y = Y; Y += b.height + 120;
}
function sOverview() {
  board('نظرة عامة على الشاشات', 'الودجات كما تظهر على الشاشة الرئيسية وشاشة القفل.', [
    { label: 'iPhone', items: [[iphoneHome(MODES.light), 'فاتح'], [iphoneHome(MODES.dark), 'داكن'], [iphoneHome(MODES.tinted), 'ملوّن (Tinted)'], [iphoneLock(1), 'شاشة القفل · 1'], [iphoneLock(2), 'شاشة القفل · 2']] },
    { label: 'Android', items: [[androidHome(MODES.light), 'فاتح'], [androidHome(MODES.dark), 'داكن']] },
  ], MODES.light);
}
function iosBoard(M) {
  return () => board('iOS · ' + M.label, null, [
    { label: 'الجدول', items: ['S', 'M', 'L', 'XL'].map((k) => [timetable(IOS[k], P_IOS, M), IOS[k].cap]) },
    { label: 'مهامي', items: ['S', 'M', 'L', 'XL'].map((k) => [tasks(IOS[k], P_IOS, M), IOS[k].cap]) },
    { label: 'المحاضرة القادمة', items: [[countdown(IOS.S, P_IOS, M), IOS.S.cap], [countdown(IOS.S, P_IOS, M, 'now'), IOS.S.cap + ' · أثناء المحاضرة'], [countdown(IOS.M, P_IOS, M), IOS.M.cap], [countdown(IOS.M, P_IOS, M, 'now'), IOS.M.cap + ' · أثناء المحاضرة']] },
  ], M);
}
function sIosEmpty() {
  const rows = [];
  for (const M of [MODES.light, MODES.dark]) {
    rows.push({ label: 'الجدول بعد انتهاء محاضرات اليوم · ' + M.label, items: ['S', 'M', 'L'].map((k) => [timetable(IOS[k], P_IOS, M, 'none'), IOS[k].cap]) });
    rows.push({ label: 'مهامي بعد إنجاز كل مهام اليوم · ' + M.label, items: ['S', 'M', 'L'].map((k) => [tasks(IOS[k], P_IOS, M, 'done'), IOS[k].cap]) });
  }
  board('iOS · حالات فارغة', 'تظهر عند انتهاء محاضرات اليوم أو في أيام بلا محاضرات، وعند إنجاز كل المهام.', rows, MODES.light);
}
function sLock() {
  const M = { boardText: '#FFFFFF', boardMuted: '#C9D6E2', board: ['#0E5466', '#13233B'] };
  board('iOS · شاشة القفل', 'ودجات أحادية اللون، يلوّنها النظام حسب الخلفية.', [
    { label: 'دائري · ' + tm('72×72'), items: [[lockCircle('countdown'), 'المحاضرة القادمة'], [lockCircle('tasks'), 'مهامي'], [lockCircle('timetable'), 'الجدول']] },
    { label: 'مستطيل · ' + tm('172×76'), items: [[lockRect('timetable'), 'الجدول'], [lockRect('countdown'), 'المحاضرة القادمة'], [lockRect('tasks'), 'مهامي']] },
    { label: 'سطري (فوق الساعة)', items: [[lockInline('التفاضل والتكامل 2 · ' + tm('10:00'), 'clock'), 'المحاضرة القادمة'], [lockInline('3 مهام متبقية', 'checkCircle'), 'مهامي'], [lockInline('3 محاضرات متبقية', 'calendar'), 'الجدول']] },
  ], M);
}
function andBoard(M) {
  return () => board('Android · ' + M.label, 'الودجات قابلة لتغيير الحجم؛ هذه المقاسات الأساسية.', [
    { label: 'الجدول', items: ['2x2', '4x2', '4x4'].map((k) => [timetable(AND[k], P_AND, M), AND[k].cap]) },
    { label: 'مهامي', items: ['2x2', '4x2', '4x4'].map((k) => [tasks(AND[k], P_AND, M), AND[k].cap]) },
    { label: 'المحاضرة القادمة', items: [[countdown(AND['2x1'], P_AND, M), AND['2x1'].cap], [countdown(AND['4x1'], P_AND, M), AND['4x1'].cap], [countdown(AND['2x2'], P_AND, M), AND['2x2'].cap], [countdown(AND['4x2'], P_AND, M), AND['4x2'].cap]] },
  ], M);
}
function sAndEmpty() {
  const rows = [];
  for (const M of [MODES.light, MODES.dark]) {
    rows.push({ label: 'الجدول بعد انتهاء محاضرات اليوم · ' + M.label, items: ['2x2', '4x2', '4x4'].map((k) => [timetable(AND[k], P_AND, M, 'none'), AND[k].cap]) });
    rows.push({ label: 'مهامي · لا مهام متبقية · ' + M.label, items: ['2x2', '4x2', '4x4'].map((k) => [tasks(AND[k], P_AND, M, 'done'), AND[k].cap]) });
  }
  board('Android · حالات فارغة', null, rows, MODES.light);
}

async function main() {
  await setupFonts();
  let page = figma.root.children.find((p) => p.name === PAGE_NAME);
  if (!page) {
    const first = figma.root.children[0];
    await first.loadAsync();
    if (figma.root.children.length === 1 && first.children.length === 0) { page = first; page.name = PAGE_NAME; }
    else { page = figma.createPage(); page.name = PAGE_NAME; }
  }
  await figma.setCurrentPageAsync(page);
  await page.loadAsync();
  for (const n of [...page.children]) n.remove();
  PAGE = page; Y = 0;
  const steps = [sCover, sOverview, iosBoard(MODES.light), iosBoard(MODES.dark), iosBoard(MODES.tinted), sIosEmpty, sLock, andBoard(MODES.light), andBoard(MODES.dark), sAndEmpty];
  const errors = [];
  for (let i = 0; i < steps.length; i++) {
    try { steps[i](); } catch (e) { errors.push('step ' + i + ': ' + (e && e.message ? e.message : String(e))); }
  }
  figma.viewport.scrollAndZoomIntoView(page.children);
  figma.closePlugin(errors.length ? ('Errors: ' + errors.join(' | ')).slice(0, 380) : `Done: ${steps.length} boards · font: ${FAM}`);
}

main().catch((e) => figma.closePlugin('Failed: ' + (e && e.message ? e.message : String(e))));
