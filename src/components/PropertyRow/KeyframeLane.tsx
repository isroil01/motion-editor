/**
 * KeyframeLane — a thin strip under a property row showing WHERE its
 * keyframes sit across the composition, with the playhead drawn over it.
 *
 * Cheap on purpose:
 *   • the diamonds are an SVG memoised on the keyframe list, so a scrub that
 *     changes no keyframe re-renders nothing here;
 *   • the playhead is moved IMPERATIVELY through a ref from the transient
 *     playback clock (`subscribeTime`) — the component never re-renders on a
 *     time change, which is the one thing that would happen 60×/s.
 *
 * Presentational: times arrive on the COMPOSITION axis and leave on it. The
 * caller converts to each track's own layer time (`compToKeyframeTime`) and
 * owns every write. Click on the strip seeks; drag a diamond to retime (frame
 * snapped, refused onto another keyframe); right-click a diamond for its menu.
 */

import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@utils/cn';
import { laneX, laneTime, retimeTarget, nearestKeyframe, type LaneGeometry } from '@core/inspector/keyframeLane';
import { subscribeTime, getTime } from '@stores/playbackClockStore';
import { useProjectStore } from '@stores/projectStore';
import styles from './KeyframeLane.module.css';

/** ViewBox width — the strip stretches to the row with `preserveAspectRatio="none"`. */
export const LANE_UNITS = 200;
export const LANE_HEIGHT = 10;

export interface KeyframeLaneProps {
  /** Keyframe times on the composition axis, ascending. */
  times: ReadonlyArray<number>;
  /** Composition duration (seconds) and frame rate. */
  duration: number;
  fps: number;
  /** Move the playhead. */
  onSeek: (compTime: number) => void;
  /** Retime one keyframe: both on the composition axis. */
  onRetime?: (fromCompTime: number, toCompTime: number) => void;
  /** Right-click on a diamond. */
  onKeyframeContextMenu?: (e: React.MouseEvent, compTime: number) => void;
  label?: string;
  className?: string;
}

function KeyframeLaneInner({
  times,
  duration,
  fps,
  onSeek,
  onRetime,
  onKeyframeContextMenu,
  label,
  className,
}: KeyframeLaneProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const playheadRef = useRef<SVGLineElement | null>(null);
  const [drag, setDrag] = useState<{ from: number; x: number } | null>(null);
  const activeTab = useProjectStore((s) => s.activeTabId);

  const geometry = useMemo<LaneGeometry>(() => ({ width: LANE_UNITS, duration }), [duration]);

  // Playhead through a ref: the lane never re-renders for a time change.
  useEffect(() => {
    const move = (t: number): void => {
      const x = laneX(t, geometry);
      const el = playheadRef.current;
      if (!el) return;
      el.setAttribute('x1', String(x));
      el.setAttribute('x2', String(x));
    };
    move(getTime(activeTab));
    if (!activeTab) return undefined;
    return subscribeTime(activeTab, move);
  }, [activeTab, geometry]);

  /** Client x → lane units, through the stretched viewBox. */
  const unitsAt = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return ((clientX - rect.left) / rect.width) * LANE_UNITS;
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    const x = unitsAt(e.clientX);
    const hit = onRetime ? nearestKeyframe(times, x, geometry) : null;
    if (hit !== null) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ from: hit, x });
      return;
    }
    onSeek(laneTime(x, geometry));
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!drag) return;
    setDrag({ from: drag.from, x: unitsAt(e.clientX) });
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const to = retimeTarget(times, drag.from, unitsAt(e.clientX), geometry, fps);
    setDrag(null);
    if (Math.abs(to - drag.from) > 1e-9) onRetime?.(drag.from, to);
  };

  const diamonds = useMemo(
    () => times.map((t) => ({ t, x: laneX(t, geometry) })),
    [times, geometry],
  );

  const dragX = drag ? laneX(retimeTarget(times, drag.from, drag.x, geometry, fps), geometry) : null;
  const mid = LANE_HEIGHT / 2;
  const r = 3;

  return (
    <svg
      ref={svgRef}
      className={cn(styles.lane, drag && styles.dragging, className)}
      viewBox={`0 0 ${LANE_UNITS} ${LANE_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label ? `${label} keyframes` : 'Keyframes'}
      data-keyframe-lane
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      <line className={styles.track} x1={0} y1={mid} x2={LANE_UNITS} y2={mid} />
      {diamonds.map((d) => (
        <polygon
          key={d.t}
          className={cn(styles.diamond, drag && drag.from === d.t && styles.diamondGhost)}
          points={`${d.x},${mid - r} ${d.x + r},${mid} ${d.x},${mid + r} ${d.x - r},${mid}`}
          data-keyframe-time={d.t}
          onContextMenu={(e) => {
            if (!onKeyframeContextMenu) return;
            e.preventDefault();
            e.stopPropagation();
            onKeyframeContextMenu(e, d.t);
          }}
        />
      ))}
      {dragX !== null && (
        <polygon
          className={styles.diamondDrag}
          points={`${dragX},${mid - r} ${dragX + r},${mid} ${dragX},${mid + r} ${dragX - r},${mid}`}
        />
      )}
      <line ref={playheadRef} className={styles.playhead} x1={0} y1={0} x2={0} y2={LANE_HEIGHT} />
    </svg>
  );
}

export const KeyframeLane = memo(KeyframeLaneInner);
export default KeyframeLane;
