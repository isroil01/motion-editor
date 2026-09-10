/**
 * Effects round seven — Simulation.
 *
 *   • CC Particle Systems II — a point / ellipse emitter
 *   • CC Bubbles             — a rising field of bubbles
 *
 * ── Why neither of these simulates anything ──────────────────────────────────
 *
 * A real particle simulator integrates state forward: frame N's positions come
 * from frame N−1's. That is fatal here for two reasons the repo has already
 * paid for once. Scrubbing backwards would produce a different picture from
 * playing forwards, and an export that starts at frame 400 would have no
 * history to integrate from — see `docs/EDITOR_REFERENCE.md` §"simulation,
 * phase 1: the seek architecture" for the machinery that exists precisely
 * because that problem is hard.
 *
 * So both of these are CLOSED FORM. Every particle's whole trajectory is a
 * function of its index, the seed and its age, so any frame can be drawn
 * without reference to any other frame, in any order, on either backend. The
 * trade is that particles cannot collide or respond to a force field; the gain
 * is that the effect is correct when scrubbed, cached and exported, which is
 * the trade the rest of this codebase makes everywhere.
 *
 * Particle Systems reads the CLOCK (see `TIME_DEPENDENT` in `effects.ts`) —
 * an emitter indexes its births by absolute time, and a keyframed phase would
 * leave it static by default. Bubbles takes the Snowfall route and rides a
 * keyframed `evolution` instead, because a wrapping field needs no origin.
 */

import { clamp01, clamp255 } from './colorSpace';

