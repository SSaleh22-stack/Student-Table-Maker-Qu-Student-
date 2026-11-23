import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_SETTINGS, HL_WIDTHS, PEN_PRESET_DEFAULT_NAMES, PEN_WIDTHS, deepMerge, defaultsFor, readSettings } from '../../../src/notebook/core/model/index.ts';
import type { DeepPartial, NotebookSettings } from '../../../src/notebook/core/model/index.ts';

describe('defaults', () => {
  test('tablets: pen input; phones: finger with finger drawing on', () => {
    const tab = defaultsFor(true);
    assert.equal(tab.input, 'pen');
    assert.equal(tab.fingerDraws, false);
    const phone = defaultsFor(false);
    assert.equal(phone.input, 'finger');
    assert.equal(phone.fingerDraws, true);
    assert.deepEqual(DEFAULT_SETTINGS, tab);
  });

  test('skip-setup defaults: right hand, double tap to eraser, lined white A4, toolbar on top, backup off', () => {
    const s = defaultsFor(true);
    assert.equal(s.hand, 'right');
    assert.equal(s.pencilDoubleTap, 'eraser');
    assert.equal(s.pencilSqueeze, 'eraser');
    assert.deepEqual(s.defaultPaper, { style: 'lined', color: 'white', size: 'a4' });
    assert.equal(s.toolbarPos, 'top');
    assert.equal(s.shapeSnap, true);
    assert.equal(s.pressure, true);
    assert.deepEqual(s.backup, { enabled: false, wifiOnly: true });
    assert.deepEqual(s.tours, { library: 'unseen', setup: 'unseen', editor: 'unseen' });
    assert.equal(s.eraser.mode, 'stroke');
    assert.equal(s.pen.presets.length, 3);
    assert.equal(PEN_PRESET_DEFAULT_NAMES[0].ar, 'أزرق ناعم');
    assert.equal(PEN_WIDTHS.length, 5);
    assert.equal(HL_WIDTHS.length, 5);
  });

  test('defaultsFor returns fresh copies', () => {
    const a = defaultsFor(true);
    a.pen.presets[0].color = '#000000';
    a.customColors.push('#FFFFFF');
    assert.notEqual(defaultsFor(true).pen.presets[0].color, '#000000');
    assert.deepEqual(defaultsFor(true).customColors, []);
  });
});

