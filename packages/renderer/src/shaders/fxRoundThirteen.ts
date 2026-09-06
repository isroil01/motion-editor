/**
 * Round thirteen: the TWO-TEXTURE members of the final sweep and the PARTICLE
 * generators.
 *
 *   · Inner Shadow, Inner Glow, Satin, Bevel — the interior layer styles.
 *     Their Canvas2D passes blur the layer's SILHOUETTE with `filter: blur()`
 *     (a Gaussian whose radius is the σ) and combine the result with the
 *     silhouette under a composite op. `tex2` is the Gaussian pass over the
 *     layer itself, whose alpha channel IS the blurred silhouette.
 *   · Cartoon — posterises a box-blurred copy (`tex2`) and inks Sobel edges
 *     of the original.
 *   · Write-on, Star Burst, Snowfall, Rainfall — the kernels STAMP discs and
 *     streaks onto a copy of the layer. The fragments gather: Write-on walks
 *     the stroke's disc chain, Star Burst visits every star (≤ 400) with an
 *     early bounding-box reject, and the weather generators place ONE particle
 *     per grid cell so a fragment need only visit the cells a particle can
 *     have drifted from. That last choice is the approximation to know about:
 *     the CPU scatters N particles uniformly at random; the GPU places the same
 *     density of particles one per cell (with per-particle drift, sway, size
 *     and opacity intact), so the flurry has the same density and motion but
 *     a different arrangement — and the horizontal wind drift uses the mean
 *     fall speed so that a fragment's candidate columns stay bounded.
 */

import type { ShaderSource } from './builtin';
import { fxShader } from './fxRoundSix';
import { withHelpers } from './fxRoundEight';
import { withSecondTexture } from './fxRoundTen';
import { BASE_GLSL, BASE_WGSL, gp, wp } from './fxRoundEleven';
import { NOISE_GLSL, NOISE_WGSL } from './fxRoundTwelve';

/** Blurred-silhouette alpha at a layer px (0 outside the layer, as the padded Canvas2D scratch is). */
const BLURA_WGSL = `fn blurA(px : vec2<f32>, lwh : vec2<f32>) -> f32 {
  if (px.x < 0.0 || px.y < 0.0 || px.x > lwh.x || px.y > lwh.y) { return 0.0; }
  return textureSampleLevel(tex2, smp, layerUv(px, lwh), 0.0).a;
}
`;
const BLURA_GLSL = `float blurA(vec2 px, vec2 lwh) {
  if (px.x < 0.0 || px.y < 0.0 || px.x > lwh.x || px.y > lwh.y) return 0.0;
  return textureLod(uMaskTex, layerUv(px, lwh), 0.0).a;
}
`;

const H_WGSL = BASE_WGSL + NOISE_WGSL;
const H_GLSL = BASE_GLSL + NOISE_GLSL;
const fx = (name: string, vec4s: number, wgsl: string, glsl: string): ShaderSource =>
  withHelpers(fxShader(name, vec4s, wgsl, glsl), H_WGSL, H_GLSL);
const fxTwo = (name: string, vec4s: number, wgsl: string, glsl: string): ShaderSource =>
  withHelpers(withSecondTexture(fxShader(name, vec4s, wgsl, glsl)), H_WGSL + BLURA_WGSL, H_GLSL + BLURA_GLSL);

// ── Cartoon (two-texture) ────────────────────────────────────────────────────

