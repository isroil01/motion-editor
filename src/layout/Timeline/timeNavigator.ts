/**
 * The time navigator's window — the Premiere/Resolve overview bar with a
 * draggable, resizable box over the part of the comp the lanes show.
 *
 * Everything is in FRACTIONS of the comp's duration (0..1), which is what the
 * bar draws in; the conversions to the lanes' scroll/zoom live here too so the
 * bar and the lanes cannot disagree about where a fraction lands.
 */

export interface NavWindow {
  /** 0..1, where the visible span starts. */
  left: number;
  /** 0..1, how much of the comp is visible. */
  width: number;
}

/** The narrowest the window may get — a 2% box is still grabbable. */
export const NAV_MIN_WIDTH = 0.02;

export interface NavigatorGeometry {
  scrollLeft: number;
  viewportWidth: number;
  pixelsPerSecond: number;
  duration: number;
  leftOffset: number;
}

/** What the lanes currently show, as a window over the comp. */
export function navigatorWindow(g: NavigatorGeometry): NavWindow {
  if (!(g.duration > 0) || !(g.pixelsPerSecond > 0)) return { left: 0, width: 1 };
  const startSec = Math.max(0, (g.scrollLeft - g.leftOffset) / g.pixelsPerSecond);
  const spanSec = g.viewportWidth > 0 ? g.viewportWidth / g.pixelsPerSecond : g.duration;
  const left = Math.min(1, startSec / g.duration);
  const width = Math.max(NAV_MIN_WIDTH, Math.min(1 - left, spanSec / g.duration));
  return { left, width };
}

/** Slide the window by `dx` (a fraction), keeping it inside the bar. */
export function panWindow(win: NavWindow, dx: number): NavWindow {
  const left = Math.min(1 - win.width, Math.max(0, win.left + dx));
  return { left, width: win.width };
}

/** Drag one end of the window; the other end stays put. */
export function resizeWindow(win: NavWindow, edge: 'start' | 'end', dx: number): NavWindow {
  if (edge === 'start') {
    const right = win.left + win.width;
    const left = Math.min(right - NAV_MIN_WIDTH, Math.max(0, win.left + dx));
    return { left, width: right - left };
  }
  const width = Math.min(1 - win.left, Math.max(NAV_MIN_WIDTH, win.width + dx));
  return { left: win.left, width };
}

/**
 * The lanes' scroll for a window that only MOVED (same zoom).
 * Time t sits at content x = leftOffset + t·pps; putting it at the left edge
 * means scrolling to t·pps, the same gutter time 0 gets at scroll 0.
 */
export function scrollForWindow(win: NavWindow, g: Pick<NavigatorGeometry, 'duration' | 'pixelsPerSecond'>): number {
  return Math.max(0, win.left * g.duration * g.pixelsPerSecond);
}

/**
 * The zoom + scroll that make a RESIZED window fill the lanes exactly.
 * Clamped to the timeline's zoom range, so the scroll is computed from the
 * zoom actually applied — the window may end up wider than asked.
 */
export function zoomForWindow(
  win: NavWindow,
  g: Pick<NavigatorGeometry, 'duration' | 'viewportWidth'>,
  limits: { min: number; max: number },
): { pixelsPerSecond: number; scrollLeft: number } {
  const spanSec = Math.max(1e-6, win.width * g.duration);
  const raw = g.viewportWidth > 0 ? g.viewportWidth / spanSec : limits.min;
  const pps = Math.min(limits.max, Math.max(limits.min, raw));
  return { pixelsPerSecond: pps, scrollLeft: Math.max(0, win.left * g.duration * pps) };
}

/** Which part of the window a pointer landed on, in bar pixels. */
export function navigatorHit(
  x: number,
  win: NavWindow,
  barWidth: number,
  gripPx = 6,
): 'start' | 'end' | 'body' | 'outside' {
  const l = win.left * barWidth;
  const r = (win.left + win.width) * barWidth;
  if (Math.abs(x - l) <= gripPx) return 'start';
  if (Math.abs(x - r) <= gripPx) return 'end';
  if (x > l && x < r) return 'body';
  return 'outside';
}
