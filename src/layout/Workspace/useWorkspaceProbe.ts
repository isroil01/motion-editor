/**
 * The hover pixel probe — the Info readout's half of the viewport's pointer
 * handling, split out of `useWorkspace.ts`.
 *
 * Two things happen on every `pointermove` over the stage: the composition
 * coordinate under the cursor is published, and — only while nothing is being
 * dragged — the PIXEL under it is sampled from the content canvas. Both land
 * in `infoStore`, which the status bar reads and the vectorscope in
 * `Scopes/ScopesPanel.tsx` draws a marker for.
 *
 * ## Why the sample is hover-only
 *
 * `samplePixelRgba` costs a forced layout (`getBoundingClientRect`) plus a
 * canvas readback. Paying that on every pointermove of a drag taxes exactly
 * the gesture with the least budget to spare — so during a drag the position
 * keeps updating and `rgba` goes null. The readout shows a coordinate with no
 * swatch, which is honest: nobody is picking a colour mid-drag.
 *
 * ## Why it is its own module
 *
 * It is the one piece of the pointer handler with NO shared mutable state:
 * every input is an argument. That makes it the part that can be lifted out
 * of the 3.6k-line hook without threading a closure, and the part that can be
 * unit-tested against a stub canvas.
 */

import { useInfoStore } from '@stores/infoStore';
import { samplePixelRgba } from '@core/workspace/pixelSample';

export interface ProbeInputs {
  /** Pointer position in STAGE screen px (the overlay canvas' own space). */
  screen: { x: number; y: number };
  /** The same point in composition space. */
  world: { x: number; y: number };
  /** The content canvas, or null before the backend attaches. */
  content: HTMLCanvasElement | null;
  /** `PointerEvent.buttons` — non-zero means a drag is in flight. */
  buttons: number;
}

/**
 * Publish one probe reading. Pure over its arguments apart from the store
 * write, so a test can drive it without a viewport.
 */
export function publishProbe({ screen, world, content, buttons }: ProbeInputs): void {
  useInfoStore.getState().set({
    x: Math.round(world.x),
    y: Math.round(world.y),
    rgba: buttons === 0 && content ? samplePixelRgba(content, screen) : null,
    present: true,
  });
}

/** The cursor has left the stage: the readout shows " — " rather than a stale pixel. */
export function clearProbe(): void {
  useInfoStore.getState().clear();
}