/** tex2 = smoothed copy. p0 = lw, lh, level step (bytes), edge threshold; p1 = ink width, ink opacity, smoothed. Posterise the copy, ink the original's Sobel edges. */
export const CARTOON_FX = fxTwo('cartoon', 2,
  `${wp(0)}
  let b = select(s0, textureSampleLevel(tex2, smp, uv, 0.0), obj.p1.z > 0.5);
  let cb = decodeS(b).rgb;
  let stepB = obj.p0.z;
  var post = round(cb * 255.0 / stepB) * stepB / 255.0;
  let a = s0.a;
  if (obj.p1.y <= 0.0 || a <= 0.0) { return encodeOut(post, a); }
  let xy = floor(pp); let iw = obj.p1.x;
  var gx = 0.0; var gy = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let sp = clamp(xy + vec2<f32>(f32(i), f32(j)) * iw, vec2<f32>(0.0), lwh - 1.0) + 0.5;
      let l = lum709(decodeS(samplePx(sp, lwh)).rgb) * 255.0;
      gx = gx + l * f32(i) * select(1.0, 2.0, j == 0);
      gy = gy + l * f32(j) * select(1.0, 2.0, i == 0);
    }
  }
  let mag = length(vec2<f32>(gx, gy));
  if (mag <= obj.p0.w) { return encodeOut(post, a); }
  let k = 1.0 - clamp((mag - obj.p0.w) / max(0.000001, obj.p0.w), 0.0, 1.0) * obj.p1.y;
  return encodeOut(post * k, a);`,
  `${gp(0)}
  vec4 b = (p1.z > 0.5) ? textureLod(uMaskTex, vUv, 0.0) : s0;
  vec3 cb = decodeS(b).rgb;
  float stepB = p0.z;
  vec3 post = round(cb * 255.0 / stepB) * stepB / 255.0;
  float a = s0.a;
  if (p1.y <= 0.0 || a <= 0.0) { frag = encodeOut(post, a); return; }
  vec2 xy = floor(pp); float iw = p1.x;
  float gx = 0.0; float gy = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 sp = clamp(xy + vec2(float(i), float(j)) * iw, vec2(0.0), lwh - 1.0) + 0.5;
      float l = lum709(decodeS(samplePx(sp, lwh)).rgb) * 255.0;
      gx += l * float(i) * ((j == 0) ? 2.0 : 1.0);
      gy += l * float(j) * ((i == 0) ? 2.0 : 1.0);
    }
  }
  float mag = length(vec2(gx, gy));
  if (mag <= p0.w) { frag = encodeOut(post, a); return; }
  float k = 1.0 - clamp((mag - p0.w) / max(0.000001, p0.w), 0.0, 1.0) * p1.y;
  frag = encodeOut(post * k, a);`);

// ── Interior style: Inner Shadow / Inner Glow (two-texture) ──────────────────

/**
 * tex2 = blurred layer (σ = softness / size). p0 = dx, dy, opacity, blend
 * (0 source-over · 1 lighter); p1 = colour (linear); p2 = lw, lh. The band is
 * the blurred INVERSE silhouette shifted by the offset — `1 − B(p − d)` — cut
 * by the silhouette, exactly `applyInterior`'s scratch chain.
 */
export const INTERIOR_STYLE_FX = fxTwo('interior-style', 3,
  `${wp(2)}
  let sil = s0.a;
  if (sil <= 0.0) { return s0; }
  let band = (1.0 - blurA(pp - obj.p0.xy, lwh)) * sil * obj.p0.z;
  let bp = vec4<f32>(obj.p1.xyz * band, band);
  if (obj.p0.w > 0.5) { return min(s0 + bp, vec4<f32>(1.0)); }
  return bp + s0 * (1.0 - band);`,
  `${gp(2)}
  float sil = s0.a;
  if (sil <= 0.0) { frag = s0; return; }
  float band = (1.0 - blurA(pp - p0.xy, lwh)) * sil * p0.z;
  vec4 bp = vec4(p1.xyz * band, band);
  if (p0.w > 0.5) { frag = min(s0 + bp, vec4(1.0)); return; }
  frag = bp + s0 * (1.0 - band);`);

// ── Satin (two-texture) ──────────────────────────────────────────────────────

