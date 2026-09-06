/**
 * Shortcut hints for the palette's empty state, grouped by where focus was.
 *
 * The palette opens over whatever the user was doing; the most useful thing
 * to show before they type is "the chords that work HERE". There is no
 * general panel-focus model yet, so the context is read off the DOM at open
 * time (`detectPaletteContext`) from two markers:
 *
 *   • `[data-workspace-viewport]` — the viewport (already exists);
 *   • `[data-palette-context="timeline"]` — for the timeline to set on its
 *     root when it adopts this contract. Until it does, focus in the timeline
 *     reads as `global`, which is merely less specific, not wrong.
 *
 * The grouping itself is by command-id family and is pure, so it is tested
 * without a DOM.
 */

import type { KeyChord } from '@app-types/common';

export type PaletteContext = 'viewport' | 'timeline' | 'global';

/** The minimal command shape the grouping needs — the registry's `Command` satisfies it. */
export interface HintCommand {
  id: string;
  label: string;
  shortcut?: KeyChord;
}

export const CONTEXT_LABEL: Record<PaletteContext, string> = {
  viewport: 'Viewport',
  timeline: 'Timeline',
  global: 'Everywhere',
};

/**
 * Which command-id prefixes belong to which context. A family listed under
 * `global` shows in every context; the other two show only in theirs.
 */
const FAMILIES: Record<PaletteContext, ReadonlyArray<string>> = {
  viewport: ['tool.', 'view.', 'layer.', 'camera.'],
  timeline: ['timeline.', 'anim.', 'animation.', 'marker.', 'time.', 'transport.'],
  global: ['edit.', 'project.', 'workspace.', 'view.focusMode', 'view.commandPalette'],
};

export function detectPaletteContext(active: Element | null | undefined): PaletteContext {
  if (!active || typeof active.closest !== 'function') return 'global';
  if (active.closest('[data-workspace-viewport]')) return 'viewport';
  const tagged = active.closest('[data-palette-context]')?.getAttribute('data-palette-context');
  if (tagged === 'timeline' || tagged === 'viewport') return tagged;
  return 'global';
}

/**
 * Commands with a shortcut that belong to `context`, most specific first,
 * alphabetical within a family. `resolveChord` supplies the user's override
 * (or `undefined` when they disabled the chord) so a rebound key shows as
 * what it IS, not as the default.
 */
export function shortcutHintsFor<C extends HintCommand>(
  commands: ReadonlyArray<C>,
  context: PaletteContext,
  resolveChord: (cmd: C) => KeyChord | undefined,
  limit = 8,
): Array<{ command: C; chord: KeyChord }> {
  const families = context === 'global' ? FAMILIES.global : [...FAMILIES[context], ...FAMILIES.global];
  const rank = (id: string): number => {
    const i = families.findIndex((p) => id.startsWith(p));
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return commands
    .map((command) => ({ command, chord: resolveChord(command), r: rank(command.id) }))
    .filter((x): x is { command: C; chord: KeyChord; r: number } => x.chord !== undefined && Number.isFinite(x.r))
    .sort((a, b) => a.r - b.r || a.command.label.localeCompare(b.command.label))
    .slice(0, limit)
    .map(({ command, chord }) => ({ command, chord }));
}
