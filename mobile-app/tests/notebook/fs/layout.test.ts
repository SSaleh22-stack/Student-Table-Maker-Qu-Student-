import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { baseName, dirName, joinPath } from '../../../src/notebook/core/fs/adapter.ts';
import { isNotebookDirName, nbLayout, safeExt } from '../../../src/notebook/core/fs/layout.ts';

describe('nbLayout', () => {
  test('posix root', () => {
    const l = nbLayout('/doc/notebooks/');
    assert.equal(l.root, '/doc/notebooks');
    assert.equal(l.library, '/doc/notebooks/library.json');
    assert.equal(l.staging, '/doc/notebooks/.staging');
    assert.equal(l.stagingJob('j1'), '/doc/notebooks/.staging/j1');
    assert.equal(l.clipboardDir('c1'), '/doc/notebooks/.staging/clipboard/c1');
    assert.equal(l.inbox, '/doc/notebooks/.inbox');
    assert.equal(l.renderJournal, '/doc/notebooks/.render-journal');
    const n = l.notebook('nb1');
    assert.equal(n.dir, '/doc/notebooks/nb1');
    assert.equal(n.json, '/doc/notebooks/nb1/notebook.json');
    assert.equal(n.pagesDir, '/doc/notebooks/nb1/pages');
    assert.equal(n.page('p1'), '/doc/notebooks/nb1/pages/p1.json');
    assert.equal(n.asset({ id: 'f1', kind: 'pdf', ext: 'PDF' }), '/doc/notebooks/nb1/assets/f1.pdf');
    assert.equal(n.asset({ id: 'a1', kind: 'audio', ext: 'm4a' }), '/doc/notebooks/nb1/audio/a1.m4a');
    assert.equal(n.asset({ id: 'i1', kind: 'image', ext: '../x' }), '/doc/notebooks/nb1/assets/i1.bin');
    assert.equal(n.cover, '/doc/notebooks/nb1/thumbs/cover.png');
    assert.equal(n.quarantine, '/doc/notebooks/nb1/quarantine');
  });

  test('file:// URI root keeps its scheme', () => {
    const l = nbLayout('file:///var/mobile/Documents/notebooks/');
    assert.equal(l.notebook('x').json, 'file:///var/mobile/Documents/notebooks/x/notebook.json');
  });

  test('helpers', () => {
    assert.equal(joinPath('/', 'a'), '/a');
    assert.equal(joinPath('file:///', 'a', '/b/'), 'file:///a/b');
    assert.equal(joinPath('a/', '', '/b'), 'a/b');
    assert.equal(baseName('/a/b/c.json'), 'c.json');
    assert.equal(baseName('/a/b/'), 'b');
    assert.equal(dirName('/a/b/c.json'), '/a/b');
    assert.equal(dirName('/a'), '/');
    assert.equal(dirName('file:///a'), 'file:///');
    assert.equal(safeExt('.JPG'), 'jpg');
    assert.equal(safeExt(''), 'bin');
    assert.ok(isNotebookDirName('abc123'));
    assert.ok(!isNotebookDirName('.staging'));
    assert.ok(!isNotebookDirName('library.json'));
  });
});
