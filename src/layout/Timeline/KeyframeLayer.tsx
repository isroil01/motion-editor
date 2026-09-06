/**
 * A row's keyframe diamonds — glyph per interpolation, colour per
 * interpolation, the selection ring and the hold tail. Split out of
 * `Timeline.tsx`.
 */

import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@utils/cn';
import { keyframeShapes, keyframePaths, describeShapes, keyframeInterp } from './keyframeShape';
import type { TimelineKeyframeRef } from './TimelineModel';
import { timeInWindow, type TimeWindow } from './visibleWindow';
import { formatKeyframeLabel, keyframeValues } from './keyframeTooltip';
import styles from './Timeline.module.css';
import { TIMELINE_LEFT_OFFSET } from './timelineShared';
import { areRowPropsEqual } from './rowMemo';

export const Keyframes = memo(function Keyframes({
  keyframes,
  pps,
  fps,
  startFrame,
  kfPreview,
  selectedKfIds,
  scaleGripIds,
  window,
  locked,
  onKeyframeDown,
  onKeyframeContextMenu,
}: {
  keyframes: ReadonlyArray<TimelineKeyframeRef>;
  pps: number;
  fps: number;
  startFrame: number;
  /** The shared empty Map unless one of THESE keyframes is being dragged. */
  kfPreview: ReadonlyMap<string, number>;
  selectedKfIds: Set<string>;
  /** Keyframes that are an END of the current multi-selection — the Alt grips. */
  scaleGripIds: Set<string>;
  window: TimeWindow;
  locked: boolean;
  onKeyframeDown: (kf: TimelineKeyframeRef, e: ReactPointerEvent<HTMLDivElement>, locked: boolean) => void;
  onKeyframeContextMenu?: (keyframeId: string, clientX: number, clientY: number) => void;
}): JSX.Element {
  return (
    <>
      {keyframes.map((kf) => {
        const dragging = kfPreview.has(kf.id);
        const time = dragging ? kfPreview.get(kf.id)! : kf.time;
        if (!dragging && !timeInWindow(time, window)) return null;
        const selected = selectedKfIds.has(kf.id);
        // Roving keeps its own full-circle glyph: it is a statement about TIME
        // (this key is auto-positioned for constant speed), not about the
        // interpolation curve, so it must stay distinguishable from auto-bezier.
        const shapes = keyframeShapes(kf.easeIn, kf.easeOut, { isFirst: kf.isFirst, isLast: kf.isLast });
        const paths = keyframePaths(shapes.left, shapes.right);
        const hold = shapes.right === 'hold' && !kf.isLast;
        return (
          <div
            key={kf.id}
            className={cn(
              styles.keyframe,
              dragging && styles.keyframeDragging,
              selected && styles.keyframeSelected,
              kf.roving && styles.keyframeRoving,
              locked && styles.keyframeLocked,
            )}
            // Colour by interpolation (AE): the OUT side names the segment
            // that leaves this key, which is the one the eye follows.
            data-interp={keyframeInterp(shapes, kf.isLast === true)}
            data-hold={hold || undefined}
            style={{ left: `${TIMELINE_LEFT_OFFSET + time * pps}px` }}
            onPointerDown={(e) => onKeyframeDown(kf, e, locked)}
            onContextMenu={(e) => {
              e.preventDefault();
              onKeyframeContextMenu?.(kf.id, e.clientX, e.clientY);
            }}
            // The value is looked up on HOVER, not on render: a title with the
            // value in it would have to be rebuilt for every diamond on every
            // value change. A DOM write on enter costs nothing until then.
            onPointerEnter={(e) => {
              e.currentTarget.title = `${formatKeyframeLabel({
                time,
                fps,
                startFrame,
                values: keyframeValues(kf.id),
                ease: describeShapes(shapes.left, shapes.right),
              })} — drag to move, Shift+click to multi-select, right-click for options${
                scaleGripIds.has(kf.id) ? ', Alt+drag to scale the selection in time' : ''
              }`;
            }}
          >
            {!kf.roving && (
              <svg className={styles.keyframeGlyph} viewBox="0 0 12 12" aria-hidden focusable="false">
                <path d={paths.left} />
                <path d={paths.right} />
              </svg>
            )}
          </div>
        );
      })}
    </>
  );
}, areRowPropsEqual);
