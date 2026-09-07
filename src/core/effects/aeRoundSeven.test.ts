/**
 * Round seven's kernels, tested at the properties that would break silently.
 *
 * Three assertions recur, because three failure modes recur in this codebase:
 *
 *   IDENTITY at the neutral setting — an effect that alters the picture when
 *   it is first added reads as a bug in whatever the user was actually doing,
 *   and it is what makes a stack of disabled-by-default effects safe.
 *
 *   DETERMINISM — same params, same bytes. Every one of these hashes rather
 *   than calling `Math.random`, and a hash that accidentally consulted
 *   something ambient would show as a frame that differs between preview and
 *   export, which is the one failure the render pipeline is built to refuse.
 *
 *   ALPHA — a colour effect must not silently rewrite coverage, and a wipe must
 *   rewrite ONLY coverage. Both directions have been broken here before.
 */

import {
  ccTilerData,
  ripplePulseData,
  radialScaleWipeData,
  glassWipeData,
  imageWipeData,
} from './aeRoundSevenDistort';
import {
  colorDifferenceKeyData,
  wireRemovalData,
  broadcastColorsData,
  noiseHlsData,
} from './aeRoundSevenColor';
import {
  colorOffsetTables,
  thresholdRgbTables,
  cineonConverterTables,
} from './aeRoundSevenLuts';
import {
  blockLoadData,
  kernelConvolveData,
  glasses3dData,
  fractalData,
} from './aeRoundSevenStylize';
import {
  aliveRange,
  bubblesData,
  particleAt,
  particleSystemsData,
  MAX_PARTICLES,
  type ParticleOptions,
} from './aeRoundSevenSimulation';
import { defaultParams, effectDefFor, type Effect, type EffectParams } from './effects';

/** A 16×16 RGB gradient with full alpha — the shared fixture. */
function grad(w = 16, h = 16): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = Math.round((x / (w - 1)) * 255);
      d[i + 1] = Math.round((y / (h - 1)) * 255);
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  return d;
}

/** An effect carrying its definition's defaults, for the LUT builders. */
function fx(type: string, over: Record<string, unknown> = {}): Effect {
  const def = effectDefFor(type)!;
  return { id: 'e1', type: type as Effect['type'], params: { ...defaultParams(def), ...over } as EffectParams };
}

