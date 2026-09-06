/**
 * Round eleven: the ADVANCED DISTORT / TRANSITION / STYLIZE set — every
 * remaining `remap`-style warp and the CC-family passes from
 * `aeDistortAdvanced`, `aeDistortRoundFive`, `aeTransitionsRoundFive`,
 * `aeRoundSix`, `aeStylizeRoundFive` and the two `distort.ts` stragglers
 * (Polar Coordinates, Optics Compensation).
 *
 * Three shapes of kernel, three shapes of shader:
 *
 *   · INVERSE MAPS (`remap(...)` kernels): one fragment = one inverse lookup,
 *     `samplePx` bilinear, transparent outside the layer — exactly `remap`'s
 *     contract. Polar, Optics, Warp, Split, Slant, Smear, Rolling Shutter,
 *     Flo Motion, Lens, Griddler, Drizzle, Scale Wipe, Page Turn, Jaws,
 *     Twister, Hex Tile, CC Scatterize.
 *   · FORWARD SCATTERS (the kernel loops over CELLS and stamps each onto the
 *     output): Ball Action, Pixel Polly, Card Dance. The fragment gathers
 *     instead — it visits every cell that could have landed on it and keeps
 *     the LAST hit, which is the kernel's overwrite order. Ball Action and
 *     Card Dance are exact (bounded reach); Pixel Polly's cells fly an
 *     unbounded distance, so the search is a window around the cell that a
 *     mean-kick flight would have come from — see PIXEL_POLLY_FX.
 *   · FIELD passes (the kernel first builds a blurred luma FIELD of the whole
 *     layer, then reads its gradient): Plastic, Glass, Vector Blur, and the
 *     projected-alpha shadow of Radial Shadow. Two-texture combines — the
 *     composition pass blurs a copy with the Gaussian pass and binds it as
 *     `tex2`, the slot Unsharp Mask and Shadow/Highlight already use.
 *
 * ## Straight bytes, sRGB shading
 *
 * The kernels run on Canvas2D `getImageData` — STRAIGHT sRGB bytes. Every
 * "multiply the colour by a shade" step (Page Turn lit, Twister, Ball Action,
 * Plastic, Glass, Texturize, Threads, Hex Tile border) therefore decodes the
 * premultiplied linear chain sample to straight display sRGB (`decodeS`),
 * shades there, and re-encodes with `encodeOut`. Pure resamples skip the
 * decode, as every earlier round's warps do. Averaging passes (Radial Fast
 * Blur, Vector Blur) average straight STORAGE values via `tapStraight`, the
 * round-ten convention.
 *
 * ## Hashes
 *
 * `hash2` in the kernels multiplies a 32-bit int by 1274126177 as a float64
 * and then truncates — a rounding the GPU cannot reproduce. `hash2u` below is
 * the same recipe in real u32 arithmetic, so every hash-driven effect (Ball
 * Action jitter, Pixel Polly kicks, Drizzle drops, CC Scatterize, Texturize
 * noise) has the SAME statistics and a DIFFERENT realisation from its CPU
 * twin. Seeds still change the pattern; the pattern is not the CPU's.
 *
 * Other deliberate approximations (the kernels stay the reference):
 *   · CC Scatterize is a forward scatter of single pixels; the fragment reads
 *     `p − d(p)` with the hash evaluated at the destination, which is the same
 *     grain with the opposite bookkeeping.
 *   · The blurred fields are Gaussian (σ² = r(r+1)/3 per box pass) where the
 *     kernels box-blur with a clamped border.
 *   · Radial Fast Blur's bright/dark weighting reads storage-space luma.
 *   · CC RepeTile has NO shader: the CPU pass expands the buffer and then
 *     crops it back to the layer, so its visible result is the identity. It
 *     simply stopped forcing a bake.
 */

import type { ShaderSource } from './builtin';
import { fxShader } from './fxRoundSix';
import { withHelpers } from './fxRoundEight';
import { TAP_GLSL, TAP_WGSL, withSecondTexture } from './fxRoundTen';

// ── Shared snippets ──────────────────────────────────────────────────────────

/** `hash2` from the kernels, in u32 arithmetic (see the module note). */
const HASH_WGSL = `fn hash2u(a : i32, b : i32) -> f32 {
  var n = u32(a) * 374761393u + u32(b) * 668265263u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  n = n ^ (n >> 16u);
  return f32(n) / 4294967296.0;
}
`;
const HASH_GLSL = `float hash2u(int a, int b) {
  uint n = uint(a) * 374761393u + uint(b) * 668265263u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  n = n ^ (n >> 16u);
  return float(n) / 4294967296.0;
}
`;

