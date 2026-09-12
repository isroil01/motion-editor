/**
 * Audio Spectrum — the FFT half.
 *
 * The counterpart to `audioWaveformGen`, and deliberately shaped the same way,
 * because that module already solved the hard part of "an effect that reads
 * another layer's audio":
 *
 *   - PURE analysis here ({@link spectrumBands}) — samples in, band magnitudes
 *     out. No engine, no scene, no clock. Unit-testable without a DOM.
 *   - A RESOLVER ({@link resolveAudioSpectrum}) that looks the referenced audio
 *     layer up, converts comp time to clip-local time honouring the layer's bar,
 *     and calls the pure function. Returns an empty array when the source is
 *     missing or not yet decoded — draw nothing, never throw, never block.
 *
 * ── Why the magnitudes are resolved at SNAPSHOT time ────────────────────────
 *
 * The Canvas2D kernel that draws the bars is handed `(oc, w, h, effect)` and
 * nothing else, and that is worth preserving: it is what keeps every effect a
 * pure function of its params, which in turn is what makes preview and export
 * produce identical pixels and makes the content hash meaningful.
 *
 * So the analysis runs in `buildSnapshot`, where the scene and the engine are
 * both in scope, and the resulting band magnitudes are written INTO the effect's
 * params. The kernel then just draws numbers. The magnitudes changing per frame
 * is also exactly what makes the content hash vary per frame for this layer —
 * the same mechanism Timecode uses for the clock.
 */

import { fftInPlace } from '../../../packages/audio/src/analyse';
import { audioEngine } from './AudioEngine';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { audioComponent, readAudioClipTimings } from './audioScene';

/** Analysis window, in samples. A power of two, as the radix-2 FFT requires. */
export const SPECTRUM_FFT_SIZE = 1024;

/**
 * Band magnitudes (0..1) for one analysis window.
 *
 * ── Logarithmic band edges, not linear ─────────────────────────────────────
 *
 * Pitch is logarithmic and so is the ear. Splitting the spectrum into equal
 * linear slices puts almost every band above 5 kHz — where music has very
 * little energy — and crams the bass, kick and vocal range that people actually
 * want to see into the first bar or two. The classic "why does my spectrum only
 * wiggle on the left" bug, and it is a choice of band edges rather than a
 * rendering problem.
 *
 * A Hann window is applied before the transform. Without it the window's hard
 * edges are themselves a discontinuity, and the transform reports their
 * broadband energy as real signal — a spectrum that never goes quiet.
 */
export function spectrumBands(
  samples: Float32Array,
  sampleRate: number,
  bandCount: number,
  startFreq: number,
  endFreq: number,
): number[] {
  const n = SPECTRUM_FFT_SIZE;
  const bands = Math.max(1, Math.round(bandCount));
  if (samples.length === 0 || sampleRate <= 0) return new Array<number>(bands).fill(0);

  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const take = Math.min(n, samples.length);
  for (let i = 0; i < take; i++) {
    // Hann window.
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    re[i] = samples[i]! * w;
  }
  fftInPlace(re, im);

  // Only the first half of the transform is meaningful for a real input; the
  // rest mirrors it.
  const bins = n / 2;
  const nyquist = sampleRate / 2;
  const lo = Math.max(1, Math.min(nyquist, startFreq));
  const hi = Math.max(lo * 1.01, Math.min(nyquist, endFreq));

  const out: number[] = [];
  for (let b = 0; b < bands; b++) {
    // Log-spaced edges across [lo, hi].
    const f0 = lo * Math.pow(hi / lo, b / bands);
    const f1 = lo * Math.pow(hi / lo, (b + 1) / bands);
    const i0 = Math.max(1, Math.min(bins - 1, Math.floor((f0 / nyquist) * bins)));
    const i1 = Math.max(i0 + 1, Math.min(bins, Math.ceil((f1 / nyquist) * bins)));

    let peak = 0;
    for (let i = i0; i < i1; i++) {
      const mag = Math.hypot(re[i]!, im[i]!);
      if (mag > peak) peak = mag;
    }
    // Peak rather than mean across the band: a mean over a wide high band
    // averages a real transient down into nothing, and the bars stop reacting
    // to exactly the hits people put a spectrum on screen to show.
    //
    // Compressed to dB-ish and normalised. Linear magnitude is unusable on
    // screen — music spans orders of magnitude, so a linear bar chart shows one
    // spike and a flat line.
    const db = 20 * Math.log10(peak + 1e-6);
    const norm = (db + 60) / 60; // −60 dB floor → 0, 0 dB → 1
    out.push(norm < 0 ? 0 : norm > 1 ? 1 : norm);
  }
  return out;
}

