/**
 * Mask vertex sampling — which vertices of a mask the tracker follows, and
 * how the rest follow them.
 *
 * A per-vertex tracker needs a trackable FEATURE under every point, and a
 * hand-drawn or traced outline with hundreds of vertices is a shape, not a
 * set of features: neighbouring points sit on the same edge, measure the same
 * motion, and cost a patch search each. Past the cap the tracker used to
 * refuse. Now it samples: a subset of at most `cap` vertices, spaced evenly
 * along the path BY ARC LENGTH so the tracked skeleton keeps the shape (a
 * dense cluster of vertices is one feature, not forty), and every untracked
 * vertex moves with its two nearest tracked neighbours along the path,
 * blended linearly in the arc-length parameter between them. The path keeps
 * every vertex it had; only the measurement is shared.
 *
 * Under a pure translation every tracked vertex measures the same delta, so
 * every blended vertex gets exactly that delta — the interpolation is a
 * convex combination and cannot invent motion the neighbours did not see.
 *
 * Within the cap nothing is sampled: every vertex is its own tracked slot,
 * in path order, and `trackLayerMask` uses the tracked position directly —
 * the pre-sampling behaviour, bit for bit.
 */

export interface SamplablePath {
  points: ReadonlyArray<{ x: number; y: number }>;
  /** Closed loops wrap: the last vertex neighbours the first. */
  closed: boolean;
}

/** How an UNTRACKED vertex derives its delta: slots `a` → `b`, parameter `w`. */
export interface VertexBlend {
  a: number;
  b: number;
  /** 0 → exactly slot a, 1 → exactly slot b. */
  w: number;
}

export interface VertexSampling {
  /** Flat vertex index (paths concatenated, in order) tracked by each slot. */
  tracked: number[];
  /** Per flat vertex: its slot, or -1 when it is interpolated. */
  slotOf: number[];
  /** Per flat vertex: the blend that moves it. Tracked vertices carry {a: slot, b: slot, w: 0}. */
  blend: VertexBlend[];
  /** Total vertex count across all paths. */
  total: number;
}

/** More tracked vertices than this and the outline is a shape, not features. */
export const MAX_TRACKED_VERTICES = 64;

/** Cumulative chord length at each vertex; `total` includes the closing segment of a loop. */
function arcLengths(path: SamplablePath): { s: number[]; total: number } {
  const pts = path.points;
  const s: number[] = new Array(pts.length);
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    s[i] = acc;
  }
  let total = acc;
  if (path.closed && pts.length > 1) {
    total += Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.y - pts[pts.length - 1]!.y);
  }
  return { s, total };
}

/**
 * Pick `n` vertex indices of one path, evenly spaced along its arc length.
 * Targets run 0..L over a loop (the last target stops short of wrapping onto
 * vertex 0) and 0..L inclusive over an open path (both ends kept). Each
 * target takes the nearest vertex past the previous pick, so picks are
 * strictly increasing and distinct; a degenerate path (all points coincident)
 * falls back to even spacing by index.
 */
function pickByArcLength(path: SamplablePath, n: number): number[] {
  const len = path.points.length;
  if (n >= len) return Array.from({ length: len }, (_, i) => i);
  if (n <= 0) return [];
  const { s, total } = arcLengths(path);
  const picks: number[] = [];
  if (total <= 0) {
    for (let k = 0; k < n; k++) {
      const i = Math.min(len - 1, Math.round((k * len) / n));
      if (picks.length === 0 || i > picks[picks.length - 1]!) picks.push(i);
    }
    return picks;
  }
  const step = path.closed ? total / n : total / (n - 1);
  let from = 0;
  for (let k = 0; k < n && from < len; k++) {
    const t = k * step;
    let best = from;
    let bestD = Math.abs(s[from]! - t);
    for (let i = from + 1; i < len; i++) {
      const d = Math.abs(s[i]! - t);
      if (d < bestD) {
        best = i;
        bestD = d;
      } else if (s[i]! > t) {
        break; // s is monotone: past the target it only gets worse
      }
    }
    picks.push(best);
    from = best + 1;
  }
  return picks;
}

/**
 * Share `cap` tracked slots among the paths. Every path keeps enough to hold
 * its shape (3 on a loop, 2 on an open path, or all of a smaller one), and
 * the rest is dealt out in proportion to vertex count by largest remainder.
 */
