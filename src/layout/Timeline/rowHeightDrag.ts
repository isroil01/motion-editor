/**
 * Row-height grip math — what one vertical drag on the column seam turns into.
 *
 * Pure so the two decisions that matter can be pinned: the RATE (half a pixel
 * of row per pixel of drag, because the useful range is ~44px wide and a 1:1
 * mapping crossed the whole of it in a flick) and the CLAMP (the floor keeps
 * the switch column reachable, the ceiling keeps the lanes usable). The grip
 * itself is a pointer-capture handler in the Timeline; this is the only part of
 * it that can be wrong in a way a screenshot would not show.
 */

import { clamp } from '@utils/lang';

/**
 * The three row-height presets the sub-header's button cycles, and the bounds
 * the drag grip clamps to.
 *
 * The presets stay because a cycle is the fastest way to a known-good size;
 * the drag exists because a cycle cannot express "a bit taller than compact".
 * `28` is first, and so is the double-click reset: a motion comp is usually
 * many short layers, and taller rows push most of them below the fold.
 */
export const ROW_HEIGHT_PRESETS = [28, 36, 46] as const;
export const ROW_HEIGHT_MIN = 20;
export const ROW_HEIGHT_MAX = 64;

/** Row pixels per drag pixel. */
export const ROW_HEIGHT_DRAG_RATE = 0.5;

/**
 * The row height a drag has reached: `startH` at pointer-down plus the vertical
 * travel since, scaled and clamped. Always an integer — a fractional row height
 * puts every lane border on a half pixel.
 */
export function rowHeightFromDrag(
  startH: number,
  dy: number,
  opts: { min?: number; max?: number; rate?: number } = {},
): number {
  const min = opts.min ?? ROW_HEIGHT_MIN;
  const max = opts.max ?? ROW_HEIGHT_MAX;
  const rate = opts.rate ?? ROW_HEIGHT_DRAG_RATE;
  return Math.round(clamp(startH + dy * rate, min, max));
}
