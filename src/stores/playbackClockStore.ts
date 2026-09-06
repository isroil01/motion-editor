/**
 * PlaybackClockStore — the TRANSIENT playhead, per tab.
 *
 * `time` / `frame` used to live on the tab record inside the immer-backed
 * project store, and the playback pump wrote them there 60×/s. Every write
 * structurally cloned the tab, the `tabs` table and the root (and froze the
 * result), and re-ran every project-store selector in the app — so anything
 * subscribed to the tab OBJECT (transport bar, timeline shell, inspector
 * sections, the composition-settings hook…) re-rendered on every frame of
 * playback whether or not it cared about time. `compositionStore` documents
 * the damage that caused and works around it locally.
 *
 * This store is the fix: a plain (NON-immer) zustand store holding nothing but
 * the clock, so a playhead tick allocates one small object and notifies only
 * the subscribers that actually selected a time.
 *
 * ## Who owns what
 *
 *   - THIS store is the live playhead. Read it with {@link useCurrentTime}
 *     (render), {@link getTime} (event handlers) or {@link subscribeTime}
 *     (per-frame readers that must not re-render — refs, canvases).
 *   - The project store keeps an AUTHORITATIVE COPY on the tab record, but only
 *     at coarse moments: every seek while paused (a scrub, a click, a keyframe
 *     jump), at most {@link PLAYBACK_MIRROR_INTERVAL_MS} apart during playback,
 *     on pause, on tab switch, and on `commitTime`. That copy is what
 *     `captureDocument` saves and what code outside the render loop that still
 *     reads `tabs[id].time` sees — exact whenever the transport is stopped,
 *     ≤250ms behind while it runs.
 *
 * The project store is a leaf module and does not import this one; this store
 * watches it instead, so a document load (`hydrateWorkspaceTabs`), an undo
 * restore, a closed tab or a direct `actions.setTime` call all flow INTO the
 * clock without the project store knowing the clock exists.
 *
 * The `TimeChanged` bus event keeps firing on every write, exactly as before.
 */

import { create } from 'zustand';
import { getEventBus } from '@core/events/EventBus';
import { useProjectStore } from './projectStore';

export interface ClockEntry {
  /** Playhead, comp seconds. */
  readonly time: number;
  /** Playhead, whole comp frames — kept beside `time` so both are frame-exact. */
  readonly frame: number;
}

export interface PlaybackClockState {
  /** Tab id → clock. A tab with no entry reads as the project store's copy. */
  readonly clocks: Readonly<Record<string, ClockEntry>>;
}

/**
 * While a tab PLAYS, the authoritative copy on the project store is refreshed
 * at most this often (4Hz). Paused seeks mirror immediately.
 */
export const PLAYBACK_MIRROR_INTERVAL_MS = 250;

export const usePlaybackClockStore = create<PlaybackClockState>()(() => ({ clocks: {} }));

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

let lastMirrorAt = -Infinity;

/** The tab a caller means when it names none: the active one. */
function resolveTabId(tabId?: string | null): string | null {
  return tabId ?? useProjectStore.getState().activeTabId;
}

function frameFor(tabId: string, time: number): number {
  const s = useProjectStore.getState();
  const fps = s.comps[s.tabs[tabId]?.compositionId ?? '']?.fps ?? 30;
  return Math.round(time * fps);
}

/** Current clock of a tab, falling back to the project store's authoritative copy. */
export function getClock(tabId?: string | null): ClockEntry {
  const id = resolveTabId(tabId);
  if (!id) return { time: 0, frame: 0 };
  const live = usePlaybackClockStore.getState().clocks[id];
  if (live) return live;
  const tab = useProjectStore.getState().tabs[id];
  return tab ? { time: tab.time, frame: tab.frame } : { time: 0, frame: 0 };
}

/** The playhead in comp seconds — for event handlers, never for render. */
export function getTime(tabId?: string | null): number {
  return getClock(tabId).time;
}

/** The playhead in whole comp frames — for event handlers, never for render. */
export function getFrame(tabId?: string | null): number {
  return getClock(tabId).frame;
}

/**
 * Write the authoritative copy on the project store NOW. Called by the mirror
 * policy below and by anything that is about to read the tab record and needs
 * it exact (a save mid-playback, a tab switch).
 */
export function commitTime(tabId?: string | null): void {
  const id = resolveTabId(tabId);
  if (!id) return;
  const live = usePlaybackClockStore.getState().clocks[id];
  if (!live) return;
  const ps = useProjectStore.getState();
  const tab = ps.tabs[id];
  if (!tab || (tab.time === live.time && tab.frame === live.frame)) return;
  lastMirrorAt = nowMs();
  ps.actions.commitTime(id, live.time, live.frame);
}

/** Commit every tab's clock. For serializers that walk the whole tab table. */
export function commitAllTimes(): void {
  for (const id of Object.keys(usePlaybackClockStore.getState().clocks)) commitTime(id);
}

/**
 * Mirror policy: paused → the project store copy follows every seek (that is
 * what "seek from the UI" commits); playing → at most once per
 * {@link PLAYBACK_MIRROR_INTERVAL_MS}, with `pause` and the tab switch
 * committing the final value (see the project-store subscription below).
 */
