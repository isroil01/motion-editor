/**
 * Round eight: the KEYING set, ported off the CPU bake.
 *
 * Keylight, Linear Color Key, Luma Key, Color Key, Color Range, Extract, Spill
 * Suppressor, Simple Choker, Matte Choker and Wave Warp — the effects that go
 * on footage after the blurs, and every one of them forced a per-frame CPU
 * bake of the whole frame. Same prolog and uniform shape as round six
 * (`fxShader`: mvp + uvRect + N vec4s + fxBox), same discipline: each fragment
 * mirrors its CPU kernel's arithmetic, and the kernels stay the reference.
 *
 * ## The alpha convention
 *
 * The CPU kernels run on STRAIGHT-alpha `ImageData` and write only the matte.
 * The chain's textures are PREMULTIPLIED. A keyer that scales alpha by `k`
 * therefore returns `sample * k` — the premultiplied colour scales with its
 * coverage and the straight colour underneath is unchanged, which is exactly
 * what the kernel's "write data[i+3], leave RGB alone" means. The two that do
 * touch colour (Keylight's despill, Spill Suppressor) decode to straight
 * display-sRGB, edit there like the byte kernels, and re-encode.
 *
 * ## Luma weights
 *
 * Two sets, deliberately, because the CPU uses two: `keyingEffects.ts`
 * (Linear Color Key, Luma Key) takes Rec.601 from `colorEffects.luma`, and
 * `aeKeyingAdvanced.ts` (Color Range, Spill Suppressor) takes Rec.709 from
 * `colorSpace.luma`. Matching each kernel's own weights is the parity contract;
 * unifying them here would move every existing matte.
 *
 * ## Matte morphology
 *
 * Choke / spread / grey-level softness are separable alpha passes over the
 * LAYER, so they are two generic shaders (`alpha-morph`, `alpha-box`) that the
 * composition pass chains H then V, as many times as the effect asks. Border
 * handling differs per kernel and is a parameter: 0 ignores taps off the layer
 * (Keylight's `chokeAlpha`), 1 reads them as transparent (`simpleChokerData`,
 * so a full-frame matte still chokes at its edge), 2 clamps to the border
 * (`matteChokerData`, so a subject touching the frame is not cropped).
 */

import type { ShaderSource } from './builtin';
import { fxShader } from './fxRoundSix';

// ── Shared snippets ──────────────────────────────────────────────────────────

/** Straight display-sRGB colour + alpha of the chain sample at `uv`. */
const DECODE_WGSL = `  let s = textureSampleLevel(tex, smp, uv, 0.0);
  let a0 = s.a;
  if (a0 <= 0.0) { return s; }
  let c = linearToSrgbRgb(s.rgb / a0);`;
const DECODE_GLSL = `  vec4 s = textureLod(uTex, vUv, 0.0);
  float a0 = s.a;
  if (a0 <= 0.0) { frag = s; return; }
  vec3 c = linearToSrgbRgb(s.rgb / a0);`;

/** `colorSpace.smoothstep`: a step when the edges coincide, never NaN. */
export const SSTEP_WGSL = `fn sstep(e0 : f32, e1 : f32, x : f32) -> f32 {
  if (e1 <= e0) { return select(1.0, 0.0, x < e0); }
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
fn lum709(c : vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }
fn ch3(c : vec3<f32>, i : f32) -> f32 { if (i < 0.5) { return c.r; } if (i < 1.5) { return c.g; } return c.b; }
`;
export const SSTEP_GLSL = `float sstep(float e0, float e1, float x) {
  if (e1 <= e0) return (x < e0) ? 0.0 : 1.0;
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
float lum709(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float ch3(vec3 c, float i) { if (i < 0.5) return c.r; if (i < 1.5) return c.g; return c.b; }
`;

/** HSL hue (0..1, 0 for grey) and saturation — `colorSpace.rgbToHsl`, and
 *  `keyingEffects.hueOf`, which is the same hue formula. */
