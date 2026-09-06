/**
 * Bend pins — a pin whose POSITION is derived from the pins around it, and
 * whose rotation and scale act on the deformation those pins already produced.
 *
 * ## Why this is not a second advanced pin
 *
 * An advanced pin owns a point. You place it, drag it, keyframe it, and its
 * rotation turns the mesh about the place YOU put it, in the rest frame.
 *
 * A bend pin owns no point. Its centre is wherever the advanced pins carry that
 * spot, and its rotation turns the mesh about THAT — after they have moved it.
 * Rotate a bend pin on a tail whose base pin is swinging and the tail curls
 * about a centre that is itself travelling; rotate an advanced pin in the same
 * place and it turns about a fixed spot and drags the swing out of shape. That
 * difference is the entire feature. Breathing chests, wagging tails and every
 * other bit of secondary motion are "add a turn on top of the motion already
 * there", which is not expressible with a pin that owns its own centre.
 *
 * ## The solve, in two passes
 *
 * 1. **Drivers only.** Solve the mesh with the advanced pins alone, through the
 *    ordinary `deform` path (LBS or ARAP, unchanged). The bend pins' weight
 *    columns are removed and the remaining columns re-normalised — a bend pin
 *    must not eat influence in a solve it is not a constraint in, or merely
 *    ADDING one would slacken the deformation around it.
 *
 * 2. **Bends applied on top.** Each bend pin reads its derived centre out of
 *    that result, then rotates/scales the neighbourhood about it, blended by
 *    its own weight column. Bends compose in list order, each reading its centre
 *    from the result of the ones before it.
 *
 * ## What the identity case does, and what it does NOT
 *
 * A bend pin at rotation 0, scale 1 adds no motion of its own: pass 2 skips it
 * before allocating, and returns the driver array itself.
 *
 * It is NOT byte-identical to the same rig with the pin deleted, and no amount
 * of care here could make it so. Every pin's anchor vertex is a Dirichlet
 * boundary in `finishRestMesh`'s harmonic solve — each pin's column is forced to
 * 0 at every OTHER pin's anchor — so adding a pin of any kind changes the weight
 * field of the ones already there. That is a property of the meshing, upstream
 * of anything a solver does.
 *
 * What the re-normalisation buys is the failure one step down from that. At a
 * bend pin's own anchor the drivers' raw columns are both exactly 0, so a
 * driver-only solve over the raw columns displaces that vertex by zero — an idle
 * bend pin would act as a STARCH pin, nailing the mesh down in the one place the
 * user placed a control meant to follow it. Re-normalising sends the vertex down
 * the equal-share branch and it travels with the drivers, which is the whole
 * contract of the pin. `bendPins.test.ts` derives that displacement on paper and
 * asserts the un-renormalised version really would have pinned it.
 *
 * ## Divergence from After Effects, stated
 *
 * AE's bend pin also has an inherited-rotation readout. In 2D that term is not
 * needed to place the rotation correctly: rotations commute, so turning the
 * already-deformed geometry by θ about the derived centre gives the same result
 * whatever the surrounding pins rotated it by first. Carrying an inherited angle
 * would change the number shown in the inspector, not the pixels. It is left out
 * rather than computed and discarded.
 */

import {
  deformLbs,
  clampPinRotations,
  normalizeWeightColumns,
  type DeformPin,
  type DeformedMesh,
} from './puppet';
import { deformArap, deformArapWithHandles, resolvePinnedVertices } from './arap';

const DEG_TO_RAD = Math.PI / 180;

