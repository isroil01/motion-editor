/**
 * Round twelve: the NOISE, TRANSITION, WINDOWED-BLUR and GRID-WARP set — the
 * last single-texture CPU kernels. Everything here is one fragment pass over
 * the chain texture (the two-texture members of the same sweep — the interior
 * layer styles, Cartoon and the particle generators — are fxRoundThirteen.ts).
 *
 * ## Noise
 *
 * Every kernel in this round hashes with either a float-overflowing integer
 * recipe (`hash01` in warp.ts / stylize.ts) or `sin(x·127.1 + …)·43758.5453`
 * (noiseEffects.ts, generatePatterns.ts). Neither is reproducible in f32, so
 * `hash01` / `vnoise` / `fbm` below are ONE u32 value-noise family shared by
 * all of them: same statistics and controls, a different realisation than the
 * CPU bake (see fxRoundEleven.ts for the same note on `hash2u`).
 *
 * Where a kernel feeds a FLOAT into its hash to get smooth evolution
 * (Turbulent Noise, Add Grain, Cell Pattern), `vnoiseF` blends the two
 * neighbouring integer seeds so evolution still glides instead of stepping.
 *
 * ## Windows
 *
 * Median, Dust & Scratches, Bilateral, Smart Blur and Camera Lens Blur read a
 * (2r+1)² window the CPU affords by rendering a downsampled proxy. The
 * fragments instead STRIDE the window (`stride = ceil(r / 6)`, ≤ 13×13 taps)
 * — the same trade, spent on the other axis. Median takes the true median of
 * the 9 or 25 strided taps with a componentwise selection network.
 *
 * Straight-byte shading rules as in round eleven: `decodeS` to display sRGB,
 * shade, `encodeOut`.
 */

import type { ShaderSource } from './builtin';
import { fxShader } from './fxRoundSix';
import { withHelpers } from './fxRoundEight';
import { COLORSPACE_GLSL, COLORSPACE_WGSL } from './fxRoundNine';
import { COMPOSITE_GLSL, COMPOSITE_WGSL } from './fxRoundTen';
import { BASE_GLSL, BASE_WGSL, gp, wp } from './fxRoundEleven';

// ── Shared snippets ──────────────────────────────────────────────────────────

export const NOISE_WGSL = `fn hash01(x : i32, y : i32, seed : i32) -> f32 {
  var n = u32(x) * 374761393u + u32(y) * 668265263u + u32(seed) * 2147483647u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  n = n ^ (n >> 16u);
  return f32(n) / 4294967296.0;
}
fn vnoise(p : vec2<f32>, seed : i32) -> f32 {
  let i = floor(p); let f = p - i; let u = f * f * (3.0 - 2.0 * f);
  let xi = i32(i.x); let yi = i32(i.y);
  let a = hash01(xi, yi, seed); let b = hash01(xi + 1, yi, seed);
  let c = hash01(xi, yi + 1, seed); let d = hash01(xi + 1, yi + 1, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn vnoiseF(p : vec2<f32>, seed : f32) -> f32 {
  let s0 = floor(seed);
  return mix(vnoise(p, i32(s0)), vnoise(p, i32(s0) + 1), seed - s0);
}
fn fbm(p : vec2<f32>, seed : i32, octaves : i32) -> f32 {
  var total = 0.0; var amp = 1.0; var freq = 1.0; var maxA = 0.0;
  for (var i = 0; i < 6; i = i + 1) {
    if (i >= octaves) { break; }
    total = total + (vnoise(p * freq, seed + i * 101) * 2.0 - 1.0) * amp;
    maxA = maxA + amp; amp = amp * 0.5; freq = freq * 2.0;
  }
  return total / maxA;
}
fn sampleClamped(px : vec2<f32>, lwh : vec2<f32>) -> vec4<f32> {
  return samplePx(clamp(px, vec2<f32>(0.5, 0.5), lwh - vec2<f32>(0.5, 0.5)), lwh);
}
fn sstep(e0 : f32, e1 : f32, x : f32) -> f32 {
  if (e1 <= e0) { return select(1.0, 0.0, x < e0); }
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
`;
export const NOISE_GLSL = `float hash01(int x, int y, int seed) {
  uint n = uint(x) * 374761393u + uint(y) * 668265263u + uint(seed) * 2147483647u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  n = n ^ (n >> 16u);
  return float(n) / 4294967296.0;
}
float vnoise(vec2 p, int seed) {
  vec2 i = floor(p); vec2 f = p - i; vec2 u = f * f * (3.0 - 2.0 * f);
  int xi = int(i.x); int yi = int(i.y);
  float a = hash01(xi, yi, seed); float b = hash01(xi + 1, yi, seed);
  float c = hash01(xi, yi + 1, seed); float d = hash01(xi + 1, yi + 1, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoiseF(vec2 p, float seed) {
  float s0 = floor(seed);
  return mix(vnoise(p, int(s0)), vnoise(p, int(s0) + 1), seed - s0);
}
float fbm(vec2 p, int seed, int octaves) {
  float total = 0.0; float amp = 1.0; float freq = 1.0; float maxA = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    total += (vnoise(p * freq, seed + i * 101) * 2.0 - 1.0) * amp;
    maxA += amp; amp *= 0.5; freq *= 2.0;
  }
  return total / maxA;
}
vec4 sampleClamped(vec2 px, vec2 lwh) {
  return samplePx(clamp(px, vec2(0.5), lwh - vec2(0.5)), lwh);
}
float sstep(float e0, float e1, float x) {
  if (e1 <= e0) return (x < e0) ? 0.0 : 1.0;
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
`;

const H_WGSL = BASE_WGSL + NOISE_WGSL;
const H_GLSL = BASE_GLSL + NOISE_GLSL;
const fx = (name: string, vec4s: number, wgsl: string, glsl: string): ShaderSource =>
  withHelpers(fxShader(name, vec4s, wgsl, glsl), H_WGSL, H_GLSL);

// ── Turbulent Displace ───────────────────────────────────────────────────────

/** p0 = lw, lh, amount, 1/size; p1 = evolution·0.01, octaves. Two fbm fields (seeds 7 / 131), clamped bilinear read as `turbulentDisplaceData`. */
export const TURBULENT_DISPLACE_FX = fx('turbulent-displace', 2,
  `${wp(0)}
  let xy = floor(pp);
  let oct = i32(obj.p1.y + 0.5);
  let nx = fbm(xy * obj.p0.w + vec2<f32>(obj.p1.x, 0.0), 7, oct) * obj.p0.z;
  let ny = fbm(xy * obj.p0.w + vec2<f32>(0.0, obj.p1.x), 131, oct) * obj.p0.z;
  return sampleClamped(xy - vec2<f32>(nx, ny) + 0.5, lwh);`,
  `${gp(0)}
  vec2 xy = floor(pp);
  int oct = int(p1.y + 0.5);
  float nx = fbm(xy * p0.w + vec2(p1.x, 0.0), 7, oct) * p0.z;
  float ny = fbm(xy * p0.w + vec2(0.0, p1.x), 131, oct) * p0.z;
  frag = sampleClamped(xy - vec2(nx, ny) + 0.5, lwh);`);

// ── Curl Noise ───────────────────────────────────────────────────────────────

/** p0 = lw, lh, k (= amount·size·0.5), 1/size; p1 = evolution·0.01, octaves. Curl of an fbm potential, central differences one px apart. */
export const CURL_NOISE_FX = fx('curl-noise', 2,
  `${wp(0)}
  let xy = floor(pp);
  let oct = i32(obj.p1.y + 0.5); let inv = obj.p0.w; let ev = vec2<f32>(obj.p1.x, -obj.p1.x);
  let dpdx = fbm((xy + vec2<f32>(1.0, 0.0)) * inv + ev, 53, oct) - fbm((xy - vec2<f32>(1.0, 0.0)) * inv + ev, 53, oct);
  let dpdy = fbm((xy + vec2<f32>(0.0, 1.0)) * inv + ev, 53, oct) - fbm((xy - vec2<f32>(0.0, 1.0)) * inv + ev, 53, oct);
  return sampleClamped(xy - vec2<f32>(dpdy, -dpdx) * obj.p0.z + 0.5, lwh);`,
  `${gp(0)}
  vec2 xy = floor(pp);
  int oct = int(p1.y + 0.5); float inv = p0.w; vec2 ev = vec2(p1.x, -p1.x);
  float dpdx = fbm((xy + vec2(1.0, 0.0)) * inv + ev, 53, oct) - fbm((xy - vec2(1.0, 0.0)) * inv + ev, 53, oct);
  float dpdy = fbm((xy + vec2(0.0, 1.0)) * inv + ev, 53, oct) - fbm((xy - vec2(0.0, 1.0)) * inv + ev, 53, oct);
  frag = sampleClamped(xy - vec2(dpdy, -dpdx) * p0.z + 0.5, lwh);`);

// ── Roughen Edges ────────────────────────────────────────────────────────────

