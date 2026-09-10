/**
 * Height displacement (plan B1): the pure mesh maths — subdivision keeps the
 * surface watertight and the triangle order, displacement moves vertices by
 * (h − 0.5)·amount along their normals, normals follow the relief, and the
 * memo is keyed by everything that changes the result.
 */

import { MESH_STRIDE, clearHeightFieldCache, displaceMesh, displacedMeshFor, getHeightField, positionGroups, primeHeightField, recomputeNormals, sampleHeight, subdivideMesh, type HeightField } from './heightDisplacement';

/** A unit quad in the xy plane facing −z (two triangles), uv = position. */
function quad(): { vertices: Float32Array; indices: Uint32Array } {
  const v = (x: number, y: number): number[] => [x, y, 0, 0, 0, -1, x, y];
  return {
    vertices: Float32Array.from([...v(0, 0), ...v(1, 0), ...v(1, 1), ...v(0, 1)]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  };
}

const flat: HeightField = { width: 2, height: 2, data: Float32Array.from([0.5, 0.5, 0.5, 0.5]) };
const ramp: HeightField = { width: 2, height: 2, data: Float32Array.from([0, 1, 0, 1]) }; // u ramps 0 → 1

describe('height displacement', () => {
  afterEach(() => clearHeightFieldCache());

  it('samples the field bilinearly and clamps to the edge (uv = 1 is the last texel, not the seam)', () => {
    expect(sampleHeight(ramp, 0, 0.3)).toBe(0);
    expect(sampleHeight(ramp, 1, 0.3)).toBe(1);
    expect(sampleHeight(ramp, 0.25, 0.9)).toBeCloseTo(0.25, 9);
    expect(sampleHeight(ramp, 1.25, 0)).toBe(1);
  });

  it('subdivides each triangle into four, sharing edge midpoints, in source order', () => {
    const q = quad();
    const s = subdivideMesh(q.vertices, q.indices, 1);
    expect(s.indices).toHaveLength(24);
    // 4 corners + 5 distinct edge midpoints (the diagonal is shared).
    expect(s.vertices.length / MESH_STRIDE).toBe(9);
    // Triangle 0's four children come first, triangle 1's after.
    expect(Array.from(s.indices.slice(0, 12)).every((i) => i === 0 || i === 1 || i === 2 || i >= 4)).toBe(true);
    // Every attribute interpolated: the midpoint of (0,0)-(1,0) has uv (0.5,0).
    const mid = Array.from(s.indices.slice(0, 12)).find((i) => i >= 4)!;
    expect(s.vertices[mid * MESH_STRIDE + 6]).toBe(0.5);
    expect(s.vertices[mid * MESH_STRIDE + 7]).toBe(0);
    expect(subdivideMesh(q.vertices, q.indices, 2).indices).toHaveLength(96);
    expect(subdivideMesh(q.vertices, q.indices, 0).indices).toHaveLength(6);
  });

  it('a flat (50 % grey) field leaves positions exactly where they were', () => {
    const q = quad();
    const d = displaceMesh(q.vertices, q.indices, flat, 40, 0);
    for (let i = 0; i < 4; i++) {
      expect(d.vertices[i * MESH_STRIDE]).toBe(q.vertices[i * MESH_STRIDE]);
      expect(d.vertices[i * MESH_STRIDE + 2]).toBe(0);
    }
    expect(d.triangleScale).toBe(1);
  });

  it('moves vertices along their normals by (h − 0.5)·amount and tilts the normals toward the slope', () => {
    const q = quad();
    const d = displaceMesh(q.vertices, q.indices, ramp, 40, 1);
    expect(d.triangleScale).toBe(4);
    // u = 0 corners sink by 20 along −z → z = +20; u = 1 corners rise → z = −20.
    expect(d.vertices[0 * MESH_STRIDE + 2]).toBeCloseTo(20, 6);
    expect(d.vertices[1 * MESH_STRIDE + 2]).toBeCloseTo(-20, 6);
    // The surface now slopes in x, so a normal has an x component and still faces −z.
    const nx = d.vertices[0 * MESH_STRIDE + 3]!; const nz = d.vertices[0 * MESH_STRIDE + 5]!;
    expect(Math.abs(nx)).toBeGreaterThan(0.1);
    expect(nz).toBeLessThan(0);
    expect(Math.hypot(nx, d.vertices[0 * MESH_STRIDE + 4]!, nz)).toBeCloseTo(1, 6);
  });

  it('recomputed normals keep the authored sense of a face', () => {
    const q = quad();
    recomputeNormals(q.vertices, q.indices);
    for (let i = 0; i < 4; i++) expect(q.vertices[i * MESH_STRIDE + 5]).toBeCloseTo(-1, 6);
  });

  it('displaces coincident vertices (a seam column, a pole fan) as ONE point, so the mesh stays closed', () => {
    // Two vertices at the same place with the same normal but uv 0 and 1 on a
    // ramp: per-vertex sampling would push them 0 and 40 apart (a tear); they
    // must share the mean.
    const v = new Float32Array([
      0, 0, 0, 0, 0, 1, 0, 0,
      0, 0, 0, 0, 0, 1, 1, 0,
      1, 0, 0, 0, 0, 1, 0.5, 0,
      0, 1, 0, 0, 0, 1, 0.5, 1,
    ]);
    const idx = new Uint16Array([0, 2, 3, 1, 3, 2]);
    const g = positionGroups(v);
    expect(g[0]).toBe(g[1]);
    expect(g[2]).not.toBe(g[0]);
    const d = displaceMesh(v, idx, ramp, 40, 0);
    expect(d.vertices[0 * MESH_STRIDE + 2]).toBeCloseTo(d.vertices[1 * MESH_STRIDE + 2]!, 9);
    expect(d.vertices[0 * MESH_STRIDE + 2]).toBeCloseTo(0, 9); // mean(0, 1) − 0.5 = 0
    // A hard edge (same place, normals 90° apart) is NOT pooled.
    const hard = new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const hg = positionGroups(hard);
    expect(hg[0]).not.toBe(hg[1]);
  });

  it('memoises by mesh, field, amount and subdivisions, and the cache serves primed fields synchronously', () => {
    primeHeightField('prime:ramp', ramp);
    expect(getHeightField('prime:ramp', undefined)).toBe(ramp);
    expect(getHeightField('missing', undefined)).toBeUndefined();
    const q = quad();
    const a = displacedMeshFor('m', 'prime:ramp', q.vertices, q.indices, ramp, 10, 0);
    const b = displacedMeshFor('m', 'prime:ramp', q.vertices, q.indices, ramp, 10, 0);
    expect(b.vertices).toBe(a.vertices);
    expect(a.key).toBe('m|disp:prime:ramp:10.000:0');
    const c = displacedMeshFor('m', 'prime:ramp', q.vertices, q.indices, ramp, 12, 0);
    expect(c.vertices).not.toBe(a.vertices);
  });
});
