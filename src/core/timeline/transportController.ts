/**
 * transportController — the transport behaviour the Source Monitor and the
 * comp viewport SHARE: JKL shuttle, K+J / K+L frame stepping, in/out marks
 * and go-to in/out, and audio scrub while the playhead is dragged.
 *
 * ## Why one controller
 *
 * The Source Monitor grew its own JKL (a `shuttle` state and two effects) and
 * the comp viewport had none — so J/K/L meant something in one viewer and
 * nothing in the other, and the one that had it could not be reused because
 * its state lived in a component. Everything here is written against a
 * {@link TransportDriver}: the thing that owns the clock. The Source Monitor's
 * driver is its `<video>`/`<audio>` element plus the exact stepper; the comp's
 * driver is `TimelineController`. The shuttle itself does not know which.
 *
 * ## Forward vs reverse
 *
 * No browser plays a media element at a negative `playbackRate`, and the
 * timeline engine has no rate at all, so the shuttle owns a TIMER: every tick
 * it seeks `time + rate·dt`. A driver that CAN play forward natively (the
 * media element, with audio) says so from `playForward`, and the timer stands
 * down for that direction; otherwise the timer drives both ways. Either way
 * the caller sees one `rate()`.
 *
 * ## Keys
 *
 *   J            reverse; again for 2×, 4×
 *   L            forward; again for 2×, 4×
 *   K            stop
 *   K held + J   step one frame back        (Premiere / AE parity)
 *   K held + L   step one frame forward
 *   I / O        mark in / out at the playhead
 *   Shift+I / O  go to in / out
 *
 * The key STATE (is K held) lives here so both viewers agree on it; the
 * chords themselves are bound by each host — the Source Monitor claims them
 * on its root, the viewport registers commands (see `viewportCommands`).
 */

import { getTimelineController } from './TimelineController';
import { audioEngine, type AudioLayerState } from '@core/audio/AudioEngine';
import { readAudioLayers } from '@core/audio/audioScene';
import { useProjectStore } from '@stores/projectStore';
import { subscribeTime } from '@stores/playbackClockStore';
import { useUIStore } from '@stores/uiStore';

// ── Driver ─────────────────────────────────────────────────────────

export interface TransportDriver {
  /** Playhead, seconds. */
  getTime(): number;
  /** Length, seconds. 0 or less = unknown (the shuttle then never clamps the end). */
  duration(): number;
  /** Frame rate used for stepping. */
  fps(): number;
  seek(seconds: number): void;
  /**
   * Start NATIVE forward playback at `rate` and return true, or return false
   * to let the shuttle's timer drive. Optional: a driver with no native
   * playback (the timeline engine) simply omits it.
   */
  playForward?(rate: number): boolean;
  /** Stop native playback, if any. Always called when the shuttle stops. */
  pause(): void;
}

// ── Shuttle ────────────────────────────────────────────────────────

export interface ShuttleOptions {
  /** Fastest rate, both directions. Default 4. */
  maxRate?: number;
  /** Timer period for timer-driven motion. Default 1000/30. */
  tickMs?: number;
  /** Injectable timers, for tests. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  now?: () => number;
  /** Fired whenever the rate changes (a UI reads it from here, not by polling). */
  onRateChange?: (rate: number) => void;
}

export type ShuttleKey = 'j' | 'k' | 'l';

export interface Shuttle {
  /** −max…max; 0 = stopped; negative = reverse. */
  rate(): number;
  /** True while K is held (the stepping modifier). */
  kHeld(): boolean;
  pressJ(): void;
  pressK(): void;
  pressL(): void;
  /** Key-state entry points — handle the K-hold semantics. */
  keyDown(key: ShuttleKey): void;
  keyUp(key: ShuttleKey): void;
  /** Step by whole frames, stopping any shuttle first. */
  stepFrames(n: number): void;
  stop(): void;
  dispose(): void;
}

export const SHUTTLE_MAX_RATE = 4;
export const SHUTTLE_TICK_MS = 1000 / 30;

