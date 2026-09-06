/**
 * Command Palette store.
 *
 * Holds open/closed state + an optional prefill so any surface can open the
 * palette in a specific mode (e.g. openPalette('>') for commands, '@' for
 * layers, '?' for docs), and the palette's MRU — which commands ran from it,
 * how often, and when. The <CommandPalette> host reads this and owns all
 * query logic; the ranking maths lives in `paletteRecency.ts`.
 *
 * The MRU persists to localStorage under one key. Not the settings manager:
 * that boots with the core, and the palette is reachable (Ctrl+Shift+P) from
 * the first paint.
 */

import { create } from 'zustand';
import {
  recordUse,
  sanitizeRecencyMap,
  type RecencyEntry,
  type RecencyMap,
} from '@layout/CommandPalette/paletteRecency';
import { detectPaletteContext, type PaletteContext } from '@layout/CommandPalette/shortcutHints';

/**
 * Where focus was when the palette opened. Read HERE, at the moment of
 * opening, because by the time the palette renders the dialog has taken
 * focus and the answer is gone.
 */
function contextNow(): PaletteContext {
  return detectPaletteContext(typeof document === 'undefined' ? null : document.activeElement);
}

export const PALETTE_MRU_STORAGE_KEY = 'premation.palette.mru';

function loadMru(): Record<string, RecencyEntry> {
  try {
    const raw = globalThis.localStorage?.getItem(PALETTE_MRU_STORAGE_KEY);
    return raw ? sanitizeRecencyMap(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveMru(mru: RecencyMap): void {
  try {
    globalThis.localStorage?.setItem(PALETTE_MRU_STORAGE_KEY, JSON.stringify(mru));
  } catch {
    /* quota / private mode — the in-memory copy still works this session */
  }
}

interface CommandPaletteStore {
  open: boolean;
  /** Seed query when opening (e.g. '>' commands, '@' layers, '#' comps, ':' time, '?' docs). */
  initialQuery: string;
  /** Command id → usage, for the Recent section and the recency boost. */
  recent: RecencyMap;
  /** The surface that had focus when the palette opened — groups the empty-state hints. */
  context: PaletteContext;
  openPalette: (prefill?: string) => void;
  closePalette: () => void;
  toggle: (prefill?: string) => void;
  /** Record that `commandId` just ran from the palette. */
  recordUse: (commandId: string, now?: number) => void;
  /** Forget the history (Customize ▸ reset, tests). */
  clearRecent: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set, get) => ({
  open: false,
  initialQuery: '',
  recent: loadMru(),
  context: 'global',
  openPalette: (prefill = '') => set({ open: true, initialQuery: prefill, context: contextNow() }),
  closePalette: () => set({ open: false }),
  toggle: (prefill = '') =>
    get().open ? set({ open: false }) : set({ open: true, initialQuery: prefill, context: contextNow() }),
  recordUse: (commandId, now = Date.now()) => {
    const recent = recordUse(get().recent, commandId, now);
    saveMru(recent);
    set({ recent });
  },
  clearRecent: () => {
    saveMru({});
    set({ recent: {} });
  },
}));

export const openPalette = (prefill?: string): void =>
  useCommandPaletteStore.getState().openPalette(prefill);
export const closePalette = (): void => useCommandPaletteStore.getState().closePalette();