/** Rec.709 luma — `colorSpace.luma`, which every kernel in this round uses. */
const LUM_WGSL = `fn lum709(c : vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }
`;
const LUM_GLSL = `float lum709(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/** Premultiplied linear chain sample → straight display-sRGB colour + alpha. */
const DECODE_WGSL = `fn decodeS(s : vec4<f32>) -> vec4<f32> {
  let a = max(s.a, 0.00001);
  let c = select(s.rgb / a, vec3<f32>(0.0), s.a <= 0.0);
  return vec4<f32>(linearToSrgbRgb(c), s.a);
}
`;
const DECODE_GLSL = `vec4 decodeS(vec4 s) {
  float a = max(s.a, 0.00001);
  vec3 c = (s.a <= 0.0) ? vec3(0.0) : s.rgb / a;
  return vec4(linearToSrgbRgb(c), s.a);
}
`;

/**
 * The kernels' `lumaField` + `gradAt`, read from the blurred copy in `tex2`.
 * Field values are in BYTES (luma × alpha × 255) because the kernels' bump and
 * displacement constants were tuned against byte gradients.
 */
export const FIELD_WGSL = `fn fieldPx(px : vec2<f32>, lwh : vec2<f32>) -> f32 {
  let s = textureSampleLevel(tex2, smp, layerUv(px, lwh), 0.0);
  let a = max(s.a, 0.00001);
  let c = select(s.rgb / a, vec3<f32>(0.0), s.a <= 0.0);
  return lum709(linearToSrgbRgb(c)) * s.a * 255.0;
}
fn gradPx(px : vec2<f32>, lwh : vec2<f32>, divide : bool) -> vec2<f32> {
  let xi = floor(px);
  let xm = max(xi.x - 1.0, 0.0); let xp = min(xi.x + 1.0, lwh.x - 1.0);
  let ym = max(xi.y - 1.0, 0.0); let yp = min(xi.y + 1.0, lwh.y - 1.0);
  let gx = fieldPx(vec2<f32>(xp + 0.5, xi.y + 0.5), lwh) - fieldPx(vec2<f32>(xm + 0.5, xi.y + 0.5), lwh);
  let gy = fieldPx(vec2<f32>(xi.x + 0.5, yp + 0.5), lwh) - fieldPx(vec2<f32>(xi.x + 0.5, ym + 0.5), lwh);
  if (divide) { return vec2<f32>(gx / max(xp - xm, 1.0), gy / max(yp - ym, 1.0)); }
  return vec2<f32>(gx, gy);
}
`;
export const FIELD_GLSL = `float fieldPx(vec2 px, vec2 lwh) {
  vec4 s = textureLod(uMaskTex, layerUv(px, lwh), 0.0);
  float a = max(s.a, 0.00001);
  vec3 c = (s.a <= 0.0) ? vec3(0.0) : s.rgb / a;
  return lum709(linearToSrgbRgb(c)) * s.a * 255.0;
}
vec2 gradPx(vec2 px, vec2 lwh, bool divide) {
  vec2 xi = floor(px);
  float xm = max(xi.x - 1.0, 0.0); float xp = min(xi.x + 1.0, lwh.x - 1.0);
  float ym = max(xi.y - 1.0, 0.0); float yp = min(xi.y + 1.0, lwh.y - 1.0);
  float gx = fieldPx(vec2(xp + 0.5, xi.y + 0.5), lwh) - fieldPx(vec2(xm + 0.5, xi.y + 0.5), lwh);
  float gy = fieldPx(vec2(xi.x + 0.5, yp + 0.5), lwh) - fieldPx(vec2(xi.x + 0.5, ym + 0.5), lwh);
  if (divide) return vec2(gx / max(xp - xm, 1.0), gy / max(yp - ym, 1.0));
  return vec2(gx, gy);
}
`;

export const BASE_WGSL = HASH_WGSL + LUM_WGSL + DECODE_WGSL + TAP_WGSL;
export const BASE_GLSL = HASH_GLSL + LUM_GLSL + DECODE_GLSL + TAP_GLSL;

/** Layer-px position + pass-through outside the layer box. `k` = the vec4 holding lw, lh. */
export const wp = (k: number): string => `  let lwh = obj.p${k}.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s0 = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s0; }`;
export const gp = (k: number): string => `  vec2 lwh = p${k}.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s0 = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s0; return; }`;

export const fx = (name: string, vec4s: number, wgsl: string, glsl: string): ShaderSource =>
  withHelpers(fxShader(name, vec4s, wgsl, glsl), BASE_WGSL, BASE_GLSL);
export const fxField = (name: string, vec4s: number, wgsl: string, glsl: string): ShaderSource =>
  withHelpers(withSecondTexture(fxShader(name, vec4s, wgsl, glsl)), BASE_WGSL + FIELD_WGSL, BASE_GLSL + FIELD_GLSL);

// ── Polar Coordinates ────────────────────────────────────────────────────────

/** p0 = lw, lh, interpolation 0..1, conversion (0 rect→polar · 1 polar→rect). */
export const POLAR_COORDINATES_FX = fx('polar-coordinates', 1,
  `${wp(0)}
  let c = lwh * 0.5;
  let maxR = length(c);
  var src = pp;
  if (obj.p0.w < 0.5) {
    let v = pp - c;
    var a = atan2(v.x, -v.y) / 6.28318530718;
    if (a < 0.0) { a = a + 1.0; }
    src = vec2<f32>(a * lwh.x, (length(v) / maxR) * lwh.y);
  } else {
    let a = (pp.x / lwh.x) * 6.28318530718;
    let r = (pp.y / lwh.y) * maxR;
    src = vec2<f32>(c.x + r * sin(a), c.y - r * cos(a));
  }
  return samplePx(pp + (src - pp) * obj.p0.z, lwh);`,
  `${gp(0)}
  vec2 c = lwh * 0.5;
  float maxR = length(c);
  vec2 src = pp;
  if (p0.w < 0.5) {
    vec2 v = pp - c;
    float a = atan(v.x, -v.y) / 6.28318530718;
    if (a < 0.0) a += 1.0;
    src = vec2(a * lwh.x, (length(v) / maxR) * lwh.y);
  } else {
    float a = (pp.x / lwh.x) * 6.28318530718;
    float r = (pp.y / lwh.y) * maxR;
    src = vec2(c.x + r * sin(a), c.y - r * cos(a));
  }
  frag = samplePx(pp + (src - pp) * p0.z, lwh);`);

// ── Optics Compensation ──────────────────────────────────────────────────────

/** p0 = lw, lh, k, reverse; p1 = cx, cy, norm. The exact inverse pair from `opticsCompensationData`. */
export const OPTICS_COMPENSATION_FX = fx('optics-compensation', 2,
  `${wp(0)}
  let v = pp - obj.p1.xy;
  let r = length(v) / obj.p1.z;
  if (r <= 0.0) { return s0; }
  let k = obj.p0.z;
  var scale = 1.0;
  if (obj.p0.w > 0.5) { scale = 1.0 / (1.0 + k * r * r); }
  else {
    let disc = 1.0 - 4.0 * r * r * k;
    let den = 2.0 * r * r * k;
    scale = select((1.0 - sqrt(max(disc, 0.0))) / den, 1.0 / den, disc <= 0.0);
  }
  return samplePx(obj.p1.xy + v * scale, lwh);`,
  `${gp(0)}
  vec2 v = pp - p1.xy;
  float r = length(v) / p1.z;
  if (r <= 0.0) { frag = s0; return; }
  float k = p0.z;
  float scale = 1.0;
  if (p0.w > 0.5) scale = 1.0 / (1.0 + k * r * r);
  else {
    float disc = 1.0 - 4.0 * r * r * k;
    float den = 2.0 * r * r * k;
    scale = (disc <= 0.0) ? 1.0 / den : (1.0 - sqrt(max(disc, 0.0))) / den;
  }
  frag = samplePx(p1.xy + v * scale, lwh);`);

// ── Warp ─────────────────────────────────────────────────────────────────────

/** p0 = lw, lh, style, bend/100; p1 = horizontal, vertical, vertical axis. Seven styles as `warpData`. */
export const WARP_FX = fx('warp', 2,
  `${wp(0)}
  let vert = obj.p1.z > 0.5;
  let u = select((pp.x / lwh.x) * 2.0 - 1.0, (pp.y / lwh.y) * 2.0 - 1.0, vert);
  let v = select((pp.y / lwh.y) * 2.0 - 1.0, (pp.x / lwh.x) * 2.0 - 1.0, vert);
  let b = obj.p0.w; let st = i32(obj.p0.z + 0.5);
  var du = 0.0; var dv = 0.0;
  if (st == 0) { dv = b * (1.0 - u * u); }
  else if (st == 1) { dv = b * (1.0 - u * u) * (v * 0.5 + 0.5); }
  else if (st == 2) { dv = b * sin(u * 6.28318530718) * (v * 0.5 + 0.5); }
  else if (st == 3) { dv = b * sin(u * 6.28318530718); }
  else if (st == 4) { let k = 1.0 + b * (1.0 - clamp(length(vec2<f32>(u, v)), 0.0, 1.0)); du = u * (k - 1.0); dv = v * (k - 1.0); }
  else if (st == 5) { dv = b * (u * 0.5 + 0.5); }
  else { dv = b * (1.0 - u * u) * v; }
  let su = u - du - select(obj.p1.x, obj.p1.y, vert) / 100.0;
  let sv = v - dv - select(obj.p1.y, obj.p1.x, vert) / 100.0;
  let sx = select(((su + 1.0) * 0.5) * lwh.x, ((sv + 1.0) * 0.5) * lwh.x, vert);
  let sy = select(((sv + 1.0) * 0.5) * lwh.y, ((su + 1.0) * 0.5) * lwh.y, vert);
  return samplePx(vec2<f32>(sx, sy), lwh);`,
  `${gp(0)}
  bool vert = p1.z > 0.5;
  float u = vert ? (pp.y / lwh.y) * 2.0 - 1.0 : (pp.x / lwh.x) * 2.0 - 1.0;
  float v = vert ? (pp.x / lwh.x) * 2.0 - 1.0 : (pp.y / lwh.y) * 2.0 - 1.0;
  float b = p0.w; int st = int(p0.z + 0.5);
  float du = 0.0; float dv = 0.0;
  if (st == 0) dv = b * (1.0 - u * u);
  else if (st == 1) dv = b * (1.0 - u * u) * (v * 0.5 + 0.5);
  else if (st == 2) dv = b * sin(u * 6.28318530718) * (v * 0.5 + 0.5);
  else if (st == 3) dv = b * sin(u * 6.28318530718);
  else if (st == 4) { float k = 1.0 + b * (1.0 - clamp(length(vec2(u, v)), 0.0, 1.0)); du = u * (k - 1.0); dv = v * (k - 1.0); }
  else if (st == 5) dv = b * (u * 0.5 + 0.5);
  else dv = b * (1.0 - u * u) * v;
  float su = u - du - (vert ? p1.y : p1.x) / 100.0;
  float sv = v - dv - (vert ? p1.x : p1.y) / 100.0;
  float sx = vert ? ((sv + 1.0) * 0.5) * lwh.x : ((su + 1.0) * 0.5) * lwh.x;
  float sy = vert ? ((su + 1.0) * 0.5) * lwh.y : ((sv + 1.0) * 0.5) * lwh.y;
  frag = samplePx(vec2(sx, sy), lwh);`);

// ── Page Turn ────────────────────────────────────────────────────────────────

/** p0 = lw, lh, nx, ny; p1 = foldAt, curl radius, back opacity, shading. The curled part is lit and faded like `pageTurnData`. */
export const PAGE_TURN_FX = fx('page-turn', 2,
  `${wp(0)}
  let nrm = obj.p0.zw;
  let d = dot(pp - lwh * 0.5, nrm) - obj.p1.x;
  if (d < 0.0) { return s0; }
  let rad = obj.p1.y;
  if (d > 3.14159265359 * rad) { return vec4<f32>(0.0); }
  let theta = d / rad;
  let src = pp - nrm * (d + rad * sin(theta));
  if (src.x < 0.0 || src.x >= lwh.x || src.y < 0.0 || src.y >= lwh.y) { return vec4<f32>(0.0); }
  let backA = obj.p1.z;
  let lit = clamp(1.0 - obj.p1.w * (1.0 - cos(theta)), 0.0, 1.0);
  let c = decodeS(samplePx(src, lwh));
  return encodeOut(c.rgb * lit * (0.35 + 0.65 * backA), c.a * backA);`,
  `${gp(0)}
  vec2 nrm = p0.zw;
  float d = dot(pp - lwh * 0.5, nrm) - p1.x;
  if (d < 0.0) { frag = s0; return; }
  float rad = p1.y;
  if (d > 3.14159265359 * rad) { frag = vec4(0.0); return; }
  float theta = d / rad;
  vec2 src = pp - nrm * (d + rad * sin(theta));
  if (src.x < 0.0 || src.x >= lwh.x || src.y < 0.0 || src.y >= lwh.y) { frag = vec4(0.0); return; }
  float backA = p1.z;
  float lit = clamp(1.0 - p1.w * (1.0 - cos(theta)), 0.0, 1.0);
  vec4 c = decodeS(samplePx(src, lwh));
  frag = encodeOut(c.rgb * lit * (0.35 + 0.65 * backA), c.a * backA);`);

// ── Split ────────────────────────────────────────────────────────────────────

/** p0 = lw, lh, nx, ny; p1 = cx, cy, half offset. */
export const SPLIT_FX = fx('split', 2,
  `${wp(0)}
  let side = select(-1.0, 1.0, dot(pp - obj.p1.xy, obj.p0.zw) >= 0.0);
  return samplePx(pp - side * obj.p1.z * obj.p0.zw, lwh);`,
  `${gp(0)}
  float side = (dot(pp - p1.xy, p0.zw) >= 0.0) ? 1.0 : -1.0;
  frag = samplePx(pp - side * p1.z * p0.zw, lwh);`);

// ── Slant ────────────────────────────────────────────────────────────────────

/** p0 = lw, lh, slant px, vertical axis; p1 = floor anchor 0..1. */
export const SLANT_FX = fx('slant', 2,
  `${wp(0)}
  if (obj.p0.w > 0.5) { let t = pp.x / lwh.x - obj.p1.x; return samplePx(vec2<f32>(pp.x, pp.y - obj.p0.z * t), lwh); }
  let t = pp.y / lwh.y - obj.p1.x;
  return samplePx(vec2<f32>(pp.x - obj.p0.z * t, pp.y), lwh);`,
  `${gp(0)}
  if (p0.w > 0.5) { float t = pp.x / lwh.x - p1.x; frag = samplePx(vec2(pp.x, pp.y - p0.z * t), lwh); return; }
  float t = pp.y / lwh.y - p1.x;
  frag = samplePx(vec2(pp.x - p0.z * t, pp.y), lwh);`);

// ── Smear ────────────────────────────────────────────────────────────────────

/** p0 = lw, lh, from x, from y; p1 = vx, vy, radius, elasticity. */
export const SMEAR_FX = fx('smear', 2,
  `${wp(0)}
  let d = length(pp - obj.p0.zw);
  if (d >= obj.p1.z) { return s0; }
  let t = 1.0 - d / obj.p1.z;
  let k = pow(t * t * (3.0 - 2.0 * t), 1.0 / obj.p1.w);
  return samplePx(pp - obj.p1.xy * k, lwh);`,
  `${gp(0)}
  float d = length(pp - p0.zw);
  if (d >= p1.z) { frag = s0; return; }
  float t = 1.0 - d / p1.z;
  float k = pow(t * t * (3.0 - 2.0 * t), 1.0 / p1.w);
  frag = samplePx(pp - p1.xy * k, lwh);`);

// ── Rolling Shutter ──────────────────────────────────────────────────────────

/** p0 = lw, lh, sweep, wobble; p1 = flip, vertical scan. */
export const ROLLING_SHUTTER_FX = fx('rolling-shutter', 2,
  `${wp(0)}
  let vertical = obj.p1.y > 0.5;
  var t = select(pp.y / lwh.y, pp.x / lwh.x, vertical);
  if (obj.p1.x > 0.5) { t = 1.0 - t; }
  let shift = obj.p0.z * t + obj.p0.w * sin(t * 6.28318530718);
  let src = select(vec2<f32>(pp.x - shift, pp.y), vec2<f32>(pp.x, pp.y - shift), vertical);
  return samplePx(src, lwh);`,
  `${gp(0)}
  bool vertical = p1.y > 0.5;
  float t = vertical ? pp.x / lwh.x : pp.y / lwh.y;
  if (p1.x > 0.5) t = 1.0 - t;
  float shift = p0.z * t + p0.w * sin(t * 6.28318530718);
  vec2 src = vertical ? vec2(pp.x, pp.y - shift) : vec2(pp.x - shift, pp.y);
  frag = samplePx(src, lwh);`);

// ── Radial Shadow (project, then combine) ────────────────────────────────────

/** Pass 1 — the alpha projected away from the light. p0 = lw, lh, light x, light y; p1 = projection. Writes (0,0,0,a). */
export const RADIAL_SHADOW_PROJECT_FX = fx('radial-shadow-project', 2,
  `  let lwh = obj.p0.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return vec4<f32>(0.0); }
  let l = obj.p0.zw;
  let src = l + (pp - l) / obj.p1.x;
  if (src.x < 0.0 || src.x >= lwh.x || src.y < 0.0 || src.y >= lwh.y) { return vec4<f32>(0.0); }
  return vec4<f32>(0.0, 0.0, 0.0, samplePx(floor(src) + vec2<f32>(0.5), lwh).a);`,
  `  vec2 lwh = p0.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = vec4(0.0); return; }
  vec2 l = p0.zw;
  vec2 src = l + (pp - l) / p1.x;
  if (src.x < 0.0 || src.x >= lwh.x || src.y < 0.0 || src.y >= lwh.y) { frag = vec4(0.0); return; }
  frag = vec4(0.0, 0.0, 0.0, samplePx(floor(src) + vec2(0.5), lwh).a);`);

/** Pass 2 — tex = layer, tex2 = (blurred) projected alpha. p0 = shadow colour (sRGB), opacity; p1 = shadow-only. */
export const RADIAL_SHADOW_FX = fxField('radial-shadow', 2,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  let sh = clamp(textureSampleLevel(tex2, smp, uv, 0.0).a, 0.0, 1.0) * obj.p0.w;
  if (obj.p1.x > 0.5) { return encodeOut(obj.p0.xyz, sh); }
  let la = s.a;
  let outA = la + sh * (1.0 - la);
  if (outA <= 0.0) { return vec4<f32>(0.0); }
  let c = decodeS(s);
  return encodeOut((c.rgb * la + obj.p0.xyz * sh * (1.0 - la)) / outA, outA);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  float sh = clamp(textureLod(uMaskTex, vUv, 0.0).a, 0.0, 1.0) * p0.w;
  if (p1.x > 0.5) { frag = encodeOut(p0.xyz, sh); return; }
  float la = s.a;
  float outA = la + sh * (1.0 - la);
  if (outA <= 0.0) { frag = vec4(0.0); return; }
  vec4 c = decodeS(s);
  frag = encodeOut((c.rgb * la + p0.xyz * sh * (1.0 - la)) / outA, outA);`);

