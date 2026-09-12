/**
 * Pan.
 *
 * Two claims, and the second is the one that could silently break an export.
 *
 * 1. A centred layer builds NO panner. Pan is new; every project that predates
 *    it must keep exactly the audio graph it had, and "exactly" means no extra
 *    node in the chain, not "a node set to 0".
 * 2. The live engine and the offline mixdown ask the SAME question about
 *    whether a panner exists. A voice that pans in the preview and renders
 *    centred would pass every visual check and only surface on headphones,
 *    which is the failure `voicePanner` is shared to prevent.
 */

import {
  voicePanner, panToNorm, buildPanRamp, AUDIO_PAN_PROP, MIN_PAN, MAX_PAN,
} from './audioParams';
import { defaultAnimation } from '@motion/animation';

/** A context stub that records how many panners were asked for. */
function fakeCtx(): BaseAudioContext & { made: number } {
  const ctx = {
    made: 0,
    createStereoPanner(): StereoPannerNode {
      ctx.made += 1;
      return { pan: { value: 0 } } as unknown as StereoPannerNode;
    },
  };
  return ctx as unknown as BaseAudioContext & { made: number };
}

describe('voicePanner — the graph only grows when it has to', () => {
  it('builds nothing for a centred, unanimated voice', () => {
    const ctx = fakeCtx();
    expect(voicePanner(ctx, {})).toBeNull();
    expect(voicePanner(ctx, { pan: 0 })).toBeNull();
    expect(ctx.made).toBe(0);
  });

  it('builds one as soon as the voice is off centre', () => {
    const ctx = fakeCtx();
    const p = voicePanner(ctx, { pan: -40 });
    expect(p).not.toBeNull();
    expect(p!.pan.value).toBeCloseTo(-0.4, 5);
    expect(ctx.made).toBe(1);
  });

  /** An animated pan can pass through 0 — the panner has to exist anyway, or
   *  the ramp would have nothing to be scheduled on. */
  it('builds one for an animated pan even when it currently reads centre', () => {
    const ctx = fakeCtx();
    expect(voicePanner(ctx, { pan: 0, panAnimated: true })).not.toBeNull();
  });

  /** Older engines have no StereoPannerNode. A missing panner is better than a
   *  thrown constructor taking the whole voice — and its layer — down. */
  it('degrades to no panner rather than throwing when the context lacks one', () => {
    const bare = {} as unknown as BaseAudioContext;
    expect(() => voicePanner(bare, { pan: 80 })).not.toThrow();
    expect(voicePanner(bare, { pan: 80 })).toBeNull();
  });
});

describe('panToNorm', () => {
  it('maps the document percent onto the node’s −1…1', () => {
    expect(panToNorm(0)).toBe(0);
    expect(panToNorm(MIN_PAN)).toBe(-1);
    expect(panToNorm(MAX_PAN)).toBe(1);
    expect(panToNorm(50)).toBeCloseTo(0.5, 6);
  });

  it('clamps rather than letting a bad document drive the node out of range', () => {
    expect(panToNorm(500)).toBe(1);
    expect(panToNorm(-500)).toBe(-1);
    expect(panToNorm(Number.NaN)).toBe(0);
  });
});

describe('buildPanRamp', () => {
  beforeEach(() => defaultAnimation.clear());

  /** The common case must stay ONE point — a constant, not a swept curve. */
  it('yields a single point for an unanimated pan', () => {
    const ramp = buildPanRamp('n1', 50, 0, 2, { animated: false });
    expect(ramp).toHaveLength(1);
    expect(ramp[0]!.gain).toBeCloseTo(0.5, 6);
  });

  it('samples the track across the voice window when the pan is keyed', () => {
    defaultAnimation.setKeyframes('n1', AUDIO_PAN_PROP, [
      { t: 0, value: -100, easing: 'linear' },
      { t: 2, value: 100, easing: 'linear' },
    ]);
    const ramp = buildPanRamp('n1', 0, 0, 2, { animated: true });
    expect(ramp.length).toBeGreaterThan(2);
    expect(ramp[0]!.gain).toBeCloseTo(-1, 2);
    expect(ramp[ramp.length - 1]!.gain).toBeCloseTo(1, 1);
    // Already converted into the node's units, not left as percent — the
    // ramp's contract is "whatever this AudioParam takes".
    for (const pt of ramp) {
      expect(pt.gain).toBeGreaterThanOrEqual(-1);
      expect(pt.gain).toBeLessThanOrEqual(1);
    }
  });
});
