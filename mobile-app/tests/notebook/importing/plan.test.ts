import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  FALLBACK_PAGE_SIZE,
  SIZE_BATCH,
  cleanSize,
  createJobRegistry,
  failureOutcome,
  imagePageSize,
  jobKey,
  newPdfPending,
  pagePlaceholderId,
  planResume,
  progressPercent,
  runPdfJob,
  type JobPageSize,
  type PdfJobPort,
} from '../../../src/notebook/core/importing/plan.ts';
import type { PendingImport } from '../../../src/notebook/core/model/index.ts';

/** Thrown by the fake engine to stand for the app process dying inside a native call. */
class Killed extends Error {
  constructor() {
    super('killed');
  }
}

const err = (code: string) => Object.assign(new Error(code), { code, name: 'PdfError' });

interface FakeOptions {
  /** Pages whose probe rejects with this code. */
  probeFail?: Record<number, string>;
  /** Page whose probe kills the app. */
  killProbe?: number;
  /** pageSizes(from, count) call whose first page equals this kills the app (count > 1 only unless killSingle). */
  killSizesFrom?: number;
  /** pageSizes(page, 1) of this page kills the app. */
  killSingleSize?: number;
  /** pageSizes batches starting here reject with this code (count > 1). */
  sizesFail?: Record<number, string>;
  cancelAfter?: number;
}

function sizeOf(i: number): JobPageSize {
  return { w: 600 + i, h: 800 + i, rotation: 0 };
}

function fakePort(o: FakeOptions = {}) {
  let killed = false;
  const log = {
    disk: undefined as PendingImport | undefined | 'none',
    mem: undefined as PendingImport | undefined,
    applied: new Map<number, { size?: JobPageSize; damaged: boolean }>(),
    probes: [] as number[],
    sizeCalls: [] as [number, number][],
    progress: [] as [number, number][],
    firstResolved: 0,
    durableSaves: 0,
  };
  log.disk = 'none';
  const kill = (): never => {
    killed = true;
    throw new Killed();
  };
  const port: PdfJobPort = {
    async pageSizes(from, count) {
      if (killed) throw new Killed();
      log.sizeCalls.push([from, count]);
      if (count > 1 && o.killSizesFrom === from) kill();
      if (count === 1 && o.killSingleSize === from) kill();
      if (count > 1 && o.sizesFail?.[from]) throw err(o.sizesFail[from]);
      return Array.from({ length: count }, (_, k) => sizeOf(from + k));
    },
    async probe(page) {
      if (killed) throw new Killed();
      log.probes.push(page);
      if (o.killProbe === page) kill();
      const code = o.probeFail?.[page];
      if (code) throw err(code);
    },
    async savePending(p, durable) {
      if (killed) return;
      log.mem = p;
      if (durable) {
        log.disk = p;
        log.durableSaves++;
      }
    },
    applyPage(page, r) {
      if (killed) return;
      log.applied.set(page, r);
    },
    progress(done, total) {
      log.progress.push([done, total]);
    },
    firstPageResolved() {
      log.firstResolved++;
    },
    cancelled() {
      return o.cancelAfter !== undefined && log.applied.size >= o.cancelAfter;
    },
  };
  return { port, log };
}

const pending = (total: number, extra: Partial<PendingImport> = {}): PendingImport => ({
  ...newPdfPending({ jobId: 'job1234567890abc', fileId: 'file1234567890ab', total, insertAt: 0 }),
  ...extra,
});

