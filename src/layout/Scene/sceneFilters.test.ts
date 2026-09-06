import type { TreeNode } from '@components/TreeView';
import type { SceneKind } from '@core/scene/seedDefaultScene';
import {
  EMPTY_SCENE_FILTER,
  filterSceneTree,
  isSceneFilterActive,
  nodeMatches,
  toggleKind,
  type SceneFilter,
  type SceneNodeFacts,
} from './sceneFilters';

const FACTS: Record<string, SceneNodeFacts> = {
  comp: { kind: 'comp', label: undefined, animated: false, hasEffects: false, name: 'Main' },
  titles: { kind: 'group', label: 'coral', animated: false, hasEffects: false, name: 'Titles' },
  t1: { kind: 'text', label: undefined, animated: true, hasEffects: false, name: 'Headline' },
  t2: { kind: 'text', label: 'coral', animated: false, hasEffects: true, name: 'Sub' },
  cam: { kind: 'camera', label: undefined, animated: true, hasEffects: false, name: 'Camera 1' },
  bg: { kind: 'image', label: 'teal', animated: false, hasEffects: true, name: 'Backdrop' },
};

const n = (id: string, children?: TreeNode<unknown>[]): TreeNode<unknown> => ({ id, label: FACTS[id]!.name, children });
const TREE: TreeNode<unknown>[] = [n('comp', [n('titles', [n('t1'), n('t2')]), n('cam'), n('bg')])];
const factsOf = (id: string): SceneNodeFacts | null => FACTS[id] ?? null;
const ids = (nodes: TreeNode<unknown>[]): string[] =>
  nodes.flatMap((x) => [x.id, ...(x.children ? ids(x.children as TreeNode<unknown>[]) : [])]);

describe('sceneFilters', () => {
  it('an empty filter is a no-op and reports inactive', () => {
    expect(isSceneFilterActive(EMPTY_SCENE_FILTER)).toBe(false);
    expect(ids(filterSceneTree(TREE, EMPTY_SCENE_FILTER, factsOf))).toEqual(ids(TREE));
  });

  it('filters by kind, keeping ancestors of matches', () => {
    const f: SceneFilter = { ...EMPTY_SCENE_FILTER, kinds: new Set<SceneKind>(['camera']) };
    expect(ids(filterSceneTree(TREE, f, factsOf))).toEqual(['comp', 'cam']);
  });

  it('filters by label colour and by "no label"', () => {
    const coral: SceneFilter = { ...EMPTY_SCENE_FILTER, label: 'coral' };
    // The group matches on its own, so it keeps ALL its children.
    expect(ids(filterSceneTree(TREE, coral, factsOf))).toEqual(['comp', 'titles', 't1', 't2']);
    const none: SceneFilter = { ...EMPTY_SCENE_FILTER, label: 'none', kinds: new Set<SceneKind>(['text', 'image']) };
    expect(ids(filterSceneTree(TREE, none, factsOf))).toEqual(['comp', 'titles', 't1']);
  });

  it('filters animated and effect-carrying layers, and composes with search', () => {
    const anim: SceneFilter = { ...EMPTY_SCENE_FILTER, animatedOnly: true };
    expect(ids(filterSceneTree(TREE, anim, factsOf))).toEqual(['comp', 'titles', 't1', 'cam']);
    const fx: SceneFilter = { ...EMPTY_SCENE_FILTER, effectsOnly: true, query: 'back' };
    expect(ids(filterSceneTree(TREE, fx, factsOf))).toEqual(['comp', 'bg']);
    expect(nodeMatches(FACTS.t2!, { ...EMPTY_SCENE_FILTER, effectsOnly: true, animatedOnly: true })).toBe(false);
  });

  it('drops a branch with no match anywhere in it', () => {
    const f: SceneFilter = { ...EMPTY_SCENE_FILTER, query: 'zzz' };
    expect(filterSceneTree(TREE, f, factsOf)).toEqual([]);
  });

  it('toggleKind adds, removes and collapses to "any"', () => {
    const one = toggleKind(null, 'text');
    expect([...one!]).toEqual(['text']);
    const two = toggleKind(one, 'camera');
    expect(two!.size).toBe(2);
    expect(toggleKind(toggleKind(two, 'text'), 'camera')).toBeNull();
  });
});
