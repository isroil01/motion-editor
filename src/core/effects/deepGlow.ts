/**
 * Deep Glow — a physically based glow (the Plugin Everything "Deep Glow" class).
 *
 * ## Why the built-in `glow` is not this
 *
 * `glow` is ONE Gaussian of the layer's silhouette, filled with a colour and
 * screened over the layer: a soft ring. Light does not fall off like a
 * Gaussian — a bright source over a dark field reads as a tight core with a
 * long, thin tail, close to 1/r². A single Gaussian can be the core or the
 * tail but never both, which is the whole look gap Deep Glow closes.
 *
 * ## The model
 *
 * An OCTAVE PYRAMID: K Gaussians whose sigmas double from `radius / 2^(K-1)`
 * up to `radius`, each energy-normalised and summed with EQUAL weight. An
 * energy-normalised 2D Gaussian peaks at 1/(2πσ²), so at distance r the
 * dominant octave (σ ≈ r) contributes ∝ 1/r²: equal weights ARE the
 * inverse-square falloff, and no falloff exponent has to be tuned.
 *
 * The pyramid is built PROGRESSIVELY — level k is level k−1 blurred by
 * Δ_k = √(σ_k² − σ_{k−1}²), never the source blurred by σ_k directly. Two
 * reasons. Cost: every pass is the same 33-tap separable kernel regardless of
 * radius. Aliasing: a 33-tap kernel at σ = 300 px has its taps 75 px apart,
 * which on a sharp source is a comb filter that ghosts thin content; on a
 * level already smooth at σ_{k−1} there is nothing finer than the tap
 * spacing left to alias.
 *
 * Everything runs in LINEAR light on premultiplied colour — the chain's own
 * working space on the GPU, decoded from the straight sRGB bytes here — so
 * two overlapping glows add like light and an HDR (>1) source blooms wider
 * than a clipped one.
 *
 * ## Parity
 *
 * `fxDeepGlow.ts` (the GPU) and this file share every formula: the octave
 * ladder (`deepGlowOctaves`), the tap count and integer stride
 * (`deepGlowStep`), the per-channel weights (`exp(-x²·inv)` with
 * `inv = 1/(2σ²)`), the threshold knee, the coverage-union accumulation and
 * the premultiplied-valid composite. Change one, change both — the golden
 * `effect-deep-glow` scene is the gate.
 */

import { DEEP_GLOW_TAPS, deepGlowInv, deepGlowOctaves, deepGlowStep } from '@motion/renderer';
import { effectNumber, effectParam, type Effect } from './effects';
import { hash01u } from './noiseHash';

export { DEEP_GLOW_TAPS, deepGlowInv, deepGlowOctaves, deepGlowStep };

/** `#rgb` / `#rrggbb` → bytes. Local rather than canvas2dEffects' parseHex: that module imports this one. */
function hexBytes(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = Number.parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(v)) return [255, 255, 255];
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** How wide the multipliers spread the red and blue sigmas at 100 % chromatic aberration. */
const CHROMA_SPREAD = 0.35;

/** Octave count per Quality step: Low, Medium, High. */
export const DEEP_GLOW_OCTAVES = [4, 6, 8] as const;

export interface DeepGlowSettings {
  /** Sigma of the widest octave, layer px. */
  radius: number;
  /** Linear gain on the glow, 2^exposure. */
  gain: number;
  /** Linear luma below which a pixel does not glow, 0..1. */
  threshold: number;
  /** Per-axis sigma multipliers [x, y] — the anamorphic control. */
  aspect: readonly [number, number];
  /** Per-channel sigma multipliers [r, g, b]; green is always 1. */
  chroma: readonly [number, number, number];
  /** Linear-light tint, 0..1 per channel. */
  tint: readonly [number, number, number];
  /** How far the glow's own colour is pulled toward the tint, 0..1. */
  tintAmount: number;
  /** Output the glow alone instead of source + glow. */
  glowOnly: boolean;
  /**
   * One output code of per-pixel noise on the glow. A 1/r² tail crosses the
   * 8-bit floor over a WIDE band, and that band renders as a faint disc with
   * a visible edge on a dark ground; ±1 code of noise breaks the edge. The
   * realisation differs per route (the GPU hashes the buffer pixel, this pass
   * the layer pixel) — at one code that is invisible, which is why the golden
   * scene turns it off rather than gate a coin flip.
   */
  dither: boolean;
  /** Pyramid depth. */
  octaves: number;
}

/** ±1 sRGB code near black, in linear light: the encode's toe has slope 12.92. */
export const DEEP_GLOW_DITHER_AMP = 2 / (255 * 12.92);