export function createShuttle(driver: TransportDriver, opts: ShuttleOptions = {}): Shuttle {
  const max = opts.maxRate ?? SHUTTLE_MAX_RATE;
  const tickMs = opts.tickMs ?? SHUTTLE_TICK_MS;
  const setI = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearI = opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

  let rate = 0;
  let kDown = false;
  /**
   * Whether `driver.playForward` is currently running the media element.
   *
   * Tracked so the timer-driven branch below only pauses a driver that is
   * actually playing. Without it, starting ANY timer-driven shuttle issued a
   * `pause()` the driver had no playback to answer — and on the media driver
   * that is a real DOM call, so a J press paused an already-paused element and
   * the "K stopped it once" contract read as two stops.
   */
  let nativePlaying = false;
  let timer: unknown = null;
  let lastTick = 0;
  let disposed = false;

  const announce = (): void => opts.onRateChange?.(rate);

  const clearTimer = (): void => {
    if (timer !== null) {
      clearI(timer);
      timer = null;
    }
  };

  const tick = (): void => {
    if (rate === 0) return;
    const t = now();
    const dt = Math.max(0, (t - lastTick) / 1000);
    lastTick = t;
    const dur = driver.duration();
    const next = driver.getTime() + rate * dt;
    if (next <= 0) {
      driver.seek(0);
      stop();
      return;
    }
    if (dur > 0 && next >= dur) {
      driver.seek(dur);
      stop();
      return;
    }
    driver.seek(next);
  };

  const apply = (next: number): void => {
    const clamped = Math.max(-max, Math.min(max, next));
    if (clamped === rate) return;
    rate = clamped;
    clearTimer();
    if (rate === 0) {
      // A stop always stops, whichever way the motion was being produced.
      nativePlaying = false;
      driver.pause();
      announce();
      return;
    }
    // Forward: let the driver play natively when it can (audio comes with it).
    if (rate > 0 && driver.playForward?.(rate)) {
      nativePlaying = true;
      announce();
      return;
    }
    // Reverse, or a driver with no native transport: the timer drives. Pause
    // only if native playback was actually running — see `nativePlaying`.
    if (nativePlaying) {
      driver.pause();
      nativePlaying = false;
    }
    lastTick = now();
    timer = setI(tick, tickMs);
    announce();
  };

  function stop(): void {
    apply(0);
  }

  const stepFrames = (n: number): void => {
    apply(0);
    const fps = driver.fps() || 30;
    const dur = driver.duration();
    let t = driver.getTime() + n / fps;
    if (t < 0) t = 0;
    if (dur > 0 && t > dur) t = dur;
    driver.seek(t);
  };

  const pressJ = (): void => {
    if (kDown) { stepFrames(-1); return; }
    apply(rate >= 0 ? -1 : rate * 2);
  };
  const pressL = (): void => {
    if (kDown) { stepFrames(1); return; }
    apply(rate <= 0 ? 1 : rate * 2);
  };
  const pressK = (): void => apply(0);

  return {
    rate: () => rate,
    kHeld: () => kDown,
    pressJ,
    pressK,
    pressL,
    keyDown: (key) => {
      if (disposed) return;
      if (key === 'k') {
        // Repeat while held must not re-fire stop, but the FIRST press does.
        if (!kDown) { kDown = true; pressK(); }
        return;
      }
      if (key === 'j') pressJ();
      else pressL();
    },
    keyUp: (key) => {
      if (key === 'k') kDown = false;
    },
    stepFrames,
    stop,
    dispose: () => {
      disposed = true;
      clearTimer();
      rate = 0;
      kDown = false;
      nativePlaying = false;
    },
  };
}

// ── The comp viewport's driver ─────────────────────────────────────

/** A driver over the active composition's TimelineController. */
export function compositionTransportDriver(): TransportDriver {
  return {
    getTime: () => getTimelineController().currentSeconds,
    duration: () => getTimelineController().durationSeconds,
    fps: () => getTimelineController().fps,
    seek: (t) => getTimelineController().seekSeconds(t),
    pause: () => {
      const c = getTimelineController();
      if (c.isPlaying) c.pause();
    },
  };
}

let compShuttle: Shuttle | null = null;
const rateListeners = new Set<(rate: number) => void>();

/** The one shuttle for the comp viewport (lazy). */
export function getCompositionShuttle(): Shuttle {
  if (!compShuttle) {
    compShuttle = createShuttle(compositionTransportDriver(), {
      onRateChange: (rate) => {
        for (const fn of [...rateListeners]) fn(rate);
      },
    });
  }
  return compShuttle;
}

/** Observe the comp shuttle's rate (for the transport strip's badge). */
export function subscribeCompositionShuttleRate(fn: (rate: number) => void): () => void {
  rateListeners.add(fn);
  return () => {
    rateListeners.delete(fn);
  };
}

/** Test seam: drop the singleton so a fresh driver is built. */
export function __resetCompositionShuttle(): void {
  compShuttle?.dispose();
  compShuttle = null;
  rateListeners.clear();
}

// ── In / Out (work area) on the comp ───────────────────────────────

export function markIn(): void {
  getCompositionShuttle().stop();
  getTimelineController().setWorkAreaIn();
}

export function markOut(): void {
  getCompositionShuttle().stop();
  getTimelineController().setWorkAreaOut();
}

export function goToIn(): boolean {
  const wa = getTimelineController().getWorkArea();
  if (!wa) return false;
  getCompositionShuttle().stop();
  getTimelineController().seekSeconds(wa.start);
  return true;
}

export function goToOut(): boolean {
  const wa = getTimelineController().getWorkArea();
  if (!wa) return false;
  getCompositionShuttle().stop();
  getTimelineController().seekSeconds(wa.end);
  return true;
}

