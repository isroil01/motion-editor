import {
  extraColumnEdit,
  extraColumnValue,
  extraColumnsWidth,
  parseExtraColumns,
  toggleExtraColumn,
} from './timelineColumns';

describe('extra column model', () => {
  it('parses persisted lists into canonical order and drops strangers', () => {
    expect(parseExtraColumns(['stretch', 'in', 'bogus', 'in'])).toEqual(['in', 'stretch']);
    expect(parseExtraColumns('nope')).toEqual([]);
  });

  it('toggles keep the canonical order', () => {
    expect(toggleExtraColumn(['out'], 'in')).toEqual(['in', 'out']);
    expect(toggleExtraColumn(['in', 'out'], 'in')).toEqual(['out']);
  });

  it('widths add up per column with the gap and the rule', () => {
    expect(extraColumnsWidth([], 4, 16)).toBe(0);
    expect(extraColumnsWidth(['in', 'stretch'], 4, 16)).toBe(4 + 72 + 16 + 4 + 64 + 16);
  });

  it('shows frames for the time columns and percent for stretch', () => {
    const clip = { start: 1, duration: 2 };
    expect(extraColumnValue('in', clip, 30, 100)).toBe(30);
    expect(extraColumnValue('out', clip, 30, 100)).toBe(90);
    expect(extraColumnValue('duration', clip, 30, 100)).toBe(60);
    expect(extraColumnValue('stretch', clip, 30, 250)).toBe(250);
    expect(extraColumnValue('in', undefined, 30, 100)).toBeNull();
  });

  it('turns a typed frame into a trim on the right edge', () => {
    const clip = { start: 1, duration: 2 };
    expect(extraColumnEdit('in', clip, 45, 30)).toEqual({ edge: 'start', time: 1.5 });
    expect(extraColumnEdit('out', clip, 120, 30)).toEqual({ edge: 'end', time: 4 });
    expect(extraColumnEdit('duration', clip, 15, 30)).toEqual({ edge: 'end', time: 1.5 });
    // A clip cannot be trimmed to nothing.
    expect(extraColumnEdit('in', clip, 90, 30)).toBeNull();
    expect(extraColumnEdit('out', clip, 30, 30)).toBeNull();
    expect(extraColumnEdit('duration', clip, 0, 30)).toBeNull();
  });
});
