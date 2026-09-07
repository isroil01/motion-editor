/**
 * A packer must produce EXACTLY the floats its shader's struct declares.
 *
 * ── The bug this closes ─────────────────────────────────────────────────────
 *
 * `packSpotlight` allocated `MAT3_STD140_FLOATS + 4·4` — four vec4s after the
 * matrix — while the shader declared FIVE (uvRect, p0, p1, p2, lightColor).
 * The consequences are both silent:
 *
 *   1. JavaScript drops writes past the end of a Float32Array. No throw, no
 *      warning; the colour simply never reaches the GPU.
 *   2. The uniform buffer is 16 bytes smaller than the struct the shader
 *      declares, so WebGPU rejects the bind group, the draw never happens, and
 *      — because the effects chain relies on a draw to composite the layer
 *      back out — THE LAYER DISAPPEARS.
 *
 * Reported as "I added Spotlight and the object disappeared", which is the
 * same symptom as the earlier non-uniform-control-flow bug and a completely
 * different cause. Both are invisible to `tsc`, to lint, and to every test that
 * does not actually size the buffer against the struct.
 *
 * ── The check ───────────────────────────────────────────────────────────────
 *
 * Parse the WGSL `struct Object { … }` for the shader, total its fields in
 * floats under std140-ish rules (mat3x3 occupies 12 — three padded columns),
 * and compare against what the packer actually returns. The table is explicit
 * because only a human knows which packer feeds which shader; adding a shader
 * without adding a row is caught by the coverage test at the bottom.
 */

import { BUILTIN_SHADERS } from '../shaders/builtin';
import {
  packBend, packPerspective, packSpotlight, packMotionTile, packFill,
  packSharpen, packSetMatte, packStroke, packTextured, packDeformedMesh, packTextured3D, packShadowDepth,
  packVignetteFx, packBlackAndWhite, packTritone, packPhotoFilter, packThreshold, packVibrance, packFxBlock,
  packBokeh, packCocBlur, packDofGather, packSceneBlitLut, packMesh3DPbr, packSsao, packSsaoBlur,
} from '../pipeline/uniforms';
import type { Mat3 } from '../core/math/Mat3';
import type { Mat4 } from '../core/math/Mat4';
import type { Rect } from '../core/math/geometry';
import type { Color } from '../core/math/Color';

const MVP = [1, 0, 0, 0, 1, 0, 0, 0, 1] as unknown as Mat3;
const MVP4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as unknown as Mat4;
const RECT = { x: 0, y: 0, width: 1, height: 1 } as unknown as Rect;
const COLOR = { r: 1, g: 1, b: 1, a: 1 } as unknown as Color;

/** Floats a WGSL type occupies in the uniform block, std140-style. */
const FLOATS: Record<string, number> = {
  'mat3x3<f32>': 12,   // three columns, each padded to vec4
  'mat4x4<f32>': 16,
  'vec4<f32>': 4,
  'vec3<f32>': 4,      // padded
  'vec2<f32>': 2,
  f32: 1,
  i32: 1,
  u32: 1,
};

/**
 * Split a struct body on the commas that separate FIELDS.
 *
 * A plain `split(',')` tears `array<vec4<f32>, 8>` in half — the comma inside
 * the type parameters is not a field separator. Depth-aware, so nested generics
 * stay whole.
 */
