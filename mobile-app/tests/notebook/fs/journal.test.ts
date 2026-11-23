import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readJsonRecovering, serializeEnvelope, writeJsonAtomic } from '../../../src/notebook/core/fs/journal.ts';
import { makeNotebookFile, readNotebookFile } from '../../../src/notebook/core/model/readers.ts';
import type { Notebook, NotebookFile } from '../../../src/notebook/core/model/types.ts';
import { createMemFs } from '../helpers/memfs.ts';
import type { MemFs } from '../helpers/memfs.ts';

const DIR = '/root/nb1';
const MAIN = `${DIR}/notebook.json`;
const Q = `${DIR}/quarantine`;
const T0 = '2026-11-23T10:00:00.000Z';
const NOW = () => 1_790_000_000_000;

function nbFile(rev: number, title = `rev ${rev}`): NotebookFile {
  const nb: Notebook = {
    id: 'nb1',
    title,
    createdAt: T0,
    updatedAt: T0,
    defaults: { style: 'lined', color: 'white', size: 'a4' },
    pageIds: ['p1'],
    removedPageIds: [],
    recordings: [],
    assets: {},
    origin: { kind: 'blank' },
    contentRev: rev,
  };
  return makeNotebookFile(nb, { rev, savedAt: T0, app: 'test' });
}

const read = (fs: MemFs, repair: boolean) => readJsonRecovering(fs, MAIN, readNotebookFile, Q, { repair, now: NOW });

function freshFs(): MemFs {
  return createMemFs({ dirs: [DIR] });
}

async function revOf(fs: MemFs, repair = false): Promise<number> {
  const r = await read(fs, repair);
  assert.ok(r.ok, 'reading must find a value');
  return r.value.rev;
}

describe('writeJsonAtomic', () => {
  test('writes tmp, moves main to bak, then tmp to main; the sentinel is last', async () => {
    const fs = freshFs();
    await writeJsonAtomic(fs, MAIN, nbFile(1));
    await writeJsonAtomic(fs, MAIN, nbFile(2));
    assert.deepEqual(
      fs.log.map((e) => e.op),
      ['writeText', 'move', 'writeText', 'move', 'move'],
    );
    assert.deepEqual(fs.log.slice(2).map((e) => [e.path, e.to]), [
      [`${MAIN}.tmp`, undefined],
      [MAIN, `${MAIN}.bak`],
      [`${MAIN}.tmp`, MAIN],
    ]);
    assert.ok(fs.getText(MAIN)?.endsWith('"$":"end"}'));
    assert.equal(JSON.parse(fs.getText(`${MAIN}.bak`) as string).rev, 1);
    assert.equal(fs.getText(`${MAIN}.tmp`), null);
  });

  test('serializeEnvelope moves an existing sentinel to the end', () => {
    const text = serializeEnvelope({ $: 'end', rev: 1, a: 2 } as { rev: number });
    assert.equal(text, '{"rev":1,"a":2,"$":"end"}');
  });
});

describe('crash at every write step', () => {
  for (const torn of [false, true]) {
    test(`reader returns the old or the new value, never nothing (torn writes: ${torn})`, async () => {
      // Steps of the second write: writeText tmp, move main->bak, move tmp->main.
      for (let n = 0; n <= 3; n++) {
        const fs = freshFs();
        await writeJsonAtomic(fs, MAIN, nbFile(1));
        fs.failAfter(n, { torn });
        let threw = false;
        try {
          await writeJsonAtomic(fs, MAIN, nbFile(2));
        } catch {
          threw = true;
        }
        fs.failAfter(null);
        assert.equal(threw, n < 3, `step ${n}`);
        const before = fs.snapshot();
        fs.clearLog();
        const rev = await revOf(fs, false);
        assert.ok(rev === 1 || rev === 2, `step ${n}: rev ${rev}`);
        if (n >= 1) assert.equal(rev, 2, 'once tmp is complete, the new value wins');
        // repair:false never touches the disk.
        assert.deepEqual(fs.log, []);
        assert.deepEqual(fs.snapshot(), before);
        // An owner read repairs, and then the plain read agrees and the state is clean.
        const repaired = await read(fs, true);
        assert.ok(repaired.ok);
        assert.equal(repaired.value.rev, rev);
        const again = await read(fs, false);
        assert.ok(again.ok && again.source === 'main' && again.value.rev === rev && !again.repaired);
        assert.equal(fs.getText(`${MAIN}.tmp`), null);
        // The next write still works.
        await writeJsonAtomic(fs, MAIN, nbFile(3));
        assert.equal(await revOf(fs), 3);
      }
    });
  }

  test('a crash on the very first write leaves nothing or the new value', async () => {
    for (let n = 0; n <= 2; n++) {
      const fs = freshFs();
      fs.failAfter(n, { torn: true });
      try {
        await writeJsonAtomic(fs, MAIN, nbFile(1));
      } catch {
        // crash
      }
      fs.failAfter(null);
      const r = await read(fs, false);
      if (n === 0) assert.ok(!r.ok && r.reason === 'unreadable');
      else assert.ok(r.ok && r.value.rev === 1);
    }
  });

  test('a crash in the middle of a repair is recovered by the next read', async () => {
    for (let n = 0; n <= 3; n++) {
      const fs = freshFs();
      await writeJsonAtomic(fs, MAIN, nbFile(1));
      fs.failAfter(2);
      await writeJsonAtomic(fs, MAIN, nbFile(2)).catch(() => {});
      // main missing, bak = 1, tmp = 2. Now crash the repair itself.
      fs.failAfter(n, { torn: true });
      const r = await read(fs, true);
      fs.failAfter(null);
      assert.ok(r.ok && r.value.rev === 2);
      assert.equal(await revOf(fs), 2);
      assert.equal(await revOf(fs, true), 2);
    }
  });
});

