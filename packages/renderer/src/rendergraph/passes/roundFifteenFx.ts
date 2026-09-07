/**
 * Effects round seven: material lookup for the fifteen shaders in
 * fxRoundFifteen.ts.
 *
 * A table rather than fifteen more arms in CompositionPass, and shaped exactly
 * like `roundTwelveFx.ts`: every renderable in this round carries its shader's
 * packed vec4 slots directly as `p`, so the lookup is one line per effect and
 * the slots reach the uniform block untouched. What each slot holds is
 * documented on the shader itself, which is the only place it can be checked
 * against the code that reads it.
 *
 * None of the fifteen is a two-texture (field) pass, so there is no field
 * variant here — the round needs no blurred reference copy of the layer.
 */

import type { FxVec4, RenderableEffect } from '../../scene/FrameScene';
import type { MaterialDescriptor } from '../../shaders/Material';
import {
  CC_TILER_FX_MATERIAL, RIPPLE_PULSE_FX_MATERIAL, RADIAL_SCALE_WIPE_FX_MATERIAL,
  GLASS_WIPE_FX_MATERIAL, IMAGE_WIPE_FX_MATERIAL, COLOR_DIFFERENCE_KEY_FX_MATERIAL,
  WIRE_REMOVAL_FX_MATERIAL, BROADCAST_COLORS_FX_MATERIAL, NOISE_HLS_FX_MATERIAL,
  BLOCK_LOAD_FX_MATERIAL, KERNEL_FX_MATERIAL, GLASSES_3D_FX_MATERIAL, FRACTAL_FX_MATERIAL,
  PARTICLE_SYSTEMS_FX_MATERIAL, BUBBLES_FX_MATERIAL,
} from '../../shaders/Material';
import type { SinglePassDraw } from './roundElevenFx';

const SINGLE: Readonly<Record<string, MaterialDescriptor>> = {
  'cc-tiler': CC_TILER_FX_MATERIAL,
  'ripple-pulse': RIPPLE_PULSE_FX_MATERIAL,
  'radial-scale-wipe': RADIAL_SCALE_WIPE_FX_MATERIAL,
  'glass-wipe': GLASS_WIPE_FX_MATERIAL,
  'image-wipe': IMAGE_WIPE_FX_MATERIAL,
  'color-difference-key': COLOR_DIFFERENCE_KEY_FX_MATERIAL,
  'wire-removal': WIRE_REMOVAL_FX_MATERIAL,
  'broadcast-colors': BROADCAST_COLORS_FX_MATERIAL,
  'noise-hls': NOISE_HLS_FX_MATERIAL,
  'block-load': BLOCK_LOAD_FX_MATERIAL,
  kernel: KERNEL_FX_MATERIAL,
  '3d-glasses': GLASSES_3D_FX_MATERIAL,
  fractal: FRACTAL_FX_MATERIAL,
  'particle-systems': PARTICLE_SYSTEMS_FX_MATERIAL,
  'cc-bubbles': BUBBLES_FX_MATERIAL,
};

/** Null for anything that is not a round-seven effect. */
export function roundFifteenSinglePass(e: RenderableEffect): SinglePassDraw | null {
  const material = SINGLE[e.type];
  if (!material || !('p' in e)) return null;
  const p = e.p as readonly FxVec4[];
  return { material, params: p.map((v) => [v[0], v[1], v[2], v[3]]) };
}
