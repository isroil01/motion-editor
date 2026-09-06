/**
 * The effects browser's flattening rules.
 *
 * The browser is virtualised, so "what is on screen" is an ARRAY, not a tree of
 * mounted accordions — and every question the panel used to answer with JSX
 * nesting (is this folder open, is that folder worth drawing, where does an
 * arrow key land) is now a question about that array.
 */

import {
  flattenFxGroups,
  fxRowHeight,
  folderIdAt,
  stepFxFocus,
  FX_FOLDER_ROW_H,
  FX_LEAF_ROW_H,
  type FxGroup,
} from './EffectsPanelRows';

const def = (type: string, label: string): FxGroup['items'][number] => ({
  kind: 'effect',
  id: type,
  def: { type, label, params: [], css: () => '' } as never,
  gpuTag: null,
});

const GROUPS: FxGroup[] = [
  { id: 'Blur & Sharpen', label: 'Blur & Sharpen', defaultOpen: true, items: [def('blur', 'Gaussian Blur'), def('sharpen', 'Sharpen')] },
  { id: 'Stylize', label: 'Stylize', defaultOpen: false, items: [def('glow', 'Glow')] },
  { id: 'Empty', label: 'Empty', defaultOpen: true, items: [] },
];

describe('flattenFxGroups', () => {
  it('drops empty folders and lists only the open ones’ children', () => {
    const rows = flattenFxGroups(GROUPS, (g) => g.defaultOpen);
    expect(rows.map((r) => r.key)).toEqual([
      'folder:Blur & Sharpen',
      'Blur & Sharpen:blur',
      'Blur & Sharpen:sharpen',
      'folder:Stylize',
    ]);
    // The shut folder still says how much it is hiding.
    const stylize = rows[3];
    expect(stylize).toMatchObject({ kind: 'folder', open: false, count: 1 });
  });

  it('opens everything when the caller says so — what a live search needs', () => {
    const rows = flattenFxGroups(GROUPS, () => true);
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.kind === 'folder')).toHaveLength(2);
  });

  it('keys a leaf by its folder, so the same effect in two folders is two rows', () => {
    const dup: FxGroup[] = [
      { id: 'A', label: 'A', defaultOpen: true, items: [def('glow', 'Glow')] },
      { id: 'B', label: 'B', defaultOpen: true, items: [def('glow', 'Glow')] },
    ];
    const keys = flattenFxGroups(dup, () => true).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('carries the leaf kinds the browser mixes into one list', () => {
    const mixed: FxGroup[] = [
      {
        id: 'Simulation',
        label: 'Simulation',
        defaultOpen: true,
        items: [
          { kind: 'sim', id: 'cloner', label: 'Cloner', icon: 'grid', on: false },
          { kind: 'preset', id: 'Punch', name: 'Punch', effectCount: 2, userSaved: true },
          { kind: 'shapeOp', id: 'trim', opType: 'trim', label: 'Trim Paths', taken: true },
        ],
      },
    ];
    expect(flattenFxGroups(mixed, () => true).map((r) => r.kind)).toEqual([
      'folder', 'sim', 'preset', 'shapeOp',
    ]);
  });
});

describe('row geometry and traversal', () => {
  it('sizes headers taller than leaves', () => {
    const rows = flattenFxGroups(GROUPS, () => true);
    expect(fxRowHeight(rows[0]!)).toBe(FX_FOLDER_ROW_H);
    expect(fxRowHeight(rows[1]!)).toBe(FX_LEAF_ROW_H);
  });

  it('clamps the focus instead of wrapping', () => {
    expect(stepFxFocus(4, 0, -1)).toBe(0);
    expect(stepFxFocus(4, 3, 1)).toBe(3);
    expect(stepFxFocus(4, 1, 1)).toBe(2);
    // An empty list has nowhere to go and must not produce -1.
    expect(stepFxFocus(0, 0, 1)).toBe(0);
  });

  it('names the folder under the cursor, and only a folder', () => {
    const rows = flattenFxGroups(GROUPS, () => true);
    expect(folderIdAt(rows, 0)).toBe('Blur & Sharpen');
    expect(folderIdAt(rows, 1)).toBeNull();
    expect(folderIdAt(rows, 99)).toBeNull();
  });
});