/**
 * Harmonic weight at or above which a vertex belongs to a bend pin's rigid
 * CORE — the part of the artwork this pin governs almost outright. Everything
 * between the core and the drivers is left to ARAP, which is what makes the
 * bend smooth.
 *
 * Measured on the 1080px reproduction character, one 60° shoulder bend
 * (edge-length energy; lower = more rigid, flips = shattered triangles):
 *   weight-blended rotation (old)       40705   0 flips
 *   core at 0.5 (the pin's Voronoi cell) 9841   0 flips — but 2 flips on a
 *                                               thin 12px arm, where the cell
 *                                               reaches the wrist and leaves
 *                                               one triangle row to fold 60°
 *   core at 0.8                          1271   0 flips, both characters
 * A tighter core hands ARAP a wider transition band, and rigidity is exactly
 * what ARAP is good at spreading. 0.5 was the intuitive choice; 0.8 is the
 * measured one.
 */
const BEND_REGION_WEIGHT = 0.8;

/** A rig's pins split by kind. `null` when there is nothing to derive. */
export interface BendSplit {
  drivers: DeformPin[];
  bends: DeformPin[];
}

/**
 * Split pins into the ones that own a position and the ones that derive it.
 *
 * Returns `null` for "there is no bend work to do", which covers two cases that
 * must both fall through to the ordinary solve:
 *   • no bend pins at all — the overwhelmingly common path, left untouched;
 *   • bend pins but NO drivers — there is nothing to derive a position from, so
 *     they are solved as ordinary pins at their rest anchors rather than
 *     silently vanishing. A rig of nothing but bend pins is a user error, and
 *     behaving like the old build is the least surprising thing to do with it.
 */
export function splitBendPins(pins: readonly DeformPin[]): BendSplit | null {
  let hasBend = false;
  for (const p of pins) {
    if (p.kind === 'bend') { hasBend = true; break; }
  }
  if (!hasBend) return null;
  const drivers: DeformPin[] = [];
  const bends: DeformPin[] = [];
  for (const p of pins) {
    if (p.kind === 'bend') bends.push(p);
    else drivers.push(p);
  }
  if (drivers.length === 0) return null;
  return { drivers, bends };
}

/**
 * Rest-mesh view with the bend pins' weight columns dropped and the drivers'
 * columns re-normalised to a partition of unity.
 *
 * A NEW object rather than a mutation: `restMesh` is shared and cached across
 * frames and layers, and ARAP keys its topology/factorisation cache on the mesh
 * object's identity. Mutating the shared one would corrupt every other reader;
 * minting a fresh one each frame would make ARAP re-factorise every frame. So
 * the derived view is itself cached, keyed by the mesh identity and the bend
 * set, and `vertices` / `triangles` / positions are shared by reference (the
 * solve never writes to them).
 */
const driverMeshCache = new WeakMap<DeformedMesh, Map<string, DeformedMesh>>();

export function driverRestMesh(restMesh: DeformedMesh, bends: readonly DeformPin[]): DeformedMesh {
  const key = bends.map((b) => b.id).sort().join('|');
  let perMesh = driverMeshCache.get(restMesh);
  if (!perMesh) {
    perMesh = new Map();
    driverMeshCache.set(restMesh, perMesh);
  }
  const hit = perMesh.get(key);
  if (hit) return hit;

  const bendIds = new Set(bends.map((b) => b.id));
  const weights: Record<string, Float32Array> = {};
  const driverIds: string[] = [];
  for (const id of Object.keys(restMesh.weights)) {
    if (bendIds.has(id)) continue;
    // Copied, not aliased — normalizeWeightColumns writes in place, and the
    // source columns belong to the shared rest mesh.
    weights[id] = Float32Array.from(restMesh.weights[id]!);
    driverIds.push(id);
  }
  const numVertices = restMesh.vertices.length / 4;
  // Equal-share fallback ONLY where some pin (bend included) held influence
  // before the bend columns were dropped — i.e. the bend anchors' Dirichlet
  // zeros. A vertex no pin could ever reach (a disconnected alpha island)
  // keeps zero weight and stays at rest, same as the base mesh.
  const hadInfluence = new Uint8Array(numVertices);
  for (const id of Object.keys(restMesh.weights)) {
    const col = restMesh.weights[id]!;
    for (let i = 0; i < numVertices; i++) {
      if ((col[i] ?? 0) > 0) hadInfluence[i] = 1;
    }
  }
  normalizeWeightColumns(weights, driverIds, numVertices, hadInfluence);

  const view: DeformedMesh = {
    vertices: restMesh.vertices,
    triangles: restMesh.triangles,
    pinRestPositions: restMesh.pinRestPositions,
    pinVertexIndices: restMesh.pinVertexIndices,
    weights,
    // Same geometry, only the weight columns are re-normalised — so it is the
    // same LAYOUT, and anything reading that off the view (the overlay's
    // lattice) must not see it reset to the 'grid' default.
    layout: restMesh.layout,
  };
  perMesh.set(key, view);
  return view;
}

