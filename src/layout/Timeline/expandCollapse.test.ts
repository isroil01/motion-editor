import {
  collapseAllPlan,
  descendantTrackIds,
  expandAllPlan,
  recursiveTogglePlan,
} from './expandCollapse';
import type { TimelineTrack } from './TimelineModel';

const t = (id: string, depth: number, extra: Partial<TimelineTrack> = {}): TimelineTrack => ({
  id: id as never,
  name: id,
  depth,
  canExpand: true,
  ...extra,
});

// g (group) > a, b (b is a group) > b1 ; then c at the root.
const tracks = [t('g', 0, { isGroup: true }), t('a', 1), t('b', 1, { isGroup: true }), t('b1', 2), t('c', 0), t('static', 0, { canExpand: false })];

describe('descendantTrackIds', () => {
  it('walks the nested rows until the depth comes back up', () => {
    expect(descendantTrackIds(tracks, 'g')).toEqual(['a', 'b', 'b1']);
    expect(descendantTrackIds(tracks, 'b')).toEqual(['b1']);
    expect(descendantTrackIds(tracks, 'c')).toEqual([]);
    expect(descendantTrackIds(tracks, 'zzz')).toEqual([]);
  });
});

describe('expand / collapse plans', () => {
  it('expand-all toggles only the closed, expandable tracks', () => {
    expect(expandAllPlan(tracks, new Set(['a']))).toEqual(['g', 'b', 'b1', 'c']);
  });

  it('collapse-all toggles exactly the open ones', () => {
    expect(collapseAllPlan(tracks, new Set(['a', 'c', 'ghost']))).toEqual(['a', 'c']);
  });

  it('a recursive twirl carries the subtree with it', () => {
    expect(recursiveTogglePlan(tracks, new Set(), 'g')).toEqual({ toggle: ['g', 'a', 'b', 'b1'], open: true });
    expect(recursiveTogglePlan(tracks, new Set(['g', 'b']), 'g')).toEqual({ toggle: ['g', 'b'], open: false });
    // Already-open descendants are left alone on the way open.
    expect(recursiveTogglePlan(tracks, new Set(['a']), 'g')).toEqual({ toggle: ['g', 'b', 'b1'], open: true });
  });
});
