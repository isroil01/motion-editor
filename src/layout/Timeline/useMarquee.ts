/**
 * Rubber-band keyframe selection on empty lane space — moved whole out of
 * `Timeline.tsx`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clamp } from '@utils/lang';
import { useKeyframeSelectionStore } from '@stores/keyframeSelectionStore';
import {
  combineMarqueeSelection,
  exceedsDragThreshold,
  marqueeHitKeyframeIds,
  normalizeMarqueeRect,
  type MarqueeRect,
  type MarqueeRow,
} from './marqueeSelection';
import styles from './Timeline.module.css';
import { TIMELINE_LEFT_OFFSET, TIMELINE_TOP_PADDING, type Row } from './timelineShared';
import type { MutableRefObject } from 'react';
import type { TimelineEditMode } from './timelineEditMode';

type KeyframeSelection = ReturnType<typeof useKeyframeSelectionStore.getState>;

export interface UseMarqueeArgs {
  rows: ReadonlyArray<Row>;
  lanesRef: MutableRefObject<HTMLDivElement | null>;
  rulerStackHeight: number;
  effectiveLanesHeight: number;
  editMode: TimelineEditMode;
  lanesTimeAt: (clientX: number) => number | null;
  razorAtTime: (time: number, all: boolean, clipId?: string) => void;
  snapRazorTime: (time: number) => number;
  selectedKfIds: KeyframeSelection['ids'];
  setSelectedKfIds: KeyframeSelection['set'];
  pps: number;
  trackHeight: number;
}

export function useMarquee({
  rows,
  lanesRef,
  rulerStackHeight,
  effectiveLanesHeight,
  editMode,
  lanesTimeAt,
  razorAtTime,
  snapRazorTime,
  selectedKfIds,
  setSelectedKfIds,
  pps,
  trackHeight,
}: UseMarqueeArgs) {
  // ── Marquee (rubber-band) keyframe selection ──────────────────
  // Pointer-down on EMPTY lane space (not a keyframe, clip, playhead, marker
  // flag — those either stopPropagation or are guarded below) starts a drag
  // that draws a translucent rect and live-selects every keyframe it touches.
  // Shift at drag START adds to the existing selection; a plain click with no
  // movement clears it. Rows list is the FULL flattened list (not just the
  // virtualized window), so the rect selects across offscreen rows too.
  const marqueeRows = useMemo<ReadonlyArray<MarqueeRow>>(
    () =>
      rows.map((row) =>
        row.type === 'prop'
          ? { keyframes: row.prop.keyframes }
          : // Collapsed summary rows stand in for their property keyframes
          // (track.keyframes is the flat union, same ids); expanded rows
          // defer to the property sub-rows that follow them.
          { keyframes: row.expanded ? [] : (row.track.keyframes ?? []) },
      ),
    [rows],
  );
  const marqueeDrag = useRef<
    null | { x0: number; y0: number; additive: boolean; base: Set<string>; moved: boolean }
  >(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);

  /** Pointer position → lane content coords (x from t=0, y from first row). */
  const lanesPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const lanes = lanesRef.current;
      if (!lanes) return null;
      const rect = lanes.getBoundingClientRect();
      return {
        x: Math.max(0, clientX - rect.left + lanes.scrollLeft - TIMELINE_LEFT_OFFSET),
        y: clamp(clientY - rect.top + lanes.scrollTop - rulerStackHeight - TIMELINE_TOP_PADDING, 0, effectiveLanesHeight),
      };
    },
    // `lanesRef` is stable for the life of the composer; listed so the array is honest.
    [rulerStackHeight, effectiveLanesHeight, lanesRef],
  );

  const onLanesPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // Keyframes, clips and layer markers stopPropagation in their own
      // handlers; the playhead does not, so guard it (and re-guard the others
      // defensively) before claiming the gesture. The comp markers no longer
      // need a guard here at all — the grabbable chip moved up into
      // `<MarkerLane>` and what is left in the lanes is a click-through guide.
      const target = e.target as HTMLElement;
      if (
        target.closest(`.${styles.playhead}`) ||
        target.closest(`.${styles.keyframe}`) ||
        target.closest(`.${styles.clip}`) ||
        target.closest(`.${styles.layerMarker}`)
      ) {
        return;
      }
      // The razor works on the lane BACKGROUND too, which is the only way to
      // reach Shift+click's "cut every track at this frame" at a time where the
      // row under the pointer happens to be empty. A bare click here finds no
      // bar and correctly does nothing.
      if (editMode === 'razor') {
        const raw = lanesTimeAt(e.clientX);
        if (raw !== null) razorAtTime(snapRazorTime(raw), e.shiftKey);
        return;
      }
      const p = lanesPoint(e.clientX, e.clientY);
      if (!p) return;
      marqueeDrag.current = {
        x0: p.x,
        y0: p.y,
        additive: e.shiftKey,
        base: new Set(selectedKfIds),
        moved: false,
      };
      document.body.style.userSelect = 'none';
    },
    [lanesPoint, selectedKfIds, editMode, lanesTimeAt, razorAtTime, snapRazorTime],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const d = marqueeDrag.current;
      if (!d) return;
      const p = lanesPoint(e.clientX, e.clientY);
      if (!p) return;
      if (!d.moved && !exceedsDragThreshold(p.x - d.x0, p.y - d.y0)) return;
      d.moved = true;
      const rect = normalizeMarqueeRect(d.x0, d.y0, p.x, p.y);
      setMarqueeRect(rect);
      const hits = marqueeHitKeyframeIds(marqueeRows, rect, {
        pixelsPerSecond: pps,
        trackHeight,
      });
      setSelectedKfIds(combineMarqueeSelection(d.base, hits, d.additive));
    };
    const onUp = (): void => {
      const d = marqueeDrag.current;
      if (!d) return;
      marqueeDrag.current = null;
      setMarqueeRect(null);
      document.body.style.userSelect = '';
      // Marquee selection was applied live — release just clears the rect.
      // A plain click (no movement) on empty space clears the selection;
      // Shift+click on empty space leaves it untouched.
      if (!d.moved && !d.additive) setSelectedKfIds(new Set());
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (marqueeDrag.current) {
        marqueeDrag.current = null;
        document.body.style.userSelect = '';
      }
    };
  }, [lanesPoint, marqueeRows, pps, trackHeight, setSelectedKfIds]);

  return { marqueeRect, onLanesPointerDown };
}
