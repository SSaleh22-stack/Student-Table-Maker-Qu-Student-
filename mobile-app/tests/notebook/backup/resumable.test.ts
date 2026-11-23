import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DriveClient, DriveError, isAbortError } from '../../../src/notebook/core/backup/drive.ts';
import type { TokenResult } from '../../../src/notebook/core/backup/drive.ts';
import type { FetchInit, ResponseLike } from '../../../src/notebook/core/backup/fetchTypes.ts';
import { CHUNK_UNIT, chunkSizeOf, DEFAULT_CHUNK, nextOffset, uploadResumable } from '../../../src/notebook/core/backup/resumable.ts';
import type { ResumableSource } from '../../../src/notebook/core/backup/resumable.ts';

// ===== a fake Drive resumable-upload server =====

interface Session {
  url: string;
  total: number;
  mime: string;
  name: string;
  fileId: string | null;
  data: Uint8Array[];
  received: number;
  expired: boolean;
}

interface Put {
  session: string;
  range: string;
  bytes: number;
}

type Fault =
  /** throw before the server sees the request */
  | 'throw'
  /** the server stores the chunk, but the response is lost */
  | 'lose-response'
  /** the server keeps only this many bytes of the chunk */
  | { keep: number }
  | { status: number; reason?: string };

function response(status: number, body: unknown = '', headers: Record<string, string> = {}): ResponseLike {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, text: async () => text };
}

const err = (status: number, reason: string) => response(status, { error: { code: status, errors: [{ reason }] } });

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

class FakeUploads {
  sessions = new Map<string, Session>();
  files = new Map<string, { name: string; content: Uint8Array }>();
  validTokens = new Set(['t1']);
  /** Faults for chunk PUTs (not status queries), by chunk PUT number (0-based). */
  chunkFaults = new Map<number, Fault>();
  /** Faults for every request, in order. */
  faults: (Fault | null)[] = [];
  puts: Put[] = [];
  queries = 0;
  starts: { method: string; path: string }[] = [];
  private chunkPuts = 0;
  private n = 0;

  fetch = async (url: string, init?: FetchInit): Promise<ResponseLike> => {
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k.toLowerCase()] = v;
    const general = this.faults.shift() ?? null;
    if (general === 'throw') throw new TypeError('Network request failed');
    if (general && typeof general === 'object' && 'status' in general) return err(general.status, general.reason ?? 'x');
    if (!this.validTokens.has((headers.authorization ?? '').replace(/^Bearer /, ''))) return err(401, 'authError');

    const u = new URL(url);
    if (u.hostname === 'www.googleapis.com') return this.start(method, u, headers, String(init?.body ?? ''));
    const s = this.sessions.get(url);
    assert.ok(s, `unknown session ${url}`);
    assert.equal(method, 'PUT');
    assert.equal(init?.redirect, 'manual');
    assert.ok(init?.body instanceof Uint8Array, 'chunk bodies are Uint8Array');
    if (s.expired) return err(404, 'notFound');
    const range = headers['content-range'];
    assert.ok(range, 'Content-Range');

    const status = /^bytes \*\/(\d+)$/.exec(range);
    if (status) {
      this.queries++;
      assert.equal(Number(status[1]), s.total);
      assert.equal(init.body.length, 0);
      return this.state(s);
    }
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    assert.ok(m, `bad range ${range}`);
    const [first, last, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert.equal(total, s.total);
    assert.equal(headers['content-type'], s.mime, 'chunks carry the media type');
    assert.equal(last - first + 1, init.body.length);
    if (last + 1 < total) assert.equal(init.body.length % CHUNK_UNIT, 0, 'non-final chunks are multiples of 256 KiB');
    this.puts.push({ session: url, range, bytes: init.body.length });

    const fault = this.chunkFaults.get(this.chunkPuts++);
    if (fault === 'throw') throw new TypeError('Network request failed');
    if (fault && typeof fault === 'object' && 'status' in fault) return err(fault.status, fault.reason ?? 'x');
    assert.equal(first, s.received, 'each chunk starts where the server stopped');
    const keep = fault && typeof fault === 'object' && 'keep' in fault ? fault.keep : init.body.length;
    s.data.push(init.body.slice(0, keep));
    s.received += keep;
    if (fault === 'lose-response') throw new TypeError('Network connection was lost');
    return this.state(s);
  };