describe('newPdfPending and ids', () => {
  test('starts at the first page with nothing probing', () => {
    const p = newPdfPending({ jobId: 'j', fileId: 'f', total: 24, insertAt: 3 });
    assert.deepEqual(p, { jobId: 'j', fileId: 'f', kind: 'pdf-pages', firstPageIndex: 0, insertAt: 3, nextPage: 0, total: 24 });
  });

  test('placeholder ids are stable and file-name safe', () => {
    assert.equal(pagePlaceholderId('abcdefghijklmnop', 12), 'abcdefghijklmnop_12');
    assert.equal(pagePlaceholderId('abcdefghijklmnop', 12), pagePlaceholderId('abcdefghijklmnop', 12));
    assert.match(pagePlaceholderId('abcdefghijklmnop', 99999), /^[A-Za-z0-9_-]{1,64}$/);
  });

  test('failureOutcome: renderer crashes and damaged pages go on, the rest stops the job', () => {
    assert.equal(failureOutcome(err('renderer-crashed')), 'damaged');
    assert.equal(failureOutcome(err('damaged')), 'damaged');
    assert.equal(failureOutcome(err('unsupported')), 'damaged');
    assert.equal(failureOutcome(err('io')), 'fatal');
    assert.equal(failureOutcome(err('no-native')), 'fatal');
    assert.equal(failureOutcome(new Error('x')), 'fatal');
  });

  test('cleanSize rejects bad sizes', () => {
    assert.deepEqual(cleanSize({ w: 10, h: 20, rotation: 90 }), { w: 10, h: 20, rotation: 90 });
    assert.deepEqual(cleanSize({ w: 10, h: 20, rotation: 45 }), { w: 10, h: 20, rotation: 0 });
    assert.equal(cleanSize({ w: 0, h: 20 }), null);
    assert.equal(cleanSize({ w: Number.NaN, h: 20 }), null);
    assert.equal(cleanSize(null), null);
  });
});

describe('runPdfJob: a clean run', () => {
  test('reads sizes in batches of 20, probes every page under the journal, then clears pending', async () => {
    const { port, log } = fakePort();
    const r = await runPdfJob(port, pending(45));
    assert.equal(r.state, 'done');
    assert.equal(r.pending, undefined);
    assert.deepEqual(log.sizeCalls, [
      [0, SIZE_BATCH],
      [20, SIZE_BATCH],
      [40, 5],
    ]);
    assert.deepEqual(log.probes, Array.from({ length: 45 }, (_, i) => i));
    assert.equal(log.applied.size, 45);
    assert.deepEqual(log.applied.get(7), { size: sizeOf(7), damaged: false });
    assert.equal(log.disk, undefined, 'the finished job leaves no pending record');
    assert.equal(log.firstResolved, 1);
    assert.deepEqual(log.progress.at(-1), [45, 45]);
    // One durable journal write per probe plus one per size batch plus the final clear.
    assert.equal(log.durableSaves, 45 + 3 + 1);
  });

  test('an empty PDF finishes at once', async () => {
    const { port, log } = fakePort();
    const r = await runPdfJob(port, pending(0));
    assert.equal(r.state, 'done');
    assert.equal(log.probes.length, 0);
  });
});

