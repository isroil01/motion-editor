/**
 * Floating-dialog geometry — pure helpers shared by `Modal` (which drags,
 * resizes and clamps) and the preference store (which remembers).
 *
 * Kept free of React and of the DOM so the clamp rules can be pinned by a
 * plain unit test: a dialog restored on a smaller monitor than it was parked on
 * must land fully on screen, and a dialog dragged past an edge must stop at it.
 */

import { usePreferenceStore, type DialogGeometry } from '@stores/preferenceStore';

export type { DialogGeometry };

export interface Viewport {
  width: number;
  height: number;
}

/**
 * How much of a dialog must stay on screen. The whole header, really: a dialog
 * whose title bar is off-screen cannot be dragged back, and that is the one
 * state the clamp exists to make unreachable.
 */
export const MIN_VISIBLE_PX = 48;
/** Smallest a resizable dialog may be dragged to. */
export const MIN_DIALOG_WIDTH = 280;
export const MIN_DIALOG_HEIGHT = 160;

/** Round to whole pixels and force the frame into the viewport. */
export function clampGeometry(g: DialogGeometry, vp: Viewport): DialogGeometry {
  const w = Math.max(MIN_DIALOG_WIDTH, Math.min(Math.round(g.w), Math.max(MIN_DIALOG_WIDTH, vp.width)));
  const h = Math.max(MIN_DIALOG_HEIGHT, Math.min(Math.round(g.h), Math.max(MIN_DIALOG_HEIGHT, vp.height)));
  // The header stays reachable: never past the right/bottom edge by more than
  // (w − MIN_VISIBLE), never above the top, never left of the left edge by more
  // than the same margin.
  const maxX = Math.max(0, vp.width - MIN_VISIBLE_PX);
  const maxY = Math.max(0, vp.height - MIN_VISIBLE_PX);
  const x = Math.min(Math.max(Math.round(g.x), MIN_VISIBLE_PX - w), maxX);
  const y = Math.min(Math.max(Math.round(g.y), 0), maxY);
  return { x, y, w, h };
}

/** Where a dialog with no memory opens: centred, like a blocking one. */
export function centredGeometry(w: number, h: number, vp: Viewport): DialogGeometry {
  return clampGeometry(
    { x: (vp.width - w) / 2, y: Math.max(0, (vp.height - h) / 2.4), w, h },
    vp,
  );
}

export function currentViewport(): Viewport {
  if (typeof window === 'undefined') return { width: 1280, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function isGeometry(v: unknown): v is DialogGeometry {
  if (!v || typeof v !== 'object') return false;
  const g = v as Record<string, unknown>;
  return ['x', 'y', 'w', 'h'].every((k) => typeof g[k] === 'number' && Number.isFinite(g[k]));
}

/** The remembered frame for `id`, clamped to the viewport — or null. */
export function readDialogGeometry(id: string, vp: Viewport = currentViewport()): DialogGeometry | null {
  const stored = usePreferenceStore.getState().dialogGeometry?.[id];
  return isGeometry(stored) ? clampGeometry(stored, vp) : null;
}

export function writeDialogGeometry(id: string, g: DialogGeometry): void {
  const store = usePreferenceStore.getState();
  store.set('dialogGeometry', { ...store.dialogGeometry, [id]: clampGeometry(g, currentViewport()) });
}

export function forgetDialogGeometry(id: string): void {
  const store = usePreferenceStore.getState();
  if (!(id in store.dialogGeometry)) return;
  const next = { ...store.dialogGeometry };
  delete next[id];
  store.set('dialogGeometry', next);
}
