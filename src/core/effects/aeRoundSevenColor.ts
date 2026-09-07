/**
 * Effects round seven — the Keying and Colour members that need the pixels.
 *
 *   • Color Difference Key      — AE's two-partial-matte key
 *   • CC Simple Wire Removal    — paint a wire out by blending across it
 *   • Broadcast Colors          — the NTSC / PAL legaliser
 *   • Noise HLS                 — grain in hue, lightness and saturation
 *
 * The three round-seven colour effects that ARE per-channel transfers live in
 * `aeRoundSevenLuts.ts` instead, and join `LUT_BUILDERS` rather than this file:
 * a table is free on both backends and forces no bake, so a colour effect
 * belongs here only when it genuinely cannot be expressed as one. Each of these
 * four reads either its neighbours or all three channels at once, so none can.
 */

import { clamp01, clamp255, hslToRgb, luma, rgbToHsl } from './colorSpace';

/** Deterministic 0..1 hash of two integers — the same one every round uses. */
function hash2(a: number, b: number): number {
  let n = (a * 374761393 + b * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// ── Color Difference Key ─────────────────────────────────────────────────────

/**
 * Color Difference Key — AE's key that builds TWO partial mattes and
 * intersects them, rather than thresholding one distance.
 *
 * Partial A is "how unlike the key colour is this pixel", measured along the
 * key hue's own axis. Partial B is the complementary measure — how much the
 * pixel leans toward the key colour relative to its other channels. A pixel is
 * foreground only where BOTH say so, which is what lets this key hold a
 * semi-transparent edge that a single distance threshold either crushes to
 * opaque or eats away.
 *
 * The two are then levelled by black point / white point / gamma, which is the
 * "Matte" section of AE's own control: the raw partials are almost never usable
 * without pulling the ends in.
 */
export function colorDifferenceKeyData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  keyR = 0,
  keyG = 255,
  keyB = 0,
  matteInBlack = 0,
  matteInWhite = 255,
  matteGamma = 1,
  viewMode = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  const kr = keyR / 255;
  const kg = keyG / 255;
  const kb = keyB / 255;
  const keyLen = Math.hypot(kr, kg, kb) || 1;
  // The key direction, and the plane orthogonal to it. A pixel's component
  // ALONG the key is what makes it background; what is left is its own colour.
  const ur = kr / keyLen;
  const ug = kg / keyLen;
  const ub = kb / keyLen;

  const black = clamp01(matteInBlack / 255);
  const white = clamp01(matteInWhite / 255);
  const span = Math.max(0.0001, white - black);
  const gamma = Math.max(0.01, matteGamma);

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = src[o]! / 255;
    const g = src[o + 1]! / 255;
    const b = src[o + 2]! / 255;
    const a = src[o + 3]!;

    // Partial A — the component along the key axis, normalised: 1 where the
    // pixel is pure key colour, 0 where it is orthogonal to it.
    const along = r * ur + g * ug + b * ub;
    const mag = Math.hypot(r, g, b);
    const partialA = mag < 0.0001 ? 0 : clamp01(along / mag);

    // Partial B — how far the key channel leads the others in absolute terms.
    // Scaled by the pixel's own key-channel value so a dark pixel that merely
    // leans green does not read as screen.
    const keyChan = kr >= kg && kr >= kb ? r : kg >= kb ? g : b;
    const otherMax = kr >= kg && kr >= kb
      ? Math.max(g, b)
      : kg >= kb ? Math.max(r, b) : Math.max(r, g);
    const partialB = clamp01(keyChan - otherMax);

    // Intersect: background needs BOTH. `matte` is 1 = keep, 0 = key out.
    const backness = clamp01(partialA * partialA * (partialB * 2));
    let matte = 1 - backness;
    matte = clamp01((matte - black) / span);
    matte = Math.pow(matte, 1 / gamma);

    if (viewMode === 1) {
      const v = clamp255(matte * 255);
      out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
      continue;
    }
    out[o] = src[o]!;
    out[o + 1] = src[o + 1]!;
    out[o + 2] = src[o + 2]!;
    out[o + 3] = clamp255(a * matte);
  }
  return out;
}

