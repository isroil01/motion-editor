/**
 * UI store — ephemeral, non-persisted UI state.
 *
 * Holds things that don't belong in the panel or preference stores: focus,
 * hover, transient modals, tooltips, drag state. Anything a single user
 * action would set then immediately unset.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Disposable } from '@app-types/common';
import type { PinKind } from '@core/rig/puppet';

/**
 * Which of AE's two right-hand column blocks the timeline shows.
 *
 * AE's "Toggle Switches / Modes" button, and the reason its panel fits: the
 * layer switches (shy · fx · blur · adjustment · guide · T · 3D) and the mode
 * columns (Mode · TrkMat · Parent) occupy the same horizontal space, and you
 * see one set at a time. Ours used to render both unconditionally, which needs
 * ~760px of header — so at any normal panel width Mode, TrkMat and Parent were
 * pushed off the right edge and could not be reached at all.
 */
export type TimelineColumns = 'switches' | 'modes' | 'both';

/**
 * What the timeline's "what changed" lane is diffing against.
 *
 * TIMELINE-HEAT-ANCHOR. `off` costs nothing; the other two make `changeHeat`
 * fingerprint the document against a baseline on a throttle.
 */
export type TimelineHeatSource = 'off' | 'save' | 'ai';

export type BoneRigMode = 'draw' | 'pose' | 'weights';
export type BoneWeightMode = 'add' | 'subtract' | 'smooth' | 'pick';

export type Tool =
  | 'select'
  | 'direct-select'
  | 'rotate'
  | 'pan-behind'
  | 'hand'
  | 'zoom'
  | 'move'
  | 'pen'
  | 'pencil'
  | 'brush'
  // AE's Paint effect — strokes onto an EXISTING layer. Split out of `brush`,
  // which used to switch between the two based on what happened to be under
  // the cursor, so a second brush stroke silently became a paint stroke.
  | 'paint'
  // Paint with `mode: 'erase'` forced. Not a checkbox on the brush: an eraser
  // that can lay down colour because a shared setting was left on is not an
  // eraser, it is a trap.
  | 'eraser'
  | 'curvature'
  | 'line'
  // Drag a line across a shape layer: every crossing splits its path. Lives
  // beside the pen tools because it EDITS an outline rather than creating one.
  | 'knife'
  | 'text'
  | 'shape'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'mask-rect'
  | 'mask-ellipse'
  // The pen, aimed at the selected layer's masks. The plain `pen` used to do
  // this implicitly whenever exactly one layer was selected — which, because
  // drawing selects what it draws, was always.
  | 'mask-pen'
  | 'puppet-pin'
  | 'bone'
  // Roto Brush: paint foreground / background strokes on a footage layer and
  // the segmenter writes the matte as a mask path. The HOST owns the gesture
  // (`RotoBrushOverlay`), like puppet-pin and bone.
  | 'roto';

interface UIState {
  /** Active tool in the toolbar. */
  activeTool: Tool;
  /**
   * Armed Puppet pin variant while `activeTool` is `puppet-pin`.
   * Default is Position — the same first tool AE's flyout highlights.
   */
  puppetPinKind: PinKind;
  /** Bone workflow mode: construct, animate, or bind the deformation mesh. */
  boneRigMode: BoneRigMode;
  /** Brush/picker armed while `boneRigMode === 'weights'`. */
  boneWeightMode: BoneWeightMode;
  /** Screen-pixel brush radius; intentionally independent of camera zoom. */
  boneBrushRadius: number;
  /** Whether the user is currently dragging. */
  isDragging: boolean;
  /** Generic "toast"-style notifications. */
  notifications: ReadonlyArray<Notification>;
  /** Snap-to-grid / snap-to-object enabled. */
  snap: boolean;
  /** Whether the graph editor is currently open. */
  graphEditorOpen: boolean;
  /** Whether the global Shy layers toggle is active. */
  globalShy: boolean;
  /** AE's Toggle Switches / Modes — which right-hand column block is shown. */
  timelineColumns: TimelineColumns;
  /**
   * TIMELINE-HEAT-ANCHOR — the "what changed" lane's source.
   *
   * `off` is the default and the only state that costs nothing: the other two
   * make the lane diff the document against a baseline (see `changeHeat.ts`).
   * `save` tints what has moved since the last save or open; `ai` tints what
   * the most recent AI run touched.
   */
  timelineHeatSource: TimelineHeatSource;
  /** TIMELINE-TRANSCRIPT-LANE-ANCHOR — show the word lane under the ruler. */
  timelineTranscriptLane: boolean;
  /**
   * Long-running background work — a render, a cache pass, a transcription, a
   * model download. Each job owns ONE progress toast for its lifetime and is
   * mirrored into the status-bar tray, which reads this list directly.
   */
  jobs: ReadonlyArray<Job>;
  /**
   * When the crash-recovery autosave last wrote a snapshot (epoch ms), or
   * null if it has not yet this session. The status bar shows it; the Files
   * tab of Preferences shows it in full.
   */
  lastAutosaveAt: number | null;
}

