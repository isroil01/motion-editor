/**
 * Fades.
 *
 * The geometry is tested pure — `planFade` and `mergeFade` take their times and
 * levels as arguments — because the interesting cases are the degenerate ones
 * (a fade longer than the clip, a zero-length clip, a retimed layer that maps
 * both ends of the fade onto one layer time) and none of them is pleasant to
 * set up as a real scene.
 *
 * The load-bearing claim is the LEVEL one: a fade ends at whatever the layer is
 * already set to, never at 0 dB. A bed trimmed to −8 dB that faded up to unity
 * would jump 8 dB at the end of its own fade, and that is the kind of bug that
 * is inaudible while scrubbing and obvious on export.
 */

import { planFade, mergeFade } from './audioFades';
import { MIN_LEVEL_DB } from './audioParams';
import type { Keyframe } from '@motion/animation';

/** Identity axis: a layer with no retiming keyframes at comp time. */
const identity = (t: number): number => t;

const span = { startSec: 10, endSec: 14 };

describe('planFade', () => {
  it('fades in from silence at the bar head up to the layer level', () => {
    const kf = planFade(span, 'in', 1, -6, identity);
    expect(kf).toEqual([
      { t: 10, value: MIN_LEVEL_DB, easing: 'linear' },
      { t: 11, value: -6, easing: 'linear' },
    ]);
  });

  it('fades out to silence at the bar tail, starting one duration earlier', () => {
    const kf = planFade(span, 'out', 1.5, -6, identity);
    expect(kf).toEqual([
      { t: 12.5, value: -6, easing: 'linear' },
      { t: 14, value: MIN_LEVEL_DB, easing: 'linear' },
    ]);
  });

  /**
   * Ending at 0 dB instead of the layer's own level is the bug this pins. The
   * fade must land exactly where the static level already is.
   */
  it('lands on the layer’s existing level, not on unity', () => {
    const [, top] = planFade(span, 'in', 1, -8, identity);
    expect(top!.value).toBe(-8);
  });

  it('clamps a fade longer than the clip to the clip', () => {
    // 5 s of fade on a 4 s bar is obviously a 4 s fade, not a refusal.
    expect(planFade(span, 'in', 5, 0, identity)).toEqual([
      { t: 10, value: MIN_LEVEL_DB, easing: 'linear' },
      { t: 14, value: 0, easing: 'linear' },
    ]);
  });

  it('writes nothing for a zero or negative duration', () => {
    expect(planFade(span, 'in', 0, 0, identity)).toEqual([]);
    expect(planFade(span, 'out', -1, 0, identity)).toEqual([]);
  });

  it('writes nothing for a span with no length', () => {
    expect(planFade({ startSec: 5, endSec: 5 }, 'in', 1, 0, identity)).toEqual([]);
    expect(planFade({ startSec: 5, endSec: 4 }, 'in', 1, 0, identity)).toEqual([]);
  });

  /**
   * A frozen (time-remapped) layer maps every comp time onto one layer time.
   * Two keyframes at the same time is a step, not a fade — and a step to
   * −60 dB would silence the layer outright.
   */
  it('writes nothing when retiming collapses both ends onto one layer time', () => {
    expect(planFade(span, 'in', 1, 0, () => 7)).toEqual([]);
  });
});

describe('mergeFade', () => {
  const kf = (t: number, value: number): Keyframe => ({ t, value, easing: 'linear' });

  it('keeps keyframes outside the fade window — a duck survives a fade-in', () => {
    const existing = [kf(0, 0), kf(12, -20), kf(13, 0)];
    const fade = [kf(10, MIN_LEVEL_DB), kf(11, 0)];
    expect(mergeFade(existing, fade).map((k) => k.t)).toEqual([0, 10, 11, 12, 13]);
  });

  /**
   * Keyframes INSIDE the window described the level over exactly the stretch
   * the fade now describes. Keeping them would leave the two fighting.
   */
  it('drops keyframes inside the fade window', () => {
    const existing = [kf(10.5, -3), kf(20, 0)];
    const fade = [kf(10, MIN_LEVEL_DB), kf(11, 0)];
    expect(mergeFade(existing, fade)).toEqual([
      kf(10, MIN_LEVEL_DB),
      kf(11, 0),
      kf(20, 0),
    ]);
  });

  it('returns the track untouched when there is no fade to merge', () => {
    const existing = [kf(1, 0)];
    expect(mergeFade(existing, [])).toEqual(existing);
  });

  it('sorts the result, so a fade-out merged before earlier keys stays ordered', () => {
    const merged = mergeFade([kf(1, 0)], [kf(12.5, 0), kf(14, MIN_LEVEL_DB)]);
    expect(merged.map((k) => k.t)).toEqual([1, 12.5, 14]);
  });
});
