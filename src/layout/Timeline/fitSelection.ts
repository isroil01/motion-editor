/**
 * "Zoom to selection" — the span the selected keyframes or clips occupy.
 *
 * Keyframes win over clips when both are selected: a keyframe selection is
 * the finer intent, and the clips it sits on are usually much longer than the
 * stretch being edited. A single keyframe (or a set at one time) has no span,
 * so it gets half a second either side rather than an infinite zoom.
 */

import type { TimelineTrack } from './TimelineModel';

export interface SelectionRangeInput {
  tracks: ReadonlyArray<TimelineTrack>;
  selectedTrackIds: ReadonlyArray<string>;
  selectedKeyframeIds: ReadonlySet<string>;
  /** Padding either side of a zero-length keyframe span, seconds. */
  pointPadding?: number;
}

export function selectionTimeRange(input: SelectionRangeInput): { start: number; end: number } | null {
  const pad = input.pointPadding ?? 0.5;
  if (input.selectedKeyframeIds.size > 0) {
    let min = Infinity;
    let max = -Infinity;
    for (const track of input.tracks) {
      for (const kf of track.keyframes ?? []) {
        if (!input.selectedKeyframeIds.has(kf.id)) continue;
        min = Math.min(min, kf.time);
        max = Math.max(max, kf.time);
      }
      for (const prop of track.properties ?? []) {
        for (const kf of prop.keyframes) {
          if (!input.selectedKeyframeIds.has(kf.id)) continue;
          min = Math.min(min, kf.time);
          max = Math.max(max, kf.time);
        }
      }
    }
    if (Number.isFinite(min)) {
      if (max - min < 1e-6) return { start: Math.max(0, min - pad), end: max + pad };
      return { start: min, end: max };
    }
  }
  if (input.selectedTrackIds.length === 0) return null;
  const selected = new Set(input.selectedTrackIds);
  let min = Infinity;
  let max = -Infinity;
  for (const track of input.tracks) {
    if (!selected.has(track.id)) continue;
    for (const clip of track.clips ?? []) {
      min = Math.min(min, clip.start);
      max = Math.max(max, clip.start + clip.duration);
    }
  }
  if (!Number.isFinite(min) || max - min < 1e-6) return null;
  return { start: min, end: max };
}

type FitSource = () => { tracks: ReadonlyArray<TimelineTrack>; selectedTrackIds: ReadonlyArray<string> };

let source: FitSource | null = null;

/**
 * The mounted timeline publishes what it is showing, so the fit command —
 * which runs from a menu or a chord, outside the component — can read the
 * selection's geometry. Returns the unregister; a second timeline (the
 * pop-out) taking over must not be wiped by the first one's cleanup.
 */
export function registerTimelineFitSource(fn: FitSource): () => void {
  source = fn;
  return () => {
    if (source === fn) source = null;
  };
}

export function getTimelineFitSource(): FitSource | null {
  return source;
}