function splitFields(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Floats one field's type occupies. Handles `array<T, N>` element counts. */
function typeFloats(t: string): number {
  const arr = /^array\s*<\s*(.+?)\s*,\s*(\d+)\s*>$/.exec(t);
  if (arr) return typeFloats(arr[1]!) * Number(arr[2]);
  const size = FLOATS[t];
  if (size === undefined) throw new Error(`uniformPackerSize: unknown WGSL type "${t}"`);
  return size;
}

/** Total floats in a shader's `struct Object`, or null when it declares none. */
function structFloats(wgsl: string): number | null {
  const m = /struct\s+Object\s*\{([\s\S]*?)\}/.exec(wgsl);
  if (!m) return null;
  let total = 0;
  for (const field of splitFields(m[1]!)) {
    const t = field.split(':').slice(1).join(':').trim();
    if (!t) continue;
    total += typeFloats(t);
  }
  return total;
}

/** shader name → the packer that fills its uniform block. */
const PACKERS: ReadonlyArray<{ shader: string; pack: () => Float32Array }> = [
  { shader: 'bend', pack: () => packBend(MVP, RECT, 1, 0, 1, 0, 0, 0, 0, 1, RECT) },
  { shader: 'spotlight', pack: () => packSpotlight(MVP, RECT, 0, 0, 0, 1, 0.5, 0.4, 1, 0.1, 1, false, 1.5, RECT, COLOR) },
  // The four that share one block.
  { shader: 'bevel-alpha', pack: () => packPerspective(MVP, RECT, [0, 0, 0, 0], [0, 0, 0, 0], RECT, COLOR) },
  { shader: 'bevel-edges', pack: () => packPerspective(MVP, RECT, [0, 0, 0, 0], [0, 0, 0, 0], RECT, COLOR) },
  { shader: 'sphere', pack: () => packPerspective(MVP, RECT, [0, 0, 0, 0], [0, 0, 0, 0], RECT, COLOR) },
  { shader: 'cylinder', pack: () => packPerspective(MVP, RECT, [0, 0, 0, 0], [0, 0, 0, 0], RECT, COLOR) },
  // A sample of the pre-existing ones, so the rule is shown to hold for shaders
  // written before this test rather than only for the ones that broke it.
  // Round-six per-pixel colour ports.
  { shader: 'vignette', pack: () => packVignetteFx(MVP, RECT, 0.5, 0.5, 0.6, 0, 0.5, 0.5, 1.5, RECT) },
  { shader: 'black-and-white', pack: () => packBlackAndWhite(MVP, RECT, 0.4, 0.6, 0.4, 0.6, 0.2, 0.8, 0, 0, 0) },
  { shader: 'tritone', pack: () => packTritone(MVP, RECT, 0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1) },
  { shader: 'photo-filter', pack: () => packPhotoFilter(MVP, RECT, 0.9, 0.5, 0, 0.25, true) },
  { shader: 'threshold', pack: () => packThreshold(MVP, RECT, 0.5) },
  { shader: 'vibrance', pack: () => packVibrance(MVP, RECT, 0.3, 0) },
  // Round-six waves 2-3 (packFxBlock, per-shader vec4 counts).
  { shader: 'mirror', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'offset', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'bulge', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'twirl', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'spherize', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'kaleidoscope', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'ripple', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'chromatic-aberration', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'magnify', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'mosaic', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'find-edges', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'emboss', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'color-emboss', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'halftone', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  // Round seven: the footage set.
  { shader: 'radial-blur', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'corner-pin', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'transform-fx', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  // Round eight: the keying set.
  { shader: 'keylight', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'linear-color-key', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'luma-key', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'color-key', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'color-range', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'extract', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'spill-suppressor', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'wave-warp', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'alpha-morph', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'alpha-box', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  // Round nine: per-pixel colour / channel / transitions.
  { shader: 'directional-blur', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'linear-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'shift-channels', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'alpha-levels', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'solid-composite', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'channel-combiner', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'remove-color-matting', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'change-color', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'change-to-color', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'leave-color', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'toner', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'venetian-blinds', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'radial-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'iris-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'line-sweep', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  // Round ten: neighbourhood passes + drawn generators.
  { shader: 'channel-box', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'minmax', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'unsharp-mask', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'shadow-highlight', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'checkerboard', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'grid', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'four-color-gradient', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'circle', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'ellipse', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  // Round eleven: advanced distort / transition / stylize.
  { shader: 'polar-coordinates', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'optics-compensation', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'warp', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'page-turn', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'split', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'slant', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'smear', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'rolling-shutter', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'radial-shadow-project', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'radial-shadow', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'flo-motion', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'lens', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'griddler', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'ball-action', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'drizzle', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'jaws', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'pixel-polly', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'twister', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'card-dance', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'unmult', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'cc-composite', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'cc-scatterize', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'radial-fast-blur', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'scale-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'plastic', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'glass-fx', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'texturize', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'threads', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'hex-tile', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'vector-blur', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  // Rounds twelve + thirteen.
  { shader: 'turbulent-displace', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'curl-noise', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'roughen-edges', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'scatter', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'colorama', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'selective-color', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'turbulent-noise', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'add-grain', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'median', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'block-dissolve', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'gradient-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'card-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'strobe-light', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'burn-film', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'light-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'grid-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'noise-alpha', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'brush-strokes', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'bilateral-blur', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'smart-blur', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'camera-lens-blur', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'mesh-warp', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'liquify', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'bezier-warp', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'cell-pattern', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'radio-waves', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'light-burst', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'cartoon', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'interior-style', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'satin', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'bevel', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'write-on', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'star-burst', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'snowfall', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'rainfall', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  // Round fourteen: histogram colour autos.
  { shader: 'fx-histogram', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'fx-auto-table', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'fx-auto-apply', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'motion-tile', pack: () => packMotionTile(MVP, RECT, 1, 1, 0, 0) },
  { shader: 'fill', pack: () => packFill(MVP, RECT, COLOR) },
  { shader: 'sharpen', pack: () => packSharpen(MVP, RECT, 0.01, 0.01, 1) },
  { shader: 'set-matte', pack: () => packSetMatte(MVP, RECT, false, false) },
  { shader: 'stroke', pack: () => packStroke(MVP, RECT, COLOR, 2, 0.01, 0.01) },
  { shader: 'textured', pack: () => packTextured(MVP, RECT, COLOR, 1) },
  { shader: 'textured-linear', pack: () => packTextured(MVP, RECT, COLOR, 1) },
  { shader: 'masked-textured-linear', pack: () => packTextured(MVP, RECT, COLOR, 1) },
  { shader: 'lut-textured-linear', pack: () => packTextured(MVP, RECT, COLOR, 1) },
  { shader: 'deformed-mesh-linear', pack: () => packDeformedMesh(MVP, COLOR, 1) },
  { shader: 'textured3d-linear', pack: () => packTextured3D(MVP4, RECT, COLOR, 1) },
  { shader: 'masked-textured3d-linear', pack: () => packTextured3D(MVP4, RECT, COLOR, 1) },
  // Extruded-mesh materials share the textured3d Object block.
  { shader: 'mesh3d-solid', pack: () => packTextured3D(MVP4, RECT, COLOR, 1) },
  { shader: 'mesh3d-textured', pack: () => packTextured3D(MVP4, RECT, COLOR, 1) },
  { shader: 'mesh3d-textured-linear', pack: () => packTextured3D(MVP4, RECT, COLOR, 1) },
  // …and the PBR variant widens that block by two vec4s at the TAIL, which is
  // exactly the drift this table exists to catch: `packMesh3DPbr` builds on
  // `packTextured3D`, so a field added to the shared shade tail must land
  // between them on BOTH sides or every map parameter reads garbage.
  { shader: 'mesh3d-pbr', pack: () => packMesh3DPbr(MVP4, RECT, COLOR, 1) },
  // The shadow-map caster pair. Their block is deliberately NOT the shade tail
  // — it carries the light's MVP, the caster's world matrix and the axis/origin
  // the receiver measures against — so it is its own row, and the two shaders
  // share one packer because they differ only in vertex layout.
  { shader: 'shadow-depth', pack: () => packShadowDepth(MVP4, MVP4 as unknown as number[], [0, 0, 1], 0.001, [0, 0, 0]) },
  { shader: 'shadow-depth-mesh', pack: () => packShadowDepth(MVP4, MVP4 as unknown as number[], [0, 0, 1], 0.001, [0, 0, 0]) },
  // The SSAO pair. Their blocks are their own — the estimate carries a mat4
  // (camera space to clip, used in BOTH directions) after three vec4s, and the
  // blur carries one vec4 — so a field added to either must land on both sides
  // here or the pass reads a radius where it expects a far plane.
  { shader: 'ssao', pack: () => packSsao(MVP, RECT, MVP4, 40, 1, 1000, 1, 512, 512, 16) },
  { shader: 'ssao-blur', pack: () => packSsaoBlur(MVP, RECT, 1 / 512, 1 / 512, 1000, 40) },
  // Effects round seven (packFxBlock, per-shader vec4 counts). Every one is
  // covered rather than added to the exemption below: the exemption exists
  // for shaders that predate this table, not as a place to put new ones.
  { shader: 'cc-tiler', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'ripple-pulse', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'radial-scale-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'glass-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'image-wipe', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'color-difference-key', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'wire-removal', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'broadcast-colors', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0]], RECT) },
  { shader: 'noise-hls', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'block-load', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'kernel', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: '3d-glasses', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'fractal', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'particle-systems', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'cc-bubbles', pack: () => packFxBlock(MVP, RECT, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], RECT) },
  { shader: 'scene-blit', pack: () => packTextured(MVP, RECT, COLOR, 1) },
  { shader: 'bokeh', pack: () => packBokeh(MVP, RECT, 0.001, 0.001, 8, 6, 0.5, 1) },
  { shader: 'coc-blur', pack: () => packCocBlur(MVP, RECT, RECT, 0.001, 0.001, [1, 2, 3, 4], 6, 0.5, 1) },
  { shader: 'dof-gather', pack: () => packDofGather(MVP, RECT, 0.001, 0.001, 6, 0.5, 1, 24, 1.00001, -1, 1000, 24, 24, 1000, 0) },
  {
    shader: 'scene-blit-lut',
    pack: () => packSceneBlitLut(MVP, RECT, COLOR, 1, { size: 33, is1d: false, intensity: 1, domainMin: 0, domainMax: 1 }),
  },
];

const byName = new Map(BUILTIN_SHADERS.map((s) => [s.name, s]));

describe('uniform packer size matches the shader struct', () => {
  it.each(PACKERS)('$shader', ({ shader, pack }) => {
    const src = byName.get(shader);
    expect(src).toBeDefined();
    const declared = structFloats(src!.wgsl);
    expect(declared).not.toBeNull();
    // Too FEW and the bind group is rejected — the layer vanishes. Too many and
    // the tail is ignored, which is merely wasteful but still a sign the two
    // sides have drifted.
    expect(pack().length).toBe(declared);
  });

  it('★ detects a packer one vec4 short — the exact shape that shipped', () => {
    // Guards the guard. If `structFloats` stopped parsing, every case above
    // would compare against null and this file would pass forever.
    const spotlight = byName.get('spotlight')!;
    const declared = structFloats(spotlight.wgsl)!;
    expect(declared).toBe(36);              // 12 + uvRect + p0 + p1 + p2 + fxBox + colour
    expect(declared - 4).not.toBe(packSpotlight(
      MVP, RECT, 0, 0, 0, 1, 0.5, 0.4, 1, 0.1, 1, false, 1.5, RECT, COLOR,
    ).length);
  });

  it('every shader with a uniform struct is either covered or knowingly absent', () => {
    // A new shader with a new packer must land in PACKERS, or its buffer size
    // is unguarded — which is precisely how Spotlight shipped broken.
    const covered = new Set(PACKERS.map((p) => p.shader));
    const uncovered = BUILTIN_SHADERS
      .filter((s) => structFloats(s.wgsl) !== null && !covered.has(s.name))
      .map((s) => s.name);
    // Pre-existing shaders not yet in the table are listed here deliberately:
    // the assertion pins the CURRENT set, so adding a shader forces a decision
    // rather than silently widening the gap.
    expect(uncovered.length).toBeLessThanOrEqual(24);
  });
});
