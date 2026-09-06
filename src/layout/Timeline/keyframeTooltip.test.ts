import { formatKeyframeLabel, formatValues, keyframeDragLines } from './keyframeTooltip';

describe('keyframe tooltip', () => {
  it('formats a hover label with timecode, frame, value and ease', () => {
    expect(formatKeyframeLabel({ time: 1.1333, fps: 30, values: [320.5, 12], unit: 'px', ease: 'eased in, linear out' }))
      .toBe('00:01:04 · 34f · 320.5, 12 px · eased in, linear out');
  });

  it('omits what it does not know', () => {
    expect(formatKeyframeLabel({ time: 0, fps: 30, values: [] })).toBe('00:00:00 · 0f');
  });

  it('trims trailing zeros but keeps two decimals of real precision', () => {
    expect(formatValues([1.5, 2, 3.14159])).toBe('1.5, 2, 3.14');
  });

  it('drag lines carry the signed frame delta and the value', () => {
    expect(keyframeDragLines({ fromTime: 1, toTime: 1.1, fps: 30, values: [7] })).toEqual([
      '00:01:03  (+3f)',
      '7',
    ]);
    expect(keyframeDragLines({ fromTime: 1, toTime: 0.9, fps: 30, values: [] })).toEqual(['00:00:27  (-3f)']);
  });
});