// ── Flo Motion ───────────────────────────────────────────────────────────────

/** p0 = lw, lh, knot1 x, y; p1 = knot1 amount, knot2 x, y, amount; p2 = 2σ², reach/σ. */
export const FLO_MOTION_FX = fx('flo-motion', 3,
  `${wp(0)}
  let v1 = pp - obj.p0.zw;
  let v2 = pp - obj.p1.yz;
  let o = -v1 * obj.p1.x * exp(-dot(v1, v1) / obj.p2.x) * obj.p2.y - v2 * obj.p1.w * exp(-dot(v2, v2) / obj.p2.x) * obj.p2.y;
  return samplePx(pp + o, lwh);`,
  `${gp(0)}
  vec2 v1 = pp - p0.zw;
  vec2 v2 = pp - p1.yz;
  vec2 o = -v1 * p1.x * exp(-dot(v1, v1) / p2.x) * p2.y - v2 * p1.w * exp(-dot(v2, v2) / p2.x) * p2.y;
  frag = samplePx(pp + o, lwh);`);

// ── Lens ─────────────────────────────────────────────────────────────────────

/** p0 = lw, lh, cx, cy; p1 = ball radius, pull. Transparent outside the ball. */
export const LENS_FX = fx('lens', 2,
  `${wp(0)}
  let v = pp - obj.p0.zw;
  let r = length(v);
  if (r > obj.p1.x) { return vec4<f32>(0.0); }
  if (r < 0.000001) { return samplePx(lwh * 0.5, lwh); }
  let srcR = obj.p1.y * (asin(min(1.0, r / obj.p1.x)) / 1.57079632679);
  return samplePx(lwh * 0.5 + v * (srcR / r), lwh);`,
  `${gp(0)}
  vec2 v = pp - p0.zw;
  float r = length(v);
  if (r > p1.x) { frag = vec4(0.0); return; }
  if (r < 0.000001) { frag = samplePx(lwh * 0.5, lwh); return; }
  float srcR = p1.y * (asin(min(1.0, r / p1.x)) / 1.57079632679);
  frag = samplePx(lwh * 0.5 + v * (srcR / r), lwh);`);

// ── Griddler ─────────────────────────────────────────────────────────────────

