/**
 * Which category heading should stay pinned while you scroll inside a layer.
 *
 * Expand a layer with forty effect parameters and the "Effects" heading scrolls
 * away in the first flick. What is left is forty rows called things like
 * "Radius" and "Amount" with no statement of what they belong to — which is the
 * exact question the heading answered.
 *
 * The rows are ABSOLUTELY POSITIONED in a virtualized list, so `position:
 * sticky` cannot do this: sticky needs the element to be in flow inside a
 * scrolling ancestor, and a virtualized row is neither (it is also unmounted
 * the moment it leaves the window, which is precisely when it would need to
 * stick). The answer is to render ONE extra copy, pinned, and to compute which
 * heading it shows — which is what this does.
 *
 * ## The push-off
 *
 * When the NEXT heading arrives, the pinned one does not swap instantly: it is
 * pushed up out of the way by the incoming row, the way a real sticky header
 * behaves. `offset` is how far up (0 or negative). Without it the label swaps
 * in place, which reads as a glitch rather than as a transition.
 */

/** The minimum this module needs to know about a row. */
export interface StickyRow {
  type: 'track' | 'category' | 'prop';
  /** Only set for `category` rows. */
  categoryKey?: string;
}

export interface StickyCategory {
  /** Index into the flattened row list of the heading to pin. */
  index: number;
  /** Pixels to shift it up while the next section pushes it off. 0 or negative. */
  offset: number;
}

/**
 * The heading to pin for a given scroll position, or null.
 *
 * `scrollTop` is measured from the top of the row list (i.e. the caller has
 * already subtracted its top padding). `rowHeight` is uniform, which the
 * timeline guarantees — every row in this list is `trackHeight` tall.
 *
 * Returns null when the first visible row is not INSIDE a section: a heading
 * pinned above the layer it belongs to would be a label for rows that are not
 * on screen, which is worse than no label.
 */
export function stickyCategoryFor(
  rows: ReadonlyArray<StickyRow>,
  scrollTop: number,
  rowHeight: number,
): StickyCategory | null {
  if (rowHeight <= 0 || rows.length === 0) return null;
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  if (first >= rows.length) return null;

  // Walk back for the heading this row sits under. A `track` row ends the
  // search: it starts a NEW layer, so anything above it belongs to another one.
  let headingIndex = -1;
  for (let i = first; i >= 0; i--) {
    const row = rows[i]!;
    if (row.type === 'category') {
      headingIndex = i;
      break;
    }
    if (row.type === 'track' && i !== first) return null;
    if (row.type === 'track' && i === first) return null;
  }
  if (headingIndex < 0) return null;
  // The heading is fully in view on its own — nothing to pin.
  if (headingIndex === first && scrollTop <= headingIndex * rowHeight) return null;

  // The next section boundary pushes this one off as it arrives.
  let nextBoundary = -1;
  for (let i = headingIndex + 1; i < rows.length; i++) {
    if (rows[i]!.type === 'category' || rows[i]!.type === 'track') {
      nextBoundary = i;
      break;
    }
  }
  let offset = 0;
  if (nextBoundary >= 0) {
    const distance = nextBoundary * rowHeight - scrollTop;
    if (distance < rowHeight) offset = Math.min(0, distance - rowHeight);
  }
  return { index: headingIndex, offset };
}
