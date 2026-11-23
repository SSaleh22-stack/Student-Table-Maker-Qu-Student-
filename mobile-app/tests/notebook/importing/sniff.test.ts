import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  extOfName,
  imageExtFromMeta,
  imageExtOf,
  isPdfHead,
  isQunoteHead,
  sniffKind,
  titleFromName,
} from '../../../src/notebook/core/importing/sniff.ts';
import { createZipWriter, memorySink } from '../../../src/notebook/core/qunote/zipWrite.ts';

const bytes = (...parts: (string | number[])[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
};

/** A zip whose first entry has the given name, written by the real .qunote writer. */
async function zipWithFirst(name: string): Promise<Uint8Array> {
  const sink = memorySink();
  const w = createZipWriter(sink, { now: () => Date.UTC(2026, 0, 1) });
  await w.addBytes(name, new TextEncoder().encode('{"format":"qunote"}'), { deflate: name.endsWith('.json') });
  await w.addBytes('notebook.json', new TextEncoder().encode('{}'), { deflate: true });
  await w.finish();
  return sink.bytes();
}

describe('sniffKind', () => {
  test('PDF by its header, also after leading junk', () => {
    assert.ok(isPdfHead(bytes('%PDF-1.7\n')));
    assert.ok(isPdfHead(bytes([0xef, 0xbb, 0xbf], '\n\n%PDF-1.4')));
    assert.equal(sniffKind(bytes('%PDF-1.7\n'), 'lecture', undefined), 'pdf');
    assert.equal(sniffKind(bytes('%PDF-2.0'), 'x.bin', 'application/octet-stream'), 'pdf');
  });

  test('a .qunote is a zip whose first entry is qunote.json', async () => {
    const q = await zipWithFirst('qunote.json');
    assert.ok(isQunoteHead(q));
    assert.equal(sniffKind(q.subarray(0, 1024), 'note.zip', 'application/zip'), 'qunote');
    const other = await zipWithFirst('readme.txt');
    assert.ok(!isQunoteHead(other));
    assert.equal(sniffKind(other, 'stuff.zip', 'application/zip'), 'unknown');
    // A zip named .qunote goes to inspectQunote, which reports the precise error.
    assert.equal(sniffKind(other, 'stuff.qunote'), 'qunote');
    assert.equal(sniffKind(other, 'stuff', 'application/vnd.qustudent.qunote'), 'qunote');
  });

  test('images by their magic numbers', () => {
    assert.equal(imageExtOf(bytes([0xff, 0xd8, 0xff, 0xe0]))!, 'jpg');
    assert.equal(imageExtOf(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))!, 'png');
    assert.equal(imageExtOf(bytes('GIF89a')), 'gif');
    assert.equal(imageExtOf(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')), 'webp');
    assert.equal(imageExtOf(bytes([0, 0, 0, 24], 'ftypheic', [0, 0, 0, 0])), 'heic');
    assert.equal(imageExtOf(bytes([0, 0, 0, 24], 'ftypmp42')), null);
    assert.equal(sniffKind(bytes([0xff, 0xd8, 0xff, 0xdb]), 'IMG_1.JPG'), 'image');
  });

  test('bytes win over a wrong name', () => {
    assert.equal(sniffKind(bytes([0xff, 0xd8, 0xff, 0xdb]), 'fake.pdf', 'application/pdf'), 'image');
    assert.equal(sniffKind(bytes('%PDF-1.3'), 'photo.jpg', 'image/jpeg'), 'pdf');
  });

  test('readable bytes that match nothing: a .pdf name still routes to the PDF error', () => {
    assert.equal(sniffKind(bytes('<html><body>'), 'Lecture.pdf'), 'pdf');
    assert.equal(sniffKind(bytes('hello'), 'notes.txt', 'text/plain'), 'unknown');
  });

  test('no bytes: the name and MIME type decide', () => {
    const none = new Uint8Array(0);
    assert.equal(sniffKind(none, 'a.PDF'), 'pdf');
    assert.equal(sniffKind(none, 'a.qunote'), 'qunote');
    assert.equal(sniffKind(none, 'a', 'image/png'), 'image');
    assert.equal(sniffKind(none, 'a.heic'), 'image');
    assert.equal(sniffKind(none, 'a', 'application/octet-stream'), 'unknown');
    assert.equal(sniffKind(none, undefined, undefined), 'unknown');
  });
});

describe('names', () => {
  test('extOfName', () => {
    assert.equal(extOfName('Lecture-07.PDF'), 'pdf');
    assert.equal(extOfName('/a/b.c/file'), '');
    assert.equal(extOfName('.hidden'), '');
    assert.equal(extOfName(undefined), '');
  });

  test('titleFromName drops the extension and folders', () => {
    assert.equal(titleFromName('Lecture-07-Recursion.pdf'), 'Lecture-07-Recursion');
    assert.equal(titleFromName('/tmp/Inbox/محاضرة_5.pdf'), 'محاضرة 5');
    assert.equal(titleFromName('notes'), 'notes');
    assert.equal(titleFromName(''), '');
  });

  test('imageExtFromMeta', () => {
    assert.equal(imageExtFromMeta('a.jpeg'), 'jpg');
    assert.equal(imageExtFromMeta('a', 'image/heif'), 'heic');
    assert.equal(imageExtFromMeta('a', 'image/x-png'), 'png');
    assert.equal(imageExtFromMeta('a', 'application/pdf'), null);
  });
});
