/**
 * The hover preview must be cheap, cached and — above all — HONEST.
 *
 * "No preview" is a real answer: a GPU-only effect has no CSS-filter path, and
 * a canvas that does not implement `filter` (jsdom, some headless builds) would
 * otherwise draw the bare plate and pass it off as the effect. Both cases have
 * to come back as `null` so the panel can show the icon instead.
 */

import { effectPreviewFor, peekEffectPreview, resetEffectPreviewsForTest } from './effectPreviewThumbs';
import type { EffectDef } from '@core/effects/effects';

/** A stand-in def. The `type` is deliberately NOT an `EffectType`: these are
 *  probes for the preview's own rules, not entries in the real registry. */
const asDef = (d: { type: string; gpuOnly?: boolean; css: () => string }): EffectDef =>
  ({ label: d.type, params: [], ...d }) as unknown as EffectDef;

beforeEach(() => resetEffectPreviewsForTest());

it('refuses to invent a picture for a GPU-only effect', () => {
  expect(effectPreviewFor(asDef({ type: 'gpu-thing', gpuOnly: true, css: () => 'blur(4px)' }))).toBeNull();
});

it('refuses one for an effect with no CSS filter at all', () => {
  expect(effectPreviewFor(asDef({ type: 'no-css', css: () => '   ' }))).toBeNull();
});

it('survives a css() that throws rather than taking the panel down with it', () => {
  expect(effectPreviewFor(asDef({ type: 'boom', css: () => { throw new Error('nope'); } }))).toBeNull();
});

it('answers each effect once and then from the cache', () => {
  let calls = 0;
  // An empty filter on purpose: jsdom has no real `toDataURL`, so the picture
  // half cannot be exercised here — the CACHING half can, and it is the half
  // that keeps a hover from re-rendering the same thumbnail forever.
  const def = asDef({ type: 'counted', css: () => { calls += 1; return ''; } });

  expect(peekEffectPreview('counted')).toBeUndefined();
  const first = effectPreviewFor(def);
  expect(peekEffectPreview('counted')).toBe(first);
  effectPreviewFor(def);
  effectPreviewFor(def);
  // Cached even when the answer was "there is no preview" — the expensive
  // half is the attempt, not the picture.
  expect(calls).toBe(1);
});

it('forgets everything when the test seam resets it', () => {
  effectPreviewFor(asDef({ type: 'temp', css: () => '' }));
  expect(peekEffectPreview('temp')).not.toBeUndefined();
  resetEffectPreviewsForTest();
  expect(peekEffectPreview('temp')).toBeUndefined();
});
