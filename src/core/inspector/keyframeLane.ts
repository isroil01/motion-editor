/**
 * Keyframe-lane arithmetic — the pure half of the inspector's mini timeline.
 *
 * The lane maps the composition's duration onto a strip a hundred-odd pixels
 * wide, so its whole job is two projections (time to x, x to time) and one
 * edit (retime a keyframe by dragging its diamond). Kept free of React and of
 * the engine so the seek and retime maths can be pinned by tests that never
 * mount anything.
 */

export interface LaneGeometry {
  /** Drawable width in px (the SVG's viewBox width). */
  width: number;
  /** Composition duration in seconds. */
  duration: number;
  /** Horizontal inset so an end diamond is not clipped. */
  pad?: number;
}

const DEFAULT_PAD = 4;

/** Composition time to x within the lane. */
export function laneX(t: number, g: LaneGeometry): number {
  const pad = g.pad ?? DEFAULT_PAD;
  const span = Math.max(1e-9, g.duration);
  const inner = Math.max(0, g.width - pad * 2);
  const f = Math.min(1, Math.max(0, t / span));
  return pad + f * inner;
}

/** x within the lane to composition time, clamped to the comp. */
export function laneTime(x: number, g: LaneGeometry): number {
  const pad = g.pad ?? DEFAULT_PAD;
  const inner = Math.max(1e-9, g.width - pad * 2);
  const f = Math.min(1, Math.max(0, (x - pad) / inner));
  return f * Math.max(0, g.duration);
}

/** Snap a time to the nearest frame boundary. */
export function snapToFrame(t: number, fps: number): number {
  if (!(fps > 0)) return t;
  return Math.round(t * fps) / fps;
}

/**
 * Where a dragged keyframe lands.
 *
 * Frame-snapped, clamped to the comp, and refused (returns `fromT`) when it
 * would land on ANOTHER keyframe of the same track — a move that silently
 * merged two keyframes is a data loss the user did not ask for. The dragged
 * keyframe's own slot is never a collision.
 */
export function retimeTarget(
  keyframeTimes: ReadonlyArray<number>,
  fromT: number,
  x: number,
  g: LaneGeometry,
  fps: number,
  eps = 1e-6,
): number {
  const raw = laneTime(x, g);
  const snapped = snapToFrame(raw, fps);
  const collides = keyframeTimes.some((t) => Math.abs(t - fromT) > eps && Math.abs(t - snapped) < eps);
  return collides ? fromT : snapped;
}

/** The keyframe nearest to `x`, within `radius` px, or null. */
export function nearestKeyframe(
  keyframeTimes: ReadonlyArray<number>,
  x: number,
  g: LaneGeometry,
  radius = 5,
): number | null {
  let best: number | null = null;
  let bestD = radius;
  for (const t of keyframeTimes) {
    const d = Math.abs(laneX(t, g) - x);
    if (d <= bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
