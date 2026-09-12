/**
 * Where an audio visualiser's bars stand, and which way they point.
 *
 * Pulled out of the drawing kernels because it is pure geometry that BOTH
 * Audio Spectrum and Audio Waveform need, in exactly the same three flavours:
 *
 *  • along a **mask path** (`pathPoints`, flattened by `buildSnapshot`),
 *  • around a **circle** (`usePolarPath`),
 *  • along a **straight segment** between Start and End Point.
 *
 * Splitting it out is also what makes the interesting part testable. "Does the
 * ring close up" and "does bar 0 sit at the start angle" are one-line
 * assertions here and an eyeball-and-hope exercise inside a canvas kernel.
 *
 * Every sample carries its own NORMAL — the direction the bar grows — because
 * that is what distinguishes running along a path from merely being positioned
 * on one. A bar on a circle must radiate outward; a bar on a hand-drawn mask
 * must stand perpendicular to the local tangent, wherever that points.
 */

/** One place a bar stands: a point, and the unit vector it grows along. */
export interface VizSample {
  x: number;
  y: number;
  /** Unit normal. Bars on Side A grow along +normal, Side B along −normal. */
  nx: number;
  ny: number;
}

export interface VizLayoutOptions {
  /** Flattened `[x0,y0,x1,y1,…]` from a mask path, in layer pixels. */
  pathPoints?: readonly number[];
  usePolarPath?: boolean;
  polarRadius?: number;
  /** Degrees. −90 puts the first bar at twelve o'clock, as AE's does. */
  startAngle?: number;
  /** Straight-line fallback, as OFFSETS from the layer centre. */
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}

/**
 * `count` evenly spaced places to put a bar, for a layer `w`×`h`.
 *
 * Always returns exactly `count` samples (or none, for a degenerate request),
 * so a kernel can zip it against its magnitudes without a length check at every
 * index.
 */
export function layoutViz(
  w: number,
  h: number,
  count: number,
  opts: VizLayoutOptions,
): VizSample[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const cx = w / 2;
  const cy = h / 2;

  const path = opts.pathPoints;
  if (path && path.length >= 4) return alongPath(path, n, opts.usePolarPath === true, cx, cy);

  if (opts.usePolarPath) {
    const r = Math.max(0, opts.polarRadius ?? Math.min(w, h) / 4);
    const a0 = ((opts.startAngle ?? -90) * Math.PI) / 180;
    const out: VizSample[] = [];
    for (let i = 0; i < n; i++) {
      /*
        A FULL turn divided by `n`, not by `n − 1`. The last bar must not land
        on top of the first: a ring of 32 bars has 32 gaps, not 31, and using
        `n − 1` leaves a visible double-width bar at the seam.
      */
      const a = a0 + (i / n) * Math.PI * 2;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      out.push({ x: cx + nx * r, y: cy + ny * r, nx, ny });
    }
    return out;
  }

  // The straight fallback. Offsets from the centre, matching every other
  // generate effect in this tree.
  const x0 = cx + (opts.startX ?? -w / 4);
  const y0 = cy + (opts.startY ?? 0);
  const x1 = cx + (opts.endX ?? w / 4);
  const y1 = cy + (opts.endY ?? 0);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  // A zero-length segment has no direction, so the normal is chosen rather than
  // derived: straight up, which is what a spectrum with no layout looks like.
  const ux = len > 0 ? dx / len : 1;
  const uy = len > 0 ? dy / len : 0;
  const out: VizSample[] = [];
  for (let i = 0; i < n; i++) {
    // `n − 1` here, unlike the ring: a segment's last sample belongs AT the end
    // point, not one step short of it.
    const t = n === 1 ? 0 : i / (n - 1);
    /*
      `(uy, −ux)`, not `(−uy, ux)`. Canvas y grows DOWNWARD, so the second form
      points a left-to-right run's normal at the floor and the bars hang from
      the line instead of standing on it.
    */
    out.push({ x: x0 + dx * t, y: y0 + dy * t, nx: uy, ny: -ux });
  }
  return out;
}

/**
 * Sample a flattened polyline at `n` points of equal ARC LENGTH.
 *
 * Equal arc length, not equal vertex index: a flattened bezier has its vertices
 * bunched around the curvature, so stepping by index would crowd the bars into
 * the corners of a rounded rectangle and leave the straights bare.
 *
 * `polar` makes the bars radiate from the path's centroid instead of standing
 * perpendicular to it — AE's "Use Polar Path" applied to a real path, which is
 * how you get a spectrum bursting out of a hand-drawn shape.
 */
