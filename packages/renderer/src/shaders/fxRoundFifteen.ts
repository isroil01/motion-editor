/**
 * Round seven's fifteen shaders — the GPU half of `src/core/effects/aeRoundSeven*.ts`.
 *
 * The CPU kernels are the REFERENCE and these are transliterations of them, not
 * independent implementations. Where the two could differ they are written to
 * differ in one direction only: the shader may be coarser (a bounded loop where
 * the kernel iterates freely), never differently shaped.
 *
 * Conventions inherited from `fxRoundEleven.ts`, whose helpers this file
 * imports rather than restates:
 *   • all geometry in LAYER PIXELS, with `lw`/`lh` riding in a param slot, so
 *     each fragment mirrors its kernel's px-space arithmetic exactly;
 *   • `wp(k)` / `gp(k)` open a shader that needs geometry — they bind `lwh`,
 *     the fragment's layer-px position `pp`, and `s0`, and pass through
 *     outside the layer box;
 *   • pure resamples skip the sRGB decode, since moving a pixel is colour-space
 *     agnostic; anything doing colour arithmetic decodes with `decodeS` and
 *     re-encodes with `encodeOut`, because the kernels do byte maths in
 *     display sRGB;
 *   • every texture read is `textureSampleLevel` / `textureLod` — these sample
 *     inside non-uniform control flow, where implicit derivatives are illegal
 *     in WGSL and undefined in GLSL.
 *
 * Three round-seven effects have no shader here on purpose: CC Color Offset,
 * CC Threshold RGB and Cineon Converter are per-channel transfers and live in
 * `LUT_BUILDERS`, which renders them on both backends through the LUT strip.
 *
 * ── The loop budget ──────────────────────────────────────────────────────────
 *
 * Four of these loop per fragment (Fractal, Particle Systems, Bubbles, and
 * Block Load's scan search). Every loop has a COMPILE-TIME bound with a runtime
 * `break`, never a bound read from a uniform: an unbounded per-fragment loop is
 * not a slow frame but a hung device, and a hung device on a preview scrub is
 * indistinguishable to the user from the app crashing.
 */

import type { ShaderSource } from './builtin';
import { fxShader } from './fxRoundSix';
import { withHelpers } from './fxRoundEight';
import { BASE_GLSL, BASE_WGSL, gp, wp } from './fxRoundEleven';

/** `fx` from round eleven, restated here so this file owns its own helper set. */
const fx = (name: string, vec4s: number, wgsl: string, glsl: string): ShaderSource =>
  withHelpers(fxShader(name, vec4s, wgsl, glsl), BASE_WGSL, BASE_GLSL);

/**
 * RGB ↔ HLS, matching `colorSpace.rgbToHsl` / `hslToRgb` including its hue unit
 * (0..1, not degrees) — Noise HLS is the only member that needs it, and it
 * needs both directions.
 */
const HSL_WGSL = `fn rgb2hsl(c : vec3<f32>) -> vec3<f32> {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let l = (mx + mn) * 0.5;
  if (mx == mn) { return vec3<f32>(0.0, 0.0, l); }
  let d = mx - mn;
  let s = select(d / (2.0 - mx - mn), d / (mx + mn), l < 0.5);
  var h : f32;
  if (mx == c.r) { h = ((c.g - c.b) / d + select(0.0, 6.0, c.g < c.b)) / 6.0; }
  else if (mx == c.g) { h = ((c.b - c.r) / d + 2.0) / 6.0; }
  else { h = ((c.r - c.g) / d + 4.0) / 6.0; }
  return vec3<f32>(h, s, l);
}
fn hue2c(p : f32, q : f32, tIn : f32) -> f32 {
  var t = tIn;
  if (t < 0.0) { t = t + 1.0; }
  if (t > 1.0) { t = t - 1.0; }
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 0.5) { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}
fn hsl2rgb(hsl : vec3<f32>) -> vec3<f32> {
  if (hsl.y == 0.0) { return vec3<f32>(hsl.z); }
  let q = select(hsl.z + hsl.y - hsl.z * hsl.y, hsl.z * (1.0 + hsl.y), hsl.z < 0.5);
  let p = 2.0 * hsl.z - q;
  return vec3<f32>(
    hue2c(p, q, hsl.x + 1.0 / 3.0),
    hue2c(p, q, hsl.x),
    hue2c(p, q, hsl.x - 1.0 / 3.0),
  );
}
`;
const HSL_GLSL = `vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = (l < 0.5) ? d / (mx + mn) : d / (2.0 - mx - mn);
  float h;
  if (mx == c.r) h = ((c.g - c.b) / d + ((c.g < c.b) ? 6.0 : 0.0)) / 6.0;
  else if (mx == c.g) h = ((c.b - c.r) / d + 2.0) / 6.0;
  else h = ((c.r - c.g) / d + 4.0) / 6.0;
  return vec3(h, s, l);
}
float hue2c(float p, float q, float tIn) {
  float t = tIn;
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = (hsl.z < 0.5) ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(hue2c(p, q, hsl.x + 1.0 / 3.0), hue2c(p, q, hsl.x), hue2c(p, q, hsl.x - 1.0 / 3.0));
}
`;

// ── CC Tiler ─────────────────────────────────────────────────────────────────