/** tex2 = blurred layer (σ = size). p0 = dx, dy, opacity, invert; p1 = colour (linear); p2 = lw, lh. Two offset silhouettes, XOR'd (or AND'd when inverted). */
export const SATIN_FX = fxTwo('satin', 3,
  `${wp(2)}
  let sil = s0.a;
  if (sil <= 0.0) { return s0; }
  let A = blurA(pp - obj.p0.xy, lwh);
  let B = blurA(pp + obj.p0.xy, lwh);
  var band = 0.0;
  if (obj.p0.w > 0.5) { band = A * B; }
  else { let a2 = A * (1.0 - B); let b2 = B * (1.0 - A); band = a2 + b2 * (1.0 - a2); }
  band = band * sil * obj.p0.z;
  let bp = vec4<f32>(obj.p1.xyz * band, band);
  return bp + s0 * (1.0 - band);`,
  `${gp(2)}
  float sil = s0.a;
  if (sil <= 0.0) { frag = s0; return; }
  float A = blurA(pp - p0.xy, lwh);
  float B = blurA(pp + p0.xy, lwh);
  float band = 0.0;
  if (p0.w > 0.5) band = A * B;
  else { float a2 = A * (1.0 - B); float b2 = B * (1.0 - A); band = a2 + b2 * (1.0 - a2); }
  band *= sil * p0.z;
  vec4 bp = vec4(p1.xyz * band, band);
  frag = bp + s0 * (1.0 - band);`);

// ── Bevel (two-texture) ──────────────────────────────────────────────────────

/** tex2 = blurred layer (σ = size). p0 = light x, y, z, depth scale; p1 = highlight colour (linear), opacity; p2 = shadow colour (linear), opacity; p3 = lw, lh. Height = blurred silhouette; lit side adds, dark side multiplies. */
export const BEVEL_FX = fxTwo('bevel', 4,
  `${wp(3)}
  let sil = s0.a;
  if (sil <= 0.0) { return s0; }
  let xy = floor(pp) + 0.5;
  let hx1 = blurA(clamp(xy + vec2<f32>(1.0, 0.0), vec2<f32>(0.5), lwh - 0.5), lwh);
  let hx0 = blurA(clamp(xy - vec2<f32>(1.0, 0.0), vec2<f32>(0.5), lwh - 0.5), lwh);
  let hy1 = blurA(clamp(xy + vec2<f32>(0.0, 1.0), vec2<f32>(0.5), lwh - 0.5), lwh);
  let hy0 = blurA(clamp(xy - vec2<f32>(0.0, 1.0), vec2<f32>(0.5), lwh - 0.5), lwh);
  let nx = -(hx1 - hx0) * 0.5 * obj.p0.w; let ny = -(hy1 - hy0) * 0.5 * obj.p0.w;
  let len = sqrt(nx * nx + ny * ny + 1.0);
  let shade = (nx * obj.p0.x + ny * obj.p0.y + obj.p0.z) / len - obj.p0.z;
  if (shade == 0.0) { return s0; }
  if (shade > 0.0) {
    let ba = min(shade, 1.0) * obj.p1.w * sil;
    return min(s0 + vec4<f32>(obj.p1.xyz * ba, ba), vec4<f32>(1.0));
  }
  let ba = min(-shade, 1.0) * obj.p2.w * sil;
  let lo = vec4<f32>(obj.p2.xyz * ba, ba);
  return lo * s0 + lo * (1.0 - s0.a) + s0 * (1.0 - ba);`,
  `${gp(3)}
  float sil = s0.a;
  if (sil <= 0.0) { frag = s0; return; }
  vec2 xy = floor(pp) + 0.5;
  float hx1 = blurA(clamp(xy + vec2(1.0, 0.0), vec2(0.5), lwh - 0.5), lwh);
  float hx0 = blurA(clamp(xy - vec2(1.0, 0.0), vec2(0.5), lwh - 0.5), lwh);
  float hy1 = blurA(clamp(xy + vec2(0.0, 1.0), vec2(0.5), lwh - 0.5), lwh);
  float hy0 = blurA(clamp(xy - vec2(0.0, 1.0), vec2(0.5), lwh - 0.5), lwh);
  float nx = -(hx1 - hx0) * 0.5 * p0.w; float ny = -(hy1 - hy0) * 0.5 * p0.w;
  float len = sqrt(nx * nx + ny * ny + 1.0);
  float shade = (nx * p0.x + ny * p0.y + p0.z) / len - p0.z;
  if (shade == 0.0) { frag = s0; return; }
  if (shade > 0.0) {
    float ba = min(shade, 1.0) * p1.w * sil;
    frag = min(s0 + vec4(p1.xyz * ba, ba), vec4(1.0)); return;
  }
  float ba = min(-shade, 1.0) * p2.w * sil;
  vec4 lo = vec4(p2.xyz * ba, ba);
  frag = lo * s0 + lo * (1.0 - s0.a) + s0 * (1.0 - ba);`);

