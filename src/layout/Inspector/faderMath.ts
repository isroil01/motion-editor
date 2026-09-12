/**
 * Turning one (level, pan) pair into two channel levels, and back.
 *
 * The Audio panel draws AE's two faders. We store a scalar `audioLevelDb` and a
 * scalar `audioPan`, because both then keyframe and graph-edit through the
 * machinery that already exists (see the panel's header for why that matters).
 * These four functions are the whole bridge between the two representations,
 * pulled out here so the round trip is TESTED rather than assumed — a fader
 * that does not land where you dropped it is the kind of bug you feel and
 * cannot describe.
 *
 * ## The pan law
 *
 * Equal-power, matching `StereoPannerNode` — which is what actually renders the
 * pan, so any other law here would make the fader lie about the output. At
 * centre both channels sit at the layer's level; panned hard, one channel holds
 * that level and the other falls to silence.
 */

/** dBFS at or above which a sample counts as clipped. */
export const CLIP_DB = -0.1;

/** Silence, for a channel panned fully away. Matches `MIN_LEVEL_DB`. */
const SILENT_DB = -60;

/**
 * Pan percent (−100…100) → the equal-power gain of one channel.
 *
 * NORMALISED so that centre is 1.0, not 0.707. The raw `StereoPannerNode` law
 * puts both channels at −3 dB when centred, which is correct as physics and
 * wrong as a readout: a layer set to −6 dB would show −9 dB on both faders, and
 * the panel would appear to disagree with the property it is editing. Dividing
 * by the centre gain re-anchors the pair on the layer's own level, so centre
 * reads −6, and a hard-panned channel reads +3 — which is genuinely what comes
 * out, since hard pan hands that channel unity against centre's 0.707.
 *
 * The range is therefore 0 … √2, not 0 … 1.
 */
export function channelGain(pan: number, ch: 'l' | 'r'): number {
  const p = Math.max(-100, Math.min(100, Number.isFinite(pan) ? pan : 0));
  // StereoPannerNode's law: x maps 0…1 across the sweep, each channel riding a
  // quarter-cycle of cosine/sine.
  const x = (p + 100) / 200;
  const angle = (x * Math.PI) / 2;
  const raw = ch === 'l' ? Math.cos(angle) : Math.sin(angle);
  return raw / Math.SQRT1_2;
}

/** The dB a channel sits at, given the layer's level and pan. */
export function channelDb(levelDb: number, pan: number, ch: 'l' | 'r'): number {
  const g = channelGain(pan, ch);
  if (g <= 0) return SILENT_DB;
  return clampDb(levelDb + 20 * Math.log10(g));
}

/**
 * The inverse: two channel levels back to the (level, pan) pair that produces
 * them.
 *
 * The louder channel sets the level — it is the one at full equal-power gain
 * once the pan is applied — and their RATIO sets the pan. Solved rather than
 * approximated so that `fromChannelDb(channelDb(x), channelDb(x))` returns `x`,
 * which is what stops a fader from drifting when it is nudged repeatedly.
 */
export function fromChannelDb(lDb: number, rDb: number): { levelDb: number; pan: number } {
  const cl = clampDb(lDb);
  const cr = clampDb(rDb);
  // Both channels at the floor is SILENCE, not a pan. Without this the tiny
  // residual amplitudes at −60 dB would go through atan2 and come back as a
  // real pan angle on a layer nobody panned.
  if (cl <= SILENT_DB && cr <= SILENT_DB) return { levelDb: SILENT_DB, pan: 0 };
  const l = Math.pow(10, cl / 20);
  const r = Math.pow(10, cr / 20);

  // atan2 inverts the cos/sin pair straight back to the sweep angle.
  const angle = Math.atan2(r, l);
  const x = angle / (Math.PI / 2);
  const pan = Math.round((x * 200 - 100) * 10) / 10;

  // Undo the pan gain on whichever channel is carrying the signal.
  const g = Math.max(channelGain(pan, 'l'), channelGain(pan, 'r'));
  const louder = Math.max(l, r);
  const levelDb = g > 0 ? clampDb(20 * Math.log10(louder / g)) : SILENT_DB;

  return {
    levelDb: Math.round(levelDb * 10) / 10,
    pan: Math.max(-100, Math.min(100, pan)),
  };
}

function clampDb(db: number): number {
  if (!Number.isFinite(db)) return SILENT_DB;
  // +12 is the UI's ceiling (`MAX_LEVEL_DB`); below the floor everything
  // sounds identical, so there is nothing to gain from letting it run to −∞.
  return Math.max(SILENT_DB, Math.min(12, db));
}