/** p0 = lw, lh, 1/scale factor, blend; p1 = cx, cy. Inverse map, wrapped. */
export const CC_TILER_FX = fx('cc-tiler', 2,
  `${wp(0)}
  let c = obj.p1.xy;
  let sp = vec2<f32>(
    (((pp.x - c.x) / obj.p0.z + c.x) % lwh.x + lwh.x) % lwh.x,
    (((pp.y - c.y) / obj.p0.z + c.y) % lwh.y + lwh.y) % lwh.y,
  );
  let tiled = samplePx(sp, lwh);
  return mix(tiled, s0, obj.p0.w);`,
  `${gp(0)}
  vec2 c = p1.xy;
  vec2 sp = vec2(
    mod(mod((pp.x - c.x) / p0.z + c.x, lwh.x) + lwh.x, lwh.x),
    mod(mod((pp.y - c.y) / p0.z + c.y, lwh.y) + lwh.y, lwh.y)
  );
  vec4 tiled = samplePx(sp, lwh);
  frag = mix(tiled, s0, p0.w);`);

// ── CC Ripple Pulse ──────────────────────────────────────────────────────────

/**
 * p0 = lw, lh, cx, cy; p1 = pulse radius, amplitude, band width, render bump.
 * The shading term is the derivative of the displacement, which is what makes
 * the ring visible on a flat-coloured layer — see the kernel's note.
 */
export const RIPPLE_PULSE_FX = fx('ripple-pulse', 2,
  `${wp(0)}
  let d2 = pp - obj.p0.zw;
  let r = length(d2);
  let dd = r - obj.p1.x;
  if (abs(dd) >= obj.p1.z || r < 0.0001) { return s0; }
  let disp = obj.p1.y * sin(3.14159265359 * dd / obj.p1.z);
  var col = samplePx(pp - (d2 / r) * disp, lwh);
  if (obj.p1.w > 0.5) {
    let slope = cos(3.14159265359 * dd / obj.p1.z) * (obj.p1.y / obj.p1.z);
    let lit = clamp(1.0 + slope * 0.5, 0.0, 1.0);
    let sc = decodeS(col);
    col = encodeOut(sc.rgb * lit, sc.a);
  }
  return col;`,
  `${gp(0)}
  vec2 d2 = pp - p0.zw;
  float r = length(d2);
  float dd = r - p1.x;
  if (abs(dd) >= p1.z || r < 0.0001) { frag = s0; return; }
  float disp = p1.y * sin(3.14159265359 * dd / p1.z);
  vec4 col = samplePx(pp - (d2 / r) * disp, lwh);
  if (p1.w > 0.5) {
    float slope = cos(3.14159265359 * dd / p1.z) * (p1.y / p1.z);
    float lit = clamp(1.0 + slope * 0.5, 0.0, 1.0);
    vec4 sc = decodeS(col);
    col = encodeOut(sc.rgb * lit, sc.a);
  }
  frag = col;`);

// ── CC Radial ScaleWipe ──────────────────────────────────────────────────────

/** p0 = lw, lh, cx, cy; p1 = scale factor, alpha fade. */
export const RADIAL_SCALE_WIPE_FX = fx('radial-scale-wipe', 2,
  `${wp(0)}
  let sp = (pp - obj.p0.zw) * obj.p1.x + obj.p0.zw;
  let c = samplePx(sp, lwh);
  return c * obj.p1.y;`,
  `${gp(0)}
  vec2 sp = (pp - p0.zw) * p1.x + p0.zw;
  vec4 c = samplePx(sp, lwh);
  frag = c * p1.y;`);

// ── CC Glass Wipe ────────────────────────────────────────────────────────────

/**
 * p0 = lw, lh, completion 0..1, band; p1 = displacement.
 *
 * The luminance gradient is read from the SOURCE at integer neighbours, exactly
 * as the kernel does, so the displacement of a fragment never depends on
 * another fragment's result.
 */
export const GLASS_WIPE_FX = fx('glass-wipe', 2,
  `${wp(0)}
  let xi = floor(pp);
  let l = lum709(straightSrgbPx(xi + 0.5, lwh).rgb);
  let edge = clamp((obj.p0.z * (1.0 + obj.p0.w) - obj.p0.w * 0.5 - l) / obj.p0.w, 0.0, 1.0);
  var col = s0;
  if (edge > 0.0 && edge < 1.0) {
    let gx = lum709(straightSrgbPx(xi + vec2<f32>(1.5, 0.5), lwh).rgb)
      - lum709(straightSrgbPx(xi + vec2<f32>(-0.5, 0.5), lwh).rgb);
    let gy = lum709(straightSrgbPx(xi + vec2<f32>(0.5, 1.5), lwh).rgb)
      - lum709(straightSrgbPx(xi + vec2<f32>(0.5, -0.5), lwh).rgb);
    let k = obj.p1.x * sin(3.14159265359 * edge);
    col = samplePx(pp + vec2<f32>(gx, gy) * k, lwh);
  }
  return col * (1.0 - edge);`,
  `${gp(0)}
  vec2 xi = floor(pp);
  float l = lum709(straightSrgbPx(xi + 0.5, lwh).rgb);
  float edge = clamp((p0.z * (1.0 + p0.w) - p0.w * 0.5 - l) / p0.w, 0.0, 1.0);
  vec4 col = s0;
  if (edge > 0.0 && edge < 1.0) {
    float gx = lum709(straightSrgbPx(xi + vec2(1.5, 0.5), lwh).rgb)
      - lum709(straightSrgbPx(xi + vec2(-0.5, 0.5), lwh).rgb);
    float gy = lum709(straightSrgbPx(xi + vec2(0.5, 1.5), lwh).rgb)
      - lum709(straightSrgbPx(xi + vec2(0.5, -0.5), lwh).rgb);
    float k = p1.x * sin(3.14159265359 * edge);
    col = samplePx(pp + vec2(gx, gy) * k, lwh);
  }
  frag = col * (1.0 - edge);`);

// ── CC Image Wipe ────────────────────────────────────────────────────────────