/** Config stored on the effect. Mirrors the params in `EFFECT_DEFS`. */
export interface AudioSpectrumRequest {
  sourceLayerId: string;
  bands: number;
  startFreq: number;
  endFreq: number;
  /**
   * How much audio each frame looks at, ms. Longer is steadier and less
   * responsive — the trade every meter makes. Rounded UP to a power of two
   * because that is what the FFT needs; omitted means the previous fixed
   * window, so existing projects analyse exactly as they did.
   */
  durationMs?: number;
  /**
   * Shift WHICH audio, ms. Negative looks ahead, which is how a visualiser is
   * made to land ON the beat rather than a frame behind it — the picture is
   * always one frame of latency later than the sound that caused it.
   */
  offsetMs?: number;
}

/** Test seam, mirroring `__setWaveProviderForTest` in audioWaveformGen. */
let getBuffer: (assetId: string) => AudioBuffer | undefined = (id) => audioEngine.decodedBuffer(id);
export function __setSpectrumBufferProviderForTest(fn?: (assetId: string) => AudioBuffer | undefined): void {
  getBuffer = fn ?? ((id) => audioEngine.decodedBuffer(id));
}

/**
 * Resolve band magnitudes for a config against the live scene at `timeSec`.
 *
 * Always returns an array — all zeroes when the source is missing, unset, or not
 * yet decoded. A silent spectrum is the honest picture of "no audio here"; the
 * alternative is a frame that throws while the user is still choosing a layer.
 */
export function resolveAudioSpectrum(
  cfg: AudioSpectrumRequest,
  timeSec: number,
): number[] {
  const bands = Math.max(1, Math.round(cfg.bands));
  const silent = (): number[] => new Array<number>(bands).fill(0);

  const src = cfg.sourceLayerId ? defaultSceneGraph.getNode(cfg.sourceLayerId) : undefined;
  if (!src) return silent();
  const comp = audioComponent(src);
  const assetId = comp && typeof comp.props.__assetId === 'string' ? comp.props.__assetId : '';
  if (!assetId) return silent();
  const buffer = getBuffer(assetId);
  if (!buffer) return silent();

  // Clip-local time, honouring where the source layer's BAR sits and which part
  // of the source it plays — identical reasoning to resolveAudioWaveformPoints,
  // and the reason a trimmed or moved audio layer analyses the right moment.
  const timings = readAudioClipTimings(cfg.sourceLayerId);
  const at = timings.find((t) => timeSec >= t.startSec && timeSec < t.startSec + (t.outSec - t.inSec)) ?? timings[0];
  // The offset shifts which moment is analysed, before the range check — so
  // looking ahead past the end of the clip reads as silence rather than as the
  // last window held.
  const offsetSec = (cfg.offsetMs ?? 0) / 1000;
  const localT = (at ? at.inSec + (timeSec - at.startSec) : timeSec) + offsetSec;
  if (localT < 0 || localT > buffer.duration) return silent();

  const channel = buffer.getChannelData(0);
  const start = Math.max(0, Math.min(channel.length - 1, Math.floor(localT * buffer.sampleRate)));
  // A power of two at or above the requested duration: the FFT needs one, and
  // rounding UP means the window is never shorter than asked for.
  const wanted = cfg.durationMs !== undefined
    ? Math.max(64, Math.min(16384, 2 ** Math.ceil(Math.log2(Math.max(1, (cfg.durationMs / 1000) * buffer.sampleRate)))))
    : SPECTRUM_FFT_SIZE;
  const window = channel.subarray(start, Math.min(channel.length, start + wanted));
  if (window.length === 0) return silent();

  return spectrumBands(
    window instanceof Float32Array ? window : Float32Array.from(window),
    buffer.sampleRate,
    bands,
    cfg.startFreq,
    cfg.endFreq,
  );
}

