/**
 * layerViewerStore — AE's Layer panel: which layer it is showing, its View
 * menu, and its mask tools.
 *
 * Session state only, never persisted. A Layer panel names ONE layer of the
 * open document; workspace persistence (where the editor tabs live) outlives
 * documents, and would carry a dangling layer id into the next project.
 */

import { create } from 'zustand';

/** The Layer panel's mask tools — AE draws and reshapes masks there. */
export type LayerMaskTool = 'select' | 'rect' | 'ellipse' | 'pen';

/** A mask path, and optionally one vertex of it, picked in the Layer panel. */
export interface LayerMaskSelection {
  pathId: string;
  point: number | null;
}

export interface LayerViewerState {
  /** The layer on show, or null when the Layer panel is closed. */
  nodeId: string | null;
  /**
   * AE's "Render" checkbox: draw the layer with its masks and effects. Off
   * shows the untouched source — what the layer starts from.
   */
  render: boolean;
  /** View ▸ Masks: outline the layer's mask paths (and edit them). */
  showMasks: boolean;
  /** View ▸ Anchor Point: mark the layer's anchor. */
  showAnchor: boolean;
  /** The active mask tool. */
  maskTool: LayerMaskTool;
  /** The mask (vertex) picked for editing, or null. */
  maskSelection: LayerMaskSelection | null;
  open: (nodeId: string) => void;
  close: () => void;
  setView: (patch: Partial<Pick<LayerViewerState, 'render' | 'showMasks' | 'showAnchor'>>) => void;
  setMaskTool: (tool: LayerMaskTool) => void;
  selectMask: (sel: LayerMaskSelection | null) => void;
}

export const useLayerViewerStore = create<LayerViewerState>((set) => ({
  nodeId: null,
  render: true,
  showMasks: true,
  showAnchor: true,
  maskTool: 'select',
  maskSelection: null,
  // A different layer starts with nothing picked; the tool is kept, as AE does.
  open: (nodeId) => set((s) => (s.nodeId === nodeId ? s : { nodeId, maskSelection: null })),
  close: () => set({ nodeId: null, maskSelection: null }),
  setView: (patch) => set(patch),
  setMaskTool: (maskTool) => set({ maskTool }),
  selectMask: (maskSelection) => set({ maskSelection }),
}));