/** p0 = lw, lh, threshold, band; p1 = channel (0..4), invert. Alpha only. */
export const IMAGE_WIPE_FX = fx('image-wipe', 2,
  `${wp(0)}
  let c = decodeS(s0);
  let ch = i32(obj.p1.x + 0.5);
  var v = lum709(c.rgb);
  if (ch == 1) { v = c.a; }
  else if (ch == 2) { v = c.r; }
  else if (ch == 3) { v = c.g; }
  else if (ch == 4) { v = c.b; }
  if (obj.p1.y > 0.5) { v = 1.0 - v; }
  let e = smoothstep(obj.p0.z - obj.p0.w, obj.p0.z + obj.p0.w, v);
  return encodeOut(c.rgb, c.a * (1.0 - e));`,
  `${gp(0)}
  vec4 c = decodeS(s0);
  int ch = int(p1.x + 0.5);
  float v = lum709(c.rgb);
  if (ch == 1) v = c.a;
  else if (ch == 2) v = c.r;
  else if (ch == 3) v = c.g;
  else if (ch == 4) v = c.b;
  if (p1.y > 0.5) v = 1.0 - v;
  float e = smoothstep(p0.z - p0.w, p0.z + p0.w, v);
  frag = encodeOut(c.rgb, c.a * (1.0 - e));`);

// ── Color Difference Key ─────────────────────────────────────────────────────

/**
 * p0 = key unit vector (xyz), key channel index; p1 = matte black, 1/span,
 * 1/gamma, view mode.
 */
export const COLOR_DIFFERENCE_KEY_FX = fx('color-difference-key', 2,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  let c = decodeS(s);
  let along = dot(c.rgb, obj.p0.xyz);
  let mag = length(c.rgb);
  let partialA = select(clamp(along / mag, 0.0, 1.0), 0.0, mag < 0.0001);
  let ki = i32(obj.p0.w + 0.5);
  var keyChan = c.r; var otherMax = max(c.g, c.b);
  if (ki == 1) { keyChan = c.g; otherMax = max(c.r, c.b); }
  else if (ki == 2) { keyChan = c.b; otherMax = max(c.r, c.g); }
  let partialB = clamp(keyChan - otherMax, 0.0, 1.0);
  let backness = clamp(partialA * partialA * (partialB * 2.0), 0.0, 1.0);
  var matte = clamp((1.0 - backness - obj.p1.x) * obj.p1.y, 0.0, 1.0);
  matte = pow(matte, obj.p1.z);
  if (obj.p1.w > 0.5) { return encodeOut(vec3<f32>(matte), 1.0); }
  return encodeOut(c.rgb, c.a * matte);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  vec4 c = decodeS(s);
  float along = dot(c.rgb, p0.xyz);
  float mag = length(c.rgb);
  float partialA = (mag < 0.0001) ? 0.0 : clamp(along / mag, 0.0, 1.0);
  int ki = int(p0.w + 0.5);
  float keyChan = c.r; float otherMax = max(c.g, c.b);
  if (ki == 1) { keyChan = c.g; otherMax = max(c.r, c.b); }
  else if (ki == 2) { keyChan = c.b; otherMax = max(c.r, c.g); }
  float partialB = clamp(keyChan - otherMax, 0.0, 1.0);
  float backness = clamp(partialA * partialA * (partialB * 2.0), 0.0, 1.0);
  float matte = clamp((1.0 - backness - p1.x) * p1.y, 0.0, 1.0);
  matte = pow(matte, p1.z);
  if (p1.w > 0.5) { frag = encodeOut(vec3(matte), 1.0); return; }
  frag = encodeOut(c.rgb, c.a * matte);`);

// ── CC Simple Wire Removal ───────────────────────────────────────────────────

/** p0 = lw, lh, ax, ay; p1 = tx, ty, length, half thickness; p2 = reach, thickness. */
export const WIRE_REMOVAL_FX = fx('wire-removal', 3,
  `${wp(0)}
  let rel = pp - obj.p0.zw;
  let t = obj.p1.xy;
  let n = vec2<f32>(-t.y, t.x);
  let along = dot(rel, t);
  if (along < 0.0 || along > obj.p1.z) { return s0; }
  let across = dot(rel, n);
  if (abs(across) > obj.p1.w) { return s0; }
  let base = obj.p0.zw + t * along;
  let s1 = tapStraight(base + n * obj.p2.x, lwh, true);
  let s2 = tapStraight(base - n * obj.p2.x, lwh, true);
  let f = clamp((across + obj.p1.w) / max(0.0001, obj.p2.y), 0.0, 1.0);
  return mix(s2, s1, f);`,
  `${gp(0)}
  vec2 rel = pp - p0.zw;
  vec2 t = p1.xy;
  vec2 n = vec2(-t.y, t.x);
  float along = dot(rel, t);
  if (along < 0.0 || along > p1.z) { frag = s0; return; }
  float across = dot(rel, n);
  if (abs(across) > p1.w) { frag = s0; return; }
  vec2 base = p0.zw + t * along;
  vec4 s1 = tapStraight(base + n * p2.x, lwh, true);
  vec4 s2 = tapStraight(base - n * p2.x, lwh, true);
  float f = clamp((across + p1.w) / max(0.0001, p2.y), 0.0, 1.0);
  frag = mix(s2, s1, f);`);

// ── Broadcast Colors ─────────────────────────────────────────────────────────

/** p0 = pedestal, gain, limit IRE, mode (0 luma · 1 sat · 2 key unsafe · 3 key safe). */
export const BROADCAST_COLORS_FX = fx('broadcast-colors', 1,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  let c = decodeS(s);
  let yLin = dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114));
  let u = 0.492 * (c.b - yLin);
  let v = 0.877 * (c.r - yLin);
  let chroma = length(vec2<f32>(u, v));
  let ire = obj.p0.x + yLin * obj.p0.y + chroma * obj.p0.y;
  let mode = i32(obj.p0.w + 0.5);
  let over = ire > obj.p0.z;
  if (mode == 2) { return select(s, vec4<f32>(0.0), over); }
  if (mode == 3) { return select(vec4<f32>(0.0), s, over); }
  if (!over) { return s; }
  let excess = ire - obj.p0.z;
  if (mode == 0) {
    let k = clamp(1.0 - excess / max(0.0001, yLin * obj.p0.y + chroma * obj.p0.y), 0.0, 1.0);
    return encodeOut(c.rgb * k, c.a);
  }
  let k2 = clamp(1.0 - excess / max(0.0001, chroma * obj.p0.y), 0.0, 1.0);
  return encodeOut(vec3<f32>(yLin) + (c.rgb - vec3<f32>(yLin)) * k2, c.a);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  vec4 c = decodeS(s);
  float yLin = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float u = 0.492 * (c.b - yLin);
  float v = 0.877 * (c.r - yLin);
  float chroma = length(vec2(u, v));
  float ire = p0.x + yLin * p0.y + chroma * p0.y;
  int mode = int(p0.w + 0.5);
  bool over = ire > p0.z;
  if (mode == 2) { frag = over ? vec4(0.0) : s; return; }
  if (mode == 3) { frag = over ? s : vec4(0.0); return; }
  if (!over) { frag = s; return; }
  float excess = ire - p0.z;
  if (mode == 0) {
    float k = clamp(1.0 - excess / max(0.0001, yLin * p0.y + chroma * p0.y), 0.0, 1.0);
    frag = encodeOut(c.rgb * k, c.a);
    return;
  }
  float k2 = clamp(1.0 - excess / max(0.0001, chroma * p0.y), 0.0, 1.0);
  frag = encodeOut(vec3(yLin) + (c.rgb - vec3(yLin)) * k2, c.a);`);

