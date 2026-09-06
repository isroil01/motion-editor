/**
 * The IBL prefilter cache.
 *
 * The prefilter is the single most expensive pure function in the viewport —
 * `docs/VIEWPORT_WORKER_PLAN.md` measured `buildEnvSpecularAtlas` at 18 % of
 * all app-code CPU sampled — so every claim the cache makes is worth a test
 * that fails loudly, not a comment.
 *
 * Three of these pin behaviour that was WRONG before the cache was keyed on
 * content, and each of them was a real cost or a real wrong picture:
 *
 *   • decoding an HDRI used to flush every OTHER sky's atlas (O(N²) prefilters
 *     while a project opens),
 *   • re-importing an HDRI under the same asset id rebuilt the atlas but kept
 *     the same `id`, so a renderer keyed on `id` showed the STALE reflection,
 *   • the ninth sky in an eight-entry cache threw away all eight.
 */

import { LruCache, hashEnvPixels, envAtlasKey, ENV_ATLAS_CACHE_VERSION } from './envAtlasCache';
import {
  ENV_SPEC_WIDTH,
  ENV_SPEC_HEIGHT,
  environmentSpecularMap,
  environmentSpecularCacheKeys,
  setEnvironmentAssetPixels,
  clearEnvironmentAssetPixels,
  type EnvPixels,
} from './environmentLight';

function skyPixels(seed: number): EnvPixels {
  const data = new Float32Array(ENV_SPEC_WIDTH * ENV_SPEC_HEIGHT * 3);
  for (let i = 0; i < data.length; i++) data[i] = ((i * 2654435761 + seed) % 1000) / 1000;
  return { width: ENV_SPEC_WIDTH, height: ENV_SPEC_HEIGHT, data };
}

beforeEach(() => clearEnvironmentAssetPixels());
afterAll(() => clearEnvironmentAssetPixels());

describe('content hashing', () => {
  it('separates two skies and agrees with itself', () => {
    const a = skyPixels(1);
    const b = skyPixels(2);
    expect(hashEnvPixels(a)).toBe(hashEnvPixels(skyPixels(1)));
    expect(hashEnvPixels(a)).not.toBe(hashEnvPixels(b));
  });

  it('notices a single changed texel', () => {
    const a = skyPixels(1);
    const b = skyPixels(1);
    b.data[7777] = b.data[7777]! + 0.25;
    expect(hashEnvPixels(a)).not.toBe(hashEnvPixels(b));
  });

  it('separates the same buffer read at two shapes', () => {
    const data = new Float32Array(64 * 32 * 3).fill(0.5);
    expect(hashEnvPixels({ width: 64, height: 32, data })).not.toBe(
      hashEnvPixels({ width: 32, height: 64, data }),
    );
  });
});

describe('the key', () => {
  it('carries the layout, so an atlas of the old shape can never be served', () => {
    expect(envAtlasKey('studio', 256, 128, 5)).not.toBe(envAtlasKey('studio', 256, 128, 6));
    expect(envAtlasKey('studio', 256, 128, 5)).not.toBe(envAtlasKey('studio', 512, 256, 5));
  });

  it('carries the scheme version', () => {
    expect(envAtlasKey('studio', 256, 128, 5)).toContain(`v${ENV_ATLAS_CACHE_VERSION}`);
  });
});

describe('LRU eviction', () => {
  it('evicts the least recently used ONE, not the whole cache', () => {
    const lru = new LruCache<number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    lru.get('a');           // 'b' is now the oldest
    lru.set('d', 4);
    expect(lru.keys().sort()).toEqual(['a', 'c', 'd']);
    expect(lru.size).toBe(3);
  });

  it('re-setting an existing key refreshes rather than duplicates', () => {
    const lru = new LruCache<number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('a', 9);
    lru.set('c', 3);
    expect(lru.get('a')).toBe(9);
    expect(lru.get('b')).toBeUndefined();
  });
});

describe('the prefilter cache, end to end', () => {
  it('prefilters an unchanged sky exactly once', () => {
    const first = environmentSpecularMap('sunset');
    expect(environmentSpecularMap('sunset')).toBe(first);
  });

  it('★ decoding one HDRI does not throw away any other sky\'s atlas', () => {
    // This is the O(N²) that the old `specularCache.clear()` in
    // `setEnvironmentAssetPixels` caused: every sky already prefiltered was
    // rebuilt each time the next image landed. Object identity is the proof —
    // a rebuild would return a new object.
    setEnvironmentAssetPixels('hdri_a', skyPixels(1));
    const a = environmentSpecularMap('asset:hdri_a');

    setEnvironmentAssetPixels('hdri_b', skyPixels(2));
    expect(environmentSpecularMap('asset:hdri_a')).toBe(a);

    setEnvironmentAssetPixels('hdri_c', skyPixels(3));
    expect(environmentSpecularMap('asset:hdri_a')).toBe(a);
    expect(environmentSpecularMap('asset:hdri_b')).toBe(
      environmentSpecularMap('asset:hdri_b'),
    );
  });

  it('★ gives re-imported pixels a NEW id, so the GPU texture is replaced', () => {
    // The renderer keys its texture off `id` (see environmentSpecular.test.ts:
    // "equal ids must mean equal texels"). Before content keying, re-importing
    // an HDRI rebuilt the atlas under the SAME id and the stale texture stayed
    // on the GPU.
    setEnvironmentAssetPixels('hdri_x', skyPixels(1));
    const before = environmentSpecularMap('asset:hdri_x');
    setEnvironmentAssetPixels('hdri_x', skyPixels(99));
    const after = environmentSpecularMap('asset:hdri_x');
    expect(after.id).not.toBe(before.id);
    expect(after).not.toBe(before);
  });

  it('re-importing IDENTICAL pixels reuses the atlas and the upload', () => {
    setEnvironmentAssetPixels('hdri_y', skyPixels(4));
    const before = environmentSpecularMap('asset:hdri_y');
    setEnvironmentAssetPixels('hdri_y', skyPixels(4));
    expect(environmentSpecularMap('asset:hdri_y')).toBe(before);
  });

  it('an undecoded image sky is the default preset, and keys as one', () => {
    expect(environmentSpecularMap('asset:never-arrives').id).toBe(
      environmentSpecularMap('studio').id,
    );
  });

  it('stays bounded while a project cycles through skies', () => {
    // 11, not 20: enough to pass the bound of 8 by a clear margin, and every
    // extra sky is a real ~0.4 s prefilter in this harness.
    for (let i = 0; i < 11; i++) {
      setEnvironmentAssetPixels(`cycle_${i}`, skyPixels(1000 + i));
      environmentSpecularMap(`asset:cycle_${i}`);
    }
    expect(environmentSpecularCacheKeys().length).toBeLessThanOrEqual(8);
  });
});