/** p0 = lw, lh, tile, sx; p1 = sy, cos, sin. Gaps between the scaled tiles are transparent. */
export const GRIDDLER_FX = fx('griddler', 2,
  `${wp(0)}
  let tile = obj.p0.z;
  let cc = (floor(pp / tile) + 0.5) * tile;
  let l = pp - cc;
  let ux = (l.x * obj.p1.y + l.y * obj.p1.z) / obj.p0.w;
  let uy = (-l.x * obj.p1.z + l.y * obj.p1.y) / obj.p1.x;
  if (abs(ux) > tile * 0.5 || abs(uy) > tile * 0.5) { return vec4<f32>(0.0); }
  return samplePx(cc + vec2<f32>(ux, uy), lwh);`,
  `${gp(0)}
  float tile = p0.z;
  vec2 cc = (floor(pp / tile) + 0.5) * tile;
  vec2 l = pp - cc;
  float ux = (l.x * p1.y + l.y * p1.z) / p0.w;
  float uy = (-l.x * p1.z + l.y * p1.y) / p1.x;
  if (abs(ux) > tile * 0.5 || abs(uy) > tile * 0.5) { frag = vec4(0.0); return; }
  frag = samplePx(cc + vec2(ux, uy), lwh);`);

// ── Ball Action (gather) ─────────────────────────────────────────────────────

/**
 * p0 = lw, lh, grid, ball radius; p1 = jitter, seed. A ball reaches at most
 * one cell past its own (jitter ≤ g/2, R ≤ g/2), so the 3×3 neighbourhood is
 * the whole candidate set; the LAST hit wins, as in `ballActionData`.
 */
export const BALL_ACTION_FX = fx('ball-action', 2,
  `${wp(0)}
  let g = obj.p0.z; let R = obj.p0.w; let jit = obj.p1.x; let sd = i32(obj.p1.y);
  let cols = i32(ceil(lwh.x / g)); let rows = i32(ceil(lwh.y / g));
  let cell = vec2<i32>(floor(pp / g));
  var res = vec4<f32>(0.0);
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let cx = cell.x + i; let cy = cell.y + j;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) { continue; }
      let hid = cx * 7919 + cy;
      let b = vec2<f32>((f32(cx) + 0.5) * g + (hash2u(hid, sd) - 0.5) * 2.0 * jit, (f32(cy) + 0.5) * g + (hash2u(hid, sd + 77) - 0.5) * 2.0 * jit);
      let d2 = pp - b;
      let d = length(d2);
      if (d > R) { continue; }
      let dn = d / R;
      let lift = select(1.0, (asin(min(1.0, dn)) / 1.57079632679) / dn, dn > 0.000001);
      let cc = (vec2<f32>(f32(cx), f32(cy)) + 0.5) * g;
      let sp = clamp(round(cc + d2 * lift * (g / (2.0 * R))), vec2<f32>(0.0), lwh - 1.0) + 0.5;
      let sm = samplePx(sp, lwh);
      if (sm.a <= 0.0) { continue; }
      let nz = sqrt(max(0.0, 1.0 - dn * dn));
      let light = clamp(0.35 + 0.65 * ((-d2.x / R) * 0.5 + (-d2.y / R) * 0.5 + nz * 0.7), 0.0, 1.0);
      let c = decodeS(sm);
      res = encodeOut(c.rgb * light, c.a);
    }
  }
  return res;`,
  `${gp(0)}
  float g = p0.z; float R = p0.w; float jit = p1.x; int sd = int(p1.y);
  int cols = int(ceil(lwh.x / g)); int rows = int(ceil(lwh.y / g));
  ivec2 cell = ivec2(floor(pp / g));
  vec4 res = vec4(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      int cx = cell.x + i; int cy = cell.y + j;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      int hid = cx * 7919 + cy;
      vec2 b = vec2((float(cx) + 0.5) * g + (hash2u(hid, sd) - 0.5) * 2.0 * jit, (float(cy) + 0.5) * g + (hash2u(hid, sd + 77) - 0.5) * 2.0 * jit);
      vec2 d2 = pp - b;
      float d = length(d2);
      if (d > R) continue;
      float dn = d / R;
      float lift = (dn > 0.000001) ? (asin(min(1.0, dn)) / 1.57079632679) / dn : 1.0;
      vec2 cc = (vec2(float(cx), float(cy)) + 0.5) * g;
      vec2 sp = clamp(round(cc + d2 * lift * (g / (2.0 * R))), vec2(0.0), lwh - 1.0) + 0.5;
      vec4 sm = samplePx(sp, lwh);
      if (sm.a <= 0.0) continue;
      float nz = sqrt(max(0.0, 1.0 - dn * dn));
      float light = clamp(0.35 + 0.65 * ((-d2.x / R) * 0.5 + (-d2.y / R) * 0.5 + nz * 0.7), 0.0, 1.0);
      vec4 c = decodeS(sm);
      res = encodeOut(c.rgb * light, c.a);
    }
  }
  frag = res;`);

// ── Drizzle ──────────────────────────────────────────────────────────────────

/** p0 = lw, lh, drop count (≤30), spread; p1 = band width, ring frequency, evolution, seed; p2 = ripple height. */
export const DRIZZLE_FX = fx('drizzle', 3,
  `${wp(0)}
  let n = i32(obj.p0.z + 0.5); let sd = i32(obj.p1.w);
  var o = vec2<f32>(0.0);
  for (var i = 0; i < 30; i = i + 1) {
    if (i >= n) { break; }
    let cycle = fract(obj.p1.z / 200.0 + hash2u(i, sd + 303));
    let dp = vec2<f32>(hash2u(i, sd) * lwh.x, hash2u(i, sd + 11) * lwh.y);
    let v = pp - dp;
    let r = length(v);
    let off = r - cycle * obj.p0.w;
    if (abs(off) > obj.p1.x * 2.5 || r < 0.001) { continue; }
    let env = exp(-(off * off) / (2.0 * obj.p1.x * obj.p1.x));
    o = o + (v / r) * (sin(off * obj.p1.y) * obj.p2.x * (1.0 - cycle) * env);
  }
  return samplePx(pp + o, lwh);`,
  `${gp(0)}
  int n = int(p0.z + 0.5); int sd = int(p1.w);
  vec2 o = vec2(0.0);
  for (int i = 0; i < 30; i++) {
    if (i >= n) break;
    float cycle = fract(p1.z / 200.0 + hash2u(i, sd + 303));
    vec2 dp = vec2(hash2u(i, sd) * lwh.x, hash2u(i, sd + 11) * lwh.y);
    vec2 v = pp - dp;
    float r = length(v);
    float off = r - cycle * p0.w;
    if (abs(off) > p1.x * 2.5 || r < 0.001) continue;
    float env = exp(-(off * off) / (2.0 * p1.x * p1.x));
    o += (v / r) * (sin(off * p1.y) * p2.x * (1.0 - cycle) * env);
  }
  frag = samplePx(pp + o, lwh);`);

// ── Jaws ─────────────────────────────────────────────────────────────────────

/** p0 = lw, lh, ux, uy (seam direction); p1 = separation, tooth width, tooth height. */
export const JAWS_FX = fx('jaws', 2,
  `${wp(0)}
  let u2 = obj.p0.zw; let nrm = vec2<f32>(-u2.y, u2.x);
  let rp = pp - lwh * 0.5;
  let tw = obj.p1.y; let th = obj.p1.z;
  let pA = fract(dot(rp, u2) / tw);
  let seam = select(2.0 - pA * 2.0, pA * 2.0, pA < 0.5) * th - th * 0.5;
  let top = dot(rp, nrm) >= seam;
  let sp = pp - nrm * select(-obj.p1.x, obj.p1.x, top);
  let si = round(sp - 0.5);
  if (si.x < 0.0 || si.x >= lwh.x || si.y < 0.0 || si.y >= lwh.y) { return vec4<f32>(0.0); }
  let sr = sp - lwh * 0.5;
  let pB = fract(dot(sr, u2) / tw);
  let seam2 = select(2.0 - pB * 2.0, pB * 2.0, pB < 0.5) * th - th * 0.5;
  if ((dot(sr, nrm) >= seam2) != top) { return vec4<f32>(0.0); }
  return samplePx(si + 0.5, lwh);`,
  `${gp(0)}
  vec2 u2 = p0.zw; vec2 nrm = vec2(-u2.y, u2.x);
  vec2 rp = pp - lwh * 0.5;
  float tw = p1.y; float th = p1.z;
  float pA = fract(dot(rp, u2) / tw);
  float seam = ((pA < 0.5) ? pA * 2.0 : 2.0 - pA * 2.0) * th - th * 0.5;
  bool top = dot(rp, nrm) >= seam;
  vec2 sp = pp - nrm * (top ? p1.x : -p1.x);
  vec2 si = round(sp - 0.5);
  if (si.x < 0.0 || si.x >= lwh.x || si.y < 0.0 || si.y >= lwh.y) { frag = vec4(0.0); return; }
  vec2 sr = sp - lwh * 0.5;
  float pB = fract(dot(sr, u2) / tw);
  float seam2 = ((pB < 0.5) ? pB * 2.0 : 2.0 - pB * 2.0) * th - th * 0.5;
  if ((dot(sr, nrm) >= seam2) != top) { frag = vec4(0.0); return; }
  frag = samplePx(si + 0.5, lwh);`);

