/**
 * Round nine: the per-pixel COLOUR, CHANNEL and TRANSITION set, plus
 * Directional Blur — fifteen more effects off the CPU bake.
 *
 * Same contract as rounds six to eight (`fxShader` prolog, `withHelpers` for
 * hoisted functions, kernels stay the reference). Two families of arithmetic:
 *
 *   · Colour kernels (`aeColorAdvanced.ts`, `aeChannel.ts`) work in straight
 *     bytes. The fragment decodes the premultiplied chain sample to straight
 *     display-sRGB 0..1, does the byte maths at unit scale (255 → 1, 128 →
 *     128/255), and re-encodes. Where a kernel touches ALPHA it re-encodes with
 *     the new alpha, which is what "write data[i+3]" means for premultiplied
 *     storage.
 *   · Transition kernels (`transitions.ts`, `aeTransitionsAdvanced.ts`) only
 *     scale coverage, so they return `sample * cover` — colour rides along.
 *
 * Pixel coordinates: a kernel's integer `(x, y)` is the pixel whose CENTRE is
 * `(x + 0.5, y + 0.5)`, which is what the fragment's `pp` already is. Kernels
 * that offset by `x + 0.5` therefore use `pp` directly; the one that uses the
 * bare index (Venetian Blinds) subtracts the half pixel.
 *
 * Grid Wipe and Block Dissolve are NOT here: their tile order comes from an
 * integer hash whose JavaScript arithmetic overflows a double and cannot be
 * reproduced bit-exactly in a shader, so a port would change which tiles open
 * first in every saved project. Same reason Turbulent Displace stayed.
 */

import type { ShaderSource } from './builtin';
import { fxShader } from './fxRoundSix';
import { withHelpers, SSTEP_WGSL, SSTEP_GLSL, HSL_WGSL, HSL_GLSL } from './fxRoundEight';

// ── Shared snippets ──────────────────────────────────────────────────────────

/** Straight display-sRGB colour + alpha; a fully transparent sample is left as is. */
const DECODE_WGSL = `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  let a0 = s.a;
  if (a0 <= 0.0) { return s; }
  let c = linearToSrgbRgb(s.rgb / a0);`;
const DECODE_GLSL = `  vec4 s = textureLod(uTex, vUv, 0.0);
  float a0 = s.a;
  if (a0 <= 0.0) { frag = s; return; }
  vec3 c = linearToSrgbRgb(s.rgb / a0);`;

/** Same decode, but a transparent sample decodes to black rather than returning —
 *  for kernels that write something even where the source has no coverage. */
const DECODE_ALL_WGSL = `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  let a0 = s.a;
  let c = select(linearToSrgbRgb(s.rgb / max(a0, 0.00001)), vec3<f32>(0.0, 0.0, 0.0), a0 <= 0.0);`;
const DECODE_ALL_GLSL = `  vec4 s = textureLod(uTex, vUv, 0.0);
  float a0 = s.a;
  vec3 c = (a0 <= 0.0) ? vec3(0.0) : linearToSrgbRgb(s.rgb / max(a0, 0.00001));`;

/**
 * `colorSpace.rgbToHsl` / `hslToRgb` — the pair the colour kernels round-trip
 * through. The hue branch adds 6 for a negative first sector rather than
 * taking a modulo, exactly as the TypeScript does; the two are equal on the
 * wheel but written the same so a reader can diff them line for line.
 */