/** Where a job is. `running` is the only state the tray animates. */
export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  label: string;
  status: JobStatus;
  /** 0–1, or indeterminate while the total is unknown. */
  progress: number | 'indeterminate';
  startedAt: number;
  finishedAt?: number;
  /** The closing line — "Written to renders/out.mp4", the error message. */
  message?: string;
  action?: Notification['action'];
  /** The toast this job drives, so progress writes land on one card. */
  toastId?: string;
}

export interface Notification {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  /** Auto-dismiss after this many ms. 0 means manual dismiss only. */
  durationMs: number;
  createdAt: number;
  /**
   * One optional inline action.
   *
   * For the small class of notice that a user should be able to ACT on without
   * hunting for where. A modal would interrupt; a toast with no action is a
   * dead end.
   *
   * "Update ready ▸ Restart now" was the case this was built for and is no
   * longer one of them: a pending update outlives any toast, and a notice the
   * user can dismiss while the fact stays true is a notice that lies. It is a
   * persistent title-bar button now (`UpdateButton`). What belongs here is the
   * genuinely transient — something that HAPPENED and has a follow-up.
   *
   * One action, not a list: a toast with a row of buttons is a dialog wearing a
   * disguise, and the whole point is not to block.
   */
  action?: {
    label: string;
    onSelect(): void;
  };
  /**
   * Progress for work that is still happening: 0–1 draws a bar, `indeterminate`
   * draws a sweep. Absent means the toast is a plain notice.
   */
  progress?: number | 'indeterminate';
  /**
   * Stays until dismissed or until its job finishes, whatever `durationMs`
   * says. A progress toast is sticky by construction — dismissing "Rendering…
   * 40%" on a timer would tell the user the render stopped.
   */
  sticky?: boolean;
  /**
   * Collapse key. Toasts sharing a group replace one another rather than
   * stacking: ten "Cached 12 frames" notices are one notice that changed.
   */
  group?: string;
  /** Optional second line — an error's detail, a file path. */
  detail?: string;
}

/** What `finishJob` needs to say about how the work ended. */
export interface JobOutcome {
  status: Exclude<JobStatus, 'running'>;
  message?: string;
  detail?: string;
  action?: Notification['action'];
}