// ── Pixel Polly (gather) ─────────────────────────────────────────────────────

/**
 * p0 = lw, lh, t, cell; p1 = focus x, focus y, max fly, gravity drop (px at
 * t = 1); p2 = spin (rad), seed, fade, columns.
 *
 * A cell at C lands at C + (dir(C) + jitter)·t²·maxFly·kick + gravity. The
 * fragment un-flies itself with the MEAN kick along its own radial direction
 * and searches the cells around that guess, wide enough for the kick range
 * (0.5..1.3) and the ±0.4 jitter; the window is capped at 13×13 cells, so at
 * large t and small cells a few far-flung pieces can be missed.
 */
export const PIXEL_POLLY_FX = fx('pixel-polly', 3,
  `${wp(0)}
  let t = obj.p0.z; let cell = obj.p0.w; let cols = i32(obj.p2.w + 0.5);
  let rows = i32(ceil(lwh.y / cell));
  let sd = i32(obj.p2.y);
  let D = t * t * obj.p1.z;
  let grav = vec2<f32>(0.0, obj.p1.w * t * t);
  let pg = pp - grav;
  let dp0 = pg - obj.p1.xy; let dl0 = length(dp0);
  let dirP = select(dp0 / max(dl0, 0.000001), vec2<f32>(0.0), dl0 < 0.000001);
  let gc = vec2<i32>(floor((pg - dirP * (D * 0.9)) / cell));
  let hw = min(6, i32(ceil(0.92 * D / cell)) + 1);
  var res = vec4<f32>(0.0);
  for (var j = -6; j <= 6; j = j + 1) {
    for (var i = -6; i <= 6; i = i + 1) {
      if (abs(i) > hw || abs(j) > hw) { continue; }
      let cx = gc.x + i; let cy = gc.y + j;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) { continue; }
      let id = cy * cols + cx;
      let cc = (vec2<f32>(f32(cx), f32(cy)) + 0.5) * cell;
      let dc = cc - obj.p1.xy; let dl = length(dc);
      let dir = select(dc / max(dl, 0.000001), vec2<f32>(0.0), dl < 0.000001);
      let kick = 0.5 + hash2u(id, sd) * 0.8;
      let jt = vec2<f32>((hash2u(id, sd + 31) - 0.5) * 0.8, (hash2u(id, sd + 47) - 0.5) * 0.8);
      let pc = cc + (dir + jt) * D * kick + grav;
      let rot = obj.p2.x * t * (hash2u(id, sd + 63) - 0.5) * 2.0;
      let cr = cos(rot); let sn = sin(rot);
      let l = pp - pc;
      let sl = vec2<f32>(l.x * cr + l.y * sn, -l.x * sn + l.y * cr);
      if (abs(sl.x) > cell * 0.5 || abs(sl.y) > cell * 0.5) { continue; }
      let si = round(cc + sl - 0.5);
      if (si.x < 0.0 || si.x >= lwh.x || si.y < 0.0 || si.y >= lwh.y) { continue; }
      let sm = samplePx(si + 0.5, lwh);
      if (sm.a <= 0.0) { continue; }
      res = sm * obj.p2.z;
    }
  }
  return res;`,
  `${gp(0)}
  float t = p0.z; float cell = p0.w; int cols = int(p2.w + 0.5);
  int rows = int(ceil(lwh.y / cell));
  int sd = int(p2.y);
  float D = t * t * p1.z;
  vec2 grav = vec2(0.0, p1.w * t * t);
  vec2 pg = pp - grav;
  vec2 dp0 = pg - p1.xy; float dl0 = length(dp0);
  vec2 dirP = (dl0 < 0.000001) ? vec2(0.0) : dp0 / dl0;
  ivec2 gc = ivec2(floor((pg - dirP * (D * 0.9)) / cell));
  int hw = min(6, int(ceil(0.92 * D / cell)) + 1);
  vec4 res = vec4(0.0);
  for (int j = -6; j <= 6; j++) {
    for (int i = -6; i <= 6; i++) {
      if (abs(i) > hw || abs(j) > hw) continue;
      int cx = gc.x + i; int cy = gc.y + j;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      int id = cy * cols + cx;
      vec2 cc = (vec2(float(cx), float(cy)) + 0.5) * cell;
      vec2 dc = cc - p1.xy; float dl = length(dc);
      vec2 dir = (dl < 0.000001) ? vec2(0.0) : dc / dl;
      float kick = 0.5 + hash2u(id, sd) * 0.8;
      vec2 jt = vec2((hash2u(id, sd + 31) - 0.5) * 0.8, (hash2u(id, sd + 47) - 0.5) * 0.8);
      vec2 pc = cc + (dir + jt) * D * kick + grav;
      float rot = p2.x * t * (hash2u(id, sd + 63) - 0.5) * 2.0;
      float cr = cos(rot); float sn = sin(rot);
      vec2 l = pp - pc;
      vec2 sl = vec2(l.x * cr + l.y * sn, -l.x * sn + l.y * cr);
      if (abs(sl.x) > cell * 0.5 || abs(sl.y) > cell * 0.5) continue;
      vec2 si = round(cc + sl - 0.5);
      if (si.x < 0.0 || si.x >= lwh.x || si.y < 0.0 || si.y >= lwh.y) continue;
      vec4 sm = samplePx(si + 0.5, lwh);
      if (sm.a <= 0.0) continue;
      res = sm * p2.z;
    }
  }
  frag = res;`);

// ── Twister ──────────────────────────────────────────────────────────────────

/** p0 = lw, lh, t, axis y; p1 = twist (rad). Column-wise fold toward the axis, shaded by its cosine. */
export const TWISTER_FX = fx('twister', 2,
  `${wp(0)}
  let t = obj.p0.z;
  let x = floor(pp.x);
  let phase = sin((x / max(1.0, lwh.x - 1.0)) * 6.28318530718) * obj.p1.x * t * 0.5;
  let ang = t * 1.57079632679 + phase * (1.0 - t);
  let c = cos(min(1.57079632679, max(0.0, ang)));
  if (c <= 0.02) { return vec4<f32>(0.0); }
  let sy = round(obj.p0.w + (pp.y - obj.p0.w) / c - 0.5);
  if (sy < 0.0 || sy >= lwh.y) { return vec4<f32>(0.0); }
  let sm = samplePx(vec2<f32>(x + 0.5, sy + 0.5), lwh);
  if (sm.a <= 0.0) { return vec4<f32>(0.0); }
  let cc = decodeS(sm);
  return encodeOut(cc.rgb * (0.6 + 0.4 * c), cc.a);`,
  `${gp(0)}
  float t = p0.z;
  float x = floor(pp.x);
  float phase = sin((x / max(1.0, lwh.x - 1.0)) * 6.28318530718) * p1.x * t * 0.5;
  float ang = t * 1.57079632679 + phase * (1.0 - t);
  float c = cos(min(1.57079632679, max(0.0, ang)));
  if (c <= 0.02) { frag = vec4(0.0); return; }
  float sy = round(p0.w + (pp.y - p0.w) / c - 0.5);
  if (sy < 0.0 || sy >= lwh.y) { frag = vec4(0.0); return; }
  vec4 sm = samplePx(vec2(x + 0.5, sy + 0.5), lwh);
  if (sm.a <= 0.0) { frag = vec4(0.0); return; }
  vec4 cc = decodeS(sm);
  frag = encodeOut(cc.rgb * (0.6 + 0.4 * c), cc.a);`);

// ── Card Dance (gather) ──────────────────────────────────────────────────────

/**
 * p0 = lw, lh, rows, columns; p1 = amount, rotation (rad), phase, max offset.
 * Cards move only along y (by the luma at their centre) and rotate, so the
 * candidates are every row of the two columns either side; last hit wins.
 */
