/**
 * Library locations as plain strings, for routes and nav.ts:
 * 'course:CODE' | 'folder:ID' | 'unfiled'. The string is not URI-encoded here; nav.ts encodes it.
 */
import type { Id, LocationKey, SectionKey } from './types.ts';

export function encodeLoc(l: LocationKey): string {
  switch (l.kind) {
    case 'course':
      return `course:${l.code}`;
    case 'folder':
      return `folder:${l.id}`;
    default:
      return 'unfiled';
  }
}

/** Parses an encoded location. Anything else (including an empty code or id) gives null. */
export function decodeLoc(s: string): LocationKey | null {
  if (typeof s !== 'string') return null;
  if (s === 'unfiled') return { kind: 'unfiled' };
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const kind = s.slice(0, i);
  const rest = s.slice(i + 1);
  if (!rest.trim()) return null;
  if (kind === 'course') return { kind: 'course', code: rest };
  if (kind === 'folder') return { kind: 'folder', id: rest };
  return null;
}

export function sameLoc(a: LocationKey | null | undefined, b: LocationKey | null | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'course') return a.code === (b as { code: string }).code;
  if (a.kind === 'folder') return a.id === (b as { id: Id }).id;
  return true;
}

/** The library section that shows notebooks at this location. */
export function sectionKeyOf(l: LocationKey): SectionKey {
  if (l.kind === 'course') return `course:${l.code}`;
  if (l.kind === 'folder') return `folder:${l.id}`;
  return 'unfiled';
}

/**
 * Where a notebook (or index entry) lives: a user folder wins over a course code, else unfiled.
 * Library ops keep at most one of the two set.
 */
export function locationOf(e: { folderId?: Id; courseCode?: string }): LocationKey {
  if (e.folderId) return { kind: 'folder', id: e.folderId };
  if (e.courseCode) return { kind: 'course', code: e.courseCode };
  return { kind: 'unfiled' };
}

/** The folderId / courseCode fields for a location (both keys present, unused one undefined). */
export function locationFields(l: LocationKey): { folderId: Id | undefined; courseCode: string | undefined } {
  if (l.kind === 'folder') return { folderId: l.id, courseCode: undefined };
  if (l.kind === 'course') return { folderId: undefined, courseCode: l.code };
  return { folderId: undefined, courseCode: undefined };
}
