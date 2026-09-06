import { selectionTimeRange } from './fitSelection';
import type { TimelineTrack } from './TimelineModel';

const t = (id: string, clips: Array<[number, number]>, kfs: Array<[string, number]> = []): TimelineTrack => ({
  id: id as never,
  name: id,
  clips: clips.map(([start, duration], i) => ({ id: `${id}_c${i}`, trackId: id as never, nodeId: id as never, start, duration })),
  keyframes: kfs.map(([kid, time]) => ({ id: kid as never, nodeId: id as never, time })),
});

const tracks = [t('a', [[1, 2]], [['k1', 1.5], ['k2', 2.5]]), t('b', [[4, 3]], [['k3', 5]])];

describe('selectionTimeRange', () => {
  it('spans the selected clips', () => {
    expect(selectionTimeRange({ tracks, selectedTrackIds: ['a', 'b'], selectedKeyframeIds: new Set() }))
      .toEqual({ start: 1, end: 7 });
  });

  it('prefers the keyframe selection over the clip selection', () => {
    expect(selectionTimeRange({ tracks, selectedTrackIds: ['a', 'b'], selectedKeyframeIds: new Set(['k1', 'k3']) }))
      .toEqual({ start: 1.5, end: 5 });
  });

  it('pads a single keyframe so the fit is not infinite', () => {
    expect(selectionTimeRange({ tracks, selectedTrackIds: [], selectedKeyframeIds: new Set(['k2']) }))
      .toEqual({ start: 2, end: 3 });
  });

  it('returns null with nothing selected or an unknown selection', () => {
    expect(selectionTimeRange({ tracks, selectedTrackIds: [], selectedKeyframeIds: new Set() })).toBeNull();
    expect(selectionTimeRange({ tracks, selectedTrackIds: ['zzz'], selectedKeyframeIds: new Set(['nope']) })).toBeNull();
  });
});
