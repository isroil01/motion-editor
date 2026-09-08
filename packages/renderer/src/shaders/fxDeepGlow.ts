/**
 * Deep Glow — the GPU side of `src/core/effects/deepGlow.ts`. Read that
 * module's header for the model; this file is its three passes:
 *
 *   · `deep-glow-blur`      one separable Gaussian pass with PER-CHANNEL
 *                           sigmas (chromatic aberration) and, on the first
 *                           horizontal pass only, the threshold knee.
 *   · `deep-glow-acc`       one octave × its weight, drawn with the `add`
 *                           blend into the accumulator. Colour sums; alpha
 *                           takes the blend's `over` factor, which is a
 *                           coverage union — the CPU twin does the same sum.
 *   · `deep-glow-composite` source (tex) + gain·tint·accumulator (tex2),
 *                           premultiplied-valid, or the glow alone.
 *
 * The composition pass drives them: for each octave H (level → f1), V
 * (f1 → level), accumulate (level → acc); then composite. Everything samples
 * the chain texture DIRECTLY (uv + offset, clamp sampler) like the built-in
 * blur, not through the layer-box `samplePx`, because a glow is meant to
 * leave the layer box — the spread padding is what makes room for it.
 *
 * Every number here is computed the way the CPU computes it: the stride is
 * an integer texel count, the weights `exp(-x²·inv)` with `inv = 1/(2σ²)`
 * per channel (alpha rides on green), normalised per channel per pass.
 */

import type { ShaderSource } from './builtin';
import { fxShader } from './fxRoundSix';
import { withHelpers } from './fxRoundEight';
import { withSecondTexture } from './fxRoundTen';
import { NOISE_GLSL, NOISE_WGSL } from './fxRoundTwelve';

/** Taps each side of the centre. Mirrors DEEP_GLOW_TAPS in deepGlowKernel.ts (the reach is folded into the stride the pass is handed). */
const TAPS = 16;
/** ±1 sRGB code near black in linear light — `2 / (255 · 12.92)`, as a literal the shader can carry. */
const DITHER_AMP = (2 / (255 * 12.92)).toFixed(9);

/**
 * p0 = dir (uv per tap), step (texels per tap), threshold (0 = off);
 * p1 = invR, invG, invB, first-pass flag (threshold applies only then).
 */
export const DEEP_GLOW_BLUR_FX = fxShader('deep-glow-blur', 2,
  `  let dir = obj.p0.xy; let step = obj.p0.z; let thr = obj.p0.w;
  let inv = obj.p1.xyz; let first = obj.p1.w > 0.5;
  var acc = vec4<f32>(0.0); var sum = vec3<f32>(0.0);
  for (var i = -${TAPS}; i <= ${TAPS}; i = i + 1) {
    let x = f32(i) * step; let x2 = x * x;
    let w = exp(-x2 * inv);
    var s = textureSampleLevel(tex, smp, uv + dir * f32(i), 0.0);
    if (first && thr > 0.0) {
      if (s.a <= 0.0) { s = vec4<f32>(0.0); }
      else {
        let lum = dot(s.rgb, vec3<f32>(0.2126, 0.7152, 0.0722)) / s.a;
        if (lum <= thr) { s = vec4<f32>(0.0); } else { s = s * ((lum - thr) / lum); }
      }
    }
    acc = acc + vec4<f32>(s.r * w.r, s.g * w.g, s.b * w.b, s.a * w.g);
    sum = sum + w;
  }
  return vec4<f32>(acc.r / sum.r, acc.g / sum.g, acc.b / sum.b, acc.a / sum.g);`,
  `  vec2 dir = p0.xy; float step = p0.z; float thr = p0.w;
  vec3 inv = p1.xyz; bool first = p1.w > 0.5;
  vec4 acc = vec4(0.0); vec3 sum = vec3(0.0);
  for (int i = -${TAPS}; i <= ${TAPS}; i++) {
    float x = float(i) * step; float x2 = x * x;
    vec3 w = exp(-x2 * inv);
    vec4 s = textureLod(uTex, vUv + dir * float(i), 0.0);
    if (first && thr > 0.0) {
      if (s.a <= 0.0) { s = vec4(0.0); }
      else {
        float lum = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722)) / s.a;
        if (lum <= thr) { s = vec4(0.0); } else { s = s * ((lum - thr) / lum); }
      }
    }
    acc += vec4(s.r * w.r, s.g * w.g, s.b * w.b, s.a * w.g);
    sum += w;
  }
  frag = vec4(acc.r / sum.r, acc.g / sum.g, acc.b / sum.b, acc.a / sum.g);`);

