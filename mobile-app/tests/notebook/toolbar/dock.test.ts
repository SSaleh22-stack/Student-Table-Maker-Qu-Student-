import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BAR,
  FRAME,
  allowedPositions,
  barFrame,
  barLength,
  barThickness,
  dropZones,
  editorFrames,
  effectiveToolbarPos,
  fitButtonSize,
  fitsInline,
  posIndex,
  zoneAt,
  type DockSpec,
  type EditorFrames,
  type Insets,
  type ToolbarPos,
} from '../../../src/notebook/core/toolbar/dock.ts';

// iPad 11" portrait (Figma screen size) with a status bar and a home indicator.
const SCREEN = { width: 834, height: 1194 };
const INSETS: Insets = { top: 24, bottom: 20, left: 0, right: 0 };
const T = barThickness();
const DOCK_W = 320;
const TOP = INSETS.top + FRAME.header; // 84, the Figma toolbar y
const BOTTOM = SCREEN.height - INSETS.bottom - FRAME.footer; // 1126

const frames = (pos: ToolbarPos, dock: DockSpec | null): EditorFrames =>
  editorFrames({ screen: SCREEN, insets: INSETS, toolbarPos: pos, barThickness: T, dock });

describe('bar metrics', () => {
  test('thickness is the button plus the side padding (Figma 54)', () => {
    assert.equal(T, 54);
    assert.equal(barThickness(36), 50);
  });

  test('the full bar fits an iPad width but not beside a docked calculator', () => {
    const full = barLength('full');
    assert.equal(full, 2 * 10 + 20 + 11 * 40 + 5 * 30 + 3 + 44 + 20 * 3);
    assert.ok(fitsInline(SCREEN.width));
    assert.ok(fitsInline(744)); // iPad mini portrait
    assert.equal(fitsInline(SCREEN.width - DOCK_W), false);
    assert.equal(fitsInline(full), true);
    assert.equal(fitsInline(full - 1), false);
    // A running recording makes the slot longer.
    assert.equal(fitsInline(full + 50, { recordSlot: BAR.record + 60 }), false);
  });

  test('the compact bar fits a 375 pt phone, shrinking buttons when needed', () => {
    assert.ok(barLength('compact') <= 375);
    assert.equal(fitButtonSize(400, 'compact'), BAR.compactButton);
    const b = fitButtonSize(359, 'compact');
    assert.ok(b < BAR.compactButton && b >= BAR.minButton);
    assert.ok(barLength('compact', { button: b }) <= 359);
    assert.equal(fitButtonSize(100, 'compact'), BAR.minButton);
    assert.equal(fitButtonSize(2000, 'full'), BAR.button);
  });
});

