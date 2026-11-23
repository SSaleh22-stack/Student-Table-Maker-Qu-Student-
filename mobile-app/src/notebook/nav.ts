/**
 * Notebook (المذكرات) navigation. Self-contained: it takes plain strings (an encoded location from
 * core/model/location.ts encodeLoc, or a section key) and imports nothing from src/notebook, so any
 * package can use it. Routes are cast to Href, because typed routes only know a route once its
 * file exists.
 */
import { router, type Href } from 'expo-router';

const enc = encodeURIComponent;

function go(href: string, replace = false): void {
  if (replace) router.replace(href as Href);
  else router.push(href as Href);
}

/** The library (Figma 02). */
export function openLibrary(): void {
  go('/notebook');
}

/** A library section: 'courses' | 'mine' | 'unfiled' | 'course:CODE' | 'folder:ID' (Figma 03). */
export function openSection(key: string): void {
  go(`/notebook/section/${enc(key)}`);
}

/** Recently deleted (Figma 16). */
export function openDeleted(): void {
  go('/notebook/deleted');
}

/** The editor for a notebook. With replace, the current screen (for example receive or import) is replaced. */
export function openNotebook(id: string, o?: { replace?: boolean }): void {
  go(`/notebook/edit/${enc(id)}`, o?.replace === true);
}

/** The pages view of a notebook (Figma 13). current: the page the editor shows (?current=<pageId>). */
export function openPages(id: string, o?: { current?: string }): void {
  go(`/notebook/pages/${enc(id)}${o?.current ? `?current=${enc(o.current)}` : ''}`);
}

/** Notebook settings (Figma 15). */
export function openNotebookSettings(): void {
  go('/notebook/settings');
}

/** Restore from backup. */
export function openRestore(): void {
  go('/notebook/restore');
}

/** The screen for a file shared into the app or opened with it (Figma 05). */
export function openReceive(): void {
  go('/notebook/receive');
}

/** Import from a source into a new notebook, optionally inside a location (an encodeLoc string). */
export function openImport(source: 'pdf' | 'scan' | 'photos' | 'camera', loc?: string): void {
  go(`/notebook/import?source=${enc(source)}${loc ? `&loc=${enc(loc)}` : ''}`);
}

/** The feedback screen, opened as a suggestion about the notebook. */
export function openNotebookFeedback(): void {
  go('/feedback?type=suggestion&topic=notebook');
}

/** Goes back when there is history (a deep link or a cold start has none), otherwise runs fallback. */
export function goBackOr(fallback: () => void): void {
  if (router.canGoBack()) router.back();
  else fallback();
}
