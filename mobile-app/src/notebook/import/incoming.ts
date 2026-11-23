/**
 * Files handed to the app from outside (NB-31, NB-73): iOS "Open in" (a copy in Documents/Inbox,
 * since LSSupportsOpeningDocumentsInPlace is false), Android VIEW intents (content:// or file://) and
 * Android share payloads (expo-sharing, '<scheme>://expo-sharing').
 *
 * +native-intent.tsx stores only METADATA here (setIncoming) and routes to /notebook/receive. The
 * files themselves stay where the system put them until the receive screen has copied them into a
 * staging job. Only then (or when the student cancels, or at the next boot) does finishIncoming()
 * clear the share payload (Sharing.clearSharedPayloads deletes expo-sharing's cached copies) and
 * delete the iOS Inbox copy. Nothing calls clearSharedPayloads earlier.
 *
 * Every stash has a generation number (incomingGeneration), so a screen that was showing an older
 * stash never clears a newer one (a second share while the first is still on screen):
 * finishIncomingIf(gen).
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { IncomingFile } from '@/notebook/contracts/importing';

/** iOS deletes nothing in Documents/Inbox by itself; copies older than this go at boot. */
const INBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let stash: IncomingFile[] | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // A listener failing never stops the others.
    }
  }
}

/** Stores the files waiting for the receive screen (metadata only; nothing is copied or cleared). */
export function setIncoming(files: IncomingFile[]): void {
  stash = files.length ? files.map((f) => ({ ...f })) : null;
  generation++;
  emit();
}

/** The files waiting for the receive screen, or null. Does not clear them (finishIncoming does). */
export function takeIncoming(): IncomingFile[] | null {
  return stash ? stash.map((f) => ({ ...f })) : null;
}

/** Changes with every setIncoming (a new stash), not when a stash is finished. */
export function incomingGeneration(): number {
  return generation;
}

export function subscribeIncoming(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Documents/Inbox as a URI without a trailing slash (iOS "Open in" copies land here). */
function inboxUri(): string | null {
  if (Platform.OS !== 'ios') return null;
  try {
    return new Directory(Paths.document, 'Inbox').uri.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** The path part of a file URI, decoded, for comparing locations across URI spellings. */
function pathOf(uri: string): string {
  let p = uri.replace(/^file:\/\//, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // Keep it as it is.
  }
  // iOS reports /private/var/... and /var/... for the same container.
  return p.replace(/^\/private\//, '/');
}

/** True when uri is a file inside Documents/Inbox (ours to delete). */
export function isInboxFile(uri: string): boolean {
  const inbox = inboxUri();
  if (!inbox || !uri.startsWith('file:')) return false;
  const dir = `${pathOf(inbox)}/`;
  return pathOf(uri).startsWith(dir);
}

function deleteQuietly(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Boot cleanup tries again.
  }
}

async function clearPayloads(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    Sharing.clearSharedPayloads();
  } catch {
    // Not available in this build: nothing was cached.
  }
}

function finishFiles(files: IncomingFile[]): Promise<void> {
  for (const f of files) if (isInboxFile(f.uri)) deleteQuietly(f.uri);
  return files.some((f) => f.sharedPayload) ? clearPayloads() : Promise.resolve();
}

/**
 * The incoming files are no longer needed: they were copied into a staging job, or the student
 * cancelled. Clears the share payload (when there was one) and deletes the iOS Inbox copies.
 */
export async function finishIncoming(): Promise<void> {
  const files = stash;
  if (!files) return;
  stash = null;
  emit();
  await finishFiles(files);
}

/**
 * finishIncoming, but only while the stash is still generation `gen`: a newer share is left alone
 * (its payload must survive until its own screen copied it).
 */
export async function finishIncomingIf(gen: number): Promise<void> {
  if (gen !== generation || !stash) return;
  await finishIncoming();
}

/**
 * Boot cleanup (NotebookServices): share payloads and Inbox copies left by a run that ended before
 * finishIncoming. Skipped while a stash is waiting, or while this launch's share intent has not
 * been stashed yet (getSharedPayloads is not empty), so a fresh share is never lost.
 */
export async function cleanupIncomingLeftovers(now: number = Date.now()): Promise<void> {
  if (Platform.OS === 'web' || stash) return;
  if (Platform.OS === 'android') {
    try {
      if (Sharing.getSharedPayloads().length === 0) Sharing.clearSharedPayloads();
    } catch {
      // No share support in this build.
    }
  }
  const inbox = inboxUri();
  if (!inbox) return;
  try {
    const dir = new Directory(inbox);
    if (!dir.exists) return;
    for (const e of dir.list()) {
      // The creation time is when iOS copied the file into the Inbox (the modification time may be
      // the original's, days old), so a fresh "Open in" copy is never removed by mistake.
      let t: number | null = null;
      try {
        t = e instanceof File ? (e.creationTime ?? e.modificationTime ?? null) : (e.info().creationTime ?? e.info().modificationTime ?? null);
      } catch {
        t = null;
      }
      if (t !== null && now - t < INBOX_MAX_AGE_MS) continue;
      try {
        e.delete();
      } catch {
        // Next boot.
      }
    }
  } catch {
    // Next boot.
  }
}

/** A display name from a file or content URI ('' when there is none). */
export function nameFromUri(uri: string): string {
  const clean = uri.split(/[?#]/)[0].replace(/\/+$/, '');
  const last = clean.slice(clean.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
