/**
 * Round eleven's SINGLE-PASS effects: the material and the uniform vec4s each
 * renderable packs (see fxRoundEleven.ts for what every slot means). Kept as a
 * table rather than thirty more `else if` arms in CompositionPass so the arm
 * that reads the table can stay one screen long.
 *
 * The multi-pass members of the round (Cross Blur, the field effects Plastic /
 * Glass / Vector Blur, and Radial Shadow) live in CompositionPass itself — they
 * need the ping-pong targets.
 */

import type { RenderableEffect } from '../../scene/FrameScene';
import type { MaterialDescriptor } from '../../shaders/Material';
import {
  POLAR_COORDINATES_FX_MATERIAL, OPTICS_COMPENSATION_FX_MATERIAL, WARP_FX_MATERIAL, PAGE_TURN_FX_MATERIAL, SPLIT_FX_MATERIAL,
  SLANT_FX_MATERIAL, SMEAR_FX_MATERIAL, ROLLING_SHUTTER_FX_MATERIAL, FLO_MOTION_FX_MATERIAL, LENS_FX_MATERIAL, GRIDDLER_FX_MATERIAL,
  BALL_ACTION_FX_MATERIAL, DRIZZLE_FX_MATERIAL, JAWS_FX_MATERIAL, PIXEL_POLLY_FX_MATERIAL, TWISTER_FX_MATERIAL, CARD_DANCE_FX_MATERIAL,
  UNMULT_FX_MATERIAL, CC_COMPOSITE_FX_MATERIAL, CC_SCATTERIZE_FX_MATERIAL, RADIAL_FAST_BLUR_FX_MATERIAL, SCALE_WIPE_FX_MATERIAL,
  TEXTURIZE_FX_MATERIAL, THREADS_FX_MATERIAL, HEX_TILE_FX_MATERIAL,
} from '../../shaders/Material';

type Vec4 = [number, number, number, number];

export interface SinglePassDraw {
  material: MaterialDescriptor;
  params: Vec4[];
}

/** Null for anything that is not a round-eleven single-pass effect. */
export function roundElevenSinglePass(e: RenderableEffect): SinglePassDraw | null {
  switch (e.type) {
    case 'polar-coordinates':
      return { material: POLAR_COORDINATES_FX_MATERIAL, params: [[e.lw, e.lh, e.t, e.conv]] };
    case 'optics-compensation':
      return { material: OPTICS_COMPENSATION_FX_MATERIAL, params: [[e.lw, e.lh, e.k, e.reverse ? 1 : 0], [e.cx, e.cy, e.norm, 0]] };
    case 'warp':
      return { material: WARP_FX_MATERIAL, params: [[e.lw, e.lh, e.style, e.bend], [e.h, e.v, e.vert ? 1 : 0, 0]] };
    case 'page-turn':
      return { material: PAGE_TURN_FX_MATERIAL, params: [[e.lw, e.lh, e.nx, e.ny], [e.foldAt, e.rad, e.backA, e.shade]] };
    case 'split':
      return { material: SPLIT_FX_MATERIAL, params: [[e.lw, e.lh, e.nx, e.ny], [e.cx, e.cy, e.half, 0]] };
    case 'slant':
      return { material: SLANT_FX_MATERIAL, params: [[e.lw, e.lh, e.slant, e.vert ? 1 : 0], [e.anchor, 0, 0, 0]] };
    case 'smear':
      return { material: SMEAR_FX_MATERIAL, params: [[e.lw, e.lh, e.fx, e.fy], [e.vx, e.vy, e.radius, e.el]] };
    case 'rolling-shutter':
      return { material: ROLLING_SHUTTER_FX_MATERIAL, params: [[e.lw, e.lh, e.sweep, e.wobble], [e.flip ? 1 : 0, e.vertical ? 1 : 0, 0, 0]] };
    case 'flo-motion':
      return { material: FLO_MOTION_FX_MATERIAL, params: [[e.lw, e.lh, e.k1x, e.k1y], [e.k1a, e.k2x, e.k2y, e.k2a], [e.twoSigma2, e.reachOverSigma, 0, 0]] };
    case 'lens':
      return { material: LENS_FX_MATERIAL, params: [[e.lw, e.lh, e.cx, e.cy], [e.ballR, e.pull, 0, 0]] };
    case 'griddler':
      return { material: GRIDDLER_FX_MATERIAL, params: [[e.lw, e.lh, e.tile, e.sx], [e.sy, e.cosR, e.sinR, 0]] };
    case 'ball-action':
      return { material: BALL_ACTION_FX_MATERIAL, params: [[e.lw, e.lh, e.g, e.R], [e.jit, e.seed, 0, 0]] };
    case 'drizzle':
      return { material: DRIZZLE_FX_MATERIAL, params: [[e.lw, e.lh, e.n, e.spread], [e.bandW, e.freq, e.evolution, e.seed], [e.amp, 0, 0, 0]] };
    case 'jaws':
      return { material: JAWS_FX_MATERIAL, params: [[e.lw, e.lh, e.ux, e.uy], [e.sep, e.tw, e.th, 0]] };
    case 'pixel-polly':
      return { material: PIXEL_POLLY_FX_MATERIAL, params: [[e.lw, e.lh, e.t, e.cell], [e.fx, e.fy, e.maxFly, e.grav], [e.spin, e.seed, e.fade, e.cols]] };
    case 'twister':
      return { material: TWISTER_FX_MATERIAL, params: [[e.lw, e.lh, e.t, e.axisY], [e.twist, 0, 0, 0]] };
    case 'card-dance':
      return { material: CARD_DANCE_FX_MATERIAL, params: [[e.lw, e.lh, e.rows, e.cols], [e.amt, e.rot, e.phase, e.maxOff]] };
    case 'unmult':
      return { material: UNMULT_FX_MATERIAL, params: [[e.thresh, e.boost, 0, 0]] };
    case 'cc-composite':
      return { material: CC_COMPOSITE_FX_MATERIAL, params: [[e.mix, e.mode, e.rgbOnly ? 1 : 0, 0]] };
    case 'cc-scatterize':
      return { material: CC_SCATTERIZE_FX_MATERIAL, params: [[e.lw, e.lh, e.amt, e.twist], [e.windX, e.windY, e.seed, 0]] };
    case 'radial-fast-blur':
      return { material: RADIAL_FAST_BLUR_FX_MATERIAL, params: [[e.lw, e.lh, e.cx, e.cy], [e.amt, e.mode, 0, 0]] };
    case 'scale-wipe':
      return { material: SCALE_WIPE_FX_MATERIAL, params: [[e.lw, e.lh, e.cx, e.cy], [e.ux, e.uy, e.wipeEdge, e.stretch], [e.maxDist, 0, 0, 0]] };
    case 'texturize':
      return { material: TEXTURIZE_FX_MATERIAL, params: [[e.lw, e.lh, e.pattern, e.gain], [e.lx, e.ly, e.s, 0]] };
    case 'threads':
      return { material: THREADS_FX_MATERIAL, params: [[e.lw, e.lh, e.th, e.period], [e.dk, 0, 0, 0]] };
    case 'hex-tile':
      return { material: HEX_TILE_FX_MATERIAL, params: [[e.lw, e.lh, e.R, e.bd]] };
    default:
      return null;
  }
}