/** p0.x = octave weight. Drawn with the `add` blend. */
export const DEEP_GLOW_ACC_FX = fxShader('deep-glow-acc', 1,
  `  return textureSampleLevel(tex, smp, uv, 0.0) * obj.p0.x;`,
  `  frag = textureLod(uTex, vUv, 0.0) * p0.x;`);

/**
 * tex = the chain's source, tex2 = the accumulator.
 * p0 = gain, tint (linear r, g, b); p1 = tint amount, glow-only flag,
 * dither (buffer width in px, 0 = off), buffer height.
 *
 * Dither is ±1 sRGB code near black (the encode's toe has slope 12.92) from
 * the u32 hash of the BUFFER pixel, added only where there is glow — a 1/r²
 * tail crosses the 8-bit floor over a wide band, and without the noise that
 * band is a faint disc with an edge. Mirrors DEEP_GLOW_DITHER_AMP.
 */
export const DEEP_GLOW_COMPOSITE_FX = withHelpers(withSecondTexture(fxShader('deep-glow-composite', 2,
  `  let src = textureSampleLevel(tex, smp, uv, 0.0);
  let g = textureSampleLevel(tex2, smp, uv, 0.0);
  let gain = obj.p0.x; let t = mix(vec3<f32>(1.0), obj.p0.yzw, obj.p1.x);
  let glowOnly = obj.p1.y > 0.5;
  var grgb = g.rgb * gain * t;
  var ga = min(1.0, g.a * gain);
  if (obj.p1.z > 0.0 && ga > 0.0) {
    let px = floor(fieldQ(uv) * obj.p1.zw);
    let dn = (hash01(i32(px.x), i32(px.y), 0) - 0.5) * ${DITHER_AMP};
    grgb = max(grgb + vec3<f32>(dn), vec3<f32>(0.0)); ga = max(ga + dn, 0.0);
  }
  let base = select(src, vec4<f32>(0.0), glowOnly);
  let a = min(1.0, base.a + ga);
  return vec4<f32>(min(base.rgb + grgb, vec3<f32>(a)), a);`,
  `  vec4 src = textureLod(uTex, vUv, 0.0);
  vec4 g = textureLod(uMaskTex, vUv, 0.0);
  float gain = p0.x; vec3 t = mix(vec3(1.0), p0.yzw, p1.x);
  bool glowOnly = p1.y > 0.5;
  vec3 grgb = g.rgb * gain * t;
  float ga = min(1.0, g.a * gain);
  if (p1.z > 0.0 && ga > 0.0) {
    vec2 px = floor(fieldQ(vUv) * p1.zw);
    float dn = (hash01(int(px.x), int(px.y), 0) - 0.5) * ${DITHER_AMP};
    grgb = max(grgb + vec3(dn), vec3(0.0)); ga = max(ga + dn, 0.0);
  }
  vec4 base = glowOnly ? vec4(0.0) : src;
  float a = min(1.0, base.a + ga);
  frag = vec4(min(base.rgb + grgb, vec3(a)), a);`)), NOISE_WGSL, NOISE_GLSL);

export const FX_DEEP_GLOW_SHADERS: readonly ShaderSource[] = [DEEP_GLOW_BLUR_FX, DEEP_GLOW_ACC_FX, DEEP_GLOW_COMPOSITE_FX];
