import {
  NAV_MIN_WIDTH,
  navigatorHit,
  navigatorWindow,
  panWindow,
  resizeWindow,
  scrollForWindow,
  zoomForWindow,
} from './timeNavigator';

const g = { scrollLeft: 208, viewportWidth: 400, pixelsPerSecond: 100, duration: 10, leftOffset: 8 };

describe('navigatorWindow', () => {
  it('maps the lanes’ visible span onto the bar', () => {
    expect(navigatorWindow(g)).toEqual({ left: 0.2, width: 0.4 });
  });

  it('shows everything when the comp fits, and never overruns the bar', () => {
    expect(navigatorWindow({ ...g, scrollLeft: 0, viewportWidth: 5000 })).toEqual({ left: 0, width: 1 });
    const tail = navigatorWindow({ ...g, scrollLeft: 908 });
    expect(tail.left).toBeCloseTo(0.9);
    expect(tail.width).toBeCloseTo(0.1);
    expect(navigatorWindow({ ...g, duration: 0 })).toEqual({ left: 0, width: 1 });
  });
});

describe('window edits', () => {
  it('pans inside the bar', () => {
    expect(panWindow({ left: 0.2, width: 0.4 }, 0.1)).toEqual({ left: 0.30000000000000004, width: 0.4 });
    expect(panWindow({ left: 0.2, width: 0.4 }, 5)).toEqual({ left: 0.6, width: 0.4 });
    expect(panWindow({ left: 0.2, width: 0.4 }, -5)).toEqual({ left: 0, width: 0.4 });
  });

  it('resizes one end while the other stays put', () => {
    const fromStart = resizeWindow({ left: 0.2, width: 0.4 }, 'start', 0.1);
    expect(fromStart.left).toBeCloseTo(0.3);
    expect(fromStart.width).toBeCloseTo(0.3);
    expect(resizeWindow({ left: 0.2, width: 0.4 }, 'end', 0.1)).toEqual({ left: 0.2, width: 0.5 });
    // Cannot collapse past the minimum or leave the bar.
    expect(resizeWindow({ left: 0.2, width: 0.4 }, 'start', 5).width).toBeCloseTo(NAV_MIN_WIDTH);
    expect(resizeWindow({ left: 0.2, width: 0.4 }, 'end', 5)).toEqual({ left: 0.2, width: 0.8 });
  });
});

describe('window → lanes', () => {
  it('a moved window becomes a scroll at the same zoom', () => {
    expect(scrollForWindow({ left: 0.3, width: 0.4 }, g)).toBe(300);
  });

  it('a resized window becomes a zoom that fills the lanes, plus the matching scroll', () => {
    expect(zoomForWindow({ left: 0.25, width: 0.5 }, g, { min: 4, max: 800 })).toEqual({
      pixelsPerSecond: 80,
      scrollLeft: 200,
    });
    // Clamped zoom → the scroll follows the zoom actually applied.
    expect(zoomForWindow({ left: 0.5, width: 0.001 }, g, { min: 4, max: 800 })).toEqual({
      pixelsPerSecond: 800,
      scrollLeft: 4000,
    });
  });
});

describe('navigatorHit', () => {
  const win = { left: 0.2, width: 0.4 };
  it('tells grips from body from outside', () => {
    expect(navigatorHit(40, win, 200)).toBe('start');
    expect(navigatorHit(120, win, 200)).toBe('end');
    expect(navigatorHit(80, win, 200)).toBe('body');
    expect(navigatorHit(10, win, 200)).toBe('outside');
  });
});