export const HSL_WGSL = `fn hueOf(c : vec3<f32>) -> f32 {
  let mx = max(c.r, max(c.g, c.b)); let mn = min(c.r, min(c.g, c.b)); let d = mx - mn;
  if (d <= 0.0) { return 0.0; }
  var h = 0.0;
  if (mx == c.r) { h = ((c.g - c.b) / d) % 6.0; }
  else if (mx == c.g) { h = (c.b - c.r) / d + 2.0; }
  else { h = (c.r - c.g) / d + 4.0; }
  h = h / 6.0;
  return select(h, h + 1.0, h < 0.0);
}
fn satOf(c : vec3<f32>) -> f32 {
  let mx = max(c.r, max(c.g, c.b)); let mn = min(c.r, min(c.g, c.b)); let d = mx - mn;
  if (d <= 0.0) { return 0.0; }
  let l = (mx + mn) * 0.5;
  return select(d / (mx + mn), d / (2.0 - mx - mn), l > 0.5);
}
fn hueDist(a : f32, b : f32) -> f32 { let d = abs(a - b) % 1.0; return select(d, 1.0 - d, d > 0.5); }
`;
export const HSL_GLSL = `float hueOf(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b)); float d = mx - mn;
  if (d <= 0.0) return 0.0;
  float h;
  if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  h /= 6.0;
  return (h < 0.0) ? h + 1.0 : h;
}
float satOf(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b)); float d = mx - mn;
  if (d <= 0.0) return 0.0;
  float l = (mx + mn) * 0.5;
  return (l > 0.5) ? d / (2.0 - mx - mn) : d / (mx + mn);
}
float hueDist(float a, float b) { float d = mod(abs(a - b), 1.0); return (d > 0.5) ? 1.0 - d : d; }
`;

/**
 * `fxShader` puts the fragment body inside `fs()` / `main()`, so helper
 * functions have to be hoisted above it. This wraps the body with a prelude
 * of helpers by splicing them in before the entry point.
 */
export function withHelpers(src: ShaderSource, wgslHelpers: string, glslHelpers: string): ShaderSource {
  return {
    name: src.name,
    wgsl: src.wgsl.replace('@fragment fn fs(', `${wgslHelpers}\n@fragment fn fs(`),
    glsl: {
      vertex: src.glsl.vertex,
      fragment: src.glsl.fragment.replace('void main() {', `${glslHelpers}\nvoid main() {`),
    },
  };
}

// ── Keylight ─────────────────────────────────────────────────────────────────

/**
 * p0 = screen colour (display sRGB 0..1), balance; p1 = gain, clipBlack,
 * clipWhite, despill; p2 = primary / secondary-A / secondary-B channel index,
 * reference denominator (`screenAmount` of the screen colour itself).
 * Mirrors `applyKeyData`: alpha is MULTIPLIED by the clipped matte, and
 * despill pulls the primary down toward the brighter secondary on kept pixels.
 */
