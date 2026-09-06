/**
 * The changelog, as text.
 *
 * ISOLATED ON PURPOSE, like `CommandPalette/docsGlob.ts`: the `?raw` import is
 * Vite syntax, and Jest resolves it as a plain path it cannot find. Nothing a
 * test imports may import this file — the gating logic lives in `whatsNew.ts`.
 */

import changelog from '../../../CHANGELOG.md?raw';

export const CHANGELOG_MARKDOWN: string = changelog;
