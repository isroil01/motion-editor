/**
 * The frame the alpha-coverage mask lands is the one frame where a puppet's
 * rest mesh changes under pins that were placed on the bbox grid — including
 * pins that now sit OUTSIDE the outline. The ledger's "black first frame after
 * alpha decode" (2026-09-06) was never reproduced; this pins down the one
 * thing that could have produced it from the solver's side: the very first
 * deform of the new mesh must be finite, must span the artwork, and must be
 * bit-identical to the second (no warm-up state in the ARAP factorisation).
 */
import { deform, coverageMaskFromImageData, getCachedRestMesh, type PuppetRig } from '../puppet';

function makeBitmap(width: number, height: number, alphaAt: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = alphaAt(x, y);
    }
  }
  return { data, width, height };
}
const disc = makeBitmap(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) <= 30 ? 255 : 0));

function extent(v: Float32Array): { nan: number; w: number; h: number } {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, nan = 0;
  for (let i = 0; i < v.length; i += 4) {
    const x = v[i]!, y = v[i + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) { nan++; continue; }
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
  }
  return { nan, w: maxx - minx, h: maxy - miny };
}

describe('first deform after the coverage mesh replaces the bbox grid', () => {
  for (const meshMode of ['grid', 'outline', 'tight'] as const) {
    for (const solver of ['arap', 'lbs'] as const) {
      it(`${meshMode} / ${solver}: finite, artwork-sized, and identical to the second call`, () => {
        const rig = {
          meshExpansion: 0, meshDensity: 20, meshMode,
          pins: [
            { id: 'a', name: 'A', x: -45, y: -45 }, // outside the disc — placed on the bbox grid
            { id: 'b', name: 'B', x: 10, y: 0 },
            { id: 'c', name: 'C', x: 0, y: 20 },
          ],
        } as PuppetRig;
        const key = `cov-first-${meshMode}-${solver}`;
        const before = getCachedRestMesh(key, 100, 100, 0, rig, undefined, undefined);
        const moved = [{ id: 'a', x: -40, y: -50 }, { id: 'b', x: 14, y: 3 }, { id: 'c', x: 0, y: 20 }];
        expect(extent(deform(moved, before, solver)).nan).toBe(0);

        const after = getCachedRestMesh(key, 100, 100, 0, rig, undefined, coverageMaskFromImageData(disc));
        expect(after).not.toBe(before);
        const first = deform(moved, after, solver);
        const second = deform(moved, after, solver);
        const e = extent(first);
        expect(e.nan).toBe(0);
        expect(e.w).toBeGreaterThan(20);
        expect(e.h).toBeGreaterThan(20);
        expect(Array.from(first)).toEqual(Array.from(second));
      });
    }
  }
});