export const KEYLIGHT_FX = withHelpers(fxShader('keylight', 3,
  `${DECODE_WGSL}
  let bal = obj.p0.w;
  let s1 = ch3(c, obj.p2.y); let s2 = ch3(c, obj.p2.z);
  let prim = ch3(c, obj.p2.x);
  let sec = bal * max(s1, s2) + (1.0 - bal) * min(s1, s2);
  let amt = ((prim - sec) / obj.p2.w) * obj.p1.x;
  let raw = 1.0 - amt;
  var alpha = 0.0;
  if (obj.p1.z <= obj.p1.y) { alpha = select(1.0, 0.0, raw <= obj.p1.y); }
  else { alpha = clamp((raw - obj.p1.y) / (obj.p1.z - obj.p1.y), 0.0, 1.0); }
  var c2 = c;
  if (obj.p1.w > 0.0 && alpha > 0.0) {
    let cap = max(s1, s2);
    if (prim > cap) {
      let np = prim + (cap - prim) * obj.p1.w;
      if (obj.p2.x < 0.5) { c2.r = np; } else if (obj.p2.x < 1.5) { c2.g = np; } else { c2.b = np; }
    }
  }
  return encodeOut(c2, a0 * alpha);`,
  `${DECODE_GLSL}
  float bal = p0.w;
  float s1 = ch3(c, p2.y); float s2 = ch3(c, p2.z);
  float prim = ch3(c, p2.x);
  float sec = bal * max(s1, s2) + (1.0 - bal) * min(s1, s2);
  float amt = ((prim - sec) / p2.w) * p1.x;
  float raw = 1.0 - amt;
  float alpha;
  if (p1.z <= p1.y) alpha = (raw <= p1.y) ? 0.0 : 1.0;
  else alpha = clamp((raw - p1.y) / (p1.z - p1.y), 0.0, 1.0);
  vec3 c2 = c;
  if (p1.w > 0.0 && alpha > 0.0) {
    float cap = max(s1, s2);
    if (prim > cap) {
      float np = prim + (cap - prim) * p1.w;
      if (p2.x < 0.5) c2.r = np; else if (p2.x < 1.5) c2.g = np; else c2.b = np;
    }
  }
  frag = encodeOut(c2, a0 * alpha);`), SSTEP_WGSL, SSTEP_GLSL);

// ── Linear Color Key ─────────────────────────────────────────────────────────

/**
 * p0 = key colour (0..1), mode (0 rgb, 1 hue, 2 chroma); p1 = tolerance,
 * softness, keepMatched, key hue; p2.x = key luma (Rec.601, 0..1).
 * Distances are the kernel's, rescaled from bytes to unit: √3 stands in for
 * 441.673 and the ½-byte black threshold becomes 0.5/255.
 */
export const LINEAR_COLOR_KEY_FX = withHelpers(fxShader('linear-color-key', 3,
  `${DECODE_WGSL}
  let key = obj.p0.xyz;
  var distance = 0.0;
  if (obj.p0.w > 1.5) {
    let pixLum = lum601(c);
    if (pixLum <= 0.5 / 255.0) { distance = select(1.0, 0.0, obj.p2.x <= 0.5 / 255.0); }
    else { let k = obj.p2.x / pixLum; distance = min(1.0, length(c * k - key) / 1.7320508); }
  } else if (obj.p0.w > 0.5) {
    let dh = abs(hueOf(c) - obj.p1.w);
    distance = min(dh, 1.0 - dh) * 2.0;
  } else {
    distance = min(1.0, length(c - key) / 1.7320508);
  }
  let tol = obj.p1.x; let soft = obj.p1.y;
  var matched = 0.0;
  if (distance <= tol) { matched = 1.0; }
  else if (soft <= 0.0 || distance >= tol + soft) { matched = 0.0; }
  else { matched = 1.0 - (distance - tol) / soft; }
  let keep = select(1.0 - matched, matched, obj.p1.z > 0.5);
  return s * keep;`,
  `${DECODE_GLSL}
  vec3 key = p0.xyz;
  float distance;
  if (p0.w > 1.5) {
    float pixLum = lum601(c);
    if (pixLum <= 0.5 / 255.0) distance = (p2.x <= 0.5 / 255.0) ? 0.0 : 1.0;
    else { float k = p2.x / pixLum; distance = min(1.0, length(c * k - key) / 1.7320508); }
  } else if (p0.w > 0.5) {
    float dh = abs(hueOf(c) - p1.w);
    distance = min(dh, 1.0 - dh) * 2.0;
  } else {
    distance = min(1.0, length(c - key) / 1.7320508);
  }
  float tol = p1.x; float soft = p1.y;
  float matched;
  if (distance <= tol) matched = 1.0;
  else if (soft <= 0.0 || distance >= tol + soft) matched = 0.0;
  else matched = 1.0 - (distance - tol) / soft;
  float keep = (p1.z > 0.5) ? matched : 1.0 - matched;
  frag = s * keep;`), HSL_WGSL, HSL_GLSL);

