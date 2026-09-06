/**
 * HeatLane — the "what changed" tint over clips and keyframes.
 *
 * ## Why this is its own component
 *
 * The same reason `CacheBars` is, and it is worth stating rather than assuming:
 * the answer this draws changes on EVERY edit, and an edit is exactly the moment
 * the timeline is at its busiest. Carrying it in `timelineModel` would mean
 * replacing the model object — the thing the panel's whole memoization story is
 * built on — every time a value scrubbed a pixel. So the lane subscribes itself,
 * recomputes on a timer, and nothing above it re-renders when the answer moves.
 *
 * ## Why it is a timer and not an event
 *
 * The diff walks the comp's bars and the animation snapshot. That is cheap
 * compared with a render, and ruinous at 60Hz during a scrub. {@link REFRESH_HZ}
 * is the same trailing throttle `CacheBars` uses: the first change of a burst
 * schedules one flush and every change until it fires rides along.
 *
 * ## Why the tint is drawn OVER the rows rather than on them
 *
 * A clip bar is memoised by `areRowPropsEqual` precisely so it does not
 * re-render when something it does not depend on changes. Passing a `hot` prop
 * down would defeat that for every bar on every AI run. An overlay in the same
 * absolute coordinate space costs one element per hot bar and touches no row.
 */

import { memo, useEffect, useState } from 'react';
import { EMPTY_HEAT, heatFor, isKeyframeHot, onHeatChange, type HeatDiff } from './changeHeat';
import type { TimelineTrack } from './TimelineModel';
import type { TimelineHeatSource } from '@stores/uiStore';
import { timeInWindow, spanInWindow, type TimeWindow } from './visibleWindow';
import styles from './Timeline.module.css';

/** How often the lane re-diffs while the document is changing. */
export const REFRESH_HZ = 4;

interface HeatLaneProps {
  source: TimelineHeatSource;
  /** The rows, in the same order the lanes lay them out. */
  tracks: ReadonlyArray<TimelineTrack>;
  /** Row index of each track id — the lanes' own map, so the tints line up. */
  trackRowIndex: ReadonlyMap<string, number>;
  pps: number;
  leftOffset: number;
  trackHeight: number;
  topPadding: number;
  /** The stretch of the comp worth painting. */
  window: TimeWindow;
}

function HeatLaneImpl({
  source,
  tracks,
  trackRowIndex,
  pps,
  leftOffset,
  trackHeight,
  topPadding,
  window: timeWindow,
}: HeatLaneProps): JSX.Element | null {
  const [diff, setDiff] = useState<HeatDiff>(EMPTY_HEAT);

  useEffect(() => {
    if (source === 'off') {
      setDiff(EMPTY_HEAT);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sample = (): void => {
      const next = heatFor(source);
      // Bail on an unchanged answer: a burst of scrub events that moves no
      // keyframe past its fingerprint must not re-render the overlay.
      setDiff((prev) => (sameDiff(prev, next) ? prev : next));
    };
    const flush = (): void => {
      timer = null;
      sample();
    };
    const off = onHeatChange(() => {
      if (timer !== null) return;
      timer = setTimeout(flush, 1000 / REFRESH_HZ);
    });
    // A poll as well as the subscription, because most edits do not move a
    // BASELINE — they move the document, which the baseline is diffed against,
    // and nothing announces that to this lane. The subscription only carries
    // the rarer half (a save, an AI run) so the tint updates immediately there.
    const poll = setInterval(sample, 1000 / REFRESH_HZ);
    sample();
    return () => {
      off();
      clearInterval(poll);
      if (timer !== null) clearTimeout(timer);
    };
  }, [source]);

  if (source === 'off' || (diff.clipIds.size === 0 && diff.keys.size === 0)) return null;

  const tints: JSX.Element[] = [];
  for (const track of tracks) {
    const row = trackRowIndex.get(track.id);
    if (row === undefined) continue;
    const top = topPadding + row * trackHeight;
    for (const clip of track.clips ?? []) {
      if (!diff.clipIds.has(clip.id)) continue;
      if (!spanInWindow(clip.start, clip.start + clip.duration, timeWindow)) continue;
      tints.push(
        <div
          key={`heatclip_${clip.id}`}
          className={styles.heatClip}
          style={{
            left: leftOffset + clip.start * pps,
            width: Math.max(2, clip.duration * pps),
            top: top + 3,
            height: trackHeight - 6,
          }}
          aria-hidden
        />,
      );
    }
    // Collapsed rows carry the union of their property keyframes, so a hot
    // diamond is visible without expanding the layer — which is the whole
    // point of a review lane.
    for (const kf of track.keyframes ?? []) {
      if (!isKeyframeHot(diff, kf.id)) continue;
      if (!timeInWindow(kf.time, timeWindow)) continue;
      tints.push(
        <div
          key={`heatkf_${kf.id}`}
          className={styles.heatKeyframe}
          style={{ left: leftOffset + kf.time * pps, top: top + trackHeight / 2 }}
          aria-hidden
        />,
      );
    }
  }

  if (tints.length === 0) return null;
  return <>{tints}</>;
}

function sameDiff(a: HeatDiff, b: HeatDiff): boolean {
  if (a.clipIds.size !== b.clipIds.size || a.keys.size !== b.keys.size) return false;
  for (const id of a.clipIds) if (!b.clipIds.has(id)) return false;
  for (const k of a.keys) if (!b.keys.has(k)) return false;
  return true;
}

export const HeatLane = memo(HeatLaneImpl);
export default HeatLane;
