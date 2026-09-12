/**
 * The Audio panel's two faders sit on top of one scalar level and one scalar
 * pan. These functions are that bridge, and the property that matters most is
 * the ROUND TRIP: a fader nudged ten times must land where it was dropped, not
 * drift a tenth of a dB per nudge. That is a bug you feel and cannot describe,
 * which is exactly the kind worth pinning.
 */

import { channelGain, channelDb, fromChannelDb, CLIP_DB } from './faderMath';

const near = (a: number, b: number, eps = 0.05): void => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('channelGain — equal power, anchored on the layer level', () => {
  /**
   * Unity at centre, NOT the raw law's 0.707. The panel edits `audioLevelDb`,
   * so a centred fader has to read back the number that property holds; a
   * −3 dB offset would make the panel look like it disagreed with itself.
   */
  it('sits both channels at unity when centred', () => {
    near(channelGain(0, 'l'), 1);
    near(channelGain(0, 'r'), 1);
  });

  /** Hard pan hands the near channel √2 against centre's 1 — a real +3 dB,
   *  which is what StereoPannerNode actually outputs. */
  it('gives the near channel +3 dB and the far one silence at the extremes', () => {
    near(channelGain(-100, 'l'), Math.SQRT2);
    near(channelGain(-100, 'r'), 0);
    near(channelGain(100, 'l'), 0);
    near(channelGain(100, 'r'), Math.SQRT2);
  });

  it('clamps a pan outside the legal range rather than extrapolating', () => {
    expect(channelGain(-500, 'l')).toBe(channelGain(-100, 'l'));
    expect(channelGain(Number.NaN, 'l')).toBe(channelGain(0, 'l'));
  });
});

describe('channelDb', () => {
  /**
   * Centred, BOTH faders read the layer's level. This is the one users check
   * without thinking: set a layer to −6 and both faders must say −6, not the
   * −9 that a naive equal-power reading would show.
   */
  it('reads the layer level on both faders when centred', () => {
    near(channelDb(-6, 0, 'l'), -6);
    near(channelDb(-6, 0, 'r'), -6);
  });

  it('drops the far channel and lifts the near one by 3 dB when panned hard', () => {
    near(channelDb(0, 100, 'r'), 3);
    expect(channelDb(0, 100, 'l')).toBeLessThanOrEqual(-60);
  });

  it('never reports above the +12 dB ceiling', () => {
    expect(channelDb(12, 0, 'l')).toBeLessThanOrEqual(12);
  });
});

describe('fromChannelDb round-trips', () => {
  it.each([
    [0, 0],
    [-6, 0],
    [6, 0],
    [-12, -50],
    [-3, 75],
    [0, -100],
    [0, 100],
  ])('recovers level %p and pan %p', (levelDb, pan) => {
    const back = fromChannelDb(channelDb(levelDb, pan, 'l'), channelDb(levelDb, pan, 'r'));
    near(back.levelDb, levelDb, 0.2);
    near(back.pan, pan, 1);
  });

  /**
   * Repeated round trips must not accumulate error. Ten nudges is what a user
   * does in a second of fine-tuning.
   */
  it('does not drift over ten round trips', () => {
    let state = { levelDb: -4.5, pan: 30 };
    for (let i = 0; i < 10; i++) {
      state = fromChannelDb(
        channelDb(state.levelDb, state.pan, 'l'),
        channelDb(state.levelDb, state.pan, 'r'),
      );
    }
    near(state.levelDb, -4.5, 0.3);
    near(state.pan, 30, 1.5);
  });

  it('reads two silent channels as centred silence, not as a pan', () => {
    expect(fromChannelDb(-60, -60)).toEqual({ levelDb: -60, pan: 0 });
  });

  it('pans fully when only one channel carries signal', () => {
    expect(fromChannelDb(0, -60).pan).toBeLessThan(-90);
    expect(fromChannelDb(-60, 0).pan).toBeGreaterThan(90);
  });

  it('keeps pan inside the legal range whatever it is fed', () => {
    for (const [l, r] of [[99, -99], [-99, 99], [0, 0], [12, 12]]) {
      const { pan } = fromChannelDb(l!, r!);
      expect(pan).toBeGreaterThanOrEqual(-100);
      expect(pan).toBeLessThanOrEqual(100);
    }
  });
});

describe('CLIP_DB', () => {
  /** Just under full scale, so a real 0 dBFS sample lights the indicator. */
  it('sits just below full scale', () => {
    expect(CLIP_DB).toBeLessThan(0);
    expect(CLIP_DB).toBeGreaterThan(-1);
  });
});
