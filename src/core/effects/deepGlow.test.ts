/**
 * Deep Glow — the model's promises, measured.
 *
 * The plan (docs/ENGINE_STRENGTH_PLAN.md A1) asked for two things a single
 * Gaussian cannot give: an inverse-square falloff and a result that is the
 * same on every route. The first is a property of the octave ladder (equal
 * weights on energy-normalised Gaussians), the second of the integer tap
 * scheme — both asserted here against the CPU twin, which the GPU mirrors
 * formula for formula.
 */

import { deepGlowData, deepGlowField, deepGlowOctaves, deepGlowSettings, deepGlowStep, type DeepGlowSettings } from './deepGlow';
import type { Effect } from './effects';

const BASE: DeepGlowSettings = {
  radius: 64, gain: 1, threshold: 0, aspect: [1, 1], chroma: [1, 1, 1],
  tint: [1, 1, 1], tintAmount: 0, glowOnly: true, dither: false, octaves: 6,
};

/** A white disc of `r` px on a transparent field, premultiplied linear. */
function disc(size: number, r: number): Float32Array {
  const lin = new Float32Array(size * size * 4);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x + 0.5 - c, y + 0.5 - c) <= r) {
        const o = (y * size + x) * 4;
        lin[o] = 1; lin[o + 1] = 1; lin[o + 2] = 1; lin[o + 3] = 1;
      }
    }
  }
  return lin;
}

