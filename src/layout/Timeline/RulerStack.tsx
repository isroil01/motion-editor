/**
 * The strip above the lanes: the frame ruler and the row minimap, plus the
 * tick generator that feeds the ruler. Split out of `Timeline.tsx`; both are
 * memoised because neither depends on the playhead.
 */

import { forwardRef, memo, useCallback, useEffect, useRef, type ForwardedRef, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@utils/cn';
import styles from './Timeline.module.css';
import { TIMELINE_LEFT_OFFSET, TIMELINE_TOP_PADDING, type Row } from './timelineShared';

/** Vertical overview of all rows with a draggable viewport window.
 *
 *  Memoized for the same reason as {@link Ruler}: it draws a strip per row and
 *  none of it depends on the playhead, so it should not be rebuilt by a frame
 *  tick. Its `onScrollTo` is a useCallback at the call site — an inline arrow
 *  there would defeat this wrapper completely.
 *
 *  Forwards its root ref: the minimap overlays the lanes' right edge, and the
 *  timeline measures how much of that edge it covers so the panel's time
 *  navigator can stop where the visible clips do. */
const MinimapImpl = forwardRef(function MinimapImpl({
  rows,
  trackHeight,
  totalHeight,
  viewportTop,
  viewportHeight,
  scrollTop,
  onScrollTo,
}: {
  rows: Row[];
  trackHeight: number;
  totalHeight: number;
  viewportTop: number;
  viewportHeight: number;
  scrollTop: number;
  onScrollTo: (top: number) => void;
}, forwarded: ForwardedRef<HTMLDivElement>): JSX.Element {
  const scale = viewportHeight / totalHeight;
  const winH = viewportHeight * scale;
  const winTop = scrollTop * scale;
  const dragging = useRef(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const setBarRef = useCallback((el: HTMLDivElement | null): void => {
    barRef.current = el;
    if (typeof forwarded === 'function') forwarded(el);
    else if (forwarded) forwarded.current = el;
  }, [forwarded]);

  const scrollFromPointer = useCallback((clientY: number): void => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = clientY - rect.top;
    const top = y / scale - viewportHeight / 2;
    onScrollTo(Math.max(0, Math.min(totalHeight - viewportHeight, top)));
  }, [scale, viewportHeight, totalHeight, onScrollTo]);
  // The window listeners read the LATEST scroller through a ref, so they bind
  // once per mount. This effect had no dependency array at all: it re-bound
  // both listeners on every render of the minimap, i.e. on every scroll.
  const scrollFromPointerRef = useRef(scrollFromPointer);
  scrollFromPointerRef.current = scrollFromPointer;

  useEffect(() => {
    const move = (e: PointerEvent): void => { if (dragging.current) scrollFromPointerRef.current(e.clientY); };
    const up = (): void => { dragging.current = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  return (
    <div
      ref={setBarRef}
      className={styles.minimap}
      style={{ top: viewportTop, height: viewportHeight }}
      onPointerDown={(e) => { dragging.current = true; scrollFromPointer(e.clientY); }}
    >
      {rows.map((row, i) => (
        <div
          key={i}
          className={styles.minimapRow}
          style={{
            top: (TIMELINE_TOP_PADDING + i * trackHeight) * scale,
            height: Math.max(1, trackHeight * scale - 1),
            background: row.type === 'track' ? (row.track.color ?? 'var(--color-text-muted)') : 'var(--color-border-strong)',
            opacity: row.type === 'track' ? 0.7 : 0.4,
          }}
        />
      ))}
      <div className={styles.minimapWindow} style={{ top: winTop, height: winH }} />
    </div>
  );
});

export const Minimap = memo(MinimapImpl);

// ── Subcomponents ───────────────────────────────────────────────

/**
 * The frame ruler.
 *
 * Memoized, and worth it: it emits one absolutely-positioned div per tick over
 * the WHOLE composition, so at a 10-second comp and default zoom it is one of
 * the largest subtrees in the panel — and it does not depend on the playhead at
 * all. Its props are already stable across a frame tick (`ticks` is a useMemo,
 * `onPointerDown` a useCallback, the rest numbers), so without the memo it was
 * rebuilding every one of those nodes on every frame of playback purely because
 * its parent re-rendered to move the playhead.
 */
function RulerImpl({
  ticks,
  height,
  width,
  onPointerDown,
  currentTime = 0,
  duration = 0,
  pixelsPerSecond = 80,
  leftOffset = TIMELINE_LEFT_OFFSET,
}: {
  ticks: { x: number; major: boolean; label: string }[];
  height: number;
  width: number;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  currentTime?: number;
  duration?: number;
  pixelsPerSecond?: number;
  leftOffset?: number;
}): JSX.Element {
  const progressWidth = Math.max(0, Math.min(duration * pixelsPerSecond, currentTime * pixelsPerSecond));
  const trackWidth = duration > 0 ? duration * pixelsPerSecond : width;

  return (
    <div className={styles.ruler} style={{ height, width }} onPointerDown={onPointerDown}>
      {/* Background progress track */}
      <div
        className={styles.rulerProgressTrack}
        style={{ left: leftOffset, width: trackWidth }}
        aria-hidden
      />

      {/* Video progress fill with primary color as video passes */}
      <div
        className={styles.rulerProgressFill}
        style={{ left: leftOffset, width: progressWidth }}
        aria-hidden
      />

      {/* Ruler ticks and timecode labels at the top */}
      {ticks.map((t, i) => (
        <div
          key={i}
          className={cn(styles.tick, t.major && styles.tickMajor)}
          style={{ transform: `translateX(${t.x}px)` }}
        >
          {t.major ? <span className={styles.tickLabel}>{t.label}</span> : null}
        </div>
      ))}
    </div>
  );
}

export const Ruler = memo(RulerImpl);

export function generateRulerTicks(durationSec: number, pps: number, fps: number, startSec = 0, offset = 0): { x: number; major: boolean; label: string }[] {
  const targetPxBetweenMajor = 100;
  const candidateSec = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];
  let majorSec = 1;
  for (const c of candidateSec) {
    if (c * pps >= targetPxBetweenMajor) { majorSec = c; break; }
  }
  const minorSec = majorSec / 5;
  const ticks: { x: number; major: boolean; label: string }[] = [];
  for (let t = 0; t <= durationSec + 1e-6; t += minorSec) {
    const snapped = Math.round(t / minorSec) * minorSec;
    const isMajor = Math.abs((snapped / majorSec) - Math.round(snapped / majorSec)) < 1e-6;
    // The tick's POSITION is 0-based plus left margin offset (pixel layout is the real time domain); its
    // LABEL adds the comp's start offset so the ruler reads the same timecode
    // the playhead readout does.
    ticks.push({ x: offset + snapped * pps, major: isMajor, label: formatTime(snapped + startSec, fps, majorSec) });
  }
  return ticks;
}

function formatTime(sec: number, _fps: number, majorSec: number): string {
  if (majorSec < 1) return `${(sec * 1000).toFixed(0)}ms`;
  if (majorSec < 60) return `${sec.toFixed(majorSec < 1 ? 2 : 0)}s`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(0).padStart(2, '0')}`;
}
