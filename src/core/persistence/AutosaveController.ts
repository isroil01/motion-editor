/**
 * AutosaveController — writes a crash-recovery snapshot on a fixed interval
 * (spec: "Autosave every 60 seconds, invisible and non-blocking").
 *
 * It only writes when the document is dirty, so a quiet session costs nothing.
 * It also flushes when the tab is hidden or the window is closing, so a crash
 * loses at most the last few seconds. Autosave protects against data loss; it
 * does NOT clear the unsaved indicator — that's reserved for an explicit Save.
 *
 * ── Settings ─────────────────────────────────────────────────────────────
 * The interval is the user's (Preferences ▸ Files, `autosaveIntervalSec`);
 * `intervalMs` in the options is the fallback for a caller that boots before
 * the preference store, and the timer re-arms by itself when the preference
 * changes. Every successful write stamps `uiStore.lastAutosaveAt`, which the
 * status bar and the Files tab show, on top of whatever `onSaved` the caller
 * passed. How many snapshots are kept, and whether a copy also lands in a
 * folder, is `recovery.ts`'s business.
 */

import { captureRecovery, persistRecovery } from './recovery';

export interface AutosaveOptions {
  /** Fallback interval when no preference is readable. */
  intervalMs?: number;
  /** Current playhead time (persisted so recovery restores the position). */
  getTime: () => number;
  /** Whether there are unsaved edits worth persisting. */
  isDirty: () => boolean;
  /** Wall-clock stamp (injected so the module stays testable). */
  now: () => number;
  /** Optional hook fired after each successful autosave. */
  onSaved?: (at: number) => void;
}

/** Bounds on the interval a preference can set — see the Files tab. */
export const AUTOSAVE_MIN_SEC = 10;
export const AUTOSAVE_MAX_SEC = 30 * 60;
export const AUTOSAVE_DEFAULT_SEC = 60;

/**
 * The preference store is reached lazily: this module is imported by the
 * boot path, and a static import would evaluate the store (and its event bus)
 * before the core has registered. Returns null when it is not readable.
 */
function preferredIntervalMs(): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy seam: this module is on the boot path, see layoutStore.ts
    const { usePreferenceStore } = require('@stores/preferenceStore') as typeof import('@stores/preferenceStore');
    const sec = usePreferenceStore.getState().autosaveIntervalSec;
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return null;
    return Math.min(AUTOSAVE_MAX_SEC, Math.max(AUTOSAVE_MIN_SEC, sec)) * 1000;
  } catch {
    return null;
  }
}

function subscribeInterval(listener: () => void): () => void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy seam: this module is on the boot path, see layoutStore.ts
    const { usePreferenceStore } = require('@stores/preferenceStore') as typeof import('@stores/preferenceStore');
    let last = usePreferenceStore.getState().autosaveIntervalSec;
    return usePreferenceStore.subscribe((s) => {
      if (s.autosaveIntervalSec === last) return;
      last = s.autosaveIntervalSec;
      listener();
    });
  } catch {
    return () => undefined;
  }
}

function stampLastAutosave(at: number): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy seam: this module is on the boot path, see layoutStore.ts
    const { useUIStore } = require('@stores/uiStore') as typeof import('@stores/uiStore');
    useUIStore.getState().setLastAutosaveAt(at);
  } catch {
    /* no UI store (headless) — nothing to show it in */
  }
}

export class AutosaveController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: AutosaveOptions | null = null;
  private unsubscribePrefs: (() => void) | null = null;
  private readonly onHide = (): void => { if (document.hidden) this.flush(); };
  private readonly onUnload = (): void => this.flush();

  start(opts: AutosaveOptions): void {
    this.stop();
    this.opts = opts;
    this.arm();
    this.unsubscribePrefs = subscribeInterval(() => this.arm());
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('beforeunload', this.onUnload);
  }

  /** The interval in force: the preference, else the caller's, else 60 s. */
  intervalMs(): number {
    return preferredIntervalMs() ?? this.opts?.intervalMs ?? AUTOSAVE_DEFAULT_SEC * 1000;
  }

  private arm(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.flush(), this.intervalMs());
  }

  /** Capture + persist a snapshot now, if dirty. Non-blocking, best-effort. */
  flush(): void {
    const o = this.opts;
    if (!o || !o.isDirty()) return;
    try {
      const snap = captureRecovery(o.getTime());
      if (snap) {
        snap.savedAt = o.now();
        persistRecovery(snap);
        stampLastAutosave(snap.savedAt);
        o.onSaved?.(snap.savedAt);
      }
    } catch {
      /* autosave must never throw into the app */
    }
  }

  /**
   * "Autosave now", from the Files tab: writes even when the document is
   * clean, because the person asked. Returns the stamp, or null if there was
   * nothing to capture (no project route).
   */
  saveNow(): number | null {
    const o = this.opts;
    if (!o) return null;
    try {
      const snap = captureRecovery(o.getTime());
      if (!snap) return null;
      snap.savedAt = o.now();
      persistRecovery(snap);
      stampLastAutosave(snap.savedAt);
      o.onSaved?.(snap.savedAt);
      return snap.savedAt;
    } catch {
      return null;
    }
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.unsubscribePrefs?.();
    this.unsubscribePrefs = null;
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('beforeunload', this.onUnload);
    this.opts = null;
  }
}

let instance: AutosaveController | null = null;
export function getAutosaveController(): AutosaveController {
  if (!instance) instance = new AutosaveController();
  return instance;
}
