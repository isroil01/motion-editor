import { edgeAutoScrollStep, followScrollLeft } from './playheadFollow';

describe('followScrollLeft', () => {
  const base = { scrollLeft: 0, viewportWidth: 400, contentWidth: 2000, leftOffset: 8 };

  it('never scrolls when off', () => {
    expect(followScrollLeft({ ...base, mode: 'off', playheadX: 900 })).toBeNull();
  });

  it('page mode leaves the view alone while the playhead is visible', () => {
    expect(followScrollLeft({ ...base, mode: 'page', playheadX: 250 })).toBeNull();
  });

  it('page mode jumps so the playhead parks at the left gutter once it leaves', () => {
    expect(followScrollLeft({ ...base, mode: 'page', playheadX: 400 })).toBe(392);
    // Seeking backwards out of view jumps the other way too.
    expect(followScrollLeft({ ...base, mode: 'page', scrollLeft: 800, playheadX: 100 })).toBe(92);
  });

  it('continuous mode keeps the playhead a third of the way across', () => {
    expect(followScrollLeft({ ...base, mode: 'continuous', playheadX: 700 })).toBeCloseTo(700 - 400 / 3);
  });

  it('clamps to the scrollable range and reports no-ops as null', () => {
    expect(followScrollLeft({ ...base, mode: 'page', playheadX: 1990 })).toBe(1600);
    expect(followScrollLeft({ ...base, mode: 'continuous', playheadX: 50 })).toBeNull();
    expect(followScrollLeft({ ...base, mode: 'page', viewportWidth: 0, playheadX: 900 })).toBeNull();
  });
});

describe('edgeAutoScrollStep', () => {
  it('is zero away from both edges', () => {
    expect(edgeAutoScrollStep(200, 0, 400)).toBe(0);
  });

  it('ramps negative toward the leading edge and positive toward the trailing one', () => {
    expect(edgeAutoScrollStep(0, 0, 400)).toBe(-20);
    expect(edgeAutoScrollStep(12, 0, 400)).toBe(-10);
    expect(edgeAutoScrollStep(400, 0, 400)).toBe(20);
    expect(edgeAutoScrollStep(388, 0, 400)).toBe(10);
  });

  it('saturates past the edge and stays quiet for a box too small to have zones', () => {
    expect(edgeAutoScrollStep(-500, 0, 400)).toBe(-20);
    expect(edgeAutoScrollStep(10, 0, 40)).toBe(0);
  });
});
