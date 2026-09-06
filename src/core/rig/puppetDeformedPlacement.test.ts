/**
 * Two ways a puppet rig used to "crash" a PNG character, and the properties
 * that now hold instead.
 *
 * 1. A pin added onto an already-DEFORMED character. The click lands on the
 *    artwork as drawn, but a pin's anchor is a rest-space point. Storing the
 *    click as the anchor bound the new pin to whichever rest vertex lay under
 *    a deformed-space coordinate, and the mesh snapped toward it the instant the
 *    pin landed. `restPointFromDeformed` inverts the deformation first.
 *
 * 2. A BEND pin under ARAP. The rotation used to be a linear blend of the
 *    pin's harmonic weight column over the whole mesh, so nothing stayed rigid
 *    and every triangle between two vertices of different weight sheared. The
 *    region the pin governs is now turned rigidly and ARAP solves the transition.
 */

import {
  buildRestMesh,
  coverageMaskFromImageData,
  deform,
  restPointFromDeformed,
  type DeformPin,
  type DeformedMesh,
  type PuppetRig,
} from './puppet';
import { applyBendPins, driverRestMesh } from './bendPins';

const W = 200;
const H = 200;

/** Torso blob plus a thin arm — the same reproduction character the tear test uses. */
function characterAlpha(x: number, y: number): number {
  if (x >= 60 && x < 140 && y >= 40 && y < 170) return 255;
  if (x >= 140 && x < 190 && y >= 70 && y < 82) return 255;
  return 0;
}
const mask = (() => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[(y * W + x) * 4 + 3] = characterAlpha(x, y);
  return coverageMaskFromImageData({ data, width: W, height: H }, { maxSamples: 64, alphaThreshold: 12 });
})();

const BODY = { id: 'body', x: 0, y: 20 };
const HAND = { id: 'hand', x: 82, y: -24 };
const SHOULDER = { id: 'sh', x: 45, y: -24 };

function rig(pins: PuppetRig['pins'], solver: 'arap' | 'lbs' = 'arap'): PuppetRig {
  return { pins, meshDensity: 22, meshExpansion: 0, meshMode: 'silhouette', solver };
}
const pos = (p: { id: string; x: number; y: number }, dx = 0, dy = 0): DeformPin => ({
  id: p.id, x: p.x + dx, y: p.y + dy, kind: 'position',
});

function edgeEnergy(mesh: DeformedMesh, out: Float32Array): number {
  let e = 0;
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const a = mesh.triangles[t]!, b = mesh.triangles[t + 1]!, c = mesh.triangles[t + 2]!;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const rl = Math.hypot(mesh.vertices[p * 4]! - mesh.vertices[q * 4]!, mesh.vertices[p * 4 + 1]! - mesh.vertices[q * 4 + 1]!);
      const dl = Math.hypot(out[p * 4]! - out[q * 4]!, out[p * 4 + 1]! - out[q * 4 + 1]!);
      e += (dl - rl) * (dl - rl);
    }
  }
  return e;
}

function flipped(mesh: DeformedMesh, out: Float32Array): number {
  const area = (v: Float32Array, a: number, b: number, c: number) =>
    (v[b * 4]! - v[a * 4]!) * (v[c * 4 + 1]! - v[a * 4 + 1]!) - (v[c * 4]! - v[a * 4]!) * (v[b * 4 + 1]! - v[a * 4 + 1]!);
  let n = 0;
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const a = mesh.triangles[t]!, b = mesh.triangles[t + 1]!, c = mesh.triangles[t + 2]!;
    const r = area(mesh.vertices, a, b, c);
    if (Math.abs(r) > 1e-6 && Math.sign(r) !== Math.sign(area(out, a, b, c))) n++;
  }
  return n;
}

