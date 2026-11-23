/**
 * Library views derived from the index (pure). NB-10, NB-10a, NB-11, NB-12, NB-13, NB-15.
 *
 * - courseFolders: one folder per course code. Codes in the timetable (AppData.chosen) come first,
 *   in timetable order, with inTimetable true. Codes still used by notebooks but no longer chosen are
 *   ORPHANS (inTimetable false), named from courseNames (else the code). Nothing moves on its own.
 * - Where a notebook lives: a user folder wins over a course code (locationOf). A folderId whose
 *   folder no longer exists counts as unfiled.
 * - sections(): courses, then my folders, then unfiled notebooks, each cut to 4 with a total.
 * - Trash: deleted notebooks stay 30 days (trashExpired / trashDaysLeft).
 */
import { deepEqual } from '../model/index.ts';
import type { CourseFolder, Folder, Id, IndexCover, IndexEntry, IndexFile, IsoDate, LocationKey, Notebook, Page, SortKey } from '../model/index.ts';
import { searchEntries, matchesTokens, queryTokens } from './search.ts';
import type { SearchContext } from './search.ts';
import type { FolderInfo, SectionSlice, Sections } from '../session/types.ts';

export const SECTION_LIMIT = 4;
export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const time = (iso: IsoDate | undefined): number => {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

// ===== index entries

/** The index cover for a first page: its paper, or pdf / image. */
export function coverOfPage(page: Page): IndexCover {
  const bg = page.background;
  if (bg.kind === 'pdf') return { kind: 'pdf' };
  if (bg.kind === 'image') return { kind: 'image' };
  return { kind: 'paper', paper: { style: bg.paper.style, color: bg.paper.color, size: bg.paper.size } };
}

/**
 * The index entry of a notebook. thumbRev is 0 and needsThumb, bytes and importing are not set:
 * those belong to the store; merge with upsertEntry().
 */
export function entryFromNotebook(nb: Notebook, cover: IndexCover): IndexEntry {
  const e: IndexEntry = {
    id: nb.id,
    title: nb.title,
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
    pageCount: nb.pageIds.length,
    recordingCount: nb.recordings.length,
    hasPdf: Object.values(nb.assets).some((a) => a.kind === 'pdf'),
    cover,
    thumbRev: 0,
    contentRev: nb.contentRev,
  };
  if (nb.folderId !== undefined) e.folderId = nb.folderId;
  if (nb.courseCode !== undefined) e.courseCode = nb.courseCode;
  if (nb.deletedAt !== undefined) e.deletedAt = nb.deletedAt;
  return e;
}

/**
 * Inserts or replaces an entry. Location and deletedAt come from `e` (absent = cleared). The
 * store-owned fields thumbRev, needsThumb, bytes and importing are kept from the previous entry
 * unless `e` sets them. readOnly comes from `e`. Returns f itself when nothing changed.
 *
 * A READ-ONLY entry (saved by a newer app, so its notebook.json is never written) keeps the previous
 * entry's title, location and deletedAt: library ops change only the index for such a notebook, and
 * the file's values would undo a rename, move or trash.
 */
export function upsertEntry(f: IndexFile, e: IndexEntry): IndexFile {
  const i = f.entries.findIndex((x) => x.id === e.id);
  const prev = i >= 0 ? f.entries[i] : undefined;
  const next: IndexEntry = { ...e };
  if (prev && e.readOnly) {
    next.title = prev.title;
    delete next.folderId;
    delete next.courseCode;
    delete next.deletedAt;
    if (prev.folderId !== undefined) next.folderId = prev.folderId;
    if (prev.courseCode !== undefined) next.courseCode = prev.courseCode;
    if (prev.deletedAt !== undefined) next.deletedAt = prev.deletedAt;
  }
  if (prev) {
    next.thumbRev = Math.max(prev.thumbRev, e.thumbRev);
    if (e.needsThumb === undefined && prev.needsThumb) next.needsThumb = true;
    if (e.bytes === undefined && prev.bytes !== undefined) next.bytes = prev.bytes;
    if (e.importing === undefined && prev.importing) next.importing = prev.importing;
  }
  if (prev && deepEqual(prev, next)) return f;
  const entries = f.entries.slice();
  if (i >= 0) entries[i] = next;
  else entries.push(next);
  return { ...f, entries };
}

/** Changes some fields of an entry (absent entry: f unchanged). undefined values clear the field. */
export function patchEntry(f: IndexFile, id: Id, patch: Partial<IndexEntry>): IndexFile {
  const i = f.entries.findIndex((x) => x.id === id);
  if (i < 0) return f;
  const next: IndexEntry = { ...f.entries[i] };
  for (const k of Object.keys(patch) as (keyof IndexEntry)[]) {
    const v = patch[k];
    if (v === undefined) delete (next as Partial<IndexEntry>)[k];
    else (next as unknown as Record<string, unknown>)[k] = v;
  }
  const entries = f.entries.slice();
  entries[i] = next;
  return { ...f, entries };
}

export function removeEntry(f: IndexFile, id: Id): IndexFile {
  if (!f.entries.some((e) => e.id === id)) return f;
  return { ...f, entries: f.entries.filter((e) => e.id !== id) };
}

// ===== locations

/** Where an entry is shown: a folder that exists wins, then a course code, else unfiled. */
export function entryLocation(e: Pick<IndexEntry, 'folderId' | 'courseCode'>, folders: readonly Folder[]): LocationKey {
  if (e.folderId && folders.some((f) => f.id === e.folderId)) return { kind: 'folder', id: e.folderId };
  if (e.courseCode) return { kind: 'course', code: e.courseCode };
  return { kind: 'unfiled' };
}

const live = (f: IndexFile) => f.entries.filter((e) => !e.deletedAt);

// ===== course folders

/**
 * Course folders: chosen codes (in timetable order, inTimetable) then orphan codes used by
 * non-deleted notebooks (sorted by name). name = chosen name, else courseNames[code], else code.
 */
export function courseFolders(chosen: readonly { code: string; name: string }[], f: IndexFile): CourseFolder[] {
  const counts = new Map<string, number>();
  for (const e of live(f)) {
    const loc = entryLocation(e, f.folders);
    if (loc.kind === 'course') counts.set(loc.code, (counts.get(loc.code) ?? 0) + 1);
  }
  const out: CourseFolder[] = [];
  const seen = new Set<string>();
  for (const c of chosen) {
    const code = String(c.code ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name: (c.name || '').trim() || f.courseNames[code] || code, inTimetable: true, count: counts.get(code) ?? 0 });
  }
  const orphans: CourseFolder[] = [];
  for (const [code, count] of counts) {
    if (seen.has(code)) continue;
    orphans.push({ code, name: f.courseNames[code] || code, inTimetable: false, count });
  }
  orphans.sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.code.localeCompare(b.code));
  return [...out, ...orphans];
}

