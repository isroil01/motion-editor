/**
 * Timeline VIEW state that is neither a preference nor document content.
 *
 * The heat lane and the transcript lane are things you switch on to look at
 * something and switch off again; persisting them would bring a comp back
 * with a diagnostic overlay the user forgot they left on. They are also read
 * by leaves that subscribe themselves (`HeatLane`, `TranscriptLane`), so they
 * live in a store rather than in `<Timeline>`'s props — a flag threaded
 * through the model would re-render every virtualized row to flip a lane.
 *
 * `uiStore` was the obvious home and is deliberately NOT used: another set of
 * flags is being added to it concurrently, and two writers to one file is how
 * a merge loses one of them.
 */

import { create } from 'zustand';

export type HeatSource = 'sinceSave' | 'lastAi';

interface TimelineViewState {
  /** Tint clips and keyframes that changed since the baseline. */
  heatLane: boolean;
  /** Which baseline the heat lane diffs against. */
  heatSource: HeatSource;
  /** The transcript word lane under the ruler. */
  transcriptLane: boolean;
  /** The comp/layer marker lane above the ruler. */
  markerLane: boolean;
}

interface TimelineViewActions {
  setHeatLane(on: boolean): void;
  setHeatSource(source: HeatSource): void;
  setTranscriptLane(on: boolean): void;
  setMarkerLane(on: boolean): void;
  reset(): void;
}

const DEFAULTS: TimelineViewState = {
  heatLane: false,
  heatSource: 'sinceSave',
  transcriptLane: false,
  markerLane: true,
};

export const useTimelineViewStore = create<TimelineViewState & TimelineViewActions>((set) => ({
  ...DEFAULTS,
  setHeatLane: (heatLane) => set({ heatLane }),
  setHeatSource: (heatSource) => set({ heatSource }),
  setTranscriptLane: (transcriptLane) => set({ transcriptLane }),
  setMarkerLane: (markerLane) => set({ markerLane }),
  reset: () => set({ ...DEFAULTS }),
}));
