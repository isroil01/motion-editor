/**
 * Energy Beam (`beam-path`) — the Saber class: a lit core stroke with a
 * physically shaped glow, drawn along a MASK PATH, a text outline or a plain
 * Start→End line, with a reveal window, size taper, curl-noise distortion and
 * flicker.
 *
 * ## Geometry
 *
 * Whatever the source, the spine reaches the kernel as a flat polyline in
 * layer-local CENTRED px (the hand-off `maskPathPolyline` / buildSnapshot
 * already make for Write-on and Vegas). `beamSpine` resamples it by arc
 * length to at most `BEAM_MAX_POINTS` vertices — the GPU carries the spine
 * in a uniform block, two points per vec4 — and keeps sub-paths apart with
 * a PEN-UP sentinel (`BEAM_PEN_UP` as the x of a point), so a text outline
 * with several letters stays several strokes.
 *
 * ## Field
 *
 * Per pixel, the signed distance to the visible part of the spine. The
 * reveal window (Start/End, as fractions of total arc length) is applied per
 * SEGMENT by clamping the closest-point parameter into the segment's visible
 * sub-range, so the ends are exact rather than faded. The core half-width
 * tapers from Start Size to End Size along the window. Around the core an
 * inverse-power glow: `intensity · (1 + d/spread)^(−e)`, `e` from Bias, cut
 * with a smooth fade at 10·spread so the padding stays bounded. Distortion
 * warps the QUERY point by the curl of an fbm potential (the same field as
 * the Curl Noise effect, same hash), which bends the whole beam coherently
 * rather than jittering its edge.
 *
 * ## Determinism
 *
 * Evolution and flicker are KEYFRAMED phases, not the wall clock — the
 * repo's rule for every time-varying generator (see `TIME_DEPENDENT` in
 * effects.ts). Two renders at the same params are byte-identical, which is
 * what the frame cache and the golden gate need.
 *
 * ## Parity
 *
 * `fxBeamPath.ts` mirrors every formula here in WGSL/GLSL; the uniform rows
 * both engines read are built by ONE function, `beamPathRows`. Colours are
 * linear light (the chain's working space); the CPU pass decodes the layer's
 * straight sRGB bytes to premultiplied linear, adds, and encodes back.
 */

import { effectNumber, effectParam, paramsOf, type Effect } from './effects';
import { fbmU, hash01u, mix } from './noiseHash';
import { linearToSrgb01, srgbToLinear01 } from './deepGlow';

/** Vertices the uniform block carries (two per vec4 → 32 rows). */
export const BEAM_MAX_POINTS = 64;
/** A point whose x is this is a pen-up: no segment into or out of it. */
export const BEAM_PEN_UP = 1e9;
/** Param rows before the point rows in the uniform block. */
export const BEAM_PARAM_ROWS = 7;

export interface BeamPathSettings {
  /** Spine in layer px, TOP-LEFT origin, flat [x0,y0,x1,y1,…] with BEAM_PEN_UP sentinels. ≤ BEAM_MAX_POINTS points. */
  points: number[];
  /** Total visible arc length (sum of real segments), px. */
  totalLen: number;
  coreWidth: number;
  /** 0..1 — fraction of the half-width that is soft. */
  coreSoftness: number;
  coreColor: readonly [number, number, number];
  glowColor: readonly [number, number, number];
  glowSpread: number;
  glowIntensity: number;
  /** Falloff exponent, 1 (long tail) … 4 (tight). */
  glowExponent: number;
  /** Reveal window, fractions of arc length. */
  start: number;
  end: number;
  /** Half-width multipliers at Start and End. */
  startSize: number;
  endSize: number;
  /** Curl-noise displacement, px. */
  distortion: number;
  /** Feature size of the distortion field, px. */
  distortionScale: number;
  evolution: number;
  /** 0 = add over the layer, 1 = beam alone. */
  composite: number;
  /** Multiplier from the flicker phase, already folded in. */
  flicker: number;
}

/** Distinct sources for the spine — the enum the def exposes. */
export const BEAM_SOURCE = { auto: 0, line: 1, text: 2 } as const;

// ── Spine ────────────────────────────────────────────────────────────────────

