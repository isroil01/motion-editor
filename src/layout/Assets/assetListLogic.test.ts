import {
  compareAssets,
  filterAssets,
  formatBytes,
  formatDuration,
  isFilterActive,
  matchesQuery,
  parseTags,
  sortAssets,
  tagCounts,
  usageByAsset,
  type SortableAsset,
} from './assetListLogic';
import { nextSort, resetAssetsViewForTest, useAssetsViewStore } from '@stores/assetsViewStore';

const A: SortableAsset[] = [
  { id: 'a', name: 'beach.mp4', type: 'video', size: 3000, tags: ['b-roll', 'outdoor'], importedAt: 300, metadata: { duration: 12 } },
  { id: 'b', name: 'Logo.png', type: 'image', size: 100, tags: ['brand'], label: 'coral', importedAt: 100 },
  { id: 'c', name: 'ambience.wav', type: 'audio', size: 2000, importedAt: 200 },
  { id: 'd', name: 'clip 10.mp4', type: 'video', size: 500, importedAt: 400 },
  { id: 'e', name: 'clip 2.mp4', type: 'video', size: 500, importedAt: 500 },
];

const used = (id: string): number => ({ a: 2, b: 1 }[id] ?? 0);

describe('sorting', () => {
  it('sorts names naturally (clip 2 before clip 10)', () => {
    const ids = sortAssets(A, 'name', 'asc', used).map((x) => x.id);
    expect(ids).toEqual(['c', 'a', 'e', 'd', 'b']);
  });

  it('flips the column only — ties stay in name order both ways', () => {
    // d and e are both 500 bytes; "clip 2" sorts before "clip 10" whichever
    // way the Size column points.
    const asc = sortAssets(A, 'size', 'asc', used).map((x) => x.id);
    const desc = sortAssets(A, 'size', 'desc', used).map((x) => x.id);
    expect(asc).toEqual(['b', 'e', 'd', 'c', 'a']);
    expect(desc).toEqual(['a', 'c', 'e', 'd', 'b']);
  });

  it('groups by type then name', () => {
    expect(sortAssets(A, 'type', 'asc', used).map((x) => x.id)).toEqual(['a', 'e', 'd', 'b', 'c']);
  });

  it('sorts by import date and by usage', () => {
    expect(sortAssets(A, 'date', 'desc', used).map((x) => x.id)).toEqual(['e', 'd', 'a', 'c', 'b']);
    expect(sortAssets(A, 'used', 'desc', used).map((x) => x.id)).toEqual(['a', 'b', 'c', 'e', 'd']);
  });

  it('does not mutate its input', () => {
    const copy = [...A];
    sortAssets(A, 'size', 'desc', used);
    expect(A).toEqual(copy);
    expect(compareAssets(A[0]!, A[0]!, 'name', used)).toBe(0);
  });

  it('nextSort flips the same column and starts numeric columns descending', () => {
    expect(nextSort({ sortKey: 'name', sortDir: 'asc' }, 'name')).toEqual({ sortKey: 'name', sortDir: 'desc' });
    expect(nextSort({ sortKey: 'name', sortDir: 'asc' }, 'size')).toEqual({ sortKey: 'size', sortDir: 'desc' });
    expect(nextSort({ sortKey: 'size', sortDir: 'desc' }, 'type')).toEqual({ sortKey: 'type', sortDir: 'asc' });
  });
});

describe('filtering and search', () => {
  const none = { query: '', unusedOnly: false, type: 'all' as const, tag: null, label: null };

  it('passes everything through with no filter', () => {
    expect(filterAssets(A, none, used)).toHaveLength(5);
    expect(isFilterActive(none)).toBe(false);
  });

  it('filters unused, by type, by tag and by label', () => {
    expect(filterAssets(A, { ...none, unusedOnly: true }, used).map((x) => x.id)).toEqual(['c', 'd', 'e']);
    expect(filterAssets(A, { ...none, type: 'audio' }, used).map((x) => x.id)).toEqual(['c']);
    expect(filterAssets(A, { ...none, tag: 'brand' }, used).map((x) => x.id)).toEqual(['b']);
    expect(filterAssets(A, { ...none, label: 'coral' }, used).map((x) => x.id)).toEqual(['b']);
    expect(isFilterActive({ ...none, tag: 'brand' })).toBe(true);
  });

  it('search matches tags as well as names, case-insensitively', () => {
    expect(filterAssets(A, { ...none, query: 'OUTDOOR' }, used).map((x) => x.id)).toEqual(['a']);
    expect(filterAssets(A, { ...none, query: 'logo' }, used).map((x) => x.id)).toEqual(['b']);
    expect(matchesQuery(A[2]!, 'brand')).toBe(false);
  });

  it('filters compose', () => {
    expect(filterAssets(A, { ...none, type: 'video', unusedOnly: true, query: 'clip' }, used).map((x) => x.id)).toEqual(['d', 'e']);
  });
});

describe('tags', () => {
  it('parses a comma list into unique lower-case tags in typed order', () => {
    expect(parseTags(' Logo, brand ,logo,, B-Roll\nsky ')).toEqual(['logo', 'brand', 'b-roll', 'sky']);
    expect(parseTags('')).toEqual([]);
  });

  it('counts tags across assets', () => {
    expect(tagCounts(A)).toEqual([
      { tag: 'b-roll', count: 1 },
      { tag: 'brand', count: 1 },
      { tag: 'outdoor', count: 1 },
    ]);
  });
});

describe('usage', () => {
  it('maps asset ids to the layers referencing them', () => {
    const nodes = [
      { id: 'n1', asset: 'a' },
      { id: 'n2', asset: 'a' },
      { id: 'n3', asset: null },
      { id: 'n4', asset: 'b' },
    ];
    const map = usageByAsset(nodes, (n) => n.asset);
    expect(map.get('a')).toEqual(['n1', 'n2']);
    expect(map.get('b')).toEqual(['n4']);
    expect(map.has('c')).toBe(false);
  });
});

describe('readouts', () => {
  it('formats bytes and durations', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3 MB');
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(62)).toBe('1:02');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(-1)).toBe('');
  });
});

describe('view store', () => {
  beforeEach(resetAssetsViewForTest);

  it('toggles and persists the view mode', () => {
    expect(useAssetsViewStore.getState().view).toBe('list');
    useAssetsViewStore.getState().toggleView();
    expect(useAssetsViewStore.getState().view).toBe('grid');
    expect(JSON.parse(localStorage.getItem('motion-editor.assetsView.v1') ?? '{}').view).toBe('grid');
  });

  it('sortBy follows nextSort and clearFilters resets every filter', () => {
    const s = useAssetsViewStore.getState();
    s.sortBy('size');
    expect(useAssetsViewStore.getState().sortDir).toBe('desc');
    s.sortBy('size');
    expect(useAssetsViewStore.getState().sortDir).toBe('asc');
    s.setTagFilter('brand');
    s.setUnusedOnly(true);
    s.clearFilters();
    const after = useAssetsViewStore.getState();
    expect(after.tagFilter).toBeNull();
    expect(after.unusedOnly).toBe(false);
  });
});