describe('deepMerge', () => {
  test('nested objects merge, arrays are replaced, undefined is skipped', () => {
    const base = { a: { b: 1, c: { d: 2, e: 3 } }, list: [1, 2, 3], keep: 'x' };
    const out = deepMerge(base, { a: { c: { d: 9 } }, list: [7], keep: undefined });
    assert.deepEqual(out, { a: { b: 1, c: { d: 9, e: 3 } }, list: [7], keep: 'x' });
    // The base is unchanged and the result shares no objects with it.
    assert.deepEqual(base, { a: { b: 1, c: { d: 2, e: 3 } }, list: [1, 2, 3], keep: 'x' });
    assert.notEqual(out.a, base.a);
  });

  test('a stale patch does not clobber sibling fields: setSettings({calc:{float}}) after setSettings({calc:{open:true}})', () => {
    // The store merges every patch into the LATEST state at write time.
    let latest = defaultsFor(true);
    const setSettings = (patch: DeepPartial<NotebookSettings>) => {
      latest = deepMerge(latest, patch);
    };
    setSettings({ calc: { open: true } });
    setSettings({ calc: { float: { x: 300, y: 40 } } });
    assert.equal(latest.calc.open, true);
    assert.equal(latest.calc.docked, true);
    assert.deepEqual(latest.calc.float, { x: 300, y: 40 });
  });

  test('tuples (pen presets) are replaced whole; null is a value', () => {
    const s = defaultsFor(true);
    const presets: NotebookSettings['pen']['presets'] = [
      { color: '#000000', width: 2, name: 'رفيع' },
      { color: '#111111', width: 3 },
      { color: '#222222', width: 5 },
    ];
    const out = deepMerge(s, { pen: { presets } });
    assert.deepEqual(out.pen.presets, presets);
    assert.equal(out.pen.widthIndex, s.pen.widthIndex);
    const withNull = deepMerge<{ a: { b: number | null } }>({ a: { b: 1 } }, { a: { b: null } });
    assert.equal(withNull.a.b, null);
  });

  test('ignores prototype keys', () => {
    const patch = JSON.parse('{"__proto__": {"polluted": true}, "x": 1}') as DeepPartial<{ x: number }>;
    const out = deepMerge({ x: 0 }, patch);
    assert.equal(out.x, 1);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
});

describe('readSettings', () => {
  test('a missing or broken save gives the device defaults', () => {
    assert.deepEqual(readSettings(null, true), defaultsFor(true));
    assert.deepEqual(readSettings('nope', false), defaultsFor(false));
    assert.deepEqual(readSettings({}, false), defaultsFor(false));
  });

  test('valid fields are kept and bad ones fall back one by one', () => {
    const s = readSettings(
      {
        version: 1,
        input: 'pen',
        hand: 'left',
        pencilDoubleTap: 'nonsense',
        toolbarPos: 'right',
        defaultPaper: { style: 'grid', color: 'purple' },
        pen: { color: '#DC2626', widthIndex: 9, presets: [{ color: '#000000', width: 2, name: 'ق'.repeat(60) }, { color: 'bad', width: 2 }, { color: '#0E7490', width: 4 }] },
        highlighter: { straight: false },
        eraser: { mode: 'pixel', size: 1000 },
        customColors: ['#abcdef', '#ABCDEF', 'x', '#12345678'],
        sort: 'name',
        backup: { enabled: true, wifiOnly: 'yes', lastBackupAt: '2026-11-20T08:00:00.000Z', lastCount: 3 },
        tours: { library: 'done', editor: 'later' },
        calc: { open: true, float: { x: 'a', y: 2 } },
      },
      false,
    );
    assert.equal(s.input, 'pen');
    assert.equal(s.fingerDraws, true);
    assert.equal(s.hand, 'left');
    assert.equal(s.pencilDoubleTap, 'eraser');
    assert.equal(s.toolbarPos, 'right');
    assert.deepEqual(s.defaultPaper, { style: 'grid', color: 'white', size: 'a4' });
    assert.equal(s.pen.color, '#DC2626');
    assert.equal(s.pen.widthIndex, 1);
    assert.equal(s.pen.presets[0].name?.length, 40);
    assert.deepEqual(s.pen.presets[1], defaultsFor(false).pen.presets[1]);
    assert.equal(s.pen.presets[2].color, '#0E7490');
    assert.equal(s.highlighter.straight, false);
    assert.equal(s.highlighter.color, '#FDE047');
    assert.equal(s.eraser.mode, 'pixel');
    assert.equal(s.eraser.size, 80);
    assert.deepEqual(s.customColors, ['#ABCDEF', '#12345678']);
    assert.equal(s.sort, 'name');
    assert.deepEqual(s.backup, { enabled: true, wifiOnly: true, lastBackupAt: '2026-11-20T08:00:00.000Z', lastCount: 3 });
    assert.deepEqual(s.tours, { library: 'done', setup: 'unseen', editor: 'unseen' });
    assert.deepEqual(s.calc, { open: true, docked: true, float: { x: 24, y: 120 } });
  });

  test('a preset name up to 40 characters is accepted as is', () => {
    const name = 'قلم المراجعة الأحمر'.padEnd(40, '.');
    const s = readSettings({ pen: { presets: [{ color: '#000000', width: 2, name }, { color: '#000000', width: 2 }, { color: '#000000', width: 2 }] } }, true);
    assert.equal(s.pen.presets[0].name, name);
    assert.equal(s.pen.presets[1].name, undefined);
  });

  test('round trips through JSON', () => {
    const s = deepMerge(defaultsFor(true), { hand: 'left', backup: { enabled: true, account: 'student@example.com' } });
    assert.deepEqual(readSettings(JSON.parse(JSON.stringify(s)), true), s);
  });
});