/**
 * Apply the bend pins to an already-solved vertex array.
 *
 * `base` is not mutated. Each bend pin reads its derived centre from the array
 * as it stands when its turn comes — so two bend pins on the same limb compose
 * the way stacked rotations should, rather than both turning about the driver
 * result and fighting.
 *
 * `stiffness` keeps the meaning it has everywhere else: it sharpens the pin's
 * own falloff by exponentiating its weight column. It cannot sharpen the driver
 * blend, because a bend pin takes no part in that solve.
 */
export function applyBendPins(
  base: Float32Array,
  bends: readonly DeformPin[],
  restMesh: DeformedMesh,
  maxRotationDeg?: number,
): Float32Array {
  const clamped = clampPinRotations(bends as DeformPin[], maxRotationDeg);
  let out: Float32Array | null = null;
  const numVertices = restMesh.vertices.length / 4;

  for (const pin of clamped) {
    const rotDeg = pin.rotation ?? 0;
    const scale = pin.scale ?? 1;
    // Identity: contributes nothing, and is skipped BEFORE `out` is allocated so
    // a rig whose bend pins are all at rest returns the driver array untouched.
    if (rotDeg === 0 && scale === 1) continue;
    const col = restMesh.weights[pin.id];
    const k = restMesh.pinVertexIndices[pin.id];
    if (!col || k === undefined) continue;

    if (!out) out = Float32Array.from(base);
    const cx = out[k * 4 + 0]!;
    const cy = out[k * 4 + 1]!;
    const rad = rotDeg * DEG_TO_RAD;
    const cos = Math.cos(rad) * scale;
    const sin = Math.sin(rad) * scale;
    const stiffExp = 1 + Math.max(0, pin.stiffness ?? 0);

    for (let i = 0; i < numVertices; i++) {
      let w = col[i] ?? 0;
      if (w <= 0) continue;
      if (stiffExp !== 1) w = Math.pow(w, stiffExp);
      const vx = out[i * 4 + 0]!;
      const vy = out[i * 4 + 1]!;
      const relX = vx - cx;
      const relY = vy - cy;
      const tx = cos * relX - sin * relY + cx;
      const ty = sin * relX + cos * relY + cy;
      out[i * 4 + 0] = vx + w * (tx - vx);
      out[i * 4 + 1] = vy + w * (ty - vy);
    }
  }

  return out ?? base;
}