function subpathsOf(flat: readonly number[]): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i]!; const y = flat[i + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x >= BEAM_PEN_UP) {
      if (cur.length >= 4) out.push(cur);
      cur = [];
      continue;
    }
    cur.push(x, y);
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

function arcLength(p: readonly number[]): number {
  let l = 0;
  for (let i = 2; i + 1 < p.length; i += 2) l += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
  return l;
}

/** Resample one open polyline to exactly `n` points spaced by arc length (keeps both ends). */
function resample(p: readonly number[], n: number): number[] {
  const count = p.length / 2;
  if (n >= count) return [...p];
  const total = arcLength(p);
  const out: number[] = [p[0]!, p[1]!];
  if (total <= 0) return out;
  let seg = 0; let segStart = 0;
  let segLen = Math.hypot(p[2]! - p[0]!, p[3]! - p[1]!);
  for (let k = 1; k < n - 1; k++) {
    const target = (k / (n - 1)) * total;
    while (seg < count - 2 && segStart + segLen < target) {
      segStart += segLen; seg++;
      segLen = Math.hypot(p[seg * 2 + 2]! - p[seg * 2]!, p[seg * 2 + 3]! - p[seg * 2 + 1]!);
    }
    const t = segLen > 0 ? Math.min(1, Math.max(0, (target - segStart) / segLen)) : 0;
    out.push(mix(p[seg * 2]!, p[seg * 2 + 2]!, t), mix(p[seg * 2 + 1]!, p[seg * 2 + 3]!, t));
  }
  out.push(p[p.length - 2]!, p[p.length - 1]!);
  return out;
}

/**
 * The spine the kernel draws: sub-paths resampled to fit the uniform budget,
 * pen-ups between them, in the coordinate space the input used.
 */
export function beamSpine(flat: readonly number[], maxPoints = BEAM_MAX_POINTS): { points: number[]; totalLen: number } {
  const subs = subpathsOf(flat);
  if (subs.length === 0) return { points: [], totalLen: 0 };
  const lens = subs.map(arcLength);
  const total = lens.reduce((a, b) => a + b, 0);
  // One slot per pen-up between sub-paths; at least two points per sub-path.
  const budget = maxPoints - (subs.length - 1);
  const out: number[] = [];
  let remaining = budget;
  for (let i = 0; i < subs.length; i++) {
    const share = total > 0 ? Math.round((lens[i]! / total) * budget) : Math.floor(budget / subs.length);
    const n = Math.max(2, Math.min(remaining - 2 * (subs.length - 1 - i), share, subs[i]!.length / 2));
    remaining -= n;
    if (i > 0) out.push(BEAM_PEN_UP, 0);
    out.push(...resample(subs[i]!, n));
  }
  return { points: out, totalLen: total };
}

// ── Settings ─────────────────────────────────────────────────────────────────

function hexLinear(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = Number.parseInt(h.slice(0, 6), 16);
  const b: [number, number, number] = Number.isFinite(v) ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : [255, 255, 255];
  return [srgbToLinear01(b[0] / 255), srgbToLinear01(b[1] / 255), srgbToLinear01(b[2] / 255)];
}

/** Flicker multiplier at a keyframed phase: smooth value noise, 1 − depth·n. */
export function beamFlicker(phase: number, rate: number, seed: number, depth: number): number {
  if (depth <= 0) return 1;
  const x = phase * Math.max(0, rate);
  const i = Math.floor(x); const f = x - i; const u = f * f * (3 - 2 * f);
  const n = mix(hash01u(i, 7, seed), hash01u(i + 1, 7, seed), u);
  return 1 - Math.max(0, Math.min(1, depth)) * n;
}

/**
 * Resolve the effect's params for a layer of `w`×`h` px. The spine comes from
 * the resolved `pathPoints` (buildSnapshot fills it from the mask path or the
 * text outline, centred px) or, absent that, the Start→End line.
 */