/** p0 = lw, lh, border, freq; p1 = evolution/60, seed, octaves, edge sharpness. Alpha-only: bite the edge by fbm, then re-sharpen. */
export const ROUGHEN_EDGES_FX = fx('roughen-edges', 2,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let xy = floor(pp); let oct = i32(obj.p1.z + 0.5); let sd = i32(obj.p1.y);
  var n = 0.0; var amp = 1.0; var f = obj.p0.w; var norm = 0.0;
  for (var i = 0; i < 6; i = i + 1) {
    if (i >= oct) { break; }
    n = n + vnoise(xy * f + obj.p1.x, sd + i * 101) * amp;
    norm = norm + amp; amp = amp * 0.5; f = f * 2.0;
  }
  n = n / max(norm, 0.000001);
  var a1 = max(0.0, s0.a - n * obj.p0.z / max(1.0, obj.p0.z));
  if (obj.p1.w > 0.0) { a1 = clamp((a1 - 0.5) * (1.0 + obj.p1.w * 2.0) + 0.5, 0.0, 1.0); }
  let a0 = max(s0.a, 0.00001);
  return s0 * (a1 / a0);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  vec2 xy = floor(pp); int oct = int(p1.z + 0.5); int sd = int(p1.y);
  float n = 0.0; float amp = 1.0; float f = p0.w; float norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    n += vnoise(xy * f + p1.x, sd + i * 101) * amp;
    norm += amp; amp *= 0.5; f *= 2.0;
  }
  n /= max(norm, 0.000001);
  float a1 = max(0.0, s0.a - n * p0.z / max(1.0, p0.z));
  if (p1.w > 0.0) a1 = clamp((a1 - 0.5) * (1.0 + p1.w * 2.0) + 0.5, 0.0, 1.0);
  float a0 = max(s0.a, 0.00001);
  frag = s0 * (a1 / a0);`);

// ── Scatter ──────────────────────────────────────────────────────────────────

/** p0 = lw, lh, radius, grain (0 both · 1 horizontal · 2 vertical); p1 = seed, evolution. Nearest-pixel read at a hashed offset. */
export const SCATTER_FX = fx('scatter', 2,
  `${wp(0)}
  let xy = floor(pp); let xi = i32(xy.x); let yi = i32(xy.y);
  let sd = i32(obj.p1.x) * 31 + i32(obj.p1.y) * 13;
  let g = obj.p0.w;
  let ox = select((hash01(xi, yi, sd + 1) - 0.5) * 2.0 * obj.p0.z, 0.0, g > 1.5);
  let oy = select((hash01(xi, yi, sd + 2) - 0.5) * 2.0 * obj.p0.z, 0.0, g > 0.5 && g < 1.5);
  return samplePx(clamp(round(xy + vec2<f32>(ox, oy)), vec2<f32>(0.0), lwh - 1.0) + 0.5, lwh);`,
  `${gp(0)}
  vec2 xy = floor(pp); int xi = int(xy.x); int yi = int(xy.y);
  int sd = int(p1.x) * 31 + int(p1.y) * 13;
  float g = p0.w;
  float ox = (g > 1.5) ? 0.0 : (hash01(xi, yi, sd + 1) - 0.5) * 2.0 * p0.z;
  float oy = (g > 0.5 && g < 1.5) ? 0.0 : (hash01(xi, yi, sd + 2) - 0.5) * 2.0 * p0.z;
  frag = samplePx(clamp(round(xy + vec2(ox, oy)), vec2(0.0), lwh - 1.0) + 0.5, lwh);`);

// ── Colorama ─────────────────────────────────────────────────────────────────

/** p0..p6 = palette stops (sRGB rgb, position); p7 = phase, repetitions, keep (blend with original), stop count. Rec.709 luma → palette. */
export const COLORAMA_FX = fx('colorama', 8,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (s.a <= 0.0) { return s; }
  let c = decodeS(s);
  let n = i32(obj.p7.w + 0.5);
  var st = array<vec4<f32>, 7>(obj.p0, obj.p1, obj.p2, obj.p3, obj.p4, obj.p5, obj.p6);
  var u = fract(lum709(c.rgb) * obj.p7.y + obj.p7.x);
  var pal = st[0].rgb;
  if (u >= st[n - 1].w) { pal = st[n - 1].rgb; }
  else if (u > st[0].w) {
    for (var i = 0; i < 6; i = i + 1) {
      if (i + 1 >= n) { break; }
      if (u >= st[i].w && u <= st[i + 1].w) {
        let span = st[i + 1].w - st[i].w;
        let f = select((u - st[i].w) / max(span, 0.000001), 0.0, span <= 0.0);
        pal = mix(st[i].rgb, st[i + 1].rgb, f);
        break;
      }
    }
  }
  return encodeOut(pal + (c.rgb - pal) * obj.p7.z, c.a);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  if (s.a <= 0.0) { frag = s; return; }
  vec4 c = decodeS(s);
  int n = int(p7.w + 0.5);
  vec4 st[7]; st[0] = p0; st[1] = p1; st[2] = p2; st[3] = p3; st[4] = p4; st[5] = p5; st[6] = p6;
  float u = fract(lum709(c.rgb) * p7.y + p7.x);
  vec3 pal = st[0].rgb;
  if (u >= st[n - 1].w) pal = st[n - 1].rgb;
  else if (u > st[0].w) {
    for (int i = 0; i < 6; i++) {
      if (i + 1 >= n) break;
      if (u >= st[i].w && u <= st[i + 1].w) {
        float span = st[i + 1].w - st[i].w;
        float f = (span <= 0.0) ? 0.0 : (u - st[i].w) / max(span, 0.000001);
        pal = mix(st[i].rgb, st[i + 1].rgb, f);
        break;
      }
    }
  }
  frag = encodeOut(pal + (c.rgb - pal) * p7.z, c.a);`);

// ── Selective Color ──────────────────────────────────────────────────────────

/** p0 = range (0 reds … 8 blacks), Δcyan, Δmagenta, Δyellow; p1 = Δblack, relative. CMYK edit weighted by `rangeWeight`. */
export const SELECTIVE_COLOR_FX = fx('selective-color', 2,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (s.a <= 0.0) { return s; }
  let c = decodeS(s);
  let r = c.r; let g = c.g; let b = c.b;
  let mx = max(r, max(g, b)); let mn = min(r, min(g, b)); let mid = r + g + b - mx - mn;
  let range = i32(obj.p0.x + 0.5);
  var w = 0.0;
  if (mx <= 0.0) { w = select(0.0, 1.0, range == 8); }
  else if (range == 0) { w = select(0.0, (mx - mid) / mx, r == mx); }
  else if (range == 1) { w = select(0.0, (mid - mn) / mx, b == mn); }
  else if (range == 2) { w = select(0.0, (mx - mid) / mx, g == mx); }
  else if (range == 3) { w = select(0.0, (mid - mn) / mx, r == mn); }
  else if (range == 4) { w = select(0.0, (mx - mid) / mx, b == mx); }
  else if (range == 5) { w = select(0.0, (mid - mn) / mx, g == mn); }
  else if (range == 6) { w = clamp((mn - 0.5) * 2.0, 0.0, 1.0); }
  else if (range == 7) { w = clamp(1.0 - (abs(mx - 0.5) + abs(mn - 0.5)) * 2.0, 0.0, 1.0); }
  else { w = clamp((0.5 - mx) * 2.0, 0.0, 1.0); }
  if (w <= 0.0) { return s; }
  let rel = obj.p1.y > 0.5;
  let k = 1.0 - mx; let inv = 1.0 - k;
  let nk = clamp(k + select(obj.p1.x, obj.p1.x * k, rel) * w, 0.0, 1.0);
  if (inv <= 0.000001) { return encodeOut(vec3<f32>(1.0 - nk), c.a); }
  let cmy = (vec3<f32>(1.0) - c.rgb - k) / inv;
  let d = obj.p0.yzw;
  let ncmy = clamp(cmy + select(d, d * cmy, rel) * w, vec3<f32>(0.0), vec3<f32>(1.0));
  return encodeOut((vec3<f32>(1.0) - ncmy) * (1.0 - nk), c.a);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  if (s.a <= 0.0) { frag = s; return; }
  vec4 c = decodeS(s);
  float r = c.r; float g = c.g; float b = c.b;
  float mx = max(r, max(g, b)); float mn = min(r, min(g, b)); float mid = r + g + b - mx - mn;
  int range = int(p0.x + 0.5);
  float w = 0.0;
  if (mx <= 0.0) w = (range == 8) ? 1.0 : 0.0;
  else if (range == 0) w = (r == mx) ? (mx - mid) / mx : 0.0;
  else if (range == 1) w = (b == mn) ? (mid - mn) / mx : 0.0;
  else if (range == 2) w = (g == mx) ? (mx - mid) / mx : 0.0;
  else if (range == 3) w = (r == mn) ? (mid - mn) / mx : 0.0;
  else if (range == 4) w = (b == mx) ? (mx - mid) / mx : 0.0;
  else if (range == 5) w = (g == mn) ? (mid - mn) / mx : 0.0;
  else if (range == 6) w = clamp((mn - 0.5) * 2.0, 0.0, 1.0);
  else if (range == 7) w = clamp(1.0 - (abs(mx - 0.5) + abs(mn - 0.5)) * 2.0, 0.0, 1.0);
  else w = clamp((0.5 - mx) * 2.0, 0.0, 1.0);
  if (w <= 0.0) { frag = s; return; }
  bool rel = p1.y > 0.5;
  float k = 1.0 - mx; float inv = 1.0 - k;
  float nk = clamp(k + (rel ? p1.x * k : p1.x) * w, 0.0, 1.0);
  if (inv <= 0.000001) { frag = encodeOut(vec3(1.0 - nk), c.a); return; }
  vec3 cmy = (vec3(1.0) - c.rgb - k) / inv;
  vec3 d = p0.yzw;
  vec3 ncmy = clamp(cmy + (rel ? d * cmy : d) * w, 0.0, 1.0);
  frag = encodeOut((vec3(1.0) - ncmy) * (1.0 - nk), c.a);`);

// ── Turbulent Noise ──────────────────────────────────────────────────────────

/** p0 = lw, lh, scale, octaves; p1 = evolution, contrast gain, brightness lift, invert. Ridged value noise → grey, alpha kept. */
export const TURBULENT_NOISE_FX = fx('turbulent-noise', 2,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let xy = floor(pp); let oct = i32(obj.p0.w + 0.5);
  var sum = 0.0; var amp = 1.0; var norm = 0.0; var freq = 1.0 / obj.p0.z;
  for (var o = 0; o < 8; o = o + 1) {
    if (o >= oct) { break; }
    sum = sum + abs(vnoiseF(xy * freq, obj.p1.x + f32(o) * 13.7) - 0.5) * 2.0 * amp;
    norm = norm + amp; amp = amp * 0.5; freq = freq * 2.0;
  }
  var v = (sum / norm - 0.5) * obj.p1.y + 0.5 + obj.p1.z;
  if (obj.p1.w > 0.5) { v = 1.0 - v; }
  return encodeOut(vec3<f32>(clamp(v, 0.0, 1.0)), s0.a);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  vec2 xy = floor(pp); int oct = int(p0.w + 0.5);
  float sum = 0.0; float amp = 1.0; float norm = 0.0; float freq = 1.0 / p0.z;
  for (int o = 0; o < 8; o++) {
    if (o >= oct) break;
    sum += abs(vnoiseF(xy * freq, p1.x + float(o) * 13.7) - 0.5) * 2.0 * amp;
    norm += amp; amp *= 0.5; freq *= 2.0;
  }
  float v = (sum / norm - 0.5) * p1.y + 0.5 + p1.z;
  if (p1.w > 0.5) v = 1.0 - v;
  frag = encodeOut(vec3(clamp(v, 0.0, 1.0)), s0.a);`);