/**
 * Apply the bend pins on top of the driver solve THROUGH ARAP — the path the
 * default solver takes.
 *
 * ## Why not the blend above
 *
 * `applyBendPins` moves every vertex by `w · (R(v − c) + c − v)`: a linear
 * blend of the rotation by the pin's harmonic weight. Harmonic weights fall off
 * across the WHOLE mesh, so a 60° bend at a shoulder turns the hand by 60°, the
 * elbow by ~40°, the chest by ~20° and the hip by ~5° — each about the same
 * centre. Nothing stays rigid; every triangle between two vertices of different
 * weight shears, and the character reads as smeared or torn (measured on the
 * reproduction PNG: edge-length energy 40705 for one 60° bend, against 4568 for
 * a 90° advanced-pin rotation solved by ARAP).
 *
 * After Effects' bend pin turns the REGION it governs rigidly and lets the mesh
 * solver absorb the transition. That is what this does: the vertices where the
 * pin's weight dominates (`BEND_REGION_WEIGHT`) are hard-constrained to their
 * rigidly rotated / scaled positions about the derived centre, the drivers keep
 * their own handles, and ARAP solves everything in between as-rigidly-as-
 * possible. The elbow bends; the chest does not shear.
 *
 * Everything that defines a bend pin is preserved: the centre is still the
 * driver-pass position of the pin's own vertex (it is in the rigid set, so it
 * lands there exactly); identity still returns the driver array itself; bends
 * still compose in list order, each reading its centre from the result of the
 * ones before; `maxRotationDeg` still clamps them like every other pin. The
 * blend result is used as the WARM START, so a case ARAP declines (fewer than
 * two handles) degrades to exactly the old behaviour.
 *
 * `restMesh` supplies the bend columns and anchors; `driverMesh` (the view with
 * the bend columns dropped) is what the driver pass solved on, so its topology
 * and factor caches are the ones reused here.
 */
export function applyBendPinsArap(
  base: Float32Array,
  drivers: readonly DeformPin[],
  bends: readonly DeformPin[],
  restMesh: DeformedMesh,
  driverMesh: DeformedMesh,
  maxRotationDeg?: number,
): Float32Array {
  const clamped = clampPinRotations(bends as DeformPin[], maxRotationDeg);
  const numVertices = restMesh.vertices.length / 4;
  let out = base;

  for (const pin of clamped) {
    const rotDeg = pin.rotation ?? 0;
    const scale = pin.scale ?? 1;
    if (rotDeg === 0 && scale === 1) continue;
    const col = restMesh.weights[pin.id];
    const k = restMesh.pinVertexIndices[pin.id];
    if (!col || k === undefined) continue;

    // Derived centre: where the solve so far put this pin's own vertex.
    const cx = out[k * 4 + 0]!;
    const cy = out[k * 4 + 1]!;
    const rad = rotDeg * DEG_TO_RAD;
    const cos = Math.cos(rad) * scale;
    const sin = Math.sin(rad) * scale;

    // Drivers keep their handles; the bend's region joins them, rigidly moved.
    const handles = resolvePinnedVertices(drivers as DeformPin[], driverMesh, numVertices);
    const added: number[] = [];
    for (let i = 0; i < numVertices; i++) {
      if (handles.pinnedFlag[i]) continue;
      if (i !== k && (col[i] ?? 0) < BEND_REGION_WEIGHT) continue;
      const relX = out[i * 4 + 0]! - cx;
      const relY = out[i * 4 + 1]! - cy;
      handles.pinnedFlag[i] = 1;
      handles.targetX[i] = cos * relX - sin * relY + cx;
      handles.targetY[i] = sin * relX + cos * relY + cy;
      handles.cos[i] = cos;
      handles.sin[i] = sin;
      added.push(i);
    }
    if (added.length === 0) continue;
    handles.distinct += added.length;
    // Stable factor-cache key: the driver set plus the (sorted) region.
    handles.key = `${handles.key}|b:${added.join(',')}`;

    // The blend is a good initial guess (and the exact fallback).
    const warm = applyBendPins(out, [pin], restMesh, maxRotationDeg);
    out = deformArapWithHandles(drivers as DeformPin[], driverMesh, handles, warm, maxRotationDeg);
  }

  return out;
}

/**
 * The ordinary solve, with no bend-pin knowledge — the body `deform` had before
 * bend pins existed. Kept as its own function so the bend path can call it for
 * the driver pass without recursing.
 */
export function solveDeform(
  pins: DeformPin[],
  restMesh: DeformedMesh,
  solver: 'lbs' | 'arap',
  maxRotationDeg?: number,
): Float32Array {
  const clamped = clampPinRotations(pins, maxRotationDeg);
  const lbs = deformLbs(clamped, restMesh);
  if (solver === 'lbs') return lbs;
  return deformArap(clamped, restMesh, lbs, maxRotationDeg);
}
