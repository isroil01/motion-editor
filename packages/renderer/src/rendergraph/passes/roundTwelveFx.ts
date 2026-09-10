/**
 * Rounds twelve and thirteen: material lookup for the last CPU-kernel ports.
 * These renderables carry their shader's packed vec4 slots directly (`p`), so
 * the lookup is one line per effect — fxRoundTwelve.ts / fxRoundThirteen.ts
 * document what each slot holds.
 */

import type { FxVec4, RenderableEffect } from '../../scene/FrameScene';
import type { MaterialDescriptor } from '../../shaders/Material';
import {
  TURBULENT_DISPLACE_FX_MATERIAL, CURL_NOISE_FX_MATERIAL, ROUGHEN_EDGES_FX_MATERIAL, SCATTER_FX_MATERIAL, COLORAMA_FX_MATERIAL,
  SELECTIVE_COLOR_FX_MATERIAL, TURBULENT_NOISE_FX_MATERIAL, ADD_GRAIN_FX_MATERIAL, MEDIAN_FX_MATERIAL, BLOCK_DISSOLVE_FX_MATERIAL,
  GRADIENT_WIPE_FX_MATERIAL, CARD_WIPE_FX_MATERIAL, STROBE_LIGHT_FX_MATERIAL, BURN_FILM_FX_MATERIAL, LIGHT_WIPE_FX_MATERIAL,
  GRID_WIPE_FX_MATERIAL, NOISE_ALPHA_FX_MATERIAL, BRUSH_STROKES_FX_MATERIAL, BILATERAL_BLUR_FX_MATERIAL, SMART_BLUR_FX_MATERIAL,
  CAMERA_LENS_BLUR_FX_MATERIAL, MESH_WARP_FX_MATERIAL, LIQUIFY_FX_MATERIAL, BEZIER_WARP_FX_MATERIAL, CELL_PATTERN_FX_MATERIAL,
  RADIO_WAVES_FX_MATERIAL, LIGHT_BURST_FX_MATERIAL, WRITE_ON_FX_MATERIAL, STAR_BURST_FX_MATERIAL, SNOWFALL_FX_MATERIAL, RAINFALL_FX_MATERIAL,
  CARTOON_FX_MATERIAL, INTERIOR_STYLE_FX_MATERIAL, SATIN_FX_MATERIAL, BEVEL_FX_MATERIAL, BEAM_PATH_FX_MATERIAL,
} from '../../shaders/Material';
import type { SinglePassDraw } from './roundElevenFx';

const SINGLE: Readonly<Record<string, MaterialDescriptor>> = {
  'turbulent-displace': TURBULENT_DISPLACE_FX_MATERIAL,
  'curl-noise': CURL_NOISE_FX_MATERIAL,
  'roughen-edges': ROUGHEN_EDGES_FX_MATERIAL,
  scatter: SCATTER_FX_MATERIAL,
  colorama: COLORAMA_FX_MATERIAL,
  'selective-color': SELECTIVE_COLOR_FX_MATERIAL,
  'turbulent-noise': TURBULENT_NOISE_FX_MATERIAL,
  'add-grain': ADD_GRAIN_FX_MATERIAL,
  median: MEDIAN_FX_MATERIAL,
  'dust-scratches': MEDIAN_FX_MATERIAL,
  'block-dissolve': BLOCK_DISSOLVE_FX_MATERIAL,
  'gradient-wipe': GRADIENT_WIPE_FX_MATERIAL,
  'card-wipe': CARD_WIPE_FX_MATERIAL,
  'strobe-light': STROBE_LIGHT_FX_MATERIAL,
  'burn-film': BURN_FILM_FX_MATERIAL,
  'light-wipe': LIGHT_WIPE_FX_MATERIAL,
  'grid-wipe': GRID_WIPE_FX_MATERIAL,
  'noise-alpha': NOISE_ALPHA_FX_MATERIAL,
  'brush-strokes': BRUSH_STROKES_FX_MATERIAL,
  'bilateral-blur': BILATERAL_BLUR_FX_MATERIAL,
  'smart-blur': SMART_BLUR_FX_MATERIAL,
  'camera-lens-blur': CAMERA_LENS_BLUR_FX_MATERIAL,
  'mesh-warp': MESH_WARP_FX_MATERIAL,
  liquify: LIQUIFY_FX_MATERIAL,
  'bezier-warp': BEZIER_WARP_FX_MATERIAL,
  'cell-pattern': CELL_PATTERN_FX_MATERIAL,
  'radio-waves': RADIO_WAVES_FX_MATERIAL,
  'light-burst': LIGHT_BURST_FX_MATERIAL,
  'write-on': WRITE_ON_FX_MATERIAL,
  'star-burst': STAR_BURST_FX_MATERIAL,
  snowfall: SNOWFALL_FX_MATERIAL,
  rainfall: RAINFALL_FX_MATERIAL,
  // Energy Beam (2026-09-08): the spine rides in the block, one pass.
  'beam-path': BEAM_PATH_FX_MATERIAL,
};

const FIELD: Readonly<Record<string, MaterialDescriptor>> = {
  cartoon: CARTOON_FX_MATERIAL,
  'inner-shadow': INTERIOR_STYLE_FX_MATERIAL,
  'inner-glow': INTERIOR_STYLE_FX_MATERIAL,
  satin: SATIN_FX_MATERIAL,
  bevel: BEVEL_FX_MATERIAL,
};

/** Single-pass round-twelve/thirteen effects: material + the renderable's packed slots. */
export function roundTwelveSinglePass(e: RenderableEffect): SinglePassDraw | null {
  const material = SINGLE[e.type];
  if (!material || !('p' in e)) return null;
  const p = e.p as readonly FxVec4[];
  return { material, params: p.map((v) => [v[0], v[1], v[2], v[3]]) };
}

export interface FieldPassDraw extends SinglePassDraw {
  /** Gaussian sigma for the reference copy bound as `tex2`; 0 = the layer itself. */
  sigmaPx: number;
}

/** Two-texture round-thirteen effects: the layer plus a blurred copy. */
export function roundTwelveFieldPass(e: RenderableEffect): FieldPassDraw | null {
  const material = FIELD[e.type];
  if (!material || !('p' in e) || !('sigmaPx' in e)) return null;
  const p = e.p as readonly FxVec4[];
  return { material, params: p.map((v) => [v[0], v[1], v[2], v[3]]), sigmaPx: e.sigmaPx as number };
}