export const CARD_DANCE_FX = fx('card-dance', 2,
  `${wp(0)}
  let R = i32(obj.p0.z + 0.5); let C = i32(obj.p0.w + 0.5);
  let cellW = lwh.x / f32(C); let cellH = lwh.y / f32(R);
  let amt = obj.p1.x; let maxOff = obj.p1.w;
  let col0 = i32(floor(pp.x / cellW));
  var res = vec4<f32>(0.0);
  for (var cy = 0; cy < 64; cy = cy + 1) {
    if (cy >= R) { break; }
    for (var di = -2; di <= 2; di = di + 1) {
      let cx = col0 + di;
      if (cx < 0 || cx >= C) { continue; }
      let cc = vec2<f32>((f32(cx) + 0.5) * cellW, (f32(cy) + 0.5) * cellH);
      let sI = clamp(round(cc), vec2<f32>(0.0), lwh - 1.0) + 0.5;
      let drive = (lum709(decodeS(samplePx(sI, lwh)).rgb) - 0.5) * 2.0;
      let wave = sin((obj.p1.z / 100.0) * 6.28318530718 + f32(cx) * 0.7 + f32(cy) * 0.45);
      let offY = -(drive * maxOff * amt) - wave * maxOff * amt * 0.3;
      let rot = obj.p1.y * (drive + wave * 0.3) * amt;
      let cr = cos(rot); let sn = sin(rot);
      let l = pp - vec2<f32>(cc.x, cc.y + offY);
      let sl = vec2<f32>(l.x * cr + l.y * sn, -l.x * sn + l.y * cr);
      if (abs(sl.x) > cellW * 0.5 || abs(sl.y) > cellH * 0.5) { continue; }
      let si = round(cc + sl - 0.5);
      if (si.x < 0.0 || si.x >= lwh.x || si.y < 0.0 || si.y >= lwh.y) { continue; }
      let sm = samplePx(si + 0.5, lwh);
      if (sm.a <= 0.0) { continue; }
      res = sm;
    }
  }
  return res;`,
  `${gp(0)}
  int R = int(p0.z + 0.5); int C = int(p0.w + 0.5);
  float cellW = lwh.x / float(C); float cellH = lwh.y / float(R);
  float amt = p1.x; float maxOff = p1.w;
  int col0 = int(floor(pp.x / cellW));
  vec4 res = vec4(0.0);
  for (int cy = 0; cy < 64; cy++) {
    if (cy >= R) break;
    for (int di = -2; di <= 2; di++) {
      int cx = col0 + di;
      if (cx < 0 || cx >= C) continue;
      vec2 cc = vec2((float(cx) + 0.5) * cellW, (float(cy) + 0.5) * cellH);
      vec2 sI = clamp(round(cc), vec2(0.0), lwh - 1.0) + 0.5;
      float drive = (lum709(decodeS(samplePx(sI, lwh)).rgb) - 0.5) * 2.0;
      float wave = sin((p1.z / 100.0) * 6.28318530718 + float(cx) * 0.7 + float(cy) * 0.45);
      float offY = -(drive * maxOff * amt) - wave * maxOff * amt * 0.3;
      float rot = p1.y * (drive + wave * 0.3) * amt;
      float cr = cos(rot); float sn = sin(rot);
      vec2 l = pp - vec2(cc.x, cc.y + offY);
      vec2 sl = vec2(l.x * cr + l.y * sn, -l.x * sn + l.y * cr);
      if (abs(sl.x) > cellW * 0.5 || abs(sl.y) > cellH * 0.5) continue;
      vec2 si = round(cc + sl - 0.5);
      if (si.x < 0.0 || si.x >= lwh.x || si.y < 0.0 || si.y >= lwh.y) continue;
      vec4 sm = samplePx(si + 0.5, lwh);
      if (sm.a <= 0.0) continue;
      res = sm;
    }
  }
  frag = res;`);

// ── Unmult ───────────────────────────────────────────────────────────────────

/** p0 = threshold 0..0.99, boost gain. Alpha from the brightest channel; colour divided back out, as `unmultData`. */
export const UNMULT_FX = fx('unmult', 1,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (s.a <= 0.0) { return vec4<f32>(0.0); }
  let c = decodeS(s);
  let maxChan = max(c.r, max(c.g, c.b));
  if (maxChan <= obj.p0.x) { return vec4<f32>(0.0); }
  let newA = min(1.0, ((maxChan - obj.p0.x) / (1.0 - obj.p0.x)) * obj.p0.y * c.a);
  if (newA < 0.00196) { return vec4<f32>(0.0); }
  return encodeOut(c.rgb / newA, newA);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  if (s.a <= 0.0) { frag = vec4(0.0); return; }
  vec4 c = decodeS(s);
  float maxChan = max(c.r, max(c.g, c.b));
  if (maxChan <= p0.x) { frag = vec4(0.0); return; }
  float newA = min(1.0, ((maxChan - p0.x) / (1.0 - p0.x)) * p0.y * c.a);
  if (newA < 0.00196) { frag = vec4(0.0); return; }
  frag = encodeOut(c.rgb / newA, newA);`);

// ── CC Composite ─────────────────────────────────────────────────────────────

/**
 * p0 = opacity 0..1, mode, rgbOnly. The CPU pass composites the layer with
 * ITSELF (`applyCcComposite` hands the same buffer in as current and original),
 * so each mode collapses to a per-pixel curve: 0/1 in-front/behind = identity,
 * 2 add, 3 multiply, 4 screen, 5 overlay, 6/7 hard/soft light = identity
 * (unhandled by the kernel's switch), 8 difference = black, 9 stencil alpha
 * = a², 10 silhouette alpha = a(1 − a).
 */
export const CC_COMPOSITE_FX = fx('cc-composite', 1,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  let c = decodeS(s);
  let m = i32(obj.p0.y + 0.5);
  var b = c.rgb; var ba = c.a;
  if (m == 2) { b = min(vec3<f32>(1.0), c.rgb * 2.0); }
  else if (m == 3) { b = c.rgb * c.rgb; }
  else if (m == 4) { b = 1.0 - (1.0 - c.rgb) * (1.0 - c.rgb); }
  else if (m == 5) { b = select(1.0 - 2.0 * (1.0 - c.rgb) * (1.0 - c.rgb), 2.0 * c.rgb * c.rgb, c.rgb < vec3<f32>(0.502)); }
  else if (m == 8) { b = vec3<f32>(0.0); }
  else if (m == 9) { ba = c.a * c.a; }
  else if (m == 10) { ba = c.a * (1.0 - c.a); }
  let a = select(mix(c.a, ba, obj.p0.x), c.a, obj.p0.z > 0.5);
  return encodeOut(mix(c.rgb, b, obj.p0.x), a);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  vec4 c = decodeS(s);
  int m = int(p0.y + 0.5);
  vec3 b = c.rgb; float ba = c.a;
  if (m == 2) b = min(vec3(1.0), c.rgb * 2.0);
  else if (m == 3) b = c.rgb * c.rgb;
  else if (m == 4) b = 1.0 - (1.0 - c.rgb) * (1.0 - c.rgb);
  else if (m == 5) b = mix(1.0 - 2.0 * (1.0 - c.rgb) * (1.0 - c.rgb), 2.0 * c.rgb * c.rgb, lessThan(c.rgb, vec3(0.502)));
  else if (m == 8) b = vec3(0.0);
  else if (m == 9) ba = c.a * c.a;
  else if (m == 10) ba = c.a * (1.0 - c.a);
  float a = (p0.z > 0.5) ? c.a : mix(c.a, ba, p0.x);
  frag = encodeOut(mix(c.rgb, b, p0.x), a);`);

// ── CC Scatterize ────────────────────────────────────────────────────────────

/** p0 = lw, lh, amount·0.5, twist (rad); p1 = wind x, wind y, seed. Inverse read — see the module note. */
export const CC_SCATTERIZE_FX = fx('cc-scatterize', 2,
  `${wp(0)}
  let xi = i32(floor(pp.x)); let yi = i32(floor(pp.y)); let sd = i32(obj.p1.z);
  let h1 = hash2u(xi + sd * 997, yi + sd * 997);
  let h2 = hash2u(yi + sd * 613, xi + sd * 613);
  let amt = obj.p0.z;
  let ang = h2 * 6.28318530718 + obj.p0.w * (length(pp - lwh * 0.5) / max(1.0, lwh.x * 0.5));
  let d = vec2<f32>(cos(ang), sin(ang)) * (h1 * amt) + obj.p1.xy * amt / 100.0;
  return samplePx(pp - d, lwh);`,
  `${gp(0)}
  int xi = int(floor(pp.x)); int yi = int(floor(pp.y)); int sd = int(p1.z);
  float h1 = hash2u(xi + sd * 997, yi + sd * 997);
  float h2 = hash2u(yi + sd * 613, xi + sd * 613);
  float amt = p0.z;
  float ang = h2 * 6.28318530718 + p0.w * (length(pp - lwh * 0.5) / max(1.0, lwh.x * 0.5));
  vec2 d = vec2(cos(ang), sin(ang)) * (h1 * amt) + p1.xy * amt / 100.0;
  frag = samplePx(pp - d, lwh);`);

// ── Radial Fast Blur ─────────────────────────────────────────────────────────

