/**
 * Which category heading stays pinned while you scroll inside a layer.
 *
 * The two ways this goes wrong are both silent: pinning a heading for rows that
 * are NOT on screen (a label describing something else), and never handing over
 * to the next section (a heading that outstays the rows it names). Both are one
 * comparison away from correct and neither shows up in a screenshot of a
 * stationary panel.
 */

import { stickyCategoryFor, type StickyRow } from './stickyCategory';

const H = 20;

/** track · category · prop · prop · category · prop */
const ROWS: StickyRow[] = [
  { type: 'track' },
  { type: 'category', categoryKey: 'transform' },
  { type: 'prop' },
  { type: 'prop' },
  { type: 'category', categoryKey: 'effects' },
  { type: 'prop' },
];

describe('stickyCategoryFor', () => {
  it('pins nothing while the track row itself is at the top', () => {
    expect(stickyCategoryFor(ROWS, 0, H)).toBeNull();
  });

  it('pins the heading once its own rows are what is at the top', () => {
    // Scrolled so a `prop` row is first — the heading it belongs to has gone.
    expect(stickyCategoryFor(ROWS, 2 * H, H)?.index).toBe(1);
    expect(stickyCategoryFor(ROWS, 3 * H, H)?.index).toBe(1);
  });

  it('hands over to the next section', () => {
    expect(stickyCategoryFor(ROWS, 5 * H, H)?.index).toBe(4);
  });

  it('pushes the outgoing heading up as the next one arrives', () => {
    // Two-thirds of a row before the boundary at index 4: the pinned heading
    // is a third of a row up rather than swapping in place, which is what
    // makes it read as a transition instead of a glitch.
    const found = stickyCategoryFor(ROWS, 4 * H - Math.round(H / 3), H);
    expect(found?.index).toBe(1);
    expect(found!.offset).toBeLessThan(0);
    expect(found!.offset).toBeGreaterThanOrEqual(-H);
  });

  it('never pins across a track boundary', () => {
    const rows: StickyRow[] = [
      { type: 'category', categoryKey: 'transform' },
      { type: 'prop' },
      { type: 'track' },
      { type: 'prop' },
    ];
    // Row 3 belongs to the SECOND track; the heading above it is another
    // layer's, and pinning it would label rows it has nothing to do with.
    expect(stickyCategoryFor(rows, 3 * H, H)).toBeNull();
  });

  it('is defensive about degenerate input rather than dividing by zero', () => {
    expect(stickyCategoryFor([], 100, H)).toBeNull();
    expect(stickyCategoryFor(ROWS, 100, 0)).toBeNull();
    expect(stickyCategoryFor(ROWS, -50, H)).toBeNull();
    expect(stickyCategoryFor(ROWS, 9999, H)).toBeNull();
  });
});
