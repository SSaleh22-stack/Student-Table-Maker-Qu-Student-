import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DARK_PAPER_INK,
  HL_PALETTE,
  PEN_PALETTE,
  addCustomColor,
  colorName,
  effectivePenColor,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hueColor,
  isLightColor,
  luminance,
  normalizeHex,
  penPalette,
  sameColor,
} from '../../../src/notebook/core/toolbar/colors.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('effectivePenColor (NB-21)', () => {
  test('dark paper turns the default black pen light', () => {
    assert.equal(effectivePenColor('#1B2533', 'dark'), DARK_PAPER_INK);
    assert.equal(effectivePenColor('#000000', 'dark'), DARK_PAPER_INK);
  });

  test('white and cream paper keep the stored color', () => {
    assert.equal(effectivePenColor('#1B2533', 'white'), '#1B2533');
    assert.equal(effectivePenColor('#1B2533', 'cream'), '#1B2533');
    assert.equal(effectivePenColor('#F1F5F9', 'white'), '#F1F5F9');
  });

  test('colored pens stay as they are on dark paper', () => {
    for (const c of ['#1D4ED8', '#DC2626', '#15803D', '#0E7490']) assert.equal(effectivePenColor(c, 'dark'), c);
  });

  test('penPalette swaps only the black swatch on dark paper', () => {
    assert.deepEqual(penPalette('white'), [...PEN_PALETTE]);
    const dark = penPalette('dark');
    assert.equal(dark[0], DARK_PAPER_INK);
    assert.deepEqual(dark.slice(1), PEN_PALETTE.slice(1));
  });
});

describe('palettes match src/notebook/theme.ts', () => {
  test('PEN_COLORS, HL_COLORS and DARK_PAPER_PEN', () => {
    const theme = fs.readFileSync(path.join(here, '../../../src/notebook/theme.ts'), 'utf8');
    const list = (name: string) => {
      const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(theme);
      assert.ok(m, name);
      return [...m[1].matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map((x) => x[1]);
    };
    assert.deepEqual(list('PEN_COLORS'), [...PEN_PALETTE]);
    assert.deepEqual(list('HL_COLORS'), [...HL_PALETTE]);
    assert.match(theme, new RegExp(`DARK_PAPER_PEN = '${DARK_PAPER_INK}'`));
  });
});

describe('hex and HSV', () => {
  test('normalizeHex', () => {
    assert.equal(normalizeHex('#0e7490'), '#0E7490');
    assert.equal(normalizeHex(' 0e7490 '), '#0E7490');
    assert.equal(normalizeHex('#abc'), '#AABBCC');
    assert.equal(normalizeHex('fff'), '#FFFFFF');
    assert.equal(normalizeHex('#12345'), null);
    assert.equal(normalizeHex('#GGGGGG'), null);
    assert.equal(normalizeHex(''), null);
  });

  test('hexToRgb', () => {
    assert.deepEqual(hexToRgb('#0E7490'), { r: 14, g: 116, b: 144 });
    assert.deepEqual(hexToRgb('#0E749080'), { r: 14, g: 116, b: 144 });
    assert.equal(hexToRgb('0E7490'), null);
  });

  test('primary colors', () => {
    assert.deepEqual(hexToHsv('#FF0000'), { h: 0, s: 1, v: 1 });
    assert.deepEqual(hexToHsv('#00FF00'), { h: 120, s: 1, v: 1 });
    assert.deepEqual(hexToHsv('#0000FF'), { h: 240, s: 1, v: 1 });
    assert.deepEqual(hexToHsv('#000000'), { h: 0, s: 0, v: 0 });
    assert.deepEqual(hexToHsv('#FFFFFF'), { h: 0, s: 0, v: 1 });
    assert.equal(hsvToHex({ h: 60, s: 1, v: 1 }), '#FFFF00');
    assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), '#FF0000');
    assert.equal(hsvToHex({ h: -120, s: 1, v: 1 }), '#0000FF');
    assert.equal(hueColor(180), '#00FFFF');
  });

  test('round trip for every palette color and a sweep', () => {
    const samples = [...PEN_PALETTE, ...HL_PALETTE, DARK_PAPER_INK, '#7F3FBF', '#123456', '#FEDCBA', '#808080'];
    for (const hex of samples) assert.equal(hsvToHex(hexToHsv(hex)), hex.toUpperCase(), hex);
    for (let i = 0; i < 4096; i += 37) {
      const hex =
        '#' +
        [i % 16, (i >> 4) % 16, (i >> 8) % 16]
          .map((n) => (n * 17).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
      assert.equal(hsvToHex(hexToHsv(hex)), hex, hex);
    }
  });

  test('out-of-range HSV is clamped', () => {
    assert.equal(hsvToHex({ h: 0, s: 2, v: -1 }), '#000000');
    assert.equal(hsvToHex({ h: Number.NaN, s: 0, v: 1 }), '#FFFFFF');
  });

  test('luminance and light colors', () => {
    assert.equal(luminance('#000000'), 0);
    assert.ok(Math.abs(luminance('#FFFFFF') - 1) < 1e-9);
    assert.ok(luminance('#1B2533') < 0.06);
    assert.ok(luminance('#1D4ED8') > 0.06);
    assert.equal(isLightColor('#FDE047'), true);
    assert.equal(isLightColor('#1B2533'), false);
  });
});

describe('custom colors', () => {
  test('newest first, no duplicates, capped', () => {
    assert.deepEqual(addCustomColor([], '#7f3fbf'), ['#7F3FBF']);
    assert.deepEqual(addCustomColor(['#111111', '#7F3FBF'], '#7f3fbf'), ['#7F3FBF', '#111111']);
    const many = Array.from({ length: 30 }, (_, i) => '#' + (0x100000 + i).toString(16).toUpperCase());
    const out = addCustomColor(many, '#ABCDEF', 24);
    assert.equal(out.length, 24);
    assert.equal(out[0], '#ABCDEF');
  });

  test('palette colors and invalid input are not added', () => {
    assert.deepEqual(addCustomColor(['#111111'], '#0e7490'), ['#111111']);
    assert.deepEqual(addCustomColor(['#111111'], '#FDE047'), ['#111111']);
    assert.deepEqual(addCustomColor(['#111111'], 'nope'), ['#111111']);
    assert.deepEqual(addCustomColor(['#111111', 'bad' as never], '#222222'), ['#222222', '#111111']);
  });

  test('sameColor ignores case and an opaque alpha', () => {
    assert.equal(sameColor('#1b2533', '#1B2533FF'), true);
    assert.equal(sameColor('#1B2533', '#1B2534'), false);
  });

  test('colorName', () => {
    assert.equal(colorName('#1D4ED8', 'ar'), 'أزرق');
    assert.equal(colorName('#0E7490', 'en'), 'Teal');
    assert.equal(colorName('#FDE047', 'ar'), 'أصفر');
    assert.equal(colorName(DARK_PAPER_INK, 'ar'), 'أبيض');
    assert.equal(colorName('#7f3fbf', 'en'), 'Color #7F3FBF');
  });
});
