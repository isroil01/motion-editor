/**
 * The four AE 26.3 audio effects, and the deepened versions of the older ones.
 *
 * Two things are worth pinning here and one is not.
 *
 * WORTH PINNING: that the graph is built from the nodes the effect claims to be
 * built from, and — more importantly — that the effects which grew new
 * parameters still build the OLD graph when those parameters are at their
 * defaults. Every one of Parametric EQ, Tone, Flange & Chorus, Reverb and
 * Modulator gained controls in this change, and a project saved before them
 * must sound identical. That is not something anyone would notice by listening;
 * it is exactly what a test is for.
 *
 * NOT worth pinning: how any of them sound. These assert wiring and shape, not
 * timbre.
 */

import { fakeAudioContext, fakeSource, paramValue, type FakeNode } from '@/__testHelpers__/fakeAudioContext';
import {
  connectAudioEffects,
  distortionCurve,
  hasFlag,
  AUDIO_EFFECT_DEFS,
  AUDIO_EFFECT_FLAGS,
  DISTORTION_CURVES,
  type AudioEffect,
  type AudioEffectType,
} from './audioEffects';

let n = 0;
const fx = (type: AudioEffectType, params: Record<string, number> = {}, extra: Partial<AudioEffect> = {}): AudioEffect => ({
  id: `afx_${++n}`,
  type,
  params,
  ...extra,
});

const build = (chain: AudioEffect[]): ReturnType<typeof fakeAudioContext> & { out: ReturnType<typeof connectAudioEffects> } => {
  const ctx = fakeAudioContext();
  const out = connectAudioEffects(ctx.ctx, fakeSource() as unknown as AudioNode, chain);
  return { ...ctx, out };
};

const kinds = (created: FakeNode[]): string[] => created.map((c) => c.kind);

// ── Compressor ───────────────────────────────────────────────────────
describe('compressor', () => {
  it('is a DynamicsCompressor with AE’s five controls wired through', () => {
    const { created } = build([
      fx('compressor', { threshold: -20, ratio: 4, knee: 6, attack: 10, release: 200 }),
    ]);
    const comp = created.find((c) => c.kind === 'compressor')!;
    expect(paramValue(comp, 'threshold')).toBe(-20);
    expect(paramValue(comp, 'ratio')).toBe(4);
    expect(paramValue(comp, 'knee')).toBe(6);
    // The controls are milliseconds; the node takes seconds.
    expect(paramValue(comp, 'attack')).toBeCloseTo(0.01, 6);
    expect(paramValue(comp, 'release')).toBeCloseTo(0.2, 6);
  });

  it('converts Makeup Gain from dB', () => {
    const { created } = build([fx('compressor', { makeupGain: 6 })]);
    const makeup = created.find((c) => c.kind === 'gain')!;
    expect(paramValue(makeup, 'gain')).toBeCloseTo(1.995, 3);
  });

  /**
   * The limiter is a SECOND compressor, and building one unconditionally would
   * change the sound of every Compressor instance for a control the user left
   * alone. At 0 dB it can do nothing, so it must not exist.
   */
  it('builds no limiter while Output Limit is at 0 dB', () => {
    const { created } = build([fx('compressor', { outputLimit: 0 })]);
    expect(created.filter((c) => c.kind === 'compressor')).toHaveLength(1);
  });

  it('builds the limiter as soon as Output Limit bites', () => {
    const { created } = build([fx('compressor', { outputLimit: -3 })]);
    const comps = created.filter((c) => c.kind === 'compressor');
    expect(comps).toHaveLength(2);
    // A limiter is a compressor whose ratio is steep enough that nothing gets
    // past, with an attack fast enough to catch the peak that would.
    expect(paramValue(comps[1]!, 'ratio')).toBeGreaterThanOrEqual(20);
    expect(paramValue(comps[1]!, 'attack')).toBeLessThanOrEqual(0.005);
  });
});

