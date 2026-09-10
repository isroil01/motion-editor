/**
 * Energy Beam (`beam-path`) — the GPU twin of `src/core/effects/beamPath.ts`.
 * Read that header for the model; this is its fragment, formula for formula.
 *
 * The spine arrives in the uniform block, two points per row after the seven
 * parameter rows (`beamPathRows`), with `BEAM_PEN_UP` (1e9) as the x of a
 * pen-up. No outside-the-layer early return: a beam's glow is meant to leave
 * the layer box, and the spread both routes reserve makes room for it.
 *
 * Distortion is the curl of the same fbm potential as the Curl Noise effect,
 * central differences one px apart, evaluated at the FLOORED pixel so the
 * CPU pass (which has no fragment interpolation) lands on the same value.
 */

import type { ShaderSource } from './builtin';
import { withHelpers } from './fxRoundEight';
import { fxShader } from './fxRoundSix';
import { NOISE_GLSL, NOISE_WGSL } from './fxRoundTwelve';

const PARAM_ROWS = 7;
const POINT_ROWS = 32;
export const BEAM_PATH_ROWS = PARAM_ROWS + POINT_ROWS;

const WGSL_PT = `fn beamPt(i : i32) -> vec2<f32> {
  let r = i / 2;
  var row : vec4<f32>;
  switch (r) {
${Array.from({ length: POINT_ROWS }, (_, k) => `    case ${k}: { row = obj.p${PARAM_ROWS + k}; }`).join('\n')}
    default: { row = vec4<f32>(1e9, 0.0, 1e9, 0.0); }
  }
  if ((i & 1) == 0) { return row.xy; }
  return row.zw;
}
fn sstep2(e0 : f32, e1 : f32, x : f32) -> f32 {
  if (e1 <= e0) { return select(1.0, 0.0, x < e0); }
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
`;
const GLSL_PT = `vec2 beamPt(int i) {
  int r = i / 2;
  vec4 row = vec4(1e9, 0.0, 1e9, 0.0);
${Array.from({ length: POINT_ROWS }, (_, k) => `  if (r == ${k}) row = p${PARAM_ROWS + k};`).join('\n')}
  return ((i & 1) == 0) ? row.xy : row.zw;
}
float sstep2(float e0, float e1, float x) {
  if (e1 <= e0) return (x < e0) ? 0.0 : 1.0;
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
`;

