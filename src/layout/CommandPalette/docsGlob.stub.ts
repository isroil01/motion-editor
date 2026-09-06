/**
 * Test stub for `docsGlob` — see the note in that file.
 *
 * `import.meta.glob` cannot be parsed by Jest's CommonJS transform, so every
 * suite whose import graph reaches `docsGlob.ts` (Providers → Export dialog →
 * Help → here) would fail to run. Under test the index is simply empty: the
 * parsing and the search it feeds are covered by `docsIndex.test.ts` on
 * strings, and a suite that wants sections can `jest.mock` this module.
 */

import type { DocSection } from './docsIndex';

export function loadDocsIndex(): Promise<DocSection[]> {
  return Promise.resolve([]);
}
