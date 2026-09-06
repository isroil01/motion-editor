/**
 * Loads `docs/*.md` for the palette's `?` mode.
 *
 * ISOLATED ON PURPOSE. `import.meta.glob` is Vite syntax; Jest parses this
 * repo as CommonJS and chokes on `import.meta` (see the note in
 * `core/config/edition.ts`). So this file holds the glob and nothing else,
 * and no test imports it — the parsing and search it feeds are in
 * `docsIndex.ts`, which is plain TypeScript.
 *
 * Lazy: the raw markdown (a few hundred KB) is fetched the first time the
 * user types `?`, never at boot, and cached for the session.
 */

import { buildDocsIndex, type DocSection } from './docsIndex';

const loaders = import.meta.glob('/docs/*.md', { query: '?raw', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;

let cache: Promise<DocSection[]> | null = null;

export function loadDocsIndex(): Promise<DocSection[]> {
  if (cache) return cache;
  cache = (async () => {
    const files: Record<string, string> = {};
    await Promise.all(
      Object.entries(loaders).map(async ([path, load]) => {
        try {
          files[path.replace(/^\//, '')] = await load();
        } catch {
          /* a doc that fails to load is simply absent from the index */
        }
      }),
    );
    return buildDocsIndex(files);
  })();
  return cache;
}