export function beamPathSettings(e: Effect, w: number, h: number): BeamPathSettings {
  const p = paramsOf(e);
  const n = (k: string): number => effectNumber(e, k);
  const source = Math.round(n('source'));
  const flat = p.pathPoints;
  let spine: number[];
  if (source !== BEAM_SOURCE.line && Array.isArray(flat) && flat.length >= 4) {
    spine = flat.map((v) => (typeof v === 'number' ? v : BEAM_PEN_UP));
  } else {
    spine = [n('startX'), n('startY'), n('endX'), n('endY')];
  }
  const { points, totalLen } = beamSpine(spine);
  // Centred → top-left, where the kernel's pixel coordinates live.
  for (let i = 0; i + 1 < points.length; i += 2) {
    if (points[i]! >= BEAM_PEN_UP) continue;
    points[i] = points[i]! + w / 2; points[i + 1] = points[i + 1]! + h / 2;
  }
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const start = clamp01(n('start') / 100);
  const end = clamp01(n('end') / 100);
  return {
    points,
    totalLen,
    coreWidth: Math.max(0, n('coreWidth')),
    coreSoftness: clamp01(n('coreSoftness') / 100),
    coreColor: hexLinear(String(effectParam(e, 'coreColor') ?? '#ffffff')),
    glowColor: hexLinear(String(effectParam(e, 'glowColor') ?? '#3fa8ff')),
    glowSpread: Math.max(0.5, n('glowSpread')),
    glowIntensity: Math.max(0, n('glowIntensity') / 100),
    glowExponent: 1 + 3 * clamp01(n('glowBias') / 100),
    start: Math.min(start, end),
    end: Math.max(start, end),
    startSize: Math.max(0, n('startSize') / 100),
    endSize: Math.max(0, n('endSize') / 100),
    distortion: Math.max(0, n('distortion')),
    distortionScale: Math.max(4, n('distortionScale')),
    evolution: n('evolution'),
    composite: Math.round(n('composite')),
    flicker: beamFlicker(n('flickerPhase'), n('flickerRate'), Math.round(n('seed')), clamp01(n('flicker') / 100)),
  };
}

/** How far outside the spine the glow reaches (the padding both routes reserve). */
export function beamPathSpreadPx(s: BeamPathSettings): number {
  return s.coreWidth * Math.max(s.startSize, s.endSize) + s.glowSpread * 10 + s.distortion;
}

/**
 * The uniform rows, shared by the packer and (through `packFxBlock`) the
 * shader: p0 = lw, lh, point count, total length; p1 = core half-width,
 * softness, spread, intensity·flicker; p2 = exponent, start, end, start size;
 * p3 = end size, distortion, 1/scale, evolution·0.01; p4 = composite, aa,
 * flicker, 0; p5 = core colour; p6 = glow colour; then points, two per row.
 */
export function beamPathRows(s: BeamPathSettings, lw: number, lh: number): [number, number, number, number][] {
  const count = s.points.length / 2;
  const rows: [number, number, number, number][] = [
    [lw, lh, count, s.totalLen],
    [s.coreWidth / 2, s.coreSoftness, s.glowSpread, s.glowIntensity * s.flicker],
    [s.glowExponent, s.start, s.end, s.startSize],
    [s.endSize, s.distortion, 1 / s.distortionScale, s.evolution * 0.01],
    [s.composite, 0.75, s.flicker, 0],
    [s.coreColor[0], s.coreColor[1], s.coreColor[2], 0],
    [s.glowColor[0], s.glowColor[1], s.glowColor[2], 0],
  ];
  for (let i = 0; i < BEAM_MAX_POINTS; i += 2) {
    const a = i < count ? [s.points[i * 2]!, s.points[i * 2 + 1]!] : [BEAM_PEN_UP, 0];
    const b = i + 1 < count ? [s.points[i * 2 + 2]!, s.points[i * 2 + 3]!] : [BEAM_PEN_UP, 0];
    rows.push([a[0]!, a[1]!, b[0]!, b[1]!]);
  }
  return rows;
}

// ── Field ────────────────────────────────────────────────────────────────────