/** p0 = lw, lh, cx, cy; p1 = amount (0..0.8), mode (0 standard · 1 bright · 2 dark). 16 taps toward the centre. */
export const RADIAL_FAST_BLUR_FX = fx('radial-fast-blur', 2,
  `${wp(0)}
  let x = floor(pp);
  let v = obj.p0.zw - x;
  var acc = vec4<f32>(0.0); var tw = 0.0;
  for (var k = 0; k < 16; k = k + 1) {
    let fr = (f32(k) / 16.0) * obj.p1.x;
    let sp = clamp(round(x + v * fr), vec2<f32>(0.0), lwh - 1.0) + 0.5;
    let t = tapStraight(sp, lwh, true);
    var wgt = 1.0 - (f32(k) / 16.0) * 0.5;
    let lum = (t.r + t.g + t.b) / 3.0;
    if (obj.p1.y > 1.5) { wgt = wgt * (1.0 + (1.0 - lum) * 2.0); } else if (obj.p1.y > 0.5) { wgt = wgt * (1.0 + lum * 2.0); }
    acc = acc + t * wgt; tw = tw + wgt;
  }
  return premul(acc / tw);`,
  `${gp(0)}
  vec2 x = floor(pp);
  vec2 v = p0.zw - x;
  vec4 acc = vec4(0.0); float tw = 0.0;
  for (int k = 0; k < 16; k++) {
    float fr = (float(k) / 16.0) * p1.x;
    vec2 sp = clamp(round(x + v * fr), vec2(0.0), lwh - 1.0) + 0.5;
    vec4 t = tapStraight(sp, lwh, true);
    float wgt = 1.0 - (float(k) / 16.0) * 0.5;
    float lum = (t.r + t.g + t.b) / 3.0;
    if (p1.y > 1.5) wgt *= 1.0 + (1.0 - lum) * 2.0; else if (p1.y > 0.5) wgt *= 1.0 + lum * 2.0;
    acc += t * wgt; tw += wgt;
  }
  frag = premul(acc / tw);`);

// ── Scale Wipe ───────────────────────────────────────────────────────────────

/** p0 = lw, lh, cx, cy; p1 = ux, uy, wipe edge, stretch; p2 = max distance. */
export const SCALE_WIPE_FX = fx('scale-wipe', 3,
  `${wp(0)}
  let d = pp - obj.p0.zw; let u2 = obj.p1.xy;
  let proj = dot(d, u2);
  if (proj > obj.p1.z) { return s0; }
  let scale = 1.0 + (obj.p1.w * (obj.p1.z - proj)) / obj.p2.x;
  return samplePx(obj.p0.zw + (d - u2 * proj) + u2 * (proj / scale), lwh);`,
  `${gp(0)}
  vec2 d = pp - p0.zw; vec2 u2 = p1.xy;
  float proj = dot(d, u2);
  if (proj > p1.z) { frag = s0; return; }
  float scale = 1.0 + (p1.w * (p1.z - proj)) / p2.x;
  frag = samplePx(p0.zw + (d - u2 * proj) + u2 * (proj / scale), lwh);`);

// ── Plastic (field) ──────────────────────────────────────────────────────────

/** tex2 = blurred luma field. p0 = lw, lh, bump, gain; p1 = light direction (unit), specular gain. */
export const PLASTIC_FX = fxField('plastic', 2,
  `${wp(0)}
  if (s0.a <= 0.0) { return vec4<f32>(0.0); }
  let g = gradPx(pp, lwh, false) * obj.p0.z;
  let nrm = normalize(vec3<f32>(-g.x, -g.y, 1.0));
  let L = obj.p1.xyz;
  let diff = max(0.0, dot(nrm, L));
  let hv = normalize(vec3<f32>(L.x, L.y, L.z + 1.0));
  let spec = pow(max(0.0, dot(nrm, hv)), 16.0) * obj.p1.w;
  let c = decodeS(s0);
  return encodeOut(c.rgb * (diff * obj.p0.w + 0.3) + spec, c.a);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = vec4(0.0); return; }
  vec2 g = gradPx(pp, lwh, false) * p0.z;
  vec3 nrm = normalize(vec3(-g.x, -g.y, 1.0));
  vec3 L = p1.xyz;
  float diff = max(0.0, dot(nrm, L));
  vec3 hv = normalize(vec3(L.x, L.y, L.z + 1.0));
  float spec = pow(max(0.0, dot(nrm, hv)), 16.0) * p1.w;
  vec4 c = decodeS(s0);
  frag = encodeOut(c.rgb * (diff * p0.w + 0.3) + spec, c.a);`);

// ── Glass (field) ────────────────────────────────────────────────────────────

/** tex2 = blurred luma field. p0 = lw, lh, height·displacement, height; p1 = light x, light y, gain, shininess. */
export const GLASS_FX = fxField('glass-fx', 2,
  `${wp(0)}
  let g = gradPx(pp, lwh, true);
  let sm = samplePx(pp + g * obj.p0.z, lwh);
  if (sm.a <= 0.0) { return vec4<f32>(0.0); }
  let facing = (-g.x * obj.p1.x - g.y * obj.p1.y) * obj.p0.w;
  let f2 = clamp(facing * 0.02, 0.0, 1.0);
  let c = decodeS(sm);
  return encodeOut(c.rgb * (1.0 + obj.p1.z * facing * 0.04) + obj.p1.w * obj.p1.z * f2 * f2, c.a);`,
  `${gp(0)}
  vec2 g = gradPx(pp, lwh, true);
  vec4 sm = samplePx(pp + g * p0.z, lwh);
  if (sm.a <= 0.0) { frag = vec4(0.0); return; }
  float facing = (-g.x * p1.x - g.y * p1.y) * p0.w;
  float f2 = clamp(facing * 0.02, 0.0, 1.0);
  vec4 c = decodeS(sm);
  frag = encodeOut(c.rgb * (1.0 + p1.z * facing * 0.04) + p1.w * p1.z * f2 * f2, c.a);`);

// ── Texturize ────────────────────────────────────────────────────────────────

const TEX_WGSL = `fn texPattern(pattern : i32, x : f32, y : f32, s : f32) -> f32 {
  let u = x * s; let v = y * s;
  if (pattern == 0) {
    let xi = i32(floor(u / 4.0)); let yi = i32(floor(v / 4.0));
    let fx = u / 4.0 - f32(xi); let fy = v / 4.0 - f32(yi);
    let a = hash2u(xi, yi * 733); let b = hash2u(xi + 1, yi * 733);
    let c = hash2u(xi, (yi + 1) * 733); let d = hash2u(xi + 1, (yi + 1) * 733);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  if (pattern == 2) { return 0.5 + 0.25 * sin(u * 0.9) + 0.25 * sin(v * 0.9); }
  if (pattern == 3) {
    let row = i32(floor(v / 8.0));
    let uu = u + select(8.0, 0.0, (row & 1) == 0);
    let bx = fract(uu / 16.0) * 16.0; let by = fract(v / 8.0) * 8.0;
    return select(0.7, 0.0, bx < 1.0 || by < 1.0);
  }
  let weave = 0.30 * sin(u * 3.7) * sin(v * 3.9);
  let grit = 0.18 * (hash2u(i32(floor(u * 2.0)), i32(floor(v * 2.0)) * 977) - 0.5);
  return 0.5 + weave + grit;
}
`;
const TEX_GLSL = `float texPattern(int pattern, float x, float y, float s) {
  float u = x * s; float v = y * s;
  if (pattern == 0) {
    int xi = int(floor(u / 4.0)); int yi = int(floor(v / 4.0));
    float fx = u / 4.0 - float(xi); float fy = v / 4.0 - float(yi);
    float a = hash2u(xi, yi * 733); float b = hash2u(xi + 1, yi * 733);
    float c = hash2u(xi, (yi + 1) * 733); float d = hash2u(xi + 1, (yi + 1) * 733);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  if (pattern == 2) return 0.5 + 0.25 * sin(u * 0.9) + 0.25 * sin(v * 0.9);
  if (pattern == 3) {
    int row = int(floor(v / 8.0));
    float uu = u + (((row & 1) == 0) ? 0.0 : 8.0);
    float bx = fract(uu / 16.0) * 16.0; float by = fract(v / 8.0) * 8.0;
    return (bx < 1.0 || by < 1.0) ? 0.0 : 0.7;
  }
  float weave = 0.30 * sin(u * 3.7) * sin(v * 3.9);
  float grit = 0.18 * (hash2u(int(floor(u * 2.0)), int(floor(v * 2.0)) * 977) - 0.5);
  return 0.5 + weave + grit;
}
`;

