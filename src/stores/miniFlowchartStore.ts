/**
 * miniFlowchartStore — whether AE's Composition Mini-Flowchart is open.
 *
 * A transient control: opened by its command or the Composition Navigator's
 * arrow, closed by picking a comp, Esc, or a click outside. Never persisted.
 */

import { create } from 'zustand';

export interface MiniFlowchartState {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

export const useMiniFlowchartStore = create<MiniFlowchartState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