describe('editorFrames: 4 positions x {no dock, dock left, dock right}', () => {
  const left: DockSpec = { side: 'left', width: DOCK_W };
  const right: DockSpec = { side: 'right', width: DOCK_W };

  test('top, no dock: spans the screen under the header', () => {
    const f = frames('top', null);
    assert.equal(f.pos, 'top');
    assert.deepEqual(f.toolbar, { x: 0, y: TOP, width: SCREEN.width, height: T });
    assert.equal(f.dock, null);
    assert.deepEqual(f.canvasInsets, { top: TOP + T, bottom: INSETS.bottom, left: 0, right: 0 });
  });

  test('top, dock left: spans the canvas width beside the dock', () => {
    const f = frames('top', left);
    assert.deepEqual(f.dock, { x: 0, y: 0, width: DOCK_W, height: SCREEN.height });
    assert.deepEqual(f.toolbar, { x: DOCK_W, y: TOP, width: SCREEN.width - DOCK_W, height: T });
    assert.deepEqual(f.canvasInsets, { top: TOP + T, bottom: INSETS.bottom, left: DOCK_W, right: 0 });
  });

  test('top, dock right: spans the canvas width beside the dock', () => {
    const f = frames('top', right);
    assert.deepEqual(f.dock, { x: SCREEN.width - DOCK_W, y: 0, width: DOCK_W, height: SCREEN.height });
    assert.deepEqual(f.toolbar, { x: 0, y: TOP, width: SCREEN.width - DOCK_W, height: T });
    assert.deepEqual(f.canvasInsets, { top: TOP + T, bottom: INSETS.bottom, left: 0, right: DOCK_W });
  });

  test('bottom, no dock: above the page counter', () => {
    const f = frames('bottom', null);
    assert.deepEqual(f.toolbar, { x: 0, y: BOTTOM - T, width: SCREEN.width, height: T });
    assert.equal(f.dock, null);
    assert.deepEqual(f.canvasInsets, { top: TOP, bottom: SCREEN.height - (BOTTOM - T), left: 0, right: 0 });
  });

  test('bottom, dock left', () => {
    const f = frames('bottom', left);
    assert.deepEqual(f.toolbar, { x: DOCK_W, y: BOTTOM - T, width: SCREEN.width - DOCK_W, height: T });
    assert.deepEqual(f.canvasInsets, { top: TOP, bottom: SCREEN.height - (BOTTOM - T), left: DOCK_W, right: 0 });
  });

  test('bottom, dock right', () => {
    const f = frames('bottom', right);
    assert.deepEqual(f.toolbar, { x: 0, y: BOTTOM - T, width: SCREEN.width - DOCK_W, height: T });
    assert.deepEqual(f.canvasInsets, { top: TOP, bottom: SCREEN.height - (BOTTOM - T), left: 0, right: DOCK_W });
  });

  test('left, no dock: EDGE from the left edge (Figma 21: x 14, page side 68)', () => {
    const f = frames('left', null);
    assert.equal(f.pos, 'left');
    assert.deepEqual(f.toolbar, { x: FRAME.edge, y: TOP, width: T, height: BOTTOM - TOP });
    assert.equal(f.dock, null);
    assert.deepEqual(f.canvasInsets, { top: TOP, bottom: INSETS.bottom, left: FRAME.edge + T, right: 0 });
    assert.equal(f.canvasInsets.left, 68);
  });

  test("left, dock left: at the dock's inner edge (x = dock width)", () => {
    const f = frames('left', left);
    assert.deepEqual(f.dock, { x: 0, y: 0, width: DOCK_W, height: SCREEN.height });
    assert.equal(f.toolbar.x, DOCK_W);
    assert.deepEqual(f.toolbar, { x: DOCK_W, y: TOP, width: T, height: BOTTOM - TOP });
    assert.deepEqual(f.canvasInsets, { top: TOP, bottom: INSETS.bottom, left: DOCK_W + T, right: 0 });
  });

  test('left, dock right: bar at the left edge, dock on the right', () => {
    const f = frames('left', right);
    assert.deepEqual(f.toolbar, { x: FRAME.edge, y: TOP, width: T, height: BOTTOM - TOP });
    assert.deepEqual(f.dock, { x: SCREEN.width - DOCK_W, y: 0, width: DOCK_W, height: SCREEN.height });
    assert.deepEqual(f.canvasInsets, { top: TOP, bottom: INSETS.bottom, left: FRAME.edge + T, right: DOCK_W });
  });

  test('right, no dock: EDGE from the right edge (Figma 19)', () => {
    const f = frames('right', null);
    assert.deepEqual(f.toolbar, { x: SCREEN.width - FRAME.edge - T, y: TOP, width: T, height: BOTTOM - TOP });
    assert.equal(f.dock, null);
    assert.deepEqual(f.canvasInsets, { top: TOP, bottom: INSETS.bottom, left: 0, right: FRAME.edge + T });
  });

  test('right, dock left: bar at the right edge, dock on the left', () => {
    const f = frames('right', left);
    assert.deepEqual(f.toolbar, { x: SCREEN.width - FRAME.edge - T, y: TOP, width: T, height: BOTTOM - TOP });
    assert.deepEqual(f.dock, { x: 0, y: 0, width: DOCK_W, height: SCREEN.height });
    assert.deepEqual(f.canvasInsets, { top: TOP, bottom: INSETS.bottom, left: DOCK_W, right: FRAME.edge + T });
  });

  test("right, dock right: at the dock's inner edge", () => {
    const f = frames('right', right);
    assert.deepEqual(f.toolbar, { x: SCREEN.width - DOCK_W - T, y: TOP, width: T, height: BOTTOM - TOP });
    assert.deepEqual(f.dock, { x: SCREEN.width - DOCK_W, y: 0, width: DOCK_W, height: SCREEN.height });
    assert.deepEqual(f.canvasInsets, { top: TOP, bottom: INSETS.bottom, left: 0, right: DOCK_W + T });
  });

  test('every case keeps the bar inside the screen and clear of the dock', () => {
    for (const pos of ['top', 'bottom', 'left', 'right'] as const) {
      for (const dock of [null, left, right]) {
        const f = frames(pos, dock);
        const r = f.toolbar;
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= SCREEN.width && r.y + r.height <= SCREEN.height, `${pos}`);
        if (f.dock) {
          const overlap = r.x < f.dock.x + f.dock.width && f.dock.x < r.x + r.width;
          assert.equal(overlap, false, `${pos} ${dock?.side}`);
        }
      }
    }
  });

  test('safe-area insets on the sides are respected (landscape iPhone notch)', () => {
    const insets = { top: 0, bottom: 21, left: 47, right: 47 };
    const screen = { width: 932, height: 430 };
    const l = editorFrames({ screen, insets, toolbarPos: 'left', barThickness: T, dock: null });
    assert.equal(l.toolbar.x, 47 + FRAME.edge);
    const r = editorFrames({ screen, insets, toolbarPos: 'right', barThickness: T, dock: null });
    assert.equal(r.toolbar.x + r.toolbar.width, 932 - 47 - FRAME.edge);
    const t = editorFrames({ screen, insets, toolbarPos: 'top', barThickness: T, dock: null });
    assert.deepEqual([t.toolbar.x, t.toolbar.width], [47, 932 - 94]);
    assert.deepEqual([t.canvasInsets.left, t.canvasInsets.right], [47, 47]);
  });
});