/** Records the names of the chosen courses in courseNames. Returns f itself when nothing changed. */
export function updateCourseNames(f: IndexFile, chosen: readonly { code: string; name: string }[]): IndexFile {
  let names: Record<string, string> | null = null;
  for (const c of chosen) {
    const code = String(c.code ?? '').trim();
    const name = String(c.name ?? '').trim();
    if (!code || !name || code === '__proto__' || code.length > 40) continue;
    if (f.courseNames[code] === name) continue;
    if (!names) names = { ...f.courseNames };
    names[code] = name.slice(0, 200);
  }
  return names ? { ...f, courseNames: names } : f;
}

// ===== sorting and listing

/** updated: newest edit first; name: Arabic collation (ties newest first); created: newest first. */
export function sortEntries<T extends Pick<IndexEntry, 'title' | 'updatedAt' | 'createdAt' | 'id'>>(list: readonly T[], sort: SortKey): T[] {
  const out = list.slice();
  const byUpdated = (a: T, b: T) => time(b.updatedAt) - time(a.updatedAt);
  const tie = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (sort === 'name') out.sort((a, b) => a.title.localeCompare(b.title, 'ar', { sensitivity: 'base', numeric: true }) || byUpdated(a, b) || tie(a, b));
  else if (sort === 'created') out.sort((a, b) => time(b.createdAt) - time(a.createdAt) || byUpdated(a, b) || tie(a, b));
  else out.sort((a, b) => byUpdated(a, b) || tie(a, b));
  return out;
}

export function searchContext(f: IndexFile, chosen?: readonly { code: string; name: string }[]): SearchContext {
  return { folders: f.folders, courseNames: f.courseNames, chosen };
}

/**
 * The notebooks of a location ('deleted': the trash, newest deletion first; 'all': every
 * non-deleted notebook), filtered by the query and sorted.
 */
