/**
 * The marker lane's arithmetic, and the swatches an editor offers.
 *
 * Split out from the component for the usual reason: "where does this chip go"
 * and "what time did the user just drop it on" are the two things that go wrong
 * in a drag, and neither is observable through a React tree without standing
 * one up. Both are pure here.
 *
 * Everything on this axis is COMP SECONDS — the marker lane sits above the
 * ruler and shares its x mapping exactly, `TIMELINE_LEFT_OFFSET + t * pps`, so
 * a marker and the tick it was placed on cannot drift apart at any zoom.
 */

/**
 * The lane's height, px.
 *
 * Tall enough for a 10px pennant plus its label baseline and no taller: this
 * band is added ABOVE the ruler, so every pixel here is a pixel the tracks
 * lose, and the tracks are what the panel is for.
 */
export const MARKER_LANE_HEIGHT = 16;

/** How far, in px, a press may travel before it is a drag rather than a click. */
export const MARKER_DRAG_THRESHOLD_PX = 3;

/** x (px, lane content coords) for a comp time. */
export function markerX(time: number, pps: number, leftOffset: number): number {
  return leftOffset + time * pps;
}

/**
 * Comp time for an x, clamped at 0 and (optionally) snapped to the frame grid.
 *
 * Frame-snapped by DEFAULT, unlike a clip drag: a marker is a bookmark you
 * navigate to with the number keys, and one that sits at 1.0166s answers "go to
 * the marker" with a playhead between two frames.
 */
export function markerTimeAt(
  x: number,
  pps: number,
  leftOffset: number,
  opts: { fps?: number; snap?: boolean; duration?: number } = {},
): number {
  const raw = Math.max(0, (x - leftOffset) / (pps || 1));
  const fps = opts.fps && opts.fps > 0 ? opts.fps : 0;
  const snapped = opts.snap !== false && fps > 0 ? Math.round(raw * fps) / fps : raw;
  const max = opts.duration !== undefined ? Math.max(0, opts.duration) : Infinity;
  return Math.min(snapped, max);
}

/**
 * The palette a marker editor offers.
 *
 * Eight, not a colour picker. A marker's colour is a CATEGORY — "this is a
 * music beat, that is a note for the client" — and categories you can pick 16
 * million of are categories nobody can read back. The values are the domain
 * tokens' own marker ramp, resolved at paint time, so they follow the theme.
 */
export const MARKER_COLORS: ReadonlyArray<{ id: string; label: string; token: string }> = [
  { id: 'blue', label: 'Blue', token: 'var(--color-timeline-marker-blue)' },
  { id: 'purple', label: 'Purple', token: 'var(--color-timeline-marker-purple)' },
  { id: 'green', label: 'Green', token: 'var(--color-timeline-marker-green)' },
  { id: 'yellow', label: 'Yellow', token: 'var(--color-timeline-marker-yellow)' },
  { id: 'orange', label: 'Orange', token: 'var(--color-timeline-marker-orange)' },
  { id: 'red', label: 'Red', token: 'var(--color-timeline-marker-red)' },
  { id: 'cyan', label: 'Cyan', token: 'var(--color-timeline-marker-cyan)' },
  { id: 'grey', label: 'Grey', token: 'var(--color-timeline-marker-grey)' },
];

/** The default a new marker takes — the first swatch, named once. */
export const DEFAULT_MARKER_COLOR = MARKER_COLORS[0]!.token;