export const COLORSPACE_WGSL = `fn rgb2hsl(c : vec3<f32>) -> vec3<f32> {
  let mx = max(c.r, max(c.g, c.b)); let mn = min(c.r, min(c.g, c.b));
  let l = (mx + mn) * 0.5; let d = mx - mn;
  if (d <= 0.0) { return vec3<f32>(0.0, 0.0, l); }
  let sat = select(d / (mx + mn), d / (2.0 - mx - mn), l > 0.5);
  var h = 0.0;
  if (mx == c.r) { h = ((c.g - c.b) / d + select(0.0, 6.0, c.g < c.b)) / 6.0; }
  else if (mx == c.g) { h = ((c.b - c.r) / d + 2.0) / 6.0; }
  else { h = ((c.r - c.g) / d + 4.0) / 6.0; }
  return vec3<f32>(h, sat, l);
}
fn hueToChannel(p : f32, q : f32, tIn : f32) -> f32 {
  var t = tIn;
  if (t < 0.0) { t = t + 1.0; }
  if (t > 1.0) { t = t - 1.0; }
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 0.5) { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}
fn hsl2rgb(h : f32, sat : f32, l : f32) -> vec3<f32> {
  if (sat <= 0.0) { return vec3<f32>(l, l, l); }
  let q = select(l + sat - l * sat, l * (1.0 + sat), l < 0.5);
  let p = 2.0 * l - q;
  return clamp(vec3<f32>(hueToChannel(p, q, h + 1.0 / 3.0), hueToChannel(p, q, h), hueToChannel(p, q, h - 1.0 / 3.0)), vec3<f32>(0.0), vec3<f32>(1.0));
}
`;
export const COLORSPACE_GLSL = `vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5; float d = mx - mn;
  if (d <= 0.0) return vec3(0.0, 0.0, l);
  float sat = (l > 0.5) ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = ((c.g - c.b) / d + ((c.g < c.b) ? 6.0 : 0.0)) / 6.0;
  else if (mx == c.g) h = ((c.b - c.r) / d + 2.0) / 6.0;
  else h = ((c.r - c.g) / d + 4.0) / 6.0;
  return vec3(h, sat, l);
}
float hueToChannel(float p, float q, float tIn) {
  float t = tIn;
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(float h, float sat, float l) {
  if (sat <= 0.0) return vec3(l);
  float q = (l < 0.5) ? l * (1.0 + sat) : l + sat - l * sat;
  float p = 2.0 * l - q;
  return clamp(vec3(hueToChannel(p, q, h + 1.0 / 3.0), hueToChannel(p, q, h), hueToChannel(p, q, h - 1.0 / 3.0)), 0.0, 1.0);
}
`;

/** Alpha-only rewrite of a premultiplied sample: straight colour unchanged. */
const RESCALE_WGSL = `fn rescale(s : vec4<f32>, a2 : f32) -> vec4<f32> {
  if (s.a <= 0.00001) { return vec4<f32>(0.0, 0.0, 0.0, a2); }
  return vec4<f32>(s.rgb * (a2 / s.a), a2);
}
`;
const RESCALE_GLSL = `vec4 rescale(vec4 s, float a2) {
  if (s.a <= 0.00001) return vec4(0.0, 0.0, 0.0, a2);
  return vec4(s.rgb * (a2 / s.a), a2);
}
`;

const COLOR_HELPERS_WGSL = SSTEP_WGSL + HSL_WGSL + COLORSPACE_WGSL;
const COLOR_HELPERS_GLSL = SSTEP_GLSL + HSL_GLSL + COLORSPACE_GLSL;

// ── Directional Blur ─────────────────────────────────────────────────────────

/**
 * p0 = direction (dx, dy), length px, steps; p1 = lw, lh. `applyDirectionalBlur`
 * composites 2·steps+1 shifted copies with triangular weights normalised over
 * the whole set; a copy shifted off the layer contributes nothing but keeps its
 * weight in the total, which `samplePx`'s transparent-outside reproduces.
 */
export const DIRECTIONAL_BLUR_FX = fxShader('directional-blur', 2,
  `  let lwh = obj.p1.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return textureSampleLevel(tex, smp, uv, 0.0); }
  let steps = i32(obj.p0.w + 0.5);
  var acc = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var total = 0.0;
  for (var i = -64; i <= 64; i = i + 1) {
    if (abs(i) > steps) { continue; }
    let t = 1.0 - f32(abs(i)) / f32(steps + 1);
    let off = (f32(i) / f32(steps)) * (obj.p0.z * 0.5);
    acc = acc + samplePx(pp + obj.p0.xy * off, lwh) * t;
    total = total + t;
  }
  return acc / max(total, 0.000001);`,
  `  vec2 lwh = p1.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = textureLod(uTex, vUv, 0.0); return; }
  int steps = int(p0.w + 0.5);
  vec4 acc = vec4(0.0);
  float total = 0.0;
  for (int i = -64; i <= 64; i++) {
    if (abs(i) > steps) continue;
    float t = 1.0 - float(abs(i)) / float(steps + 1);
    float off = (float(i) / float(steps)) * (p0.z * 0.5);
    acc += samplePx(pp + p0.xy * off, lwh) * t;
    total += t;
  }
  frag = acc / max(total, 0.000001);`);