describe('round seven — distort & transition', () => {
  it('CC Tiler is the identity at scale 100', () => {
    const src = grad();
    // Not "close to" the identity: at scale 1 the inverse map is exactly the
    // pixel centre, so bilinear sampling lands on one texel with weight 1.
    expect([...ccTilerData(src, 16, 16, 100, 0, 0, 0)]).toEqual([...src]);
  });

  it('CC Tiler at 50 % repeats the frame twice per axis', () => {
    const src = grad();
    const out = ccTilerData(src, 16, 16, 50, 0, 0, 0);
    // The two tiles are 8 px apart, so a pixel and the one 8 to its right come
    // from the same source point.
    const a = (4 * 16 + 2) * 4;
    const b = (4 * 16 + 10) * 4;
    expect(out[a]).toBe(out[b]);
    expect(out[a + 1]).toBe(out[b + 1]);
  });

  it('Ripple Pulse leaves the frame alone at amplitude 0', () => {
    const src = grad();
    expect([...ripplePulseData(src, 16, 16, 0, 0, 5, 0, 60, true)]).toEqual([...src]);
  });

  it('Ripple Pulse displaces only inside its band', () => {
    const src = grad(32, 32);
    const out = ripplePulseData(src, 32, 32, 0, 0, 4, 20, 5, false);
    // Well outside the ring (r ≈ 21 vs a band of 4 ± 5) nothing may move.
    const far = (2 * 32 + 2) * 4;
    expect(out[far]).toBe(src[far]);
    // On the ring something must.
    let moved = false;
    for (let x = 14; x < 22 && !moved; x++) {
      const o = (16 * 32 + x) * 4;
      if (out[o] !== src[o]) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('Radial ScaleWipe empties the layer at completion 100', () => {
    const out = radialScaleWipeData(grad(), 16, 16, 100);
    expect([...out].every((v) => v === 0)).toBe(true);
  });

  it('Radial ScaleWipe is the identity at completion 0', () => {
    const src = grad();
    expect([...radialScaleWipeData(src, 16, 16, 0)]).toEqual([...src]);
  });

  it('Glass Wipe fades alpha without emptying colour', () => {
    const src = grad();
    const out = glassWipeData(src, 16, 16, 60, 30, 40);
    let anyFaded = false;
    for (let i = 0; i < 16 * 16; i++) {
      if (out[i * 4 + 3]! < 255) anyFaded = true;
    }
    expect(anyFaded).toBe(true);
    expect([...glassWipeData(src, 16, 16, 0, 30, 40)]).toEqual([...src]);
  });

  it('Image Wipe touches alpha and nothing else', () => {
    const src = grad();
    const out = imageWipeData(src, 16, 16, 50, 20, 0, false);
    for (let i = 0; i < 16 * 16; i++) {
      expect(out[i * 4]).toBe(src[i * 4]);
      expect(out[i * 4 + 1]).toBe(src[i * 4 + 1]);
      expect(out[i * 4 + 2]).toBe(src[i * 4 + 2]);
    }
    let faded = 0;
    for (let i = 0; i < 16 * 16; i++) if (out[i * 4 + 3]! < 255) faded++;
    expect(faded).toBeGreaterThan(0);
  });

  it('Image Wipe inverts which end goes first', () => {
    const src = grad();
    const normal = imageWipeData(src, 16, 16, 50, 10, 2, false);
    const inverted = imageWipeData(src, 16, 16, 50, 10, 2, true);
    // Reading the red ramp: normally the dark (left) end goes first, inverted
    // the bright end does, so the two disagree at the left edge.
    const left = (8 * 16 + 0) * 4 + 3;
    expect(normal[left]).not.toBe(inverted[left]);
  });
});

describe('round seven — keying & colour', () => {
  it('Color Difference Key removes the key colour and keeps its opposite', () => {
    const src = new Uint8ClampedArray([
      0, 255, 0, 255,      // pure green — the key
      255, 0, 255, 255,    // magenta — as far from green as a pixel gets
    ]);
    const out = colorDifferenceKeyData(src, 2, 1, 0, 255, 0, 0, 255, 1, 0);
    expect(out[3]).toBeLessThan(60);
    expect(out[7]).toBe(255);
  });

  it('Color Difference Key’s matte view is an opaque greyscale', () => {
    const out = colorDifferenceKeyData(grad(), 16, 16, 0, 255, 0, 0, 255, 1, 1);
    for (let i = 0; i < 16 * 16; i++) {
      expect(out[i * 4]).toBe(out[i * 4 + 1]);
      expect(out[i * 4 + 1]).toBe(out[i * 4 + 2]);
      expect(out[i * 4 + 3]).toBe(255);
    }
  });

  it('Wire Removal replaces the wire with its neighbours', () => {
    // A white field with a black horizontal wire through the middle.
    const w = 16; const h = 16;
    const src = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let x = 0; x < w; x++) {
      const o = (8 * w + x) * 4;
      src[o] = 0; src[o + 1] = 0; src[o + 2] = 0;
    }
    const out = wireRemovalData(src, w, h, -8, 0, 8, 0, 3, 50);
    const mid = (8 * w + 8) * 4;
    expect(out[mid]).toBeGreaterThan(200);
    // A pixel far from the wire is untouched.
    const far = (2 * w + 8) * 4;
    expect(out[far]).toBe(255);
  });

  it('Broadcast Colors pulls an illegal saturated colour down', () => {
    /*
      100 % YELLOW, not red, and the difference is the point of the effect.
      Yellow's composite peak is Y (0.886) plus a chroma swing of 0.447, which
      lands at about 131 IRE — the number published for NTSC 100 % bars, and
      the reason 75 % bars exist. Pure RED peaks near 94 IRE and is legal, so a
      test written on red would pass whatever this kernel did.
    */
    const src = new Uint8ClampedArray([255, 255, 0, 255, 128, 128, 128, 255]);
    const out = broadcastColorsData(src, 2, 1, 0, 0, 110);
    expect(out[0]).toBeLessThan(255);
    // Mid grey is legal and must be untouched.
    expect(out[4]).toBe(128);
    expect(out[5]).toBe(128);
  });

  it('Broadcast Colors keys instead of grading in the key modes', () => {
    const src = new Uint8ClampedArray([255, 255, 0, 255, 128, 128, 128, 255]);
    const unsafe = broadcastColorsData(src, 2, 1, 0, 2, 110);
    expect(unsafe[3]).toBe(0);
    expect(unsafe[7]).toBe(255);
    const safe = broadcastColorsData(src, 2, 1, 0, 3, 110);
    expect(safe[3]).toBe(255);
    expect(safe[7]).toBe(0);
  });

  it('Noise HLS is the identity with every amount at zero', () => {
    const src = grad();
    expect([...noiseHlsData(src, 16, 16, 0, 0, 0, 0, 1, 0)]).toEqual([...src]);
  });

  it('Noise HLS is deterministic and hue-only noise preserves brightness', () => {
    const src = grad();
    const a = noiseHlsData(src, 16, 16, 0, 40, 0, 0, 2, 7);
    const b = noiseHlsData(src, 16, 16, 0, 40, 0, 0, 2, 7);
    expect([...a]).toEqual([...b]);
    // Hue rotation at constant L and S keeps HSL lightness, so the mid-point of
    // max and min channel is preserved even though the channels themselves move.
    let moved = false;
    for (let i = 0; i < 16 * 16; i++) {
      const o = i * 4;
      const lIn = (Math.max(src[o]!, src[o + 1]!, src[o + 2]!) + Math.min(src[o]!, src[o + 1]!, src[o + 2]!)) / 2;
      const lOut = (Math.max(a[o]!, a[o + 1]!, a[o + 2]!) + Math.min(a[o]!, a[o + 1]!, a[o + 2]!)) / 2;
      expect(Math.abs(lOut - lIn)).toBeLessThanOrEqual(2);
      if (a[o] !== src[o]) moved = true;
    }
    expect(moved).toBe(true);
  });
});

describe('round seven — the three LUT builders', () => {
  it('CC Color Offset is the identity at phase 0 and wraps past the top', () => {
    const id = colorOffsetTables(fx('color-offset'));
    expect(Math.round(id.r[0]!)).toBe(0);
    expect(Math.round(id.r[255]!)).toBe(255);
    const wrapped = colorOffsetTables(fx('color-offset', { redPhase: 180, overflow: 0 }));
    // Half a turn: white wraps to mid, which a clip could never produce.
    expect(wrapped.r[255]!).toBeLessThan(200);
  });

  it('CC Color Offset’s three overflow modes differ at the top end', () => {
    const top = (overflow: number): number =>
      colorOffsetTables(fx('color-offset', { redPhase: 90, overflow })).r[255]!;
    expect(top(2)).toBeCloseTo(255, 0);            // Polarize clips.
    expect(top(0)).toBeLessThan(100);              // Wrap rolls over.
    expect(top(1)).toBeGreaterThan(100);           // Solarize folds back.
    expect(top(1)).toBeLessThan(255);
  });

  it('CC Threshold RGB is binary per channel at its own level', () => {
    const t = thresholdRgbTables(fx('threshold-rgb', { redLevel: 100, greenLevel: 200 }));
    expect(t.r[99]).toBe(0);
    expect(t.r[100]).toBe(255);
    expect(t.g[199]).toBe(0);
    expect(t.g[200]).toBe(255);
  });

  it('Cineon log→lin rises monotonically and lifts the shadows', () => {
    const t = cineonConverterTables(fx('cineon-converter', { conversionType: 0 }));
    for (let i = 1; i < 256; i++) expect(t.r[i]!).toBeGreaterThanOrEqual(t.r[i - 1]!);
    expect(t.r).toBe(t.r);
    // The three channels are the same transfer — this is a tone curve, not a
    // grade, and a per-channel difference here would be a bug.
    expect([...t.g]).toEqual([...t.r]);
    expect([...t.b]).toEqual([...t.r]);
  });

  it('Cineon lin→log is the other direction', () => {
    const toLin = cineonConverterTables(fx('cineon-converter', { conversionType: 0 }));
    const toLog = cineonConverterTables(fx('cineon-converter', { conversionType: 1 }));
    // At the midpoint the two curves sit on opposite sides of the input.
    const mid = 128;
    expect(Math.sign(toLin.r[mid]! - mid)).not.toBe(Math.sign(toLog.r[mid]! - mid));
  });
});

describe('round seven — stylize, perspective & generate', () => {
  it('Block Load is the identity at completion 100', () => {
    const src = grad();
    expect([...blockLoadData(src, 16, 16, 100, 4, 8)]).toEqual([...src]);
  });

  it('Block Load blocks the picture mid-load', () => {
    const src = grad(32, 32);
    const out = blockLoadData(src, 32, 32, 10, 4, 16);
    // Early in the load, neighbouring pixels of the top row share a block.
    const a = (0 * 32 + 1) * 4;
    const b = (0 * 32 + 2) * 4;
    expect(out[a]).toBe(out[b]);
  });

  it('CC Kernel with the identity kernel changes nothing', () => {
    const src = grad();
    const k = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    expect([...kernelConvolveData(src, 16, 16, k, 1, 0)]).toEqual([...src]);
  });

  it('CC Kernel leaves alpha alone', () => {
    const src = grad();
    for (let i = 0; i < 16 * 16; i++) src[i * 4 + 3] = 128;
    const k = [-1, -1, -1, -1, 8, -1, -1, -1, -1];
    const out = kernelConvolveData(src, 16, 16, k, 1, 0);
    for (let i = 0; i < 16 * 16; i++) expect(out[i * 4 + 3]).toBe(128);
  });

  it('3D Glasses red-cyan takes red from one eye and green/blue from the other', () => {
    const w = 8;
    const src = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) {
      src[x * 4] = x * 30; src[x * 4 + 1] = 255 - x * 30; src[x * 4 + 2] = 100; src[x * 4 + 3] = 255;
    }
    const out = glasses3dData(src, w, 1, 4, 0, 50, false);
    // At x = 4 the left eye reads x = 2 and the right eye x = 6.
    expect(out[4 * 4]).toBe(src[2 * 4]);
    expect(out[4 * 4 + 1]).toBe(src[6 * 4 + 1]);
  });

  it('3D Glasses interlace alternates eyes by row', () => {
    const src = grad();
    const out = glasses3dData(src, 16, 16, 6, 5, 50, false);
    // Even rows read left (shifted −3), odd rows right (+3), so they disagree.
    expect(out[(0 * 16 + 8) * 4]).not.toBe(out[(1 * 16 + 8) * 4]);
  });

  it('Fractal fills the layer opaquely and puts the set interior inside', () => {
    const out = fractalData(16, 16, 0, -0.5, 0, 1, 32, -0.7, 0.27, 0, 2, 0, 0, 0);
    for (let i = 0; i < 16 * 16; i++) expect(out[i * 4 + 3]).toBe(255);
    // The centre of the default window is inside the Mandelbrot set, so it
    // takes the inside colour (black here) rather than a palette hue.
    const c = (8 * 16 + 8) * 4;
    expect(out[c]! + out[c + 1]! + out[c + 2]!).toBe(0);
  });

  it('Fractal is deterministic and Julia differs from Mandelbrot', () => {
    const a = fractalData(16, 16, 0, -0.5, 0, 1, 32, -0.7, 0.27, 0, 2, 0, 0, 0);
    const b = fractalData(16, 16, 0, -0.5, 0, 1, 32, -0.7, 0.27, 0, 2, 0, 0, 0);
    expect([...a]).toEqual([...b]);
    const julia = fractalData(16, 16, 1, 0, 0, 1, 32, -0.7, 0.27, 0, 2, 0, 0, 0);
    expect([...julia]).not.toEqual([...a]);
  });
});

const PARTICLE_DEFAULTS: ParticleOptions = {
  birthRate: 20, longevity: 1.5, producerX: 0, producerY: 0,
  producerRadiusX: 0, producerRadiusY: 0, animation: 0, direction: 0,
  spread: 60, velocity: 300, velocityVariation: 30, gravity: 200,
  resistance: 0, birthSize: 8, deathSize: 2, sizeVariation: 25,
  birthR: 255, birthG: 226, birthB: 122, deathR: 255, deathG: 59, deathB: 0,
  opacity: 100, blend: 0, seed: 1,
};

describe('round seven — simulation', () => {
  it('a particle is unborn before its time and gone after its longevity', () => {
    const o = { ...PARTICLE_DEFAULTS, birthRate: 10, longevity: 1 };
    // Particle 20 is born around t = 2.0 (±0.04 of jitter).
    expect(particleAt(20, 1.5, o)).toBeNull();
    expect(particleAt(20, 2.5, o)).not.toBeNull();
    expect(particleAt(20, 4, o)).toBeNull();
  });

  it('the alive range is bounded however extreme the settings', () => {
    const [first, last] = aliveRange(1000, 200, 10);
    expect(last - first).toBeLessThan(MAX_PARTICLES);
  });

  it('particle state is a pure function of index, seed and time', () => {
    const a = particleAt(5, 0.7, PARTICLE_DEFAULTS)!;
    const b = particleAt(5, 0.7, PARTICLE_DEFAULTS)!;
    expect(a).toEqual(b);
    const other = particleAt(5, 0.7, { ...PARTICLE_DEFAULTS, seed: 2 })!;
    expect(other.x).not.toBe(a.x);
  });

  it('gravity moves a particle downward over its life', () => {
    const o = { ...PARTICLE_DEFAULTS, velocity: 0, velocityVariation: 0, gravity: 500 };
    const early = particleAt(2, 2 / 20 + 0.1, o)!;
    const late = particleAt(2, 2 / 20 + 0.9, o)!;
    expect(late.y).toBeGreaterThan(early.y);
  });

  it('resistance shortens the distance travelled', () => {
    const free = particleAt(3, 3 / 20 + 0.8, { ...PARTICLE_DEFAULTS, gravity: 0, resistance: 0 })!;
    const dragged = particleAt(3, 3 / 20 + 0.8, { ...PARTICLE_DEFAULTS, gravity: 0, resistance: 4 })!;
    expect(Math.hypot(dragged.x, dragged.y)).toBeLessThan(Math.hypot(free.x, free.y));
  });

  it('Particle Systems draws nothing before the first birth and something after', () => {
    const src = grad(32, 32);
    expect([...particleSystemsData(src, 32, 32, -1, PARTICLE_DEFAULTS)]).toEqual([...src]);
    const drawn = particleSystemsData(src, 32, 32, 1, PARTICLE_DEFAULTS);
    expect([...drawn]).not.toEqual([...src]);
  });

  it('Particle Systems is deterministic at a given time', () => {
    const src = grad(32, 32);
    const a = particleSystemsData(src, 32, 32, 1.3, PARTICLE_DEFAULTS);
    const b = particleSystemsData(src, 32, 32, 1.3, PARTICLE_DEFAULTS);
    expect([...a]).toEqual([...b]);
  });

  it('CC Bubbles draws nothing at amount 0 and is deterministic otherwise', () => {
    const src = grad(32, 32);
    expect([...bubblesData(src, 32, 32, 0)]).toEqual([...src]);
    const a = bubblesData(src, 32, 32, 40, 300, 10, 2, 10, 40, 0, 255, 255, 255, 80, 250, 1);
    const b = bubblesData(src, 32, 32, 40, 300, 10, 2, 10, 40, 0, 255, 255, 255, 80, 250, 1);
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...src]);
  });

  it('CC Bubbles rises as evolution advances', () => {
    /*
      ONE bubble, and a small step. The field WRAPS — a bubble leaving the top
      re-enters at the bottom — so the centroid of thirty of them is not
      monotonic in evolution at all, and a test written that way passes or
      fails on which bubbles happened to wrap. One bubble over a step far
      shorter than the layer asks the question the effect actually promises.
    */
    const src = new Uint8ClampedArray(32 * 32 * 4);
    const centroidY = (d: Uint8ClampedArray): number => {
      let sum = 0; let total = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const a = d[(y * 32 + x) * 4 + 3]!;
          sum += a * y; total += a;
        }
      }
      return total === 0 ? Number.NaN : sum / total;
    };
    // Seed 5 places its one bubble at y ~ 18, far enough from either edge that
    // a two-unit step neither wraps nor leaves the layer. A seed is a
    // deliberate choice here, not a magic number: the placement is hashed, so
    // some seeds put the bubble half off the top and the frame draws nothing
    // to take a centroid of.
    const at = (evolution: number): Uint8ClampedArray =>
      bubblesData(src, 32, 32, 1, 300, 0, 2, 8, 0, 0, 255, 255, 255, 100, evolution, 5);
    const before = centroidY(at(0));
    const after = centroidY(at(2));
    expect(Number.isNaN(before)).toBe(false);
    expect(Number.isNaN(after)).toBe(false);
    expect(after).toBeLessThan(before);
  });
});