function sstep(e0: number, e1: number, x: number): number {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Core coverage and glow strength at layer px (qx, qy), top-left origin. */
export function beamFieldAt(qx: number, qy: number, s: BeamPathSettings): { core: number; glow: number } {
  const pts = s.points;
  const count = pts.length / 2;
  if (count < 2 || s.totalLen <= 0) return { core: 0, glow: 0 };
  let x = qx; let y = qy;
  if (s.distortion > 0) {
    const inv = 1 / s.distortionScale; const ev = s.evolution * 0.01;
    const fx = Math.floor(qx); const fy = Math.floor(qy);
    const dpdx = fbmU((fx + 1) * inv + ev, fy * inv - ev, 53, 3) - fbmU((fx - 1) * inv + ev, fy * inv - ev, 53, 3);
    const dpdy = fbmU(fx * inv + ev, (fy + 1) * inv - ev, 53, 3) - fbmU(fx * inv + ev, (fy - 1) * inv - ev, 53, 3);
    x += dpdy * s.distortion; y -= dpdx * s.distortion;
  }
  const halfW = s.coreWidth / 2;
  const win = Math.max(s.end - s.start, 1e-6);
  let core = 0;
  let dmin = 1e9;
  let acc = 0;
  for (let i = 0; i + 1 < count; i++) {
    const ax = pts[i * 2]!; const ay = pts[i * 2 + 1]!; const bx = pts[i * 2 + 2]!; const by = pts[i * 2 + 3]!;
    if (ax >= BEAM_PEN_UP || bx >= BEAM_PEN_UP) continue;
    const abx = bx - ax; const aby = by - ay;
    const len = Math.hypot(abx, aby);
    const sa = acc / s.totalLen; const sb = (acc + len) / s.totalLen;
    acc += len;
    if (len <= 1e-6) continue;
    const va = Math.max(sa, s.start); const vb = Math.min(sb, s.end);
    if (vb <= va) continue;
    const ta = (va - sa) / (sb - sa); const tb = (vb - sa) / (sb - sa);
    let t = ((x - ax) * abx + (y - ay) * aby) / (len * len);
    t = Math.max(ta, Math.min(tb, t));
    const px = ax + abx * t; const py = ay + aby * t;
    const d = Math.hypot(x - px, y - py);
    const sAt = sa + t * (sb - sa);
    const u = (sAt - s.start) / win;
    const wh = halfW * mix(s.startSize, s.endSize, Math.max(0, Math.min(1, u)));
    const soft = wh * s.coreSoftness;
    const cov = 1 - sstep(wh - soft, wh + soft + 0.75, d);
    if (cov > core) core = cov;
    const dg = d - wh;
    if (dg < dmin) dmin = dg;
  }
  if (dmin >= 1e9) return { core: 0, glow: 0 };
  const dd = Math.max(0, dmin);
  let glow = s.glowIntensity * s.flicker * Math.pow(1 + dd / s.glowSpread, -s.glowExponent);
  glow *= 1 - sstep(6 * s.glowSpread, 10 * s.glowSpread, dd);
  return { core: core * s.flicker, glow };
}

// ── The Canvas2D pass ────────────────────────────────────────────────────────

let lut: Float32Array | null = null;
function decodeTable(): Float32Array {
  if (!lut) { lut = new Float32Array(256); for (let i = 0; i < 256; i++) lut[i] = srgbToLinear01(i / 255); }
  return lut;
}

/** Straight sRGB bytes in and out; the beam is added in linear light. */
export function beamPathData(src: Uint8ClampedArray, w: number, h: number, s: BeamPathSettings): Uint8ClampedArray {
  const out = Uint8ClampedArray.from(src);
  const table = decodeTable();
  const beamOnly = s.composite === 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const { core, glow } = beamFieldAt(x + 0.5, y + 0.5, s);
      const addA = Math.min(1, core + Math.min(1, glow));
      if (addA <= 0 && !beamOnly) continue;
      const sa = beamOnly ? 0 : src[o + 3]! / 255;
      const sr = beamOnly ? 0 : table[src[o]!]! * sa;
      const sg = beamOnly ? 0 : table[src[o + 1]!]! * sa;
      const sb = beamOnly ? 0 : table[src[o + 2]!]! * sa;
      const a = Math.min(1, sa + addA);
      const r = Math.min(a, sr + s.coreColor[0] * core + s.glowColor[0] * glow);
      const g = Math.min(a, sg + s.coreColor[1] * core + s.glowColor[1] * glow);
      const b = Math.min(a, sb + s.coreColor[2] * core + s.glowColor[2] * glow);
      if (a <= 0) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; continue; }
      out[o] = Math.round(linearToSrgb01(r / a) * 255);
      out[o + 1] = Math.round(linearToSrgb01(g / a) * 255);
      out[o + 2] = Math.round(linearToSrgb01(b / a) * 255);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}