// ── Add Grain ────────────────────────────────────────────────────────────────

/** p0 = lw, lh, amount, pitch; p1 = saturation, seed. Mid-tone-weighted grain (Rec.601 luma), mono or per-channel. */
export const ADD_GRAIN_FX = fx('add-grain', 2,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let c = decodeS(s0);
  let l = lum601(c.rgb);
  let response = 4.0 * l * (1.0 - l);
  if (response <= 0.0) { return s0; }
  let np = floor(pp) / obj.p0.w;
  let mono = (vnoiseF(np, obj.p1.y) - 0.5) * 2.0;
  let kick = obj.p0.z * response * 128.0 / 255.0;
  let sat = obj.p1.x;
  var grain = vec3<f32>(mono);
  if (sat > 0.0) {
    let nr = (vnoiseF(np, obj.p1.y + 1.7) - 0.5) * 2.0;
    let ng = (vnoiseF(np, obj.p1.y + 5.3) - 0.5) * 2.0;
    let nb = (vnoiseF(np, obj.p1.y + 9.1) - 0.5) * 2.0;
    grain = mono * (1.0 - sat) + vec3<f32>(nr, ng, nb) * sat;
  }
  return encodeOut(c.rgb + grain * kick, c.a);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  vec4 c = decodeS(s0);
  float l = lum601(c.rgb);
  float response = 4.0 * l * (1.0 - l);
  if (response <= 0.0) { frag = s0; return; }
  vec2 np = floor(pp) / p0.w;
  float mono = (vnoiseF(np, p1.y) - 0.5) * 2.0;
  float kick = p0.z * response * 128.0 / 255.0;
  float sat = p1.x;
  vec3 grain = vec3(mono);
  if (sat > 0.0) {
    float nr = (vnoiseF(np, p1.y + 1.7) - 0.5) * 2.0;
    float ng = (vnoiseF(np, p1.y + 5.3) - 0.5) * 2.0;
    float nb = (vnoiseF(np, p1.y + 9.1) - 0.5) * 2.0;
    grain = mono * (1.0 - sat) + vec3(nr, ng, nb) * sat;
  }
  frag = encodeOut(c.rgb + grain * kick, c.a);`);

// ── Median / Dust & Scratches ────────────────────────────────────────────────

/**
 * p0 = lw, lh, radius, mode (0 median · 1 dust & scratches); p1 = threshold
 * (0..1). r = 1 is the exact 3×3 median; larger radii take the median of 25
 * taps strided r/2 apart. Componentwise selection sort over straight storage
 * values — a median commutes with the (monotonic) sRGB transfer, so the
 * decode happens once, after.
 */
export const MEDIAN_FX = fx('median', 2,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let r = obj.p0.z;
  let xy = floor(pp) + 0.5;
  let nine = r < 1.5;
  let n = select(25, 9, nine);
  let stride = select(r * 0.5, 1.0, nine);
  var v : array<vec3<f32>, 25>;
  var k = 0;
  for (var j = -2; j <= 2; j = j + 1) {
    for (var i = -2; i <= 2; i = i + 1) {
      if (nine && (abs(i) > 1 || abs(j) > 1)) { continue; }
      v[k] = tapStraight(xy + vec2<f32>(f32(i), f32(j)) * stride, lwh, true).rgb;
      k = k + 1;
    }
  }
  let mid = n / 2;
  for (var i = 0; i <= 12; i = i + 1) {
    if (i > mid) { break; }
    for (var j = i + 1; j < 25; j = j + 1) {
      if (j >= n) { break; }
      let lo = min(v[i], v[j]); let hi = max(v[i], v[j]);
      v[i] = lo; v[j] = hi;
    }
  }
  let med = v[mid];
  if (obj.p0.w < 0.5) { return premul(vec4<f32>(med, s0.a)); }
  let cs = decodeS(s0).rgb;
  let ms = linearToSrgbRgb(clamp(med, vec3<f32>(0.0), vec3<f32>(1.0)));
  let res = select(cs, ms, abs(cs - ms) > vec3<f32>(obj.p1.x));
  return encodeOut(res, s0.a);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  float r = p0.z;
  vec2 xy = floor(pp) + 0.5;
  bool nine = r < 1.5;
  int n = nine ? 9 : 25;
  float stride = nine ? 1.0 : r * 0.5;
  vec3 v[25];
  int k = 0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      if (nine && (abs(i) > 1 || abs(j) > 1)) continue;
      v[k] = tapStraight(xy + vec2(float(i), float(j)) * stride, lwh, true).rgb;
      k++;
    }
  }
  int mid = n / 2;
  for (int i = 0; i <= 12; i++) {
    if (i > mid) break;
    for (int j = i + 1; j < 25; j++) {
      if (j >= n) break;
      vec3 lo = min(v[i], v[j]); vec3 hi = max(v[i], v[j]);
      v[i] = lo; v[j] = hi;
    }
  }
  vec3 med = v[mid];
  if (p0.w < 0.5) { frag = premul(vec4(med, s0.a)); return; }
  vec3 cs = decodeS(s0).rgb;
  vec3 ms = linearToSrgbRgb(clamp(med, 0.0, 1.0));
  vec3 res = mix(cs, ms, vec3(greaterThan(abs(cs - ms), vec3(p1.x))));
  frag = encodeOut(res, s0.a);`);

// ── Block Dissolve ───────────────────────────────────────────────────────────

/** p0 = lw, lh, completion, block w; p1 = block h, feather, seed. Blocks whose hash is below t vanish, feathered inward. */
export const BLOCK_DISSOLVE_FX = fx('block-dissolve', 2,
  `${wp(0)}
  let xy = floor(pp);
  let bw = obj.p0.w; let bh = obj.p1.x;
  let thr = hash01(i32(floor(xy.x / bw)), i32(floor(xy.y / bh)), i32(obj.p1.z));
  if (thr >= obj.p0.z) { return s0; }
  var coverage = 0.0;
  if (obj.p1.y > 0.0) {
    let mx = xy.x - floor(xy.x / bw) * bw; let my = xy.y - floor(xy.y / bh) * bh;
    let inX = min(mx, bw - 1.0 - mx); let inY = min(my, bh - 1.0 - my);
    coverage = 1.0 - clamp(min(inX, inY) / obj.p1.y, 0.0, 1.0);
  }
  return s0 * coverage;`,
  `${gp(0)}
  vec2 xy = floor(pp);
  float bw = p0.w; float bh = p1.x;
  float thr = hash01(int(floor(xy.x / bw)), int(floor(xy.y / bh)), int(p1.z));
  if (thr >= p0.z) { frag = s0; return; }
  float coverage = 0.0;
  if (p1.y > 0.0) {
    float mx = xy.x - floor(xy.x / bw) * bw; float my = xy.y - floor(xy.y / bh) * bh;
    float inX = min(mx, bw - 1.0 - mx); float inY = min(my, bh - 1.0 - my);
    coverage = 1.0 - clamp(min(inX, inY) / p1.y, 0.0, 1.0);
  }
  frag = s0 * coverage;`);

// ── Gradient Wipe (self-luminance) ───────────────────────────────────────────

