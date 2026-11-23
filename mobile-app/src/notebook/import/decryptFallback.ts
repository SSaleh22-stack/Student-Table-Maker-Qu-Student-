/**
 * Decrypts a password-protected PDF in JS with @cantoo/pdf-lib, for the files the native engine
 * cannot save without security (saveDecrypted rejected ERR_PDF_UNSUPPORTED). Ruling (b): assets are
 * stored decrypted, inside the app only.
 *
 * The whole file goes through Hermes memory (load + save), so the caller checks free space first
 * (the import's low-storage check), and very large files may fail with 'unsupported'.
 *
 * Rejects PdfError:
 * - 'wrong-password' when the file is encrypted and the password does not open it;
 * - 'damaged' when pdf-lib cannot parse the file at all;
 * - 'unsupported' when the output would still be encrypted, or the file is too large for memory.
 */
import { PDFDocument } from '@cantoo/pdf-lib';
import { File } from 'expo-file-system';

import { PdfError } from '@/notebook/core/contracts/pdf';

/** Files above this are not loaded into JS memory (about the limit a 3 GB device can hold twice). */
export const DECRYPT_FALLBACK_MAX_BYTES = 400 * 1024 * 1024;

export async function decryptFallback(src: string, password: string, dest: string): Promise<void> {
  const input = new File(src);
  const size = input.size ?? 0;
  if (size > DECRYPT_FALLBACK_MAX_BYTES) throw new PdfError('unsupported', 'PDF too large for the JS decrypt fallback');
  let bytes: Uint8Array;
  try {
    bytes = await input.bytes();
  } catch (e) {
    throw new PdfError('io', e instanceof Error ? e.message : String(e));
  }

  // Is it readable at all, and is it encrypted?
  let probe: PDFDocument;
  try {
    probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (e) {
    throw new PdfError('damaged', e instanceof Error ? e.message : String(e));
  }
  const encrypted = probe.isEncrypted;

  let doc: PDFDocument;
  try {
    doc = encrypted ? await PDFDocument.load(bytes, { password, updateMetadata: false }) : probe;
  } catch (e) {
    // The file parsed without the password, so a failure with it means the password is wrong.
    throw new PdfError('wrong-password', e instanceof Error ? e.message : String(e));
  }

  let out: Uint8Array;
  try {
    out = await doc.save({ useObjectStreams: true });
  } catch (e) {
    throw new PdfError('unsupported', e instanceof Error ? e.message : String(e));
  }

  // The copy must open without a password, or the engine would ask again forever.
  try {
    const check = await PDFDocument.load(out, { ignoreEncryption: true, updateMetadata: false });
    if (check.isEncrypted) throw new PdfError('unsupported', 'pdf-lib kept the encryption');
  } catch (e) {
    if (e instanceof PdfError) throw e;
    throw new PdfError('unsupported', e instanceof Error ? e.message : String(e));
  }

  try {
    const target = new File(dest);
    if (target.exists) target.delete();
    target.create({ intermediates: true });
    await target.write(out);
  } catch (e) {
    throw new PdfError('io', e instanceof Error ? e.message : String(e));
  }
}
