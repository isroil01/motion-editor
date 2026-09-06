/**
 * mediaBrowserTree — the pure rules of the Assets panel's Media Browser tab (id `browse`).
 *
 * The tab lists a folder the user picked, one level at a time, and lets any
 * media file in it be dragged straight into the composition. These helpers
 * decide what counts as media, how a listing is ordered, and how the lazy
 * tree flattens into rows; the IPC that reads the disk lives in
 * `electron/ipc/reveal.ts` and the React that draws it in `MediaBrowser.tsx`.
 */

export interface DirEntry {
  name: string;
  /** Absolute path, in the OS's own separator. */
  path: string;
  kind: 'dir' | 'file';
  size?: number;
  mtimeMs?: number;
}

/** What the browser offers to import. Mirrors the viewport's own file-drop
 *  filter so a row that can be dragged is a row the drop will accept. */
const MEDIA_EXT = /\.(mp4|mov|webm|m4v|mkv|avi|wmv|flv|mts|m2ts|mpg|mpeg|vob|ts|mxf|r3d|braw|png|jpe?g|gif|svg|webp|avif|bmp|tiff?|exr|dpx|hdr|psd|dng|cr2|cr3|nef|arw|mp3|wav|m4a|aac|ogg|flac|aiff?|opus)$/i;

export function isMediaFile(name: string): boolean {
  return MEDIA_EXT.test(name);
}

export function mediaKindOf(name: string): 'image' | 'video' | 'audio' | null {
  if (!isMediaFile(name)) return null;
  if (/\.(mp3|wav|m4a|aac|ogg|flac|aiff?|opus)$/i.test(name)) return 'audio';
  if (/\.(mp4|mov|webm|m4v|mkv|avi|wmv|flv|mts|m2ts|mpg|mpeg|vob|ts|mxf|r3d|braw)$/i.test(name)) return 'video';
  return 'image';
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Folders first, then files, each naturally sorted. Non-media files are
 *  dropped: a bin that lists `.DS_Store` and `notes.txt` beside the footage
 *  is a bin you have to read instead of scan. */
export function sortEntries(entries: ReadonlyArray<DirEntry>): DirEntry[] {
  return entries
    .filter((e) => e.kind === 'dir' || isMediaFile(e.name))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return collator.compare(a.name, b.name);
    });
}

/** The last path segment, whichever separator the OS uses. */
export function baseName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

/** One rendered line of the lazy tree. */
export interface MediaRow {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
  /** True while the folder's listing is in flight. */
  loading: boolean;
}

/**
 * Flatten the lazy tree: a folder contributes its rows only once it has been
 * expanded AND listed. `listings` is what has come back from disk so far;
 * `pending` is what has been asked for and not yet answered.
 */
export function flattenMediaTree(
  rootEntries: ReadonlyArray<DirEntry>,
  expanded: ReadonlySet<string>,
  listings: ReadonlyMap<string, ReadonlyArray<DirEntry>>,
  pending: ReadonlySet<string>,
): MediaRow[] {
  const out: MediaRow[] = [];
  const walk = (entries: ReadonlyArray<DirEntry>, depth: number): void => {
    for (const entry of sortEntries(entries)) {
      const isOpen = entry.kind === 'dir' && expanded.has(entry.path);
      out.push({ entry, depth, expanded: isOpen, loading: isOpen && pending.has(entry.path) });
      if (isOpen) {
        const kids = listings.get(entry.path);
        if (kids) walk(kids, depth + 1);
      }
    }
  };
  walk(rootEntries, 0);
  return out;
}
