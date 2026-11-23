/**
 * Disk layout under the notebooks root (Paths.document/notebooks on device):
 *
 *   library.json(.bak|.tmp)                 folders + course names (journaled)
 *   .staging/<jobId>/                        import work folders (wiped at boot)
 *   .staging/clipboard/<clipId>/             assets of the in-memory clipboard
 *   .inbox/                                  incoming shared / opened files waiting for the student
 *   .render-journal                          iOS native PDF render journal
 *   <id>/notebook.json(.bak|.tmp)
 *   <id>/pages/<pageId>.json(.bak|.tmp)
 *   <id>/assets/<fileId>.<ext>               PDFs and images
 *   <id>/audio/<fileId>.<ext>                recordings (m4a or aac)
 *   <id>/thumbs/cover.png                    360 px cover (written only by the thumbnail worker)
 *   <id>/quarantine/<name>.<epoch>.json      damaged saves kept aside
 *
 * Entries of the root whose name starts with '.' or that are not directories are not notebooks.
 */
import type { Asset, Id } from '../model/types.ts';
import { joinPath } from './adapter.ts';

export interface NotebookPaths {
  dir: string;
  json: string;
  pagesDir: string;
  page(pid: Id): string;
  assetsDir: string;
  asset(a: Pick<Asset, 'id' | 'kind' | 'ext'>): string;
  audioDir: string;
  thumbsDir: string;
  cover: string;
  quarantine: string;
}

export interface NbLayout {
  root: string;
  library: string;
  staging: string;
  /** A staging work folder for one import job. */
  stagingJob(jobId: Id): string;
  clipboardDir(clipId: string): string;
  inbox: string;
  renderJournal: string;
  notebook(id: Id): NotebookPaths;
}

/** A file extension safe for a file name: lowercase [a-z0-9], at most 10 chars, else 'bin'. */
export function safeExt(ext: string): string {
  const e = String(ext ?? '')
    .replace(/^\./, '')
    .toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(e) ? e : 'bin';
}

/** True for a root entry that can be a notebook folder (not .staging, .inbox, library.json, …). */
export function isNotebookDirName(name: string): boolean {
  return name !== '__proto__' && /^[A-Za-z0-9_-]{1,64}$/.test(name);
}

export function nbLayout(root: string): NbLayout {
  const staging = joinPath(root, '.staging');
  return {
    root: joinPath(root),
    library: joinPath(root, 'library.json'),
    staging,
    stagingJob: (jobId) => joinPath(staging, jobId),
    clipboardDir: (clipId) => joinPath(staging, 'clipboard', clipId),
    inbox: joinPath(root, '.inbox'),
    renderJournal: joinPath(root, '.render-journal'),
    notebook(id) {
      const dir = joinPath(root, id);
      const pagesDir = joinPath(dir, 'pages');
      const assetsDir = joinPath(dir, 'assets');
      const audioDir = joinPath(dir, 'audio');
      const thumbsDir = joinPath(dir, 'thumbs');
      return {
        dir,
        json: joinPath(dir, 'notebook.json'),
        pagesDir,
        page: (pid) => joinPath(pagesDir, `${pid}.json`),
        assetsDir,
        asset: (a) => joinPath(a.kind === 'audio' ? audioDir : assetsDir, `${a.id}.${safeExt(a.ext)}`),
        audioDir,
        thumbsDir,
        cover: joinPath(thumbsDir, 'cover.png'),
        quarantine: joinPath(dir, 'quarantine'),
      };
    },
  };
}