// ── CC Simple Wire Removal ───────────────────────────────────────────────────

/**
 * CC Simple Wire Removal — replace a thin straight run of pixels with what is
 * beside it, which is how a rigging wire is painted out in practice.
 *
 * Deliberately NOT an inpaint. The effect's whole premise is that the wire is
 * thin and the background either side of it is similar, so a blend across it is
 * indistinguishable from the truth; anything cleverer belongs in Content-Aware
 * Fill, which this repo already ships. `slope` widens the region the two
 * samples are taken from, which is what softens the seam when the background
 * has any gradient across the wire.
 */
export function wireRemovalData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  pointAX = -100,
  pointAY = 0,
  pointBX = 100,
  pointBY = 0,
  thickness = 4,
  slope = 50,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const ax = w / 2 + pointAX;
  const ay = h / 2 + pointAY;
  const bx = w / 2 + pointBX;
  const by = h / 2 + pointBY;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 0.0001 || thickness <= 0) return out;
  // Unit vectors along the wire and across it.
  const tx = dx / len;
  const ty = dy / len;
  const nx = -ty;
  const ny = tx;
  const half = thickness / 2;
  const reach = half + (clamp01(slope / 100) * thickness) + 1;

  const at = (x: number, y: number, c: number): number => {
    const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
    return src[(yi * w + xi) * 4 + c]!;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - ax;
      const py = y + 0.5 - ay;
      const along = px * tx + py * ty;
      // Outside the SEGMENT, not merely off the infinite line: a wire has ends.
      if (along < 0 || along > len) continue;
      const across = px * nx + py * ny;
      if (Math.abs(across) > half) continue;
      const baseX = ax + tx * along;
      const baseY = ay + ty * along;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const s1 = at(baseX + nx * reach, baseY + ny * reach, c);
        const s2 = at(baseX - nx * reach, baseY - ny * reach, c);
        // Weighted by which side the pixel sits on, so the two halves of the
        // wire blend toward their own neighbour and the centre is the mean.
        const t = clamp01((across + half) / Math.max(0.0001, thickness));
        out[o + c] = clamp255(s2 * (1 - t) + s1 * t);
      }
    }
  }
  return out;
}

// ── Broadcast Colors ─────────────────────────────────────────────────────────

/**
 * Broadcast Colors — pull the composite signal amplitude down under a legal
 * ceiling, the way a station's legaliser would.
 *
 * The quantity being limited is not luminance and not saturation but their
 * SUM as a composite signal: `Y + chroma swing`, in IRE. That is why a
 * saturated red at 60 % luminance is illegal while a white at 100 % is fine,
 * and why an effect that merely clamped RGB would not do this job.
 *
 * NTSC puts black at 7.5 IRE (the setup pedestal) and white at 100; PAL has no
 * pedestal, so black is 0.
 */
