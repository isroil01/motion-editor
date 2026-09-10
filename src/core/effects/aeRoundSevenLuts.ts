/**
 * Effects round seven — the three members that are per-channel transfers.
 *
 *   • CC Color Offset    — each channel rotated through the 0..1 wheel
 *   • CC Threshold RGB   — a per-channel binary threshold
 *   • Cineon Converter   — Kodak log ↔ linear, for DPX and log-encoded footage
 *
 * These live here rather than in `aeRoundSevenColor.ts` because of what they
 * ARE, not where they fit thematically: each maps an input value to an output
 * value one channel at a time, with no reference to the other two and none to
 * the neighbours. That makes them expressible as a 256-entry table, which is
 * the difference between rendering free on both backends with no CPU bake and
 * dragging every layer that carries one through a full rasterization. See the
 * note at the top of `colorLut.ts` — membership in `LUT_BUILDERS` is worth more
 * than it looks, and the test for membership is exactly this shape rule.
 *
 * The tables are Float32 in 0..255, matching every other builder, so the 32-bpc
 * CPU paths can interpolate rather than quantising each tap through Uint8.
 */

import type { ChannelLut } from './colorLut';
import { effectNumber, type Effect } from './effects';

/** 0..1 clamp, local so this module leans on nothing that could cycle back. */
function unit(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function tableFrom(f: (x: number) => number): Float32Array {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = unit(f(i / 255)) * 255;
  return t;
}

// ── CC Color Offset ──────────────────────────────────────────────────────────

/**
 * CC Color Offset — add a phase to each channel and decide what happens past
 * the end of the range.
 *
 * The three overflow modes are the whole effect. Wrap is the psychedelic one
 * (values roll over, so a highlight becomes a shadow); Solarize folds them back
 * like a film solarisation; Polarize simply clips, which is the tame version
 * someone reaches for when they want the shift without the tearing.
 */
export function colorOffsetTables(effect: Effect): ChannelLut {
  const overflow = Math.round(effectNumber(effect, 'overflow'));
  const shift = (phase: number) => (x: number): number => {
    const v = x + (phase / 360);
    if (overflow === 1) {
      // Solarize — a triangle wave: 1.2 comes back as 0.8, 2.2 as 0.2.
      const m = ((v % 2) + 2) % 2;
      return m <= 1 ? m : 2 - m;
    }
    if (overflow === 2) return unit(v);                 // Polarize — clip.
    // Wrap — roll over. The `v > 0` arm is not a nicety: a plain `v % 1` sends
    // an input of exactly 1 (pure white) to 0 (black), so at phase 0 — the
    // DEFAULT, and therefore the state the effect is in the moment it is added
    // — every white pixel in the frame would turn black. An effect that alters
    // the picture before any control is touched reads as a bug in whatever the
    // user was actually doing.
    const frac = v - Math.floor(v);
    return frac === 0 && v > 0 ? 1 : frac;
  };
  return {
    r: tableFrom(shift(effectNumber(effect, 'redPhase'))),
    g: tableFrom(shift(effectNumber(effect, 'greenPhase'))),
    b: tableFrom(shift(effectNumber(effect, 'bluePhase'))),
  };
}

// ── CC Threshold RGB ─────────────────────────────────────────────────────────

/**
 * CC Threshold RGB — each channel independently forced to 0 or 255.
 *
 * Distinct from the `threshold` effect already shipped, which thresholds
 * LUMINANCE and so produces a two-tone image. This one produces eight colours,
 * because the three channels cross their thresholds at different pixels, and
 * that is what makes it a stylize tool rather than a matte tool.
 */
export function thresholdRgbTables(effect: Effect): ChannelLut {
  const cut = (level: number) => (x: number): number => (x * 255 >= level ? 1 : 0);
  return {
    r: tableFrom(cut(effectNumber(effect, 'redLevel'))),
    g: tableFrom(cut(effectNumber(effect, 'greenLevel'))),
    b: tableFrom(cut(effectNumber(effect, 'blueLevel'))),
  };
}

// ── Cineon Converter ─────────────────────────────────────────────────────────

/**
 * Cineon Converter — the Kodak 10-bit log transfer, in both directions.
 *
 * What it is for: DPX and Cineon footage stores density, not light, on a log
 * curve with black at code 95 and white at 685. Grading that footage without
 * linearising it first pushes every tool into the wrong part of its response,
 * which is why this converter exists at all rather than a gamma slider.
 *
 * The 8-bit input is treated as a scaled 10-bit code value, so the black and
 * white point controls read in the units the footage is actually labelled in.
 * `highlightRolloff` compresses the top of the linear result, which is what
 * keeps the extreme highlights a log frame carries from clipping flat the
 * moment they are linearised.
 */
export function cineonConverterTables(effect: Effect): ChannelLut {
  const type = Math.round(effectNumber(effect, 'conversionType'));
  const blackCode = effectNumber(effect, 'tenBitBlackPoint');
  const whiteCode = effectNumber(effect, 'tenBitWhitePoint');
  const internalBlack = effectNumber(effect, 'internalBlackPoint') / 255;
  const internalWhite = effectNumber(effect, 'internalWhitePoint') / 255;
  const gamma = Math.max(0.01, effectNumber(effect, 'gamma'));
  const rolloff = effectNumber(effect, 'highlightRolloff') / 100;

  const codeSpan = Math.max(1, whiteCode - blackCode);
  const internalSpan = internalWhite - internalBlack;

  const logToLin = (x: number): number => {
    // 0..1 → 10-bit code → density → relative exposure.
    const code = x * 1023;
    const density = ((code - blackCode) / codeSpan) * (Math.log10(1 / 0.18) + 1);
    let lin = Math.pow(10, density * gamma - Math.log10(1 / 0.18));
    if (rolloff > 0 && lin > 1) {
      // Compress everything above unity into the remaining headroom instead of
      // letting it clip: a log frame's specular highlights live entirely here.
      lin = 1 + (1 - Math.exp(-(lin - 1) / Math.max(0.0001, rolloff))) * rolloff;
    }
    return internalBlack + lin * internalSpan;
  };

  const linToLog = (x: number): number => {
    const lin = Math.max(0.0001, (x - internalBlack) / Math.max(0.0001, internalSpan));
    const density = (Math.log10(lin) + Math.log10(1 / 0.18)) / gamma;
    const code = blackCode + (density / (Math.log10(1 / 0.18) + 1)) * codeSpan;
    return code / 1023;
  };

  // Log to Log is the identity through the two point pairs — it exists to
  // RE-BASE footage whose black and white codes differ from the standard ones,
  // which is a real ask and is why AE offers the third mode at all.
  const f = type === 1 ? linToLog : type === 2 ? (x: number) => linToLog(logToLin(x)) : logToLin;
  const table = tableFrom(f);
  return { r: table, g: table.slice(), b: table.slice() };
}
