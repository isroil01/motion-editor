/**
 * Round ten: the separable NEIGHBOURHOOD effects and the drawn GENERATORS.
 *
 *   · Channel Blur, Minimax, Unsharp Mask, Shadow/Highlight — passes over a
 *     window of the layer. The first two are separable passes the composition
 *     pass chains H then V like the round-eight alpha morphology, generalised
 *     to any channel set. The last two need the ORIGINAL and a BLURRED copy at
 *     once, so they are two-texture combines (binding 3, the slot Set Matte and
 *     Displacement Map already use) fed by the existing Gaussian pass.
 *   · Checkerboard, Grid, Four-Color Gradient, Circle, Ellipse — the CPU draws
 *     these with Canvas2D paths under a composite mode. The fragment computes
 *     the same coverage analytically. `source-atop` (the pattern generators) is
 *     "replace the colour, keep the layer's alpha"; Circle and Ellipse honour
 *     their composite parameter (0 over · 1 add · 2 screen · 3 multiply · 4 atop)
 *     with the premultiplied form of each Porter-Duff / blend operator.
 *
 * ## Straight channels
 *
 * `blurOneChannel` and `minimaxData` operate on each STRAIGHT byte channel
 * independently — Channel Blur's whole contract is that the red slider does
 * not depend on the alpha slider. The chain is premultiplied, so each tap is
 * un-premultiplied first (a transparent tap contributes zero, as its bytes do
 * on the CPU) and the result re-premultiplied by the blurred alpha. This is in
 * storage space, without the sRGB decode: the kernels average bytes, and so do
 * mosaic and radial blur in earlier rounds.
 *
 * Known approximations, kernels stay the reference: Grid lines are covered
 * analytically (pixel overlap) rather than stroked with Canvas2D antialiasing;
 * Ellipse softness is a Gaussian halo standing in for Canvas2D's shadowBlur.
 */

import type { ShaderSource } from './builtin';
import { fxShader } from './fxRoundSix';
import { withHelpers } from './fxRoundEight';

// ── Shared snippets ──────────────────────────────────────────────────────────

/** Straight (un-premultiplied) storage-space colour of a layer-px tap; transparent → 0. */
export const TAP_WGSL = `fn tapStraight(px : vec2<f32>, lwh : vec2<f32>, clampBorder : bool) -> vec4<f32> {
  var p = px;
  if (clampBorder) { p = clamp(p, vec2<f32>(0.5, 0.5), lwh - vec2<f32>(0.5, 0.5)); }
  let s = samplePx(p, lwh);
  if (s.a <= 0.00001) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  return vec4<f32>(s.rgb / s.a, s.a);
}
fn premul(c : vec4<f32>) -> vec4<f32> { return vec4<f32>(c.rgb * c.a, c.a); }
`;
export const TAP_GLSL = `vec4 tapStraight(vec2 px, vec2 lwh, bool clampBorder) {
  vec2 p = px;
  if (clampBorder) p = clamp(p, vec2(0.5), lwh - vec2(0.5));
  vec4 s = samplePx(p, lwh);
  if (s.a <= 0.00001) return vec4(0.0);
  return vec4(s.rgb / s.a, s.a);
}
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
`;

/** Add the second texture binding the two-texture combines read. */
export function withSecondTexture(src: ShaderSource): ShaderSource {
  return {
    name: src.name,
    wgsl: src.wgsl.replace('@group(0) @binding(2) var smp : sampler;', '@group(0) @binding(2) var smp : sampler;\n@group(0) @binding(3) var tex2 : texture_2d<f32>;'),
    glsl: {
      vertex: src.glsl.vertex,
      fragment: src.glsl.fragment.replace('uniform sampler2D uTex;', 'uniform sampler2D uTex;\nuniform sampler2D uMaskTex;'),
    },
  };
}