/** The effect's params, resolved to the numbers both engines consume. */
export function deepGlowSettings(e: Effect): DeepGlowSettings {
  const radius = Math.max(0, effectNumber(e, 'radius'));
  const exposure = effectNumber(e, 'exposure');
  const threshold = Math.max(0, Math.min(1, effectNumber(e, 'threshold') / 100));
  const aspect = Math.max(-100, Math.min(100, effectNumber(e, 'aspect'))) / 100;
  const chroma = Math.max(0, Math.min(1, effectNumber(e, 'chromatic') / 100));
  const tintHex = String(effectParam(e, 'tint') ?? '#ffffff');
  const t = hexBytes(tintHex);
  const q = Math.round(effectNumber(e, 'quality'));
  return {
    radius,
    gain: Math.pow(2, exposure),
    threshold,
    // Positive squeezes the vertical sigma (a horizontally stretched glow — the
    // anamorphic-streak convention), negative squeezes the horizontal one.
    aspect: [aspect < 0 ? Math.max(0.02, 1 + aspect) : 1, aspect > 0 ? Math.max(0.02, 1 - aspect) : 1],
    chroma: [1 + chroma * CHROMA_SPREAD, 1, Math.max(0.05, 1 - chroma * CHROMA_SPREAD)],
    tint: [srgbToLinear01(t[0] / 255), srgbToLinear01(t[1] / 255), srgbToLinear01(t[2] / 255)],
    tintAmount: Math.max(0, Math.min(1, effectNumber(e, 'tintAmount') / 100)),
    glowOnly: effectParam(e, 'glowOnly') === true,
    dither: effectParam(e, 'dither') !== false,
    octaves: DEEP_GLOW_OCTAVES[Math.max(0, Math.min(2, q))]!,
  };
}

// ── sRGB ↔ linear ────────────────────────────────────────────────────────────