/** p0 = lw, lh, pattern, contrast gain; p1 = light x, light y, 100/scale. Two pattern taps a light-step apart, as `texturizeData`. */
export const TEXTURIZE_FX = withHelpers(fx('texturize', 2,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let x = floor(pp.x); let y = floor(pp.y);
  let pat = i32(obj.p0.z + 0.5);
  let t0 = texPattern(pat, x - obj.p1.x, y - obj.p1.y, obj.p1.z);
  let t1 = texPattern(pat, x + obj.p1.x, y + obj.p1.y, obj.p1.z);
  let c = decodeS(s0);
  return encodeOut(c.rgb * (1.0 + obj.p0.w * (t1 - t0)), c.a);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  float x = floor(pp.x); float y = floor(pp.y);
  int pat = int(p0.z + 0.5);
  float t0 = texPattern(pat, x - p1.x, y - p1.y, p1.z);
  float t1 = texPattern(pat, x + p1.x, y + p1.y, p1.z);
  vec4 c = decodeS(s0);
  frag = encodeOut(c.rgb * (1.0 + p0.w * (t1 - t0)), c.a);`), TEX_WGSL, TEX_GLSL);

// ── Threads ──────────────────────────────────────────────────────────────────

/** p0 = lw, lh, thickness, period; p1 = depth 0..1. The weave of `threadsData`; gaps are transparent. */
export const THREADS_FX = fx('threads', 2,
  `${wp(0)}
  let x = i32(floor(pp.x)); let y = i32(floor(pp.y));
  let th = i32(obj.p0.z + 0.5); let period = i32(obj.p0.w + 0.5);
  let mx = x % period; let my = y % period;
  let inH = my < th; let inV = mx < th;
  if (!inH && !inV) { return vec4<f32>(0.0); }
  let vOnTop = ((x / period + y / period) & 1) == 0;
  let showV = inV && (vOnTop || !inH);
  let across = select(my, mx, showV);
  var shade = 0.55 + 0.45 * sin(((f32(across) + 0.5) / f32(th)) * 3.14159265359);
  if (inH && inV && obj.p1.x > 0.0) {
    let under = select(mx, my, showV);
    if (f32(min(under, th - 1 - under)) < 1.5) { shade = shade * (1.0 - obj.p1.x * 0.6); }
  }
  let c = decodeS(s0);
  return encodeOut(c.rgb * shade, c.a);`,
  `${gp(0)}
  int x = int(floor(pp.x)); int y = int(floor(pp.y));
  int th = int(p0.z + 0.5); int period = int(p0.w + 0.5);
  int mx = x % period; int my = y % period;
  bool inH = my < th; bool inV = mx < th;
  if (!inH && !inV) { frag = vec4(0.0); return; }
  bool vOnTop = ((x / period + y / period) & 1) == 0;
  bool showV = inV && (vOnTop || !inH);
  int across = showV ? mx : my;
  float shade = 0.55 + 0.45 * sin(((float(across) + 0.5) / float(th)) * 3.14159265359);
  if (inH && inV && p1.x > 0.0) {
    int under = showV ? my : mx;
    if (float(min(under, th - 1 - under)) < 1.5) shade *= 1.0 - p1.x * 0.6;
  }
  vec4 c = decodeS(s0);
  frag = encodeOut(c.rgb * shade, c.a);`);

// ── Hex Tile ─────────────────────────────────────────────────────────────────

/** p0 = lw, lh, radius, border 0..1. Nearest of the 3×3 candidate hex centres, sampled at its centre, darkened toward the border. */
export const HEX_TILE_FX = fx('hex-tile', 1,
  `${wp(0)}
  let R = obj.p0.z; let hexW = R * 1.5; let hexH = R * 1.73205080757;
  let x = floor(pp.x); let y = floor(pp.y);
  let col = i32(round(x / hexW));
  var best = 1e30; var bc = vec2<f32>(0.0);
  for (var dc = -1; dc <= 1; dc = dc + 1) {
    let c = col + dc;
    let ccx = f32(c) * hexW;
    let off = select(hexH * 0.5, 0.0, (c & 1) == 0);
    let row = round((y - off) / hexH);
    for (var dr = -1; dr <= 1; dr = dr + 1) {
      let ccy = (row + f32(dr)) * hexH + off;
      let d = (x - ccx) * (x - ccx) + (y - ccy) * (y - ccy);
      if (d < best) { best = d; bc = vec2<f32>(ccx, ccy); }
    }
  }
  let sm = samplePx(clamp(round(bc), vec2<f32>(0.0), lwh - 1.0) + 0.5, lwh);
  let bd = obj.p0.w;
  if (bd <= 0.0) { return sm; }
  let edge = clamp((sqrt(best) - (hexH * 0.5 - max(1.0, R * 0.12) - bd * R * 0.3)) / max(1.0, R * 0.12), 0.0, 1.0);
  let c2 = decodeS(sm);
  return encodeOut(c2.rgb * (1.0 - bd * edge), c2.a);`,
  `${gp(0)}
  float R = p0.z; float hexW = R * 1.5; float hexH = R * 1.73205080757;
  float x = floor(pp.x); float y = floor(pp.y);
  int col = int(round(x / hexW));
  float best = 1e30; vec2 bc = vec2(0.0);
  for (int dc = -1; dc <= 1; dc++) {
    int c = col + dc;
    float ccx = float(c) * hexW;
    float off = ((c & 1) == 0) ? 0.0 : hexH * 0.5;
    float row = round((y - off) / hexH);
    for (int dr = -1; dr <= 1; dr++) {
      float ccy = (row + float(dr)) * hexH + off;
      float d = (x - ccx) * (x - ccx) + (y - ccy) * (y - ccy);
      if (d < best) { best = d; bc = vec2(ccx, ccy); }
    }
  }
  vec4 sm = samplePx(clamp(round(bc), vec2(0.0), lwh - 1.0) + 0.5, lwh);
  float bd = p0.w;
  if (bd <= 0.0) { frag = sm; return; }
  float edge = clamp((sqrt(best) - (hexH * 0.5 - max(1.0, R * 0.12) - bd * R * 0.3)) / max(1.0, R * 0.12), 0.0, 1.0);
  vec4 c2 = decodeS(sm);
  frag = encodeOut(c2.rgb * (1.0 - bd * edge), c2.a);`);

// ── Vector Blur (field) ──────────────────────────────────────────────────────

/** tex2 = blurred luma field. p0 = lw, lh, amount, K; p1 = cos, sin (angle offset), step. Averages 2K+1 straight taps along the rotated tangent. */
export const VECTOR_BLUR_FX = fxField('vector-blur', 2,
  `${wp(0)}
  let g = gradPx(pp, lwh, true);
  let mag = length(g);
  if (mag <= 0.0001) { return s0; }
  let tx = -g.y / mag; let ty = g.x / mag;
  let f = vec2<f32>(tx * obj.p1.x - ty * obj.p1.y, tx * obj.p1.y + ty * obj.p1.x);
  let K = i32(obj.p0.w + 0.5);
  let x = floor(pp);
  var acc = vec4<f32>(0.0); var cnt = 0.0;
  for (var k = -24; k <= 24; k = k + 1) {
    if (k < -K || k > K) { continue; }
    let sp = round(x + f * (f32(k) * obj.p1.z));
    if (sp.x < 0.0 || sp.x >= lwh.x || sp.y < 0.0 || sp.y >= lwh.y) { continue; }
    acc = acc + tapStraight(sp + 0.5, lwh, false); cnt = cnt + 1.0;
  }
  if (cnt <= 0.0) { return vec4<f32>(0.0); }
  return premul(acc / cnt);`,
  `${gp(0)}
  vec2 g = gradPx(pp, lwh, true);
  float mag = length(g);
  if (mag <= 0.0001) { frag = s0; return; }
  float tx = -g.y / mag; float ty = g.x / mag;
  vec2 f = vec2(tx * p1.x - ty * p1.y, tx * p1.y + ty * p1.x);
  int K = int(p0.w + 0.5);
  vec2 x = floor(pp);
  vec4 acc = vec4(0.0); float cnt = 0.0;
  for (int k = -24; k <= 24; k++) {
    if (k < -K || k > K) continue;
    vec2 sp = round(x + f * (float(k) * p1.z));
    if (sp.x < 0.0 || sp.x >= lwh.x || sp.y < 0.0 || sp.y >= lwh.y) continue;
    acc += tapStraight(sp + 0.5, lwh, false); cnt += 1.0;
  }
  if (cnt <= 0.0) { frag = vec4(0.0); return; }
  frag = premul(acc / cnt);`);

export const FX_ROUND_ELEVEN_SHADERS: readonly ShaderSource[] = [
  POLAR_COORDINATES_FX, OPTICS_COMPENSATION_FX, WARP_FX, PAGE_TURN_FX, SPLIT_FX, SLANT_FX, SMEAR_FX, ROLLING_SHUTTER_FX,
  RADIAL_SHADOW_PROJECT_FX, RADIAL_SHADOW_FX, FLO_MOTION_FX, LENS_FX, GRIDDLER_FX, BALL_ACTION_FX, DRIZZLE_FX,
  JAWS_FX, PIXEL_POLLY_FX, TWISTER_FX, CARD_DANCE_FX, UNMULT_FX, CC_COMPOSITE_FX, CC_SCATTERIZE_FX, RADIAL_FAST_BLUR_FX,
  SCALE_WIPE_FX, PLASTIC_FX, GLASS_FX, TEXTURIZE_FX, THREADS_FX, HEX_TILE_FX, VECTOR_BLUR_FX,
];