/** Premultiplied composite of a drawn shape `sh` over / onto the sample `s`. */
export const COMPOSITE_WGSL = `fn compositeShape(s : vec4<f32>, sh : vec4<f32>, mode : f32) -> vec4<f32> {
  if (mode > 3.5) { return sh * s.a + s * (1.0 - sh.a); }                 // source-atop
  if (mode > 2.5) { return sh * s + sh * (1.0 - s.a) + s * (1.0 - sh.a); } // multiply
  if (mode > 1.5) { return s + sh - s * sh; }                             // screen
  if (mode > 0.5) { return min(s + sh, vec4<f32>(1.0)); }                 // lighter (add)
  return sh + s * (1.0 - sh.a);                                           // source-over
}
`;
export const COMPOSITE_GLSL = `vec4 compositeShape(vec4 s, vec4 sh, float mode) {
  if (mode > 3.5) return sh * s.a + s * (1.0 - sh.a);
  if (mode > 2.5) return sh * s + sh * (1.0 - s.a) + s * (1.0 - sh.a);
  if (mode > 1.5) return s + sh - s * sh;
  if (mode > 0.5) return min(s + sh, vec4(1.0));
  return sh + s * (1.0 - sh.a);
}
`;

// ── Channel Blur (one separable pass) ────────────────────────────────────────

/**
 * p0 = step (layer px per tap), red radius, green radius; p1 = blue radius,
 * alpha radius, repeatEdge; p2 = lw, lh. Each channel averages its own window;
 * off the layer a tap clamps (repeat edge) or counts as zero (`blurOneChannel`).
 */
export const CHANNEL_BOX_FX = withHelpers(fxShader('channel-box', 3,
  `  let lwh = obj.p2.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let radii = vec4<f32>(obj.p0.z, obj.p0.w, obj.p1.x, obj.p1.y);
  let rMax = i32(max(max(radii.x, radii.y), max(radii.z, radii.w)) + 0.5);
  let repeatEdge = obj.p1.z > 0.5;
  let centre = tapStraight(pp, lwh, true);
  var sum = centre;
  var count = vec4<f32>(1.0, 1.0, 1.0, 1.0);
  for (var k = 1; k <= 128; k = k + 1) {
    if (k > rMax) { break; }
    let inWin = step(vec4<f32>(f32(k)), radii + vec4<f32>(0.5));
    let off = obj.p0.xy * f32(k);
    let a1 = pp + off; let a2 = pp - off;
    let in1 = a1.x >= 0.0 && a1.y >= 0.0 && a1.x <= lwh.x && a1.y <= lwh.y;
    let in2 = a2.x >= 0.0 && a2.y >= 0.0 && a2.x <= lwh.x && a2.y <= lwh.y;
    if (in1 || repeatEdge) { sum = sum + tapStraight(a1, lwh, true) * inWin; }
    if (in2 || repeatEdge) { sum = sum + tapStraight(a2, lwh, true) * inWin; }
    count = count + 2.0 * inWin;
  }
  let avg = sum / count;
  // Channels outside their own window keep the centre value exactly.
  let res = select(centre, avg, radii > vec4<f32>(0.5));
  return premul(res);`,
  `  vec2 lwh = p2.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  vec4 radii = vec4(p0.z, p0.w, p1.x, p1.y);
  int rMax = int(max(max(radii.x, radii.y), max(radii.z, radii.w)) + 0.5);
  bool repeatEdge = p1.z > 0.5;
  vec4 centre = tapStraight(pp, lwh, true);
  vec4 sum = centre;
  vec4 count = vec4(1.0);
  for (int k = 1; k <= 128; k++) {
    if (k > rMax) break;
    vec4 inWin = step(vec4(float(k)), radii + vec4(0.5));
    vec2 off = p0.xy * float(k);
    vec2 a1 = pp + off; vec2 a2 = pp - off;
    bool in1 = a1.x >= 0.0 && a1.y >= 0.0 && a1.x <= lwh.x && a1.y <= lwh.y;
    bool in2 = a2.x >= 0.0 && a2.y >= 0.0 && a2.x <= lwh.x && a2.y <= lwh.y;
    if (in1 || repeatEdge) sum += tapStraight(a1, lwh, true) * inWin;
    if (in2 || repeatEdge) sum += tapStraight(a2, lwh, true) * inWin;
    count += 2.0 * inWin;
  }
  vec4 avg = sum / count;
  vec4 res = mix(centre, avg, step(vec4(0.5), radii));
  frag = premul(res);`), TAP_WGSL, TAP_GLSL);

