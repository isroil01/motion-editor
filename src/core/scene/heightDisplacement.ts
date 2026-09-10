/**
 * Height displacement for 3D materials (AE 26.2's "displacement for 3D
 * materials"; plan B1).
 *
 * A HEIGHT FIELD — the luma of an image asset, sampled bilinearly at each
 * vertex's uv — pushes every vertex of a mesh along its normal by
 * `(h − 0.5) · amount` px, so 50 % grey is the undisplaced surface, white
 * rises and black sinks. Optional midpoint subdivision first (each triangle
 * → 4, `n` times) gives a flat cap or a coarse primitive the vertices a
 * relief needs; normals are then recomputed from the displaced faces so the
 * lighting follows the bumps, which is what makes a relief read as relief.
 *
 * All of it runs on the CPU at snapshot time over the interleaved mesh the
 * renderer already takes (x y z nx ny nz u v), the same seam skinning and
 * morphs use — so every mesh carrier (extrusions, parametric primitives,
 * imported models) displaces through one function and no shader changes.
 * Triangle ORDER is preserved through subdivision (each source triangle
 * becomes 4ⁿ consecutive ones), so a carrier's material ranges remap by a
 * plain multiply.
 *
 * The field decodes asynchronously (the same decode-and-cache seam as
 * `imageAlphaCoverage`): the first request starts it and the frame renders
 * undisplaced; when it lands an AnimationChanged nudge re-renders. Tests and
 * the golden prime the cache with a procedural field instead.
 */

import { getEventBus } from '@core/events/EventBus';

export interface HeightField {
  width: number;
  height: number;
  /** Row-major luma 0..1, `width × height`. */
  data: Float32Array;
}

/** Decode resolution cap per side — a height map needs no more at mesh densities. */
const FIELD_SAMPLES = 256;
/** Interleaved vertex stride: x y z nx ny nz u v. */
export const MESH_STRIDE = 8;
/** Subdivision cap: 4³ = 64× the triangles is already a lot of mesh. */
export const MAX_DISPLACEMENT_SUBDIVISIONS = 3;

const cache = new Map<string, HeightField>();
const inFlight = new Set<string>();
const failed = new Set<string>();

/** The field for `key` (asset id or source), or undefined while it decodes. */
export function getHeightField(key: string, src: string | undefined): HeightField | undefined {
  const cached = cache.get(key);
  if (cached) return cached;
  if (!src || failed.has(key) || inFlight.has(key)) return undefined;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return undefined;
  inFlight.add(key);
  void decode(key, src);
  return undefined;
}

/** Test/golden seam: install a field without a decode. */
export function primeHeightField(key: string, field: HeightField): void {
  cache.set(key, field);
}

export function clearHeightFieldCache(): void {
  cache.clear();
  inFlight.clear();
  failed.clear();
}

async function decode(key: string, src: string): Promise<void> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('height map decode failed'));
      el.src = src;
    });
    const w = Math.max(1, Math.min(FIELD_SAMPLES, img.naturalWidth || img.width || 1));
    const h = Math.max(1, Math.min(FIELD_SAMPLES, img.naturalHeight || img.height || 1));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) { failed.add(key); return; }
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const data = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      // Rec.709 luma of the straight bytes; transparent pixels read as flat.
      const a = px[i * 4 + 3]! / 255;
      data[i] = ((0.2126 * px[i * 4]! + 0.7152 * px[i * 4 + 1]! + 0.0722 * px[i * 4 + 2]!) / 255) * a + 0.5 * (1 - a);
    }
    cache.set(key, { width: w, height: h, data });
    try {
      getEventBus().emit('AnimationChanged', { nodeId: '__height_field__' });
    } catch {
      /* no bus (tests) — the next render picks the field up */
    }
  } catch {
    failed.add(key);
  } finally {
    inFlight.delete(key);
  }
}

