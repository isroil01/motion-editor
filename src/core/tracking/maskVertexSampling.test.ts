import { blendVertexDeltas, sampleMaskVertices, MAX_TRACKED_VERTICES } from './maskVertexSampling';

function circle(n: number, r = 100, cx = 0, cy = 0): Array<{ x: number; y: number }> {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

describe('sampleMaskVertices', () => {
  it('tracks every vertex, in path order, within the cap (the byte-identical fast path)', () => {
    const paths = [
      { points: circle(40), closed: true },
      { points: circle(24, 30), closed: false },
    ];
    const s = sampleMaskVertices(paths, MAX_TRACKED_VERTICES);
    expect(s.total).toBe(64);
    expect(s.tracked).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(s.slotOf).toEqual(Array.from({ length: 64 }, (_, i) => i));
    for (let v = 0; v < 64; v++) expect(s.blend[v]).toEqual({ a: v, b: v, w: 0 });
  });

  it('a 200-vertex circle: tracks at most 64, evenly spaced along the loop', () => {
    const s = sampleMaskVertices([{ points: circle(200), closed: true }]);
    expect(s.tracked.length).toBeLessThanOrEqual(64);
    expect(s.tracked.length).toBeGreaterThanOrEqual(60);
    expect(s.total).toBe(200);
    // Uniform vertex spacing → uniform index spacing: 200/64 = 3.125, so
    // consecutive picks are 3 or 4 apart, including the wrap.
    const gaps = s.tracked.map((v, k) => (k + 1 < s.tracked.length ? s.tracked[k + 1]! - v : 200 - v + s.tracked[0]!));
    for (const g of gaps) expect([3, 4]).toContain(g);
    // Every slot maps back to its vertex; every vertex has a blend.
    s.tracked.forEach((v, k) => expect(s.slotOf[v]).toBe(k));
    expect(s.blend.every((b) => b !== undefined)).toBe(true);
  });

  it('a 200-vertex circle under a pure translation moves every vertex by exactly that translation', () => {
    const s = sampleMaskVertices([{ points: circle(200), closed: true }]);
    const d = { x: 7.25, y: -3.5 };
    const out = blendVertexDeltas(s, s.tracked.map(() => ({ ...d })));
    expect(out.length).toBe(200);
    for (const o of out) {
      expect(Math.abs(o.x - d.x)).toBeLessThan(1e-6);
      expect(Math.abs(o.y - d.y)).toBeLessThan(1e-6);
    }
  });

  it('samples by arc length, not by index: a dense cluster is one feature', () => {
    // 100 vertices jammed into 1 px, then 20 vertices spread over 1000 px.
    const cluster = Array.from({ length: 100 }, (_, i) => ({ x: i * 0.01, y: 0 }));
    const spread = Array.from({ length: 20 }, (_, i) => ({ x: 50 + i * 50, y: 0 }));
    const s = sampleMaskVertices([{ points: [...cluster, ...spread], closed: false }], 10);
    expect(s.tracked.length).toBeLessThanOrEqual(10);
    const inSpread = s.tracked.filter((v) => v >= 100).length;
    expect(inSpread).toBeGreaterThanOrEqual(8);
    expect(s.tracked[0]).toBe(0);
    expect(s.tracked[s.tracked.length - 1]).toBe(119);
  });

  it('blends an untracked vertex linearly in arc length between its two tracked neighbours', () => {
    // Open path 0 — 10 — 15 — 40 with a cap of 2: the ends are tracked.
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 0 }, { x: 40, y: 0 }];
    const s = sampleMaskVertices([{ points: pts, closed: false }], 2);
    expect(s.tracked).toEqual([0, 3]);
    expect(s.blend[1]).toEqual({ a: 0, b: 1, w: 0.25 });
    expect(s.blend[2]).toEqual({ a: 0, b: 1, w: 0.375 });
    const out = blendVertexDeltas(s, [{ x: 0, y: 0 }, { x: 8, y: 16 }]);
    expect(out[1]).toEqual({ x: 2, y: 4 });
    expect(out[2]).toEqual({ x: 3, y: 6 });
  });

  it('wraps around a closed loop for vertices past the last tracked one', () => {
    // Square-ish loop, 8 vertices, cap 4 → every other vertex tracked; the
    // odd ones sit halfway between neighbours, including 7 between 6 and 0.
    const pts = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 },
      { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 1 },
    ];
    const s = sampleMaskVertices([{ points: pts, closed: true }], 4);
    expect(s.tracked).toEqual([0, 2, 4, 6]);
    expect(s.blend[7]).toEqual({ a: 3, b: 0, w: 0.5 });
    expect(s.blend[1]).toEqual({ a: 0, b: 1, w: 0.5 });
  });

  it('shares the cap across paths and keeps a skeleton for each', () => {
    const s = sampleMaskVertices([
      { points: circle(300), closed: true },
      { points: circle(100, 20), closed: true },
      { points: circle(5, 5), closed: false },
    ]);
    expect(s.tracked.length).toBeLessThanOrEqual(64);
    expect(s.tracked.length).toBeGreaterThanOrEqual(60);
    const perPath = [0, 0, 0];
    for (const v of s.tracked) perPath[v < 300 ? 0 : v < 400 ? 1 : 2]! += 1;
    expect(perPath[0]).toBeGreaterThan(perPath[1]!);
    expect(perPath[1]).toBeGreaterThanOrEqual(3);
    expect(perPath[2]).toBeGreaterThanOrEqual(2);
    expect(s.blend.every((b) => b !== undefined)).toBe(true);
    // Pure translation still reaches every one of the 405 vertices exactly.
    const out = blendVertexDeltas(s, s.tracked.map(() => ({ x: -2, y: 9 })));
    expect(out.every((o) => Math.abs(o.x + 2) < 1e-6 && Math.abs(o.y - 9) < 1e-6)).toBe(true);
  });
});
