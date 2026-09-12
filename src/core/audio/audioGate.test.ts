/**
 * The noise gate's curve.
 *
 * Tested pure, against hand-written envelopes, because the behaviour that
 * matters is a state machine over time and the interesting cases are the ones
 * that are hard to produce on purpose with real audio: a signal sitting exactly
 * at the threshold, a gap shorter than the hold, a take that opens on its first
 * frame.
 *
 * The load-bearing claim is CHATTER: a gate that opens and shuts around a
 * hovering signal is far more audible than whatever it was cleaning up, and
 * Hold is the only thing standing between this and that. It is also the part
 * nobody would think to check by ear until a client did.
 */

import { gateLevels, planGate, DEFAULT_GATE } from './audioGate';
import { MIN_LEVEL_DB } from './audioParams';
import { dbToEnv } from './ducking';

/**
 * dBFS → the value an envelope actually carries.
 *
 * NOT `10 ** (db/20)`. `analyseAudioEnvelope` returns a 0..1 position on a
 * −60…0 dB scale, not a linear amplitude, and this fixture said otherwise until
 * a walkthrough with a real clip exposed it — at which point these tests were
 * passing *because* they shared the implementation's unit error. Building the
 * fixture through the same `dbToEnv` the engine uses is what stops that
 * happening twice.
 */
const amp = (db: number): number => dbToEnv(db);

/** An envelope: `n` frames at `db`, repeated for each segment given. */
const env = (...segments: Array<[db: number, frames: number]>): Float32Array => {
  const out: number[] = [];
  for (const [db, frames] of segments) for (let i = 0; i < frames; i++) out.push(amp(db));
  return Float32Array.from(out);
};

/** Instant ballistics, so a test can assert the TARGET rather than the ramp. */
const snap = { fps: 30, attackMs: 0, releaseMs: 0, holdMs: 0 };

describe('gateLevels', () => {
  it('holds the gate open while the signal is above the threshold', () => {
    const out = gateLevels(env([-10, 10]), { ...snap, thresholdDb: -40 });
    expect([...out]).toEqual(new Array(10).fill(0));
  });

  it('closes it to the range while the signal is below', () => {
    const out = gateLevels(env([-80, 10]), { ...snap, thresholdDb: -40, rangeDb: -60 });
    expect([...out]).toEqual(new Array(10).fill(-60));
  });

  /**
   * The opposite of `duckLevels`, and the reason a compressor cannot stand in:
   * a compressor acts ABOVE its threshold, a gate below.
   */
  it('acts below the threshold, not above it', () => {
    const loud = gateLevels(env([-5, 5]), { ...snap, thresholdDb: -30 });
    const quiet = gateLevels(env([-70, 5]), { ...snap, thresholdDb: -30 });
    expect(loud[4]).toBe(0);
    expect(quiet[4]).toBeLessThan(0);
  });

  it('starts closed, so room tone at the head is not let through', () => {
    const out = gateLevels(env([-80, 5], [-10, 5]), { ...snap, thresholdDb: -40, rangeDb: -60 });
    expect(out[0]).toBe(-60);
  });

  /**
   * CHATTER. A gap shorter than the hold must not close the gate — this is what
   * stops a gate breathing between the syllables of one word.
   */
  it('rides through a gap shorter than the hold', () => {
    const out = gateLevels(
      env([-10, 10], [-80, 3], [-10, 10]),
      { fps: 30, attackMs: 0, releaseMs: 0, holdMs: 200, thresholdDb: -40, rangeDb: -60 },
    );
    // 200 ms at 30 fps is 6 frames of hold; the gap is 3.
    expect([...out.slice(10, 13)]).toEqual([0, 0, 0]);
  });

  it('closes once the gap outlasts the hold', () => {
    const out = gateLevels(
      env([-10, 5], [-80, 30]),
      { fps: 30, attackMs: 0, releaseMs: 0, holdMs: 100, thresholdDb: -40, rangeDb: -60 },
    );
    expect(out[out.length - 1]).toBe(-60);
  });

  it('ramps rather than jumping when attack and release are set', () => {
    const out = gateLevels(
      env([-80, 5], [-10, 20]),
      { fps: 30, attackMs: 200, releaseMs: 200, holdMs: 0, thresholdDb: -40, rangeDb: -60 },
    );
    // 200 ms at 30 fps is a 6-frame ramp, so frames 5..9 are strictly inside
    // it — the 6th lands exactly on 0 and would not be "still climbing".
    const opening = [...out.slice(5, 10)];
    // Strictly increasing towards 0 — a ramp, not a step.
    for (let i = 1; i < opening.length; i++) {
      expect(opening[i]!).toBeGreaterThan(opening[i - 1]!);
    }
    expect(opening[opening.length - 1]).toBeLessThan(0);
    // And it does arrive: a ramp that never completes is a gate stuck ajar.
    expect(out[11]).toBe(0);
  });

  it('never opens past unity or closes past its range', () => {
    const out = gateLevels(env([-10, 20], [-90, 20]), { fps: 30, thresholdDb: -40, rangeDb: -24 });
    for (const v of out) {
      expect(v).toBeLessThanOrEqual(0);
      expect(v).toBeGreaterThanOrEqual(-24);
    }
  });

  it('returns nothing for an empty envelope', () => {
    expect(gateLevels(new Float32Array(0))).toHaveLength(0);
  });

  it('has sane defaults — silence, with a hold long enough not to chatter', () => {
    expect(DEFAULT_GATE.rangeDb).toBe(-60);
    expect(DEFAULT_GATE.holdMs).toBeGreaterThan(0);
    expect(DEFAULT_GATE.releaseMs).toBeGreaterThan(DEFAULT_GATE.attackMs);
  });
});