interface UIActions {
  setActiveTool(tool: Tool): void;
  setPuppetPinKind(kind: PinKind): void;
  setBoneRigMode(mode: BoneRigMode): void;
  setBoneWeightMode(mode: BoneWeightMode): void;
  setBoneBrushRadius(radius: number): void;
  setDragging(isDragging: boolean): void;
  notify(notification: Omit<Notification, 'id' | 'createdAt'>): string;
  /** Patch a live toast in place — progress, message, action. No-op if gone. */
  updateNotification(id: string, patch: Partial<Omit<Notification, 'id' | 'createdAt'>>): void;
  dismissNotification(id: string): void;
  /**
   * Begin a background job: adds it to the tray and opens its progress toast.
   * Re-using an id restarts that job (the previous toast is replaced).
   */
  startJob(job: { id: string; label: string; progress?: number | 'indeterminate' }): void;
  updateJob(id: string, patch: { progress?: number | 'indeterminate'; label?: string }): void;
  /**
   * End a job. The progress toast is dismissed and, unless the job was
   * cancelled silently, a closing toast is shown with the outcome and its one
   * follow-up action ("Reveal file", "Retry"). Finished jobs stay in the tray
   * briefly (`JOB_LINGER_MS`) so the status bar can show the outcome, then drop.
   */
  finishJob(id: string, outcome: JobOutcome): void;
  /** Drop a finished job from the tray now. */
  clearJob(id: string): void;
  setLastAutosaveAt(at: number | null): void;
  toggleSnap(): void;
  setGraphEditorOpen(open: boolean): void;
  setGlobalShy(open: boolean): void;
  setTimelineColumns(columns: TimelineColumns): void;
  /** AE's button: Switches → Modes → Both → Switches. */
  cycleTimelineColumns(): void;
  setTimelineHeatSource(source: TimelineHeatSource): void;
  /** off → since save → last AI run → off. */
  cycleTimelineHeatSource(): void;
  setTimelineTranscriptLane(on: boolean): void;
}

export type UIStore = UIState & UIActions;

/** How long a finished job stays in the tray before it drops out. */
export const JOB_LINGER_MS = 6000;

