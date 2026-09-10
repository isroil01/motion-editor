/**
 * Cryptomatte (plan C2): the manifest names the ids, the ranks carry
 * (id, coverage) pairs as float BITS, and an object's matte is the sum of its
 * coverage over ranks — so shared edges split and everything sums to one.
 */

import { coverageToRgba8, extractCryptomatte, idMatteCoverage } from './cryptomatte';
import type { ExrImage } from './exr';

/** A float32 whose bit pattern is `hash`. */
function idFloat(hash: number): number {
  const u = new Uint32Array([hash >>> 0]);
  return new Float32Array(u.buffer)[0]!;
}

const A = 0x12345678; const B = 0x9abcdef0;

function image(): ExrImage {
  // 2×2: pixel 0 all A, pixel 1 all B, pixel 2 half A / half B, pixel 3 empty.
  const r = Float32Array.from([idFloat(A), idFloat(B), idFloat(A), 0]);
  const g = Float32Array.from([1, 1, 0.5, 0]);
  const b = Float32Array.from([0, 0, idFloat(B), 0]);
  const a = Float32Array.from([0, 0, 0.5, 0]);
  return {
    width: 2, height: 2,
    channels: [
      { name: 'R', data: new Float32Array(4) }, { name: 'G', data: new Float32Array(4) }, { name: 'B', data: new Float32Array(4) },
      { name: 'CryptoObject00.R', data: r }, { name: 'CryptoObject00.G', data: g },
      { name: 'CryptoObject00.B', data: b }, { name: 'CryptoObject00.A', data: a },
    ],
    attributes: {
      'cryptomatte/abc123/name': 'CryptoObject',
      'cryptomatte/abc123/manifest': JSON.stringify({ cube: A.toString(16), sphere: B.toString(16) }),
    },
  };
}

describe('cryptomatte', () => {
  it('finds the layer, its ranks and the manifest names', () => {
    const set = extractCryptomatte(image())!;
    expect(set).not.toBeNull();
    expect(set.layers).toHaveLength(1);
    const layer = set.layers[0]!;
    expect(layer.name).toBe('CryptoObject');
    expect(layer.ranks).toHaveLength(2);
    expect(layer.objects.map((o) => o.name)).toEqual(['cube', 'sphere']);
    expect(layer.objects.find((o) => o.name === 'cube')!.hash).toBe(A);
  });

  it('an object\'s matte sums its coverage over ranks, and shared edges split', () => {
    const set = extractCryptomatte(image())!;
    const layer = set.layers[0]!;
    const cube = idMatteCoverage(set, layer, [A]);
    const sphere = idMatteCoverage(set, layer, [B]);
    expect(Array.from(cube)).toEqual([1, 0, 0.5, 0]);
    expect(Array.from(sphere)).toEqual([0, 1, 0.5, 0]);
    const both = idMatteCoverage(set, layer, [A, B]);
    expect(Array.from(both)).toEqual([1, 1, 1, 0]);
    expect(Array.from(coverageToRgba8(cube)).slice(0, 8)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });

  it('a stripped file (no manifest) still lists its ids by hex', () => {
    const img = image();
    delete img.attributes;
    const set = extractCryptomatte(img)!;
    expect(set.layers[0]!.objects.map((o) => o.name).sort()).toEqual(['#12345678', '#9abcdef0']);
  });

  it('an image without Cryptomatte channels is null', () => {
    expect(extractCryptomatte({ width: 1, height: 1, channels: [{ name: 'R', data: new Float32Array(1) }] })).toBeNull();
  });
});