export function clearInOut(): void {
  getTimelineController().clearWorkArea();
}

export function hasInOut(): boolean {
  return getTimelineController().getWorkArea() !== null;
}

/**
 * The three numbers a three-point edit HUD shows for a range: in, out and the
 * duration between them, in seconds. `null` when the range is not usable.
 */
export function threePointSummary(
  inSec: number | null,
  outSec: number | null,
  duration: number,
): { inSec: number; outSec: number; durationSec: number } | null {
  const i = inSec ?? 0;
  const o = outSec ?? (duration > 0 ? duration : null);
  if (o === null) return null;
  if (o <= i) return null;
  return { inSec: i, outSec: o, durationSec: o - i };
}

// ── Audio scrub ────────────────────────────────────────────────────

/**
 * How long a scrub slice sounds, ms. Long enough to be recognisable as the
 * word or the beat under the playhead, short enough that dragging quickly
 * does not smear.
 */
export const SCRUB_SLICE_MS = 70;

/** A private context for scrub slices, so `AudioEngine.sync` cannot cut them. */
let scrubCtx: AudioContext | null = null;
let lastScrubAt = -Infinity;
let scrubEnabled = true;

function scrubContext(): AudioContext | null {
  if (scrubCtx) return scrubCtx;
  const Ctor: typeof AudioContext | undefined =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    scrubCtx = new Ctor();
  } catch {
    scrubCtx = null;
  }
  return scrubCtx;
}

/** Whether playhead drags make sound. Off is silent scrubbing, like AE's default. */
export function setAudioScrubEnabled(on: boolean): void {
  scrubEnabled = on;
}

export function isAudioScrubEnabled(): boolean {
  return scrubEnabled;
}

/**
 * Sound the audio under `timeSec` for one short slice. Pure over `layers`
 * and the engine's decoded buffers; `play` is injectable for tests.
 *
 * Voices are NOT started through `AudioEngine.sync`: `useAudioPlayback`
 * re-syncs with `playing:false` on every playhead change while paused, which
 * would stop a scrub voice the same tick it started. Slices play on a private
 * context instead, from the same decoded buffers.
 */
export function scrubAudioAt(
  timeSec: number,
  layers: readonly AudioLayerState[],
  play: (buffer: AudioBuffer, offsetSec: number, gain: number) => void = playSlice,
): number {
  let voices = 0;
  for (const l of layers) {
    if (l.muted) continue;
    const rate = Math.max(0.01, l.playbackRate ?? 1);
    const localT = timeSec - l.startSec;
    if (localT < 0) continue;
    const buffer = audioEngine.decodedBuffer(l.assetId);
    if (!buffer) continue;
    const outSec = l.outSec > 0 ? l.outSec : buffer.duration;
    const offset = l.inSec + localT * rate;
    if (offset >= outSec || offset >= buffer.duration) continue;
    const gain = Math.pow(10, (l.levelDb ?? 0) / 20);
    play(buffer, offset, gain);
    voices++;
  }
  return voices;
}

function playSlice(buffer: AudioBuffer, offsetSec: number, gain: number): void {
  const ctx = scrubContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(4, gain));
    src.connect(g);
    g.connect(ctx.destination);
    src.start(0, offsetSec, SCRUB_SLICE_MS / 1000);
    src.onended = () => {
      try { src.disconnect(); g.disconnect(); } catch { /* gone */ }
    };
  } catch {
    /* a closed context or an unusable buffer — silence is the right fallback */
  }
}

/**
 * Wire audio scrubbing to playhead DRAGS: while the UI drag flag is up and
 * the transport is not playing, every playhead move sounds a slice. Returns
 * the unsubscribe. One installation per app — the transport strip mounts it.
 */
export function installAudioScrub(): () => void {
  let offTime: (() => void) | null = null;
  let boundTab: string | null = null;

  const bind = (): void => {
    const tab = useProjectStore.getState().activeTabId;
    if (tab === boundTab) return;
    offTime?.();
    boundTab = tab;
    offTime = tab
      ? subscribeTime(tab, (t) => {
          if (!scrubEnabled) return;
          const ui = useUIStore.getState();
          if (!ui.isDragging) return;
          const ps = useProjectStore.getState();
          const rec = ps.tabs[tab];
          if (!rec || rec.playing) return;
          const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          // One slice per slice-length: a 120Hz drag must not stack voices.
          if (nowMs - lastScrubAt < SCRUB_SLICE_MS * 0.8) return;
          lastScrubAt = nowMs;
          scrubAudioAt(t, readAudioLayers(rec.compositionId));
        })
      : null;
  };
  bind();
  const offTab = useProjectStore.subscribe((s, prev) => {
    if (s.activeTabId !== prev.activeTabId) bind();
  });
  return () => {
    offTab();
    offTime?.();
    offTime = null;
    boundTab = null;
  };
}
