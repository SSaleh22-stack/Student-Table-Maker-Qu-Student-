/**
 * The small part of fetch that the Drive client (drive.ts) and the resumable uploader (resumable.ts)
 * use. Core never touches a global fetch: the backup service (P20) injects one.
 *
 * In the app that MUST be expo/fetch (built into expo 58), never React Native's global fetch: expo/fetch
 * sends a Uint8Array body as raw bytes (RN fetch would need base64 or a Blob). expo/fetch's own
 * parameter types are wider DOM types (BodyInit, AbortSignal), so P20 adapts it with a one-line cast:
 *
 *   import { fetch as expoFetch } from 'expo/fetch';
 *   const driveFetch: FetchLike = (url, init) => expoFetch(url, init as Parameters<typeof expoFetch>[1]);
 *
 * Node's global fetch fits the same shape, which is what the tests use through a fake server.
 */
import type { AbortSignalLike } from '../contracts/backup.ts';

export type FetchBody = Uint8Array | string;

export interface FetchInit {
  method?: string;
  /** Plain header map (names are sent as given; Drive treats them case-insensitively). */
  headers?: Record<string, string>;
  /** Uint8Array is sent as raw bytes (chunk uploads); string as UTF-8 (JSON and multipart text). */
  body?: FetchBody;
  signal?: AbortSignalLike;
  /** 'manual' for resumable chunk PUTs, so a 308 Resume Incomplete is never followed as a redirect. */
  redirect?: 'follow' | 'manual' | 'error';
  credentials?: 'omit' | 'include' | 'same-origin';
}

export interface HeadersLike {
  /** Case-insensitive; null when absent. */
  get(name: string): string | null;
}

export interface ResponseLike {
  readonly status: number;
  readonly headers: HeadersLike;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<ResponseLike>;
