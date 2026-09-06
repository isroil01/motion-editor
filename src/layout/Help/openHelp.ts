/**
 * Open help for a panel or surface: the matching section of `docs/*.md`.
 *
 * In-app first — the palette's docs index and section dialog already exist,
 * so a `?` on a panel header lands in exactly the dialog `?` in the palette
 * does. The desktop shell can open the same page in the system browser
 * (`external: true`), but the in-app dialog is the default there too: it can
 * sit beside the panel it explains, which a browser tab cannot.
 */

import { loadDocsIndex } from '@layout/CommandPalette/docsGlob';
import { openDocSection } from '@layout/CommandPalette/DocsSectionDialog';
import { useUIStore } from '@stores/uiStore';
import { helpLinkFor, helpUrlFor, pickHelpSection } from './helpLinks';

export async function openHelp(id: string, opts: { external?: boolean } = {}): Promise<void> {
  const link = helpLinkFor(id);
  if (opts.external) {
    const open = window.motionEditor?.oauth?.openExternal;
    if (open) {
      await open(helpUrlFor(link)).catch(() => undefined);
      return;
    }
    window.open(helpUrlFor(link), '_blank', 'noopener');
    return;
  }
  try {
    const sections = await loadDocsIndex();
    const section = pickHelpSection(sections, link);
    if (!section) throw new Error(`No documentation for ${link.doc}`);
    openDocSection(section);
  } catch (err) {
    useUIStore.getState().notify({
      level: 'warning',
      message: err instanceof Error ? err.message : 'Help is not available in this build.',
      durationMs: 4000,
    });
  }
}