// ── Linear Wipe ──────────────────────────────────────────────────────────────

/**
 * p0 = wipe axis (gx, gy), edge position along it, soft band px; p1 = lw, lh,
 * full (completion ≥ 1 clears everything). The kernel paints a destination-out
 * gradient from opaque at `pos − soft/2` to clear at `pos + soft/2`, so what
 * survives is the complement: a linear ramp up across the band.
 */
export const LINEAR_WIPE_FX = fxShader('linear-wipe', 2,
  `  let lwh = obj.p1.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  if (obj.p1.z > 0.5) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let q = dot(pp - lwh * 0.5, obj.p0.xy);
  let keep = clamp((q - (obj.p0.z - obj.p0.w * 0.5)) / obj.p0.w, 0.0, 1.0);
  return s * keep;`,
  `  vec2 lwh = p1.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  if (p1.z > 0.5) { frag = vec4(0.0); return; }
  float q = dot(pp - lwh * 0.5, p0.xy);
  float keep = clamp((q - (p0.z - p0.w * 0.5)) / p0.w, 0.0, 1.0);
  frag = s * keep;`);

// ── Shift Channels ───────────────────────────────────────────────────────────

/** p0 = source for alpha, red, green, blue (0 alpha · 1 r · 2 g · 3 b · 4 luma · 5 on · 6 off). */
export const SHIFT_CHANNELS_FX = fxShader('shift-channels', 1,
  `${DECODE_ALL_WGSL}
  let l = lum601(c);
  var v = array<f32, 7>(a0, c.r, c.g, c.b, l, 1.0, 0.0);
  let r2 = v[clamp(i32(obj.p0.y + 0.5), 0, 6)];
  let g2 = v[clamp(i32(obj.p0.z + 0.5), 0, 6)];
  let b2 = v[clamp(i32(obj.p0.w + 0.5), 0, 6)];
  let a2 = v[clamp(i32(obj.p0.x + 0.5), 0, 6)];
  return encodeOut(vec3<f32>(r2, g2, b2), a2);`,
  `${DECODE_ALL_GLSL}
  float l = lum601(c);
  float v[7] = float[7](a0, c.r, c.g, c.b, l, 1.0, 0.0);
  float r2 = v[clamp(int(p0.y + 0.5), 0, 6)];
  float g2 = v[clamp(int(p0.z + 0.5), 0, 6)];
  float b2 = v[clamp(int(p0.w + 0.5), 0, 6)];
  float a2 = v[clamp(int(p0.x + 0.5), 0, 6)];
  frag = encodeOut(vec3(r2, g2, b2), a2);`);

// ── Alpha Levels ─────────────────────────────────────────────────────────────

