/**
 * The inspector's selection scope — every section is drawn for ONE primary
 * layer, and edits for ALL selected layers.
 *
 * Sections keep their `{ nodeId }` prop (it is the contract the discovery
 * tests, the registry and the accordion all rely on) and read the full
 * selection from this context when they can act on more than one layer.
 * A section mounted outside the Properties panel — the Rigging panel, a test
 * — sees a selection of exactly its own node, so nothing changes for it.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

interface InspectorSelectionValue {
  /** Every selected node, primary first. */
  nodeIds: ReadonlyArray<string>;
}

const InspectorSelectionContext = createContext<InspectorSelectionValue | null>(null);

export function InspectorSelectionProvider({
  nodeIds,
  children,
}: {
  nodeIds: ReadonlyArray<string>;
  children: ReactNode;
}): JSX.Element {
  const value = useMemo(() => ({ nodeIds }), [nodeIds]);
  return <InspectorSelectionContext.Provider value={value}>{children}</InspectorSelectionContext.Provider>;
}

/**
 * The layers a section's edits apply to: the selection when the section is
 * hosted by the Properties panel and its own node is the primary, else just
 * its own node. The "primary" check matters because a section can be mounted
 * for a node that is NOT the selection's first — the tracker panel's chosen
 * source, for one — and must not then write to layers it was never shown for.
 */
export function useInspectorSelection(nodeId: string): ReadonlyArray<string> {
  const ctx = useContext(InspectorSelectionContext);
  return useMemo(() => {
    if (!ctx || ctx.nodeIds[0] !== nodeId) return [nodeId];
    return ctx.nodeIds;
  }, [ctx, nodeId]);
}