export function broadcastColorsData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  standard = 0,
  howToMakeColorSafe = 0,
  maxSignalAmplitude = 110,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const pedestal = standard === 0 ? 7.5 : 0;
  const gain = 100 - pedestal;
  const limit = Math.max(90, Math.min(120, maxSignalAmplitude));

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    let r = src[o]! / 255;
    let g = src[o + 1]! / 255;
    let b = src[o + 2]! / 255;

    const yLin = 0.299 * r + 0.587 * g + 0.114 * b;
    // Rec.601 colour-difference axes, scaled to their composite swing.
    const u = 0.492 * (b - yLin);
    const v = 0.877 * (r - yLin);
    const chroma = Math.hypot(u, v);
    const ire = pedestal + yLin * gain + chroma * gain;
    if (ire <= limit) continue;

    if (howToMakeColorSafe === 2) { out[o + 3] = 0; continue; }   // Key Out Unsafe
    if (howToMakeColorSafe === 3) { continue; }                    // Key Out Safe: handled below
    const excess = ire - limit;
    if (howToMakeColorSafe === 0) {
      // Reduce Luminance — scale all three toward black by exactly the overshoot.
      const k = clamp01(1 - excess / Math.max(0.0001, yLin * gain + chroma * gain));
      r *= k; g *= k; b *= k;
    } else {
      // Reduce Saturation — pull toward the pixel's own luminance instead, so
      // brightness survives and only the colour swing shrinks.
      const k = clamp01(1 - excess / Math.max(0.0001, chroma * gain));
      r = yLin + (r - yLin) * k;
      g = yLin + (g - yLin) * k;
      b = yLin + (b - yLin) * k;
    }
    out[o] = clamp255(r * 255);
    out[o + 1] = clamp255(g * 255);
    out[o + 2] = clamp255(b * 255);
  }

  if (howToMakeColorSafe === 3) {
    // Key Out Safe — the inverse selection: everything already legal goes.
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const r = src[o]! / 255;
      const g = src[o + 1]! / 255;
      const b = src[o + 2]! / 255;
      const yLin = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.hypot(0.492 * (b - yLin), 0.877 * (r - yLin));
      if (pedestal + yLin * gain + chroma * gain <= limit) out[o + 3] = 0;
    }
  }
  return out;
}

// ── Noise HLS ────────────────────────────────────────────────────────────────

/**
 * Noise HLS — grain applied in HLS rather than RGB, so hue, lightness and
 * saturation can be disturbed independently.
 *
 * The point of the HLS detour, and why this is not simply Add Grain: shifting
 * only HUE leaves every pixel exactly as bright as it was, which reads as an
 * iridescent shimmer rather than as dirt. RGB noise cannot express that.
 *
 * `grainSize` quantises the sampling grid, so a grain is a CELL rather than a
 * pixel; `noisePhase` is an ordinary keyframed parameter, not the clock.
 */
export function noiseHlsData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  noiseType = 0,
  hue = 0,
  lightness = 0,
  saturation = 0,
  grainSize = 1,
  noisePhase = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const hAmt = clamp01(hue / 100);
  const lAmt = clamp01(lightness / 100);
  const sAmt = clamp01(saturation / 100);
  if (hAmt === 0 && lAmt === 0 && sAmt === 0) return out;

  const cell = Math.max(0.5, grainSize);
  const phase = Math.floor(noisePhase);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (src[o + 3] === 0) continue;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      // Three independent draws so the axes do not move together — correlated
      // noise on all three reads as a single brightness flicker.
      const shape = (n: number): number => {
        const centred = n * 2 - 1;
        // Squared noise keeps the sign and biases toward zero, which is the
        // sparse, speckled look AE's "Squared" gives.
        return noiseType === 1 ? centred * Math.abs(centred) : centred;
      };
      const nh = shape(hash2(cx + phase * 131, cy + phase * 17));
      const nl = shape(hash2(cy + phase * 71, cx + phase * 251));
      const ns = shape(hash2(cx * 7 + phase, cy * 13 + phase));

      // `rgbToHsl` returns hue in 0..1, not degrees — a full turn is 1, so the
      // hue amount scales directly and wraps at 1.
      const [hh, ss, ll] = rgbToHsl(src[o]!, src[o + 1]!, src[o + 2]!);
      const h2 = ((hh + nh * hAmt) % 1 + 1) % 1;
      const s2 = clamp01(ss + ns * sAmt);
      const l2 = clamp01(ll + nl * lAmt);
      const [r2, g2, b2] = hslToRgb(h2, s2, l2);
      out[o] = clamp255(r2);
      out[o + 1] = clamp255(g2);
      out[o + 2] = clamp255(b2);
    }
  }
  return out;
}

/** Re-exported so the tests and the shader parity notes share one luma. */
export { luma };
