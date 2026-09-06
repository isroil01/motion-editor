/**
 * The keyframe lane's arithmetic.
 *
 * The lane is a hundred-odd pixels wide and has to be honest about seconds at
 * that scale, so every one of these is about a boundary: the two ends (which
 * the padding exists to keep drawable), the frame grid a drop must land on,
 * and the one move the lane refuses — dropping a keyframe onto another one,
 * which the engine would silently resolve by destroying one of them.
 */

import {
  laneX,
  laneTime,
  snapToFrame,
  retimeTarget,
  nearestKeyframe,
  type LaneGeometry,
} from './keyframeLane';

const G: LaneGeometry = { width: 108, duration: 10, pad: 4 };
/** The drawable span between the two pads. */
const INNER = G.width - 2 * (G.pad ?? 0);

describe('lane projection', () => {
  it('puts t=0 at the left pad and t=duration at the right pad', () => {
    expect(laneX(0, G)).toBe(4);
    expect(laneX(10, G)).toBe(4 + INNER);
  });

  it('is linear in between', () => {
    expect(laneX(5, G)).toBeCloseTo(4 + INNER / 2, 6);
  });

  it('clamps times outside the composition rather than drawing off-strip', () => {
    expect(laneX(-3, G)).toBe(4);
    expect(laneX(999, G)).toBe(4 + INNER);
  });

  it('round-trips through laneTime', () => {
    for (const t of [0, 0.5, 3.25, 9.99, 10]) {
      expect(laneTime(laneX(t, G), G)).toBeCloseTo(t, 6);
    }
  });

  it('clamps a click past either pad into the composition', () => {
    expect(laneTime(0, G)).toBe(0);
    expect(laneTime(1000, G)).toBe(10);
  });

  it('survives a zero-length composition instead of dividing by it', () => {
    const zero: LaneGeometry = { width: 100, duration: 0 };
    expect(Number.isFinite(laneX(1, zero))).toBe(true);
    expect(laneTime(50, zero)).toBe(0);
  });
});

describe('snapToFrame', () => {
  it('lands on the frame grid', () => {
    expect(snapToFrame(0.51, 30)).toBeCloseTo(15 / 30, 9);
    expect(snapToFrame(1.004, 25)).toBeCloseTo(1, 9);
  });

  it('leaves the time alone when the fps is not usable', () => {
    expect(snapToFrame(1.234, 0)).toBe(1.234);
    expect(snapToFrame(1.234, -30)).toBe(1.234);
  });
});

describe('retimeTarget', () => {
  const times = [1, 2, 5];

  it('snaps the drop to a frame', () => {
    const x = laneX(3.017, G);
    expect(retimeTarget(times, 1, x, G, 30)).toBeCloseTo(snapToFrame(laneTime(x, G), 30), 9);
  });

  it('refuses a drop onto ANOTHER keyframe and leaves the drag where it started', () => {
    // Dragging the keyframe at 1s on top of the one at 2s must not merge them.
    expect(retimeTarget(times, 1, laneX(2, G), G, 30)).toBe(1);
  });

  it('does not treat the dragged keyframe`s own slot as a collision', () => {
    // Dropping it back where it came from is a no-op, not a refusal.
    expect(retimeTarget(times, 2, laneX(2, G), G, 30)).toBeCloseTo(2, 6);
  });

  it('clamps a drag past the end to the composition end', () => {
    expect(retimeTarget(times, 1, 10_000, G, 30)).toBeCloseTo(10, 6);
  });
});

describe('nearestKeyframe', () => {
  const times = [1, 5, 9];

  it('finds the diamond under the pointer', () => {
    expect(nearestKeyframe(times, laneX(5, G), G)).toBe(5);
  });

  it('returns null when the pointer is nowhere near one', () => {
    expect(nearestKeyframe(times, laneX(3, G), G)).toBeNull();
  });

  it('honours the hit radius', () => {
    const x = laneX(5, G) + 4;
    expect(nearestKeyframe(times, x, G, 2)).toBeNull();
    expect(nearestKeyframe(times, x, G, 6)).toBe(5);
  });

  it('has nothing to find on an empty track', () => {
    expect(nearestKeyframe([], laneX(5, G), G)).toBeNull();
  });
});