/** Bilinear sample of the field at uv, clamped to the edge — uv = 1 is the last texel, not the seam's first. */
export function sampleHeight(f: HeightField, u: number, v: number): number {
  const fx = Math.max(0, Math.min(1, u)) * (f.width - 1);
  const fy = Math.max(0, Math.min(1, v)) * (f.height - 1);
  const x0 = Math.floor(fx); const y0 = Math.floor(fy);
  const x1 = Math.min(f.width - 1, x0 + 1); const y1 = Math.min(f.height - 1, y0 + 1);
  const tx = fx - x0; const ty = fy - y0;
  const a = f.data[y0 * f.width + x0]!; const b = f.data[y0 * f.width + x1]!;
  const c = f.data[y1 * f.width + x0]!; const d = f.data[y1 * f.width + x1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Midpoint-subdivide an interleaved triangle mesh `n` times. Shared edges
 * share their midpoint vertex (so the surface stays watertight where it was),
 * every attribute interpolates linearly, and source triangle `t` becomes
 * triangles `4t … 4t+3` — order-preserving, which is what lets a carrier's
 * ranges remap by ×4.
 */
export function subdivideMesh(
  vertices: Float32Array,
  indices: Uint16Array | Uint32Array,
  times: number,
): { vertices: Float32Array; indices: Uint32Array } {
  // Always a copy: displaceMesh writes into the result in place, and the
  // source is the carrier's cached mesh.
  let verts = Float32Array.from(vertices);
  let idx: Uint16Array | Uint32Array = indices;
  for (let pass = 0; pass < Math.min(MAX_DISPLACEMENT_SUBDIVISIONS, Math.max(0, Math.floor(times))); pass++) {
    const count = verts.length / MESH_STRIDE;
    const out: number[] = Array.from(verts);
    const midOf = new Map<number, number>();
    let next = count;
    const mid = (a: number, b: number): number => {
      const lo = Math.min(a, b); const hi = Math.max(a, b);
      const k = lo * 4294967296 + hi;
      const have = midOf.get(k);
      if (have !== undefined) return have;
      for (let c = 0; c < MESH_STRIDE; c++) out.push((verts[a * MESH_STRIDE + c]! + verts[b * MESH_STRIDE + c]!) * 0.5);
      midOf.set(k, next);
      return next++;
    };
    const nidx = new Uint32Array(idx.length * 4);
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t]!; const b = idx[t + 1]!; const c = idx[t + 2]!;
      const ab = mid(a, b); const bc = mid(b, c); const ca = mid(c, a);
      const o = t * 4;
      nidx[o] = a; nidx[o + 1] = ab; nidx[o + 2] = ca;
      nidx[o + 3] = ab; nidx[o + 4] = b; nidx[o + 5] = bc;
      nidx[o + 6] = ca; nidx[o + 7] = bc; nidx[o + 8] = c;
      nidx[o + 9] = ab; nidx[o + 10] = bc; nidx[o + 11] = ca;
    }
    verts = Float32Array.from(out);
    idx = nidx;
  }
  return { vertices: verts, indices: idx instanceof Uint32Array ? idx : Uint32Array.from(idx) };
}

/**
 * Vertices that share a POSITION, grouped: `groups[i]` is the group of vertex
 * `i`. A UV sphere's seam column (u = 0 beside u = 1) and its pole fans
 * (one point, one vertex per column) are separate vertices at one place; a
 * mirrored half or a bevel ring can be too. Displacement and normals must
 * treat such a group as one point, or the surface tears where it was
 * watertight: each duplicate would sample its OWN uv, move by its own amount,
 * and leave overlapping slivers that z-fight — one flickering pixel on the
 * golden was exactly a torn pole.
 *
 * Only vertices whose NORMALS also agree pool: an extrusion's rim (a cap
 * vertex over a wall vertex at one place, normals 90° apart) is a hard edge
 * and stays one — pooling it would round the lighting of every crisp rim.
 */
export function positionGroups(vertices: Float32Array): Int32Array {
  const count = vertices.length / MESH_STRIDE;
  const groups = new Int32Array(count);
  const byPos = new Map<string, number>();
  let next = 0;
  for (let i = 0; i < count; i++) {
    const o = i * MESH_STRIDE;
    const k = `${Math.round(vertices[o]! * 1e4)},${Math.round(vertices[o + 1]! * 1e4)},${Math.round(vertices[o + 2]! * 1e4)}`
      + `|${Math.round(vertices[o + 3]! * 100)},${Math.round(vertices[o + 4]! * 100)},${Math.round(vertices[o + 5]! * 100)}`;
    let g = byPos.get(k);
    if (g === undefined) { g = next++; byPos.set(k, g); }
    groups[i] = g;
  }
  return groups;
}

/**
 * Recompute smooth normals from the faces (area-weighted); an index no face
 * touches keeps its normal. Vertices sharing a position (`groups`, see
 * `positionGroups`) pool their face normals so a seam or pole shades as the
 * one point it is.
 */