describe('restPointFromDeformed — placing a pin on a deformed character', () => {
  const r = rig([
    { id: BODY.id, name: 'b', x: BODY.x, y: BODY.y, kind: 'position' },
    { id: HAND.id, name: 'h', x: HAND.x, y: HAND.y, kind: 'position' },
  ]);
  const mesh = buildRestMesh(W, H, 0, r, undefined, mask);
  const live = [pos(BODY), pos(HAND, -40, 70)]; // hand dragged well down and in
  const deformed = deform(live, mesh, 'arap');

  it('is the identity while nothing has moved', () => {
    const p = { x: 60, y: -24 };
    const back = restPointFromDeformed(p, mesh, mesh.vertices)!;
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it('the drag genuinely moved the arm where the click will land (the bug had teeth)', () => {
    // Forward-map a mid-arm rest point and check it is nowhere near itself.
    const rest = { x: 62, y: -24 };
    const fwd = forward(rest, mesh, deformed);
    expect(Math.hypot(fwd.x - rest.x, fwd.y - rest.y)).toBeGreaterThan(8);
  });

  it('inverts the deformation: forward(inverse(click)) is the click', () => {
    // Click somewhere on the deformed forearm.
    const restProbe = { x: 62, y: -24 };
    const click = forward(restProbe, mesh, deformed);
    const anchor = restPointFromDeformed(click, mesh, deformed)!;
    expect(anchor).not.toBeNull();
    expect(Math.hypot(anchor.x - restProbe.x, anchor.y - restProbe.y)).toBeLessThan(1e-3);
    const round = forward(anchor, mesh, deformed);
    expect(Math.hypot(round.x - click.x, round.y - click.y)).toBeLessThan(1e-3);
  });

  it('returns null off the mesh, so the caller keeps the raw click', () => {
    expect(restPointFromDeformed({ x: -95, y: -95 }, mesh, deformed)).toBeNull();
  });

  it('a pin anchored at the inverse and keyframed at the click leaves the picture unchanged', () => {
    // The whole point: adding the pin must not move anything at the moment it
    // lands. Anchor = inverse of the click; live position = the click.
    const click = forward({ x: 62, y: -24 }, mesh, deformed);
    const anchor = restPointFromDeformed(click, mesh, deformed)!;
    const r3 = rig([
      ...r.pins,
      { id: 'new', name: 'n', x: anchor.x, y: anchor.y, kind: 'position' },
    ]);
    const mesh3 = buildRestMesh(W, H, 0, r3, undefined, mask);
    const with3 = deform([...live, { id: 'new', x: click.x, y: click.y, kind: 'position' }], mesh3, 'arap');
    // Same vertex set (the outline mesh does not depend on pins), so compare
    // per vertex: the added, correctly placed pin barely moves the solve.
    expect(mesh3.vertices.length).toBe(mesh.vertices.length);
    let worst = 0;
    for (let i = 0; i < with3.length; i += 4) {
      worst = Math.max(worst, Math.hypot(with3[i]! - deformed[i]!, with3[i + 1]! - deformed[i + 1]!));
    }
    // (Adding any pin re-solves the harmonic weights, so a small settle is
    // expected; the failure being guarded against is a jump of tens of px.)
    expect(worst).toBeLessThan(6);
    // And the clicked point itself is still under the click.
    const under = forward(anchor, mesh3, with3);
    expect(Math.hypot(under.x - click.x, under.y - click.y)).toBeLessThan(1.5);

    // Versus the old behaviour: anchor = the raw click. The pin then binds the
    // rest vertex nearest a DEFORMED-space coordinate — here a torso vertex tens
    // of px from the forearm the user clicked — so dragging it later moves the
    // wrong body part. The correctly placed pin binds within a mesh step of it.
    const rBad = rig([...r.pins, { id: 'new', name: 'n', x: click.x, y: click.y, kind: 'position' }]);
    const meshBad = buildRestMesh(W, H, 0, rBad, undefined, mask);
    const boundAt = (m: DeformedMesh) => {
      const k = m.pinVertexIndices.new!;
      return { x: m.vertices[k * 4]!, y: m.vertices[k * 4 + 1]! };
    };
    const good = boundAt(mesh3);
    const wrong = boundAt(meshBad);
    expect(Math.hypot(good.x - anchor.x, good.y - anchor.y)).toBeLessThan(12);
    expect(Math.hypot(wrong.x - anchor.x, wrong.y - anchor.y)).toBeGreaterThan(30);
  });
});

/** Forward-map a rest point through the deformation (barycentric, first containing triangle). */
function forward(p: { x: number; y: number }, mesh: DeformedMesh, deformed: Float32Array): { x: number; y: number } {
  const inv = restPointFromDeformed(p, { ...mesh, vertices: mesh.vertices }, mesh.vertices);
  expect(inv).not.toBeNull();
  // Locate the rest triangle containing p, then interpolate the deformed corners.
  const tris = mesh.triangles;
  const v = mesh.vertices;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]!, b = tris[t + 1]!, c = tris[t + 2]!;
    const ax = v[a * 4]!, ay = v[a * 4 + 1]!, bx = v[b * 4]!, by = v[b * 4 + 1]!, cx = v[c * 4]!, cy = v[c * 4 + 1]!;
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((bx - p.x) * (cy - p.y) - (cx - p.x) * (by - p.y)) / det;
    const w2 = ((cx - p.x) * (ay - p.y) - (ax - p.x) * (cy - p.y)) / det;
    const w3 = 1 - u - w2;
    if (u < -1e-4 || w2 < -1e-4 || w3 < -1e-4) continue;
    return {
      x: u * deformed[a * 4]! + w2 * deformed[b * 4]! + w3 * deformed[c * 4]!,
      y: u * deformed[a * 4 + 1]! + w2 * deformed[b * 4 + 1]! + w3 * deformed[c * 4 + 1]!,
    };
  }
  throw new Error('probe not on mesh');
}