// ── Audio Waveform (the EFFECT) ──────────────────────────────────────

/** Config for {@link resolveAudioWaveformSamples}. Mirrors the effect's params. */
export interface AudioWaveformSamplesRequest {
  sourceLayerId: string;
  /** How many points to draw. AE calls it Displayed Samples. */
  count: number;
  /** 0 = Mono (the channels summed), 1 = Left, 2 = Right. */
  channel?: number;
  /** How much audio one frame spans, ms. */
  durationMs?: number;
  /** Shift which audio is read, ms. Negative looks ahead. */
  offsetMs?: number;
}

/**
 * The TIME-DOMAIN samples the Audio Waveform effect draws, as −1..1.
 *
 * This resolver did not exist. `applyAudioWaveform` read a `samples` param
 * documented as "written by buildSnapshot", buildSnapshot never wrote it, and
 * the kernel's own `n < 2` guard then returned early — so the effect could be
 * added, configured and keyframed, and drew nothing, ever. Exactly the
 * "composed but unexecuted" shape the effects module's own comments warn about.
 *
 * Signed, unlike the spectrum's magnitudes: a waveform swings either side of
 * its baseline, and rectifying it here would throw away the half of the shape
 * that makes it look like audio.
 */
export function resolveAudioWaveformSamples(
  cfg: AudioWaveformSamplesRequest,
  timeSec: number,
): number[] {
  const count = Math.max(2, Math.min(4096, Math.round(cfg.count)));
  const silent = (): number[] => [];

  const src = cfg.sourceLayerId ? defaultSceneGraph.getNode(cfg.sourceLayerId) : undefined;
  if (!src) return silent();
  const comp = audioComponent(src);
  const assetId = comp && typeof comp.props.__assetId === 'string' ? comp.props.__assetId : '';
  if (!assetId) return silent();
  const buffer = getBuffer(assetId);
  if (!buffer) return silent();

  // Clip-local time, honouring where the source layer's BAR sits and which part
  // of the source it plays — the same reasoning `resolveAudioSpectrum` uses,
  // and the reason a trimmed or moved audio layer reads the right moment.
  const timings = readAudioClipTimings(cfg.sourceLayerId);
  const at = timings.find((t) => timeSec >= t.startSec && timeSec < t.startSec + (t.outSec - t.inSec)) ?? timings[0];
  const localT = (at ? at.inSec + (timeSec - at.startSec) : timeSec) + (cfg.offsetMs ?? 0) / 1000;
  if (localT < 0 || localT > buffer.duration) return silent();

  const durationSec = Math.max(0.001, (cfg.durationMs ?? 43) / 1000);
  const rate = buffer.sampleRate;
  const start = Math.max(0, Math.floor(localT * rate));
  const span = Math.max(1, Math.round(durationSec * rate));

  const which = Math.round(cfg.channel ?? 0);
  const chans = buffer.numberOfChannels;
  // Left / Right fall back to channel 0 on a mono file rather than returning
  // silence: the file simply has one channel, and that is what it sounds like.
  const a = buffer.getChannelData(which === 2 && chans > 1 ? 1 : 0);
  const b = which === 0 && chans > 1 ? buffer.getChannelData(1) : null;

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    /*
      Each output point is the PEAK over its slice, not a single sample.

      Sampling one value per point aliases badly: at 48 kHz a 43 ms window is
      ~2000 samples, so 128 points would each land on an arbitrary instant of a
      waveform crossing zero hundreds of times, and the trace would flicker
      randomly rather than showing the envelope. Taking the extreme of each
      slice is what every audio editor draws.
    */
    const lo = start + Math.floor((i / count) * span);
    const hi = Math.min(a.length, start + Math.floor(((i + 1) / count) * span));
    let peak = 0;
    for (let j = lo; j < hi; j++) {
      const v = b ? ((a[j] ?? 0) + (b[j] ?? 0)) / 2 : (a[j] ?? 0);
      if (Math.abs(v) > Math.abs(peak)) peak = v;
    }
    out.push(Math.max(-1, Math.min(1, peak)));
  }
  return out;
}