/** Deterministic 0..1 hash of two integers — the shared one. */
function hash2(a: number, b: number): number {
  let n = (a * 374761393 + b * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * The most particles either effect will draw in one frame.
 *
 * A hard ceiling rather than a warning, and the same constant in the shader:
 * the GPU twin loops per FRAGMENT, so an unbounded count is not a slow frame
 * but a hung device. At the default birth rate and longevity the live set is
 * about thirty, so the cap is reached only by settings that were already past
 * what the closed-form model draws convincingly.
 */
export const MAX_PARTICLES = 512;

// ── CC Particle Systems II ───────────────────────────────────────────────────

/** One particle's state at a given time, or null when it is not alive. */
interface Particle {
  x: number;
  y: number;
  size: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
}

/**
 * Particle `i`'s state at `time`, or null if unborn or expired.
 *
 * Exported because the shader is a transliteration of exactly this function and
 * the parity test drives both through the same indices — a private copy would
 * let the two drift silently, which is the failure mode every ported effect in
 * this repo has a contract test to prevent.
 */
export function particleAt(
  i: number,
  time: number,
  o: ParticleOptions,
): Particle | null {
  const rate = Math.max(0.0001, o.birthRate);
  // Birth times are indexed by ABSOLUTE time, which is what makes the emitter
  // continuous: particle i is always born at the same instant, whatever frame
  // is being drawn, so scrubbing shows the same particle in the same place.
  const jitter = hash2(i, o.seed + 3) - 0.5;
  const birth = (i + jitter * 0.8) / rate;
  const age = time - birth;
  if (age < 0 || age > o.longevity) return null;

  const h1 = hash2(i, o.seed);
  const h2 = hash2(i, o.seed + 101);
  const h3 = hash2(i, o.seed + 211);
  const h4 = hash2(i, o.seed + 307);

  // Birth position — uniformly over the producer ellipse.
  const angle0 = h1 * Math.PI * 2;
  const rad0 = Math.sqrt(h2);
  const x0 = o.producerX + Math.cos(angle0) * o.producerRadiusX * rad0;
  const y0 = o.producerY + Math.sin(angle0) * o.producerRadiusY * rad0;

  // Launch direction.
  let dir: number;
  const spread = (o.spread * Math.PI) / 180;
  if (o.animation === 0) {
    dir = h3 * Math.PI * 2;                       // Explosive — all directions.
  } else {
    const base = (o.direction * Math.PI) / 180;
    dir = base + (h3 - 0.5) * spread;             // Direction Axis / Fountain.
  }
  const speed = o.velocity * (1 + (h4 - 0.5) * 2 * clamp01(o.velocityVariation / 100));
  const vx = Math.cos(dir) * speed;
  const vy = Math.sin(dir) * speed;

  // Position under linear drag: the closed-form integral of v·e^(−r·t), plus
  // gravity. The r → 0 limit is the plain ballistic form, taken explicitly
  // because the general expression divides by r.
  const r = o.resistance;
  let px: number;
  let py: number;
  if (r > 0.0001) {
    const decay = (1 - Math.exp(-r * age)) / r;
    px = x0 + vx * decay;
    py = y0 + vy * decay;
  } else {
    px = x0 + vx * age;
    py = y0 + vy * age;
  }
  py += 0.5 * o.gravity * age * age;

  const lifeT = clamp01(age / Math.max(0.0001, o.longevity));
  const sizeVar = 1 + (hash2(i, o.seed + 401) - 0.5) * 2 * clamp01(o.sizeVariation / 100);
  const size = Math.max(0.1, (o.birthSize + (o.deathSize - o.birthSize) * lifeT) * sizeVar);
  // Fades on a square law so a particle spends most of its life visible and
  // then goes quickly, which is what a spark does.
  const alpha = clamp01(o.opacity / 100) * (1 - lifeT * lifeT);

  return {
    x: px,
    y: py,
    size,
    r: o.birthR + (o.deathR - o.birthR) * lifeT,
    g: o.birthG + (o.deathG - o.birthG) * lifeT,
    b: o.birthB + (o.deathB - o.birthB) * lifeT,
    alpha,
  };
}

export interface ParticleOptions {
  birthRate: number;
  longevity: number;
  producerX: number;
  producerY: number;
  producerRadiusX: number;
  producerRadiusY: number;
  animation: number;
  direction: number;
  spread: number;
  velocity: number;
  velocityVariation: number;
  gravity: number;
  resistance: number;
  birthSize: number;
  deathSize: number;
  sizeVariation: number;
  birthR: number;
  birthG: number;
  birthB: number;
  deathR: number;
  deathG: number;
  deathB: number;
  opacity: number;
  blend: number;
  seed: number;
}

/**
 * The contiguous range of indices alive at `time`.
 *
 * Contiguous because births are ordered by index, so the alive set is always a
 * window — which is what lets the shader iterate a bounded range per fragment
 * instead of testing every particle that has ever existed.
 */
export function aliveRange(time: number, birthRate: number, longevity: number): [number, number] {
  const rate = Math.max(0.0001, birthRate);
  // Widened by one either side to cover the ±0.4/rate birth jitter.
  const first = Math.max(0, Math.floor((time - longevity) * rate) - 1);
  const last = Math.floor(time * rate) + 1;
  return [first, Math.min(last, first + MAX_PARTICLES - 1)];
}

/**
 * CC Particle Systems II — draw the live particles over the layer.
 *
 * `time` is layer seconds, resolved from the clock by `buildSnapshot` (see the
 * `time` param on the def, and `TIME_DEPENDENT`).
 */
export function particleSystemsData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  time: number,
  o: ParticleOptions,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  if (o.birthRate <= 0 || time < 0) return out;
  const [first, last] = aliveRange(time, o.birthRate, o.longevity);

  for (let i = first; i <= last; i++) {
    const p = particleAt(i, time, o);
    if (!p || p.alpha <= 0) continue;
    const px = w / 2 + p.x;
    const py = h / 2 + p.y;
    const rad = p.size / 2;
    const x0 = Math.max(0, Math.floor(px - rad));
    const x1 = Math.min(w - 1, Math.ceil(px + rad));
    const y0 = Math.max(0, Math.floor(py - rad));
    const y1 = Math.min(h - 1, Math.ceil(py + rad));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        if (d > rad) continue;
        // Soft disc: solid to 60 % of the radius, then a cosine shoulder. A
        // hard disc aliases badly at the sizes these are drawn at.
        const t = d / Math.max(0.0001, rad);
        const cover = t < 0.6 ? 1 : 0.5 + 0.5 * Math.cos(((t - 0.6) / 0.4) * Math.PI);
        const a = clamp01(p.alpha * cover);
        if (a <= 0) continue;
        const idx = (y * w + x) * 4;
        if (o.blend === 0) {
          // Add — what a spark or an ember does to what is behind it.
          out[idx] = clamp255(out[idx]! + p.r * a);
          out[idx + 1] = clamp255(out[idx + 1]! + p.g * a);
          out[idx + 2] = clamp255(out[idx + 2]! + p.b * a);
          out[idx + 3] = clamp255(Math.max(out[idx + 3]!, a * 255));
        } else {
          out[idx] = clamp255(out[idx]! * (1 - a) + p.r * a);
          out[idx + 1] = clamp255(out[idx + 1]! * (1 - a) + p.g * a);
          out[idx + 2] = clamp255(out[idx + 2]! * (1 - a) + p.b * a);
          out[idx + 3] = clamp255(out[idx + 3]! * (1 - a) + 255 * a);
        }
      }
    }
  }
  return out;
}

