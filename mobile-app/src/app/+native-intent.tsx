/**
 * Rewrites system links before Expo Router handles them (NB-31, NB-73).
 *
 * - file:// (iOS "Open in", Android file VIEW) and content:// (Android VIEW from WhatsApp, Files,
 *   Gmail, …): the file is stashed (metadata only) and the app opens /notebook/receive.
 * - '<scheme>://expo-sharing' (Android share sheet, expo-sharing): the resolved payloads are read
 *   (expo-sharing copies each shared file into its cache) and stashed with sharedPayload true.
 *   clearSharedPayloads is NOT called here: the receive screen calls finishIncoming() only after
 *   the file is copied into a staging job, or when the student cancels.
 * - Every other path (the app's own links, the dev client) is returned unchanged.
 *
 * Never throws (a throw here can crash the app): any failure falls back to the path as it came.
 */
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { IncomingFile } from '@/notebook/contracts/importing';
import { nameFromUri, setIncoming } from '@/notebook/import/incoming';

const RECEIVE = '/notebook/receive';

function isShareLink(path: string): boolean {
  // '<scheme>://expo-sharing' (optionally with a path or query).
  return /^[a-z][a-z0-9+.-]*:\/\/expo-sharing(?:[/?#]|$)/i.test(path);
}

function fileMeta(uri: string): { name: string; size?: number } {
  let name = '';
  let size: number | undefined;
  try {
    const f = new File(uri);
    name = f.name || '';
    const s = f.size;
    if (typeof s === 'number' && Number.isFinite(s) && s >= 0) size = s;
  } catch {
    // A content:// provider may not answer: the receive screen reads the size after the copy.
  }
  if (!name || /^\d+$/.test(name)) name = nameFromUri(uri) || name;
  return size === undefined ? { name } : { name, size };
}

const FILE_SHARES = new Set(['file', 'image', 'video', 'audio']);

async function sharedFiles(): Promise<IncomingFile[]> {
  // Text and links are not ours: skip resolving them (a shared URL is fetched over the network to
  // resolve it, which would hold the app's launch on a slow connection).
  try {
    if (!Sharing.getSharedPayloads().some((p) => FILE_SHARES.has(p.shareType))) return [];
  } catch {
    // Resolve below.
  }
  const payloads = await Sharing.getResolvedSharedPayloadsAsync();
  const out: IncomingFile[] = [];
  for (const p of payloads) {
    if (!p.contentUri || p.contentType === 'text' || p.contentType === 'website' || p.contentType == null) continue;
    const file: IncomingFile = {
      uri: p.contentUri,
      name: p.originalName || nameFromUri(p.contentUri),
      via: 'share',
      sharedPayload: true,
    };
    const mime = p.contentMimeType || p.mimeType;
    if (mime) file.mimeType = mime;
    if (typeof p.contentSize === 'number' && p.contentSize >= 0) file.size = p.contentSize;
    out.push(file);
  }
  return out;
}

export async function redirectSystemPath({ path }: { path: string; initial: boolean }): Promise<string | null> {
  try {
    if (Platform.OS === 'web' || typeof path !== 'string') return path;
    if (isShareLink(path)) {
      const files = await sharedFiles();
      if (!files.length) return '/';
      setIncoming(files);
      return RECEIVE;
    }
    if (path.startsWith('file://') || path.startsWith('content://')) {
      const meta = fileMeta(path);
      setIncoming([
        {
          uri: path,
          name: meta.name,
          ...(meta.size !== undefined ? { size: meta.size } : {}),
          via: Platform.OS === 'ios' ? 'open-in' : 'view',
          sharedPayload: false,
        },
      ]);
      return RECEIVE;
    }
    return path;
  } catch {
    // A share link is not a route: land on the home screen rather than the unmatched-route screen.
    return typeof path === 'string' && isShareLink(path) ? '/' : path;
  }
}
