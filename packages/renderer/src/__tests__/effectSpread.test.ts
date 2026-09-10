/**
 * effectSpreadPx sizes the margin reserved around a 3D layer's effect resolve
 * (resolveEffect3DTexture). Two properties matter and both are asserted here:
 *
 *   • Effects whose shaders write OUTSIDE the layer's box must report a spread
 *     at least as large as their true reach — an under-estimate hard-clips the
 *     effect at the layer's rectangle, and only on 3D layers (the 2D route
 *     runs its chain over a viewport-sized buffer).
 *   • Effects whose shaders pass through pixels outside the box (the ported
 *     rounds' `wp`/`gp` guard) must report 0 — for them the margin buys
 *     nothing and shrinks the content's own resolution.
 */
import { effectSpreadPx } from '../rendergraph/passes/CompositionPass';
import { Color } from '../core/math/Color';
import type { RenderableEffect } from '../scene/FrameScene';

const W = 200;
const H = 100;
const white = Color.white();

const spread = (e: RenderableEffect): number => effectSpreadPx([e], W, H);

describe('effectSpreadPx', () => {
  test('no effects → 0', () => {
    expect(effectSpreadPx([], W, H)).toBe(0);
  });

  test('gaussian/fast-box blur ride the Gaussian pass — sigma times the ±2.5σ tail', () => {
    // radiusPx arrives pre-converted to the sigma; the shader samples ±2.5σ.
    expect(spread({ type: 'gaussian-blur', radiusPx: 10, dims: 0 })).toBe(25);
    expect(spread({ type: 'fast-box-blur', radiusPx: 4, dims: 1 })).toBe(10);
  });

  test('beam reserves its halo diameter plus any endpoint excursion outside the box', () => {
    const beam = (endX: number, thickness: number, softness: number): RenderableEffect => ({
      type: 'beam', startX: 0, startY: 0.5, endX, endY: 0.5,
      length: 1, thickness, softness, color: white,
    });
    // Endpoints inside the box: reach is the soft halo, thickness·(1+3·softness).
    expect(spread(beam(1, 8, 0))).toBe(8);
    expect(spread(beam(1, 8, 1))).toBe(32);
    // An endpoint 25% past the box adds that excursion in comp px (0.25 · W).
    expect(spread(beam(1.25, 8, 0))).toBe(0.25 * W + 8);
  });

  test('light-rays reach the centre offset plus the ray length', () => {
    const e: RenderableEffect = {
      type: 'light-rays', centerX: 30, centerY: 40, rayCount: 12, rayLength: 60,
      spread: 0, rotation: 0, opacity: 1, falloff: 0.5, seed: 1, composite: 1, color: white,
    };
    expect(spread(e)).toBe(Math.hypot(30, 40) + 60);
  });

  test('lens-flare covers the farthest ghost and the halo', () => {
    const e: RenderableEffect = { type: 'lens-flare', centerX: 40, centerY: 0, brightness: 1, scale: 2, color: white };
    // Ghosts land up to 2.8 centre-offsets beyond the mid; halo is 0.35·span·scale.
    // The estimate must be at least that reach.
    expect(spread(e)).toBeGreaterThanOrEqual(2.8 * 40 + 0.35 * Math.max(W, H) * 2);
  });

  test('motion-tile is unbounded, and the identity scale asks for nothing', () => {
    expect(spread({ type: 'motion-tile', scale: 2 })).toBe(Number.POSITIVE_INFINITY);
    expect(spread({ type: 'motion-tile', scale: 1 })).toBe(0);
  });

  test('box-clipped ported effects stay at 0 — their shaders pass through outside the box', () => {
    const clipped: RenderableEffect[] = [
      { type: 'directional-blur', dx: 1, dy: 0, length: 40, steps: 40, lw: W, lh: H },
      { type: 'radial-blur', cx: 100, cy: 50, amount: 50, zoom: false, steps: 16, lw: W, lh: H },
      { type: 'transform', px: 50, py: 0, scale: 2, rot: 0, opacity: 1, lw: W, lh: H },
      { type: 'offset', tx: 60, ty: 0, keep: 0, lw: W, lh: H },
      { type: 'minimax', op: 1, radius: 10, mask: 7, dir: 0, lw: W, lh: H },
      { type: 'turbulent-displace', p: [[W, H, 30, 0.01], [0, 3, 0, 0]] },
      { type: 'scatter', p: [[W, H, 20, 0], [1, 0, 0, 0]] },
    ];
    for (const e of clipped) expect(spread(e)).toBe(0);
  });

  test('the chain reports the MAX across its effects', () => {
    const effects: RenderableEffect[] = [
      { type: 'gaussian-blur', radiusPx: 2, dims: 0 },
      { type: 'light-rays', centerX: 0, centerY: 0, rayCount: 8, rayLength: 90, spread: 0, rotation: 0, opacity: 1, falloff: 0, seed: 0, composite: 1, color: white },
    ];
    expect(effectSpreadPx(effects, W, H)).toBe(90);
  });
});