export function recomputeNormals(vertices: Float32Array, indices: Uint16Array | Uint32Array, groups?: Int32Array): void {
  const count = vertices.length / MESH_STRIDE;
  const gid = groups ?? positionGroups(vertices);
  const acc = new Float32Array(count * 3);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t]! * MESH_STRIDE; const b = indices[t + 1]! * MESH_STRIDE; const c = indices[t + 2]! * MESH_STRIDE;
    const abx = vertices[b]! - vertices[a]!; const aby = vertices[b + 1]! - vertices[a + 1]!; const abz = vertices[b + 2]! - vertices[a + 2]!;
    const acx = vertices[c]! - vertices[a]!; const acy = vertices[c + 1]! - vertices[a + 1]!; const acz = vertices[c + 2]! - vertices[a + 2]!;
    const nx = aby * acz - abz * acy; const ny = abz * acx - abx * acz; const nz = abx * acy - aby * acx;
    for (const i of [gid[indices[t]!]!, gid[indices[t + 1]!]!, gid[indices[t + 2]!]!]) {
      acc[i * 3] = acc[i * 3]! + nx; acc[i * 3 + 1] = acc[i * 3 + 1]! + ny; acc[i * 3 + 2] = acc[i * 3 + 2]! + nz;
    }
  }
  for (let i = 0; i < count; i++) {
    const g = gid[i]!;
    const x = acc[g * 3]!; const y = acc[g * 3 + 1]!; const z = acc[g * 3 + 2]!;
    const len = Math.hypot(x, y, z);
    if (len <= 1e-12) continue;
    const o = i * MESH_STRIDE + 3;
    // Keep the winding's sense: flip if the recomputed normal opposes the authored one.
    const dot = x * vertices[o]! + y * vertices[o + 1]! + z * vertices[o + 2]!;
    const s = (dot < 0 ? -1 : 1) / len;
    vertices[o] = x * s; vertices[o + 1] = y * s; vertices[o + 2] = z * s;
  }
}

/**
 * The displaced mesh: subdivide, push along normals by `(h − 0.5) · amountPx`,
 * recompute normals. Pure — same inputs, same output — and untouched when the
 * amount is zero (the caller should not even ask then).
 */
export function displaceMesh(
  vertices: Float32Array,
  indices: Uint16Array | Uint32Array,
  field: HeightField,
  amountPx: number,
  subdivisions: number,
): { vertices: Float32Array; indices: Uint32Array; triangleScale: number } {
  const subs = Math.min(MAX_DISPLACEMENT_SUBDIVISIONS, Math.max(0, Math.floor(subdivisions)));
  const sub = subdivideMesh(vertices, indices, subs);
  const v = sub.vertices;
  const count = v.length / MESH_STRIDE;
  // One height per POSITION (the mean over the vertices sharing it), so a
  // seam column or a pole fan moves as one point and the mesh stays closed.
  const groups = positionGroups(v);
  const sum = new Float64Array(count); const n = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * MESH_STRIDE; const g = groups[i]!;
    sum[g] = sum[g]! + sampleHeight(field, v[o + 6]!, v[o + 7]!); n[g] = n[g]! + 1;
  }
  for (let i = 0; i < count; i++) {
    const o = i * MESH_STRIDE; const g = groups[i]!;
    const d = (sum[g]! / n[g]! - 0.5) * amountPx;
    v[o] = v[o]! + v[o + 3]! * d; v[o + 1] = v[o + 1]! + v[o + 4]! * d; v[o + 2] = v[o + 2]! + v[o + 5]! * d;
  }
  recomputeNormals(v, sub.indices, groups);
  return { vertices: v, indices: sub.indices, triangleScale: 4 ** subs };
}

const memo = new Map<string, ReturnType<typeof displaceMesh>>();
const MEMO_MAX = 32;

/** `displaceMesh`, memoised per (mesh key, field key, amount, subdivisions) — a scrub re-uses the last few. */
export function displacedMeshFor(
  meshKey: string,
  fieldKey: string,
  vertices: Float32Array,
  indices: Uint16Array | Uint32Array,
  field: HeightField,
  amountPx: number,
  subdivisions: number,
): { key: string; vertices: Float32Array; indices: Uint32Array; triangleScale: number } {
  const key = `${meshKey}|disp:${fieldKey}:${amountPx.toFixed(3)}:${subdivisions}`;
  let hit = memo.get(key);
  if (!hit) {
    hit = displaceMesh(vertices, indices, field, amountPx, subdivisions);
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
    memo.set(key, hit);
  }
  return { key, ...hit };
}
