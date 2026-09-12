/**
 * compNetwork — the composition network around one comp, as After Effects'
 * Composition Mini-Flowchart shows it: the comps immediately UPSTREAM (nested
 * in this one) and immediately DOWNSTREAM (this one is placed in them).
 *
 * "Immediately" is the point. A comp nested two levels down is upstream of the
 * comp in between, not of this one, so the walk stops at every composition
 * boundary it meets: a placed comp (which has no children of its own) or an
 * in-place precomp group (whose inside is its own comp for navigation — it
 * opens as its own tab).
 *
 * A comp used several times appears ONCE, carrying every layer that uses it;
 * the flowchart shows the count, as AE does ("Lower Third (2)").
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { readCompRef } from '@core/scene/compInstance';
import { isPrecomp } from '@core/scene/precomp';
import { readNodeKind } from '@core/scene/sceneDerive';
import { useProjectStore } from '@stores/projectStore';
import type { SceneNode } from '@core/types';

export interface NetworkEntry {
  /** The composition (or precomp group) this entry opens. */
  compId: string;
  name: string;
  /**
   * The layers that carry the link, frontmost first. Upstream: layers of the
   * CURRENT comp that show this one. Downstream: layers of THIS comp that show
   * the current one.
   */
  layerIds: string[];
  /** Stack position of the frontmost of them (0 = top) — the layer-order sort key. */
  order: number;
}

export interface CompNetwork {
  compId: string;
  name: string;
  upstream: NetworkEntry[];
  downstream: NetworkEntry[];
}

export type UpstreamSort = 'name' | 'layer';

function nameOf(id: string): string {
  return useProjectStore.getState().comps[id]?.name ?? defaultSceneGraph.getNode(id)?.name ?? id;
}

/** A precomp GROUP is a composition boundary for navigation (not the comp root itself). */
function isGroupBoundary(node: SceneNode): boolean {
  return node.parent !== null && readNodeKind(node) === 'group' && isPrecomp(node);
}

/**
 * The layers directly inside composition `rootId`, frontmost first — walking
 * through ordinary groups and parented layers, but not INTO a precomp group.
 */
function layersIn(rootId: string): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (parentId: string): void => {
    // Child arrays run back → front; walk front → back.
    const kids = [...defaultSceneGraph.getChildren(parentId)].reverse();
    for (const n of kids) {
      out.push(n);
      if (!isGroupBoundary(n)) walk(n.id as string);
    }
  };
  walk(rootId);
  return out;
}

/** Composition ids that are real comps (scene roots with a settings record). */
function compRoots(): string[] {
  return Object.keys(useProjectStore.getState().comps).filter((id) => {
    const n = defaultSceneGraph.getNode(id);
    return !!n && !n.parent;
  });
}

/** The nearest composition boundary above `nodeId`: a precomp group or the comp root. */
function boundaryOf(nodeId: string): string | null {
  let parentId = defaultSceneGraph.getNode(nodeId)?.parent ?? null;
  for (let guard = 0; parentId && guard < 256; guard++) {
    const parent = defaultSceneGraph.getNode(parentId);
    if (!parent) return null;
    if (!parent.parent || isGroupBoundary(parent)) return parent.id as string;
    parentId = parent.parent;
  }
  return null;
}

function collect(into: Map<string, NetworkEntry>, compId: string, layerId: string, order: number): void {
  const e = into.get(compId);
  if (e) {
    e.layerIds.push(layerId);
    e.order = Math.min(e.order, order);
  } else {
    into.set(compId, { compId, name: nameOf(compId), layerIds: [layerId], order });
  }
}

/** The network around `compId`. Upstream sorted by `sort`; downstream always by name (AE). */
export function compNetworkOf(compId: string, sort: UpstreamSort = 'name'): CompNetwork {
  const upstream = new Map<string, NetworkEntry>();
  layersIn(compId).forEach((n, i) => {
    const ref = readCompRef(n);
    if (ref && defaultSceneGraph.getNode(ref)) collect(upstream, ref, n.id as string, i);
    else if (isGroupBoundary(n)) collect(upstream, n.id as string, n.id as string, i);
  });

  const downstream = new Map<string, NetworkEntry>();
  const self = defaultSceneGraph.getNode(compId);
  if (self?.parent) {
    // A precomp group is shown by its own place in the comp around it.
    const outer = boundaryOf(compId);
    if (outer) collect(downstream, outer, compId, 0);
  } else {
    for (const rootId of compRoots()) {
      if (rootId === compId) continue;
      const byBoundary = new Map<string, Array<{ id: string; order: number }>>();
      const all = layersIn(rootId);
      // Instances inside a precomp group of that comp belong to the GROUP.
      const walkAll = (parentId: string): void => {
        const kids = [...defaultSceneGraph.getChildren(parentId)].reverse();
        for (const n of kids) {
          if (readCompRef(n) === compId) {
            const b = boundaryOf(n.id as string) ?? rootId;
            const list = byBoundary.get(b) ?? [];
            list.push({ id: n.id as string, order: all.indexOf(n) >= 0 ? all.indexOf(n) : list.length });
            byBoundary.set(b, list);
          }
          walkAll(n.id as string);
        }
      };
      walkAll(rootId);
      for (const [b, list] of byBoundary) for (const l of list) collect(downstream, b, l.id, l.order);
    }
  }

  const byName = (a: NetworkEntry, b: NetworkEntry): number => a.name.localeCompare(b.name);
  return {
    compId,
    name: nameOf(compId),
    upstream: [...upstream.values()].sort(sort === 'layer' ? (a, b) => a.order - b.order : byName),
    downstream: [...downstream.values()].sort(byName),
  };
}