export function listEntries(
  f: IndexFile,
  where: LocationKey | 'deleted' | 'all',
  sort: SortKey,
  q?: string,
  chosen?: readonly { code: string; name: string }[],
): IndexEntry[] {
  const ctx = searchContext(f, chosen);
  if (where === 'deleted') {
    const del = searchEntries(
      f.entries.filter((e) => !!e.deletedAt),
      q,
      ctx,
    );
    return del.sort((a, b) => time(b.deletedAt) - time(a.deletedAt) || (a.id < b.id ? -1 : 1));
  }
  let list = live(f);
  if (where !== 'all') {
    list = list.filter((e) => {
      const loc = entryLocation(e, f.folders);
      if (where.kind === 'folder') return loc.kind === 'folder' && loc.id === where.id;
      if (where.kind === 'course') return loc.kind === 'course' && loc.code === where.code;
      return loc.kind === 'unfiled';
    });
  }
  return sortEntries(searchEntries(list, q, ctx), sort);
}

/** User folders with their notebook count and last edit, sorted (name sort: by name; else by order). */
export function folderInfos(f: IndexFile, sort: SortKey): FolderInfo[] {
  const counts = new Map<Id, { count: number; last?: IsoDate }>();
  for (const e of live(f)) {
    const loc = entryLocation(e, f.folders);
    if (loc.kind !== 'folder') continue;
    const c = counts.get(loc.id) ?? { count: 0 };
    c.count++;
    if (!c.last || time(e.updatedAt) > time(c.last)) c.last = e.updatedAt;
    counts.set(loc.id, c);
  }
  const out: FolderInfo[] = f.folders.map((x) => {
    const c = counts.get(x.id);
    const info: FolderInfo = { ...x, count: c?.count ?? 0 };
    if (c?.last) info.lastUpdatedAt = c.last;
    return info;
  });
  if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, 'ar', { sensitivity: 'base', numeric: true }) || a.order - b.order);
  else if (sort === 'updated') out.sort((a, b) => time(b.lastUpdatedAt ?? b.createdAt) - time(a.lastUpdatedAt ?? a.createdAt) || a.order - b.order);
  else out.sort((a, b) => a.order - b.order || time(a.createdAt) - time(b.createdAt));
  return out;
}

const slice = <T>(list: T[]): SectionSlice<T> => ({ items: list.slice(0, SECTION_LIMIT), total: list.length });

/**
 * The three library sections (NB-10, NB-10a), each cut to SECTION_LIMIT with its total. With a
 * query, folders and courses are kept when their name matches or a notebook in them matches, the
 * unfiled section keeps matching notebooks, and results lists every matching notebook.
 */
export function sections(
  f: IndexFile,
  courses: readonly CourseFolder[],
  sort: SortKey,
  q?: string,
  chosen?: readonly { code: string; name: string }[],
): Sections {
  const query = (q ?? '').trim();
  const tokens = queryTokens(query);
  const ctx = searchContext(f, chosen);
  const results = tokens.length ? sortEntries(searchEntries(live(f), query, ctx), sort) : [];
  const hitCourses = new Set<string>();
  const hitFolders = new Set<Id>();
  for (const e of results) {
    const loc = entryLocation(e, f.folders);
    if (loc.kind === 'course') hitCourses.add(loc.code);
    if (loc.kind === 'folder') hitFolders.add(loc.id);
  }
  let courseList = courses.slice();
  if (sort === 'name') courseList.sort((a, b) => a.name.localeCompare(b.name, 'ar', { sensitivity: 'base', numeric: true }));
  let folderList = folderInfos(f, sort);
  if (tokens.length) {
    courseList = courseList.filter((c) => hitCourses.has(c.code) || matchesTokens(tokens, [c.name, c.code]));
    folderList = folderList.filter((x) => hitFolders.has(x.id) || matchesTokens(tokens, [x.name]));
  }
  const unfiled = listEntries(f, { kind: 'unfiled' }, sort, query, chosen);
  return { courses: slice(courseList), mine: slice(folderList), unfiled: slice(unfiled), query, results };
}

// ===== trash

/** Ids of trashed notebooks deleted at least `days` (30) days ago. */
export function trashExpired(f: IndexFile, now: number, days: number = TRASH_DAYS): Id[] {
  const cutoff = now - days * DAY_MS;
  return f.entries.filter((e) => e.deletedAt && time(e.deletedAt) <= cutoff).map((e) => e.id);
}

/** Whole days left before a trashed notebook is removed for good (0..30; 30 right after deleting). */
export function trashDaysLeft(e: Pick<IndexEntry, 'deletedAt'>, now: number, days: number = TRASH_DAYS): number {
  if (!e.deletedAt) return days;
  const left = days * DAY_MS - (now - time(e.deletedAt));
  return Math.max(0, Math.min(days, Math.ceil(left / DAY_MS)));
}