/** p0 = completion, softness, invert. The layer's own Rec.601 luma is the map, as `applyGradientWipe` builds it. */
export const GRADIENT_WIPE_FX = fx('gradient-wipe', 1,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (s.a <= 0.0) { return s; }
  var lum = lum601(decodeS(s).rgb);
  if (obj.p0.z > 0.5) { lum = 1.0 - lum; }
  let threshold = obj.p0.x * (1.0 + obj.p0.y * 2.0) - obj.p0.y;
  return s * clamp((lum - threshold) / obj.p0.y, 0.0, 1.0);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  if (s.a <= 0.0) { frag = s; return; }
  float lum = lum601(decodeS(s).rgb);
  if (p0.z > 0.5) lum = 1.0 - lum;
  float threshold = p0.x * (1.0 + p0.y * 2.0) - p0.y;
  frag = s * clamp((lum - threshold) / p0.y, 0.0, 1.0);`);

// ── Card Wipe ────────────────────────────────────────────────────────────────

/** p0 = lw, lh, completion, rows; p1 = columns, order (0 right · 1 left · 2 down · 3 up · 4 radial). Each card shrinks about its centre over half the run. */
export const CARD_WIPE_FX = fx('card-wipe', 2,
  `${wp(0)}
  let xy = floor(pp);
  let rws = obj.p0.w; let cols = obj.p1.x; let dir = i32(obj.p1.y + 0.5);
  let cellW = lwh.x / cols; let cellH = lwh.y / rws;
  let cx = min(cols - 1.0, floor(xy.x / cellW)); let cy = min(rws - 1.0, floor(xy.y / cellH));
  var start = 0.0;
  if (dir == 0) { start = select(cx / (cols - 1.0), 0.0, cols <= 1.0); }
  else if (dir == 1) { start = select(1.0 - cx / (cols - 1.0), 0.0, cols <= 1.0); }
  else if (dir == 2) { start = select(cy / (rws - 1.0), 0.0, rws <= 1.0); }
  else if (dir == 3) { start = select(1.0 - cy / (rws - 1.0), 0.0, rws <= 1.0); }
  else { start = min(1.0, length(vec2<f32>((cx + 0.5) / cols - 0.5, (cy + 0.5) / rws - 0.5)) * 2.0); }
  let local = clamp((obj.p0.z - start * 0.5) / 0.5, 0.0, 1.0);
  let u = (xy.x - cx * cellW) / cellW - 0.5; let v = (xy.y - cy * cellH) / cellH - 0.5;
  let hw = (1.0 - local) * 0.5;
  let inside = select(abs(v) <= hw, abs(u) <= hw, dir == 0 || dir == 1 || dir == 4);
  return select(vec4<f32>(0.0), s0, inside);`,
  `${gp(0)}
  vec2 xy = floor(pp);
  float rws = p0.w; float cols = p1.x; int dir = int(p1.y + 0.5);
  float cellW = lwh.x / cols; float cellH = lwh.y / rws;
  float cx = min(cols - 1.0, floor(xy.x / cellW)); float cy = min(rws - 1.0, floor(xy.y / cellH));
  float start = 0.0;
  if (dir == 0) start = (cols <= 1.0) ? 0.0 : cx / (cols - 1.0);
  else if (dir == 1) start = (cols <= 1.0) ? 0.0 : 1.0 - cx / (cols - 1.0);
  else if (dir == 2) start = (rws <= 1.0) ? 0.0 : cy / (rws - 1.0);
  else if (dir == 3) start = (rws <= 1.0) ? 0.0 : 1.0 - cy / (rws - 1.0);
  else start = min(1.0, length(vec2((cx + 0.5) / cols - 0.5, (cy + 0.5) / rws - 0.5)) * 2.0);
  float local = clamp((p0.z - start * 0.5) / 0.5, 0.0, 1.0);
  float u = (xy.x - cx * cellW) / cellW - 0.5; float v = (xy.y - cy * cellH) / cellH - 0.5;
  float hw = (1.0 - local) * 0.5;
  bool inside = (dir == 0 || dir == 1 || dir == 4) ? abs(u) <= hw : abs(v) <= hw;
  frag = inside ? s0 : vec4(0.0);`);

// ── Strobe Light ─────────────────────────────────────────────────────────────

/** p0 = intensity k, operation (0 colour · 1 invert · 2 transparent); p1 = strobe colour. Only reached on an ON frame — the extraction resolves the duty cycle. */
export const STROBE_LIGHT_FX = fx('strobe-light', 2,
  `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (s.a <= 0.0) { return s; }
  let k = obj.p0.x; let op = i32(obj.p0.y + 0.5);
  if (op == 2) { return s * (1.0 - k); }
  let c = decodeS(s);
  if (op == 1) { return encodeOut(c.rgb + (1.0 - 2.0 * c.rgb) * k, c.a); }
  return encodeOut(mix(c.rgb, obj.p1.xyz, k), c.a);`,
  `  vec4 s = textureLod(uTex, vUv, 0.0);
  if (s.a <= 0.0) { frag = s; return; }
  float k = p0.x; int op = int(p0.y + 0.5);
  if (op == 2) { frag = s * (1.0 - k); return; }
  vec4 c = decodeS(s);
  if (op == 1) { frag = encodeOut(c.rgb + (1.0 - 2.0 * c.rgb) * k, c.a); return; }
  frag = encodeOut(mix(c.rgb, p1.xyz, k), c.a);`);

// ── Burn Film ────────────────────────────────────────────────────────────────

/** p0 = lw, lh, burn t, cx; p1 = cy, max radius, hot front, jitter; p2 = burn colour, seed; p3 = char colour. Cooked HSL, then the hot/char fronts. */
export const BURN_FILM_FX = withHelpers(fx('burn-film', 4,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let xy = floor(pp); let sd = i32(obj.p2.w);
  let d = length(xy + 0.5 - vec2<f32>(obj.p0.w, obj.p1.x));
  let nz = (hash2u(i32(xy.x) + sd, i32(xy.y) - sd) - 0.5) * obj.p1.w * obj.p1.y * 0.18;
  let front = d - nz;
  let hot = obj.p1.z;
  let cook = obj.p0.z * 0.55;
  let c = decodeS(s0);
  var rgb = c.rgb; var a = c.a;
  if (cook > 0.0) {
    let hsl = rgb2hsl(rgb);
    rgb = hsl2rgb(hsl.x, hsl.y * (1.0 - cook * 0.7), clamp(hsl.z + cook * 0.25, 0.0, 1.0));
  }
  if (front <= hot) {
    rgb = obj.p2.xyz;
    a = a * clamp((front / max(0.000001, hot)) * 0.35, 0.0, 1.0);
  } else if (front <= hot * 1.18) {
    let k = 1.0 - clamp((front - hot) / max(0.000001, hot * 0.18), 0.0, 1.0);
    rgb = mix(rgb, obj.p3.xyz, k);
  }
  return encodeOut(rgb, a);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  vec2 xy = floor(pp); int sd = int(p2.w);
  float d = length(xy + 0.5 - vec2(p0.w, p1.x));
  float nz = (hash2u(int(xy.x) + sd, int(xy.y) - sd) - 0.5) * p1.w * p1.y * 0.18;
  float front = d - nz;
  float hot = p1.z;
  float cook = p0.z * 0.55;
  vec4 c = decodeS(s0);
  vec3 rgb = c.rgb; float a = c.a;
  if (cook > 0.0) {
    vec3 hsl = rgb2hsl(rgb);
    rgb = hsl2rgb(hsl.x, hsl.y * (1.0 - cook * 0.7), clamp(hsl.z + cook * 0.25, 0.0, 1.0));
  }
  if (front <= hot) {
    rgb = p2.xyz;
    a *= clamp((front / max(0.000001, hot)) * 0.35, 0.0, 1.0);
  } else if (front <= hot * 1.18) {
    float k = 1.0 - clamp((front - hot) / max(0.000001, hot * 0.18), 0.0, 1.0);
    rgb = mix(rgb, p3.xyz, k);
  }
  frag = encodeOut(rgb, a);`), COLORSPACE_WGSL, COLORSPACE_GLSL);

// ── Light Wipe ───────────────────────────────────────────────────────────────

/** p0 = lw, lh, radial, cx; p1 = cy, nx, ny, span; p2 = front, band, glow, feather; p3 = light colour. Reveal with a glowing leading band. */
export const LIGHT_WIPE_FX = fx('light-wipe', 4,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let xy = floor(pp) + 0.5;
  let c2 = vec2<f32>(obj.p0.w, obj.p1.x); let nrm = obj.p1.yz; let span = obj.p1.w;
  let d = select(dot(xy - (lwh * 0.5 - nrm * span * 0.5), nrm), length(xy - c2), obj.p0.z > 0.5);
  let front = obj.p2.x; let feath = obj.p2.w;
  let cover = sstep(front - feath, front + feath, d);
  let c = decodeS(s0);
  var rgb = c.rgb;
  if (obj.p2.z > 0.0 && cover > 0.0) {
    let ahead = d - front;
    if (ahead >= 0.0 && ahead <= obj.p2.y) { rgb = mix(rgb, obj.p3.xyz, (1.0 - ahead / obj.p2.y) * obj.p2.z); }
  }
  return encodeOut(rgb, c.a * clamp(cover, 0.0, 1.0));`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  vec2 xy = floor(pp) + 0.5;
  vec2 c2 = vec2(p0.w, p1.x); vec2 nrm = p1.yz; float span = p1.w;
  float d = (p0.z > 0.5) ? length(xy - c2) : dot(xy - (lwh * 0.5 - nrm * span * 0.5), nrm);
  float front = p2.x; float feath = p2.w;
  float cover = sstep(front - feath, front + feath, d);
  vec4 c = decodeS(s0);
  vec3 rgb = c.rgb;
  if (p2.z > 0.0 && cover > 0.0) {
    float ahead = d - front;
    if (ahead >= 0.0 && ahead <= p2.y) rgb = mix(rgb, p3.xyz, (1.0 - ahead / p2.y) * p2.z);
  }
  frag = encodeOut(rgb, c.a * clamp(cover, 0.0, 1.0));`);

