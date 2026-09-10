/**
 * Particles v2 (plan A3): what the new closed forms promise.
 *
 *  · configs that predate v2 render byte-identically (the defaults are the
 *    old formulas — drag 0, no mid-points, point emitter);
 *  · drag is the EXACT solution of v' = a − k·v, checked against a fine
 *    numeric integration, and its k→0 limit is the ballistic formula;
 *  · the sphere emitter fills a ball and gives every particle a z;
 *  · the mid-point ramps pass through their mid value at midAge;
 *  · continuous children are born along the parent's path and die on time;
 *  · velocity streaks report the closed-form velocity, and only when on.
 */

import { DEFAULT_PARTICLE_CONFIG, colorRampAt, emitterOrigin, flightAt, rampAt, simulateParticles, type ParticleConfig } from './particleSim';
import { particleSprites } from './particleRender';

const base = (over: Partial<ParticleConfig> = {}): ParticleConfig => ({
  ...DEFAULT_PARTICLE_CONFIG, birthRate: 40, lifetime: 1.5, lifetimeRandom: 0, speedRandom: 0, spread: 0, turbulence: 0, ...over,
});

describe('particles v2', () => {
  it('leaves a pre-v2 config byte-identical: the defaults ARE the old formulas', () => {
    const cfg = base();
    const legacy = { ...cfg };
    delete (legacy as Partial<ParticleConfig>).drag;
    delete (legacy as Partial<ParticleConfig>).midAge;
    delete (legacy as Partial<ParticleConfig>).motionBlur;
    delete (legacy as Partial<ParticleConfig>).subRate;
    expect(JSON.stringify(simulateParticles(cfg, 0.9))).toBe(JSON.stringify(simulateParticles(legacy as ParticleConfig, 0.9)));
    for (const p of simulateParticles(cfg, 0.9)) {
      expect(p.vx).toBeUndefined();
      expect(p.spriteFrame).toBeUndefined();
    }
  });

  it('drag is the exact solution of v′ = a − k·v', () => {
    const k = 1.7; const ax = 30; const ay = -200; const v0x = 120; const v0y = -300;
    // Fine explicit integration as the reference.
    let x = 0; let y = 0; let vx = v0x; let vy = v0y;
    const dt = 1e-5; const T = 0.8;
    for (let t = 0; t < T - 1e-12; t += dt) {
      vx += (ax - k * vx) * dt; vy += (ay - k * vy) * dt;
      x += vx * dt; y += vy * dt;
    }
    const f = flightAt(0, 0, v0x, v0y, ax, ay, T, k);
    expect(f.x).toBeCloseTo(x, 2);
    expect(f.y).toBeCloseTo(y, 2);
    expect(f.vx).toBeCloseTo(vx, 2);
    expect(f.vy).toBeCloseTo(vy, 2);
    // k → 0 is the ballistic formula, literally.
    const b = flightAt(5, 6, v0x, v0y, ax, ay, T, 0);
    expect(b.x).toBe(5 + v0x * T + 0.5 * ax * T * T);
    expect(b.y).toBe(6 + v0y * T + 0.5 * ay * T * T);
    // And a dragged particle travels less far than a free one.
    expect(Math.hypot(f.x, f.y)).toBeLessThan(Math.hypot(b.x - 5, b.y - 6));
  });

  it('the sphere emitter fills a ball of the given diameter and hands out depth', () => {
    const cfg = base({ emitterType: 'sphere', emitterWidth: 100 });
    let maxR = 0; let anyZ = false; let sumZ = 0;
    for (let i = 0; i < 2000; i++) {
      const o = emitterOrigin(cfg, i, 1);
      const r = Math.hypot(o.x, o.y, o.z);
      expect(r).toBeLessThanOrEqual(50 + 1e-9);
      maxR = Math.max(maxR, r);
      if (Math.abs(o.z) > 1) anyZ = true;
      sumZ += o.z;
    }
    expect(maxR).toBeGreaterThan(45);
    expect(anyZ).toBe(true);
    expect(Math.abs(sumZ / 2000)).toBeLessThan(3);
    // The disc and box are untouched by the ball's extra hash salts.
    expect(emitterOrigin(base({ emitterType: 'circle', emitterWidth: 100 }), 7, 1).z).toBe(0);
  });

  it('mid-point ramps pass through the mid value at midAge and fall back to the straight lerp', () => {
    expect(rampAt(10, 2, 0.5, undefined, 0.5)).toBe(6);
    expect(rampAt(10, 2, 0.3, 20, 0.3)).toBe(20);
    expect(rampAt(10, 2, 0.15, 20, 0.3)).toBe(15);
    expect(rampAt(10, 2, 0.65, 20, 0.3)).toBeCloseTo(11, 9);
    const cfg = base({ colorStart: '#000000', colorMid: '#ffffff', colorEnd: '#000000', midAge: 0.5 });
    expect(colorRampAt(cfg, 0.5, 1)).toBe('rgba(255,255,255,1)');
    expect(colorRampAt(cfg, 0.25, 1)).toBe('rgba(128,128,128,1)');
    const flare = simulateParticles(base({ sizeStart: 4, sizeMid: 40, sizeEnd: 0, midAge: 0.2 }), 1.4);
    expect(Math.max(...flare.map((p) => p.size))).toBeGreaterThan(30);
  });

  it('continuous sub-emission: children are born on the parent path, at the sub rate, and die on time', () => {
    const cfg = base({ subEmit: 'continuous', subRate: 20, subLifetime: 0.5, subSpeed: 0, subSizeScale: 0.5, gravityY: 0, birthRate: 1, lifetime: 2, speed: 100, direction: 0 });
    const t = 1.0;
    const all = simulateParticles(cfg, t);
    const parents = all.filter((p) => (p.index ?? 0) >= 0);
    const kids = all.filter((p) => (p.index ?? 0) < 0);
    expect(parents).toHaveLength(2); // born at 0 and 1 s
    // Parent 0 has flown 1 s at 100 px/s; children in the last 0.5 s sit on x ∈ [50, 100].
    const first = kids.filter((p) => -(p.index! + 1) < 977);
    expect(first.length).toBeGreaterThanOrEqual(9);
    expect(first.length).toBeLessThanOrEqual(11);
    for (const c of first) {
      expect(c.y).toBeCloseTo(0, 6);
      expect(c.x).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(c.x).toBeLessThanOrEqual(100 + 1e-6);
      expect(c.age01).toBeLessThan(1);
    }
    // Deterministic: the same instant twice is the same list.
    expect(JSON.stringify(simulateParticles(cfg, t))).toBe(JSON.stringify(all));
  });

  it('velocity streaks carry the closed-form velocity, only when both the amount and a shutter are set', () => {
    const still = simulateParticles(base({ motionBlur: 1 }), 0.5);
    expect(still.every((p) => p.vx === undefined)).toBe(true);
    const cfg = base({ motionBlur: 1, shutterSec: 1 / 60, gravityY: 0, speed: 300, direction: 0 });
    const moving = simulateParticles(cfg, 0.5);
    expect(moving.length).toBeGreaterThan(0);
    for (const p of moving) {
      expect(p.vx).toBeCloseTo(300, 6);
      expect(p.vy).toBeCloseTo(0, 6);
    }
    const sprites = particleSprites(cfg, 0.5, 400, 400);
    for (const s of sprites) expect(s.sx).toBeCloseTo(300 / 60 / 2, 6);
  });

  it('sprite particles index their sheet by age or by a fixed rate', () => {
    const byAge = simulateParticles(base({ shape: 'sprite', spriteFrames: 4, spriteFps: 0, birthRate: 1, lifetime: 1 }), 0.9);
    expect(byAge[0]!.spriteFrame).toBe(3);
    const byRate = simulateParticles(base({ shape: 'sprite', spriteFrames: 4, spriteFps: 10, birthRate: 1, lifetime: 1 }), 0.55);
    expect(byRate[0]!.spriteFrame).toBe(5 % 4);
    expect(simulateParticles(base({ shape: 'circle' }), 0.5)[0]!.spriteFrame).toBeUndefined();
  });
});