export const useUIStore = create<UIStore>()(
  subscribeWithSelector(
    immer((set) => ({
      activeTool: 'select',
      puppetPinKind: 'position',
      boneRigMode: 'draw',
      boneWeightMode: 'add',
      boneBrushRadius: 40,
      isDragging: false,
      notifications: [],
      snap: true,
      graphEditorOpen: false,
      globalShy: false,
      // Both, not 'modes': the toggle exists so the panel CAN be narrowed, not
      // so it starts with controls missing. Defaulting to 'modes' hid every
      // per-layer switch (shy · fx · blur · adjustment · guide · T · 3D) until
      // you found the button, which is a worse first run than a wide header.
      timelineColumns: 'both',
      timelineHeatSource: 'off',
      timelineTranscriptLane: false,
      jobs: [],
      lastAutosaveAt: null,

      setActiveTool: (tool) =>
        set((s) => {
          s.activeTool = tool;
        }),
      setPuppetPinKind: (kind) =>
        set((s) => {
          s.puppetPinKind = kind;
        }),
      setBoneRigMode: (mode) =>
        set((s) => {
          s.boneRigMode = mode;
        }),
      setBoneWeightMode: (mode) =>
        set((s) => {
          s.boneWeightMode = mode;
        }),
      setBoneBrushRadius: (radius) =>
        set((s) => {
          s.boneBrushRadius = Math.max(4, Math.min(400, radius));
        }),
      setDragging: (isDragging) =>
        set((s) => {
          s.isDragging = isDragging;
        }),
      notify: (n) => {
        const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        // A progress toast is sticky whatever the caller said — see `sticky`.
        const sticky = n.sticky ?? n.progress !== undefined;
        set((s) => {
          // One toast per group: the newer notice REPLACES the older one in
          // its slot rather than stacking under it.
          if (n.group) s.notifications = s.notifications.filter((x) => x.group !== n.group);
          s.notifications.push({
            ...n,
            sticky,
            id,
            createdAt: Date.now(),
          });
        });
        if (n.durationMs > 0 && !sticky) {
          window.setTimeout(() => {
            useUIStore.getState().dismissNotification(id);
          }, n.durationMs);
        }
        return id;
      },
      updateNotification: (id, patch) =>
        set((s) => {
          const n = s.notifications.find((x) => x.id === id);
          if (n) Object.assign(n, patch);
        }),
      dismissNotification: (id) =>
        set((s) => {
          s.notifications = s.notifications.filter((n) => n.id !== id);
        }),

      startJob: ({ id, label, progress = 'indeterminate' }) => {
        const prev = useUIStore.getState().jobs.find((j) => j.id === id);
        if (prev?.toastId) useUIStore.getState().dismissNotification(prev.toastId);
        const toastId = useUIStore.getState().notify({
          level: 'info',
          message: label,
          durationMs: 0,
          progress,
          sticky: true,
          group: `job:${id}`,
        });
        set((s) => {
          s.jobs = [
            ...s.jobs.filter((j) => j.id !== id),
            { id, label, status: 'running', progress, startedAt: Date.now(), toastId },
          ];
        });
      },
      updateJob: (id, patch) => {
        const job = useUIStore.getState().jobs.find((j) => j.id === id);
        if (!job || job.status !== 'running') return;
        set((s) => {
          const j = s.jobs.find((x) => x.id === id);
          if (!j) return;
          if (patch.progress !== undefined) j.progress = patch.progress;
          if (patch.label !== undefined) j.label = patch.label;
        });
        if (job.toastId) {
          useUIStore.getState().updateNotification(job.toastId, {
            ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
            ...(patch.label !== undefined ? { message: patch.label } : {}),
          });
        }
      },
      finishJob: (id, outcome) => {
        const job = useUIStore.getState().jobs.find((j) => j.id === id);
        if (!job) return;
        if (job.toastId) useUIStore.getState().dismissNotification(job.toastId);
        const finishedAt = Date.now();
        set((s) => {
          const j = s.jobs.find((x) => x.id === id);
          if (!j) return;
          j.status = outcome.status;
          j.finishedAt = finishedAt;
          j.progress = outcome.status === 'done' ? 1 : j.progress;
          j.toastId = undefined;
          if (outcome.message !== undefined) j.message = outcome.message;
          if (outcome.action !== undefined) j.action = outcome.action;
        });
        // A cancelled job with nothing to say is not news.
        if (outcome.message) {
          useUIStore.getState().notify({
            level: outcome.status === 'done' ? 'success' : outcome.status === 'failed' ? 'error' : 'info',
            message: outcome.message,
            durationMs: outcome.status === 'failed' ? 8000 : 4200,
            group: `job:${id}`,
            ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
            ...(outcome.action !== undefined ? { action: outcome.action } : {}),
          });
        }
        window.setTimeout(() => useUIStore.getState().clearJob(id), JOB_LINGER_MS);
      },
      clearJob: (id) =>
        set((s) => {
          // Only a FINISHED job clears; a running one is still the tray's business.
          s.jobs = s.jobs.filter((j) => j.id !== id || j.status === 'running');
        }),
      setLastAutosaveAt: (at) =>
        set((s) => {
          s.lastAutosaveAt = at;
        }),
      toggleSnap: () =>
        set((s) => {
          s.snap = !s.snap;
        }),
      setGraphEditorOpen: (open) =>
        set((s) => {
          s.graphEditorOpen = open;
        }),
      setGlobalShy: (open) =>
        set((s) => {
          s.globalShy = open;
        }),
      setTimelineColumns: (columns) =>
        set((s) => {
          s.timelineColumns = columns;
        }),
      cycleTimelineColumns: () =>
        set((s) => {
          s.timelineColumns =
            s.timelineColumns === 'switches'
              ? 'modes'
              : s.timelineColumns === 'modes'
                ? 'both'
                : 'switches';
        }),
      setTimelineHeatSource: (source) =>
        set((s) => {
          s.timelineHeatSource = source;
        }),
      cycleTimelineHeatSource: () =>
        set((s) => {
          // off → save → ai → off. `off` is in the cycle rather than needing a
          // second control: the lane is a review aid you turn on for a minute,
          // and a toggle you cannot switch back off from the same button is
          // the one people complain about.
          s.timelineHeatSource =
            s.timelineHeatSource === 'off' ? 'save' : s.timelineHeatSource === 'save' ? 'ai' : 'off';
        }),
      setTimelineTranscriptLane: (on) =>
        set((s) => {
          s.timelineTranscriptLane = on;
        }),
    })),
  ),
);

/** Subscribe to a slice without React — for engines. */
export function subscribeUI(
  selector: (s: UIState) => unknown,
  listener: () => void,
): Disposable {
  const unsub = useUIStore.subscribe(selector, listener);
  return { dispose: unsub };
}
