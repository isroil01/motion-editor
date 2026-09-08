/**
 * Path-following effects — the geometry hand-off and the kernels.
 *
 * The full pipeline (buildSnapshot resolves `pathMaskId` → `pathPoints`,
 * canvas2dEffects branches on it) is exercised in the app; what is pinned
 * here is the pure maths a wrong constant would break silently: the polyline
 * flattening, the arc-length walk of the path brush, and the CPU-bake gate
 * that keeps a path-assigned effect off the straight-line GPU shader.
 */

import { maskPathPolyline, type MaskPath } from './mask';
import { writeOnPathData } from './generateRoundFive';
import { effectsNeedCpuBake } from './effectBake';
import type { Effect } from './effects';

const corner = (x: number, y: number): MaskPath['points'][number] =>
  ({ x, y, inX: x, inY: y, outX: x, outY: y });

const squarePath = (half: number): MaskPath => ({
  id: 'p1',
  name: 'square',
  mode: 'none',
  closed: true,
  points: [corner(-half, -half), corner(half, -half), corner(half, half), corner(-half, half)],
  feather: 0,
  opacity: 1,
  expansion: 0,
  inverted: false,
});

describe('maskPathPolyline', () => {
  it('flattens a closed square to a loop whose arc length is the perimeter', () => {
    const flat = maskPathPolyline(squarePath(50));
    expect(flat.length % 2).toBe(0);
    const n = flat.length / 2;
    let arc = 0;
    for (let i = 1; i < n; i++) {
      arc += Math.hypot(flat[i * 2]! - flat[(i - 1) * 2]!, flat[i * 2 + 1]! - flat[(i - 1) * 2 + 1]!);
    }
    expect(arc).toBeCloseTo(400, 3); // 4 × 100, corner anchors = straight cubics
    // Closed: the sampled loop returns to its start.
    expect(flat[flat.length - 2]).toBeCloseTo(flat[0]!, 6);
    expect(flat[flat.length - 1]).toBeCloseTo(flat[1]!, 6);
  });

  it('answers an unusable path with an empty array', () => {
    expect(maskPathPolyline({ ...squarePath(10), points: [corner(0, 0)] })).toEqual([]);
  });
});

describe('writeOnPathData', () => {
  const W = 100;
  const H = 100;
  const blank = (): Uint8ClampedArray => new Uint8ClampedArray(W * H * 4);
  const paintedNear = (out: Uint8ClampedArray, x: number, y: number, r = 4): boolean => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        if (out[(py * W + px) * 4 + 3]! > 0) return true;
      }
    }
    return false;
  };

  // An L along the left and bottom edges of a centred square, in CENTRED
  // coords: (-40,-40) → (-40,40) → (40,40). Raster: (10,10) → (10,90) → (90,90).
  const L = [-40, -40, -40, 40, 40, 40];

  it('reveals by arc length: half completion covers the first leg only', () => {
    const out = writeOnPathData(blank(), W, H, L, 50, 6, [255, 0, 0], 0);
    expect(paintedNear(out, 10, 10)).toBe(true);   // start of leg 1
    expect(paintedNear(out, 10, 85)).toBe(true);   // end of leg 1 (arc 75/160 < 50%... within)
    expect(paintedNear(out, 85, 90)).toBe(false);  // far end of leg 2 — not yet
  });

  it('full completion reaches the end of the path', () => {
    const out = writeOnPathData(blank(), W, H, L, 100, 6, [255, 0, 0], 0);
    expect(paintedNear(out, 90, 90)).toBe(true);
  });

  it('zero completion paints nothing', () => {
    const out = writeOnPathData(blank(), W, H, L, 0, 6, [255, 0, 0], 0);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe('effectsNeedCpuBake — path gate', () => {
  const writeOn = (params: Record<string, unknown>): Effect =>
    ({ id: 'e1', type: 'write-on', params } as unknown as Effect);

  it('a path-assigned write-on forces the CPU chain', () => {
    expect(effectsNeedCpuBake([writeOn({ pathMaskId: 'obj_1' })])).toBe(true);
  });

  it('without a path the GPU shader keeps the effect', () => {
    expect(effectsNeedCpuBake([writeOn({ pathMaskId: '' })])).toBe(false);
    expect(effectsNeedCpuBake([writeOn({})])).toBe(false);
  });
});