/** p0 = inBlack, span (inWhite − inBlack), 1/gamma, outBlack; p1.x = outWhite. Byte units. */
export const ALPHA_LEVELS_FX = withHelpers(fxShader('alpha-levels', 2,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  let t = clamp((s.a * 255.0 - obj.p0.x) / obj.p0.y, 0.0, 1.0);
  let a2 = clamp(obj.p0.w + (obj.p1.x - obj.p0.w) * pow(t, obj.p0.z), 0.0, 255.0) / 255.0;
  return rescale(s, a2);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  float t = clamp((s.a * 255.0 - p0.x) / p0.y, 0.0, 1.0);
  float a2 = clamp(p0.w + (p1.x - p0.w) * pow(t, p0.z), 0.0, 255.0) / 255.0;
  frag = rescale(s, a2);`), RESCALE_WGSL, RESCALE_GLSL);

// ── Solid Composite ──────────────────────────────────────────────────────────

/** p0 = solid colour (0..1), source opacity; p1 = solid opacity, mode (0 normal · 1 multiply · 2 screen · 3 add). */
export const SOLID_COMPOSITE_FX = fxShader('solid-composite', 2,
  `${DECODE_ALL_WGSL}
  let col = obj.p0.xyz;
  let sa = a0 * obj.p0.w;
  let co = obj.p1.x;
  let m = obj.p1.y;
  var bl = c;
  if (m > 0.5 && m < 1.5) { bl = c * col; }
  else if (m >= 1.5 && m < 2.5) { bl = vec3<f32>(1.0) - (vec3<f32>(1.0) - c) * (vec3<f32>(1.0) - col); }
  else if (m >= 2.5) { bl = c + col; }
  let outC = col * co + (bl - col * co) * sa;
  let outA = sa + co - sa * co;
  return encodeOut(outC, clamp(outA, 0.0, 1.0));`,
  `${DECODE_ALL_GLSL}
  vec3 col = p0.xyz;
  float sa = a0 * p0.w;
  float co = p1.x;
  float m = p1.y;
  vec3 bl = c;
  if (m > 0.5 && m < 1.5) bl = c * col;
  else if (m >= 1.5 && m < 2.5) bl = vec3(1.0) - (vec3(1.0) - c) * (vec3(1.0) - col);
  else if (m >= 2.5) bl = c + col;
  vec3 outC = col * co + (bl - col * co) * sa;
  float outA = sa + co - sa * co;
  frag = encodeOut(outC, clamp(outA, 0.0, 1.0));`);

// ── Channel Combiner ─────────────────────────────────────────────────────────

/** p0.x = mode: 0 RGB→HSL · 1 HSL→RGB · 2 RGB→YUV · 3 YUV→RGB · 4 Lightness→Alpha · 5 Alpha→Luminance · 6 Max RGB · 7 Min RGB. */
export const CHANNEL_COMBINER_FX = withHelpers(fxShader('channel-combiner', 1,
  `${DECODE_ALL_WGSL}
  let m = i32(obj.p0.x + 0.5);
  var c2 = c;
  var a2 = a0;
  let bias = 128.0 / 255.0;
  if (m == 0) { c2 = rgb2hsl(c); }
  else if (m == 1) { c2 = hsl2rgb(c.r, c.g, c.b); }
  else if (m == 2) { let y = lum709(c); c2 = vec3<f32>(y, (c.b - y) * 0.565 + bias, (c.r - y) * 0.713 + bias); }
  else if (m == 3) { let y = c.r; let u = c.g - bias; let v = c.b - bias; c2 = vec3<f32>(y + 1.403 * v, y - 0.344 * u - 0.714 * v, y + 1.770 * u); }
  else if (m == 4) { a2 = lum709(c); }
  else if (m == 5) { c2 = vec3<f32>(a0, a0, a0); a2 = 1.0; }
  else if (m == 6) { let v = max(c.r, max(c.g, c.b)); c2 = vec3<f32>(v, v, v); }
  else if (m == 7) { let v = min(c.r, min(c.g, c.b)); c2 = vec3<f32>(v, v, v); }
  return encodeOut(c2, a2);`,
  `${DECODE_ALL_GLSL}
  int m = int(p0.x + 0.5);
  vec3 c2 = c;
  float a2 = a0;
  float bias = 128.0 / 255.0;
  if (m == 0) c2 = rgb2hsl(c);
  else if (m == 1) c2 = hsl2rgb(c.r, c.g, c.b);
  else if (m == 2) { float y = lum709(c); c2 = vec3(y, (c.b - y) * 0.565 + bias, (c.r - y) * 0.713 + bias); }
  else if (m == 3) { float y = c.r; float u = c.g - bias; float v = c.b - bias; c2 = vec3(y + 1.403 * v, y - 0.344 * u - 0.714 * v, y + 1.770 * u); }
  else if (m == 4) a2 = lum709(c);
  else if (m == 5) { c2 = vec3(a0); a2 = 1.0; }
  else if (m == 6) { float v = max(c.r, max(c.g, c.b)); c2 = vec3(v); }
  else if (m == 7) { float v = min(c.r, min(c.g, c.b)); c2 = vec3(v); }
  frag = encodeOut(c2, a2);`), COLOR_HELPERS_WGSL, COLOR_HELPERS_GLSL);

// ── Remove Color Matting ─────────────────────────────────────────────────────

/** p0 = background colour (0..1), coverage floor; p1.x = strength. */
export const REMOVE_COLOR_MATTING_FX = fxShader('remove-color-matting', 2,
  `${DECODE_WGSL}
  if (a0 <= obj.p0.w || a0 >= 1.0) { return s; }
  let straight = (c - obj.p0.xyz * (1.0 - a0)) / a0;
  let c2 = c + (straight - c) * obj.p1.x;
  return encodeOut(c2, a0);`,
  `${DECODE_GLSL}
  if (a0 <= p0.w || a0 >= 1.0) { frag = s; return; }
  vec3 straight = (c - p0.xyz * (1.0 - a0)) / a0;
  vec3 c2 = c + (straight - c) * p1.x;
  frag = encodeOut(c2, a0);`);

// ── Change Color ─────────────────────────────────────────────────────────────

/** p0 = target h s l, hue tolerance (0..0.5); p1 = sat tol, light tol, softness, hue shift (turns); p2 = sat scale, light scale, invert. */
export const CHANGE_COLOR_FX = withHelpers(fxShader('change-color', 3,
  `${DECODE_WGSL}
  let hsl = rgb2hsl(c);
  let soft = obj.p1.z;
  let dh = 1.0 - sstep(obj.p0.w * (1.0 - soft), obj.p0.w, hueDist(hsl.x, obj.p0.x));
  let ds = 1.0 - sstep(obj.p1.x * (1.0 - soft), obj.p1.x, abs(hsl.y - obj.p0.y));
  let dl = 1.0 - sstep(obj.p1.y * (1.0 - soft), obj.p1.y, abs(hsl.z - obj.p0.z));
  var m = dh * ds * dl;
  if (obj.p2.z > 0.5) { m = 1.0 - m; }
  if (m <= 0.0) { return s; }
  let nh = fract(hsl.x + obj.p1.w + 1.0);
  let ns = clamp(hsl.y * (1.0 + obj.p2.x), 0.0, 1.0);
  let nl = clamp(hsl.z * (1.0 + obj.p2.y), 0.0, 1.0);
  let c2 = hsl2rgb(nh, ns, nl);
  return encodeOut(mix(c, c2, m), a0);`,
  `${DECODE_GLSL}
  vec3 hsl = rgb2hsl(c);
  float soft = p1.z;
  float dh = 1.0 - sstep(p0.w * (1.0 - soft), p0.w, hueDist(hsl.x, p0.x));
  float ds = 1.0 - sstep(p1.x * (1.0 - soft), p1.x, abs(hsl.y - p0.y));
  float dl = 1.0 - sstep(p1.y * (1.0 - soft), p1.y, abs(hsl.z - p0.z));
  float m = dh * ds * dl;
  if (p2.z > 0.5) m = 1.0 - m;
  if (m <= 0.0) { frag = s; return; }
  float nh = fract(hsl.x + p1.w + 1.0);
  float ns = clamp(hsl.y * (1.0 + p2.x), 0.0, 1.0);
  float nl = clamp(hsl.z * (1.0 + p2.y), 0.0, 1.0);
  vec3 c2 = hsl2rgb(nh, ns, nl);
  frag = encodeOut(mix(c, c2, m), a0);`), COLOR_HELPERS_WGSL, COLOR_HELPERS_GLSL);

// ── Change To Color ──────────────────────────────────────────────────────────

/** p0 = from h s l, hue tolerance; p1 = sat tol, light tol, softness, preserve lightness; p2 = to h s l. */
export const CHANGE_TO_COLOR_FX = withHelpers(fxShader('change-to-color', 3,
  `${DECODE_WGSL}
  let hsl = rgb2hsl(c);
  let soft = obj.p1.z;
  let mh = 1.0 - sstep(obj.p0.w * (1.0 - soft), obj.p0.w, hueDist(hsl.x, obj.p0.x));
  let ms = 1.0 - sstep(obj.p1.x * (1.0 - soft), obj.p1.x, abs(hsl.y - obj.p0.y));
  let ml = 1.0 - sstep(obj.p1.y * (1.0 - soft), obj.p1.y, abs(hsl.z - obj.p0.z));
  let m = mh * ms * ml;
  if (m <= 0.0) { return s; }
  let nl = select(obj.p2.z, clamp(hsl.z + (obj.p2.z - obj.p0.z), 0.0, 1.0), obj.p1.w > 0.5);
  let c2 = hsl2rgb(obj.p2.x, obj.p2.y, nl);
  return encodeOut(mix(c, c2, m), a0);`,
  `${DECODE_GLSL}
  vec3 hsl = rgb2hsl(c);
  float soft = p1.z;
  float mh = 1.0 - sstep(p0.w * (1.0 - soft), p0.w, hueDist(hsl.x, p0.x));
  float ms = 1.0 - sstep(p1.x * (1.0 - soft), p1.x, abs(hsl.y - p0.y));
  float ml = 1.0 - sstep(p1.y * (1.0 - soft), p1.y, abs(hsl.z - p0.z));
  float m = mh * ms * ml;
  if (m <= 0.0) { frag = s; return; }
  float nl = (p1.w > 0.5) ? clamp(hsl.z + (p2.z - p0.z), 0.0, 1.0) : p2.z;
  vec3 c2 = hsl2rgb(p2.x, p2.y, nl);
  frag = encodeOut(mix(c, c2, m), a0);`), COLOR_HELPERS_WGSL, COLOR_HELPERS_GLSL);

// ── Leave Color ──────────────────────────────────────────────────────────────

/** p0 = target hue, tolerance (0..0.5), softness, strength. */
export const LEAVE_COLOR_FX = withHelpers(fxShader('leave-color', 1,
  `${DECODE_WGSL}
  let h = rgb2hsl(c).x;
  let keep = 1.0 - sstep(obj.p0.y * (1.0 - obj.p0.z), obj.p0.y, hueDist(h, obj.p0.x));
  let drain = (1.0 - keep) * obj.p0.w;
  if (drain <= 0.0) { return s; }
  let y = lum709(c);
  return encodeOut(c + (vec3<f32>(y, y, y) - c) * drain, a0);`,
  `${DECODE_GLSL}
  float h = rgb2hsl(c).x;
  float keep = 1.0 - sstep(p0.y * (1.0 - p0.z), p0.y, hueDist(h, p0.x));
  float drain = (1.0 - keep) * p0.w;
  if (drain <= 0.0) { frag = s; return; }
  float y = lum709(c);
  frag = encodeOut(c + (vec3(y) - c) * drain, a0);`), COLOR_HELPERS_WGSL, COLOR_HELPERS_GLSL);

// ── Toner ────────────────────────────────────────────────────────────────────

/** p0 = black tone rgb, strength k; p1 shadows, p2 midtones, p3 highlights, p4 white. Indexed by Rec.709 luma. */
export const TONER_FX = withHelpers(fxShader('toner', 5,
  `${DECODE_WGSL}
  let y = clamp(lum709(c), 0.0, 1.0);
  let p = y * 4.0;
  let idx = min(3.0, floor(p));
  let f = p - idx;
  var a = obj.p0.xyz; var b = obj.p1.xyz;
  if (idx > 2.5) { a = obj.p3.xyz; b = obj.p4.xyz; }
  else if (idx > 1.5) { a = obj.p2.xyz; b = obj.p3.xyz; }
  else if (idx > 0.5) { a = obj.p1.xyz; b = obj.p2.xyz; }
  let tone = mix(a, b, f);
  return encodeOut(c + (tone - c) * obj.p0.w, a0);`,
  `${DECODE_GLSL}
  float y = clamp(lum709(c), 0.0, 1.0);
  float p = y * 4.0;
  float idx = min(3.0, floor(p));
  float f = p - idx;
  vec3 a = p0.xyz; vec3 b = p1.xyz;
  if (idx > 2.5) { a = p3.xyz; b = p4.xyz; }
  else if (idx > 1.5) { a = p2.xyz; b = p3.xyz; }
  else if (idx > 0.5) { a = p1.xyz; b = p2.xyz; }
  vec3 tone = mix(a, b, f);
  frag = encodeOut(c + (tone - c) * p0.w, a0);`), SSTEP_WGSL, SSTEP_GLSL);

// ── Venetian Blinds ──────────────────────────────────────────────────────────

/** p0 = slat normal (cos, sin), pitch px, half-opening px; p1 = soft px, lw, lh, full. */
export const VENETIAN_BLINDS_FX = fxShader('venetian-blinds', 2,
  `  let lwh = obj.p1.yz;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  if (obj.p1.w > 0.5) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let q = pp - vec2<f32>(0.5, 0.5) - lwh * 0.5;
  let proj = dot(q, obj.p0.xy);
  let pitch = obj.p0.z;
  var d = proj - pitch * floor(proj / pitch);
  let fromCentre = abs(d - pitch * 0.5);
  var cover = 0.0;
  if (obj.p1.x <= 0.0) { cover = select(1.0, 0.0, fromCentre < obj.p0.w); }
  else { cover = clamp((fromCentre - obj.p0.w) / obj.p1.x, 0.0, 1.0); }
  return s * cover;`,
  `  vec2 lwh = p1.yz;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  if (p1.w > 0.5) { frag = vec4(0.0); return; }
  vec2 q = pp - vec2(0.5) - lwh * 0.5;
  float proj = dot(q, p0.xy);
  float pitch = p0.z;
  float d = proj - pitch * floor(proj / pitch);
  float fromCentre = abs(d - pitch * 0.5);
  float cover = (p1.x <= 0.0) ? ((fromCentre < p0.w) ? 0.0 : 1.0) : clamp((fromCentre - p0.w) / p1.x, 0.0, 1.0);
  frag = s * cover;`);

// ── Radial Wipe ──────────────────────────────────────────────────────────────

/** p0 = centre (px), start angle rad, swept rad; p1 = direction (0 cw · 1 ccw · 2 both), soft rad, lw, lh. Twelve o'clock is zero, clockwise grows. */
export const RADIAL_WIPE_FX = fxShader('radial-wipe', 2,
  `  let lwh = obj.p1.zw;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let TAU = 6.283185307179586;
  let v = pp - obj.p0.xy;
  var a = atan2(v.x, -v.y) - obj.p0.z;
  a = a - TAU * floor(a / TAU);
  let swept = obj.p0.w;
  var into = swept - a;
  if (obj.p1.x > 1.5) { into = max(swept - a, swept - (TAU - a)); }
  else if (obj.p1.x > 0.5) { into = swept - (TAU - a); }
  var cover = 0.0;
  if (obj.p1.y <= 0.0) { cover = select(1.0, 0.0, into > 0.0); }
  else { cover = clamp(-into / obj.p1.y, 0.0, 1.0); }
  return s * cover;`,
  `  vec2 lwh = p1.zw;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  float TAU = 6.283185307179586;
  vec2 v = pp - p0.xy;
  float a = atan(v.x, -v.y) - p0.z;
  a = a - TAU * floor(a / TAU);
  float swept = p0.w;
  float into = swept - a;
  if (p1.x > 1.5) into = max(swept - a, swept - (TAU - a));
  else if (p1.x > 0.5) into = swept - (TAU - a);
  float cover = (p1.y <= 0.0) ? ((into > 0.0) ? 0.0 : 1.0) : clamp(-into / p1.y, 0.0, 1.0);
  frag = s * cover;`);

// ── Iris Wipe ────────────────────────────────────────────────────────────────

/** p0 = centre (px), outer radius, inner radius; p1 = points, rotation rad, feather px, use inner; p2 = invert, lw, lh. */
export const IRIS_WIPE_FX = withHelpers(fxShader('iris-wipe', 3,
  `  let lwh = obj.p2.yz;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let o = pp - obj.p0.xy;
  var d = length(o);
  let n = obj.p1.x;
  if (n >= 3.0) {
    let ang = atan2(o.y, o.x) - obj.p1.y;
    let seg = 6.283185307179586 / n;
    let local = ang - seg * floor(ang / seg + 0.5);
    d = (d * cos(local)) / cos(3.141592653589793 / n);
  }
  let feath = obj.p1.z;
  var cover = sstep(obj.p0.z - feath, obj.p0.z + feath, d);
  if (obj.p1.w > 0.5 && obj.p0.w > 0.0) { cover = max(cover, 1.0 - sstep(obj.p0.w - feath, obj.p0.w + feath, d)); }
  if (obj.p2.x > 0.5) { cover = 1.0 - cover; }
  return s * clamp(cover, 0.0, 1.0);`,
  `  vec2 lwh = p2.yz;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  vec2 o = pp - p0.xy;
  float d = length(o);
  float n = p1.x;
  if (n >= 3.0) {
    float ang = atan(o.y, o.x) - p1.y;
    float seg = 6.283185307179586 / n;
    float local = ang - seg * floor(ang / seg + 0.5);
    d = (d * cos(local)) / cos(3.141592653589793 / n);
  }
  float feath = p1.z;
  float cover = sstep(p0.z - feath, p0.z + feath, d);
  if (p1.w > 0.5 && p0.w > 0.0) cover = max(cover, 1.0 - sstep(p0.w - feath, p0.w + feath, d));
  if (p2.x > 0.5) cover = 1.0 - cover;
  frag = s * clamp(cover, 0.0, 1.0);`), SSTEP_WGSL, SSTEP_GLSL);

// ── Line Sweep ───────────────────────────────────────────────────────────────

/** p0 = sweep axis (nx, ny), line count, stagger; p1 = feather, completion, invert; p2 = lw, lh. */
export const LINE_SWEEP_FX = withHelpers(fxShader('line-sweep', 3,
  `  let lwh = obj.p2.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let nx = obj.p0.x; let ny = obj.p0.y;
  let across = (pp.x * (-ny) + pp.y * nx) / max(1.0, abs(lwh.x * ny) + abs(lwh.y * nx));
  let along = (pp.x * nx + pp.y * ny) / max(1.0, abs(lwh.x * nx) + abs(lwh.y * ny));
  let n = obj.p0.z;
  let line = floor(clamp(across, 0.0, 1.0) * n);
  let start = (line / max(1.0, n)) * obj.p0.w;
  let localT = clamp((obj.p1.y - start) / max(0.000001, 1.0 - obj.p0.w), 0.0, 1.0);
  var cover = sstep(localT - obj.p1.x, localT + obj.p1.x, clamp(along, 0.0, 1.0));
  if (obj.p1.z > 0.5) { cover = 1.0 - cover; }
  return s * clamp(cover, 0.0, 1.0);`,
  `  vec2 lwh = p2.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  float nx = p0.x; float ny = p0.y;
  float across = (pp.x * (-ny) + pp.y * nx) / max(1.0, abs(lwh.x * ny) + abs(lwh.y * nx));
  float along = (pp.x * nx + pp.y * ny) / max(1.0, abs(lwh.x * nx) + abs(lwh.y * ny));
  float n = p0.z;
  float line = floor(clamp(across, 0.0, 1.0) * n);
  float start = (line / max(1.0, n)) * p0.w;
  float localT = clamp((p1.y - start) / max(0.000001, 1.0 - p0.w), 0.0, 1.0);
  float cover = sstep(localT - p1.x, localT + p1.x, clamp(along, 0.0, 1.0));
  if (p1.z > 0.5) cover = 1.0 - cover;
  frag = s * clamp(cover, 0.0, 1.0);`), SSTEP_WGSL, SSTEP_GLSL);

export const FX_ROUND_NINE_SHADERS: readonly ShaderSource[] = [
  DIRECTIONAL_BLUR_FX, LINEAR_WIPE_FX, SHIFT_CHANNELS_FX, ALPHA_LEVELS_FX, SOLID_COMPOSITE_FX,
  CHANNEL_COMBINER_FX, REMOVE_COLOR_MATTING_FX, CHANGE_COLOR_FX, CHANGE_TO_COLOR_FX, LEAVE_COLOR_FX,
  TONER_FX, VENETIAN_BLINDS_FX, RADIAL_WIPE_FX, IRIS_WIPE_FX, LINE_SWEEP_FX,
];