// ── Write-on ─────────────────────────────────────────────────────────────────

/** p0 = lw, lh, start x, y; p1 = dx, dy, completion t1, wobble amp; p2 = radius, tip span, taper on, steps; p3 = brush colour (linear), nx; p4 = ny. The disc chain of `writeOnData`, composited over the layer. */
export const WRITE_ON_FX = fx('write-on', 5,
  `${wp(0)}
  let start = obj.p0.zw; let dxy = obj.p1.xy; let t1 = obj.p1.z; let amp = obj.p1.w;
  let nrm = vec2<f32>(obj.p3.w, obj.p4.x);
  let steps = i32(obj.p2.w + 0.5);
  var disc = vec4<f32>(0.0);
  for (var k = 0; k <= 256; k = k + 1) {
    if (k > steps) { break; }
    let t = (f32(k) / f32(steps)) * t1;
    let bend = amp * (sin(t * 3.14159265359 * 3.1) * 0.7 + sin(t * 3.14159265359 * 7.3) * 0.3);
    let p = start + dxy * t + nrm * bend;
    let fromTip = (t1 - t) / obj.p2.y;
    let thin = select(1.0, 0.25 + 0.75 * fromTip, obj.p2.z > 0.5 && fromTip < 1.0);
    let rad = obj.p2.x * thin;
    let d = length(pp - p);
    if (d > rad) { continue; }
    let tt = d / max(0.000001, rad);
    let cover = select(0.5 + 0.5 * cos(((tt - 0.6) / 0.4) * 3.14159265359), 1.0, tt < 0.6);
    let sa = clamp(cover, 0.0, 1.0);
    disc = vec4<f32>(obj.p3.xyz * sa, sa) + disc * (1.0 - sa);
  }
  return disc + s0 * (1.0 - disc.a);`,
  `${gp(0)}
  vec2 start = p0.zw; vec2 dxy = p1.xy; float t1 = p1.z; float amp = p1.w;
  vec2 nrm = vec2(p3.w, p4.x);
  int steps = int(p2.w + 0.5);
  vec4 disc = vec4(0.0);
  for (int k = 0; k <= 256; k++) {
    if (k > steps) break;
    float t = (float(k) / float(steps)) * t1;
    float bend = amp * (sin(t * 3.14159265359 * 3.1) * 0.7 + sin(t * 3.14159265359 * 7.3) * 0.3);
    vec2 p = start + dxy * t + nrm * bend;
    float fromTip = (t1 - t) / p2.y;
    float thin = (p2.z > 0.5 && fromTip < 1.0) ? 0.25 + 0.75 * fromTip : 1.0;
    float rad = p2.x * thin;
    float d = length(pp - p);
    if (d > rad) continue;
    float tt = d / max(0.000001, rad);
    float cover = (tt < 0.6) ? 1.0 : 0.5 + 0.5 * cos(((tt - 0.6) / 0.4) * 3.14159265359);
    float sa = clamp(cover, 0.0, 1.0);
    disc = vec4(p3.xyz * sa, sa) + disc * (1.0 - sa);
  }
  frag = disc + s0 * (1.0 - disc.a);`);

// ── Star Burst ───────────────────────────────────────────────────────────────