function alongPath(
  pts: readonly number[],
  n: number,
  polar: boolean,
  cx: number,
  cy: number,
): VizSample[] {
  const count = Math.floor(pts.length / 2);
  if (count < 2) return [];

  // Cumulative arc length at each vertex.
  const cum: number[] = [0];
  for (let i = 1; i < count; i++) {
    const dx = pts[i * 2]! - pts[(i - 1) * 2]!;
    const dy = pts[i * 2 + 1]! - pts[(i - 1) * 2 + 1]!;
    cum.push(cum[i - 1]! + Math.hypot(dx, dy));
  }
  const total = cum[count - 1]!;
  if (!(total > 0)) return [];

  /*
    The centroid, for the polar normal. The mean of the vertices rather than a
    true area centroid: with equal-length flattening they agree closely enough,
    and this one is defined for an OPEN path too.

    A closed path repeats its first point as its last, and counting that vertex
    twice drags the centroid toward one corner — enough to tilt every normal on
    a square by several degrees. So the duplicate is dropped.
  */
  const closed =
    Math.abs(pts[0]! - pts[(count - 1) * 2]!) < 1e-6
    && Math.abs(pts[1]! - pts[(count - 1) * 2 + 1]!) < 1e-6;
  const vertices = closed && count > 1 ? count - 1 : count;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < vertices; i++) {
    mx += pts[i * 2]!;
    my += pts[i * 2 + 1]!;
  }
  mx /= vertices;
  my /= vertices;

  const out: VizSample[] = [];
  let seg = 1;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    while (seg < count - 1 && cum[seg]! < target) seg++;
    const a = seg - 1;
    const spanLen = cum[seg]! - cum[a]!;
    const t = spanLen > 0 ? (target - cum[a]!) / spanLen : 0;
    const ax = pts[a * 2]!;
    const ay = pts[a * 2 + 1]!;
    const bx = pts[seg * 2]!;
    const by = pts[seg * 2 + 1]!;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;

    let nx: number;
    let ny: number;
    if (polar) {
      // Radiate away from the centroid.
      const rx = x - mx;
      const ry = y - my;
      const rl = Math.hypot(rx, ry);
      if (rl > 0) { nx = rx / rl; ny = ry / rl; } else { nx = 0; ny = -1; }
    } else {
      // Perpendicular to the local tangent, on the same side as the straight
      // layout's normal — see the note there about canvas y.
      const tx = bx - ax;
      const ty = by - ay;
      const tl = Math.hypot(tx, ty);
      if (tl > 0) { nx = ty / tl; ny = -tx / tl; } else { nx = 0; ny = -1; }
    }
    out.push({ x, y, nx, ny });
  }
  // `cx`/`cy` are accepted so the signature matches the polar branch's needs
  // and a future absolute-coordinate path does not change the call site.
  void cx; void cy;
  return out;
}

/**
 * The colour for band `i` of `n`, interpolated between two stops and then
 * rotated through hue space by `hueShiftDeg` across the range.
 *
 * AE's Hue Interpolation. At 0 this is a plain two-stop blend, which is what
 * the effect did before — so an existing project is untouched.
 */
export function bandColor(
  i: number,
  n: number,
  insideColor: string,
  outsideColor: string,
  hueShiftDeg: number,
): string {
  const t = n <= 1 ? 0 : i / (n - 1);
  const a = parseHex(insideColor);
  const b = parseHex(outsideColor);
  let r = a[0] + (b[0] - a[0]) * t;
  let g = a[1] + (b[1] - a[1]) * t;
  let bl = a[2] + (b[2] - a[2]) * t;
  if (hueShiftDeg !== 0) {
    [r, g, bl] = rotateHue(r, g, bl, (hueShiftDeg * t) % 360);
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bl)})`;
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Rotate an RGB triple by `deg` around the hue circle. */
function rotateHue(r: number, g: number, b: number, deg: number): [number, number, number] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // The standard luminance-preserving hue rotation matrix. Cheaper and more
  // stable than a round trip through HSL, which would have to pick a hue for
  // grey.
  const m = [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
  const clamp = (v: number): number => Math.max(0, Math.min(255, v));
  return [
    clamp(r * m[0]! + g * m[1]! + b * m[2]!),
    clamp(r * m[3]! + g * m[4]! + b * m[5]!),
    clamp(r * m[6]! + g * m[7]! + b * m[8]!),
  ];
}