// ── Grid Wipe ────────────────────────────────────────────────────────────────

/** p0 = lw, lh, completion, columns; p1 = rows, shape (0 square · 1 diamond · 2 circle), random, feather; p2 = invert. */
export const GRID_WIPE_FX = fx('grid-wipe', 3,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let xy = floor(pp);
  let cols = obj.p0.w; let rws = obj.p1.x;
  let cw = lwh.x / cols; let chh = lwh.y / rws;
  let ci = min(cols - 1.0, floor(xy.x / cw)); let ri = min(rws - 1.0, floor(xy.y / chh));
  let start = hash2u(i32(ci), i32(ri)) * obj.p1.z;
  let localT = clamp((obj.p0.z - start) / max(0.000001, 1.0 - obj.p1.z), 0.0, 1.0);
  let u = ((xy.x + 0.5) - (ci * cw + cw * 0.5)) / (cw * 0.5);
  let v = ((xy.y + 0.5) - (ri * chh + chh * 0.5)) / (chh * 0.5);
  let sh = i32(obj.p1.y + 0.5);
  let d = select(select(max(abs(u), abs(v)), length(vec2<f32>(u, v)), sh == 2), abs(u) + abs(v), sh == 1);
  let r = localT * 1.4143;
  var cover = sstep(r - obj.p1.w, r + obj.p1.w, d);
  if (obj.p2.x > 0.5) { cover = 1.0 - cover; }
  return s0 * clamp(cover, 0.0, 1.0);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  vec2 xy = floor(pp);
  float cols = p0.w; float rws = p1.x;
  float cw = lwh.x / cols; float chh = lwh.y / rws;
  float ci = min(cols - 1.0, floor(xy.x / cw)); float ri = min(rws - 1.0, floor(xy.y / chh));
  float start = hash2u(int(ci), int(ri)) * p1.z;
  float localT = clamp((p0.z - start) / max(0.000001, 1.0 - p1.z), 0.0, 1.0);
  float u = ((xy.x + 0.5) - (ci * cw + cw * 0.5)) / (cw * 0.5);
  float v = ((xy.y + 0.5) - (ri * chh + chh * 0.5)) / (chh * 0.5);
  int sh = int(p1.y + 0.5);
  float d = (sh == 1) ? abs(u) + abs(v) : ((sh == 2) ? length(vec2(u, v)) : max(abs(u), abs(v)));
  float r = localT * 1.4143;
  float cover = sstep(r - p1.w, r + p1.w, d);
  if (p2.x > 0.5) cover = 1.0 - cover;
  frag = s0 * clamp(cover, 0.0, 1.0);`);

// ── Noise Alpha ──────────────────────────────────────────────────────────────

/** p0 = lw, lh, amount, uniform; p1 = seed, phase, clip. Per-pixel hashed alpha attenuation. */
export const NOISE_ALPHA_FX = fx('noise-alpha', 2,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let xy = floor(pp); let sd = i32(obj.p1.x); let ph = i32(obj.p1.y);
  var n = hash2u(i32(xy.x) + sd + ph * 7919, i32(xy.y) - sd + ph * 104729);
  if (obj.p0.w < 0.5) { n = n * n; }
  let v = s0.a * (1.0 - obj.p0.z * n);
  let a2 = select(clamp(v, 0.0, 1.0), min(s0.a, clamp(v, 0.0, 1.0)), obj.p1.z > 0.5);
  let a0 = max(s0.a, 0.00001);
  return s0 * (a2 / a0);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  vec2 xy = floor(pp); int sd = int(p1.x); int ph = int(p1.y);
  float n = hash2u(int(xy.x) + sd + ph * 7919, int(xy.y) - sd + ph * 104729);
  if (p0.w < 0.5) n = n * n;
  float v = s0.a * (1.0 - p0.z * n);
  float a2 = (p1.z > 0.5) ? min(s0.a, clamp(v, 0.0, 1.0)) : clamp(v, 0.0, 1.0);
  float a0 = max(s0.a, 0.00001);
  frag = s0 * (a2 / a0);`);

// ── Brush Strokes ────────────────────────────────────────────────────────────

/** p0 = lw, lh, stroke length, cell; p1 = jitter (rad), density, base angle (rad). A line average along each cell's hashed direction. */
export const BRUSH_STROKES_FX = fx('brush-strokes', 2,
  `${wp(0)}
  let xy = floor(pp);
  let cxi = i32(floor(xy.x / obj.p0.w)); let cyi = i32(floor(xy.y / obj.p0.w));
  let ang = obj.p1.z + (hash2u(cxi, cyi) - 0.5) * 2.0 * obj.p1.x;
  let dir = vec2<f32>(cos(ang), sin(ang));
  let reach = max(1, i32(round(obj.p0.z * (0.4 + 0.6 * hash2u(cyi, cxi)))));
  var acc = vec4<f32>(0.0); var n = 0.0;
  for (var t = -32; t <= 32; t = t + 1) {
    if (t < -reach || t > reach) { continue; }
    let sp = clamp(round(xy + dir * f32(t)), vec2<f32>(0.0), lwh - 1.0) + 0.5;
    acc = acc + samplePx(sp, lwh); n = n + 1.0;
  }
  let a0 = max(s0.a, 0.00001);
  let cs = select(s0.rgb / a0, vec3<f32>(0.0), s0.a <= 0.0);
  let avg = select(acc.rgb / max(acc.a, 0.00001), cs, acc.a <= 0.0);
  let dens = obj.p1.y;
  let rgb = cs + (avg - cs) * dens;
  let a2 = s0.a + (acc.a / max(n, 1.0) - s0.a) * dens;
  return vec4<f32>(rgb * a2, a2);`,
  `${gp(0)}
  vec2 xy = floor(pp);
  int cxi = int(floor(xy.x / p0.w)); int cyi = int(floor(xy.y / p0.w));
  float ang = p1.z + (hash2u(cxi, cyi) - 0.5) * 2.0 * p1.x;
  vec2 dir = vec2(cos(ang), sin(ang));
  int reach = max(1, int(round(p0.z * (0.4 + 0.6 * hash2u(cyi, cxi)))));
  vec4 acc = vec4(0.0); float n = 0.0;
  for (int t = -32; t <= 32; t++) {
    if (t < -reach || t > reach) continue;
    vec2 sp = clamp(round(xy + dir * float(t)), vec2(0.0), lwh - 1.0) + 0.5;
    acc += samplePx(sp, lwh); n += 1.0;
  }
  float a0 = max(s0.a, 0.00001);
  vec3 cs = (s0.a <= 0.0) ? vec3(0.0) : s0.rgb / a0;
  vec3 avg = (acc.a <= 0.0) ? cs : acc.rgb / max(acc.a, 0.00001);
  float dens = p1.y;
  vec3 rgb = cs + (avg - cs) * dens;
  float a2 = s0.a + (acc.a / max(n, 1.0) - s0.a) * dens;
  frag = vec4(rgb * a2, a2);`);

// ── Bilateral Blur ───────────────────────────────────────────────────────────

/** p0 = lw, lh, radius, 1/(2σs²); p1 = 1/(2σr²) (σr in bytes), preserve alpha, stride. Strided window, byte-space colour distance. */
export const BILATERAL_BLUR_FX = fx('bilateral-blur', 2,
  `${wp(0)}
  let xy = floor(pp) + 0.5;
  let r = obj.p0.z; let stride = obj.p1.z;
  let c0 = decodeS(s0);
  var acc = vec3<f32>(0.0); var aa = 0.0; var wsum = 0.0;
  for (var j = -6; j <= 6; j = j + 1) {
    for (var i = -6; i <= 6; i = i + 1) {
      let off = vec2<f32>(f32(i), f32(j)) * stride;
      if (abs(off.x) > r || abs(off.y) > r) { continue; }
      let t = decodeS(sampleClamped(xy + off, lwh));
      let dc = t.rgb - c0.rgb;
      let wt = exp(-dot(off, off) * obj.p0.w) * exp(-dot(dc, dc) * 65025.0 * obj.p1.x);
      acc = acc + t.rgb * t.a * wt; aa = aa + t.a * wt; wsum = wsum + wt;
    }
  }
  let rgb = select(acc / max(aa, 0.00001), c0.rgb, aa <= 0.0);
  let a = select(aa / max(wsum, 0.000001), c0.a, obj.p1.y > 0.5);
  return encodeOut(rgb, a);`,
  `${gp(0)}
  vec2 xy = floor(pp) + 0.5;
  float r = p0.z; float stride = p1.z;
  vec4 c0 = decodeS(s0);
  vec3 acc = vec3(0.0); float aa = 0.0; float wsum = 0.0;
  for (int j = -6; j <= 6; j++) {
    for (int i = -6; i <= 6; i++) {
      vec2 off = vec2(float(i), float(j)) * stride;
      if (abs(off.x) > r || abs(off.y) > r) continue;
      vec4 t = decodeS(sampleClamped(xy + off, lwh));
      vec3 dc = t.rgb - c0.rgb;
      float wt = exp(-dot(off, off) * p0.w) * exp(-dot(dc, dc) * 65025.0 * p1.x);
      acc += t.rgb * t.a * wt; aa += t.a * wt; wsum += wt;
    }
  }
  vec3 rgb = (aa <= 0.0) ? c0.rgb : acc / max(aa, 0.00001);
  float a = (p1.y > 0.5) ? c0.a : aa / max(wsum, 0.000001);
  frag = encodeOut(rgb, a);`);