// ── Noise HLS ────────────────────────────────────────────────────────────────

/** p0 = lw, lh, grain cell, phase; p1 = hue, lightness, saturation, noise type. */
export const NOISE_HLS_FX = withHelpers(fx('noise-hls', 2,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let cx = i32(floor(pp.x / obj.p0.z));
  let cy = i32(floor(pp.y / obj.p0.z));
  let ph = i32(obj.p0.w);
  var nh = hash2u(cx + ph * 131, cy + ph * 17) * 2.0 - 1.0;
  var nl = hash2u(cy + ph * 71, cx + ph * 251) * 2.0 - 1.0;
  var ns = hash2u(cx * 7 + ph, cy * 13 + ph) * 2.0 - 1.0;
  if (obj.p1.w > 0.5) { nh = nh * abs(nh); nl = nl * abs(nl); ns = ns * abs(ns); }
  let c = decodeS(s0);
  var hsl = rgb2hsl(c.rgb);
  hsl.x = fract(hsl.x + nh * obj.p1.x + 1.0);
  hsl.y = clamp(hsl.y + ns * obj.p1.z, 0.0, 1.0);
  hsl.z = clamp(hsl.z + nl * obj.p1.y, 0.0, 1.0);
  return encodeOut(hsl2rgb(hsl), c.a);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  int cx = int(floor(pp.x / p0.z));
  int cy = int(floor(pp.y / p0.z));
  int ph = int(p0.w);
  float nh = hash2u(cx + ph * 131, cy + ph * 17) * 2.0 - 1.0;
  float nl = hash2u(cy + ph * 71, cx + ph * 251) * 2.0 - 1.0;
  float ns = hash2u(cx * 7 + ph, cy * 13 + ph) * 2.0 - 1.0;
  if (p1.w > 0.5) { nh *= abs(nh); nl *= abs(nl); ns *= abs(ns); }
  vec4 c = decodeS(s0);
  vec3 hsl = rgb2hsl(c.rgb);
  hsl.x = fract(hsl.x + nh * p1.x + 1.0);
  hsl.y = clamp(hsl.y + ns * p1.z, 0.0, 1.0);
  hsl.z = clamp(hsl.z + nl * p1.y, 0.0, 1.0);
  frag = encodeOut(hsl2rgb(hsl), c.a);`), HSL_WGSL, HSL_GLSL);

// ── CC Block Load ────────────────────────────────────────────────────────────

/** p0 = lw, lh, completion 0..1, scans; p1 = base block size. */
export const BLOCK_LOAD_FX = fx('block-load', 2,
  `${wp(0)}
  let rowFrac = select(pp.y / lwh.y, 0.0, lwh.y <= 1.0);
  let progress = obj.p0.z * (obj.p0.w + 1.0) - rowFrac;
  let scan = floor(progress);
  if (scan >= obj.p0.w) { return s0; }
  var size = obj.p1.x;
  if (scan >= 0.0) { size = max(1.0, floor(obj.p1.x / pow(2.0, scan) + 0.5)); }
  let bx = min(lwh.x - 1.0, floor(pp.x / size) * size + floor(size * 0.5));
  let by = min(lwh.y - 1.0, floor(pp.y / size) * size + floor(size * 0.5));
  return textureSampleLevel(tex, smp, layerUv(vec2<f32>(bx + 0.5, by + 0.5), lwh), 0.0);`,
  `${gp(0)}
  float rowFrac = (lwh.y <= 1.0) ? 0.0 : pp.y / lwh.y;
  float progress = p0.z * (p0.w + 1.0) - rowFrac;
  float scan = floor(progress);
  if (scan >= p0.w) { frag = s0; return; }
  float size = p1.x;
  if (scan >= 0.0) size = max(1.0, floor(p1.x / pow(2.0, scan) + 0.5));
  float bx = min(lwh.x - 1.0, floor(pp.x / size) * size + floor(size * 0.5));
  float by = min(lwh.y - 1.0, floor(pp.y / size) * size + floor(size * 0.5));
  frag = textureLod(uTex, layerUv(vec2(bx + 0.5, by + 0.5), lwh), 0.0);`);

// ── CC Kernel ────────────────────────────────────────────────────────────────

/** p0 = k00..k10; p1 = k11..k21; p2 = k22, divisor, offset; p3 = lw, lh. Alpha untouched. */
export const KERNEL_FX = fx('kernel', 4,
  `${wp(3)}
  var acc = vec3<f32>(0.0);
  let ks = array<f32, 9>(obj.p0.x, obj.p0.y, obj.p0.z, obj.p0.w, obj.p1.x, obj.p1.y, obj.p1.z, obj.p1.w, obj.p2.x);
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let sp = clamp(floor(pp) + vec2<f32>(f32(i), f32(j)), vec2<f32>(0.0), lwh - 1.0) + 0.5;
      let t = decodeS(textureSampleLevel(tex, smp, layerUv(sp, lwh), 0.0));
      acc = acc + t.rgb * ks[(j + 1) * 3 + (i + 1)];
    }
  }
  let c0 = decodeS(s0);
  return encodeOut(clamp(acc / obj.p2.y + vec3<f32>(obj.p2.z), vec3<f32>(0.0), vec3<f32>(1.0)), c0.a);`,
  `${gp(3)}
  vec3 acc = vec3(0.0);
  float ks[9];
  ks[0] = p0.x; ks[1] = p0.y; ks[2] = p0.z; ks[3] = p0.w; ks[4] = p1.x;
  ks[5] = p1.y; ks[6] = p1.z; ks[7] = p1.w; ks[8] = p2.x;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 sp = clamp(floor(pp) + vec2(float(i), float(j)), vec2(0.0), lwh - 1.0) + 0.5;
      vec4 t = decodeS(textureLod(uTex, layerUv(sp, lwh), 0.0));
      acc += t.rgb * ks[(j + 1) * 3 + (i + 1)];
    }
  }
  vec4 c0 = decodeS(s0);
  frag = encodeOut(clamp(acc / p2.y + vec3(p2.z), vec3(0.0), vec3(1.0)), c0.a);`);

// ── 3D Glasses ───────────────────────────────────────────────────────────────

/** p0 = lw, lh, convergence shift, view; p1 = balance. */
export const GLASSES_3D_FX = fx('3d-glasses', 2,
  // `halfW`, not `half`: reserved in GLSL ES — the shader failed to compile on WebGL2.
  `${wp(0)}
  let view = i32(obj.p0.w + 0.5);
  let sh = obj.p0.z;
  if (view == 4) {
    let halfW = lwh.x * 0.5;
    let srcX = select(((pp.x - halfW) / halfW) * lwh.x, (pp.x / halfW) * lwh.x, pp.x < halfW);
    let eye = select(sh * 0.5, -sh * 0.5, pp.x < halfW);
    return tapStraight(vec2<f32>(srcX + eye, pp.y), lwh, true);
  }
  let l = decodeS(tapStraight(vec2<f32>(pp.x - sh * 0.5, pp.y), lwh, true));
  let r = decodeS(tapStraight(vec2<f32>(pp.x + sh * 0.5, pp.y), lwh, true));
  if (view == 5) {
    let useLeft = (i32(floor(pp.y)) % 2) == 0;
    let c = select(r, l, useLeft);
    return encodeOut(c.rgb, c.a);
  }
  var rgb = vec3<f32>(l.r, r.g, r.b);
  if (view == 1) { rgb = vec3<f32>(l.r, r.g, 0.0); }
  else if (view == 2) { rgb = vec3<f32>(l.r, 0.0, r.b); }
  else if (view == 3) {
    let lLum = lum709(l.rgb);
    rgb = vec3<f32>(mix(l.r, lLum, obj.p1.x), r.g * obj.p1.x, r.b);
  }
  return encodeOut(rgb, max(l.a, r.a));`,
  `${gp(0)}
  int view = int(p0.w + 0.5);
  float sh = p0.z;
  if (view == 4) {
    float halfW = lwh.x * 0.5;
    float srcX = (pp.x < halfW) ? (pp.x / halfW) * lwh.x : ((pp.x - halfW) / halfW) * lwh.x;
    float eye = (pp.x < halfW) ? -sh * 0.5 : sh * 0.5;
    frag = tapStraight(vec2(srcX + eye, pp.y), lwh, true);
    return;
  }
  vec4 l = decodeS(tapStraight(vec2(pp.x - sh * 0.5, pp.y), lwh, true));
  vec4 r = decodeS(tapStraight(vec2(pp.x + sh * 0.5, pp.y), lwh, true));
  if (view == 5) {
    bool useLeft = (int(floor(pp.y)) - 2 * (int(floor(pp.y)) / 2)) == 0;
    vec4 c = useLeft ? l : r;
    frag = encodeOut(c.rgb, c.a);
    return;
  }
  vec3 rgb = vec3(l.r, r.g, r.b);
  if (view == 1) rgb = vec3(l.r, r.g, 0.0);
  else if (view == 2) rgb = vec3(l.r, 0.0, r.b);
  else if (view == 3) {
    float lLum = lum709(l.rgb);
    rgb = vec3(mix(l.r, lLum, p1.x), r.g * p1.x, r.b);
  }
  frag = encodeOut(rgb, max(l.a, r.a));`);

// ── Fractal ──────────────────────────────────────────────────────────────────

/**
 * p0 = lw, lh, set type, max iterations; p1 = centre x, centre y, px scale;
 * p2 = julia x, julia y, colour phase, colour cycles; p3 = inside colour.
 *
 * The iteration cap is a COMPILE-TIME 256 with a runtime break at the uniform's
 * value — the loop bound cannot come from a uniform.
 */
export const FRACTAL_FX = fx('fractal', 4,
  `${wp(0)}
  let pxy = (pp - lwh * 0.5) * obj.p1.z + obj.p1.xy;
  var zr = 0.0; var zi = 0.0; var cr = pxy.x; var ci = pxy.y;
  if (obj.p0.z > 0.5) { zr = pxy.x; zi = pxy.y; cr = obj.p2.x; ci = obj.p2.y; }
  var zr2 = zr * zr; var zi2 = zi * zi;
  var n = 0;
  let maxIter = i32(obj.p0.w + 0.5);
  for (var k = 0; k < 256; k = k + 1) {
    if (k >= maxIter || zr2 + zi2 > 256.0) { break; }
    zi = 2.0 * zr * zi + ci;
    zr = zr2 - zi2 + cr;
    zr2 = zr * zr; zi2 = zi * zi;
    n = n + 1;
  }
  if (n >= maxIter) { return encodeOut(obj.p3.xyz, 1.0); }
  let modulus = sqrt(zr2 + zi2);
  let smooth1 = f32(n) + 1.0 - log2(log2(max(modulus, 1.0001)));
  let hue = fract(obj.p2.z + (smooth1 / f32(maxIter)) * obj.p2.w + 1.0);
  let h6 = hue * 6.0;
  let f = fract(h6);
  let i6 = i32(floor(h6)) % 6;
  var rgb = vec3<f32>(1.0, f, 0.0);
  if (i6 == 1) { rgb = vec3<f32>(1.0 - f, 1.0, 0.0); }
  else if (i6 == 2) { rgb = vec3<f32>(0.0, 1.0, f); }
  else if (i6 == 3) { rgb = vec3<f32>(0.0, 1.0 - f, 1.0); }
  else if (i6 == 4) { rgb = vec3<f32>(f, 0.0, 1.0); }
  else if (i6 == 5) { rgb = vec3<f32>(1.0, 0.0, 1.0 - f); }
  return encodeOut(rgb, 1.0);`,
  `${gp(0)}
  vec2 pxy = (pp - lwh * 0.5) * p1.z + p1.xy;
  float zr = 0.0; float zi = 0.0; float cr = pxy.x; float ci = pxy.y;
  if (p0.z > 0.5) { zr = pxy.x; zi = pxy.y; cr = p2.x; ci = p2.y; }
  float zr2 = zr * zr; float zi2 = zi * zi;
  int n = 0;
  int maxIter = int(p0.w + 0.5);
  for (int k = 0; k < 256; k++) {
    if (k >= maxIter || zr2 + zi2 > 256.0) break;
    zi = 2.0 * zr * zi + ci;
    zr = zr2 - zi2 + cr;
    zr2 = zr * zr; zi2 = zi * zi;
    n++;
  }
  if (n >= maxIter) { frag = encodeOut(p3.xyz, 1.0); return; }
  float modulus = sqrt(zr2 + zi2);
  float smooth1 = float(n) + 1.0 - log2(log2(max(modulus, 1.0001)));
  float hue = fract(p2.z + (smooth1 / float(maxIter)) * p2.w + 1.0);
  float h6 = hue * 6.0;
  float f = fract(h6);
  int i6 = int(floor(h6)) - 6 * (int(floor(h6)) / 6);
  vec3 rgb = vec3(1.0, f, 0.0);
  if (i6 == 1) rgb = vec3(1.0 - f, 1.0, 0.0);
  else if (i6 == 2) rgb = vec3(0.0, 1.0, f);
  else if (i6 == 3) rgb = vec3(0.0, 1.0 - f, 1.0);
  else if (i6 == 4) rgb = vec3(f, 0.0, 1.0);
  else if (i6 == 5) rgb = vec3(1.0, 0.0, 1.0 - f);
  frag = encodeOut(rgb, 1.0);`);

// ── CC Particle Systems II ───────────────────────────────────────────────────

/**
 * p0 = lw, lh, time, birth rate; p1 = longevity, producer x/y, radius x;
 * p2 = radius y, animation, direction (rad), spread (rad);
 * p3 = velocity, velocity variation, gravity, resistance;
 * p4 = birth size, death size, size variation, opacity;
 * p5 = birth colour, blend; p6 = death colour, seed; p7 = first index, last index.
 *
 * A transliteration of `particleAt` — same hash, same trajectory, same sprite,
 * same compositing order. The alive window arrives already computed in p7 so
 * the shader never iterates past it.
 */
export const PARTICLE_SYSTEMS_FX = fx('particle-systems', 8,
  `${wp(0)}
  var res = s0;
  let first = i32(obj.p7.x + 0.5);
  let last = i32(obj.p7.y + 0.5);
  let rate = max(0.0001, obj.p0.w);
  let sd = i32(obj.p6.w);
  for (var k = 0; k < 512; k = k + 1) {
    let i = first + k;
    if (i > last) { break; }
    let jitter = hash2u(i, sd + 3) - 0.5;
    let birth = (f32(i) + jitter * 0.8) / rate;
    let age = obj.p0.z - birth;
    if (age < 0.0 || age > obj.p1.x) { continue; }
    let h1 = hash2u(i, sd);
    let h2 = hash2u(i, sd + 101);
    let h3 = hash2u(i, sd + 211);
    let h4 = hash2u(i, sd + 307);
    let a0 = h1 * 6.28318530718;
    let r0 = sqrt(h2);
    let x0 = obj.p1.y + cos(a0) * obj.p1.w * r0;
    let y0 = obj.p1.z + sin(a0) * obj.p2.x * r0;
    var dir = h3 * 6.28318530718;
    if (obj.p2.y > 0.5) { dir = obj.p2.z + (h3 - 0.5) * obj.p2.w; }
    let speed = obj.p3.x * (1.0 + (h4 - 0.5) * 2.0 * obj.p3.y);
    let vx = cos(dir) * speed;
    let vy = sin(dir) * speed;
    var px = x0 + vx * age;
    var py = y0 + vy * age;
    if (obj.p3.w > 0.0001) {
      let decay = (1.0 - exp(-obj.p3.w * age)) / obj.p3.w;
      px = x0 + vx * decay;
      py = y0 + vy * decay;
    }
    py = py + 0.5 * obj.p3.z * age * age;
    let lifeT = clamp(age / max(0.0001, obj.p1.x), 0.0, 1.0);
    let sizeVar = 1.0 + (hash2u(i, sd + 401) - 0.5) * 2.0 * obj.p4.z;
    let size = max(0.1, (obj.p4.x + (obj.p4.y - obj.p4.x) * lifeT) * sizeVar);
    let alpha = obj.p4.w * (1.0 - lifeT * lifeT);
    if (alpha <= 0.0) { continue; }
    let rad = size * 0.5;
    let d = length(pp - vec2<f32>(lwh.x * 0.5 + px, lwh.y * 0.5 + py));
    if (d > rad) { continue; }
    let t = d / max(0.0001, rad);
    let cover = select(0.5 + 0.5 * cos(((t - 0.6) / 0.4) * 3.14159265359), 1.0, t < 0.6);
    let a = clamp(alpha * cover, 0.0, 1.0);
    if (a <= 0.0) { continue; }
    let col = mix(obj.p5.xyz, obj.p6.xyz, lifeT);
    let cur = decodeS(res);
    if (obj.p5.w < 0.5) {
      res = encodeOut(min(vec3<f32>(1.0), cur.rgb + col * a), max(cur.a, a));
    } else {
      res = encodeOut(cur.rgb * (1.0 - a) + col * a, cur.a * (1.0 - a) + a);
    }
  }
  return res;`,
  `${gp(0)}
  vec4 res = s0;
  int first = int(p7.x + 0.5);
  int last = int(p7.y + 0.5);
  float rate = max(0.0001, p0.w);
  int sd = int(p6.w);
  for (int k = 0; k < 512; k++) {
    int i = first + k;
    if (i > last) break;
    float jitter = hash2u(i, sd + 3) - 0.5;
    float birth = (float(i) + jitter * 0.8) / rate;
    float age = p0.z - birth;
    if (age < 0.0 || age > p1.x) continue;
    float h1 = hash2u(i, sd);
    float h2 = hash2u(i, sd + 101);
    float h3 = hash2u(i, sd + 211);
    float h4 = hash2u(i, sd + 307);
    float a0 = h1 * 6.28318530718;
    float r0 = sqrt(h2);
    float x0 = p1.y + cos(a0) * p1.w * r0;
    float y0 = p1.z + sin(a0) * p2.x * r0;
    float dir = h3 * 6.28318530718;
    if (p2.y > 0.5) dir = p2.z + (h3 - 0.5) * p2.w;
    float speed = p3.x * (1.0 + (h4 - 0.5) * 2.0 * p3.y);
    float vx = cos(dir) * speed;
    float vy = sin(dir) * speed;
    float px = x0 + vx * age;
    float py = y0 + vy * age;
    if (p3.w > 0.0001) {
      float decay = (1.0 - exp(-p3.w * age)) / p3.w;
      px = x0 + vx * decay;
      py = y0 + vy * decay;
    }
    py += 0.5 * p3.z * age * age;
    float lifeT = clamp(age / max(0.0001, p1.x), 0.0, 1.0);
    float sizeVar = 1.0 + (hash2u(i, sd + 401) - 0.5) * 2.0 * p4.z;
    float size = max(0.1, (p4.x + (p4.y - p4.x) * lifeT) * sizeVar);
    float alpha = p4.w * (1.0 - lifeT * lifeT);
    if (alpha <= 0.0) continue;
    float rad = size * 0.5;
    float d = length(pp - vec2(lwh.x * 0.5 + px, lwh.y * 0.5 + py));
    if (d > rad) continue;
    float t = d / max(0.0001, rad);
    float cover = (t < 0.6) ? 1.0 : 0.5 + 0.5 * cos(((t - 0.6) / 0.4) * 3.14159265359);
    float a = clamp(alpha * cover, 0.0, 1.0);
    if (a <= 0.0) continue;
    vec3 col = mix(p5.xyz, p6.xyz, lifeT);
    vec4 cur = decodeS(res);
    if (p5.w < 0.5) {
      res = encodeOut(min(vec3(1.0), cur.rgb + col * a), max(cur.a, a));
    } else {
      res = encodeOut(cur.rgb * (1.0 - a) + col * a, cur.a * (1.0 - a) + a);
    }
  }
  frag = res;`);

// ── CC Bubbles ───────────────────────────────────────────────────────────────

/**
 * p0 = lw, lh, cell, cols; p1 = rows, count, speed, wobble amplitude;
 * p2 = wobble frequency, bubble size, size variation, shading;
 * p3 = colour, opacity; p4 = evolution, seed, wrap span.
 *
 * Like Snowfall, only the three columns that can reach this fragment are
 * visited, so the per-pixel cost is a small constant rather than the bubble
 * count.
 */
export const BUBBLES_FX = fx('cc-bubbles', 5,
  `${wp(0)}
  var res = s0;
  let cell = obj.p0.z;
  let cols = i32(obj.p0.w + 0.5);
  let rows = i32(obj.p1.x + 0.5);
  let count = i32(obj.p1.y + 0.5);
  let sd = i32(obj.p4.y);
  let ev = obj.p4.x;
  let span = obj.p4.z;
  let colF = i32(floor(pp.x / cell));
  for (var dc = -2; dc <= 2; dc = dc + 1) {
    let ci = ((colF + dc) % cols + cols) % cols;
    for (var row = 0; row < 64; row = row + 1) {
      if (row >= rows) { break; }
      let id = row * cols + ci;
      if (id >= count) { continue; }
      let speed = 0.5 + hash2u(id, sd + 23);
      let sizeVar = 1.0 + (hash2u(id, sd + 51) - 0.5) * 2.0 * obj.p2.z;
      let rad = max(0.5, (obj.p2.y * sizeVar) * 0.5);
      let x0 = (f32(ci) + hash2u(id, sd)) * cell;
      let y0 = (f32(row) + hash2u(id, sd + 11)) * cell;
      let rise = (ev / 100.0) * obj.p1.z * speed;
      let wob = sin(ev / 40.0 + f32(id) * 1.7) * obj.p1.w
        * (0.5 + 0.5 * sin(f32(id) + ev * obj.p2.x / 500.0));
      let px = x0 + wob;
      let py = ((y0 - rise) % span + span) % span - obj.p2.y;
      let dx = px - pp.x;
      let dy = py - pp.y;
      let d = length(vec2<f32>(dx, dy));
      if (d > rad) { continue; }
      let t = d / max(0.0001, rad);
      var cover = 1.0 - t;
      let sh = i32(obj.p2.w + 0.5);
      if (sh == 1) { cover = t; }
      else if (sh == 2) {
        let nz = sqrt(max(0.0, 1.0 - t * t));
        cover = clamp(0.25 + 0.75 * (nz * 0.6 + (dx / rad) * 0.2 + (dy / rad) * 0.2), 0.0, 1.0);
      }
      if (t > 0.9) { cover = cover * (1.0 - t) / 0.1; }
      let a = clamp(obj.p3.w * cover, 0.0, 1.0);
      if (a <= 0.0) { continue; }
      let cur = decodeS(res);
      res = encodeOut(cur.rgb * (1.0 - a) + obj.p3.xyz * a, cur.a * (1.0 - a) + a);
    }
  }
  return res;`,
  `${gp(0)}
  vec4 res = s0;
  float cell = p0.z;
  int cols = int(p0.w + 0.5);
  int rows = int(p1.x + 0.5);
  int count = int(p1.y + 0.5);
  int sd = int(p4.y);
  float ev = p4.x;
  float span = p4.z;
  int colF = int(floor(pp.x / cell));
  for (int dc = -2; dc <= 2; dc++) {
    int ci = ((colF + dc) % cols + cols) % cols;
    for (int row = 0; row < 64; row++) {
      if (row >= rows) break;
      int id = row * cols + ci;
      if (id >= count) continue;
      float speed = 0.5 + hash2u(id, sd + 23);
      float sizeVar = 1.0 + (hash2u(id, sd + 51) - 0.5) * 2.0 * p2.z;
      float rad = max(0.5, (p2.y * sizeVar) * 0.5);
      float x0 = (float(ci) + hash2u(id, sd)) * cell;
      float y0 = (float(row) + hash2u(id, sd + 11)) * cell;
      float rise = (ev / 100.0) * p1.z * speed;
      float wob = sin(ev / 40.0 + float(id) * 1.7) * p1.w
        * (0.5 + 0.5 * sin(float(id) + ev * p2.x / 500.0));
      float px = x0 + wob;
      float py = mod(mod(y0 - rise, span) + span, span) - p2.y;
      float dx = px - pp.x;
      float dy = py - pp.y;
      float d = length(vec2(dx, dy));
      if (d > rad) continue;
      float t = d / max(0.0001, rad);
      float cover = 1.0 - t;
      int sh = int(p2.w + 0.5);
      if (sh == 1) cover = t;
      else if (sh == 2) {
        float nz = sqrt(max(0.0, 1.0 - t * t));
        cover = clamp(0.25 + 0.75 * (nz * 0.6 + (dx / rad) * 0.2 + (dy / rad) * 0.2), 0.0, 1.0);
      }
      if (t > 0.9) cover = cover * (1.0 - t) / 0.1;
      float a = clamp(p3.w * cover, 0.0, 1.0);
      if (a <= 0.0) continue;
      vec4 cur = decodeS(res);
      res = encodeOut(cur.rgb * (1.0 - a) + p3.xyz * a, cur.a * (1.0 - a) + a);
    }
  }
  frag = res;`);

export const FX_ROUND_FIFTEEN_SHADERS: readonly ShaderSource[] = [
  CC_TILER_FX, RIPPLE_PULSE_FX, RADIAL_SCALE_WIPE_FX, GLASS_WIPE_FX, IMAGE_WIPE_FX,
  COLOR_DIFFERENCE_KEY_FX, WIRE_REMOVAL_FX, BROADCAST_COLORS_FX, NOISE_HLS_FX,
  BLOCK_LOAD_FX, KERNEL_FX, GLASSES_3D_FX, FRACTAL_FX, PARTICLE_SYSTEMS_FX, BUBBLES_FX,
];