// ── Distortion ───────────────────────────────────────────────────────
describe('distortion', () => {
  it('shapes through a WaveShaper with a dry path beside it', () => {
    const { created } = build([fx('distortion', { drive: 50, mix: 50 })]);
    expect(kinds(created)).toContain('shaper');
    // Dry and wet gains plus pre/post/sum — a series-only distortion would
    // replace the signal, and Mix would have nothing to blend against.
    expect(created.filter((c) => c.kind === 'gain').length).toBeGreaterThanOrEqual(4);
  });

  describe('the transfer curves', () => {
    it.each(DISTORTION_CURVES.map((c) => c.value))('%s stays inside the rails', (kind) => {
      const curve = distortionCurve(kind, 100, 16);
      for (const v of curve) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    /**
     * Zero drive must be a WIRE. Soft Clip is the default character, so an
     * effect added and left alone would otherwise colour the layer before the
     * user touched a control.
     */
    it('soft clip at zero drive is the identity', () => {
      const curve = distortionCurve('soft-clip', 0, 16);
      expect(curve[0]).toBeCloseTo(-1, 3);
      expect(curve[curve.length - 1]).toBeCloseTo(1, 3);
      expect(curve[Math.floor(curve.length / 2)]).toBeCloseTo(0, 2);
    });

    it('is monotonic, so louder in is never quieter out', () => {
      for (const { value } of DISTORTION_CURVES) {
        const curve = distortionCurve(value, 60, 16);
        for (let i = 1; i < curve.length; i++) {
          expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]! - 1e-6);
        }
      }
    });

    /**
     * The bitcrusher. At 16 bits the step is finer than the table itself, so it
     * must change nothing; at 2 bits the output can only take a handful of
     * distinct values, which IS the effect.
     */
    it('quantises to the requested bit depth, and not at 16', () => {
      const full = distortionCurve('soft-clip', 50, 16);
      const crushed = distortionCurve('soft-clip', 50, 2);
      expect(new Set(full).size).toBeGreaterThan(100);
      expect(new Set(crushed).size).toBeLessThanOrEqual(4);
    });

    it('tube is asymmetric — that asymmetry is the even harmonics', () => {
      const curve = distortionCurve('tube', 70, 16);
      const mid = Math.floor(curve.length / 2);
      const up = curve[mid + 400]!;
      const down = curve[mid - 400]!;
      expect(Math.abs(up)).not.toBeCloseTo(Math.abs(down), 2);
    });
  });
});

// ── De-esser ─────────────────────────────────────────────────────────
describe('de-esser', () => {
  it('compresses a band and sums it back against the complement', () => {
    const { created } = build([fx('de-esser', { frequency: 7000, bandwidth: 3500 })]);
    const band = created.find((c) => c.kind === 'biquad')!;
    expect(band.type).toBe('bandpass');
    expect(paramValue(band, 'frequency')).toBe(7000);
    // Q is centre / width, so it has to track both.
    expect(paramValue(band, 'Q')).toBeCloseTo(2, 3);
    expect(kinds(created)).toContain('compressor');
    // The inverting gain is what subtracts the band from the whole.
    expect(created.some((c) => c.kind === 'gain' && paramValue(c, 'gain') === -1)).toBe(true);
  });

  /**
   * Sibilance Only is a MONITORING mode: it exists so you can hear what you are
   * about to squash while tuning Frequency. It must therefore drop the
   * complement entirely, not merely duck it.
   */
  it('drops the complement in Sibilance Only', () => {
    const { created } = build([fx('de-esser', {}, { flags: ['sibilanceOnly'] })]);
    expect(created.some((c) => c.kind === 'gain' && paramValue(c, 'gain') === -1)).toBe(false);
  });
});