// ── Smart Blur ───────────────────────────────────────────────────────────────

/** p0 = lw, lh, radius, threshold (bytes); p1 = mode (0 normal · 1 edge only · 2 overlay edge), stride. Circular window, luma-gated. */
export const SMART_BLUR_FX = fx('smart-blur', 2,
  `${wp(0)}
  let xy = floor(pp) + 0.5;
  let r = obj.p0.z; let stride = obj.p1.y; let thr = obj.p0.w;
  let c0 = decodeS(s0);
  let cl = lum709(c0.rgb) * 255.0;
  var acc = vec3<f32>(0.0); var aa = 0.0; var n = 0.0; var rejected = 0.0; var total = 0.0;
  for (var j = -6; j <= 6; j = j + 1) {
    for (var i = -6; i <= 6; i = i + 1) {
      let off = vec2<f32>(f32(i), f32(j)) * stride;
      if (dot(off, off) > r * r) { continue; }
      let t = decodeS(sampleClamped(xy + off, lwh));
      total = total + 1.0;
      if (abs(lum709(t.rgb) * 255.0 - cl) > thr) { rejected = rejected + 1.0; continue; }
      acc = acc + t.rgb * t.a; aa = aa + t.a; n = n + 1.0;
    }
  }
  let edge = select(rejected / max(total, 1.0), 0.0, total <= 0.0);
  let rgb = select(acc / max(aa, 0.00001), c0.rgb, aa <= 0.0);
  let m = i32(obj.p1.x + 0.5);
  if (m == 1) { return encodeOut(vec3<f32>(clamp(edge, 0.0, 1.0)), c0.a); }
  if (m == 2) { return encodeOut(rgb * (1.0 - clamp(edge, 0.0, 1.0)), c0.a); }
  return encodeOut(rgb, select(c0.a, aa / n, n > 0.0));`,
  `${gp(0)}
  vec2 xy = floor(pp) + 0.5;
  float r = p0.z; float stride = p1.y; float thr = p0.w;
  vec4 c0 = decodeS(s0);
  float cl = lum709(c0.rgb) * 255.0;
  vec3 acc = vec3(0.0); float aa = 0.0; float n = 0.0; float rejected = 0.0; float total = 0.0;
  for (int j = -6; j <= 6; j++) {
    for (int i = -6; i <= 6; i++) {
      vec2 off = vec2(float(i), float(j)) * stride;
      if (dot(off, off) > r * r) continue;
      vec4 t = decodeS(sampleClamped(xy + off, lwh));
      total += 1.0;
      if (abs(lum709(t.rgb) * 255.0 - cl) > thr) { rejected += 1.0; continue; }
      acc += t.rgb * t.a; aa += t.a; n += 1.0;
    }
  }
  float edge = (total <= 0.0) ? 0.0 : rejected / max(total, 1.0);
  vec3 rgb = (aa <= 0.0) ? c0.rgb : acc / max(aa, 0.00001);
  int m = int(p1.x + 0.5);
  if (m == 1) { frag = encodeOut(vec3(clamp(edge, 0.0, 1.0)), c0.a); return; }
  if (m == 2) { frag = encodeOut(rgb * (1.0 - clamp(edge, 0.0, 1.0)), c0.a); return; }
  frag = encodeOut(rgb, (n > 0.0) ? aa / n : c0.a);`);

// ── Camera Lens Blur ─────────────────────────────────────────────────────────

/** p0 = lw, lh, radius, blades; p1 = iris rotation (rad), gain, highlight threshold (0..1), stride. Polygonal iris, highlights boosted before the average. */
export const CAMERA_LENS_BLUR_FX = fx('camera-lens-blur', 2,
  `${wp(0)}
  let xy = floor(pp) + 0.5;
  let r = obj.p0.z; let nb = i32(obj.p0.w + 0.5); let stride = obj.p1.w;
  let g = obj.p1.y; let thr = obj.p1.z;
  let cosN = select(1.0, cos(3.14159265359 / f32(max(nb, 3))), nb >= 3);
  var acc = vec3<f32>(0.0); var aa = 0.0; var wsum = 0.0;
  for (var j = -6; j <= 6; j = j + 1) {
    for (var i = -6; i <= 6; i = i + 1) {
      let off = vec2<f32>(f32(i), f32(j)) * stride;
      let dist = length(off);
      var inside = dist <= r;
      if (nb >= 3) {
        let seg = 6.28318530718 / f32(nb);
        let ang = atan2(off.y, off.x) - obj.p1.x;
        let local = ang - seg * floor(ang / seg + 0.5);
        inside = dist * cos(local) <= r * cosN;
      }
      if (!inside) { continue; }
      let t = decodeS(sampleClamped(xy + off, lwh));
      let l = lum709(t.rgb);
      let boost = select(1.0, 1.0 + (g - 1.0) * (l - thr) / max(0.000001, 1.0 - thr), l > thr);
      acc = acc + t.rgb * boost * t.a; aa = aa + t.a; wsum = wsum + 1.0;
    }
  }
  if (wsum <= 0.0) { return s0; }
  var rgb = vec3<f32>(0.0);
  if (aa > 0.0) {
    let m = acc / aa;
    let ml = lum709(m);
    rgb = clamp(m * select(1.0, 1.0 / ml, ml > 1.0), vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return encodeOut(rgb, aa / wsum);`,
  `${gp(0)}
  vec2 xy = floor(pp) + 0.5;
  float r = p0.z; int nb = int(p0.w + 0.5); float stride = p1.w;
  float g = p1.y; float thr = p1.z;
  float cosN = (nb >= 3) ? cos(3.14159265359 / float(max(nb, 3))) : 1.0;
  vec3 acc = vec3(0.0); float aa = 0.0; float wsum = 0.0;
  for (int j = -6; j <= 6; j++) {
    for (int i = -6; i <= 6; i++) {
      vec2 off = vec2(float(i), float(j)) * stride;
      float dist = length(off);
      bool inside = dist <= r;
      if (nb >= 3) {
        float seg = 6.28318530718 / float(nb);
        float ang = atan(off.y, off.x) - p1.x;
        float local = ang - seg * floor(ang / seg + 0.5);
        inside = dist * cos(local) <= r * cosN;
      }
      if (!inside) continue;
      vec4 t = decodeS(sampleClamped(xy + off, lwh));
      float l = lum709(t.rgb);
      float boost = (l > thr) ? 1.0 + (g - 1.0) * (l - thr) / max(0.000001, 1.0 - thr) : 1.0;
      acc += t.rgb * boost * t.a; aa += t.a; wsum += 1.0;
    }
  }
  if (wsum <= 0.0) { frag = s0; return; }
  vec3 rgb = vec3(0.0);
  if (aa > 0.0) {
    vec3 m = acc / aa;
    float ml = lum709(m);
    rgb = clamp(m * ((ml > 1.0) ? 1.0 / ml : 1.0), 0.0, 1.0);
  }
  frag = encodeOut(rgb, aa / wsum);`);

// ── Mesh Warp ────────────────────────────────────────────────────────────────

/** p0 = lw, lh; p1..p8 = the 4×4 grid's offsets (two per vec4, row-major). Bilinear offset field, as `meshWarpData`. */
export const MESH_WARP_FX = fx('mesh-warp', 9,
  `${wp(0)}
  var offs = array<vec2<f32>, 16>(obj.p1.xy, obj.p1.zw, obj.p2.xy, obj.p2.zw, obj.p3.xy, obj.p3.zw, obj.p4.xy, obj.p4.zw,
    obj.p5.xy, obj.p5.zw, obj.p6.xy, obj.p6.zw, obj.p7.xy, obj.p7.zw, obj.p8.xy, obj.p8.zw);
  let stepX = lwh.x / 3.0; let stepY = lwh.y / 3.0;
  let gx = i32(clamp(floor(pp.x / stepX), 0.0, 2.0)); let gy = i32(clamp(floor(pp.y / stepY), 0.0, 2.0));
  let tx = clamp((pp.x - f32(gx) * stepX) / stepX, 0.0, 1.0); let ty = clamp((pp.y - f32(gy) * stepY) / stepY, 0.0, 1.0);
  let top = mix(offs[gy * 4 + gx], offs[gy * 4 + gx + 1], tx);
  let bot = mix(offs[(gy + 1) * 4 + gx], offs[(gy + 1) * 4 + gx + 1], tx);
  return samplePx(pp - mix(top, bot, ty), lwh);`,
  `${gp(0)}
  vec2 offs[16];
  offs[0] = p1.xy; offs[1] = p1.zw; offs[2] = p2.xy; offs[3] = p2.zw; offs[4] = p3.xy; offs[5] = p3.zw; offs[6] = p4.xy; offs[7] = p4.zw;
  offs[8] = p5.xy; offs[9] = p5.zw; offs[10] = p6.xy; offs[11] = p6.zw; offs[12] = p7.xy; offs[13] = p7.zw; offs[14] = p8.xy; offs[15] = p8.zw;
  float stepX = lwh.x / 3.0; float stepY = lwh.y / 3.0;
  int gx = int(clamp(floor(pp.x / stepX), 0.0, 2.0)); int gy = int(clamp(floor(pp.y / stepY), 0.0, 2.0));
  float tx = clamp((pp.x - float(gx) * stepX) / stepX, 0.0, 1.0); float ty = clamp((pp.y - float(gy) * stepY) / stepY, 0.0, 1.0);
  vec2 top = mix(offs[gy * 4 + gx], offs[gy * 4 + gx + 1], tx);
  vec2 bot = mix(offs[(gy + 1) * 4 + gx], offs[(gy + 1) * 4 + gx + 1], tx);
  frag = samplePx(pp - mix(top, bot, ty), lwh);`);

