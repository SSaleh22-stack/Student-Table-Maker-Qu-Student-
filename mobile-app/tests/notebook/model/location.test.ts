import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { decodeLoc, encodeLoc, locationFields, locationOf, sameLoc, sectionKeyOf, newId, ID_PATTERN } from '../../../src/notebook/core/model/index.ts';
import type { LocationKey } from '../../../src/notebook/core/model/index.ts';

describe('location codec', () => {
  const all: LocationKey[] = [{ kind: 'course', code: 'CS102' }, { kind: 'course', code: 'MATH 101:A' }, { kind: 'folder', id: 'f1x' }, { kind: 'unfiled' }];

  test('encode and decode round trip', () => {
    for (const l of all) assert.deepEqual(decodeLoc(encodeLoc(l)), l);
    assert.equal(encodeLoc({ kind: 'course', code: 'CS102' }), 'course:CS102');
    assert.equal(encodeLoc({ kind: 'folder', id: 'abc' }), 'folder:abc');
    assert.equal(encodeLoc({ kind: 'unfiled' }), 'unfiled');
  });

  test('bad strings decode to null', () => {
    for (const s of ['', 'course:', 'folder:  ', 'mine', 'courses', ':x', 'other:1', 'Unfiled']) assert.equal(decodeLoc(s), null, s);
  });

  test('sameLoc and sectionKeyOf', () => {
    assert.ok(sameLoc({ kind: 'course', code: 'A' }, { kind: 'course', code: 'A' }));
    assert.ok(!sameLoc({ kind: 'course', code: 'A' }, { kind: 'folder', id: 'A' }));
    assert.ok(!sameLoc({ kind: 'folder', id: 'A' }, { kind: 'folder', id: 'B' }));
    assert.ok(sameLoc({ kind: 'unfiled' }, { kind: 'unfiled' }));
    assert.ok(sameLoc(null, null));
    assert.ok(!sameLoc(null, { kind: 'unfiled' }));
    assert.equal(sectionKeyOf({ kind: 'course', code: 'CS102' }), 'course:CS102');
    assert.equal(sectionKeyOf({ kind: 'folder', id: 'f' }), 'folder:f');
    assert.equal(sectionKeyOf({ kind: 'unfiled' }), 'unfiled');
  });

  test('locationOf and locationFields', () => {
    assert.deepEqual(locationOf({ folderId: 'f', courseCode: 'X' }), { kind: 'folder', id: 'f' });
    assert.deepEqual(locationOf({ courseCode: 'X' }), { kind: 'course', code: 'X' });
    assert.deepEqual(locationOf({}), { kind: 'unfiled' });
    for (const l of all) assert.deepEqual(locationOf(locationFields(l)), l);
  });
});

describe('ids', () => {
  test('newId is 16 file-safe chars, from crypto or the injected random', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = newId();
      assert.match(id, ID_PATTERN);
      seen.add(id);
    }
    assert.equal(seen.size, 1000);
    let k = 0;
    const seq = () => (k++ % 32) / 32;
    assert.equal(newId(seq), 'abcdefghijklmnop');
    assert.match(newId(() => Number.NaN), ID_PATTERN);
    assert.match(newId(() => 0.999999), ID_PATTERN);
  });
});