/** p0 = lw, lh, star count, phase; p1 = size, blend k, seed, max radius; p2 = star colour (sRGB). Every star is visited; the bounding-box reject keeps it cheap. */
export const STAR_BURST_FX = fx('star-burst', 3,
  `${wp(0)}
  let c = lwh * 0.5; let n = i32(obj.p0.z + 0.5); let sd = i32(obj.p1.z);
  var acc = vec3<f32>(0.0); var aMax = 0.0;
  for (var i = 0; i < 400; i = i + 1) {
    if (i >= n) { break; }
    let ang = hash2u(i, sd) * 6.28318530718;
    let speed = 0.25 + 0.75 * hash2u(i, sd + 101);
    let t = fract(obj.p0.w / 1000.0 * speed + hash2u(i, sd + 202));
    let dirv = vec2<f32>(cos(ang), sin(ang));
    let p = c + dirv * (t * t * obj.p1.w);
    if (p.x < -4.0 || p.x > lwh.x + 4.0 || p.y < -4.0 || p.y > lwh.y + 4.0) { continue; }
    let sz = max(0.5, obj.p1.x) * (0.4 + 0.6 * t);
    let spikeLen = sz * 4.0;
    let d = pp - p;
    if (abs(d.x) > spikeLen || abs(d.y) > spikeLen) { continue; }
    let core = max(0.5, sz * 0.5); let spikeW = max(0.4, sz * 0.22);
    var inten = exp(-dot(d, d) / (core * core));
    let ax = abs(d.x); let ay = abs(d.y);
    inten = inten + 0.85 * exp(-(ay * ay) / (spikeW * spikeW)) * pow(max(0.0, 1.0 - ax / spikeLen), 2.0);
    inten = inten + 0.85 * exp(-(ax * ax) / (spikeW * spikeW)) * pow(max(0.0, 1.0 - ay / spikeLen), 2.0);
    let du = abs(d.x * 0.70710678 + d.y * 0.70710678); let dv = abs(-d.x * 0.70710678 + d.y * 0.70710678);
    inten = inten + 0.35 * exp(-(dv * dv) / (spikeW * spikeW)) * pow(max(0.0, 1.0 - du / (spikeLen * 0.5)), 2.0);
    inten = inten + 0.35 * exp(-(du * du) / (spikeW * spikeW)) * pow(max(0.0, 1.0 - dv / (spikeLen * 0.5)), 2.0);
    let sInt = clamp(inten * (0.25 + 0.75 * t), 0.0, 1.0);
    if (sInt <= 0.003) { continue; }
    let hp = clamp(round(c + dirv * obj.p1.w * 0.5), vec2<f32>(0.0), lwh - 1.0) + 0.5;
    let hs = decodeS(samplePx(hp, lwh));
    let mixT = select(1.0, 0.5, hs.a > 8.0 / 255.0);
    let col = mix(hs.rgb, obj.p2.xyz, mixT);
    acc = min(acc + col * sInt, vec3<f32>(1.0));
    aMax = max(aMax, sInt);
  }
  let k = obj.p1.y;
  if (k <= 0.0) { return encodeOut(acc, aMax); }
  let c0 = decodeS(s0);
  let a = c0.a * k + aMax * (1.0 - k);
  if (a <= 0.0) { return vec4<f32>(0.0); }
  return encodeOut((c0.rgb * c0.a * k + acc * aMax * (1.0 - k)) / a, a);`,
  `${gp(0)}
  vec2 c = lwh * 0.5; int n = int(p0.z + 0.5); int sd = int(p1.z);
  vec3 acc = vec3(0.0); float aMax = 0.0;
  for (int i = 0; i < 400; i++) {
    if (i >= n) break;
    float ang = hash2u(i, sd) * 6.28318530718;
    float speed = 0.25 + 0.75 * hash2u(i, sd + 101);
    float t = fract(p0.w / 1000.0 * speed + hash2u(i, sd + 202));
    vec2 dirv = vec2(cos(ang), sin(ang));
    vec2 p = c + dirv * (t * t * p1.w);
    if (p.x < -4.0 || p.x > lwh.x + 4.0 || p.y < -4.0 || p.y > lwh.y + 4.0) continue;
    float sz = max(0.5, p1.x) * (0.4 + 0.6 * t);
    float spikeLen = sz * 4.0;
    vec2 d = pp - p;
    if (abs(d.x) > spikeLen || abs(d.y) > spikeLen) continue;
    float core = max(0.5, sz * 0.5); float spikeW = max(0.4, sz * 0.22);
    float inten = exp(-dot(d, d) / (core * core));
    float ax = abs(d.x); float ay = abs(d.y);
    inten += 0.85 * exp(-(ay * ay) / (spikeW * spikeW)) * pow(max(0.0, 1.0 - ax / spikeLen), 2.0);
    inten += 0.85 * exp(-(ax * ax) / (spikeW * spikeW)) * pow(max(0.0, 1.0 - ay / spikeLen), 2.0);
    float du = abs(d.x * 0.70710678 + d.y * 0.70710678); float dv = abs(-d.x * 0.70710678 + d.y * 0.70710678);
    inten += 0.35 * exp(-(dv * dv) / (spikeW * spikeW)) * pow(max(0.0, 1.0 - du / (spikeLen * 0.5)), 2.0);
    inten += 0.35 * exp(-(du * du) / (spikeW * spikeW)) * pow(max(0.0, 1.0 - dv / (spikeLen * 0.5)), 2.0);
    float sInt = clamp(inten * (0.25 + 0.75 * t), 0.0, 1.0);
    if (sInt <= 0.003) continue;
    vec2 hp = clamp(round(c + dirv * p1.w * 0.5), vec2(0.0), lwh - 1.0) + 0.5;
    vec4 hs = decodeS(samplePx(hp, lwh));
    float mixT = (hs.a > 8.0 / 255.0) ? 0.5 : 1.0;
    vec3 col = mix(hs.rgb, p2.xyz, mixT);
    acc = min(acc + col * sInt, vec3(1.0));
    aMax = max(aMax, sInt);
  }
  float k = p1.y;
  if (k <= 0.0) { frag = encodeOut(acc, aMax); return; }
  vec4 c0 = decodeS(s0);
  float a = c0.a * k + aMax * (1.0 - k);
  if (a <= 0.0) { frag = vec4(0.0); return; }
  frag = encodeOut((c0.rgb * c0.a * k + acc * aMax * (1.0 - k)) / a, a);`);