// ── Luma Key ─────────────────────────────────────────────────────────────────

/** p0 = type (0 brighter, 1 darker, 2 similar, 3 dissimilar), cut, tol, soft — all on the 0..1 luma scale. */
export const LUMA_KEY_FX = fxShader('luma-key', 1,
  `${DECODE_WGSL}
  let l = lum601(c);
  let t = obj.p0.x; let cut = obj.p0.y; let tol = obj.p0.z; let soft = obj.p0.w;
  var into = 0.0;
  if (t < 0.5) { into = l - cut + tol; }
  else if (t < 1.5) { into = cut - l + tol; }
  else if (t < 2.5) { into = tol - abs(l - cut); }
  else { into = abs(l - cut) - tol; }
  var alpha = 1.0;
  if (into > 0.0) { alpha = select(clamp(1.0 - into / soft, 0.0, 1.0), 0.0, soft <= 0.0); }
  return s * alpha;`,
  `${DECODE_GLSL}
  float l = lum601(c);
  float t = p0.x; float cut = p0.y; float tol = p0.z; float soft = p0.w;
  float into;
  if (t < 0.5) into = l - cut + tol;
  else if (t < 1.5) into = cut - l + tol;
  else if (t < 2.5) into = tol - abs(l - cut);
  else into = abs(l - cut) - tol;
  float alpha = 1.0;
  if (into > 0.0) alpha = (soft <= 0.0) ? 0.0 : clamp(1.0 - into / soft, 0.0, 1.0);
  frag = s * alpha;`);

// ── Color Key ────────────────────────────────────────────────────────────────

/** p0 = key colour (0..1), tolerance (fraction of the RGB diagonal); p1.x = edge softness (same units). */
export const COLOR_KEY_FX = withHelpers(fxShader('color-key', 2,
  `${DECODE_WGSL}
  let d = length(c - obj.p0.xyz) / 1.7320508;
  let keep = sstep(obj.p0.w, obj.p0.w + obj.p1.x, d);
  return s * keep;`,
  `${DECODE_GLSL}
  float d = length(c - p0.xyz) / 1.7320508;
  float keep = sstep(p0.w, p0.w + p1.x, d);
  frag = s * keep;`), SSTEP_WGSL, SSTEP_GLSL);

// ── Color Range ──────────────────────────────────────────────────────────────

/**
 * p0 = key projected (y, u, v) in BYTE units, mode (0 Lab-ish, 1 YUV, 2 RGB);
 * p1 = lo, hi (byte distance), luma weight. The kernel projects in 0..255, so
 * the fragment scales its decoded colour up to bytes before projecting.
 */
export const COLOR_RANGE_FX = withHelpers(fxShader('color-range', 2,
  `${DECODE_WGSL}
  let b = c * 255.0;
  let mode = obj.p0.w;
  var pr = b;
  if (mode < 1.5) {
    let y = lum709(b);
    if (mode > 0.5) { pr = vec3<f32>(y, (b.b - y) * 0.565, (b.r - y) * 0.713); }
    else { pr = vec3<f32>(y, (b.r - b.g) * 0.5, (b.g - b.b) * 0.5); }
  }
  let dy = (pr.x - obj.p0.x) * obj.p1.z;
  let du = pr.y - obj.p0.y; let dv = pr.z - obj.p0.z;
  let d = sqrt(dy * dy + du * du + dv * dv);
  return s * sstep(obj.p1.x, obj.p1.y, d);`,
  `${DECODE_GLSL}
  vec3 b = c * 255.0;
  float mode = p0.w;
  vec3 pr = b;
  if (mode < 1.5) {
    float y = lum709(b);
    if (mode > 0.5) pr = vec3(y, (b.b - y) * 0.565, (b.r - y) * 0.713);
    else pr = vec3(y, (b.r - b.g) * 0.5, (b.g - b.b) * 0.5);
  }
  float dy = (pr.x - p0.x) * p1.z;
  float du = pr.y - p0.y; float dv = pr.z - p0.z;
  float d = sqrt(dy * dy + du * du + dv * dv);
  frag = s * sstep(p1.x, p1.y, d);`), SSTEP_WGSL, SSTEP_GLSL);

