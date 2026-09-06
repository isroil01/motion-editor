/**
 * The composition-settings sanitizer. The one behaviour worth pinning hard:
 * fps is clamped but NEVER rounded. 23.976 and 29.97 are real broadcast rates
 * (presets.ts offers both and documents that rounding them is a sync bug) —
 * an integer-rounding sanitize silently turned the NTSC presets into 24/30,
 * so the comp record and the timeline disagreed and footage drifted against
 * its audio.
 */

import { sanitize } from './compositionStore';
import { resolvePixelAspect } from './projectStore';
import {
  PIXEL_ASPECT_PRESETS,
  findPixelAspectPreset,
  describePixelAspect,
} from '@layout/Composition/pixelAspectPresets';

describe('composition sanitize', () => {
  it('keeps NTSC fractional frame rates exactly', () => {
    expect(sanitize({ fps: 23.976 }).fps).toBeCloseTo(23.976, 6);
    expect(sanitize({ fps: 29.97 }).fps).toBeCloseTo(29.97, 6);
    expect(sanitize({ fps: 59.94 }).fps).toBeCloseTo(59.94, 6);
  });

  it('still clamps fps into [1, 240] and falls back on non-finite', () => {
    expect(sanitize({ fps: 0 }).fps).toBe(1);
    expect(sanitize({ fps: 1000 }).fps).toBe(240);
    expect(sanitize({ fps: Number.NaN }).fps).toBe(30);
  });

  it('keeps rounding the integer-valued fields', () => {
    expect(sanitize({ width: 1920.6 }).width).toBe(1921);
    expect(sanitize({ height: 0 }).height).toBe(1);
  });
});

/**
 * COMPOSITION pixel aspect. The claim that has to hold for every document ever
 * written: a comp that never opted in carries no key at all and reads as 1, so
 * opening Composition Settings on an old project and closing it changes nothing
 * on disk.
 */
describe('composition pixel aspect', () => {
  it('is absent by default and resolves to square', () => {
    expect(resolvePixelAspect(undefined)).toBe(1);
    expect(resolvePixelAspect({})).toBe(1);
    expect('pixelAspect' in sanitize({ width: 100 })).toBe(false);
  });

  it('refuses the values that would collapse or mirror the stage', () => {
    expect(resolvePixelAspect({ pixelAspect: 0 })).toBe(1);
    expect(resolvePixelAspect({ pixelAspect: -2 })).toBe(1);
    expect(resolvePixelAspect({ pixelAspect: Number.NaN })).toBe(1);
    expect(sanitize({ pixelAspect: 0 }).pixelAspect).toBe(0.1);
    expect(sanitize({ pixelAspect: 1000 }).pixelAspect).toBe(10);
    expect(sanitize({ pixelAspect: Number.NaN }).pixelAspect).toBe(1);
  });

  it('rounds to the 4dp the preset catalog is stated at', () => {
    expect(sanitize({ pixelAspect: 0.9090999999999999 }).pixelAspect).toBe(0.9091);
    expect(sanitize({ pixelAspect: 1.45871234 }).pixelAspect).toBe(1.4587);
  });

  it('round-trips every preset through the sanitizer back to its own preset', () => {
    for (const p of PIXEL_ASPECT_PRESETS) {
      const stored = sanitize({ pixelAspect: p.value }).pixelAspect as number;
      expect(findPixelAspectPreset(stored)?.id).toBe(p.id);
    }
  });

  it('calls a value that is no preset custom', () => {
    expect(findPixelAspectPreset(1.5)).toBeUndefined();
    expect(describePixelAspect(1.5)).toBe('1.5000 (custom)');
    expect(describePixelAspect(1)).toBe('1.0000 (Square Pixels)');
  });
});
