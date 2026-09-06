/**
 * Where a spoken word sits on the timeline's axis.
 *
 * The one thing that can go wrong here goes wrong invisibly: a word chip drawn
 * from a time that was never mapped through the SAME `leftOffset + t * pps` the
 * ruler uses looks fine at the default zoom and drifts further from the picture
 * the further you zoom in. So the mapping is pure, lives beside the lane rather
 * than inside it, and is tested against the ruler's own arithmetic.
 *
 * Words arrive in COMPOSITION seconds (`TranscriptWord.start/end`), which is
 * already the axis the lanes use — no frame conversion, and deliberately none:
 * a word boundary is a measurement from the transcription model, not an edit
 * point, and rounding it to a frame would make two adjacent words overlap.
 */

import type { TranscriptWord } from '@core/captions/transcriptEdit';

/**
 * The lane's height, px. One 11px chip row plus its padding.
 *
 * Every pixel here is a pixel the tracks lose, which is why the lane is opt-in
 * rather than always present.
 */
export const TRANSCRIPT_LANE_HEIGHT = 20;

/** The narrowest a chip is drawn, so a one-frame word is still clickable. */
export const MIN_WORD_WIDTH_PX = 6;

export interface WordBox {
  id: string;
  text: string;
  /** Lane content x, px. */
  left: number;
  width: number;
  /** The timing was interpolated inside a segment rather than measured. */
  estimated: boolean;
  /** Comp seconds — what a click seeks to. */
  time: number;
}

/**
 * Lay out the words that fall inside a visible time window.
 *
 * The window is applied here rather than by the caller so a two-hour interview
 * costs one pass and a few dozen elements, not forty thousand.
 */
export function layoutWords(
  words: ReadonlyArray<TranscriptWord>,
  opts: { pps: number; leftOffset: number; from: number; to: number },
): WordBox[] {
  const out: WordBox[] = [];
  const pps = opts.pps || 1;
  for (const w of words) {
    if (w.end < opts.from || w.start > opts.to) continue;
    out.push({
      id: w.id,
      text: w.text,
      left: opts.leftOffset + w.start * pps,
      width: Math.max(MIN_WORD_WIDTH_PX, (w.end - w.start) * pps),
      estimated: w.estimated,
      // The START, not the middle: "seek to this word" means "be there when it
      // begins", and a mid-word playhead cuts the first syllable off a preview.
      time: w.start,
    });
  }
  return out;
}

/**
 * The comp-time span a set of selected word ids covers.
 *
 * `null` when nothing is selected, so the caller can hide the action rather
 * than offering "Delete 0.00s".
 */
export function selectedSpan(
  words: ReadonlyArray<TranscriptWord>,
  selected: ReadonlySet<string>,
): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const w of words) {
    if (!selected.has(w.id)) continue;
    if (w.start < start) start = w.start;
    if (w.end > end) end = w.end;
  }
  return end > start ? { start, end } : null;
}