  private start(method: string, u: URL, headers: Record<string, string>, body: string): ResponseLike {
    assert.equal(u.searchParams.get('uploadType'), 'resumable');
    const fileId = /\/files\/([^/]+)$/.exec(u.pathname)?.[1] ?? null;
    this.starts.push({ method, path: u.pathname });
    if (fileId && !this.files.has(fileId)) return err(404, 'notFound');
    const meta = JSON.parse(body);
    const url = `https://uploads.example.test/session/${++this.n}`;
    this.sessions.set(url, { url, total: Number(headers['x-upload-content-length']), mime: headers['x-upload-content-type'], name: meta.name, fileId, data: [], received: 0, expired: false });
    return response(200, '', { Location: url });
  }

  private state(s: Session): ResponseLike {
    if (s.received >= s.total) {
      const id = s.fileId ?? `file${this.files.size + 1}`;
      const content = concat(s.data);
      this.files.set(id, { name: s.name, content });
      return response(s.fileId ? 200 : 201, { id, name: s.name, mimeType: s.mime, size: String(content.length) });
    }
    return response(308, '', s.received > 0 ? { Range: `bytes=0-${s.received - 1}` } : {});
  }
}

function bytes(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x >>> 16;
  }
  return out;
}

function source(data: Uint8Array): ResumableSource & { reads: number[] } {
  const reads: number[] = [];
  return {
    size: data.length,
    reads,
    read: async (offset, length) => {
      reads.push(offset);
      return data.slice(offset, offset + length);
    },
  };
}

function setup(tokens: (refresh: boolean) => Promise<TokenResult> = async (refresh) => (refresh ? 't2' : 't1')) {
  const server = new FakeUploads();
  const sleeps: number[] = [];
  const client = new DriveClient({ fetch: server.fetch, getToken: tokens, sleep: async (ms) => void sleeps.push(ms), random: () => 0, maxRetries: 4 });
  return { server, client, sleeps };
}

const target = { parentId: 'dir', name: 'r1.m4a', mime: 'audio/mp4' };
const SMALL = CHUNK_UNIT;
const DATA = bytes(SMALL * 3 + 1000);

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof DriveError, String(e));
    assert.equal(e.code, code);
    return true;
  });
}

// ===== tests =====

