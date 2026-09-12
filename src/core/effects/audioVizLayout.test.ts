/**
 * Where an audio visualiser's bars stand.
 *
 * This is the module that made the ring-around-a-logo look possible, and its
 * geometry is exactly the kind that is easy to get subtly wrong and hard to see
 * wrong: a ring whose last bar doubles up on the first, bars crowded into the
 * corners of a rounded rectangle, a normal pointing inward on half a path.
 * Each of those is one assertion here and an eyeball-and-hope exercise inside a
 * canvas kernel.
 */

import { layoutViz, bandColor } from './audioVizLayout';

const W = 800;
const H = 400;
const near = (a: number, b: number, eps = 0.001): void => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('layoutViz — the straight fallback', () => {
  it('runs between Start and End Point, measured from the layer centre', () => {
    const out = layoutViz(W, H, 3, { startX: -100, startY: 0, endX: 100, endY: 0 });
    expect(out.map((s) => s.x)).toEqual([300, 400, 500]);
    expect(out.every((s) => s.y === 200)).toBe(true);
  });

  /** A segment's last sample belongs AT the end point, not one step short. */
  it('places the last sample on the end point', () => {
    const out = layoutViz(W, H, 5, { startX: -100, startY: 0, endX: 100, endY: 0 });
    expect(out[out.length - 1]!.x).toBe(500);
  });

  it('stands the bars perpendicular to the run', () => {
    const out = layoutViz(W, H, 2, { startX: -100, startY: 0, endX: 100, endY: 0 });
    // A left-to-right run: the normal points straight UP, which is −y in canvas
    // space. Getting this backwards hangs the bars off the line instead.
    near(out[0]!.nx, 0);
    near(out[0]!.ny, -1);
  });

  it('survives a zero-length segment rather than producing NaN', () => {
    const out = layoutViz(W, H, 3, { startX: 0, startY: 0, endX: 0, endY: 0 });
    for (const s of out) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.nx)).toBe(true);
      near(Math.hypot(s.nx, s.ny), 1);
    }
  });
});

describe('layoutViz — polar', () => {
  it('puts every bar on the circle, radiating outward', () => {
    const out = layoutViz(W, H, 16, { usePolarPath: true, polarRadius: 100 });
    for (const s of out) {
      near(Math.hypot(s.x - W / 2, s.y - H / 2), 100, 0.01);
      // The normal points away from the centre, so bars grow outward.
      near(s.nx, (s.x - W / 2) / 100, 0.01);
      near(s.ny, (s.y - H / 2) / 100, 0.01);
    }
  });

  it('starts the first bar at the start angle — −90° is twelve o’clock', () => {
    const out = layoutViz(W, H, 4, { usePolarPath: true, polarRadius: 100, startAngle: -90 });
    near(out[0]!.x, W / 2, 0.01);
    near(out[0]!.y, H / 2 - 100, 0.01);
  });

  /**
   * A FULL turn divided by n, not n−1. Using n−1 makes the last bar land on
   * top of the first, which shows up as one double-width bar at the seam — the
   * classic tell of a hand-rolled radial layout.
   */
  it('does not double up the last bar on the first', () => {
    const out = layoutViz(W, H, 8, { usePolarPath: true, polarRadius: 100, startAngle: 0 });
    const gap = Math.hypot(out[1]!.x - out[0]!.x, out[1]!.y - out[0]!.y);
    const seam = Math.hypot(out[7]!.x - out[0]!.x, out[7]!.y - out[0]!.y);
    near(seam, gap, 0.01);
  });

  it('handles a radius of zero without NaN normals', () => {
    const out = layoutViz(W, H, 4, { usePolarPath: true, polarRadius: 0 });
    for (const s of out) near(Math.hypot(s.nx, s.ny), 1);
  });
});

