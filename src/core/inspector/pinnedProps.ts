/**
 * Pinned properties — the user's own shortlist of a layer's properties,
 * stored IN THE DOCUMENT beside the Essential Properties bag.
 *
 * Why in the document and not in preferences: which of a rig's forty
 * properties matter is a fact about the project, not about the person. A
 * collaborator opening the file should find the same "Pinned" tab, exactly
 * as they find the same Essential Properties. Preferences would ship one
 * person's pins to no one.
 *
 * Storage: `__pinnedProps` on the node's first component — the same host and
 * the same write path (`writeProp` + `bumpScene`) as `__essentialProps` and
 * `__modifiers`, so undo, dirty tracking and serialisation see it for free.
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { bumpScene } from '@stores/sceneStore';
import { compositionRootOf, parseOverrideKey, readEssentialProps } from '@core/scene/compInstanceOverrides';

export const PINNED_PROPS = '__pinnedProps';

/** The prop paths pinned on this layer, in the order they were pinned. */
export function readPinnedProps(nodeId: string): string[] {
  const node = defaultSceneGraph.getNode(nodeId);
  if (!node) return [];
  for (const c of node.components) {
    const bag = (c.props as Record<string, unknown>)[PINNED_PROPS];
    if (Array.isArray(bag)) return bag.filter((k): k is string => typeof k === 'string');
  }
  return [];
}

export function isPinnedProp(nodeId: string, prop: string): boolean {
  return readPinnedProps(nodeId).includes(prop);
}

/** Pin or unpin one property. Returns false when the node cannot hold it. */
export function setPinnedProp(nodeId: string, prop: string, pinned: boolean): boolean {
  const node = defaultSceneGraph.getNode(nodeId);
  if (!node || node.components.length === 0) return false;
  const host = node.components.find((c) => Array.isArray((c.props as Record<string, unknown>)[PINNED_PROPS]))
    ?? node.components[0]!;
  const current = readPinnedProps(nodeId);
  const next = pinned
    ? (current.includes(prop) ? current : [...current, prop])
    : current.filter((p) => p !== prop);
  if (next.length === current.length && next.every((p, i) => p === current[i])) return true;
  defaultSceneGraph.writeProp(nodeId, host.id, PINNED_PROPS, next);
  bumpScene();
  return true;
}

export function togglePinnedProp(nodeId: string, prop: string): void {
  setPinnedProp(nodeId, prop, !isPinnedProp(nodeId, prop));
}

/**
 * The layer's Essential Properties — the paths of THIS node promoted on its
 * composition root. Empty for a layer that is its own root.
 */
export function essentialPropsOf(nodeId: string): string[] {
  const root = compositionRootOf(nodeId);
  if (!root || root === nodeId) return [];
  const out: string[] = [];
  for (const key of readEssentialProps(root)) {
    const parsed = parseOverrideKey(key);
    if (parsed && parsed.origNodeId === nodeId) out.push(parsed.prop);
  }
  return out;
}

export interface PinnedEntry {
  prop: string;
  /** Pinned by hand, promoted as an Essential Property, or both. */
  pinned: boolean;
  essential: boolean;
}

/** Everything the Pinned tab lists: pins first, essentials after, no repeats. */
export function pinnedEntriesFor(nodeId: string): PinnedEntry[] {
  const pins = readPinnedProps(nodeId);
  const essentials = new Set(essentialPropsOf(nodeId));
  const out: PinnedEntry[] = pins.map((prop) => ({ prop, pinned: true, essential: essentials.has(prop) }));
  for (const prop of essentials) {
    if (!pins.includes(prop)) out.push({ prop, pinned: false, essential: true });
  }
  return out;
}

/** The tab exists only when it would list something. */
export function hasPinnedSection(nodeId: string): boolean {
  return pinnedEntriesFor(nodeId).length > 0;
}
