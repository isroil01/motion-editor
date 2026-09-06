/**
 * Playhead auto-follow and edge auto-scroll — the two ways the lanes move
 * without the user touching the scrollbar.
 *
 * Both are pure arithmetic over the lanes' scroll geometry so they can be
 * pinned by tests without a DOM. The component owns the scroller and the
 * timing; this file only says where to scroll to.
 */

export type FollowMode = 'off' | 'page' | 'continuous';

export const FOLLOW_MODES: ReadonlyArray<{ mode: FollowMode; label: string; description: string }> = [
  { mode: 'off', label: 'Off', description: 'The lanes never scroll on their own.' },
  { mode: 'page', label: 'Page', description: 'Jump one screen when the playhead leaves the visible lanes (After Effects).' },
  { mode: 'continuous', label: 'Continuous', description: 'Keep the playhead a third of the way across the lanes while playing.' },
];

export interface FollowInput {
  mode: FollowMode;
  /** The playhead's x in lane CONTENT pixels (left offset already applied). */
  playheadX: number;
  scrollLeft: number;
  viewportWidth: number;
  /** Total scrollable width, so the answer never asks for a scroll the box cannot make. */
  contentWidth: number;
  /** The lanes' left gutter: a page jump parks the playhead this far in. */
  leftOffset?: number;
}

/**
 * Where the lanes should scroll to for this playhead position, or `null` when
 * they should stay put.
 *
 * `page` jumps only when the playhead has LEFT the visible span — while it is
 * in view nothing happens, which is what lets you scrub freely. `continuous`
 * re-targets on every call; the caller decides when that is appropriate (only
 * during playback, or a paused scrub would fight the hand on the ruler).
 */
export function followScrollLeft(input: FollowInput): number | null {
  const { mode, playheadX, scrollLeft, viewportWidth } = input;
  if (mode === 'off' || !(viewportWidth > 0)) return null;
  const maxScroll = Math.max(0, input.contentWidth - viewportWidth);
  const clampScroll = (v: number): number => Math.min(maxScroll, Math.max(0, v));
  const leftOffset = input.leftOffset ?? 0;

  if (mode === 'page') {
    const inView = playheadX >= scrollLeft && playheadX < scrollLeft + viewportWidth;
    if (inView) return null;
    const next = clampScroll(playheadX - leftOffset);
    return Math.abs(next - scrollLeft) < 0.5 ? null : next;
  }

  const next = clampScroll(playheadX - viewportWidth / 3);
  return Math.abs(next - scrollLeft) < 0.5 ? null : next;
}

/** How close to a lane edge the pointer has to be before a drag auto-scrolls. */
export const EDGE_AUTOSCROLL_PX = 24;
/** The fastest an edge scroll runs, in px per animation frame. */
export const EDGE_AUTOSCROLL_MAX_STEP = 20;

/**
 * The signed scroll step for one axis: negative while the pointer is inside
 * the leading edge zone, positive inside the trailing one, zero elsewhere.
 * Ramps from 0 at the zone's inner boundary to `maxStep` at the edge itself,
 * so a pointer hovering just inside the zone creeps rather than races.
 */
export function edgeAutoScrollStep(
  pointer: number,
  start: number,
  end: number,
  threshold = EDGE_AUTOSCROLL_PX,
  maxStep = EDGE_AUTOSCROLL_MAX_STEP,
): number {
  if (!(threshold > 0) || end - start <= threshold * 2) return 0;
  if (pointer < start + threshold) {
    const depth = Math.min(1, Math.max(0, (start + threshold - pointer) / threshold));
    return -Math.ceil(depth * maxStep);
  }
  if (pointer > end - threshold) {
    const depth = Math.min(1, Math.max(0, (pointer - (end - threshold)) / threshold));
    return Math.ceil(depth * maxStep);
  }
  return 0;
}

/**
 * Drives a scroller while a drag hovers near its edges.
 *
 * `update` is called from the drag's pointermove with the latest client point;
 * `onScrolled` fires after every step so the drag can recompute against the
 * new scroll offset (the pointer has not moved, but the content under it has).
 * `stop` on release. Runs on `requestAnimationFrame`, so an idle pointer in
 * the zone keeps scrolling — the whole point of edge scrolling.
 */
export function createEdgeAutoScroller(
  el: HTMLElement,
  onScrolled: () => void,
  opts: { threshold?: number; maxStep?: number; axes?: 'x' | 'y' | 'both' } = {},
): { update(clientX: number, clientY: number): void; stop(): void } {
  const threshold = opts.threshold ?? EDGE_AUTOSCROLL_PX;
  const maxStep = opts.maxStep ?? EDGE_AUTOSCROLL_MAX_STEP;
  const axes = opts.axes ?? 'both';
  let pointer: { x: number; y: number } | null = null;
  let frame: number | null = null;

  const tick = (): void => {
    frame = null;
    if (!pointer) return;
    const rect = el.getBoundingClientRect();
    const dx = axes === 'y' ? 0 : edgeAutoScrollStep(pointer.x, rect.left, rect.right, threshold, maxStep);
    const dy = axes === 'x' ? 0 : edgeAutoScrollStep(pointer.y, rect.top, rect.bottom, threshold, maxStep);
    if (dx === 0 && dy === 0) return;
    const beforeX = el.scrollLeft;
    const beforeY = el.scrollTop;
    if (dx !== 0) el.scrollLeft = Math.max(0, beforeX + dx);
    if (dy !== 0) el.scrollTop = Math.max(0, beforeY + dy);
    if (el.scrollLeft !== beforeX || el.scrollTop !== beforeY) onScrolled();
    schedule();
  };
  const schedule = (): void => {
    if (frame !== null || typeof requestAnimationFrame !== 'function') return;
    frame = requestAnimationFrame(tick);
  };

  return {
    update(clientX, clientY) {
      pointer = { x: clientX, y: clientY };
      schedule();
    },
    stop() {
      pointer = null;
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = null;
    },
  };
}