// ── Liquify ──────────────────────────────────────────────────────────────────

/** p0 = lw, lh, cx, cy; p1 = radius, push x, push y, twirl (rad); p2 = pinch. Smoothstep falloff brush: push, then twirl + pinch. */
export const LIQUIFY_FX = fx('liquify', 3,
  `${wp(0)}
  let c = obj.p0.zw;
  let dist = length(pp - c);
  if (dist >= obj.p1.x) { return s0; }
  let t = 1.0 - dist / obj.p1.x;
  let f = t * t * (3.0 - 2.0 * t);
  var sp = pp - obj.p1.yz * f;
  if (obj.p1.w != 0.0 || obj.p2.x != 0.0) {
    let rv = sp - c;
    let ang = -obj.p1.w * f; let cs = cos(ang); let sn = sin(ang);
    sp = c + vec2<f32>(rv.x * cs - rv.y * sn, rv.x * sn + rv.y * cs) * (1.0 + obj.p2.x * f);
  }
  return samplePx(sp, lwh);`,
  `${gp(0)}
  vec2 c = p0.zw;
  float dist = length(pp - c);
  if (dist >= p1.x) { frag = s0; return; }
  float t = 1.0 - dist / p1.x;
  float f = t * t * (3.0 - 2.0 * t);
  vec2 sp = pp - p1.yz * f;
  if (p1.w != 0.0 || p2.x != 0.0) {
    vec2 rv = sp - c;
    float ang = -p1.w * f; float cs = cos(ang); float sn = sin(ang);
    sp = c + vec2(rv.x * cs - rv.y * sn, rv.x * sn + rv.y * cs) * (1.0 + p2.x * f);
  }
  frag = samplePx(sp, lwh);`);

// ── Bezier Warp ──────────────────────────────────────────────────────────────

const COONS_WGSL = `fn bez(a : vec2<f32>, b : vec2<f32>, c : vec2<f32>, d : vec2<f32>, t : f32) -> vec2<f32> {
  let s = 1.0 - t; return s * s * s * a + 3.0 * s * s * t * b + 3.0 * s * t * t * c + t * t * t * d;
}
fn bezD(a : vec2<f32>, b : vec2<f32>, c : vec2<f32>, d : vec2<f32>, t : f32) -> vec2<f32> {
  let s = 1.0 - t; return 3.0 * s * s * (b - a) + 6.0 * s * t * (c - b) + 3.0 * t * t * (d - c);
}
fn coonsPoint(p : array<vec2<f32>, 12>, u : f32, v : f32) -> vec2<f32> {
  let top = bez(p[0], p[1], p[2], p[3], u); let right = bez(p[3], p[4], p[5], p[6], v);
  let bot = bez(p[6], p[7], p[8], p[9], 1.0 - u); let left = bez(p[9], p[10], p[11], p[0], 1.0 - v);
  let bl = (1.0 - u) * (1.0 - v) * p[0] + u * (1.0 - v) * p[3] + u * v * p[6] + (1.0 - u) * v * p[9];
  return (1.0 - v) * top + v * bot + (1.0 - u) * left + u * right - bl;
}
fn coonsDu(p : array<vec2<f32>, 12>, u : f32, v : f32) -> vec2<f32> {
  let topD = bezD(p[0], p[1], p[2], p[3], u); let botD = bezD(p[6], p[7], p[8], p[9], 1.0 - u);
  let right = bez(p[3], p[4], p[5], p[6], v); let left = bez(p[9], p[10], p[11], p[0], 1.0 - v);
  return (1.0 - v) * topD - v * botD - left + right - ((v - 1.0) * p[0] + (1.0 - v) * p[3] + v * p[6] - v * p[9]);
}
fn coonsDv(p : array<vec2<f32>, 12>, u : f32, v : f32) -> vec2<f32> {
  let top = bez(p[0], p[1], p[2], p[3], u); let bot = bez(p[6], p[7], p[8], p[9], 1.0 - u);
  let rightD = bezD(p[3], p[4], p[5], p[6], v); let leftD = bezD(p[9], p[10], p[11], p[0], 1.0 - v);
  return bot - top - (1.0 - u) * leftD + u * rightD - ((u - 1.0) * p[0] - u * p[3] + u * p[6] + (1.0 - u) * p[9]);
}
`;
const COONS_GLSL = `vec2 bez(vec2 a, vec2 b, vec2 c, vec2 d, float t) {
  float s = 1.0 - t; return s * s * s * a + 3.0 * s * s * t * b + 3.0 * s * t * t * c + t * t * t * d;
}
vec2 bezD(vec2 a, vec2 b, vec2 c, vec2 d, float t) {
  float s = 1.0 - t; return 3.0 * s * s * (b - a) + 6.0 * s * t * (c - b) + 3.0 * t * t * (d - c);
}
vec2 coonsPoint(vec2 p[12], float u, float v) {
  vec2 top = bez(p[0], p[1], p[2], p[3], u); vec2 right = bez(p[3], p[4], p[5], p[6], v);
  vec2 bot = bez(p[6], p[7], p[8], p[9], 1.0 - u); vec2 left = bez(p[9], p[10], p[11], p[0], 1.0 - v);
  vec2 bl = (1.0 - u) * (1.0 - v) * p[0] + u * (1.0 - v) * p[3] + u * v * p[6] + (1.0 - u) * v * p[9];
  return (1.0 - v) * top + v * bot + (1.0 - u) * left + u * right - bl;
}
vec2 coonsDu(vec2 p[12], float u, float v) {
  vec2 topD = bezD(p[0], p[1], p[2], p[3], u); vec2 botD = bezD(p[6], p[7], p[8], p[9], 1.0 - u);
  vec2 right = bez(p[3], p[4], p[5], p[6], v); vec2 left = bez(p[9], p[10], p[11], p[0], 1.0 - v);
  return (1.0 - v) * topD - v * botD - left + right - ((v - 1.0) * p[0] + (1.0 - v) * p[3] + v * p[6] - v * p[9]);
}
vec2 coonsDv(vec2 p[12], float u, float v) {
  vec2 top = bez(p[0], p[1], p[2], p[3], u); vec2 bot = bez(p[6], p[7], p[8], p[9], 1.0 - u);
  vec2 rightD = bezD(p[3], p[4], p[5], p[6], v); vec2 leftD = bezD(p[9], p[10], p[11], p[0], 1.0 - v);
  return bot - top - (1.0 - u) * leftD + u * rightD - ((u - 1.0) * p[0] - u * p[3] + u * p[6] + (1.0 - u) * p[9]);
}
`;

/** p0 = lw, lh; p1..p6 = the 12 Coons-patch control points (layer px). Newton inverse per fragment, `solveUV`'s 24 steps and tolerances. */
export const BEZIER_WARP_FX = withHelpers(fx('bezier-warp', 7,
  `${wp(0)}
  var pts = array<vec2<f32>, 12>(obj.p1.xy, obj.p1.zw, obj.p2.xy, obj.p2.zw, obj.p3.xy, obj.p3.zw, obj.p4.xy, obj.p4.zw, obj.p5.xy, obj.p5.zw, obj.p6.xy, obj.p6.zw);
  var u = pp.x / lwh.x; var v = pp.y / lwh.y;
  var ok = true;
  for (var i = 0; i < 24; i = i + 1) {
    let e = coonsPoint(pts, u, v) - pp;
    if (dot(e, e) < 0.00000001) { break; }
    let du = coonsDu(pts, u, v); let dv = coonsDv(pts, u, v);
    let det = du.x * dv.y - dv.x * du.y;
    if (abs(det) < 0.000000000001) { ok = false; break; }
    u = clamp(u - (dv.y * e.x - dv.x * e.y) / det, -1.0, 2.0);
    v = clamp(v - (du.x * e.y - du.y * e.x) / det, -1.0, 2.0);
  }
  if (!ok) { return vec4<f32>(0.0); }
  let f = coonsPoint(pts, u, v) - pp;
  if (dot(f, f) > 0.25 || u < -0.0001 || u > 1.0001 || v < -0.0001 || v > 1.0001) { return vec4<f32>(0.0); }
  return samplePx(vec2<f32>(u * lwh.x, v * lwh.y), lwh);`,
  `${gp(0)}
  vec2 pts[12];
  pts[0] = p1.xy; pts[1] = p1.zw; pts[2] = p2.xy; pts[3] = p2.zw; pts[4] = p3.xy; pts[5] = p3.zw;
  pts[6] = p4.xy; pts[7] = p4.zw; pts[8] = p5.xy; pts[9] = p5.zw; pts[10] = p6.xy; pts[11] = p6.zw;
  float u = pp.x / lwh.x; float v = pp.y / lwh.y;
  bool ok = true;
  for (int i = 0; i < 24; i++) {
    vec2 e = coonsPoint(pts, u, v) - pp;
    if (dot(e, e) < 0.00000001) break;
    vec2 du = coonsDu(pts, u, v); vec2 dv = coonsDv(pts, u, v);
    float det = du.x * dv.y - dv.x * du.y;
    if (abs(det) < 0.000000000001) { ok = false; break; }
    u = clamp(u - (dv.y * e.x - dv.x * e.y) / det, -1.0, 2.0);
    v = clamp(v - (du.x * e.y - du.y * e.x) / det, -1.0, 2.0);
  }
  if (!ok) { frag = vec4(0.0); return; }
  vec2 f = coonsPoint(pts, u, v) - pp;
  if (dot(f, f) > 0.25 || u < -0.0001 || u > 1.0001 || v < -0.0001 || v > 1.0001) { frag = vec4(0.0); return; }
  frag = samplePx(vec2(u * lwh.x, v * lwh.y), lwh);`), COONS_WGSL, COONS_GLSL);