export const BEAM_PATH_FX: ShaderSource = withHelpers(fxShader('beam-path', BEAM_PATH_ROWS,
  `  let lwh = obj.p0.xy;
  let pp = (fieldQ(uv) - obj.fxBox.xy) / max(obj.fxBox.zw, vec2<f32>(0.000001, 0.000001)) * lwh;
  let s0 = textureSampleLevel(tex, smp, uv, 0.0);
  let count = i32(obj.p0.z + 0.5); let totalLen = obj.p0.w;
  let beamOnly = obj.p4.x > 0.5;
  let base = select(s0, vec4<f32>(0.0), beamOnly);
  if (count < 2 || totalLen <= 0.0) { return base; }
  var q = pp;
  let dist = obj.p3.y;
  if (dist > 0.0) {
    let inv = obj.p3.z; let ev = obj.p3.w;
    let f = floor(pp);
    let dpdx = fbm(vec2<f32>((f.x + 1.0) * inv + ev, f.y * inv - ev), 53, 3) - fbm(vec2<f32>((f.x - 1.0) * inv + ev, f.y * inv - ev), 53, 3);
    let dpdy = fbm(vec2<f32>(f.x * inv + ev, (f.y + 1.0) * inv - ev), 53, 3) - fbm(vec2<f32>(f.x * inv + ev, (f.y - 1.0) * inv - ev), 53, 3);
    q = q + vec2<f32>(dpdy, -dpdx) * dist;
  }
  let halfW = obj.p1.x; let softF = obj.p1.y; let spread = obj.p1.z; let inten = obj.p1.w;
  let expo = obj.p2.x; let start = obj.p2.y; let end = obj.p2.z; let sz0 = obj.p2.w; let sz1 = obj.p3.x;
  let win = max(end - start, 0.000001);
  var core = 0.0; var dmin = 1e9; var acc = 0.0;
  for (var i = 0; i + 1 < count; i = i + 1) {
    let a = beamPt(i); let b = beamPt(i + 1);
    if (a.x >= 1e9 || b.x >= 1e9) { continue; }
    let ab = b - a; let len = length(ab);
    let sa = acc / totalLen; let sb = (acc + len) / totalLen;
    acc = acc + len;
    if (len <= 0.000001) { continue; }
    let va = max(sa, start); let vb = min(sb, end);
    if (vb <= va) { continue; }
    let ta = (va - sa) / (sb - sa); let tb = (vb - sa) / (sb - sa);
    let t = clamp(dot(q - a, ab) / (len * len), ta, tb);
    let d = length(q - (a + ab * t));
    let sAt = sa + t * (sb - sa);
    let u = clamp((sAt - start) / win, 0.0, 1.0);
    let wh = halfW * mix(sz0, sz1, u);
    let soft = wh * softF;
    let cov = 1.0 - sstep2(wh - soft, wh + soft + 0.75, d);
    core = max(core, cov);
    dmin = min(dmin, d - wh);
  }
  if (dmin >= 1e9) { return base; }
  let dd = max(0.0, dmin);
  var glow = inten * pow(1.0 + dd / spread, -expo);
  glow = glow * (1.0 - sstep2(6.0 * spread, 10.0 * spread, dd));
  let coreF = core * obj.p4.z;
  let addA = min(1.0, coreF + min(1.0, glow));
  let a = min(1.0, base.a + addA);
  let rgb = min(base.rgb + obj.p5.xyz * coreF + obj.p6.xyz * glow, vec3<f32>(a));
  return vec4<f32>(rgb, a);`,
  `  vec2 lwh = p0.xy;
  vec2 pp = (fieldQ(vUv) - fxBox.xy) / max(fxBox.zw, vec2(0.000001)) * lwh;
  vec4 s0 = textureLod(uTex, vUv, 0.0);
  int count = int(p0.z + 0.5); float totalLen = p0.w;
  bool beamOnly = p4.x > 0.5;
  vec4 base = beamOnly ? vec4(0.0) : s0;
  if (count < 2 || totalLen <= 0.0) { frag = base; return; }
  vec2 q = pp;
  float dist = p3.y;
  if (dist > 0.0) {
    float inv = p3.z; float ev = p3.w;
    vec2 f = floor(pp);
    float dpdx = fbm(vec2((f.x + 1.0) * inv + ev, f.y * inv - ev), 53, 3) - fbm(vec2((f.x - 1.0) * inv + ev, f.y * inv - ev), 53, 3);
    float dpdy = fbm(vec2(f.x * inv + ev, (f.y + 1.0) * inv - ev), 53, 3) - fbm(vec2(f.x * inv + ev, (f.y - 1.0) * inv - ev), 53, 3);
    q += vec2(dpdy, -dpdx) * dist;
  }
  float halfW = p1.x; float softF = p1.y; float spread = p1.z; float inten = p1.w;
  float expo = p2.x; float start = p2.y; float end = p2.z; float sz0 = p2.w; float sz1 = p3.x;
  float win = max(end - start, 0.000001);
  float core = 0.0; float dmin = 1e9; float acc = 0.0;
  for (int i = 0; i + 1 < count; i++) {
    vec2 a = beamPt(i); vec2 b = beamPt(i + 1);
    if (a.x >= 1e9 || b.x >= 1e9) continue;
    vec2 ab = b - a; float len = length(ab);
    float sa = acc / totalLen; float sb = (acc + len) / totalLen;
    acc += len;
    if (len <= 0.000001) continue;
    float va = max(sa, start); float vb = min(sb, end);
    if (vb <= va) continue;
    float ta = (va - sa) / (sb - sa); float tb = (vb - sa) / (sb - sa);
    float t = clamp(dot(q - a, ab) / (len * len), ta, tb);
    float d = length(q - (a + ab * t));
    float sAt = sa + t * (sb - sa);
    float u = clamp((sAt - start) / win, 0.0, 1.0);
    float wh = halfW * mix(sz0, sz1, u);
    float soft = wh * softF;
    float cov = 1.0 - sstep2(wh - soft, wh + soft + 0.75, d);
    core = max(core, cov);
    dmin = min(dmin, d - wh);
  }
  if (dmin >= 1e9) { frag = base; return; }
  float dd = max(0.0, dmin);
  float glow = inten * pow(1.0 + dd / spread, -expo);
  glow *= (1.0 - sstep2(6.0 * spread, 10.0 * spread, dd));
  float coreF = core * p4.z;
  float addA = min(1.0, coreF + min(1.0, glow));
  float a = min(1.0, base.a + addA);
  vec3 rgb = min(base.rgb + p5.xyz * coreF + p6.xyz * glow, vec3(a));
  frag = vec4(rgb, a);`), NOISE_WGSL + WGSL_PT, NOISE_GLSL + GLSL_PT);

export const FX_BEAM_PATH_SHADERS: readonly ShaderSource[] = [BEAM_PATH_FX];