// ── Minimax (one separable pass) ─────────────────────────────────────────────

/**
 * p0 = step, radius, takeMax; p1 = lw, lh, channel mask (1 r · 2 g · 4 b · 8 a).
 * `minimaxData` clamps at the border. Channels outside the mask are untouched.
 */
export const MINMAX_FX = withHelpers(fxShader('minmax', 2,
  `  let lwh = obj.p1.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let r = i32(obj.p0.z + 0.5);
  let takeMax = obj.p0.w > 0.5;
  let m = i32(obj.p1.z + 0.5);
  let mask = vec4<f32>(f32(m & 1), f32((m >> 1) & 1), f32((m >> 2) & 1), f32((m >> 3) & 1));
  let centre = tapStraight(pp, lwh, true);
  var best = centre;
  for (var k = 1; k <= 100; k = k + 1) {
    if (k > r) { break; }
    let off = obj.p0.xy * f32(k);
    let t1 = tapStraight(pp + off, lwh, true);
    let t2 = tapStraight(pp - off, lwh, true);
    if (takeMax) { best = max(best, max(t1, t2)); } else { best = min(best, min(t1, t2)); }
  }
  let res = mix(centre, best, mask);
  return premul(res);`,
  `  vec2 lwh = p1.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  int r = int(p0.z + 0.5);
  bool takeMax = p0.w > 0.5;
  int m = int(p1.z + 0.5);
  vec4 mask = vec4(float(m & 1), float((m >> 1) & 1), float((m >> 2) & 1), float((m >> 3) & 1));
  vec4 centre = tapStraight(pp, lwh, true);
  vec4 best = centre;
  for (int k = 1; k <= 100; k++) {
    if (k > r) break;
    vec2 off = p0.xy * float(k);
    vec4 t1 = tapStraight(pp + off, lwh, true);
    vec4 t2 = tapStraight(pp - off, lwh, true);
    best = takeMax ? max(best, max(t1, t2)) : min(best, min(t1, t2));
  }
  vec4 res = mix(centre, best, mask);
  frag = premul(res);`), TAP_WGSL, TAP_GLSL);

// ── Unsharp Mask (combine) ───────────────────────────────────────────────────