function mirror(tabId: string, time: number, frame: number): void {
  const ps = useProjectStore.getState();
  const tab = ps.tabs[tabId];
  if (!tab || (tab.time === time && tab.frame === frame)) return;
  if (tab.playing) {
    const stamp = nowMs();
    if (stamp - lastMirrorAt < PLAYBACK_MIRROR_INTERVAL_MS) return;
    lastMirrorAt = stamp;
  }
  ps.actions.commitTime(tabId, time, frame);
}

/**
 * Move a tab's playhead. `frame` defaults to `round(time × fps)` of the tab's
 * comp. Emits `TimeChanged` so existing bus subscribers keep working.
 *
 * This is the ONLY write path for the live playhead; the engine's
 * `CurrentTimeChanged` handler in `TimelineController` and the pop-out sync
 * both land here.
 */
export function setTime(tabId: string, time: number, frame?: number): void {
  const f = frame ?? frameFor(tabId, time);
  const { clocks } = usePlaybackClockStore.getState();
  const prev = clocks[tabId];
  if (!prev || prev.time !== time || prev.frame !== f) {
    usePlaybackClockStore.setState({ clocks: { ...clocks, [tabId]: { time, frame: f } } });
  }
  mirror(tabId, time, f);
  getEventBus().emit('TimeChanged', { time, frame: f });
}

/** Seed a clock from the project store without announcing a seek. */
function adopt(tabId: string, time: number, frame: number): void {
  const { clocks } = usePlaybackClockStore.getState();
  const prev = clocks[tabId];
  if (prev && prev.time === time && prev.frame === frame) return;
  usePlaybackClockStore.setState({ clocks: { ...clocks, [tabId]: { time, frame } } });
}

/**
 * Per-frame reader that must NOT re-render: fires `cb(time, frame)` whenever
 * `tabId`'s clock changes. Returns the unsubscribe.
 */
export function subscribeTime(
  tabId: string,
  cb: (time: number, frame: number) => void,
): () => void {
  return usePlaybackClockStore.subscribe((state, prev) => {
    const a = state.clocks[tabId];
    if (!a) return;
    const b = prev.clocks[tabId];
    if (b && b.time === a.time && b.frame === a.frame) return;
    cb(a.time, a.frame);
  });
}

/**
 * The playhead of `tabId` (default: the active tab) as a SCALAR — the
 * component re-renders when the number changes and on nothing else.
 */
export function useCurrentTime(tabId?: string): number {
  const active = useProjectStore((s) => s.activeTabId);
  const id = tabId ?? active ?? '';
  const live = usePlaybackClockStore((s) => s.clocks[id]?.time);
  // A tab the clock has not seen yet reads the project store's copy. The
  // selector collapses to a constant once the clock owns the tab, so the
  // 4Hz playback mirror never reaches this component.
  const fallback = useProjectStore((s) => (live === undefined ? s.tabs[id]?.time ?? 0 : 0));
  return live ?? fallback;
}

/** Whole-frame twin of {@link useCurrentTime}. */
export function useCurrentFrame(tabId?: string): number {
  const active = useProjectStore((s) => s.activeTabId);
  const id = tabId ?? active ?? '';
  const live = usePlaybackClockStore((s) => s.clocks[id]?.frame);
  const fallback = useProjectStore((s) => (live === undefined ? s.tabs[id]?.frame ?? 0 : 0));
  return live ?? fallback;
}

// ── Project store → clock ───────────────────────────────────────────
//
// The project store is the authority whenever IT moves the playhead: a
// document load, an undo restore, `actions.setTime` from a caller that has
// not migrated. Adopt those into the clock. Our own mirror writes arrive here
// too and are no-ops (same value). Also the two coarse commits the project
// store cannot ask for itself: pause and tab switch.

function seedFromProject(): void {
  const ps = useProjectStore.getState();
  for (const tab of Object.values(ps.tabs)) adopt(tab.id, tab.time, tab.frame);
}

useProjectStore.subscribe((state, prev) => {
  if (state.tabs !== prev.tabs) {
    for (const tab of Object.values(state.tabs)) {
      const before = prev.tabs[tab.id];
      if (!before) {
        adopt(tab.id, tab.time, tab.frame);
        continue;
      }
      if (before.time !== tab.time || before.frame !== tab.frame) {
        adopt(tab.id, tab.time, tab.frame);
      }
      // Pause is a coarse moment: the last playback frame becomes authoritative.
      if (before.playing && !tab.playing) commitTime(tab.id);
    }
    // A closed tab takes its clock with it.
    const { clocks } = usePlaybackClockStore.getState();
    let dropped = false;
    const next: Record<string, ClockEntry> = {};
    for (const [id, entry] of Object.entries(clocks)) {
      if (state.tabs[id]) next[id] = entry;
      else dropped = true;
    }
    if (dropped) usePlaybackClockStore.setState({ clocks: next });
  }
  // Leaving a tab commits where it was parked.
  if (state.activeTabId !== prev.activeTabId && prev.activeTabId) commitTime(prev.activeTabId);
});

seedFromProject();
