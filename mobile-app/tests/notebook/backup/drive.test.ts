import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  APP_PROPERTY_KEY,
  APP_PROPERTY_VALUE,
  classifyTokenFailure,
  DriveClient,
  DriveError,
  FOLDER_MIME,
  isAbortError,
  qString,
} from '../../../src/notebook/core/backup/drive.ts';
import type { TokenResult } from '../../../src/notebook/core/backup/drive.ts';
import type { FetchInit, ResponseLike } from '../../../src/notebook/core/backup/fetchTypes.ts';

// ===== a small fake Drive v3 server =====

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: string;
  trashed: boolean;
  createdTime: string;
  appProperties?: Record<string, string>;
}

interface Req {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
}

type Fault = (r: Req) => ResponseLike | 'throw' | null;

function response(status: number, body: unknown = '', headers: Record<string, string> = {}): ResponseLike {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, text: async () => text };
}

const err = (status: number, reason: string) => response(status, { error: { code: status, message: reason, errors: [{ domain: 'global', reason, message: reason }] } });

function unq(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

class FakeDrive {
  files = new Map<string, FakeFile>();
  validTokens = new Set(['t1']);
  faults: Fault[] = [];
  log: string[] = [];
  private n = 0;

  fetch = async (url: string, init?: FetchInit): Promise<ResponseLike> => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k.toLowerCase()] = v;
    const body = typeof init?.body === 'string' ? init.body : init?.body ? new TextDecoder().decode(init.body) : '';
    const req: Req = { method: init?.method ?? 'GET', url: new URL(url), headers, body };
    this.log.push(`${req.method} ${req.url.pathname}`);
    const fault = this.faults.shift();
    if (fault) {
      const r = fault(req);
      if (r === 'throw') throw new TypeError('Network request failed');
      if (r) return r;
    }
    const auth = headers.authorization ?? '';
    if (!this.validTokens.has(auth.replace(/^Bearer /, ''))) return err(401, 'authError');
    return this.route(req);
  };

  add(name: string, parent: string, o: Partial<FakeFile> = {}): FakeFile {
    const id = `f${++this.n}`;
    const f: FakeFile = { id, name, parents: [parent], mimeType: 'application/json', content: '', trashed: false, createdTime: new Date(1_800_000_000_000 + this.n * 1000).toISOString(), ...o };
    this.files.set(id, f);
    return f;
  }

  private resource(f: FakeFile) {
    const r: Record<string, unknown> = { id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime };
    if (f.mimeType !== FOLDER_MIME) r.size = String(new TextEncoder().encode(f.content).length);
    if (f.appProperties) r.appProperties = f.appProperties;
    return r;
  }

  private route(r: Req): ResponseLike {
    const p = r.url.pathname;
    const m = /^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/.exec(p);
    if (!m) return err(404, 'notFound');
    const upload = !!m[1];
    const id = m[2] ? decodeURIComponent(m[2]) : undefined;
    if (!upload && !id && r.method === 'GET') return this.list(r);
    if (!upload && !id && r.method === 'POST') {
      const meta = JSON.parse(r.body);
      return response(200, this.resource(this.add(meta.name, meta.parents[0], { mimeType: meta.mimeType, appProperties: meta.appProperties })));
    }
    const file = id ? this.files.get(id) : undefined;
    if (id && !file) return err(404, 'notFound');
    if (!upload && file && r.method === 'GET') {
      assert.equal(r.url.searchParams.get('alt'), 'media');
      return response(200, file.content);
    }
    if (!upload && file && r.method === 'PATCH') {
      Object.assign(file, JSON.parse(r.body));
      return response(200, { id: file.id });
    }
    if (!upload && file && r.method === 'DELETE') {
      for (const f of [...this.files.values()]) if (f.parents.includes(file.id)) this.files.delete(f.id);
      this.files.delete(file.id);
      return response(204);
    }
    if (upload && r.url.searchParams.get('uploadType') === 'multipart') {
      const boundary = /boundary=(.+)$/.exec(r.headers['content-type'] ?? '')?.[1];
      assert.ok(boundary, 'multipart boundary');
      const parts = r.body.split(`--${boundary}`).slice(1, -1).map((s) => s.replace(/^\r\n/, '').replace(/\r\n$/, ''));
      assert.equal(parts.length, 2);
      const [metaPart, mediaPart] = parts.map((s) => s.slice(s.indexOf('\r\n\r\n') + 4));
      assert.match(parts[0], /^Content-Type: application\/json; charset=UTF-8/);
      const meta = JSON.parse(metaPart);
      if (file && r.method === 'PATCH') {
        file.content = mediaPart;
        return response(200, this.resource(file));
      }
      if (!file && r.method === 'POST') {
        return response(200, this.resource(this.add(meta.name, meta.parents[0], { mimeType: meta.mimeType, content: mediaPart, appProperties: meta.appProperties })));
      }
    }
    return err(400, 'badRequest');
  }

  private list(r: Req): ResponseLike {
    const q = r.url.searchParams.get('q') ?? '';
    const parent = unq(/^'((?:[^'\\]|\\.)*)' in parents/.exec(q)?.[1] ?? '');
    const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1];
    assert.match(q, /trashed = false/);
    assert.equal(r.url.searchParams.get('orderBy'), 'createdTime');
    let list = [...this.files.values()].filter((f) => f.parents.includes(parent) && !f.trashed);
    if (name !== undefined) list = list.filter((f) => f.name === unq(name));
    if (q.includes(`mimeType = '${FOLDER_MIME}'`)) list = list.filter((f) => f.mimeType === FOLDER_MIME);
    if (q.includes(`mimeType != '${FOLDER_MIME}'`)) list = list.filter((f) => f.mimeType !== FOLDER_MIME);
    list.sort((a, b) => (a.createdTime < b.createdTime ? -1 : 1));
    const size = Number(r.url.searchParams.get('pageSize') ?? 100);
    const start = Number(r.url.searchParams.get('pageToken') ?? 0);
    const page = list.slice(start, start + size);
    const body: Record<string, unknown> = { files: page.map((f) => this.resource(f)) };
    if (start + size < list.length) body.nextPageToken = String(start + size);
    return response(200, body);
  }
}

