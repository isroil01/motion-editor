/**
 * The IBL prefilter cache — content identity and eviction for the environment
 * specular atlas.
 *
 * WHY THIS IS A SEPARATE FILE. `environmentLight.ts` already memoised the
 * atlas; what it got wrong was the two things a cache is actually made of, and
 * both of them are about identity rather than about lighting:
 *
 *   1. THE KEY WAS A NAME, NOT A CONTENT. The old key was the sky STRING
 *      (`'asset:hdri_3|256x128x5'`). Two different pixel buffers under one
 *      asset id — a re-import, an EXR re-interpreted at a different exposure —
 *      are the same name and different content, and the loader had to paper
 *      over that by clearing the WHOLE cache every time any image landed. On a
 *      project holding N HDRIs that is N global flushes during open, so the
 *      atlas for sky 1 is built again after sky 2 decodes, again after sky 3,
 *      and so on: O(N²) prefilters for N skies (measured in
 *      `docs/VIEWPORT_WORKER_PLAN.md` §7).
 *
 *      Worse, the flush did not even fix the thing it was there for. The
 *      renderer keys its GPU texture off `EnvSpecularMap.id` — "equal ids must
 *      mean equal texels", as `environmentSpecular.test.ts` puts it — and the
 *      rebuilt atlas carried the SAME id, so a re-imported HDRI rebuilt on the
 *      CPU and kept the stale texture on the GPU.
 *
 *      Keying on content fixes both at once: new pixels are a new key, so they
 *      are a new id and a new upload, and nothing else in the cache is touched.
 *
 *   2. EVICTION WAS A FLUSH. At the bound the old code called `.clear()`, so
 *      one sky over the limit threw away seven good atlases. LRU throws away
 *      the one that has gone longest unused, which is the whole point of a
 *      bound.
 *
 * The hash is FNV-1a over the pixel buffer's 32-bit words, the same scheme
 * `rendering/contentHash.ts` uses for layers and for the same reason: a
 * word-granular structural hash rather than stringify-then-hash. It runs ONCE
 * per decoded image (in `setEnvironmentAssetPixels`), never on the per-frame
 * path — hashing 98 304 floats on every lookup would cost more than the cache
 * saves.
 */

import type { EnvPixels } from './environmentLight';

/**
 * Bump when the ATLAS's pixel semantics change (the encode, the level
 * roughness ladder, the blur kernel) so an atlas built by an older scheme can
 * never be served to newer code — or, worse, uploaded under an id the renderer
 * already believes it holds. Folded into every key.
 */
export const ENV_ATLAS_CACHE_VERSION = 1;

/**
 * FNV-1a over a Float32Array's raw words.
 *
 * Reading the buffer through a `Uint32Array` view rather than looping the
 * floats is what keeps this cheap: one `imul` per 4 bytes, no float→bits
 * conversion per element. NaN payload bits and −0 hash as themselves, which is
 * correct here — two buffers that differ only in the sign of a zero really do
 * encode to the same atlas, and the cost of the false miss is one rebuild, not
 * a wrong picture.
 *
 * Returned as base-36 so the key stays short in a log line.
 */
export function hashEnvPixels(px: EnvPixels): string {
  const words = new Uint32Array(px.data.buffer, px.data.byteOffset, px.data.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i]!, 0x01000193);
  h = Math.imul(h ^ px.width, 0x01000193);
  h = Math.imul(h ^ px.height, 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * The cache key for one prefiltered environment: WHAT was prefiltered, and at
 * WHAT atlas geometry.
 *
 * `content` is the environment's identity — a preset id (procedural and fully
 * determined by its name) or `assetId#<pixel hash>`. The layout half is not
 * decoration: changing the atlas dimensions or the level count while a texture
 * of the old shape is still cached would hand the shader a buffer of the wrong
 * size, which slices every reflection in the comp.
 */
export function envAtlasKey(
  content: string,
  width: number,
  height: number,
  levels: number,
): string {
  return `v${ENV_ATLAS_CACHE_VERSION}|${content}|${width}x${height}x${levels}`;
}

/**
 * A least-recently-used map, bounded by entry count.
 *
 * Bounded by COUNT rather than by bytes because every atlas is exactly the
 * same size — `width × height × levels × 4` — so a count is a byte budget
 * stated in the unit that is easier to reason about. At the default bound and
 * the shipped 256×128×5 layout the ceiling is 8 × 640 KB ≈ 5 MB, which is what
 * a project cycling through skies is allowed to cost.
 *
 * `Map` iterates in insertion order, so "oldest" is `keys().next()`; a hit
 * re-inserts to move the entry to the young end. That is the whole algorithm —
 * no linked list, no timestamps.
 */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    // Re-insert to mark it as the most recently used.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  clear(): void {
    this.map.clear();
  }

  /** Test/inspection only — the keys, oldest first. */
  keys(): string[] {
    return [...this.map.keys()];
  }
}
