/**
 * The network state the backup policy reads (core/backup/policy.ts: Wi-Fi only by default, NB-86b),
 * from expo-network. One native listener, added only while something subscribes (the backup
 * service subscribes only while backup is on).
 */
import * as Network from 'expo-network';

import type { NetworkInfo } from '@/notebook/core/backup/policy';

let current: NetworkInfo | null = null;
let sub: { remove(): void } | null = null;
const listeners = new Set<(n: NetworkInfo | null) => void>();

function toInfo(s: Network.NetworkState | null | undefined): NetworkInfo | null {
  if (!s) return null;
  return { type: s.type ?? null, isConnected: s.isConnected ?? null, isInternetReachable: s.isInternetReachable ?? null };
}

function emit(): void {
  for (const cb of [...listeners]) {
    try {
      cb(current);
    } catch {
      // One listener failing never stops the others.
    }
  }
}

/**
 * The latest known state, kept current by the native listener. null while nothing subscribes (or
 * before the first read): a value from before would be stale (the device may have left Wi-Fi), so
 * the caller then reads it fresh (readNetwork), which keeps 'Wi-Fi only' honest (NB-86b).
 */
export function lastNetwork(): NetworkInfo | null {
  return sub ? current : null;
}

/** Reads the state now (null when it cannot be read and no listener keeps a current value). */
export async function readNetwork(): Promise<NetworkInfo | null> {
  try {
    current = toInfo(await Network.getNetworkStateAsync());
  } catch {
    // Unknown: the policy treats null as offline (nothing runs on a network it cannot see).
    if (!sub) current = null;
  }
  return current;
}

/** Calls cb on every change (connected, disconnected, Wi-Fi to cellular…). Returns the unsubscribe. */
export function subscribeNetwork(cb: (n: NetworkInfo | null) => void): () => void {
  listeners.add(cb);
  if (!sub) {
    // A value read before the listener existed may be stale: the next evaluation reads it fresh.
    current = null;
    try {
      sub = Network.addNetworkStateListener((e) => {
        current = toInfo(e);
        emit();
      });
    } catch {
      sub = null;
    }
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && sub) {
      sub.remove();
      sub = null;
      current = null;
    }
  };
}