describe('uploadResumable', () => {
  test('chunks of 256 KiB multiples, Content-Range, progress, the right bytes', async () => {
    const { server, client } = setup();
    const progress: number[] = [];
    const sessions: (string | null)[] = [];
    const f = await uploadResumable(client, source(DATA), target, { chunkSize: SMALL + 1000, onProgress: (n) => progress.push(n), onSession: (u) => sessions.push(u) });
    assert.deepEqual(
      server.puts.map((p) => p.range),
      [`bytes 0-${SMALL - 1}/${DATA.length}`, `bytes ${SMALL}-${2 * SMALL - 1}/${DATA.length}`, `bytes ${2 * SMALL}-${3 * SMALL - 1}/${DATA.length}`, `bytes ${3 * SMALL}-${DATA.length - 1}/${DATA.length}`],
    );
    assert.deepEqual(progress, [SMALL, 2 * SMALL, 3 * SMALL, DATA.length]);
    assert.deepEqual(server.files.get(f.id)?.content, DATA);
    assert.equal(f.size, DATA.length);
    assert.deepEqual(sessions, ['https://uploads.example.test/session/1', null]);
    assert.deepEqual(server.starts, [{ method: 'POST', path: '/upload/drive/v3/files' }]);
  });

  test('the default chunk is 8 MiB', async () => {
    const { server, client } = setup();
    const data = bytes(DEFAULT_CHUNK * 2 + 5);
    await uploadResumable(client, source(data), target);
    assert.deepEqual(server.puts.map((p) => p.bytes), [DEFAULT_CHUNK, DEFAULT_CHUNK, 5]);
  });

  for (const kind of ['throw', 'lose-response', '503'] as const) {
    test(`an interruption (${kind}) at each chunk resumes from what the server has`, async () => {
      for (let k = 0; k < 4; k++) {
        const { server, client, sleeps } = setup();
        server.chunkFaults.set(k, kind === '503' ? { status: 503 } : kind);
        const f = await uploadResumable(client, source(DATA), target, { chunkSize: SMALL });
        assert.deepEqual(server.files.get(f.id)?.content, DATA, `chunk ${k}`);
        assert.equal(server.queries, 1, 'one status query after the failure');
        assert.equal(sleeps.length, 1);
        // Only the failed chunk is sent twice (never when the server already had it).
        assert.equal(server.puts.length, kind === 'lose-response' ? 4 : 5);
      }
    });
  }

  test('the server keeping only part of a chunk: the next chunk starts there', async () => {
    const { server, client } = setup();
    server.chunkFaults.set(1, { keep: 1000 });
    const f = await uploadResumable(client, source(DATA), target, { chunkSize: SMALL * 2 });
    assert.deepEqual(server.files.get(f.id)?.content, DATA);
    assert.equal(server.puts[2].range, `bytes ${SMALL * 2 + 1000}-${DATA.length - 1}/${DATA.length}`);
  });

  test('an expired session (404) restarts from byte 0 with a new session', async () => {
    const { server, client } = setup();
    const sessions: (string | null)[] = [];
    let n = 0;
    const progress: number[] = [];
    const f = await uploadResumable(client, source(DATA), target, {
      chunkSize: SMALL,
      onSession: (u) => sessions.push(u),
      onProgress: (sent) => {
        progress.push(sent);
        if (++n === 2) for (const s of server.sessions.values()) s.expired = true;
      },
    });
    assert.deepEqual(server.files.get(f.id)?.content, DATA);
    assert.deepEqual(sessions, ['https://uploads.example.test/session/1', null, 'https://uploads.example.test/session/2', null]);
    assert.deepEqual(progress.slice(0, 3), [SMALL, 2 * SMALL, 0]);
  });

  test('aborted mid-upload, then resumed later from the saved session', async () => {
    const { server, client } = setup();
    const ctl = new AbortController();
    let saved: string | null = null;
    const p = uploadResumable(client, source(DATA), target, {
      chunkSize: SMALL,
      signal: ctl.signal,
      onSession: (u) => (saved = u),
      onProgress: (sent) => {
        if (sent === 2 * SMALL) ctl.abort();
      },
    });
    await assert.rejects(p, (e: unknown) => isAbortError(e));
    assert.ok(saved);
    const src = source(DATA);
    const f = await uploadResumable(client, src, target, { chunkSize: SMALL, sessionUrl: saved });
    assert.deepEqual(server.files.get(f.id)?.content, DATA);
    assert.equal(server.queries, 1);
    assert.deepEqual(src.reads, [2 * SMALL, 3 * SMALL]);
    assert.equal(server.sessions.size, 1);
  });

  test('a saved session that expired starts over', async () => {
    const { server, client } = setup();
    server.sessions.set('https://uploads.example.test/session/old', { url: 'https://uploads.example.test/session/old', total: DATA.length, mime: 'audio/mp4', name: 'r1.m4a', fileId: null, data: [], received: 0, expired: true });
    const f = await uploadResumable(client, source(DATA), target, { chunkSize: SMALL, sessionUrl: 'https://uploads.example.test/session/old' });
    assert.deepEqual(server.files.get(f.id)?.content, DATA);
  });

  test('a 401 in the middle refreshes the token once and continues', async () => {
    const asked: boolean[] = [];
    const { server, client } = setup(async (refresh) => {
      asked.push(refresh);
      return refresh ? 't2' : 't1';
    });
    let n = 0;
    const f = await uploadResumable(client, source(DATA), target, {
      chunkSize: SMALL,
      onProgress: () => {
        if (++n === 1) server.validTokens = new Set(['t2']);
      },
    });
    assert.deepEqual(server.files.get(f.id)?.content, DATA);
    assert.deepEqual(asked, [false, true]);
  });

  test('invalid_grant during an upload is revoked', async () => {
    const { server, client } = setup(async (refresh) => {
      if (refresh) throw new Error('invalid_grant');
      return 't1';
    });
    let n = 0;
    await rejectsWith(
      uploadResumable(client, source(DATA), target, {
        chunkSize: SMALL,
        onProgress: () => {
          if (++n === 1) server.validTokens = new Set();
        },
      }),
      'revoked',
    );
  });

  test('5xx on every chunk until the retries run out is a network error', async () => {
    const { server, client, sleeps } = setup();
    for (let i = 0; i < 20; i++) server.chunkFaults.set(i, { status: 500 });
    await rejectsWith(uploadResumable(client, source(DATA), target, { chunkSize: SMALL }), 'network');
    assert.equal(sleeps.length, 4);
  });

  test('a quota error on a chunk stops at once', async () => {
    const { server, client } = setup();
    server.chunkFaults.set(0, { status: 403, reason: 'storageQuotaExceeded' });
    await rejectsWith(uploadResumable(client, source(DATA), target, { chunkSize: SMALL }), 'quota');
  });

  test('a full Drive reported by the status query after a lost chunk stops at once (no restart)', async () => {
    const { server, client } = setup();
    server.chunkFaults.set(0, 'throw');
    // request 1 starts the session, request 2 is the failed chunk, request 3 is the status query.
    server.faults = [null, null, { status: 403, reason: 'storageQuotaExceeded' }];
    await rejectsWith(uploadResumable(client, source(DATA), target, { chunkSize: SMALL }), 'quota');
    assert.equal(server.starts.length, 1);
  });

  test('a 5xx when starting the session is retried by the client', async () => {
    const { server, client } = setup();
    server.faults = [{ status: 503 }];
    const f = await uploadResumable(client, source(DATA), target, { chunkSize: SMALL * 4 });
    assert.deepEqual(server.files.get(f.id)?.content, DATA);
  });

  test('an empty file and an update of an existing (or vanished) file', async () => {
    const { server, client } = setup();
    const empty = await uploadResumable(client, source(new Uint8Array(0)), target);
    assert.equal(server.files.get(empty.id)?.content.length, 0);
    // A 0-byte file is one empty PUT with 'bytes */0'.
    assert.equal(server.puts.length, 0);
    assert.equal(server.queries, 1);
    server.queries = 0;

    server.files.set('existing', { name: 'r1.m4a', content: new Uint8Array(3) });
    const f = await uploadResumable(client, source(DATA), { ...target, fileId: 'existing' }, { chunkSize: SMALL * 4 });
    assert.equal(f.id, 'existing');
    assert.deepEqual(server.files.get('existing')?.content, DATA);
    const g = await uploadResumable(client, source(DATA), { ...target, fileId: 'vanished' }, { chunkSize: SMALL * 4 });
    assert.notEqual(g.id, 'vanished');
    assert.deepEqual(server.starts.map((s) => s.method), ['POST', 'PATCH', 'PATCH', 'POST']);
  });

  test('helpers', () => {
    assert.equal(chunkSizeOf(), DEFAULT_CHUNK);
    assert.equal(chunkSizeOf(1), CHUNK_UNIT);
    assert.equal(chunkSizeOf(CHUNK_UNIT * 3 + 5), CHUNK_UNIT * 3);
    assert.equal(nextOffset('bytes=0-42'), 43);
    assert.equal(nextOffset(null), 0);
  });
});
