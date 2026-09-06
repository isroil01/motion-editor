import { OPEN_WINDOW, cullTicks, pagedTimeWindow, sameWindow, spanInWindow, timeInWindow } from './visibleWindow';

describe('pagedTimeWindow', () => {
  const g = { viewportWidth: 400, pixelsPerSecond: 100, leftOffset: 8 };

  it('covers the visible screen plus one either side', () => {
    const w = pagedTimeWindow({ ...g, scrollLeft: 0 });
    expect(w.t0).toBe(0);
    expect(w.t1).toBeCloseTo((800 - 8) / 100);
  });

  it('only changes when the scroll crosses a page boundary', () => {
    const a = pagedTimeWindow({ ...g, scrollLeft: 410 });
    const b = pagedTimeWindow({ ...g, scrollLeft: 790 });
    const c = pagedTimeWindow({ ...g, scrollLeft: 800 });
    expect(sameWindow(a, b)).toBe(true);
    expect(sameWindow(b, c)).toBe(false);
    expect(a.t0).toBeCloseTo(0);
    expect(c.t0).toBeCloseTo((400 - 8) / 100);
  });

  it('is open before the panel is measured', () => {
    expect(pagedTimeWindow({ ...g, viewportWidth: 0, scrollLeft: 0 })).toBe(OPEN_WINDOW);
  });
});

describe('membership', () => {
  const w = { t0: 1, t1: 3 };
  it('points and spans', () => {
    expect(timeInWindow(1, w)).toBe(true);
    expect(timeInWindow(3, w)).toBe(false);
    expect(spanInWindow(0, 1.5, w)).toBe(true);
    expect(spanInWindow(0, 1, w)).toBe(false);
    expect(spanInWindow(2.5, 9, w)).toBe(true);
    expect(spanInWindow(3, 9, w)).toBe(false);
  });

  it('culls ticks by their content x', () => {
    const ticks = [0, 108, 208, 308, 408].map((x) => ({ x }));
    expect(cullTicks(ticks, w, 100, 8).map((t) => t.x)).toEqual([108, 208]);
    expect(cullTicks(ticks, OPEN_WINDOW, 100, 8)).toHaveLength(5);
  });
});