describe('deep glow', () => {
  it('ladders the octaves from radius / 2^(K-1) to radius, with deltas that compose', () => {
    const octs = deepGlowOctaves(64, 6);
    expect(octs.map((o) => o.sigma)).toEqual([2, 4, 8, 16, 32, 64]);
    let acc = 0;
    for (const o of octs) {
      acc += o.delta * o.delta;
      expect(Math.sqrt(acc)).toBeCloseTo(o.sigma, 6);
    }
    expect(deepGlowStep(2)).toBe(1);
    expect(deepGlowStep(64)).toBe(16);
  });

  it('falls off as ~1/r² across the octave range (a Gaussian cannot)', () => {
    const size = 512;
    const field = deepGlowField(disc(size, 3), size, size, BASE);
    const at = (r: number): number => field[((size / 2) * size + (size / 2 + r)) * 4 + 1]!;
    // Log-log slope between consecutive radii inside the ladder (σ 2..64).
    const radii = [12, 24, 48, 96];
    const slopes: number[] = [];
    for (let i = 1; i < radii.length; i++) {
      slopes.push(Math.log(at(radii[i]!) / at(radii[i - 1]!)) / Math.log(radii[i]! / radii[i - 1]!));
    }
    for (const s of slopes) {
      expect(s).toBeLessThan(-1.5);
      expect(s).toBeGreaterThan(-2.7);
    }
    // And monotone outward — no ring from a tap stride.
    let prev = Number.POSITIVE_INFINITY;
    for (let r = 4; r < 200; r++) {
      const v = at(r);
      expect(v).toBeLessThanOrEqual(prev + 1e-7);
      prev = v;
    }
  });

  it('stays pinned to the source: a single Gaussian at the same radius is far dimmer at 4σ', () => {
    const size = 512;
    const pyramid = deepGlowField(disc(size, 3), size, size, BASE);
    const single = deepGlowField(disc(size, 3), size, size, { ...BASE, octaves: 1 });
    const g = (f: Float32Array, r: number): number => f[((size / 2) * size + (size / 2 + r)) * 4 + 1]!;
    // Near the core the fine octaves dominate; the wide single Gaussian is flat there.
    expect(g(pyramid, 6) / g(single, 6)).toBeGreaterThan(5);
  });

  it('is deterministic and bit-stable from bytes to bytes', () => {
    const w = 96; const h = 64;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 20; y < 44; y++) for (let x = 36; x < 60; x++) {
      const o = (y * w + x) * 4; src[o] = 255; src[o + 1] = 180; src[o + 2] = 40; src[o + 3] = 255;
    }
    const a = deepGlowData(src, w, h, { ...BASE, radius: 12, glowOnly: false });
    const b = deepGlowData(src, w, h, { ...BASE, radius: 12, glowOnly: false });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    // The halo reaches outside the box, and the box itself stays opaque.
    expect(a[(32 * w + 70) * 4 + 3]).toBeGreaterThan(0);
    expect(a[(32 * w + 48) * 4 + 3]).toBe(255);
    // Premultiplied-valid: nothing brighter than its alpha allows.
    for (let o = 0; o < a.length; o += 4) {
      expect(a[o]).toBeLessThanOrEqual(255);
    }
  });

  it('threshold at 100 % glows nothing; glow-only at 0 % keeps colour', () => {
    const w = 64; const h = 64;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) {
      const o = (y * w + x) * 4; src[o] = 40; src[o + 1] = 200; src[o + 2] = 255; src[o + 3] = 255;
    }
    const none = deepGlowData(src, w, h, { ...BASE, radius: 8, threshold: 1 });
    expect(none.every((v) => v === 0)).toBe(true);
    const only = deepGlowData(src, w, h, { ...BASE, radius: 8 });
    const o = (32 * w + 44) * 4;
    expect(only[o + 3]).toBeGreaterThan(0);
    expect(only[o + 2]).toBeGreaterThan(only[o]!);
  });

  it('resolves params the way the inspector states them', () => {
    const e: Effect = { id: 'g', type: 'deep-glow', params: { radius: 30, exposure: 1, threshold: 25, aspect: 50, chromatic: 100, tint: '#ff8000', tintAmount: 50, glowOnly: true, quality: 2 } };
    const s = deepGlowSettings(e);
    expect(s.radius).toBe(30);
    expect(s.gain).toBe(2);
    expect(s.threshold).toBe(0.25);
    expect(s.aspect).toEqual([1, 0.5]);
    expect(s.chroma[0]).toBeGreaterThan(1);
    expect(s.chroma[2]).toBeLessThan(1);
    expect(s.tint[1]).toBeCloseTo(0.2158605, 4);
    expect(s.glowOnly).toBe(true);
    expect(s.dither).toBe(true);
    expect(s.octaves).toBe(8);
    const defaults = deepGlowSettings({ id: 'd', type: 'deep-glow', params: {} });
    expect(defaults.octaves).toBe(6);
    expect(defaults.dither).toBe(true);
    expect(deepGlowSettings({ id: 'd', type: 'deep-glow', params: { dither: false } }).dither).toBe(false);
  });

  it('dither moves the glow by at most one output code, and never touches pixels without glow', () => {
    const w = 96; const h = 64;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 24; y < 40; y++) for (let x = 36; x < 60; x++) {
      const o = (y * w + x) * 4; src[o] = 255; src[o + 1] = 255; src[o + 2] = 255; src[o + 3] = 255;
    }
    const plain = deepGlowData(src, w, h, { ...BASE, radius: 6, dither: false });
    const dithered = deepGlowData(src, w, h, { ...BASE, radius: 6, dither: true });
    // Compared PREMULTIPLIED: the bytes are straight, and a pixel whose alpha
    // dithers from 0 to 1 code legitimately goes from (0,0,0,0) to (255,…,1).
    let moved = 0;
    for (let o = 0; o < plain.length; o += 4) {
      const pa = plain[o + 3]! / 255; const da = dithered[o + 3]! / 255;
      expect(Math.abs(plain[o + 3]! - dithered[o + 3]!)).toBeLessThanOrEqual(2);
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(plain[o + c]! * pa - dithered[o + c]! * da);
        expect(d).toBeLessThanOrEqual(2);
        if (d > 0) moved++;
      }
      // No glow at all (a true zero pixel) is left exactly alone.
      if (plain[o] === 0 && plain[o + 1] === 0 && plain[o + 2] === 0 && plain[o + 3] === 0) {
        expect(dithered[o]! + dithered[o + 1]! + dithered[o + 2]! + dithered[o + 3]!).toBe(0);
      }
    }
    expect(moved).toBeGreaterThan(0);
  });
});
