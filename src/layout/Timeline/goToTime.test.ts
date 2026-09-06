import { parseGoToTime } from './goToTime';

const ctx = { currentSeconds: 2, fps: 30, durationSeconds: 100 };

describe('parseGoToTime', () => {
  it('reads timecodes of two, three and four fields', () => {
    expect(parseGoToTime('1:04', ctx)).toBe(64);
    expect(parseGoToTime('1:04:15', ctx)).toBe(64.5);
    expect(parseGoToTime('0:01:04:15', ctx)).toBe(64.5);
  });

  it('reads unit suffixes and bare numbers (integer = frames, decimal = seconds)', () => {
    expect(parseGoToTime('320f', ctx)).toBeCloseTo(320 / 30);
    expect(parseGoToTime('2.5s', ctx)).toBe(2.5);
    expect(parseGoToTime('45', ctx)).toBe(1.5);
    expect(parseGoToTime('2.5', ctx)).toBe(2.5);
  });

  it('applies relative offsets to the current time, in frames by default', () => {
    expect(parseGoToTime('+10', ctx)).toBeCloseTo(2 + 10 / 30);
    expect(parseGoToTime('-5', ctx)).toBeCloseTo(2 - 5 / 30);
    expect(parseGoToTime('+1.5s', ctx)).toBe(3.5);
    expect(parseGoToTime('-0:01', ctx)).toBe(1);
  });

  it('subtracts the displayed start offset from absolute timecodes only', () => {
    const offset = { ...ctx, startFrame: 30 };
    expect(parseGoToTime('0:05', offset)).toBe(4);
    expect(parseGoToTime('+0:05', offset)).toBe(7);
    expect(parseGoToTime('150f', offset)).toBe(5);
  });

  it('clamps to the comp and snaps to the frame grid', () => {
    expect(parseGoToTime('-1:00', ctx)).toBe(0);
    expect(parseGoToTime('9:99', ctx)).toBe(100);
    expect(parseGoToTime('2.51s', ctx)).toBeCloseTo(2.5);
  });

  it('refuses text that is not a time', () => {
    expect(parseGoToTime('', ctx)).toBeNull();
    expect(parseGoToTime('abc', ctx)).toBeNull();
    expect(parseGoToTime('1:2:3:4:5', ctx)).toBeNull();
    expect(parseGoToTime('+', ctx)).toBeNull();
  });
});