/** tex = original, tex2 = blurred copy. p0 = amount (fraction), threshold (0..1). Alpha untouched. */
export const UNSHARP_MASK_FX = withSecondTexture(fxShader('unsharp-mask', 1,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (s.a <= 0.00001) { return s; }
  let b = textureSampleLevel(tex2, smp, uv, 0.0);
  let c = s.rgb / s.a;
  let cb = select(b.rgb / b.a, c, b.a <= 0.00001);
  let d = c - cb;
  let keep = step(vec3<f32>(obj.p0.y), abs(d));
  let out = clamp(c + d * obj.p0.x * keep, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(out * s.a, s.a);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  if (s.a <= 0.00001) { frag = s; return; }
  vec4 b = textureLod(uMaskTex, vUv, 0.0);
  vec3 c = s.rgb / s.a;
  vec3 cb = (b.a <= 0.00001) ? c : b.rgb / b.a;
  vec3 d = c - cb;
  vec3 keep = step(vec3(p0.y), abs(d));
  vec3 outC = clamp(c + d * p0.x * keep, 0.0, 1.0);
  frag = vec4(outC * s.a, s.a);`));

// ── Shadow / Highlight (combine) ─────────────────────────────────────────────

/** tex = original, tex2 = blurred local-brightness map. p0 = shadow amount, highlight amount, 1/tonal width. Rec.601 luma, as `toneEffects` uses. */
export const SHADOW_HIGHLIGHT_FX = withSecondTexture(fxShader('shadow-highlight', 1,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (s.a <= 0.00001) { return s; }
  let b = textureSampleLevel(tex2, smp, uv, 0.0);
  let mb = select(b.rgb / b.a, vec3<f32>(0.0), b.a <= 0.00001);
  let local = dot(mb, vec3<f32>(0.299, 0.587, 0.114));
  let ds = local * obj.p0.z;
  let dh = (1.0 - local) * obj.p0.z;
  let gain = 1.0 + obj.p0.x * exp(-ds * ds) - obj.p0.y * exp(-dh * dh);
  let c = clamp(select(s.rgb / s.a, vec3<f32>(0.0), s.a <= 0.00001) * gain, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(c * s.a, s.a);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  if (s.a <= 0.00001) { frag = s; return; }
  vec4 b = textureLod(uMaskTex, vUv, 0.0);
  vec3 mb = (b.a <= 0.00001) ? vec3(0.0) : b.rgb / b.a;
  float local = dot(mb, vec3(0.299, 0.587, 0.114));
  float ds = local * p0.z;
  float dh = (1.0 - local) * p0.z;
  float gain = 1.0 + p0.x * exp(-ds * ds) - p0.y * exp(-dh * dh);
  vec3 c = clamp(((s.a > 0.00001) ? s.rgb / s.a : vec3(0.0)) * gain, 0.0, 1.0);
  frag = vec4(c * s.a, s.a);`));

// ── Checkerboard ─────────────────────────────────────────────────────────────

/** p0 = cell w, cell h, lattice start x, start y (px); p1 = colour A, opacity; p2 = colour B; p3 = lw, lh. source-atop. */
export const CHECKERBOARD_FX = fxShader('checkerboard', 4,
  `  let lwh = obj.p3.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let cell = floor((floor(pp) - obj.p0.zw) / obj.p0.xy);
  let parity = (cell.x + cell.y) - 2.0 * floor((cell.x + cell.y) * 0.5);
  let col = select(obj.p2.xyz, obj.p1.xyz, parity < 0.5);
  return mix(s, encodeOut(col, s.a), obj.p1.w);`,
  `  vec2 lwh = p3.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  vec2 cell = floor((floor(pp) - p0.zw) / p0.xy);
  float parity = mod(cell.x + cell.y, 2.0);
  vec3 col = (parity < 0.5) ? p1.xyz : p2.xyz;
  frag = mix(s, encodeOut(col, s.a), p1.w);`);

// ── Grid ─────────────────────────────────────────────────────────────────────

/** p0 = pitch x, pitch y, line offset x, offset y; p1 = thickness, hw-pixel snap, opacity; p2 = colour; p3 = lw, lh. */
export const GRID_FX = fxShader('grid', 4,
  `  let lwh = obj.p3.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let hw = obj.p1.x * 0.5;
  let kx = round((pp.x - obj.p0.z - obj.p1.y) / obj.p0.x);
  let lineX = round(kx * obj.p0.x + obj.p0.z) + obj.p1.y;
  let ky = round((pp.y - obj.p0.w - obj.p1.y) / obj.p0.y);
  let lineY = round(ky * obj.p0.y + obj.p0.w) + obj.p1.y;
  let cx = clamp(hw + 0.5 - abs(pp.x - lineX), 0.0, 1.0);
  let cy = clamp(hw + 0.5 - abs(pp.y - lineY), 0.0, 1.0);
  let cover = max(cx, cy) * obj.p1.z;
  return mix(s, encodeOut(obj.p2.xyz, s.a), cover);`,
  `  vec2 lwh = p3.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  float hw = p1.x * 0.5;
  float kx = floor((pp.x - p0.z - p1.y) / p0.x + 0.5);
  float lineX = floor(kx * p0.x + p0.z + 0.5) + p1.y;
  float ky = floor((pp.y - p0.w - p1.y) / p0.y + 0.5);
  float lineY = floor(ky * p0.y + p0.w + 0.5) + p1.y;
  float cx = clamp(hw + 0.5 - abs(pp.x - lineX), 0.0, 1.0);
  float cy = clamp(hw + 0.5 - abs(pp.y - lineY), 0.0, 1.0);
  float cover = max(cx, cy) * p1.z;
  frag = mix(s, encodeOut(p2.xyz, s.a), cover);`);

// ── Four-Color Gradient ──────────────────────────────────────────────────────

/** p0 = top-left colour, blend; p1 top-right; p2 bottom-left; p3 bottom-right; p4 = lw, lh. Bilinear across the layer box, source-atop. */
export const FOUR_COLOR_GRADIENT_FX = fxShader('four-color-gradient', 5,
  `  let lwh = obj.p4.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let t = clamp(pp / lwh, vec2<f32>(0.0), vec2<f32>(1.0));
  let top = mix(obj.p0.xyz, obj.p1.xyz, t.x);
  let bottom = mix(obj.p2.xyz, obj.p3.xyz, t.x);
  let col = mix(top, bottom, t.y);
  return mix(s, encodeOut(col, s.a), obj.p0.w);`,
  `  vec2 lwh = p4.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  vec2 t = clamp(pp / lwh, 0.0, 1.0);
  vec3 top = mix(p0.xyz, p1.xyz, t.x);
  vec3 bottom = mix(p2.xyz, p3.xyz, t.x);
  vec3 col = mix(top, bottom, t.y);
  frag = mix(s, encodeOut(col, s.a), p0.w);`);

// ── Circle ───────────────────────────────────────────────────────────────────

/**
 * p0 = centre, radius, feather (≤ radius); p1 = thickness, opacity, invert,
 * composite; p2 = colour; p3 = lw, lh. Coverage follows `drawCircle`'s radial
 * gradient stops: a disc feathered INWARD from the radius, or a ring whose
 * inner and outer edges each carry the feather.
 */
export const CIRCLE_FX = withHelpers(fxShader('circle', 4,
  `  let lwh = obj.p3.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let r = obj.p0.z; let feath = obj.p0.w; let a = obj.p1.y;
  let d = length(pp - obj.p0.xy);
  var shape = 0.0;
  if (d <= r) {
    if (obj.p1.x > 0.0) {
      let inner = max(0.0, r - obj.p1.x);
      let rise = select(select(0.0, 1.0, d >= inner), clamp((d - inner) / feath, 0.0, 1.0), feath > 0.0);
      let fall = select(1.0, clamp((r - d) / feath, 0.0, 1.0), feath > 0.0);
      shape = a * rise * fall;
    } else if (feath > 0.0) {
      shape = a * (1.0 - clamp((d - (r - feath)) / feath, 0.0, 1.0));
    } else {
      shape = a;
    }
  }
  if (obj.p1.z > 0.5) { shape = a - shape; }
  let sh = vec4<f32>(srgbToLinearRgb(obj.p2.xyz) * shape, shape);
  return compositeShape(s, sh, obj.p1.w);`,
  `  vec2 lwh = p3.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  float r = p0.z; float feath = p0.w; float a = p1.y;
  float d = length(pp - p0.xy);
  float shape = 0.0;
  if (d <= r) {
    if (p1.x > 0.0) {
      float inner = max(0.0, r - p1.x);
      float rise = (feath > 0.0) ? clamp((d - inner) / feath, 0.0, 1.0) : ((d >= inner) ? 1.0 : 0.0);
      float fall = (feath > 0.0) ? clamp((r - d) / feath, 0.0, 1.0) : 1.0;
      shape = a * rise * fall;
    } else if (feath > 0.0) {
      shape = a * (1.0 - clamp((d - (r - feath)) / feath, 0.0, 1.0));
    } else {
      shape = a;
    }
  }
  if (p1.z > 0.5) shape = a - shape;
  vec4 sh = vec4(srgbToLinearRgb(p2.xyz) * shape, shape);
  frag = compositeShape(s, sh, p1.w);`), COMPOSITE_WGSL, COMPOSITE_GLSL);

// ── Ellipse ──────────────────────────────────────────────────────────────────

/**
 * p0 = centre, rx, ry; p1 = rotation (rad), thickness, softness, opacity;
 * p2 = colour, composite; p3 = lw, lh. A stroked ring: pixel coverage of a band
 * `thickness` wide about the ellipse, plus a Gaussian halo standing in for
 * Canvas2D's shadowBlur softness (sigma ≈ softness / 2).
 */
export const ELLIPSE_FX = withHelpers(fxShader('ellipse', 4,
  `  let lwh = obj.p3.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let q0 = pp - obj.p0.xy;
  let cs = cos(-obj.p1.x); let sn = sin(-obj.p1.x);
  let q = vec2<f32>(q0.x * cs - q0.y * sn, q0.x * sn + q0.y * cs);
  let rr = vec2<f32>(max(obj.p0.z, 0.001), max(obj.p0.w, 0.001));
  let f = length(q / rr);
  let g = length(q / (rr * rr)) / max(f, 0.000001);
  let dist = (f - 1.0) / max(g, 0.000001);
  let hw = max(0.5, obj.p1.y) * 0.5;
  var cover = clamp(hw + 0.5 - abs(dist), 0.0, 1.0);
  if (obj.p1.z > 0.0) {
    let sigma = obj.p1.z * 0.5;
    let e = max(0.0, abs(dist) - hw);
    cover = max(cover, exp(-(e * e) / (2.0 * sigma * sigma)));
  }
  let shape = cover * obj.p1.w;
  let sh = vec4<f32>(srgbToLinearRgb(obj.p2.xyz) * shape, shape);
  return compositeShape(s, sh, obj.p2.w);`,
  `  vec2 lwh = p3.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  vec2 q0 = pp - p0.xy;
  float cs = cos(-p1.x); float sn = sin(-p1.x);
  vec2 q = vec2(q0.x * cs - q0.y * sn, q0.x * sn + q0.y * cs);
  vec2 rr = vec2(max(p0.z, 0.001), max(p0.w, 0.001));
  float f = length(q / rr);
  float g = length(q / (rr * rr)) / max(f, 0.000001);
  float dist = (f - 1.0) / max(g, 0.000001);
  float hw = max(0.5, p1.y) * 0.5;
  float cover = clamp(hw + 0.5 - abs(dist), 0.0, 1.0);
  if (p1.z > 0.0) {
    float sigma = p1.z * 0.5;
    float e = max(0.0, abs(dist) - hw);
    cover = max(cover, exp(-(e * e) / (2.0 * sigma * sigma)));
  }
  float shape = cover * p1.w;
  vec4 sh = vec4(srgbToLinearRgb(p2.xyz) * shape, shape);
  frag = compositeShape(s, sh, p2.w);`), COMPOSITE_WGSL, COMPOSITE_GLSL);

export const FX_ROUND_TEN_SHADERS: readonly ShaderSource[] = [
  CHANNEL_BOX_FX, MINMAX_FX, UNSHARP_MASK_FX, SHADOW_HIGHLIGHT_FX,
  CHECKERBOARD_FX, GRID_FX, FOUR_COLOR_GRADIENT_FX, CIRCLE_FX, ELLIPSE_FX,
];