function setup(tokens: (refresh: boolean, calls: number) => Promise<TokenResult> = async (refresh) => (refresh ? 't2' : 't1')) {
  const server = new FakeDrive();
  const sleeps: number[] = [];
  let calls = 0;
  const client = new DriveClient({
    fetch: server.fetch,
    getToken: (refresh) => tokens(refresh, ++calls),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
    maxRetries: 3,
  });
  return { server, client, sleeps };
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof DriveError, String(e));
    assert.equal(e.code, code);
    return true;
  });
}

// ===== tests =====

describe('DriveClient: folders, listing, text files', () => {
  test('ensureFolder creates once, tagged with appProperties quApp', async () => {
    const { server, client } = setup();
    const root = await client.ensureFolder('QU Student', 'root');
    const backups = await client.ensureFolderPath(root, ['Backups']);
    assert.equal(await client.ensureFolder('QU Student', 'root'), root);
    assert.equal(await client.ensureFolderPath('root', ['QU Student', 'Backups']), backups);
    const folders = [...server.files.values()];
    assert.equal(folders.length, 2);
    for (const f of folders) {
      assert.equal(f.mimeType, FOLDER_MIME);
      assert.deepEqual(f.appProperties, { [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE });
    }
  });

  test('two folders with the same name (a race): everyone picks the oldest', async () => {
    const { server, client } = setup();
    const a = server.add('QU Student', 'root', { mimeType: FOLDER_MIME, appProperties: { quApp: 'qu-student' } });
    server.add('QU Student', 'root', { mimeType: FOLDER_MIME, appProperties: { quApp: 'qu-student' } });
    assert.equal(await client.ensureFolder('QU Student', 'root'), a.id);
  });

  test('listChildren follows every page', async () => {
    const { server, client } = setup();
    for (let i = 0; i < 5; i++) server.add(`p${i}.json`, 'dir');
    server.add('sub', 'dir', { mimeType: FOLDER_MIME });
    server.add('old.json', 'dir', { trashed: true });
    server.log = [];
    const all = await client.listChildren('dir', { pageSize: 2 });
    assert.deepEqual(all.map((f) => f.name), ['p0.json', 'p1.json', 'p2.json', 'p3.json', 'p4.json', 'sub']);
    assert.equal(server.log.length, 3);
    assert.deepEqual((await client.listChildren('dir', { folders: true })).map((f) => f.name), ['sub']);
    assert.equal((await client.listChildren('dir', { folders: false })).length, 5);
    assert.equal(all[0].size, 0);
  });

  test('putText creates, then updates the same file; getText reads it; 404 is null', async () => {
    const { server, client } = setup();
    const body = '{"title":"محاضرة \\"1\\"","x":"--qu-"}\r\n--';
    const f1 = await client.putText('dir', 'manifest.json', body);
    assert.equal(server.files.get(f1.id)?.content, body);
    assert.deepEqual(server.files.get(f1.id)?.appProperties, { quApp: 'qu-student' });
    const f2 = await client.putText('dir', 'manifest.json', '{"v":2}');
    assert.equal(f2.id, f1.id);
    assert.equal(server.files.size, 1);
    assert.equal(await client.getText(f1.id), '{"v":2}');
    assert.equal(await client.getText('nope'), null);
    // An update of a file deleted meanwhile creates it again.
    server.files.delete(f1.id);
    const f3 = await client.putText('dir', 'manifest.json', 'x', { fileId: f1.id });
    assert.notEqual(f3.id, f1.id);
  });

  test('names with quotes and backslashes are escaped in queries', async () => {
    const { server, client } = setup();
    const f = server.add("it's a \\ name", 'dir');
    assert.equal((await client.findChild('dir', "it's a \\ name"))?.id, f.id);
    assert.equal(qString("a'b\\c"), "'a\\'b\\\\c'");
  });

  test('remove trashes by default, deletes when permanent, and ignores missing files', async () => {
    const { server, client } = setup();
    const a = server.add('a', 'dir');
    const b = server.add('b', 'dir');
    await client.remove(a.id);
    assert.equal(server.files.get(a.id)?.trashed, true);
    await client.remove(b.id, { permanent: true });
    assert.equal(server.files.has(b.id), false);
    await client.remove('missing');
    assert.deepEqual(await client.listChildren('dir'), []);
  });

  test('downloadRequest gives the media URL and the bearer header', async () => {
    const { client } = setup();
    const r = await client.downloadRequest('abc');
    assert.equal(r.url, 'https://www.googleapis.com/drive/v3/files/abc?alt=media');
    assert.deepEqual(r.headers, { Authorization: 'Bearer t1' });
    assert.deepEqual((await client.downloadRequest('abc', { refresh: true })).headers, { Authorization: 'Bearer t2' });
  });
});

describe('DriveClient: auth', () => {
  test('a 401 refreshes the token once and retries', async () => {
    const asked: boolean[] = [];
    const { server, client } = setup(async (refresh) => {
      asked.push(refresh);
      return refresh ? 't2' : 'stale';
    });
    server.validTokens = new Set(['t2']);
    server.add('a', 'dir');
    assert.equal((await client.listChildren('dir')).length, 1);
    assert.deepEqual(asked, [false, true]);
    // The fresh token is cached.
    await client.listChildren('dir');
    assert.deepEqual(asked, [false, true]);
  });

  test('invalid_grant on refresh is revoked (final)', async () => {
    const { server, client } = setup(async (refresh) => {
      if (refresh) throw new Error('invalid_grant: Token has been expired or revoked.');
      return 'stale';
    });
    server.validTokens = new Set();
    await rejectsWith(client.listChildren('dir'), 'revoked');
  });

  test('getToken reporting revoked is revoked', async () => {
    const { server, client } = setup(async (refresh) => (refresh ? { error: 'revoked' } : 'stale'));
    server.validTokens = new Set();
    await rejectsWith(client.getText('x'), 'revoked');
  });

  test('a temporary failure is signed-out (not final), and the next call tries again', async () => {
    let fail = true;
    const { server, client } = setup(async (refresh) => {
      if (refresh && fail) throw new Error('a temporary error');
      return refresh ? 't2' : 'stale';
    });
    server.validTokens = new Set(['t2']);
    await rejectsWith(client.listChildren('dir'), 'signed-out');
    fail = false;
    assert.deepEqual(await client.listChildren('dir'), []);
  });

  test('a second 401 after a refresh is signed-out; a network token failure is network', async () => {
    const { server, client } = setup(async (refresh) => (refresh ? 'still-bad' : 'stale'));
    server.validTokens = new Set();
    await rejectsWith(client.listChildren('dir'), 'signed-out');
    const other = setup(async (refresh) => (refresh ? { error: 'network' } : 'stale'));
    other.server.validTokens = new Set();
    await rejectsWith(other.client.listChildren('dir'), 'network');
    assert.equal(classifyTokenFailure({ error: 'whatever', message: 'invalid_grant' }), 'revoked');
    assert.equal(classifyTokenFailure(new Error('boom')), 'signed-out');
  });
});

describe('DriveClient: retries', () => {
  test('5xx backs off and succeeds', async () => {
    const { server, client, sleeps } = setup();
    server.faults = [() => err(503, 'backendError'), () => err(500, 'backendError')];
    assert.deepEqual(await client.listChildren('dir'), []);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  test('5xx until the retries run out is a network error', async () => {
    const { server, client, sleeps } = setup();
    server.faults = Array.from({ length: 10 }, () => () => err(502, 'badGateway'));
    await rejectsWith(client.getText('x'), 'network');
    assert.equal(sleeps.length, 3);
  });

  test('403 rate limits and 429 are retried, Retry-After wins', async () => {
    const { server, client, sleeps } = setup();
    server.faults = [() => err(403, 'userRateLimitExceeded'), () => response(429, '', { 'Retry-After': '7' }), () => err(403, 'rateLimitExceeded')];
    assert.deepEqual(await client.listChildren('dir'), []);
    assert.deepEqual(sleeps, [1000, 7000, 4000]);
  });

  test('403 storageQuotaExceeded is quota, without retrying', async () => {
    const { server, client, sleeps } = setup();
    server.faults = [() => err(403, 'storageQuotaExceeded')];
    await rejectsWith(client.putText('dir', 'a.json', '{}', { fileId: null }), 'quota');
    assert.deepEqual(sleeps, []);
  });

  test('a thrown network error is retried', async () => {
    const { server, client } = setup();
    server.faults = [() => 'throw'];
    assert.deepEqual(await client.listChildren('dir'), []);
  });

  test('an abort ends a backoff wait at once (the injected sleep never resolves here)', async () => {
    const server = new FakeDrive();
    server.faults = [() => err(503, 'backendError')];
    let slept = 0;
    const client = new DriveClient({
      fetch: server.fetch,
      getToken: async () => 't1',
      sleep: () => {
        slept++;
        return new Promise<void>(() => {});
      },
      random: () => 0,
    });
    const ac = new AbortController();
    const p = client.listChildren('dir', { signal: ac.signal });
    while (slept === 0) await new Promise((r) => setImmediate(r));
    ac.abort();
    await assert.rejects(p, (e: unknown) => isAbortError(e));
  });

  test('other 403s are not retried', async () => {
    const { server, client, sleeps } = setup();
    server.faults = [() => err(403, 'appNotAuthorizedToFile')];
    await rejectsWith(client.getText('x'), 'unknown');
    assert.deepEqual(sleeps, []);
  });
});
