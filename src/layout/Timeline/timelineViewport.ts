/**
 * The timeline's visible LANE width, published for controls that live outside
 * the panel — and the pure zoom math that uses it.
 *
 * "Fit the comp to the window" needs one number the timeline alone knows: how
 * many pixels wide the lane area actually is, after the user-resizable track
 * header column has taken its share. The zoom control that needs it sits in the
 * app's STATUS BAR, several panels away, and the timeline's host does not pass
 * anything between the two — so the panel drops the measurement here on resize
 * and the control picks it up.
 *
 * Deliberately a module-level micro-store rather than a field on a global UI
 * store: the value changes on every frame of a panel-resize drag, and routing
 * that through a store every subscriber re-renders on would make dragging the
 * timeline divider re-render the whole app.
 */

export interface TimelineViewportState {
  /**
   * Visible width of the lanes in CSS pixels, excluding the track-header
   * column and the vertical scrollbar (`clientWidth`). 0 means "not measured
   * yet" — no timeline is mounted.
   */
  width: number;
  /**
   * The lanes' left edge in CLIENT pixels — where the ruler's x = 0 is on
   * screen. The panel's toolbar row reads it to put the time navigator over
   * the lanes exactly, and subtracts its own left edge. 0 while unmeasured.
   */
  left: number;
  /**
   * Pixels at the lanes' right edge covered by an overlay — the row minimap,
   * when there are more rows than fit — so a control sized to the lanes can
   * stop where the visible clips do. 0 when nothing overlays them.
   */
  gutter: number;
}

type Listener = (state: TimelineViewportState) => void;

const UNMEASURED: TimelineViewportState = { width: 0, left: 0, gutter: 0 };
let state: TimelineViewportState = UNMEASURED;
const listeners = new Set<Listener>();
let scrollFn: ((pixels: number) => void) | null = null;

export function getTimelineViewport(): TimelineViewportState {
  return state;
}

function publish(next: TimelineViewportState): void {
  if (next.width === state.width && next.left === state.left && next.gutter === state.gutter) return;
  state = next;
  for (const fn of listeners) fn(state);
}

/**
 * Called by <Timeline> whenever its lane area is measured. Width alone: the
 * left edge and gutter are left as they were, which is what the callers that
 * only know a width (the fit tests, a width-only publish) want. Width 0 —
 * "no lanes" — clears the rest too, so nothing keeps positioning against a
 * panel that has gone.
 */
export function setTimelineViewportWidth(width: number): void {
  const next = Math.max(0, Math.round(width));
  publish(next === 0 ? UNMEASURED : { ...state, width: next });
}

/** The whole geometry, from the mounted timeline's own measurement. */
export function setTimelineLaneGeometry(geometry: TimelineViewportState): void {
  const width = Math.max(0, Math.round(geometry.width));
  if (width === 0) {
    publish(UNMEASURED);
    return;
  }
  publish({
    width,
    left: Math.round(geometry.left),
    gutter: Math.max(0, Math.round(geometry.gutter)),
  });
}

export function subscribeTimelineViewport(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * <Timeline> registers how to scroll its lanes here, so a fit action can put
 * the region it just zoomed to at the left edge. Returns an unregister.
 *
 * Scrolling is a DOM operation on a scroller the timeline owns; there is no
 * model field for it, and the host only pushes a scroll position INTO the panel
 * when the graph editor is driving it.
 */
export function registerTimelineScroll(fn: (pixels: number) => void): () => boolean {
  scrollFn = fn;
  // The unregister reports whether it was still the ACTIVE registration. A
  // second timeline (the popout window) takes over while the first is still
  // mounted, and React runs the new effect before the old one's cleanup — so a
  // cleanup that blanked state unconditionally would erase the live panel's.
  return () => {
    if (scrollFn !== fn) return false;
    scrollFn = null;
    return true;
  };
}

/** Scroll the mounted timeline's lanes to `pixels`. No-op when none is mounted. */
export function scrollTimelineTo(pixels: number): void {
  scrollFn?.(Math.max(0, pixels));
}

/**
 * Pixels the lanes spend on something other than the span being fitted: the
 * lanes' own left content offset (`TIMELINE_LEFT_OFFSET`) plus a little air, so
 * the fitted region's last frame is not flush against the scrollbar.
 */
export const FIT_PADDING_PX = 24;

export interface FitZoomInput {
  /** The span to fill, in seconds. */
  spanSeconds: number;
  /** Visible lane width in pixels. */
  viewportWidth: number;
  paddingPx?: number;
  minPixelsPerSecond?: number;
  maxPixelsPerSecond?: number;
}

/**
 * The zoom (pixels per second) that makes `spanSeconds` exactly fill the
 * visible lanes. Returns `null` when there is nothing sane to compute — an
 * unmeasured viewport or an empty span — so callers can leave the zoom alone
 * rather than snapping it to a clamp bound.
 */
export function fitPixelsPerSecond(input: FitZoomInput): number | null {
  const padding = input.paddingPx ?? FIT_PADDING_PX;
  const usable = input.viewportWidth - padding;
  if (!(usable > 0) || !(input.spanSeconds > 0)) return null;
  const raw = usable / input.spanSeconds;
  const min = input.minPixelsPerSecond ?? 0;
  const max = input.maxPixelsPerSecond ?? Infinity;
  return Math.min(max, Math.max(min, raw));
}
