/**
 * Plexus (plan A4): the link rule, the triangle rule, the cloud's determinism
 * and its drift, and the particle field's use of it.
 */

import { PLEXUS_MAX_POINTS, plexusLinks, plexusPointCloud } from './plexus';
import { DEFAULT_PARTICLE_CONFIG, simulateParticles } from '@core/particles/particleSim';
import { particleSprites } from '@core/particles/particleRender';

describe('plexus', () => {
  it('links every pair inside Max Distance with an opacity that falls to zero at the edge', () => {
    const pts = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 40 }, { x: 500, y: 500 }];
    const { lines } = plexusLinks(pts, 60, false);
    expect(lines.map(([i, j]) => `${i}-${j}`)).toEqual(['0-1', '0-2', '1-2']);
    const w01 = lines.find(([i, j]) => i === 0 && j === 1)![2];
    expect(w01).toBeCloseTo(0.5, 9);
    expect(lines.find(([i, j]) => i === 1 && j === 2)![2]).toBeCloseTo(1 - 50 / 60, 9);
    expect(plexusLinks(pts, 0, true).lines).toHaveLength(0);
  });

  it('fills only mutually-close triples', () => {
    const pts = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 40 }, { x: 80, y: 0 }];
    const { tris } = plexusLinks(pts, 60, true);
    // 0-1-2 is a triangle (all sides < 60); 1-3 links (50) but 0-3 (80) does not.
    expect(tris).toEqual([[0, 1, 2]]);
  });

  it('caps the points it links, so the cost stays bounded', () => {
    const pts = Array.from({ length: PLEXUS_MAX_POINTS + 50 }, (_, i) => ({ x: i * 0.01, y: 0 }));
    const { lines } = plexusLinks(pts, 1, false);
    const maxIndex = Math.max(...lines.map(([, j]) => j));
    expect(maxIndex).toBe(PLEXUS_MAX_POINTS - 1);
  });

  it('the point cloud is a closed form of (index, evolution): identical twice, inside the spread box, and moving with Evolution', () => {
    const a = plexusPointCloud(400, 300, { pointCount: 50, spread: 0.5, drift: 0, evolution: 3, seed: 9 });
    const b = plexusPointCloud(400, 300, { pointCount: 50, spread: 0.5, drift: 0, evolution: 3, seed: 9 });
    expect(a).toEqual(b);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(100); expect(p.x).toBeLessThanOrEqual(300);
      expect(p.y).toBeGreaterThanOrEqual(75); expect(p.y).toBeLessThanOrEqual(225);
    }
    const drifted = plexusPointCloud(400, 300, { pointCount: 50, spread: 0.5, drift: 20, evolution: 3, seed: 9 });
    const later = plexusPointCloud(400, 300, { pointCount: 50, spread: 0.5, drift: 20, evolution: 9, seed: 9 });
    let moved = 0;
    for (let i = 0; i < 50; i++) {
      expect(Math.hypot(drifted[i]!.x - a[i]!.x, drifted[i]!.y - a[i]!.y)).toBeLessThanOrEqual(20 * Math.SQRT2 + 1e-9);
      if (Math.hypot(later[i]!.x - drifted[i]!.x, later[i]!.y - drifted[i]!.y) > 0.01) moved++;
    }
    expect(moved).toBeGreaterThan(40);
    expect(plexusPointCloud(400, 300, { pointCount: 5000, spread: 1, drift: 0, evolution: 0, seed: 1 })).toHaveLength(PLEXUS_MAX_POINTS);
  });

  it('the particle field marks heads (not trail ghosts) as the points a plexus links', () => {
    const cfg = { ...DEFAULT_PARTICLE_CONFIG, birthRate: 30, lifetime: 1, trailLength: 4, trailSpacing: 0.05 };
    const sprites = particleSprites(cfg, 0.8, 400, 400);
    const heads = sprites.filter((s) => s.head);
    expect(heads).toHaveLength(simulateParticles(cfg, 0.8).length);
    expect(sprites.length).toBeGreaterThan(heads.length);
  });
});
