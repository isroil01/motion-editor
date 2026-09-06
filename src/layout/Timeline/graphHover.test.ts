import { keyframesInBox, nearestCurveAt, pointInBox, valueAtTime, type BoxSelectPath } from './graphHover';

const kf = (nodeId: string, prop: string, t: number, tAbs: number, y: number) => ({ nodeId, prop, t, tAbs, y });

const paths: BoxSelectPath[] = [
  { nodeId: 'a', prop: 'opacity', keyframes: [kf('a', 'opacity', 0, 0, 100), kf('a', 'opacity', 1, 1, 20), kf('a', 'opacity', 2, 2, 60)] },
  { nodeId: 'b', prop: 'x', keyframes: [kf('b', 'x', 0.5, 0.5, 80), kf('b', 'x', 1.5, 1.5, 10)] },
];
const id = (n: string, p: string, t: number) => `${n}|${p}|${t}`;

describe('keyframesInBox — the graph editor marquee', () => {
  it('catches every diamond inside the box, across curves', () => {
    // pps = 100: diamonds at x = 0, 100, 200 (a) and 50, 150 (b).
    const got = keyframesInBox(paths, { x0: 40, y0: 0, x1: 160, y1: 120 }, [], 100, id);
    expect(got).toEqual(new Set([id('a', 'opacity', 1), id('b', 'x', 0.5), id('b', 'x', 1.5)]));
  });

  it('corner order does not matter — a box dragged up-left is the same box', () => {
    const a = keyframesInBox(paths, { x0: 40, y0: 0, x1: 160, y1: 120 }, [], 100, id);
    const b = keyframesInBox(paths, { x0: 160, y0: 120, x1: 40, y1: 0 }, [], 100, id);
    expect(b).toEqual(a);
  });

  it('respects Y, so a box across the top of the graph misses low diamonds', () => {
    const got = keyframesInBox(paths, { x0: 0, y0: 0, x1: 250, y1: 30 }, [], 100, id);
    expect(got).toEqual(new Set([id('a', 'opacity', 1), id('b', 'x', 1.5)]));
  });

  it('a tangent HANDLE inside the box selects the keyframe it hangs off', () => {
    // The diamond at (200, 60) is outside; its out-handle at (230, 40) is in.
    const handles = [{ nodeId: 'a', prop: 'opacity', t: 2, x: 230, y: 40 }];
    const got = keyframesInBox(paths, { x0: 220, y0: 30, x1: 240, y1: 50 }, handles, 100, id);
    expect(got).toEqual(new Set([id('a', 'opacity', 2)]));
  });

  it('a handle outside the box adds nothing', () => {
    const handles = [{ nodeId: 'a', prop: 'opacity', t: 2, x: 230, y: 40 }];
    const got = keyframesInBox(paths, { x0: 0, y0: 0, x1: 10, y1: 10 }, handles, 100, id);
    expect(got.size).toBe(0);
  });

  it('diamond and its handle in the same box are one selection entry', () => {
    const handles = [{ nodeId: 'a', prop: 'opacity', t: 1, x: 120, y: 25 }];
    const got = keyframesInBox(paths, { x0: 90, y0: 10, x1: 130, y1: 30 }, handles, 100, id);
    expect(got).toEqual(new Set([id('a', 'opacity', 1)]));
  });

  it('an empty box selects nothing', () => {
    expect(keyframesInBox(paths, { x0: 300, y0: 300, x1: 310, y1: 310 }, [], 100, id).size).toBe(0);
  });
});

describe('pointInBox', () => {
  it('is inclusive at the edges', () => {
    expect(pointInBox(0, 0, { x0: 0, y0: 0, x1: 10, y1: 10 })).toBe(true);
    expect(pointInBox(10, 10, { x0: 0, y0: 0, x1: 10, y1: 10 })).toBe(true);
    expect(pointInBox(11, 5, { x0: 0, y0: 0, x1: 10, y1: 10 })).toBe(false);
  });
});

describe('hover read-out on curve points', () => {
  const samples = [[0, 0], [1, 10], [2, 0]] as const;

  it('valueAtTime interpolates between the drawn samples', () => {
    expect(valueAtTime(samples, 0.5)).toBe(5);
    expect(valueAtTime(samples, 1)).toBe(10);
    expect(valueAtTime(samples, 1.5)).toBe(5);
  });

  it('clamps outside the sampled span and is null for an empty curve', () => {
    expect(valueAtTime(samples, -1)).toBe(0);
    expect(valueAtTime(samples, 9)).toBe(0);
    expect(valueAtTime([], 1)).toBeNull();
  });

  it('nearestCurveAt picks the curve nearest in Y at the pointer time', () => {
    const curves = [
      { nodeId: 'a', prop: 'opacity', color: 'red', samples, minV: 0, maxV: 10 },
      { nodeId: 'b', prop: 'x', color: 'blue', samples: [[0, 10], [2, 10]] as const, minV: 0, maxV: 10 },
    ];
    // At t=1 both curves are at value 10 → y=0; at t=0 'a' is 0 (y=100), 'b' is 10 (y=0).
    const r = nearestCurveAt(curves, 0, 90, 100);
    expect(r?.prop).toBe('opacity');
    expect(r?.value).toBe(0);
    expect(nearestCurveAt(curves, 0, 10, 100)?.prop).toBe('x');
  });

  it('nearestCurveAt is null past the distance threshold', () => {
    const curves = [{ nodeId: 'a', prop: 'opacity', color: 'red', samples, minV: 0, maxV: 10 }];
    expect(nearestCurveAt(curves, 0, 10, 100, 20)).toBeNull();
  });
});