describe('runPdfJob: damaged pages', () => {
  test("a 'renderer-crashed' probe marks that page damaged and the job goes on", async () => {
    const { port, log } = fakePort({ probeFail: { 7: 'renderer-crashed' } });
    const r = await runPdfJob(port, pending(10));
    assert.equal(r.state, 'done');
    assert.deepEqual(r.damagedPages, [7]);
    assert.deepEqual(log.applied.get(7), { size: sizeOf(7), damaged: true });
    assert.deepEqual(log.applied.get(8), { size: sizeOf(8), damaged: false });
    assert.equal(log.applied.size, 10);
  });

  test("'damaged' and 'unsupported' probes mark pages damaged too", async () => {
    const { port } = fakePort({ probeFail: { 0: 'damaged', 3: 'unsupported' } });
    const r = await runPdfJob(port, pending(5));
    assert.equal(r.state, 'done');
    assert.deepEqual(r.damagedPages, [0, 3]);
  });

  test('pages already known to be damaged are not probed again', async () => {
    const { port, log } = fakePort();
    const r = await runPdfJob(port, pending(6, { damagedPages: [2] }));
    assert.equal(r.state, 'done');
    assert.ok(!log.probes.includes(2));
    assert.equal(log.applied.get(2)?.damaged, true);
  });

  test('a failing size batch is read again one page at a time', async () => {
    const { port, log } = fakePort({ sizesFail: { 0: 'renderer-crashed' } });
    const r = await runPdfJob(port, pending(3));
    assert.equal(r.state, 'done');
    assert.deepEqual(log.sizeCalls, [
      [0, 3],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    assert.deepEqual(r.damagedPages, []);
  });
});

describe('runPdfJob: crashes and resume', () => {
  test('a probe that kills the app leaves probing on disk; resume marks that page damaged without probing it', async () => {
    const first = fakePort({ killProbe: 5 });
    const r1 = await runPdfJob(first.port, pending(12));
    assert.equal(r1.state, 'failed');
    const onDisk = first.log.disk as PendingImport;
    assert.equal(onDisk.probing, 5);
    assert.equal(onDisk.nextPage, 5);

    const plan = planResume(onDisk);
    assert.deepEqual(plan.pending.damagedPages, [5]);
    assert.equal(plan.pending.probing, undefined);

    const second = fakePort();
    const r2 = await runPdfJob(second.port, onDisk);
    assert.equal(r2.state, 'done');
    assert.deepEqual(r2.damagedPages, [5]);
    assert.ok(!second.log.probes.includes(5), 'the crashing page is never probed again');
    assert.equal(second.log.applied.get(5)?.damaged, true);
    assert.deepEqual(second.log.probes, [6, 7, 8, 9, 10, 11]);
    assert.equal(second.log.firstResolved, 0, 'page 1 was resolved before the crash');
  });

  test('a size batch that kills the app is re-read page by page, so the next crash names the exact page', async () => {
    const run1 = fakePort({ killSizesFrom: 20 });
    await runPdfJob(run1.port, pending(30));
    const disk1 = run1.log.disk as PendingImport;
    assert.equal(disk1.probing, 30 + 20);
    assert.equal(disk1.nextPage, 20);

    const plan = planResume(disk1);
    assert.deepEqual(plan.careful, { from: 20, to: 30 });
    assert.equal(plan.pending.damagedPages, undefined, 'nothing innocent is marked damaged');

    const run2 = fakePort({ killSingleSize: 23 });
    await runPdfJob(run2.port, disk1);
    assert.deepEqual(run2.log.sizeCalls, [
      [20, 1],
      [21, 1],
      [22, 1],
      [23, 1],
    ]);
    const disk2 = run2.log.disk as PendingImport;
    assert.equal(disk2.probing, 23);

    const run3 = fakePort();
    const r3 = await runPdfJob(run3.port, disk2);
    assert.equal(r3.state, 'done');
    assert.deepEqual(r3.damagedPages, [23]);
    // Page 23 gets no size read and no probe; the batch read resumes after it.
    assert.deepEqual(run3.log.sizeCalls, [[24, 6]]);
    assert.equal(run3.log.applied.get(23)?.damaged, true);
    assert.equal(run3.log.applied.get(23)?.size, undefined);
  });

  test('a crash-journal entry for an already resolved page marks it damaged right away', async () => {
    const p = pending(10, { nextPage: 6 });
    const plan = planResume(p, 3);
    assert.deepEqual(plan.markNow, [3]);
    const { port, log } = fakePort();
    const r = await runPdfJob(port, p, { crashPage: 3 });
    assert.equal(r.state, 'done');
    assert.deepEqual(log.applied.get(3), { damaged: true });
    assert.deepEqual(r.damagedPages, [3]);
    assert.deepEqual(log.probes, [6, 7, 8, 9]);
  });

  test('a crash-journal entry for a page not reached yet skips its probe', async () => {
    const { port, log } = fakePort();
    const r = await runPdfJob(port, pending(5, { nextPage: 1 }), { crashPage: 4 });
    assert.equal(r.state, 'done');
    assert.ok(!log.probes.includes(4));
    assert.deepEqual(r.damagedPages, [4]);
  });

  test('a crash page outside the PDF is ignored', () => {
    const plan = planResume(pending(5), 9);
    assert.deepEqual(plan.markNow, []);
    assert.equal(plan.pending.damagedPages, undefined);
  });

  test('a fatal error stops the job and keeps the record (without probing) for the next resume', async () => {
    const { port, log } = fakePort({ probeFail: { 2: 'io' } });
    const r = await runPdfJob(port, pending(5));
    assert.equal(r.state, 'failed');
    const disk = log.disk as PendingImport;
    assert.equal(disk.nextPage, 2);
    assert.equal(disk.probing, undefined);
    const again = fakePort();
    const r2 = await runPdfJob(again.port, disk);
    assert.equal(r2.state, 'done');
    assert.deepEqual(again.log.probes, [2, 3, 4]);
    assert.deepEqual(r2.damagedPages, []);
  });

  test('cancellation keeps the record so the job can resume later', async () => {
    const { port, log } = fakePort({ cancelAfter: 3 });
    const r = await runPdfJob(port, pending(10));
    assert.equal(r.state, 'cancelled');
    assert.equal((log.disk as PendingImport).nextPage, 3);
    const again = fakePort();
    const r2 = await runPdfJob(again.port, log.disk as PendingImport);
    assert.equal(r2.state, 'done');
    assert.deepEqual(again.log.probes, [3, 4, 5, 6, 7, 8, 9]);
  });

  test('resuming a finished-looking record (nextPage = total) just clears it', async () => {
    const { port, log } = fakePort();
    const r = await runPdfJob(port, pending(4, { nextPage: 4 }));
    assert.equal(r.state, 'done');
    assert.equal(log.probes.length, 0);
    assert.equal(log.disk, undefined);
  });
});

describe('createJobRegistry: idempotent resume', () => {
  test('a second run for the same key while one is running returns the same promise', async () => {
    const reg = createJobRegistry<string>();
    let starts = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const start = async () => {
      starts++;
      await gate;
      return 'ok';
    };
    const key = jobKey('nb1', 'job1');
    const a = reg.run(key, start);
    const b = reg.run(key, start);
    assert.equal(a, b);
    assert.equal(starts, 1);
    assert.ok(reg.running(key));
    assert.deepEqual(reg.keys(), ['nb1:job1']);
    // Another job of another notebook runs alongside.
    const c = reg.run(jobKey('nb2', 'job1'), async () => 'other');
    assert.notEqual(c, a);
    release();
    assert.equal(await a, 'ok');
    assert.equal(await c, 'other');
    assert.ok(!reg.running(key));
    // After it settled, a new run starts again.
    await reg.run(key, start);
    assert.equal(starts, 2);
  });

  test('a run that throws synchronously or rejects frees its key', async () => {
    const reg = createJobRegistry<number>();
    await assert.rejects(
      reg.run('k', () => {
        throw new Error('boom');
      }),
    );
    assert.ok(!reg.running('k'));
    await assert.rejects(reg.run('k', async () => Promise.reject(new Error('later'))));
    assert.ok(!reg.running('k'));
  });

  test('two resumes of one notebook run the job once', async () => {
    const reg = createJobRegistry<unknown>();
    const { port, log } = fakePort();
    const p = pending(25);
    const [r1, r2] = await Promise.all([reg.run(jobKey('nb', p.jobId), () => runPdfJob(port, p)), reg.run(jobKey('nb', p.jobId), () => runPdfJob(port, p))]);
    assert.equal(r1, r2);
    assert.equal(log.probes.length, 25);
  });
});

describe('image pages and progress', () => {
  test('imagePageSize keeps the aspect ratio with the long side at A4 length', () => {
    assert.deepEqual(imagePageSize(3000, 4000), { w: 631.42, h: 841.89 });
    assert.deepEqual(imagePageSize(4000, 3000), { w: 841.89, h: 631.42 });
    assert.deepEqual(imagePageSize(1000, 1000), { w: 841.89, h: 841.89 });
    assert.deepEqual(imagePageSize(0, 100), FALLBACK_PAGE_SIZE);
    // A very thin strip stays at 1:8.
    assert.deepEqual(imagePageSize(100, 10000), { w: 105.24, h: 841.89 });
  });

  test('progressPercent', () => {
    assert.equal(progressPercent(6, 24), 25);
    assert.equal(progressPercent(24, 24), 100);
    assert.equal(progressPercent(30, 24), 100);
    assert.equal(progressPercent(1, 0), 0);
  });
});
