/**
 * Library search (NB-16 style): Arabic-aware, case-insensitive matching of a query against a
 * notebook's title and the name (and code) of its folder or course.
 *
 * Normalization: diacritics (tashkeel, superscript alef) and tatweel removed; alef forms (أ إ آ ٱ)
 * -> ا; hamza carriers ؤ -> و, ئ -> ي, a lone ء dropped; taa marbuta ة -> ه; alef maqsura ى -> ي;
 * Arabic-Indic and Persian digits -> 0-9; Latin lowercased; whitespace collapsed.
 * Every word of the query must appear (in any order) for a match.
 */
import type { Folder, IndexEntry } from '../model/index.ts';

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalizeArabic(s: string): string {
  return String(s ?? '')
    .normalize('NFC')
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[آأإٱٲٳ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ئی]/g, 'ي')
    .replace(/ى/g, 'ي')
    .replace(/ء/g, '')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The normalized words of a query ([] for an empty query). */
export function queryTokens(q: string | undefined): string[] {
  const n = normalizeArabic(q ?? '');
  return n ? n.split(' ') : [];
}

/** True when every token occurs in at least one of the texts. */
export function matchesTokens(tokens: readonly string[], texts: readonly (string | undefined)[]): boolean {
  if (!tokens.length) return true;
  const hay = texts
    .filter((t): t is string => !!t)
    .map(normalizeArabic)
    .join(' \u0000 ');
  return tokens.every((t) => hay.includes(t));
}

export interface SearchContext {
  folders: readonly Folder[];
  courseNames: Readonly<Record<string, string>>;
  /** Names from the timetable (AppData.chosen), preferred over courseNames. */
  chosen?: readonly { code: string; name: string }[];
}

/** The texts a notebook is searched by: its title, its folder's name, its course's name and code. */
export function searchTexts(e: Pick<IndexEntry, 'title' | 'folderId' | 'courseCode'>, ctx: SearchContext): string[] {
  const out = [e.title];
  if (e.folderId) {
    const f = ctx.folders.find((x) => x.id === e.folderId);
    if (f) out.push(f.name);
  }
  if (e.courseCode) {
    out.push(e.courseCode);
    const chosen = ctx.chosen?.find((c) => c.code === e.courseCode)?.name;
    const name = chosen || ctx.courseNames[e.courseCode];
    if (name) out.push(name);
  }
  return out;
}

export function matchesEntry(e: Pick<IndexEntry, 'title' | 'folderId' | 'courseCode'>, q: string | undefined, ctx: SearchContext): boolean {
  return matchesTokens(queryTokens(q), searchTexts(e, ctx));
}

/** The entries that match the query (all of them for an empty query), in their order. */
export function searchEntries<T extends Pick<IndexEntry, 'title' | 'folderId' | 'courseCode'>>(entries: readonly T[], q: string | undefined, ctx: SearchContext): T[] {
  const tokens = queryTokens(q);
  if (!tokens.length) return entries.slice();
  return entries.filter((e) => matchesTokens(tokens, searchTexts(e, ctx)));
}