describe('phone rules', () => {
  const phone = { width: 390, height: 844 };
  const phoneLandscape = { width: 844, height: 390 };

  test('vertical positions fall back to top on a portrait phone', () => {
    assert.equal(effectiveToolbarPos('left', phone), 'top');
    assert.equal(effectiveToolbarPos('right', phone), 'top');
    assert.equal(effectiveToolbarPos('bottom', phone), 'bottom');
    assert.equal(effectiveToolbarPos('left', phoneLandscape), 'left');
    assert.equal(effectiveToolbarPos('right', SCREEN), 'right');
    assert.deepEqual(allowedPositions(phone), ['top', 'bottom']);
    assert.deepEqual(allowedPositions(phoneLandscape), ['top', 'bottom', 'left', 'right']);
    const f = editorFrames({
      screen: phone,
      insets: { top: 47, bottom: 34, left: 0, right: 0 },
      toolbarPos: 'right',
      barThickness: 50,
      dock: null,
    });
    assert.equal(f.pos, 'top');
    assert.equal(f.toolbar.height, 50);
    assert.equal(f.toolbar.width, 390);
  });

  test('barFrame alone never applies the fallback', () => {
    const r = barFrame('left', { screen: phone, insets: INSETS, barThickness: 50, dock: null });
    assert.equal(r.width, 50);
  });
});

describe('drop zones', () => {
  const zones = dropZones(SCREEN, INSETS);

  test('Figma 18 layout: four zones, top and bottom wide, sides tall', () => {
    assert.ok(zones.top && zones.bottom && zones.left && zones.right);
    assert.equal(zones.top.x, 16);
    assert.equal(zones.top.width, SCREEN.width - 32);
    assert.equal(zones.left.x, 12);
    assert.equal(zones.right.x + zones.right.width, SCREEN.width - 12);
    assert.ok(zones.left.y > zones.top.y + zones.top.height);
    assert.ok(zones.left.y + zones.left.height < zones.bottom.y);
  });

  test('a portrait phone gets only top and bottom', () => {
    const z = dropZones({ width: 390, height: 844 }, INSETS);
    assert.deepEqual(Object.keys(z).sort(), ['bottom', 'top']);
  });

  test('a dock moves its side zone to the dock inner edge', () => {
    const z = dropZones(SCREEN, INSETS, { dock: { side: 'left', width: DOCK_W } });
    assert.equal(z.left?.x, DOCK_W + 12);
    assert.equal(z.top?.x, DOCK_W + 16);
  });

  test('zoneAt: inside a zone, else the nearest one', () => {
    assert.equal(zoneAt({ x: 400, y: 100 }, zones), 'top');
    assert.equal(zoneAt({ x: 400, y: 1100 }, zones), 'bottom');
    assert.equal(zoneAt({ x: 40, y: 600 }, zones), 'left');
    assert.equal(zoneAt({ x: 800, y: 600 }, zones), 'right');
    // Middle of the page, closer to the right zone.
    assert.equal(zoneAt({ x: 600, y: 600 }, zones), 'right');
    assert.equal(zoneAt({ x: 200, y: 600 }, zones), 'left');
    // Off screen above: top.
    assert.equal(zoneAt({ x: 400, y: -50 }, zones), 'top');
    const phoneZones = dropZones({ width: 390, height: 844 }, INSETS);
    assert.equal(zoneAt({ x: 10, y: 420 }, phoneZones) === 'left', false);
    assert.equal(zoneAt({ x: 10, y: 400 }, {}, 'bottom'), 'bottom');
  });

  test('posIndex', () => {
    assert.deepEqual(
      (['top', 'bottom', 'left', 'right', null] as const).map((p) => posIndex(p)),
      [0, 1, 2, 3, -1],
    );
  });
});
