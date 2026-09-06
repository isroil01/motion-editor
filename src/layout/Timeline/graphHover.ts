/**
 * What the graph editor says when you hover it.
 *
 * The curve is the only place in the editor where a value is drawn but never
 * written down: you can see that opacity dips around the second mark and you
 * cannot find out to what without clicking a keyframe, which changes the
 * selection you were in the middle of building. A read-out under the pointer
 * answers it without touching anything.
 *
 * Pure and separate because the two things that go wrong here — interpolating
 * between the WRONG pair of samples, and picking the wrong curve when several
 * overlap — are both invisible in a screenshot and both trivially testable.
 */

/** A polyline in data space: [comp seconds, plotted value]. */
export type Samples = ReadonlyArray<readonly [number, number]>;

/**
 * The plotted value at a comp time, linearly interpolated between samples.
 *
 * Linear between samples, NOT re-sampled from the engine: these are the points
 * the curve is actually drawn from, so the number matches the pixel the user is
 * pointing at. Re-sampling would be more accurate and would disagree with what
 * is on screen wherever the polyline is coarse, which is the worse failure —
 * a read-out that does not match the line under it is not believed again.
 */
export function valueAtTime(samples: Samples, t: number): number | null {
  if (samples.length === 0) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  // Linear scan: a sampled curve is a few hundred points and this runs on
  // pointermove, where a binary search's win is under a microsecond and its
  // off-by-one risk is permanent.
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (t <= b[0]) {
      const span = b[0] - a[0];
      if (span <= 0) return b[1];
      const f = (t - a[0]) / span;
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return last[1];
}

export interface HoverCurve {
  nodeId: string;
  prop: string;
  color: string;
  samples: Samples;
  minV: number;
  maxV: number;
}

export interface HoverReading {
  nodeId: string;
  prop: string;
  color: string;
  value: number;
  /** Svg y for the value, so the chip can sit ON the curve rather than float. */
  y: number;
}

/**
 * Which curve the pointer means, and what it holds there.
 *
 * "Nearest in Y at this time", within `maxDistPx`. Nearest-in-Y rather than
 * nearest-in-2D because the pointer's x already fixes the time: the question is
 * only which of the stacked curves is being pointed at, and a 2D distance would
 * pick a curve that is closer diagonally but further from the cursor's row.
 *
 * Returns null past the threshold, so hovering empty graph space shows nothing
 * rather than confidently naming whichever curve is least far away.
 */
export function nearestCurveAt(
  curves: ReadonlyArray<HoverCurve>,
  t: number,
  cursorY: number,
  innerH: number,
  maxDistPx = 48,
): HoverReading | null {
  let best: HoverReading | null = null;
  let bestDist = Infinity;
  for (const curve of curves) {
    const v = valueAtTime(curve.samples, t);
    if (v === null) continue;
    const span = curve.maxV - curve.minV;
    if (!Number.isFinite(span) || span === 0) continue;
    const y = innerH - ((v - curve.minV) / span) * innerH;
    const dist = Math.abs(y - cursorY);
    if (dist < bestDist) {
      bestDist = dist;
      best = { nodeId: curve.nodeId, prop: curve.prop, color: curve.color, value: v, y };
    }
  }
  return bestDist <= maxDistPx ? best : null;
}

/** Whether a point lies inside a rect given by two opposite corners. */
export function pointInBox(
  x: number,
  y: number,
  box: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return (
    x >= Math.min(box.x0, box.x1)
    && x <= Math.max(box.x0, box.x1)
    && y >= Math.min(box.y0, box.y1)
    && y <= Math.max(box.y0, box.y1)
  );
}

/** The minimum a box must span, px, before it selects rather than clicks. */
export const BOX_SELECT_MIN_PX = 3;

export interface BoxSelectPath {
  nodeId: string;
  prop: string;
  keyframes: ReadonlyArray<{ nodeId: string; prop: string; t: number; tAbs: number; y: number }>;
}

/**
 * Every keyframe whose diamond — or whose visible TANGENT HANDLE — falls inside
 * the box.
 *
 * The handles are the reason this exists. Reshaping four eases at once means
 * selecting the four keyframes they hang off, and picking them one shift-click
 * at a time on a crowded graph is the slowest gesture in the panel. Only the
 * FOCUSED keyframe's handles are drawn (the graph would be unreadable with all
 * of them out), so `handles` carries just that pair — the box catches a
 * keyframe you were reaching for by its handle rather than its diamond, which
 * is what the pointer was already near.
 */
export function keyframesInBox(
  paths: ReadonlyArray<BoxSelectPath>,
  box: { x0: number; y0: number; x1: number; y1: number },
  handles: ReadonlyArray<{ nodeId: string; prop: string; t: number; x: number; y: number }> = [],
  pps = 1,
  makeId: (nodeId: string, prop: string, t: number) => string = (n, p, t) => `${n} ${p} ${t}`,
): Set<string> {
  const out = new Set<string>();
  for (const path of paths) {
    for (const kf of path.keyframes) {
      if (pointInBox(kf.tAbs * pps, kf.y, box)) out.add(makeId(kf.nodeId, kf.prop, kf.t));
    }
  }
  for (const h of handles) {
    if (pointInBox(h.x, h.y, box)) out.add(makeId(h.nodeId, h.prop, h.t));
  }
  return out;
}
