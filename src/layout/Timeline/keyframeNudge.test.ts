import { createNudgeBatcher, nudgeForKey } from './keyframeNudge';

describe('nudgeForKey', () => {
  const f = 1 / 30;
  it('arrows step a frame, Shift ten', () => {
    expect(nudgeForKey('ArrowRight', { shift: false, alt: false }, f)).toEqual({ dt: f, dv: 0 });
    expect(nudgeForKey('ArrowLeft', { shift: true, alt: false }, f)).toEqual({ dt: -10 * f, dv: 0 });
  });

  it('Alt turns the vertical arrows into value nudges', () => {
    expect(nudgeForKey('ArrowUp', { shift: false, alt: true }, f)).toEqual({ dt: 0, dv: 1 });
    expect(nudgeForKey('ArrowDown', { shift: true, alt: true }, f)).toEqual({ dt: 0, dv: -10 });
    // Without Alt the vertical arrows belong to row navigation.
    expect(nudgeForKey('ArrowUp', { shift: false, alt: false }, f)).toBeNull();
    // Alt on a horizontal arrow is not a nudge either (it is snap-free drag elsewhere).
    expect(nudgeForKey('ArrowRight', { shift: false, alt: true }, f)).toBeNull();
    expect(nudgeForKey('a', { shift: false, alt: false }, f)).toBeNull();
  });
});

describe('createNudgeBatcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('applies every press but commits a burst once, with the total', () => {
    const begin = jest.fn();
    const apply = jest.fn();
    const commit = jest.fn();
    const b = createNudgeBatcher({ begin, apply, commit }, 300);
    b.push({ dt: 1, dv: 0 });
    jest.advanceTimersByTime(200);
    b.push({ dt: 1, dv: 0 });
    jest.advanceTimersByTime(200);
    const total = b.push({ dt: 0, dv: 2 });
    expect(total).toEqual({ dt: 2, dv: 2 });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(3);
    expect(commit).not.toHaveBeenCalled();
    expect(b.isOpen()).toBe(true);
    jest.advanceTimersByTime(300);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ dt: 2, dv: 2 });
    expect(b.isOpen()).toBe(false);
  });

  it('a pause longer than the window starts a new undo step', () => {
    const commit = jest.fn();
    const b = createNudgeBatcher({ begin: () => {}, apply: () => {}, commit }, 300);
    b.push({ dt: 1, dv: 0 });
    jest.advanceTimersByTime(301);
    b.push({ dt: 1, dv: 0 });
    jest.advanceTimersByTime(301);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('flush commits early and is a no-op when nothing is pending', () => {
    const commit = jest.fn();
    const b = createNudgeBatcher({ begin: () => {}, apply: () => {}, commit }, 300);
    b.flush();
    expect(commit).not.toHaveBeenCalled();
    b.push({ dt: 1, dv: 0 });
    b.flush();
    expect(commit).toHaveBeenCalledWith({ dt: 1, dv: 0 });
    jest.advanceTimersByTime(400);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