// ── Extract ──────────────────────────────────────────────────────────────────

/** p0 = channel (0 luma, 1 r, 2 g, 3 b, 4 alpha), black, white, blackSoft; p1 = whiteSoft, invert. Byte units. */
export const EXTRACT_FX = withHelpers(fxShader('extract', 2,
  `${DECODE_WGSL}
  let ch = obj.p0.x;
  var v = lum709(c * 255.0);
  if (ch > 0.5 && ch < 1.5) { v = c.r * 255.0; }
  else if (ch >= 1.5 && ch < 2.5) { v = c.g * 255.0; }
  else if (ch >= 2.5 && ch < 3.5) { v = c.b * 255.0; }
  else if (ch >= 3.5) { v = a0 * 255.0; }
  let up = sstep(obj.p0.y - obj.p0.w, obj.p0.y + obj.p0.w, v);
  let down = 1.0 - sstep(obj.p0.z - obj.p1.x, obj.p0.z + obj.p1.x, v);
  var m = clamp(up * down, 0.0, 1.0);
  if (obj.p1.y > 0.5) { m = 1.0 - m; }
  return s * m;`,
  `${DECODE_GLSL}
  float ch = p0.x;
  float v = lum709(c * 255.0);
  if (ch > 0.5 && ch < 1.5) v = c.r * 255.0;
  else if (ch >= 1.5 && ch < 2.5) v = c.g * 255.0;
  else if (ch >= 2.5 && ch < 3.5) v = c.b * 255.0;
  else if (ch >= 3.5) v = a0 * 255.0;
  float up = sstep(p0.y - p0.w, p0.y + p0.w, v);
  float down = 1.0 - sstep(p0.z - p1.x, p0.z + p1.x, v);
  float m = clamp(up * down, 0.0, 1.0);
  if (p1.y > 0.5) m = 1.0 - m;
  frag = s * m;`), SSTEP_WGSL, SSTEP_GLSL);

// ── Spill Suppressor ─────────────────────────────────────────────────────────

/** p0 = key hue (0..1), strength, preserveLuma. Colour-only; alpha untouched. */
export const SPILL_SUPPRESSOR_FX = withHelpers(fxShader('spill-suppressor', 1,
  `${DECODE_WGSL}
  let kh = obj.p0.x;
  let near = (1.0 - sstep(0.08, 0.25, hueDist(hueOf(c), kh))) * clamp(satOf(c) * 2.0, 0.0, 1.0) * obj.p0.y;
  if (near <= 0.0) { return s; }
  let before = lum709(c);
  var n = c;
  if (kh > 0.25 && kh < 0.45) { n.g = c.g + (min(c.g, (c.r + c.b) * 0.5) - c.g) * near; }
  else if (kh >= 0.45 && kh < 0.75) { n.b = c.b + (min(c.b, (c.r + c.g) * 0.5) - c.b) * near; }
  else { n.r = c.r + (min(c.r, (c.g + c.b) * 0.5) - c.r) * near; }
  if (obj.p0.z > 0.5) {
    let after = lum709(n);
    if (after > 0.001 / 255.0) { n = n * (before / after); }
  }
  return encodeOut(n, a0);`,
  `${DECODE_GLSL}
  float kh = p0.x;
  float near = (1.0 - sstep(0.08, 0.25, hueDist(hueOf(c), kh))) * clamp(satOf(c) * 2.0, 0.0, 1.0) * p0.y;
  if (near <= 0.0) { frag = s; return; }
  float before = lum709(c);
  vec3 n = c;
  if (kh > 0.25 && kh < 0.45) n.g = c.g + (min(c.g, (c.r + c.b) * 0.5) - c.g) * near;
  else if (kh >= 0.45 && kh < 0.75) n.b = c.b + (min(c.b, (c.r + c.g) * 0.5) - c.b) * near;
  else n.r = c.r + (min(c.r, (c.g + c.b) * 0.5) - c.r) * near;
  if (p0.z > 0.5) {
    float after = lum709(n);
    if (after > 0.001 / 255.0) n *= before / after;
  }
  frag = encodeOut(n, a0);`), SSTEP_WGSL + HSL_WGSL, SSTEP_GLSL + HSL_GLSL);

