import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CURRENT_VERSION, MIGRATIONS, migrate, versionOf } from '../../../src/notebook/core/model/migrate.ts';
import { readNotebookFile } from '../../../src/notebook/core/model/readers.ts';

describe('migrate', () => {
  test('version 1 is the identity', () => {
    assert.equal(CURRENT_VERSION, 1);
    const raw = { format: 'qu-notebook', version: 1, id: 'a' };
    const m = migrate(raw);
    assert.equal(m.raw, raw);
    assert.equal(m.readOnly, false);
    assert.deepEqual(Object.keys(MIGRATIONS), []);
  });

  test('a missing or malformed version counts as 1', () => {
    assert.equal(versionOf({}), 1);
    assert.equal(versionOf({ version: '2' }), 1);
    assert.equal(versionOf({ version: 1.5 }), 1);
    assert.equal(versionOf({ version: 0 }), 1);
    assert.equal(migrate({ version: 'x' }).readOnly, false);
  });

  test('a newer version is readOnly and still readable best effort', () => {
    const raw = { format: 'qu-notebook', version: 2, rev: 4, id: 'nb', title: 'من تطبيق أحدث', pageIds: ['p1'], futureField: { a: 1 }, $: 'end' };
    const m = migrate(raw);
    assert.equal(m.readOnly, true);
    assert.equal(m.raw, raw);
    const nb = readNotebookFile(m.raw);
    assert.ok(nb);
    assert.equal(nb.title, 'من تطبيق أحدث');
    assert.deepEqual(nb.pageIds, ['p1']);
    assert.ok(!('futureField' in nb));
  });
});
