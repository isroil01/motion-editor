/**
 * sceneFilters — the pure rules behind the Layers panel's filter row.
 *
 * A layer tree with forty rows and one filter (the name search) is a tree
 * you scroll. These narrow it by KIND (show me the cameras), by LABEL colour
 * (the shots I tagged red), by whether a layer is ANIMATED and whether it
 * carries EFFECTS — the four questions a compositor actually asks of a
 * stack — and they compose with the search.
 *
 * Ancestors of a match are kept, the way `filterTree` already keeps them for
 * the search: a match inside a closed group has to be reachable, and the
 * only way to reach it is through its parents. The facts about a node are
 * injected (`SceneNodeFacts`) so this file needs no scene graph and no
 * animation engine, and the panel can hand it the live ones.
 */

import type { TreeNode } from '@components/TreeView';
import type { SceneKind } from '@core/scene/seedDefaultScene';

export interface SceneFilter {
  /** Kinds to show; null = every kind. */
  kinds: ReadonlySet<SceneKind> | null;
  /** A label colour to match; `'none'` = unlabelled only; null = any. */
  label: string | 'none' | null;
  animatedOnly: boolean;
  effectsOnly: boolean;
  /** Lower-cased, trimmed search. */
  query: string;
}

export interface SceneNodeFacts {
  kind: SceneKind;
  label: string | undefined;
  animated: boolean;
  hasEffects: boolean;
  name: string;
}

export const EMPTY_SCENE_FILTER: SceneFilter = {
  kinds: null,
  label: null,
  animatedOnly: false,
  effectsOnly: false,
  query: '',
};

export function isSceneFilterActive(f: SceneFilter): boolean {
  return f.kinds !== null || f.label !== null || f.animatedOnly || f.effectsOnly || f.query.length > 0;
}

/** Does one node, on its own facts, pass the filter? */
export function nodeMatches(facts: SceneNodeFacts, f: SceneFilter): boolean {
  if (f.kinds && !f.kinds.has(facts.kind)) return false;
  if (f.label === 'none' ? facts.label !== undefined : f.label !== null && facts.label !== f.label) return false;
  if (f.animatedOnly && !facts.animated) return false;
  if (f.effectsOnly && !facts.hasEffects) return false;
  if (f.query && !facts.name.toLowerCase().includes(f.query)) return false;
  return true;
}

/**
 * Filter a tree, keeping the ancestors of any match. A branch whose own
 * facts fail but which holds a match survives with only the matching
 * descendants; a branch that matches keeps ALL its children, because the
 * user asked for "the group called Titles", not for its parts.
 */
export function filterSceneTree<T>(
  nodes: ReadonlyArray<TreeNode<T>>,
  f: SceneFilter,
  factsOf: (id: string) => SceneNodeFacts | null,
): TreeNode<T>[] {
  if (!isSceneFilterActive(f)) return [...nodes];
  const out: TreeNode<T>[] = [];
  for (const node of nodes) {
    const facts = factsOf(node.id);
    const self = facts ? nodeMatches(facts, f) : false;
    const kids = node.children ? filterSceneTree(node.children, f, factsOf) : [];
    if (self || kids.length > 0) {
      out.push({ ...node, children: self ? node.children : kids });
    }
  }
  return out;
}

/** Toggle a kind in the set; an empty set collapses back to "every kind". */
export function toggleKind(kinds: ReadonlySet<SceneKind> | null, kind: SceneKind): ReadonlySet<SceneKind> | null {
  const next = new Set(kinds ?? []);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  return next.size === 0 ? null : next;
}