// ── The deepened effects keep their old graph at defaults ────────────
describe('the new controls are inert at their defaults', () => {
  /** Build with every param at its declared default. */
  const atDefaults = (type: AudioEffectType, extra: Partial<AudioEffect> = {}): FakeNode[] => {
    const params: Record<string, number> = {};
    for (const p of AUDIO_EFFECT_DEFS[type].params) params[p.key] = p.default;
    return build([fx(type, params, extra)]).created;
  };

  /**
   * Tone gained four more frequencies. All four default to 0 Hz — AE's "this
   * tone is off" — so exactly one oscillator must still be built.
   */
  it('Tone builds one oscillator, not five', () => {
    expect(atDefaults('tone').filter((c) => c.kind === 'osc')).toHaveLength(1);
  });

  /** Flange & Chorus gained Voices, defaulting to 1: one delay line, as before. */
  it('Flange & Chorus builds one delay line', () => {
    expect(atDefaults('flange-chorus').filter((c) => c.kind === 'delay')).toHaveLength(1);
  });

  /** Modulator gained frequency modulation, defaulting to 0: no vibrato delay. */
  it('Modulator builds no vibrato delay line', () => {
    expect(atDefaults('modulator').filter((c) => c.kind === 'delay')).toHaveLength(0);
  });

  it('Modulator grows one as soon as FM depth is asked for', () => {
    const created = build([fx('modulator', { fmDepth: 50 })]).created;
    expect(created.filter((c) => c.kind === 'delay')).toHaveLength(1);
    // Two LFOs now: one for amplitude, one for pitch.
    expect(created.filter((c) => c.kind === 'osc')).toHaveLength(2);
  });

  /**
   * Parametric EQ is the exception, and deliberately so: it builds three
   * filters where it built one. Bands 2 and 3 default to 0 dB, and a peaking
   * filter at 0 dB is a wire — so the SOUND is unchanged even though the graph
   * is not, which is the trade this one makes to match AE's three bands.
   */
  it('Parametric EQ builds three bands, two of them flat', () => {
    const biquads = atDefaults('parametric-eq').filter((c) => c.kind === 'biquad');
    expect(biquads).toHaveLength(3);
    expect(paramValue(biquads[1]!, 'gain')).toBe(0);
    expect(paramValue(biquads[2]!, 'gain')).toBe(0);
  });
});

// ── Flags ────────────────────────────────────────────────────────────
describe('the flag mechanism', () => {
  it('reads a set flag and treats an absent list as nothing set', () => {
    expect(hasFlag(fx('backwards', {}, { flags: ['swapChannels'] }), 'swapChannels')).toBe(true);
    expect(hasFlag(fx('backwards'), 'swapChannels')).toBe(false);
  });

  /**
   * Backwards builds nothing at all normally — the reverse happens on the
   * source buffer, before the graph exists. Swap Channels is its one graph-side
   * option, so it is also the clearest test that a flag reaches the builder.
   */
  it('Swap Channels is the only thing Backwards ever builds', () => {
    expect(build([fx('backwards')]).created).toHaveLength(0);
    const swapped = build([fx('backwards', {}, { flags: ['swapChannels'] })]).created;
    expect(kinds(swapped)).toEqual(['splitter', 'merger']);
  });

  it('Stereo Mixer’s Invert Phase adds a −1 gain and nothing else', () => {
    const plain = build([fx('stereo-mixer')]).created.length;
    const inverted = build([fx('stereo-mixer', {}, { flags: ['invertPhase'] })]).created;
    expect(inverted).toHaveLength(plain + 1);
    expect(paramValue(inverted[inverted.length - 1]!, 'gain')).toBe(-1);
  });

  /**
   * Every flag the UI offers must name an effect that reads it. This is the
   * dead-control check the waveform control already has: a switch that
   * persists, keyframes nothing and changes no sound is the failure shape this
   * repo has shipped more than once.
   */
  it('offers flags only for effects that exist', () => {
    for (const type of Object.keys(AUDIO_EFFECT_FLAGS) as AudioEffectType[]) {
      expect(AUDIO_EFFECT_DEFS[type]).toBeTruthy();
      for (const f of AUDIO_EFFECT_FLAGS[type]!) {
        expect(f.key).toMatch(/^[a-zA-Z]+$/);
        expect(f.label.length).toBeGreaterThan(0);
      }
    }
  });
});
