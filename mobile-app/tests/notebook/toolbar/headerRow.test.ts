import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BAR,
  FRAME,
  barLength,
  barThickness,
  chooseBarLayout,
  editorFrames,
  MEDIUM_MIN_BUTTON,
  type Insets,
} from '../../../src/notebook/core/toolbar/dock.ts';

const INSETS: Insets = { top: 24, bottom: 20, left: 0, right: 0 };
const T = barThickness();
// Room of the back button and the pages / share / more pill (EditorHeader.headerReserve(40)).
const START = 16 + 40 + 12;
const END = 16 + 8 + 120 + 4 + 12;

describe('top toolbar in the header row (tablets)', () => {
  test('portrait iPad: the bar sits between the header buttons, centered on the header band', () => {
    const screen = { width: 820, height: 1180 };
    // Arabic: back on the physical right, the pill on the left.
    const f = editorFrames({ screen, insets: INSETS, toolbarPos: 'top', barThickness: T, dock: null, headerReserve: { left: END, right: START } });
    assert.equal(f.pos, 'top');
    assert.equal(f.toolbar.x, END);
    assert.equal(f.toolbar.width, screen.width - END - START);
    assert.equal(f.toolbar.y + f.toolbar.height / 2, INSETS.top + FRAME.header / 2);
    // The page starts right under the header band: no extra row for the bar.
    assert.equal(f.canvasInsets.top, INSETS.top + FRAME.header);
  });

  test('a full-height calculator on the left: the header row starts at its inner edge', () => {
    const screen = { width: 1180, height: 820 };
    const reserve = { left: END, right: START };
    const docked = editorFrames({ screen, insets: INSETS, toolbarPos: 'top', barThickness: T, dock: { side: 'left', width: 360 }, headerReserve: reserve });
    assert.equal(docked.toolbar.x, 360 + END);
    assert.equal(docked.toolbar.width, screen.width - 360 - END - START);
    assert.equal(docked.toolbar.y + docked.toolbar.height / 2, INSETS.top + FRAME.header / 2);
    assert.equal(docked.canvasInsets.left, 360);
    assert.equal(docked.canvasInsets.top, INSETS.top + FRAME.header);
  });

  test('portrait iPad with the calculator: the row is too short, so the bar keeps its own row', () => {
    const screen = { width: 820, height: 1180 };
    const f = editorFrames({ screen, insets: INSETS, toolbarPos: 'top', barThickness: T, dock: { side: 'left', width: 360 }, headerReserve: { left: END, right: START } });
    assert.equal(f.toolbar.y, INSETS.top + FRAME.header);
    assert.equal(f.toolbar.x, 360);
    assert.equal(f.toolbar.width, screen.width - 360);
    assert.equal(f.canvasInsets.top, INSETS.top + FRAME.header + T);
  });

  test('other positions and phones are unchanged', () => {
    const screen = { width: 820, height: 1180 };
    const bottom = editorFrames({ screen, insets: INSETS, toolbarPos: 'bottom', barThickness: T, dock: null, headerReserve: { left: END, right: START } });
    const plain = editorFrames({ screen, insets: INSETS, toolbarPos: 'bottom', barThickness: T, dock: null });
    assert.deepEqual(bottom, plain);
    const top = editorFrames({ screen, insets: INSETS, toolbarPos: 'top', barThickness: T, dock: null });
    assert.equal(top.toolbar.y, INSETS.top + FRAME.header);
    assert.equal(top.canvasInsets.top, INSETS.top + FRAME.header + T);
  });
});

describe('bar layouts', () => {
  test('medium is the full bar without the five color dots', () => {
    // Five dots, one separator and the six gaps around them.
    assert.equal(barLength('full') - barLength('medium'), 5 * 30 + 1 + 6 * BAR.gap);
  });

  test('a portrait iPad header row gets the medium bar, landscape the full bar, a phone the compact bar', () => {
    assert.equal(chooseBarLayout(820 - START - END, false), 'medium');
    assert.equal(chooseBarLayout(744 - START - END, false), 'medium');
    assert.equal(chooseBarLayout(1180 - START - END, false), 'full');
    assert.equal(chooseBarLayout(2000, true), 'compact');
    assert.equal(chooseBarLayout(barLength('medium', { button: MEDIUM_MIN_BUTTON }) - 1, false), 'compact');
  });
});
