/**
 * Effects round seven — the Distort and Transition members.
 *
 *   • CC Tiler            — the frame scaled down and tiled to fill the layer
 *   • CC Ripple Pulse     — one expanding ring of radial displacement
 *   • CC Radial ScaleWipe — pixels pulled toward (or pushed from) a centre
 *   • CC Glass Wipe       — the layer's own luminance as a refracting wipe
 *   • CC Image Wipe       — a channel of the layer as the wipe gradient
 *
 * All five are pure `Uint8ClampedArray` transforms over straight-alpha display
 * sRGB bytes, and each is the REFERENCE its GPU twin in
 * `packages/renderer/src/shaders/fxRoundFifteen.ts` is checked against.
 *
 * Four of the five are inverse-map resamples, which is the shape every member
 * of the Distort family here takes: for each DESTINATION pixel, compute the
 * source point it reads and sample there. Written that way rather than as a
 * forward scatter because a scatter leaves holes wherever the map expands, and
 * filling those holes is a second, harder problem — see `distort.ts`, whose
 * `remap` helper does the bilinear sampling for all of them.
 *
 * The exception is Image Wipe, which touches only ALPHA. A wipe that also
 * rewrote colour could not be stacked under another wipe, and AE's is a reveal.
 */

import { clamp01, clamp255, luma, smoothstep } from './colorSpace';
import { remap } from './distort';

/** Positive modulo — `%` keeps the dividend's sign, which tiles wrongly. */
function pmod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

// ── CC Tiler ─────────────────────────────────────────────────────────────────

/**
 * CC Tiler — the whole frame shrunk by `scale` and repeated across the layer.
 *
 * `scale` is a PERCENTAGE and 100 is the identity, which is why the inverse map
 * divides by it: a destination pixel at `p` reads the source at `p / (scale/100)`
 * wrapped into the layer, so scale 50 fits two copies per axis. AE's own control
 * reads the same way, and a user who types 100 expects nothing to happen.
 */
export function ccTilerData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  scale = 100,
  centerX = 0,
  centerY = 0,
  blendWithOriginal = 0,
): Uint8ClampedArray {
  const k = Math.max(0.01, scale / 100);
  const cx = w / 2 + centerX;
  const cy = h / 2 + centerY;
  const out = remap(src, w, h, (x, y) => ({
    x: pmod((x - cx) / k + cx, w),
    y: pmod((y - cy) / k + cy, h),
  }));
  const blend = clamp01(blendWithOriginal / 100);
  if (blend > 0) {
    for (let i = 0; i < out.length; i++) {
      out[i] = clamp255(out[i]! * (1 - blend) + src[i]! * blend);
    }
  }
  return out;
}

// ── CC Ripple Pulse ──────────────────────────────────────────────────────────

/**
 * CC Ripple Pulse — a single ring of radial displacement at `pulseRadius`.
 *
 * ONE ring, not a train of them, and it does not move on its own: the user
 * keyframes `pulseRadius` outward, which is how AE's own Ripple Pulse works
 * (its "Pulse Level" is the animated property) and what keeps the effect
 * cacheable. See the note on TIME_DEPENDENT in `effects.ts` for why a
 * keyframed phase is always preferred to reading the clock.
 *
 * The displacement is one lobe of a sine across the band, so it is zero at both
 * edges — a ring that ended abruptly would show as a hard circular seam.
 */
export function ripplePulseData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  centerX = 0,
  centerY = 0,
  pulseRadius = 0,
  amplitude = 40,
  width = 60,
  renderBump = true,
): Uint8ClampedArray {
  const cx = w / 2 + centerX;
  const cy = h / 2 + centerY;
  const band = Math.max(1, width);
  const out = remap(src, w, h, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    const d = r - pulseRadius;
    if (Math.abs(d) >= band || r < 0.0001) return { x, y };
    const disp = amplitude * Math.sin((Math.PI * d) / band);
    return { x: x - (dx / r) * disp, y: y - (dy / r) * disp };
  });
  if (!renderBump || amplitude === 0) return out;

  // The ring is shaded by the SLOPE of the displacement, which is what makes a
  // flat-coloured layer show the pulse at all: with no shading, a ripple over
  // uniform pixels resamples uniform pixels and is invisible.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      const d = r - pulseRadius;
      if (Math.abs(d) >= band) continue;
      const slope = Math.cos((Math.PI * d) / band) * (amplitude / band);
      const lit = clamp01(1 + slope * 0.5);
      const o = (y * w + x) * 4;
      out[o] = clamp255(out[o]! * lit);
      out[o + 1] = clamp255(out[o + 1]! * lit);
      out[o + 2] = clamp255(out[o + 2]! * lit);
    }
  }
  return out;
}

// ── CC Radial ScaleWipe ──────────────────────────────────────────────────────

/**
 * CC Radial ScaleWipe — the picture collapses into (or explodes out of) a point.
 *
 * A transition, so `completion` 0 is the untouched layer and 100 leaves nothing.
 * The scale factor is `1 - t` forward and `1 / (1 - t)` reversed; alpha rides
 * the same ramp so the layer genuinely leaves rather than shrinking to a dot
 * and staying there.
 */
