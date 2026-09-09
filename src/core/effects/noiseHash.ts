/**
 * The u32 value-noise family the GPU kernels use — reproduced bit-for-bit.
 *
 * The CPU bake and the shaders used to disagree about noise: the CPU hashed
 * with `sin(x·127.1 + …)·43758.5453` and the shaders, which cannot reproduce
 * that in f32, with an integer recipe (`NOISE_WGSL` in fxRoundTwelve.ts). Same
 * statistics, a different REALISATION — so one document rendered different
 * grain depending on which route it took (a mask scope, an opacity or a path
 * forces the CPU chain), and the golden gate measured it at ~38 % of pixels
 * on Add Grain, Turbulent Noise and Cell Pattern.
 *
 * Only one side can move, and it is this one: the integer recipe is exact on
 * both, the sine recipe is exact on neither. Every operation below is the
 * WGSL/GLSL statement it mirrors, in the same order, with `Math.imul` and
 * `>>> 0` standing in for u32 wrap-around. The remaining difference is f32 vs
 * f64 in the interpolation, which is below a byte.
 */

/** `hash01(x, y, seed)` — u32 mixing, → [0, 1). Integer inputs. */
export function hash01u(x: number, y: number, seed: number): number {
  // u32(x) of a negative i32 is its two's-complement bit pattern: `>>> 0`.
  let n = (Math.imul(x >>> 0, 374761393) + Math.imul(y >>> 0, 668265263) + Math.imul(seed >>> 0, 2147483647)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

/** `vnoise(p, seed)` — bilinear, smoothstepped value noise at one octave. */
export function vnoiseU(px: number, py: number, seed: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash01u(ix, iy, seed);
  const b = hash01u(ix + 1, iy, seed);
  const c = hash01u(ix, iy + 1, seed);
  const d = hash01u(ix + 1, iy + 1, seed);
  return mix(mix(a, b, ux), mix(c, d, ux), uy);
}

/** `vnoiseF(p, seed)` — a FLOAT seed glides between the two integer seeds. */
export function vnoiseF(px: number, py: number, seed: number): number {
  const s0 = Math.floor(seed);
  return mix(vnoiseU(px, py, s0), vnoiseU(px, py, s0 + 1), seed - s0);
}

/** `mix(a, b, t)` — GLSL's, so the interpolation order matches the shader. */
export function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/** `fbm(p, seed, octaves)` — six-octave cap, seed + i·101 per octave, amplitude halving, normalised. */
export function fbmU(px: number, py: number, seed: number, octaves: number): number {
  let total = 0; let amp = 1; let freq = 1; let maxA = 0;
  for (let i = 0; i < 6; i++) {
    if (i >= octaves) break;
    total += (vnoiseU(px * freq, py * freq, seed + i * 101) * 2 - 1) * amp;
    maxA += amp; amp *= 0.5; freq *= 2;
  }
  return total / maxA;
}