// ── Wave Warp ────────────────────────────────────────────────────────────────

/**
 * p0 = displacement direction (dx, dy), wave number k, phase (rad);
 * p1 = height, lw, lh. `waveWarpData` samples with edge-CLAMPED bilinear
 * taps, so the source position is clamped to the layer rather than read as
 * transparent — a wave never pulls emptiness in from outside the layer.
 */
export const WAVE_WARP_FX = fxShader('wave-warp', 2,
  `  let lwh = obj.p1.yz;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return textureSampleLevel(tex, smp, uv, 0.0); }
  let dir = obj.p0.xy;
  let along = pp.x * (-dir.y) + pp.y * dir.x;
  let disp = sin(along * obj.p0.z + obj.p0.w) * obj.p1.x;
  let sp = clamp(pp - dir * disp, vec2<f32>(0.5, 0.5), lwh - vec2<f32>(0.5, 0.5));
  return textureSampleLevel(tex, smp, layerUv(sp, lwh), 0.0);`,
  `  vec2 lwh = p1.yz;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = textureLod(uTex, vUv, 0.0); return; }
  vec2 dir = p0.xy;
  float along = pp.x * (-dir.y) + pp.y * dir.x;
  float disp = sin(along * p0.z + p0.w) * p1.x;
  vec2 sp = clamp(pp - dir * disp, vec2(0.5), lwh - vec2(0.5));
  frag = textureLod(uTex, layerUv(sp, lwh), 0.0);`);

// ── Alpha morphology (separable) ─────────────────────────────────────────────

/**
 * One separable pass of a min (erode) / max (dilate) over ALPHA.
 * p0 = step (layer px per tap: (1,0) or (0,1)), radius, erode flag;
 * p1 = lw, lh, border mode (0 ignore off-layer taps, 1 read them as
 * transparent, 2 clamp to the border). Colour is rescaled with the coverage
 * so the straight colour underneath is unchanged — the kernels leave RGB bytes
 * alone and only rewrite the matte.
 */
const ALPHA_TAP_WGSL = `fn alphaAt(px : vec2<f32>, lwh : vec2<f32>, border : f32, missing : f32) -> f32 {
  var p = px;
  let outside = p.x < 0.5 || p.y < 0.5 || p.x > lwh.x - 0.5 || p.y > lwh.y - 0.5;
  if (outside) {
    if (border < 0.5) { return missing; }
    if (border < 1.5) { return 0.0; }
    p = clamp(p, vec2<f32>(0.5, 0.5), lwh - vec2<f32>(0.5, 0.5));
  }
  return textureSampleLevel(tex, smp, layerUv(p, lwh), 0.0).a;
}
fn rescale(s : vec4<f32>, a2 : f32) -> vec4<f32> {
  if (s.a <= 0.00001) { return vec4<f32>(0.0, 0.0, 0.0, a2); }
  return vec4<f32>(s.rgb * (a2 / s.a), a2);
}
`;
const ALPHA_TAP_GLSL = `float alphaAt(vec2 px, vec2 lwh, float border, float missing) {
  vec2 p = px;
  bool outside = p.x < 0.5 || p.y < 0.5 || p.x > lwh.x - 0.5 || p.y > lwh.y - 0.5;
  if (outside) {
    if (border < 0.5) return missing;
    if (border < 1.5) return 0.0;
    p = clamp(p, vec2(0.5), lwh - vec2(0.5));
  }
  return textureLod(uTex, layerUv(p, lwh), 0.0).a;
}
vec4 rescale(vec4 s, float a2) {
  if (s.a <= 0.00001) return vec4(0.0, 0.0, 0.0, a2);
  return vec4(s.rgb * (a2 / s.a), a2);
}
`;

