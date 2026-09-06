import {
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_PRESETS,
  rowHeightFromDrag,
} from './rowHeightDrag';

describe('rowHeightFromDrag — the grip on the column seam', () => {
  it('no travel is no change', () => {
    expect(rowHeightFromDrag(36, 0)).toBe(36);
  });

  it('moves half a row pixel per drag pixel, in both directions', () => {
    expect(rowHeightFromDrag(36, 20)).toBe(46);
    expect(rowHeightFromDrag(36, -16)).toBe(28);
  });

  it('rounds to a whole pixel so lane borders stay crisp', () => {
    expect(Number.isInteger(rowHeightFromDrag(36, 1))).toBe(true);
    expect(rowHeightFromDrag(36, 3)).toBe(38); // 37.5 → 38
  });

  it('clamps to the grip bounds no matter how far the pointer goes', () => {
    expect(rowHeightFromDrag(36, 10_000)).toBe(ROW_HEIGHT_MAX);
    expect(rowHeightFromDrag(36, -10_000)).toBe(ROW_HEIGHT_MIN);
  });

  it('honours custom bounds and rate', () => {
    expect(rowHeightFromDrag(30, 100, { min: 10, max: 40 })).toBe(40);
    expect(rowHeightFromDrag(30, 10, { rate: 1 })).toBe(40);
  });

  it('every preset lies inside the drag range — the cycle button never leaves the grip stranded', () => {
    for (const p of ROW_HEIGHT_PRESETS) {
      expect(p).toBeGreaterThanOrEqual(ROW_HEIGHT_MIN);
      expect(p).toBeLessThanOrEqual(ROW_HEIGHT_MAX);
      // A preset dragged by zero stays that preset.
      expect(rowHeightFromDrag(p, 0)).toBe(p);
    }
  });
});