describe('layoutViz — along a path', () => {
  /** A 100×100 square, as a flattened polyline. */
  const square = [
    100, 100, 200, 100, 200, 200, 100, 200, 100, 100,
  ];

  it('takes the path over the polar and straight fallbacks', () => {
    const out = layoutViz(W, H, 4, {
      pathPoints: square,
      usePolarPath: false,
      startX: -999, endX: 999,
    });
    // Every sample sits on the square's outline, not on the ignored segment.
    for (const s of out) {
      const onEdge =
        (Math.abs(s.x - 100) < 0.01 || Math.abs(s.x - 200) < 0.01 || (s.x >= 100 && s.x <= 200));
      expect(onEdge).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(99.99);
      expect(s.x).toBeLessThanOrEqual(200.01);
    }
  });

  /**
   * Equal ARC LENGTH, not equal vertex index. A flattened bezier bunches its
   * vertices around the curvature, so stepping by index crowds the bars into
   * the corners and leaves the straights bare.
   */
  it('spaces samples by arc length, not by vertex', () => {
    // A path whose vertices are deliberately uneven: a long segment described
    // by two points, then a short one described by three.
    const uneven = [0, 0, 300, 0, 310, 0, 320, 0];
    const out = layoutViz(W, H, 4, { pathPoints: uneven });
    const gaps: number[] = [];
    for (let i = 1; i < out.length; i++) {
      gaps.push(Math.hypot(out[i]!.x - out[i - 1]!.x, out[i]!.y - out[i - 1]!.y));
    }
    // Every gap is the same length; an index-stepping implementation would
    // give 300, 10, 10.
    for (const g of gaps) near(g, gaps[0]!, 0.5);
  });

  it('gives every sample a unit normal', () => {
    const out = layoutViz(W, H, 12, { pathPoints: square });
    for (const s of out) near(Math.hypot(s.nx, s.ny), 1);
  });

  it('radiates from the centroid when polar is on as well', () => {
    const out = layoutViz(W, H, 8, { pathPoints: square, usePolarPath: true });
    // The square's centroid is (150, 150); each normal points away from it.
    for (const s of out) {
      const rx = s.x - 150;
      const ry = s.y - 150;
      const rl = Math.hypot(rx, ry);
      if (rl < 0.001) continue;
      near(s.nx, rx / rl, 0.01);
      near(s.ny, ry / rl, 0.01);
    }
  });

  it('ignores a degenerate path and falls through', () => {
    // Two points at the same place have no length to walk along.
    expect(layoutViz(W, H, 4, { pathPoints: [5, 5, 5, 5] })).toEqual([]);
    // Fewer than two points is not a path at all — fall back to the segment.
    expect(layoutViz(W, H, 4, { pathPoints: [5, 5] })).toHaveLength(4);
  });
});

describe('layoutViz — contract', () => {
  it('returns exactly the requested count, so a kernel can zip without checks', () => {
    for (const n of [1, 2, 7, 64]) {
      expect(layoutViz(W, H, n, {})).toHaveLength(n);
      expect(layoutViz(W, H, n, { usePolarPath: true })).toHaveLength(n);
    }
  });

  it('returns nothing for a count of zero or less', () => {
    expect(layoutViz(W, H, 0, {})).toEqual([]);
    expect(layoutViz(W, H, -3, {})).toEqual([]);
  });
});

describe('bandColor', () => {
  it('interpolates between the two stops', () => {
    expect(bandColor(0, 3, '#000000', '#ffffff', 0)).toBe('rgb(0, 0, 0)');
    expect(bandColor(2, 3, '#000000', '#ffffff', 0)).toBe('rgb(255, 255, 255)');
  });

  /** At 0 this must be a plain blend, so existing projects are untouched. */
  it('does not rotate hue when interpolation is 0', () => {
    expect(bandColor(1, 3, '#ff0000', '#ff0000', 0)).toBe('rgb(255, 0, 0)');
  });

  it('rotates hue across the range when asked', () => {
    const first = bandColor(0, 4, '#ff0000', '#ff0000', 180);
    const last = bandColor(3, 4, '#ff0000', '#ff0000', 180);
    // The first band is unshifted (t = 0); the last has moved.
    expect(first).toBe('rgb(255, 0, 0)');
    expect(last).not.toBe('rgb(255, 0, 0)');
  });

  it('falls back to white on an unparseable colour rather than throwing', () => {
    expect(bandColor(0, 1, 'not-a-colour', 'also-not', 0)).toBe('rgb(255, 255, 255)');
  });

  it('never emits a channel outside 0..255', () => {
    for (let d = 0; d <= 360; d += 30) {
      const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(bandColor(1, 2, '#00ff88', '#8800ff', d))!;
      for (let i = 1; i <= 3; i++) {
        expect(Number(m[i])).toBeGreaterThanOrEqual(0);
        expect(Number(m[i])).toBeLessThanOrEqual(255);
      }
    }
  });
});