export function srgbToLinear01(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb01(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

let decodeLut: Float32Array | null = null;
function decodeTable(): Float32Array {
  if (!decodeLut) {
    decodeLut = new Float32Array(256);
    for (let i = 0; i < 256; i++) decodeLut[i] = srgbToLinear01(i / 255);
  }
  return decodeLut;
}

// ── The kernel ───────────────────────────────────────────────────────────────

/**
 * Threshold knee, applied to one premultiplied linear sample IN PLACE. Below
 * the threshold nothing glows; above it the contribution is the brightness in
 * excess of the threshold, as a fraction of the brightness — so a threshold of
 * 0 is exactly the identity, and the knee is continuous.
 */
function applyThreshold(buf: Float32Array, o: number, threshold: number): void {
  const a = buf[o + 3]!;
  if (a <= 0) { buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 0; return; }
  const lum = (0.2126 * buf[o]! + 0.7152 * buf[o + 1]! + 0.0722 * buf[o + 2]!) / a;
  if (lum <= threshold) { buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 0; return; }
  const f = (lum - threshold) / lum;
  buf[o] = buf[o]! * f; buf[o + 1] = buf[o + 1]! * f; buf[o + 2] = buf[o + 2]! * f; buf[o + 3] = a * f;
}

/**
 * One separable pass along `axis` (0 = x, 1 = y), clamping to the edge as the
 * GPU's clamp sampler does. Per-channel sigmas (red, green/alpha, blue).
 */
function blur1D(
  src: Float32Array, dst: Float32Array, w: number, h: number, axis: 0 | 1,
  sigmas: readonly [number, number, number],
): void {
  const step = deepGlowStep(Math.max(sigmas[0], sigmas[1], sigmas[2]));
  const inv = [deepGlowInv(sigmas[0]), deepGlowInv(sigmas[1]), deepGlowInv(sigmas[2])];
  const n = 2 * DEEP_GLOW_TAPS + 1;
  const wr = new Float64Array(n); const wg = new Float64Array(n); const wb = new Float64Array(n);
  let sr = 0; let sg = 0; let sb = 0;
  for (let i = -DEEP_GLOW_TAPS; i <= DEEP_GLOW_TAPS; i++) {
    const x = i * step; const x2 = x * x;
    const r = Math.exp(-x2 * inv[0]!); const g = Math.exp(-x2 * inv[1]!); const b = Math.exp(-x2 * inv[2]!);
    wr[i + DEEP_GLOW_TAPS] = r; wg[i + DEEP_GLOW_TAPS] = g; wb[i + DEEP_GLOW_TAPS] = b;
    sr += r; sg += g; sb += b;
  }
  for (let i = 0; i < n; i++) { wr[i]! /= sr; wg[i]! /= sg; wb[i]! /= sb; }
  const len = axis === 0 ? w : h;
  const lines = axis === 0 ? h : w;
  for (let l = 0; l < lines; l++) {
    for (let p = 0; p < len; p++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let i = -DEEP_GLOW_TAPS; i <= DEEP_GLOW_TAPS; i++) {
        let q = p + i * step;
        if (q < 0) q = 0; else if (q >= len) q = len - 1;
        const o = axis === 0 ? (l * w + q) * 4 : (q * w + l) * 4;
        const k = i + DEEP_GLOW_TAPS;
        r += src[o]! * wr[k]!; g += src[o + 1]! * wg[k]!; b += src[o + 2]! * wb[k]!; a += src[o + 3]! * wg[k]!;
      }
      const d = axis === 0 ? (l * w + p) * 4 : (p * w + l) * 4;
      dst[d] = r; dst[d + 1] = g; dst[d + 2] = b; dst[d + 3] = a;
    }
  }
}

/**
 * The glow field alone — premultiplied linear RGBA floats, BEFORE gain, tint
 * and compositing — from premultiplied linear input. Exposed for the falloff
 * test, which needs the field, not its 8-bit encoding.
 */
export function deepGlowField(lin: Float32Array, w: number, h: number, s: DeepGlowSettings): Float32Array {
  const n = w * h * 4;
  const level = new Float32Array(lin);
  if (s.threshold > 0) for (let o = 0; o < n; o += 4) applyThreshold(level, o, s.threshold);
  const tmp = new Float32Array(n);
  const acc = new Float32Array(n);
  const octs = deepGlowOctaves(s.radius, s.octaves);
  const weight = 1 / octs.length;
  for (const oct of octs) {
    const sx = oct.delta * s.aspect[0];
    const sy = oct.delta * s.aspect[1];
    blur1D(level, tmp, w, h, 0, [sx * s.chroma[0], sx * s.chroma[1], sx * s.chroma[2]]);
    blur1D(tmp, level, w, h, 1, [sy * s.chroma[0], sy * s.chroma[1], sy * s.chroma[2]]);
    for (let o = 0; o < n; o += 4) {
      acc[o] = acc[o]! + level[o]! * weight;
      acc[o + 1] = acc[o + 1]! + level[o + 1]! * weight;
      acc[o + 2] = acc[o + 2]! + level[o + 2]! * weight;
      // Coverage UNION for alpha — what an additive draw with an `over` alpha
      // factor does on the GPU — so the two engines agree on the halo's alpha.
      const wa = level[o + 3]! * weight;
      acc[o + 3] = acc[o + 3]! + wa - acc[o + 3]! * wa;
    }
  }
  return acc;
}

/** Straight sRGB bytes in, straight sRGB bytes out — the Canvas2D pass. */
export function deepGlowData(src: Uint8ClampedArray, w: number, h: number, s: DeepGlowSettings): Uint8ClampedArray {
  const out = Uint8ClampedArray.from(src);
  if (s.radius <= 0 && !s.glowOnly) return out;
  const n = w * h * 4;
  const lut = decodeTable();
  const lin = new Float32Array(n);
  for (let o = 0; o < n; o += 4) {
    const a = src[o + 3]! / 255;
    lin[o] = lut[src[o]!]! * a; lin[o + 1] = lut[src[o + 1]!]! * a; lin[o + 2] = lut[src[o + 2]!]! * a; lin[o + 3] = a;
  }
  const glow = deepGlowField(lin, w, h, s);
  const tr = 1 + (s.tint[0] - 1) * s.tintAmount;
  const tg = 1 + (s.tint[1] - 1) * s.tintAmount;
  const tb = 1 + (s.tint[2] - 1) * s.tintAmount;
  for (let o = 0; o < n; o += 4) {
    let gr = glow[o]! * s.gain * tr; let gg = glow[o + 1]! * s.gain * tg; let gb = glow[o + 2]! * s.gain * tb;
    let ga = Math.min(1, glow[o + 3]! * s.gain);
    if (s.dither && ga > 0) {
      const p = o >> 2;
      const dn = (hash01u(p % w, (p / w) | 0, 0) - 0.5) * DEEP_GLOW_DITHER_AMP;
      gr = Math.max(0, gr + dn); gg = Math.max(0, gg + dn); gb = Math.max(0, gb + dn); ga = Math.max(0, ga + dn);
    }
    const a = s.glowOnly ? ga : Math.min(1, lin[o + 3]! + ga);
    // Premultiplied-valid: a channel never exceeds its alpha, so the straight
    // colour written back is ≤ 1 and the layer composes like every other.
    const r = Math.min(a, (s.glowOnly ? 0 : lin[o]!) + gr);
    const g = Math.min(a, (s.glowOnly ? 0 : lin[o + 1]!) + gg);
    const b = Math.min(a, (s.glowOnly ? 0 : lin[o + 2]!) + gb);
    if (a <= 0) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; continue; }
    out[o] = Math.round(linearToSrgb01(r / a) * 255);
    out[o + 1] = Math.round(linearToSrgb01(g / a) * 255);
    out[o + 2] = Math.round(linearToSrgb01(b / a) * 255);
    out[o + 3] = Math.round(a * 255);
  }
  return out;
}
