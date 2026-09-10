/**
 * Energy Beam — the geometry and the promises the plan made (A2): the spine
 * fits the uniform budget without losing its shape, the reveal window is
 * exact, the field is what the shader mirrors, and two renders at the same
 * params are byte-identical.
 */

import { BEAM_MAX_POINTS, BEAM_PEN_UP, beamFieldAt, beamFlicker, beamPathData, beamPathRows, beamPathSettings, beamSpine, type BeamPathSettings } from './beamPath';
import type { Effect } from './effects';

function circle(n: number, r: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; out.push(Math.cos(a) * r, Math.sin(a) * r); }
  return out;
}

const BASE: BeamPathSettings = {
  points: [20, 50, 180, 50], totalLen: 160,
  coreWidth: 8, coreSoftness: 0.3, coreColor: [1, 1, 1], glowColor: [0.2, 0.6, 1],
  glowSpread: 20, glowIntensity: 1, glowExponent: 2, start: 0, end: 1, startSize: 1, endSize: 1,
  distortion: 0, distortionScale: 80, evolution: 0, composite: 0, flicker: 1,
};

describe('energy beam', () => {
  it('resamples a dense spine to the uniform budget by arc length and keeps sub-paths apart', () => {
    const dense = circle(400, 100);
    const { points, totalLen } = beamSpine(dense);
    expect(points.length / 2).toBeLessThanOrEqual(BEAM_MAX_POINTS);
    expect(totalLen).toBeCloseTo(2 * Math.PI * 100, 0);
    // Every resampled vertex still lies on the circle.
    for (let i = 0; i + 1 < points.length; i += 2) expect(Math.hypot(points[i]!, points[i + 1]!)).toBeCloseTo(100, 0);
    const two = beamSpine([...circle(50, 40), BEAM_PEN_UP, 0, ...circle(50, 90)]);
    expect(two.points.filter((v) => v >= BEAM_PEN_UP)).toHaveLength(1);
    expect(two.points.length / 2).toBeLessThanOrEqual(BEAM_MAX_POINTS);
    // A short spine is passed through untouched.
    expect(beamSpine([0, 0, 10, 0, 10, 10]).points).toEqual([0, 0, 10, 0, 10, 10]);
  });

  it('draws a full core on the line, glow off it, nothing far away, and honours the reveal window', () => {
    const on = beamFieldAt(100, 50, BASE);
    expect(on.core).toBeCloseTo(1, 5);
    const near = beamFieldAt(100, 50 + 4 + 20, BASE);
    expect(near.core).toBe(0);
    expect(near.glow).toBeCloseTo(0.25, 3); // (1 + 20/20)^-2
    const far = beamFieldAt(100, 50 + 4 + 300, BASE);
    expect(far.glow).toBe(0);
    // Window 25..75 % of a 160 px line = x ∈ [60, 140].
    const w = { ...BASE, start: 0.25, end: 0.75 };
    expect(beamFieldAt(100, 50, w).core).toBeCloseTo(1, 5);
    expect(beamFieldAt(40, 50, w).core).toBe(0);
    // Just outside the window the glow falls off from the END of the window, not the line.
    expect(beamFieldAt(60 - 24, 50, w).glow).toBeCloseTo(0.25, 3);
  });

  it('tapers the half-width from Start Size to End Size', () => {
    const t = { ...BASE, startSize: 0.25, endSize: 1 };
    // At x = 20 (start) the half-width is 1 px; at x = 180 (end) it is 4 px.
    expect(beamFieldAt(21, 50 + 3, t).core).toBe(0);
    expect(beamFieldAt(179, 50 + 3, t).core).toBeGreaterThan(0.5);
  });

  it('packs the rows both engines read: 7 param rows then 32 point rows', () => {
    const rows = beamPathRows(BASE, 200, 100);
    expect(rows).toHaveLength(39);
    expect(rows[0]).toEqual([200, 100, 2, 160]);
    expect(rows[7]).toEqual([20, 50, 180, 50]);
    expect(rows[8]![0]).toBe(BEAM_PEN_UP);
  });

  it('is byte-identical across renders and deterministic in its flicker', () => {
    const w = 120; const h = 80;
    const src = new Uint8ClampedArray(w * h * 4);
    const s: BeamPathSettings = { ...BASE, points: [10, 40, 110, 40], totalLen: 100, distortion: 6, evolution: 3 };
    const a = beamPathData(src, w, h, s);
    const b = beamPathData(src, w, h, s);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(a[(40 * w + 60) * 4 + 3]).toBe(255);
    expect(a[(5 * w + 5) * 4 + 3]).toBeLessThan(60); // glow tail only, far from the line
    expect(beamFlicker(1.234, 12, 7, 0.5)).toBe(beamFlicker(1.234, 12, 7, 0.5));
    expect(beamFlicker(1.234, 12, 7, 0)).toBe(1);
    const f = beamFlicker(0.4, 12, 7, 1);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(1);
  });

  it('resolves params: a mask polyline wins over the line unless Path is Start → End', () => {
    const e: Effect = { id: 'b', type: 'beam-path', params: { source: 0, pathPoints: circle(16, 50), coreWidth: 6, glowSpread: 30, glowIntensity: 100, glowBias: 33, start: 0, end: 100, startSize: 100, endSize: 100, coreSoftness: 30, distortionScale: 80, flickerRate: 12 } };
    const s = beamPathSettings(e, 200, 200);
    expect(s.points.length / 2).toBe(17);
    expect(s.points[0]).toBeCloseTo(150, 5); // centred → top-left origin
    expect(s.totalLen).toBeGreaterThan(300);
    const line = beamPathSettings({ ...e, params: { ...e.params, source: 1, startX: -50, startY: 0, endX: 50, endY: 0 } }, 200, 200);
    expect(line.points).toEqual([50, 100, 150, 100]);
    expect(line.glowExponent).toBeCloseTo(1.99, 2);
  });
});