// ── CC Bubbles ───────────────────────────────────────────────────────────────

/**
 * CC Bubbles — a wrapping field of rising, wobbling bubbles.
 *
 * Keyframed on `evolution`, like Snowfall and Rainfall, rather than clock-
 * driven: the field wraps, so there is no birth event to index and no reason to
 * consume the caching cost that `TIME_DEPENDENT` membership carries.
 *
 * Laid out on a hashed grid rather than a free particle list so the per-pixel
 * cost is the handful of cells that can reach a given fragment — the same trick
 * `SNOWFALL_FX` uses, and the reason both can be a shader at all.
 */
export function bubblesData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  bubbleAmount = 100,
  bubbleSpeed = 300,
  wobbleAmplitude = 10,
  wobbleFrequency = 2,
  bubbleSize = 12,
  sizeVariation = 40,
  shading = 0,
  colorR = 255,
  colorG = 255,
  colorB = 255,
  opacity = 80,
  evolution = 0,
  seed = 1,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const count = Math.max(0, Math.round(bubbleAmount));
  if (count === 0 || opacity <= 0) return out;

  // A square-ish grid sized to hold `count` cells over the layer.
  const cell = Math.max(4, Math.sqrt((w * h) / Math.max(1, count)));
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const sd = Math.floor(seed);
  const baseAlpha = clamp01(opacity / 100);
  const span = h + bubbleSize * 2;

  for (let row = 0; row < rows; row++) {
    for (let ci = 0; ci < cols; ci++) {
      const id = row * cols + ci;
      if (id >= count) continue;
      const speed = 0.5 + hash2(id, sd + 23);
      const sizeVar = 1 + (hash2(id, sd + 51) - 0.5) * 2 * clamp01(sizeVariation / 100);
      const rad = Math.max(0.5, (bubbleSize * sizeVar) / 2);
      const x0 = (ci + hash2(id, sd)) * cell;
      const y0 = (row + hash2(id, sd + 11)) * cell;
      // Rise, wrapping through a span one bubble taller than the layer so a
      // bubble leaving the top is not visible re-entering at the bottom.
      const rise = (evolution / 100) * bubbleSpeed * speed;
      const wobble = Math.sin(evolution / 40 + id * 1.7) * wobbleAmplitude
        * (0.5 + 0.5 * Math.sin(id + evolution * wobbleFrequency / 500));
      const px = x0 + wobble;
      const py = ((y0 - rise) % span + span) % span - bubbleSize;

      const xa = Math.max(0, Math.floor(px - rad));
      const xb = Math.min(w - 1, Math.ceil(px + rad));
      const ya = Math.max(0, Math.floor(py - rad));
      const yb = Math.min(h - 1, Math.ceil(py + rad));
      for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
          const dx = x + 0.5 - px;
          const dy = y + 0.5 - py;
          const d = Math.hypot(dx, dy);
          if (d > rad) continue;
          const t = d / Math.max(0.0001, rad);
          let cover: number;
          if (shading === 1) {
            cover = t;                                  // Fade Outwards — a ring.
          } else if (shading === 2) {
            // Sphere — a lit ball: bright toward the upper-left, dark at the rim.
            const nz = Math.sqrt(Math.max(0, 1 - t * t));
            cover = clamp01(0.25 + 0.75 * (nz * 0.6 + (-dx / rad) * 0.2 + (-dy / rad) * 0.2));
          } else {
            cover = 1 - t;                              // Fade Inwards.
          }
          // Every mode still feathers the outer edge, or the silhouette aliases.
          if (t > 0.9) cover *= (1 - t) / 0.1;
          const a = clamp01(baseAlpha * cover);
          if (a <= 0) continue;
          const idx = (y * w + x) * 4;
          out[idx] = clamp255(out[idx]! * (1 - a) + colorR * a);
          out[idx + 1] = clamp255(out[idx + 1]! * (1 - a) + colorG * a);
          out[idx + 2] = clamp255(out[idx + 2]! * (1 - a) + colorB * a);
          out[idx + 3] = clamp255(out[idx + 3]! * (1 - a) + 255 * a);
        }
      }
    }
  }
  return out;
}