export const ALPHA_MORPH_FX = withHelpers(fxShader('alpha-morph', 2,
  `  let lwh = obj.p1.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let erode = obj.p0.w > 0.5;
  let r = i32(obj.p0.z + 0.5);
  var v = s.a;
  // A tap that is "ignored" must not move the running min/max: hand it the
  // current value.
  for (var k = 1; k <= 50; k = k + 1) {
    if (k > r) { break; }
    let off = obj.p0.xy * f32(k);
    let a1 = alphaAt(pp + off, lwh, obj.p1.z, v);
    let a2 = alphaAt(pp - off, lwh, obj.p1.z, v);
    if (erode) { v = min(v, min(a1, a2)); } else { v = max(v, max(a1, a2)); }
  }
  return rescale(s, v);`,
  `  vec2 lwh = p1.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  bool erode = p0.w > 0.5;
  int r = int(p0.z + 0.5);
  float v = s.a;
  for (int k = 1; k <= 50; k++) {
    if (k > r) break;
    vec2 off = p0.xy * float(k);
    float a1 = alphaAt(pp + off, lwh, p1.z, v);
    float a2 = alphaAt(pp - off, lwh, p1.z, v);
    v = erode ? min(v, min(a1, a2)) : max(v, max(a1, a2));
  }
  frag = rescale(s, v);`), ALPHA_TAP_WGSL, ALPHA_TAP_GLSL);

/** One separable box-blur pass over ALPHA. p0 = step, radius; p1 = lw, lh, border mode (always clamped by both kernels). */
export const ALPHA_BOX_FX = withHelpers(fxShader('alpha-box', 2,
  `  let lwh = obj.p1.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s = textureSampleLevel(tex, smp, uv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { return s; }
  let r = i32(obj.p0.z + 0.5);
  var sum = s.a;
  for (var k = 1; k <= 50; k = k + 1) {
    if (k > r) { break; }
    let off = obj.p0.xy * f32(k);
    sum = sum + alphaAt(pp + off, lwh, obj.p1.z, 0.0) + alphaAt(pp - off, lwh, obj.p1.z, 0.0);
  }
  return rescale(s, sum / f32(2 * r + 1));`,
  `  vec2 lwh = p1.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s = textureLod(uTex, vUv, 0.0);
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > lwh.x || pp.y > lwh.y) { frag = s; return; }
  int r = int(p0.z + 0.5);
  float sum = s.a;
  for (int k = 1; k <= 50; k++) {
    if (k > r) break;
    vec2 off = p0.xy * float(k);
    sum += alphaAt(pp + off, lwh, p1.z, 0.0) + alphaAt(pp - off, lwh, p1.z, 0.0);
  }
  frag = rescale(s, sum / float(2 * r + 1));`), ALPHA_TAP_WGSL, ALPHA_TAP_GLSL);

export const FX_ROUND_EIGHT_SHADERS: readonly ShaderSource[] = [
  KEYLIGHT_FX, LINEAR_COLOR_KEY_FX, LUMA_KEY_FX, COLOR_KEY_FX, COLOR_RANGE_FX,
  EXTRACT_FX, SPILL_SUPPRESSOR_FX, WAVE_WARP_FX, ALPHA_MORPH_FX, ALPHA_BOX_FX,
];