describe('bend pins under ARAP turn a region rigidly', () => {
  const pins: PuppetRig['pins'] = [
    { id: BODY.id, name: 'b', x: BODY.x, y: BODY.y, kind: 'position' },
    { id: HAND.id, name: 'h', x: HAND.x, y: HAND.y, kind: 'position' },
    { id: SHOULDER.id, name: 's', x: SHOULDER.x, y: SHOULDER.y, kind: 'bend' },
  ];
  const mesh = buildRestMesh(W, H, 0, rig(pins), undefined, mask);
  const live = (rotation: number): DeformPin[] => [
    pos(BODY), pos(HAND), { id: SHOULDER.id, x: SHOULDER.x, y: SHOULDER.y, kind: 'bend', rotation },
  ];

  it('identity still returns the driver array itself', () => {
    const drivers = deform([pos(BODY), pos(HAND)], driverRestMesh(mesh, [live(0)[2]!]), 'arap');
    const idle = deform(live(0), mesh, 'arap');
    expect(Array.from(idle)).toEqual(Array.from(drivers));
  });

  it("the pin's own vertex is the centre — it does not move when the pin rotates", () => {
    const k = mesh.pinVertexIndices[SHOULDER.id]!;
    const idle = deform(live(0), mesh, 'arap');
    const bent = deform(live(50), mesh, 'arap');
    expect(bent[k * 4]).toBeCloseTo(idle[k * 4]!, 4);
    expect(bent[k * 4 + 1]).toBeCloseTo(idle[k * 4 + 1]!, 4);
  });

  it('turns the same way an advanced pin does', () => {
    const k = mesh.pinVertexIndices[SHOULDER.id]!;
    const bent = deform(live(90), mesh, 'arap');
    const cx = bent[k * 4]!, cy = bent[k * 4 + 1]!;
    // A vertex with strong bend weight lying to the RIGHT of the centre at rest.
    let probe = -1;
    for (let i = 0; i < mesh.vertices.length / 4; i++) {
      const dx = mesh.vertices[i * 4]! - mesh.vertices[k * 4]!;
      const dy = mesh.vertices[i * 4 + 1]! - mesh.vertices[k * 4 + 1]!;
      if (dx > 6 && Math.abs(dy) < 4 && (mesh.weights[SHOULDER.id]![i] ?? 0) > 0.6) { probe = i; break; }
    }
    expect(probe).toBeGreaterThanOrEqual(0);
    // +90° carries (+x, 0) toward (0, +y).
    expect(bent[probe * 4]! - cx).toBeLessThan(mesh.vertices[probe * 4]! - mesh.vertices[k * 4]!);
    expect(bent[probe * 4 + 1]! - cy).toBeGreaterThan(2);
  });

  it('is far more rigid than the weight-blended rotation, with no flipped triangles', () => {
    const drivers = deform([pos(BODY), pos(HAND)], driverRestMesh(mesh, [live(0)[2]!]), 'arap');
    const blended = applyBendPins(drivers, [live(60)[2]!], mesh);
    const arap = deform(live(60), mesh, 'arap');
    expect(flipped(mesh, arap)).toBe(0);
    // The blend shears the whole mesh; ARAP keeps the region rigid and bends
    // only the transition. Measured: ~40700 vs ~9800 on the 1080px character.
    expect(edgeEnergy(mesh, arap)).toBeLessThan(edgeEnergy(mesh, blended) * 0.5);
  });

  it('the LBS solver keeps the blended rotation (all LBS can express)', () => {
    const drivers = deform([pos(BODY), pos(HAND)], driverRestMesh(mesh, [live(0)[2]!]), 'lbs');
    const blended = applyBendPins(drivers, [live(60)[2]!], mesh);
    expect(Array.from(deform(live(60), mesh, 'lbs'))).toEqual(Array.from(blended));
  });

  it('is deterministic', () => {
    const a = deform(live(33), mesh, 'arap');
    const b = deform(live(33), mesh, 'arap');
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