// ── Snowfall (one flake per cell) ────────────────────────────────────────────

/** p0 = lw, lh, cell, size; p1 = evolution, wind, opacity, seed; p2 = flake colour (linear), columns. Fragment visits its column ± 1, every row. */
export const SNOWFALL_FX = fx('snowfall', 3,
  `${wp(0)}
  let cell = obj.p0.z; let ev = obj.p1.x; let sd = i32(obj.p1.w);
  let cols = i32(obj.p2.w + 0.5); let rows = i32(ceil(lwh.y / cell));
  let drift = (obj.p1.y / 100.0) * ((ev / 100.0) * lwh.y * 0.8) * 0.4;
  let colF = floor(((pp.x - drift) % lwh.x + lwh.x) % lwh.x / cell);
  var res = s0;
  for (var dc = -1; dc <= 1; dc = dc + 1) {
    let ci = ((i32(colF) + dc) % cols + cols) % cols;
    for (var row = 0; row < 64; row = row + 1) {
      if (row >= rows) { break; }
      let id = row * cols + ci;
      let fx0 = (f32(ci) + hash2u(id, sd)) * cell;
      let fy0 = (f32(row) + hash2u(id, sd + 11)) * cell;
      let speed = 0.4 + 0.8 * hash2u(id, sd + 23);
      let swayAmp = 2.0 + 8.0 * hash2u(id, sd + 37);
      let drop = (ev / 100.0) * lwh.y * speed;
      let sway = sin(ev / 40.0 + f32(id) * 1.7) * swayAmp;
      var px = ((fx0 + sway + drift) % lwh.x + lwh.x) % lwh.x;
      let py = ((fy0 + drop) % (lwh.y + 8.0) + (lwh.y + 8.0)) % (lwh.y + 8.0) - 4.0;
      var dx = px - pp.x;
      if (dx > lwh.x * 0.5) { dx = dx - lwh.x; } else if (dx < -lwh.x * 0.5) { dx = dx + lwh.x; }
      let rad = max(0.5, obj.p0.w) * (0.55 + 0.45 * hash2u(id, sd + 51));
      let d = length(vec2<f32>(dx, py - pp.y));
      if (d > rad) { continue; }
      let t = d / max(0.000001, rad);
      let cover = select(0.5 + 0.5 * cos(((t - 0.6) / 0.4) * 3.14159265359), 1.0, t < 0.6);
      let sa = clamp(obj.p1.z * (0.6 + 0.4 * speed) * cover, 0.0, 1.0);
      res = vec4<f32>(obj.p2.xyz * sa, sa) + res * (1.0 - sa);
    }
  }
  return res;`,
  `${gp(0)}
  float cell = p0.z; float ev = p1.x; int sd = int(p1.w);
  int cols = int(p2.w + 0.5); int rows = int(ceil(lwh.y / cell));
  float drift = (p1.y / 100.0) * ((ev / 100.0) * lwh.y * 0.8) * 0.4;
  float colF = floor(mod(pp.x - drift, lwh.x) / cell);
  vec4 res = s0;
  for (int dc = -1; dc <= 1; dc++) {
    int ci = ((int(colF) + dc) % cols + cols) % cols;
    for (int row = 0; row < 64; row++) {
      if (row >= rows) break;
      int id = row * cols + ci;
      float fx0 = (float(ci) + hash2u(id, sd)) * cell;
      float fy0 = (float(row) + hash2u(id, sd + 11)) * cell;
      float speed = 0.4 + 0.8 * hash2u(id, sd + 23);
      float swayAmp = 2.0 + 8.0 * hash2u(id, sd + 37);
      float drop = (ev / 100.0) * lwh.y * speed;
      float sway = sin(ev / 40.0 + float(id) * 1.7) * swayAmp;
      float px = mod(fx0 + sway + drift, lwh.x);
      float py = mod(fy0 + drop, lwh.y + 8.0) - 4.0;
      float dx = px - pp.x;
      if (dx > lwh.x * 0.5) dx -= lwh.x; else if (dx < -lwh.x * 0.5) dx += lwh.x;
      float rad = max(0.5, p0.w) * (0.55 + 0.45 * hash2u(id, sd + 51));
      float d = length(vec2(dx, py - pp.y));
      if (d > rad) continue;
      float t = d / max(0.000001, rad);
      float cover = (t < 0.6) ? 1.0 : 0.5 + 0.5 * cos(((t - 0.6) / 0.4) * 3.14159265359);
      float sa = clamp(p1.z * (0.6 + 0.4 * speed) * cover, 0.0, 1.0);
      res = vec4(p2.xyz * sa, sa) + res * (1.0 - sa);
    }
  }
  frag = res;`);