describe('planGate', () => {
  const plan = (e: Float32Array, extra = {}): ReturnType<typeof planGate> =>
    planGate(e, {
      startCompSec: 0,
      baseLevelDb: 0,
      toKeyframeTime: (t) => t,
      thresholdDb: -40,
      ...snap,
      ...extra,
    });

  it('writes the gate curve ON TOP of the layer’s own level', () => {
    // A bed already at −6 dB must gate to −66, not to −60: the gate's range is
    // relative, exactly as a fader move would be.
    const kf = plan(env([-80, 4]), { baseLevelDb: -6, rangeDb: -60 });
    expect(kf[0]!.value).toBe(MIN_LEVEL_DB);
  });

  it('keeps the layer’s level where the gate is open', () => {
    const kf = plan(env([-10, 6]), { baseLevelDb: -6 });
    expect(kf[0]!.value).toBeCloseTo(-6, 2);
  });

  /**
   * A four-minute take is 7 200 frames and a gate is flat for nearly all of
   * them. One keyframe per frame would make the property row unreadable and the
   * file large for no gain in accuracy.
   */
  it('thins the flat stretches rather than writing one key per frame', () => {
    const kf = plan(env([-10, 300]));
    expect(kf.length).toBeLessThan(20);
  });

  it('offsets every keyframe by the range’s start', () => {
    const kf = plan(env([-10, 10]), { startCompSec: 5 });
    expect(kf[0]!.t).toBeGreaterThanOrEqual(5);
  });

  /**
   * A frozen layer maps many comp frames onto one layer time. Two keyframes
   * there is not a curve, and whichever landed second would win arbitrarily.
   */
  it('drops duplicates when retiming collapses frames onto one layer time', () => {
    const kf = planGate(env([-10, 10], [-80, 10]), {
      startCompSec: 0,
      baseLevelDb: 0,
      toKeyframeTime: () => 7,
      thresholdDb: -40,
      ...snap,
    });
    expect(kf).toHaveLength(1);
  });

  it('writes nothing for an empty envelope', () => {
    expect(plan(new Float32Array(0))).toEqual([]);
  });
});
