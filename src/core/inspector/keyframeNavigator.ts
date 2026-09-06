/**
 * Keyframe navigator state and the add/remove-at-playhead edit for ONE node
 * and a set of tracks that animate together — a colour's `_r/_g/_b/_a`, a
 * corner radius's four corners, or simply `[prop]`.
 *
 * `multiSelection.navigatorState` answers the same question for one prop
 * across many nodes (the Transform rows). Every other inspector row — camera,
 * light, effect parameters, layer styles, colours, morph targets — animates
 * one node and had only a stopwatch: you could START a track, and the next
 * keyframe existed only if you changed the value at another time. A hold on
 * the same value, or stepping to the previous/next keyframe, had no control.
 * This is the missing half, in one place, so every row gets ◀ ◆ ▶.
 *
 * Times in and out are on the COMPOSITION axis; each track is converted to
 * its own layer time through `compToKeyframeTime`, the same seam the rows'
 * writes already use.
 */

import { defaultAnimation } from '@motion/animation';
import { runAnimEdit } from '@core/animation/animationCommands';
import { compToKeyframeTime } from '@core/timeline/TimelineController';
import { KEYFRAME_EPS } from './multiSelection';

export interface TrackNavigatorState {
  hasPrev: boolean;
  hasNext: boolean;
  /** The playhead sits on a keyframe of EVERY animated track. */
  atKeyframe: boolean;
  /** Comp-axis time of the nearest previous / next keyframe, or null. */
  prevT: number | null;
  nextT: number | null;
  /** How many of `tracks` currently have a track. */
  animated: number;
}

export function trackNavigatorState(
  nodeId: string,
  tracks: ReadonlyArray<string>,
  compTime: number,
): TrackNavigatorState {
  let hasPrev = false;
  let hasNext = false;
  let animated = 0;
  let atCount = 0;
  let prevT: number | null = null;
  let nextT: number | null = null;
  for (const prop of tracks) {
    if (!defaultAnimation.isAnimated(nodeId, prop)) continue;
    animated += 1;
    const lt = compToKeyframeTime(nodeId, compTime, prop);
    const kfs = defaultAnimation.getTrackKeyframes(nodeId, prop) ?? [];
    if (kfs.some((k) => Math.abs(k.t - lt) < KEYFRAME_EPS)) atCount += 1;
    let prev: number | null = null;
    let next: number | null = null;
    for (const k of kfs) {
      if (k.t < lt - KEYFRAME_EPS) prev = k.t;
      else if (k.t > lt + KEYFRAME_EPS) { next = k.t; break; }
    }
    if (prev !== null) {
      hasPrev = true;
      const t = compTime - (lt - prev);
      if (prevT === null || t > prevT) prevT = t;
    }
    if (next !== null) {
      hasNext = true;
      const t = compTime + (next - lt);
      if (nextT === null || t < nextT) nextT = t;
    }
  }
  return { hasPrev, hasNext, atKeyframe: animated > 0 && atCount === animated, prevT, nextT, animated };
}

/**
 * The ◆ button: on a keyframe → remove it from every animated track; between
 * keyframes → add one on every animated track holding the CURRENT value, so
 * the frame looks exactly as it did (a hold, in AE's terms).
 *
 * `values` is asked only when adding, and only for tracks that are animated;
 * `undefined` for a track falls back to what the track samples at the
 * playhead, which is the same number the row displays.
 */
export function toggleKeyframeAtPlayhead(
  nodeId: string,
  tracks: ReadonlyArray<string>,
  compTime: number,
  label: string,
  values?: () => ReadonlyArray<number | undefined>,
): void {
  const live = tracks.filter((p) => defaultAnimation.isAnimated(nodeId, p));
  if (live.length === 0) return;
  const { atKeyframe } = trackNavigatorState(nodeId, live, compTime);
  if (atKeyframe) {
    runAnimEdit(`Remove ${label} keyframe`, () => defaultAnimation.batch(() => {
      for (const prop of live) {
        const lt = compToKeyframeTime(nodeId, compTime, prop);
        const at = (defaultAnimation.getTrackKeyframes(nodeId, prop) ?? []).find((k) => Math.abs(k.t - lt) < KEYFRAME_EPS);
        if (at) defaultAnimation.removeKeyframe(nodeId, prop, at.t);
      }
    }));
    return;
  }
  const supplied = values?.() ?? [];
  runAnimEdit(`Add ${label} keyframe`, () => defaultAnimation.batch(() => {
    for (const prop of live) {
      const lt = compToKeyframeTime(nodeId, compTime, prop);
      const i = tracks.indexOf(prop);
      const given = i >= 0 ? supplied[i] : undefined;
      const v = typeof given === 'number' && Number.isFinite(given) ? given : defaultAnimation.sample(nodeId, prop, lt);
      if (typeof v === 'number' && Number.isFinite(v)) defaultAnimation.setKeyframe(nodeId, prop, lt, v);
    }
  }));
}