describe('repair flag', () => {
  test('repair:false reads leave the mutation log empty, even with damaged files around', async () => {
    const fs = freshFs();
    fs.putText(MAIN, '{"format":"qu-notebook","rev":3,"id":"nb1"'); // truncated
    fs.putText(`${MAIN}.tmp`, 'garbage');
    fs.putText(`${MAIN}.bak`, serializeEnvelope(nbFile(2)));
    const before = fs.snapshot();
    fs.clearLog();
    const r = await read(fs, false);
    assert.ok(r.ok && r.source === 'bak' && r.value.rev === 2 && !r.repaired);
    assert.deepEqual(fs.log, []);
    assert.deepEqual(fs.snapshot(), before);
  });

  test('repair:true quarantines damaged files as <base>.<epoch>.json and rewrites main', async () => {
    const fs = freshFs();
    const truncated = serializeEnvelope(nbFile(3)).slice(0, 40);
    fs.putText(MAIN, truncated);
    fs.putText(`${MAIN}.bak`, serializeEnvelope(nbFile(2)));
    const r = await read(fs, true);
    assert.ok(r.ok && r.source === 'bak' && r.value.rev === 2 && r.repaired && !r.readOnly);
    const epoch = NOW();
    assert.equal(fs.getText(`${Q}/notebook.${epoch}.json`), truncated);
    assert.equal(JSON.parse(fs.getText(MAIN) as string).rev, 2);
    const again = await read(fs, true);
    assert.ok(again.ok && again.source === 'main' && !again.repaired);
  });

  test('a stale valid tmp is removed by repair, ignored otherwise', async () => {
    const fs = freshFs();
    await writeJsonAtomic(fs, MAIN, nbFile(5));
    fs.putText(`${MAIN}.tmp`, serializeEnvelope(nbFile(4)));
    const plain = await read(fs, false);
    assert.ok(plain.ok && plain.value.rev === 5 && plain.source === 'main');
    assert.ok(fs.getText(`${MAIN}.tmp`));
    const r = await read(fs, true);
    assert.ok(r.ok && r.repaired);
    assert.equal(fs.getText(`${MAIN}.tmp`), null);
  });
});

describe('damaged and foreign saves', () => {
  test('truncated JSON with no other copy is unreadable; repair copies it aside and keeps the original', async () => {
    const fs = freshFs();
    const text = serializeEnvelope(nbFile(1)).slice(0, -12);
    fs.putText(MAIN, text);
    const plain = await read(fs, false);
    assert.deepEqual(plain, { ok: false, reason: 'unreadable', quarantined: [] });
    const r = await read(fs, true);
    assert.ok(!r.ok && r.reason === 'unreadable');
    assert.deepEqual(r.quarantined, [`${Q}/notebook.${NOW()}.json`]);
    assert.equal(fs.getText(MAIN), text);
    // A second owner read does not pile up copies.
    const r2 = await read(fs, true);
    assert.ok(!r2.ok);
    assert.deepEqual(r2.quarantined, []);
  });

  test('valid JSON without the sentinel is damaged', async () => {
    const fs = freshFs();
    const { $: _end, ...noSentinel } = nbFile(7);
    fs.putText(MAIN, JSON.stringify(noSentinel));
    const r = await read(fs, false);
    assert.ok(!r.ok && r.reason === 'unreadable');
    fs.putText(`${MAIN}.bak`, serializeEnvelope(nbFile(6)));
    const r2 = await read(fs, false);
    assert.ok(r2.ok && r2.value.rev === 6 && r2.source === 'bak');
  });

  test('nothing on disk is missing', async () => {
    const fs = freshFs();
    assert.deepEqual(await read(fs, true), { ok: false, reason: 'missing', quarantined: [] });
    assert.deepEqual(fs.log, []);
  });

  test('a newer version is readOnly and never repaired, even with repair:true', async () => {
    const fs = freshFs();
    const newer = { ...nbFile(9, 'من نسخة أحدث'), version: 2, extra: true };
    fs.putText(MAIN, serializeEnvelope(newer as unknown as NotebookFile));
    fs.putText(`${MAIN}.tmp`, 'torn');
    fs.putText(`${MAIN}.bak`, serializeEnvelope(nbFile(8)));
    const before = fs.snapshot();
    fs.clearLog();
    const r = await read(fs, true);
    assert.ok(r.ok && r.readOnly && !r.repaired && r.value.rev === 9 && r.value.title === 'من نسخة أحدث');
    assert.deepEqual(fs.log, []);
    assert.deepEqual(fs.snapshot(), before);
  });

  test('a reader that rejects the content counts as damaged', async () => {
    const fs = freshFs();
    fs.putText(MAIN, serializeEnvelope({ format: 'qu-page', rev: 1 } as { rev: number }));
    const r = await read(fs, false);
    assert.ok(!r.ok && r.reason === 'unreadable');
  });

  test('page files: a crash while two files are written leaves each one old or new', async () => {
    const fs = createMemFs({ dirs: ['/root/nb1/pages'] });
    const P = '/root/nb1/pages/p1.json';
    const readPage = (raw: unknown) => (raw && typeof raw === 'object' && 'rev' in raw ? (raw as { rev: number }) : null);
    await writeJsonAtomic(fs, P, { rev: 1 });
    fs.setDelay(1);
    fs.failAfter(1);
    await writeJsonAtomic(fs, P, { rev: 2 }).catch(() => {});
    fs.failAfter(null);
    fs.setDelay(null);
    const r = await readJsonRecovering(fs, P, readPage, '/root/nb1/quarantine', { repair: false });
    assert.ok(r.ok && (r.value.rev === 1 || r.value.rev === 2));
  });
});