function allocate(paths: ReadonlyArray<SamplablePath>, cap: number): number[] {
  const lens = paths.map((p) => p.points.length);
  const minFor = (p: SamplablePath): number => Math.min(p.points.length, p.closed ? 3 : 2);
  let floor = paths.map(minFor);
  if (floor.reduce((a, b) => a + b, 0) > cap) {
    floor = lens.map((l) => Math.min(l, 1));
    if (floor.reduce((a, b) => a + b, 0) > cap) {
      throw new Error(`The mask has ${paths.length} paths — more than ${cap} cannot be tracked at once.`);
    }
  }
  const total = lens.reduce((a, b) => a + b, 0);
  let spare = cap - floor.reduce((a, b) => a + b, 0);
  const out = floor.slice();
  // Proportional share of the spare, capped by what each path can still take.
  const want = lens.map((l, i) => Math.max(0, Math.min(l - out[i]!, (spare * l) / total)));
  const whole = want.map((w) => Math.floor(w));
  for (let i = 0; i < out.length; i++) {
    out[i]! += whole[i]!;
    spare -= whole[i]!;
  }
  // Largest remainder for what is left, then any slack to whoever has room.
  const order = want
    .map((w, i) => ({ i, frac: w - whole[i]! }))
    .sort((p, q) => q.frac - p.frac || p.i - q.i);
  for (const { i } of order) {
    if (spare <= 0) break;
    if (out[i]! < lens[i]!) {
      out[i]! += 1;
      spare -= 1;
    }
  }
  for (let i = 0; i < out.length && spare > 0; i++) {
    const room = lens[i]! - out[i]!;
    const take = Math.min(room, spare);
    out[i]! += take;
    spare -= take;
  }
  return out;
}

/**
 * Decide the tracked subset and the blend of every vertex. Within `cap`
 * this is the identity: every vertex is its own slot, in path order.
 */
export function sampleMaskVertices(
  paths: ReadonlyArray<SamplablePath>,
  cap: number = MAX_TRACKED_VERTICES,
): VertexSampling {
  const total = paths.reduce((n, p) => n + p.points.length, 0);
  const tracked: number[] = [];
  const slotOf: number[] = new Array(total).fill(-1);
  const blend: VertexBlend[] = new Array(total);

  const budgets = total <= cap ? paths.map((p) => p.points.length) : allocate(paths, cap);

  let base = 0;
  for (let p = 0; p < paths.length; p++) {
    const path = paths[p]!;
    const len = path.points.length;
    const picks = pickByArcLength(path, budgets[p]!);
    const slots: number[] = [];
    for (const i of picks) {
      slotOf[base + i] = tracked.length;
      slots.push(tracked.length);
      tracked.push(base + i);
    }
    if (picks.length > 0) {
      const { s, total: L } = arcLengths(path);
      let prev = -1; // index into picks of the last tracked vertex passed
      for (let i = 0; i < len; i++) {
        const slot = slotOf[base + i]!;
        if (slot >= 0) {
          prev = picks.indexOf(i);
          blend[base + i] = { a: slot, b: slot, w: 0 };
          continue;
        }
        const hasPrev = prev >= 0;
        const hasNext = prev + 1 < picks.length;
        let ia: number;
        let ib: number;
        if (hasPrev && hasNext) {
          ia = picks[prev]!;
          ib = picks[prev + 1]!;
        } else if (path.closed && picks.length > 0) {
          // Wrap: before the first pick the neighbours are last → first;
          // after the last pick they are last → first as well.
          ia = picks[picks.length - 1]!;
          ib = picks[0]!;
        } else {
          // Open path past its last (or before its first) tracked vertex:
          // ride the nearest one.
          const only = hasPrev ? picks[prev]! : picks[0]!;
          blend[base + i] = { a: slots[picks.indexOf(only)]!, b: slots[picks.indexOf(only)]!, w: 0 };
          continue;
        }
        let w = 0;
        if (ia !== ib) {
          let d1 = s[i]! - s[ia]!;
          let d2 = s[ib]! - s[i]!;
          if (path.closed) {
            if (d1 < 0) d1 += L;
            if (d2 < 0) d2 += L;
          }
          const span = d1 + d2;
          w = span > 0 ? d1 / span : 0;
        }
        blend[base + i] = { a: slots[picks.indexOf(ia)]!, b: slots[picks.indexOf(ib)]!, w };
      }
    }
    base += len;
  }
  return { tracked, slotOf, blend, total };
}

/**
 * The delta of every vertex from the deltas of the tracked slots — tracked
 * vertices pass their own through, the rest blend their two neighbours.
 */
export function blendVertexDeltas(
  sampling: VertexSampling,
  slotDeltas: ReadonlyArray<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = new Array(sampling.total);
  for (let v = 0; v < sampling.total; v++) {
    const b = sampling.blend[v]!;
    const da = slotDeltas[b.a]!;
    const db = slotDeltas[b.b]!;
    out[v] = b.w === 0 || b.a === b.b
      ? { x: da.x, y: da.y }
      : { x: da.x + (db.x - da.x) * b.w, y: da.y + (db.y - da.y) * b.w };
  }
  return out;
}