export function radialScaleWipeData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  completion = 0,
  centerX = 0,
  centerY = 0,
  reverse = false,
): Uint8ClampedArray {
  const t = clamp01(completion / 100);
  if (t <= 0) return new Uint8ClampedArray(src);
  const cx = w / 2 + centerX;
  const cy = h / 2 + centerY;
  const out = new Uint8ClampedArray(src.length);
  if (t >= 1) return out;

  // Forward: the destination reads a point FURTHER out, so the picture shrinks.
  const k = reverse ? 1 - t : 1 / (1 - t);
  const resampled = remap(src, w, h, (x, y) => ({
    x: (x - cx) * k + cx,
    y: (y - cy) * k + cy,
  }));
  const fade = 1 - t;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    out[o] = resampled[o]!;
    out[o + 1] = resampled[o + 1]!;
    out[o + 2] = resampled[o + 2]!;
    out[o + 3] = clamp255(resampled[o + 3]! * fade);
  }
  return out;
}

// ── CC Glass Wipe ────────────────────────────────────────────────────────────

/**
 * CC Glass Wipe — the layer's own luminance drives both the reveal and a
 * refraction along its gradient, so the picture appears to melt away.
 *
 * The gradient is read from the SOURCE, not from the partially-wiped result, so
 * the displacement of a pixel does not depend on the order pixels are visited —
 * that determinism is what lets the shader compute each fragment independently.
 */
export function glassWipeData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  completion = 0,
  displacement = 40,
  softness = 30,
): Uint8ClampedArray {
  const t = clamp01(completion / 100);
  if (t <= 0) return new Uint8ClampedArray(src);
  const out = new Uint8ClampedArray(src.length);
  if (t >= 1) return out;

  const band = Math.max(0.02, clamp01(softness / 100));
  const lumAt = (x: number, y: number): number => {
    const xi = Math.max(0, Math.min(w - 1, x));
    const yi = Math.max(0, Math.min(h - 1, y));
    const o = (yi * w + xi) * 4;
    return luma(src[o]!, src[o + 1]!, src[o + 2]!) / 255;
  };

  // Completion is compared against luminance, so the DARK areas leave first.
  // The band is what the softness widens; edge0/edge1 straddle the threshold so
  // the wipe is centred on it rather than lagging behind by a whole band.
  const resampled = remap(src, w, h, (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const l = lumAt(xi, yi);
    const edge = clamp01((t * (1 + band) - band * 0.5 - l) / band);
    if (edge <= 0 || edge >= 1) return { x, y };
    const gx = lumAt(xi + 1, yi) - lumAt(xi - 1, yi);
    const gy = lumAt(xi, yi + 1) - lumAt(xi, yi - 1);
    // Peaks mid-band: no refraction where the glass has not started to go, and
    // none where it has already gone.
    const k = displacement * Math.sin(Math.PI * edge);
    return { x: x + gx * k, y: y + gy * k };
  });

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const l = lumAt(x, y);
      const edge = clamp01((t * (1 + band) - band * 0.5 - l) / band);
      out[o] = resampled[o]!;
      out[o + 1] = resampled[o + 1]!;
      out[o + 2] = resampled[o + 2]!;
      out[o + 3] = clamp255(resampled[o + 3]! * (1 - edge));
    }
  }
  return out;
}

// ── CC Image Wipe ────────────────────────────────────────────────────────────

/** The channel Image Wipe reads its gradient from. Matches the def's enum. */
export type ImageWipeChannel = 0 | 1 | 2 | 3 | 4;

/**
 * CC Image Wipe — an ALPHA-ONLY reveal gated on one channel of the layer.
 *
 * Alpha-only for the reason every wipe here is: a transition that also wrote
 * RGB could not be stacked under a second one, and AE's Image Wipe reveals
 * rather than paints. Light Wipe is the deliberate exception in round four.
 */
export function imageWipeData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  completion = 0,
  borderSoftness = 20,
  gradientChannel: ImageWipeChannel = 0,
  invertGradient = false,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const t = clamp01(completion / 100);
  if (t <= 0) return out;
  const band = Math.max(0.001, clamp01(borderSoftness / 100));

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = src[o]!;
    const g = src[o + 1]!;
    const b = src[o + 2]!;
    const a = src[o + 3]!;
    let v: number;
    switch (gradientChannel) {
      case 1: v = a / 255; break;
      case 2: v = r / 255; break;
      case 3: v = g / 255; break;
      case 4: v = b / 255; break;
      default: v = luma(r, g, b) / 255;
    }
    if (invertGradient) v = 1 - v;
    // Mapped over [-band, 1+band] so completion 0 hides nothing and 100 hides
    // everything however wide the softness band is.
    const th = t * (1 + 2 * band) - band;
    out[o + 3] = clamp255(a * (1 - smoothstep(th - band, th + band, v === 0 ? 0 : v)));
    // A fully-cleared pixel keeps its colour: the alpha is the reveal, and
    // zeroing RGB would break any straight-alpha consumer downstream.
  }
  return out;
}
