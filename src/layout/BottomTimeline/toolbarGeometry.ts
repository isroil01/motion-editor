/**
 * Where the timeline toolbar's two columns sit — pure geometry, so the tests
 * can pin it with numbers.
 *
 * The toolbar is the row between the comp tabs and the tracks. Its LEFT column
 * is the track-header column's width exactly (`resolveTrackHeaderWidth`), and
 * holds every button. Its RIGHT column holds only the time navigator and has
 * to sit over the lanes: same left edge as the ruler's time origin, same right
 * edge as the visible clips. That column is not derived from the header width
 * — the panel's padding, the column resizer's negative margins and the lanes'
 * scrollbar would all have to be re-stated here and kept in step — it is
 * MEASURED: `<Timeline>` publishes the lanes' client-space left edge, client
 * width and any overlay gutter (`timelineViewport`), and the row subtracts its
 * own left edge.
 */

import { TIMELINE_LEFT_OFFSET } from '@layout/Timeline/timelineShared';
import type { TimelineViewportState } from '@layout/Timeline/timelineViewport';

export interface NavigatorColumn {
  /** Px from the toolbar row's left edge to the navigator's. */
  left: number;
  /** The navigator's width, px. */
  width: number;
}

/**
 * The navigator column for a measured lane area, or `null` when there is
 * nothing to align to (no timeline mounted, the graph editor in its place, a
 * collapsed panel) — the row then lets the navigator take what is left.
 *
 * `leftOffset` is the ruler's own gutter (`TIMELINE_LEFT_OFFSET`): time 0 sits
 * that far into the lanes, so the navigator, which maps time 0 to its own left
 * edge, starts there too.
 */
export function navigatorColumnFor(
  lanes: TimelineViewportState,
  rowLeft: number,
  leftOffset: number = TIMELINE_LEFT_OFFSET,
): NavigatorColumn | null {
  if (!(lanes.width > 0)) return null;
  const width = lanes.width - leftOffset - lanes.gutter;
  if (!(width > 0)) return null;
  return { left: lanes.left - rowLeft + leftOffset, width };
}