// ── Cell Pattern ─────────────────────────────────────────────────────────────

/** p0 = lw, lh, cell, contrast gain; p1 = evolution, invert, membrane. Worley F1 (or F2 − F1) of jittered cell points → grey. */
export const CELL_PATTERN_FX = fx('cell-pattern', 2,
  `${wp(0)}
  if (s0.a <= 0.0) { return s0; }
  let xy = floor(pp); let cell = obj.p0.z; let ev = obj.p1.x;
  let e0 = floor(ev); let ef = ev - e0; let ei = i32(e0);
  let g = vec2<i32>(floor(xy / cell));
  var f1 = 1e30; var f2 = 1e30;
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      let cx = g.x + ox; let cy = g.y + oy;
      let jx = mix(hash01(cx, cy, ei), hash01(cx, cy, ei + 1), ef);
      let jy = mix(hash01(cx, cy, ei + 17), hash01(cx, cy, ei + 18), ef);
      let fp = (vec2<f32>(f32(cx), f32(cy)) + vec2<f32>(jx, jy)) * cell;
      let d = length(xy - fp);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  let raw = select(f1 / cell, (f2 - f1) / cell, obj.p1.z > 0.5);
  var v = clamp(raw * obj.p0.w, 0.0, 1.0);
  if (obj.p1.y > 0.5) { v = 1.0 - v; }
  return encodeOut(vec3<f32>(v), s0.a);`,
  `${gp(0)}
  if (s0.a <= 0.0) { frag = s0; return; }
  vec2 xy = floor(pp); float cell = p0.z; float ev = p1.x;
  float e0 = floor(ev); float ef = ev - e0; int ei = int(e0);
  ivec2 g = ivec2(floor(xy / cell));
  float f1 = 1e30; float f2 = 1e30;
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      int cx = g.x + ox; int cy = g.y + oy;
      float jx = mix(hash01(cx, cy, ei), hash01(cx, cy, ei + 1), ef);
      float jy = mix(hash01(cx, cy, ei + 17), hash01(cx, cy, ei + 18), ef);
      vec2 fp = (vec2(float(cx), float(cy)) + vec2(jx, jy)) * cell;
      float d = length(xy - fp);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
  }
  float raw = (p1.z > 0.5) ? (f2 - f1) / cell : f1 / cell;
  float v = clamp(raw * p0.w, 0.0, 1.0);
  if (p1.y > 0.5) v = 1.0 - v;
  frag = encodeOut(vec3(v), s0.a);`);

// ── Radio Waves ──────────────────────────────────────────────────────────────

/** p0 = lw, lh, cx, cy; p1 = count, max radius, phase/360, line width; p2 = colour (linear), opacity; p3 = fade, composite. Antialiased rings, composited like the round-ten shapes. */
export const RADIO_WAVES_FX = withHelpers(fx('radio-waves', 4,
  `${wp(0)}
  let d = length(pp - obj.p0.zw);
  let n = i32(obj.p1.x + 0.5);
  var sh = vec4<f32>(0.0);
  for (var i = 0; i < 64; i = i + 1) {
    if (i >= n) { break; }
    let t = fract(obj.p1.z + f32(i) / f32(n));
    let r = t * obj.p1.y;
    if (r <= 0.5) { continue; }
    let alpha = obj.p2.w * (1.0 - obj.p3.x * t);
    if (alpha <= 0.0) { continue; }
    let cov = clamp(obj.p1.w * 0.5 + 0.5 - abs(d - r), 0.0, 1.0) * alpha;
    let ring = vec4<f32>(obj.p2.xyz * cov, cov);
    sh = ring + sh * (1.0 - cov);
  }
  return compositeShape(s0, sh, obj.p3.y);`,
  `${gp(0)}
  float d = length(pp - p0.zw);
  int n = int(p1.x + 0.5);
  vec4 sh = vec4(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    float t = fract(p1.z + float(i) / float(n));
    float r = t * p1.y;
    if (r <= 0.5) continue;
    float alpha = p2.w * (1.0 - p3.x * t);
    if (alpha <= 0.0) continue;
    float cov = clamp(p1.w * 0.5 + 0.5 - abs(d - r), 0.0, 1.0) * alpha;
    vec4 ring = vec4(p2.xyz * cov, cov);
    sh = ring + sh * (1.0 - cov);
  }
  frag = compositeShape(s0, sh, p3.y);`), COMPOSITE_WGSL, COMPOSITE_GLSL);

// ── Light Burst ──────────────────────────────────────────────────────────────

/** p0 = lw, lh, cx, cy; p1 = gain, reach. 24 taps toward the centre, screened over the pixel by their luma. */
export const LIGHT_BURST_FX = fx('light-burst', 2,
  `${wp(0)}
  let xy = floor(pp); let c = obj.p0.zw;
  var acc = vec3<f32>(0.0); var aa = 0.0; var wsum = 0.0;
  for (var k = 1; k <= 24; k = k + 1) {
    let t = (f32(k) / 24.0) * obj.p1.y;
    let sp = round(xy + (c - xy) * t);
    if (sp.x < 0.0 || sp.x >= lwh.x || sp.y < 0.0 || sp.y >= lwh.y) { continue; }
    let cs = decodeS(samplePx(sp + 0.5, lwh));
    let wk = 1.0 - f32(k) / 25.0;
    acc = acc + cs.rgb * cs.a * wk; aa = aa + cs.a * wk; wsum = wsum + wk;
  }
  if (wsum <= 0.0) { return s0; }
  let rr = acc / wsum;
  let boost = obj.p1.x * clamp(lum709(rr), 0.0, 1.0);
  if (boost <= 0.0) { return s0; }
  let c0 = decodeS(s0);
  let rgb = 1.0 - (1.0 - c0.rgb) * (1.0 - clamp(rr * boost, vec3<f32>(0.0), vec3<f32>(1.0)));
  return encodeOut(rgb, max(c0.a, clamp((aa / wsum) * boost, 0.0, 1.0)));`,
  `${gp(0)}
  vec2 xy = floor(pp); vec2 c = p0.zw;
  vec3 acc = vec3(0.0); float aa = 0.0; float wsum = 0.0;
  for (int k = 1; k <= 24; k++) {
    float t = (float(k) / 24.0) * p1.y;
    vec2 sp = round(xy + (c - xy) * t);
    if (sp.x < 0.0 || sp.x >= lwh.x || sp.y < 0.0 || sp.y >= lwh.y) continue;
    vec4 cs = decodeS(samplePx(sp + 0.5, lwh));
    float wk = 1.0 - float(k) / 25.0;
    acc += cs.rgb * cs.a * wk; aa += cs.a * wk; wsum += wk;
  }
  if (wsum <= 0.0) { frag = s0; return; }
  vec3 rr = acc / wsum;
  float boost = p1.x * clamp(lum709(rr), 0.0, 1.0);
  if (boost <= 0.0) { frag = s0; return; }
  vec4 c0 = decodeS(s0);
  vec3 rgb = 1.0 - (1.0 - c0.rgb) * (1.0 - clamp(rr * boost, 0.0, 1.0));
  frag = encodeOut(rgb, max(c0.a, clamp((aa / wsum) * boost, 0.0, 1.0)));`);

export const FX_ROUND_TWELVE_SHADERS: readonly ShaderSource[] = [
  TURBULENT_DISPLACE_FX, CURL_NOISE_FX, ROUGHEN_EDGES_FX, SCATTER_FX, COLORAMA_FX, SELECTIVE_COLOR_FX, TURBULENT_NOISE_FX, ADD_GRAIN_FX,
  MEDIAN_FX, BLOCK_DISSOLVE_FX, GRADIENT_WIPE_FX, CARD_WIPE_FX, STROBE_LIGHT_FX, BURN_FILM_FX, LIGHT_WIPE_FX, GRID_WIPE_FX, NOISE_ALPHA_FX,
  BRUSH_STROKES_FX, BILATERAL_BLUR_FX, SMART_BLUR_FX, CAMERA_LENS_BLUR_FX, MESH_WARP_FX, LIQUIFY_FX, BEZIER_WARP_FX, CELL_PATTERN_FX,
  RADIO_WAVES_FX, LIGHT_BURST_FX,
];