// ── Rainfall (one streak per cell) ───────────────────────────────────────────

/** p0 = lw, lh, cell, streak length; p1 = evolution, opacity, seed, dir x; p2 = rain colour (linear), dir y; p3 = columns, rows. Fragment visits the cells a streak through it can start in. */
export const RAINFALL_FX = fx('rainfall', 4,
  `${wp(0)}
  let cell = obj.p0.z; let len = obj.p0.w; let sd = i32(obj.p1.z);
  let dir = vec2<f32>(obj.p1.w, obj.p2.w);
  let cols = i32(obj.p3.x + 0.5); let rows = i32(obj.p3.y + 0.5);
  let travel = (obj.p1.x / 100.0) * lwh.y * 3.0 * 1.1;
  let shift = dir * travel;
  let wrapH = lwh.y + len;
  // Un-shifted position of this fragment; a streak covering it starts within len further along dir.
  let base = pp - shift;
  let lo = floor((base + min(dir * len, vec2<f32>(0.0))) / cell) - 1.0;
  let hi = floor((base + max(dir * len, vec2<f32>(0.0))) / cell) + 1.0;
  var res = s0;
  for (var j = 0; j < 8; j = j + 1) {
    let ry = i32(lo.y) + j;
    if (f32(ry) > hi.y) { break; }
    for (var i = 0; i < 8; i = i + 1) {
      let rx = i32(lo.x) + i;
      if (f32(rx) > hi.x) { break; }
      let ci = (rx % cols + cols) % cols; let ri = (ry % rows + rows) % rows;
      let id = ri * cols + ci;
      let fx0 = (f32(rx) + hash2u(id, sd)) * cell;
      let fy0 = (f32(ry) + hash2u(id, sd + 11)) * cell;
      var p0x = fx0 + shift.x; var p0y = fy0 + shift.y;
      // Bring the streak origin into the fragment's neighbourhood across the wraps.
      p0x = p0x - lwh.x * round((p0x - pp.x) / lwh.x);
      p0y = p0y - wrapH * round((p0y - pp.y) / wrapH);
      let rel = vec2<f32>(p0x, p0y) - pp;
      let along = dot(rel, dir);
      if (along < 0.0 || along > len) { continue; }
      let perp = abs(rel.x * dir.y - rel.y * dir.x);
      if (perp > 1.0) { continue; }
      let sa = clamp(obj.p1.y * (1.0 - along / len) * 0.9 * clamp(1.2 - perp, 0.0, 1.0), 0.0, 1.0);
      res = vec4<f32>(obj.p2.xyz * sa, sa) + res * (1.0 - sa);
    }
  }
  return res;`,
  `${gp(0)}
  float cell = p0.z; float len = p0.w; int sd = int(p1.z);
  vec2 dir = vec2(p1.w, p2.w);
  int cols = int(p3.x + 0.5); int rows = int(p3.y + 0.5);
  float travel = (p1.x / 100.0) * lwh.y * 3.0 * 1.1;
  vec2 shift = dir * travel;
  float wrapH = lwh.y + len;
  vec2 base = pp - shift;
  vec2 lo = floor((base + min(dir * len, vec2(0.0))) / cell) - 1.0;
  vec2 hi = floor((base + max(dir * len, vec2(0.0))) / cell) + 1.0;
  vec4 res = s0;
  for (int j = 0; j < 8; j++) {
    int ry = int(lo.y) + j;
    if (float(ry) > hi.y) break;
    for (int i = 0; i < 8; i++) {
      int rx = int(lo.x) + i;
      if (float(rx) > hi.x) break;
      int ci = (rx % cols + cols) % cols; int ri = (ry % rows + rows) % rows;
      int id = ri * cols + ci;
      float fx0 = (float(rx) + hash2u(id, sd)) * cell;
      float fy0 = (float(ry) + hash2u(id, sd + 11)) * cell;
      float p0x = fx0 + shift.x; float p0y = fy0 + shift.y;
      p0x -= lwh.x * round((p0x - pp.x) / lwh.x);
      p0y -= wrapH * round((p0y - pp.y) / wrapH);
      vec2 rel = vec2(p0x, p0y) - pp;
      float along = dot(rel, dir);
      if (along < 0.0 || along > len) continue;
      float perp = abs(rel.x * dir.y - rel.y * dir.x);
      if (perp > 1.0) continue;
      float sa = clamp(p1.y * (1.0 - along / len) * 0.9 * clamp(1.2 - perp, 0.0, 1.0), 0.0, 1.0);
      res = vec4(p2.xyz * sa, sa) + res * (1.0 - sa);
    }
  }
  frag = res;`);

export const FX_ROUND_THIRTEEN_SHADERS: readonly ShaderSource[] = [
  CARTOON_FX, INTERIOR_STYLE_FX, SATIN_FX, BEVEL_FX, WRITE_ON_FX, STAR_BURST_FX, SNOWFALL_FX, RAINFALL_FX,
];
