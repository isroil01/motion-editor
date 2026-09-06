/**
 * Clip trim-handle layout — how wide each handle may be on a bar of a given
 * width, and when the BODY wins.
 *
 * A handle draws as a 10px edge and hits as ~24 (the stylesheet pads it
 * inward). On a wide bar that is fine; on a narrow one two handles cover the
 * whole bar and the clip cannot be MOVED, which is the gesture you lose. The
 * rule: below three handle widths the handles give up pixels until the body
 * keeps at least `bodyMinPx`; when even that is impossible the handles vanish
 * and the bar is all body — a 2px clip must still be draggable.
 *
 * Pure so the precedence is unit-tested rather than discovered on a 2px clip.
 */

/** The clip trim handle width, px — mirrors `.clipHandle` in the stylesheet. */
export const CLIP_HANDLE_PX = 10;
/** The least body a narrow bar keeps between its two handles. */
export const CLIP_BODY_MIN_PX = 6;

export interface ClipHandleLayout {
  /** Below three handle widths: the stylesheet collapses the hit padding. */
  narrow: boolean;
  /** Per-handle width, px. Zero means "render no handle at all". */
  handleWidth: number;
}

export function clipHandleLayout(
  widthPx: number,
  handlePx = CLIP_HANDLE_PX,
  bodyMinPx = CLIP_BODY_MIN_PX,
): ClipHandleLayout {
  const narrow = widthPx < handlePx * 3;
  if (!narrow) return { narrow, handleWidth: handlePx };
  const handleWidth = Math.max(0, Math.min(handlePx, Math.floor((widthPx - bodyMinPx) / 2)));
  return { narrow, handleWidth };
}
