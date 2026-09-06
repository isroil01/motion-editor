/**
 * Horizontal culling — which stretch of the comp is worth rendering.
 *
 * The lanes are as wide as the whole comp so the scrollbar is honest, but
 * ticks, bars and diamonds outside the viewport (plus a screen either side)
 * are never painted. The window is quantised to WHOLE SCREENS so it changes
 * only when the scroll crosses a page boundary — a window that moved by a
 * pixel per scroll event would re-render every row per scroll event, which is
 * the cost this exists to remove.
 */

export interface TimeWindow {
  /** Seconds, inclusive. */
  t0: number;
  /** Seconds, exclusive. */
  t1: number;
}

export const OPEN_WINDOW: TimeWindow = { t0: -Infinity, t1: Infinity };

export interface WindowInput {
  scrollLeft: number;
  viewportWidth: number;
  pixelsPerSecond: number;
  leftOffset: number;
  /** Screens of slack either side. One means "a screen ahead and behind". */
  overscanScreens?: number;
}

/** The visible screen plus overscan, snapped to page boundaries. */
export function pagedTimeWindow(input: WindowInput): TimeWindow {
  const { scrollLeft, viewportWidth, pixelsPerSecond: pps, leftOffset } = input;
  if (!(viewportWidth > 0) || !(pps > 0)) return OPEN_WINDOW;
  const over = input.overscanScreens ?? 1;
  const page = Math.floor(Math.max(0, scrollLeft) / viewportWidth);
  const x0 = (page - over) * viewportWidth;
  const x1 = (page + 1 + over) * viewportWidth;
  return {
    t0: Math.max(0, (x0 - leftOffset) / pps),
    t1: (x1 - leftOffset) / pps,
  };
}

export function sameWindow(a: TimeWindow, b: TimeWindow): boolean {
  return a === b || (a.t0 === b.t0 && a.t1 === b.t1);
}

export function timeInWindow(t: number, w: TimeWindow): boolean {
  return t >= w.t0 && t < w.t1;
}

/** A span overlaps the window (clips, marker spans, transition boxes). */
export function spanInWindow(start: number, end: number, w: TimeWindow): boolean {
  return end > w.t0 && start < w.t1;
}

/** Ticks carry their x in content pixels; cull by the window's pixel span. */
export function cullTicks<T extends { x: number }>(
  ticks: ReadonlyArray<T>,
  w: TimeWindow,
  pixelsPerSecond: number,
  leftOffset: number,
): T[] {
  if (w === OPEN_WINDOW || !Number.isFinite(w.t0) && !Number.isFinite(w.t1)) return ticks.slice();
  const x0 = leftOffset + w.t0 * pixelsPerSecond;
  const x1 = leftOffset + w.t1 * pixelsPerSecond;
  // Half-open like the window itself: a tick AT t1 belongs to the next page.
  return ticks.filter((t) => t.x >= x0 - 1e-6 && t.x < x1 - 1e-6);
}
