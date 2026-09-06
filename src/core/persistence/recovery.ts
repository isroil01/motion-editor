/**
 * Crash recovery.
 *
 * A recovery snapshot is a non-destructive copy of the editable state (scene +
 * animation + playhead) written to persistent settings by the autosave loop.
 * On next launch, if one exists, the app offers to restore the exact session.
 * Source assets are never touched — restoring only swaps in-memory state.
 */

import { getSettingsManager } from '@core/services/coreServices';
import { captureDocument, restoreDocument, type EditorDocument } from '@core/api/cloudDocument';
import { baselineHistory } from '@stores/historyStore';
import { type AnimSnapshot } from '@motion/animation';
import { IMPLIED_LEGACY_VERSION } from '@core/project/migrations';
import type { ProjectFile } from '@core/types';

const KEY = 'recovery';

export interface RecoverySnapshot {
  projectId?: string;
  savedAt: number;
  time: number;
  /** Full document (v1.1+). Older snapshots carry only `scene`/`anim`. */
  doc?: EditorDocument;
  scene: ProjectFile;
  anim: AnimSnapshot;
}

/**
 * The editor's project id, read from the route.
 *
 * The app uses a HashRouter, so the route lives in `location.hash` — reading
 * `location.pathname` yielded `/` in dev and the index.html path under
 * Electron's file://, so this never matched and the entire recovery subsystem
 * was inert.
 */
function currentProjectId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const from = (s: string): string | undefined => s.match(/\/editor\/([^/?#]+)/)?.[1];
  return from(window.location.hash) ?? from(window.location.pathname);
}

/** Snapshot the current editable state (deep-cloned). */
export function captureRecovery(time: number): RecoverySnapshot | null {
  const projectId = currentProjectId();
  if (!projectId || projectId.trim() === '') return null;
  const doc = captureDocument();
  return {
    projectId,
    savedAt: 0, // stamped at persist time (Date.now lives at the call site)
    time,
    doc: structuredClone(doc),
    // Kept for snapshots written by older builds / readers.
    scene: structuredClone(doc.scene),
    anim: doc.animation,
  };
}

export function persistRecovery(snap: RecoverySnapshot | null): void {
  if (!snap || !snap.projectId) return;
  getSettingsManager().set(KEY, snap);
  keepRing(snap);
  void copyToFolder(snap);
}

// ── Keep-N ring + folder copy (Preferences ▸ Files) ──────────────────────
//
// `KEY` is always the NEWEST snapshot and is what the launch-time recovery
// offer reads, unchanged. The ring behind it keeps the last N so a snapshot
// that captured a mistake is not the only one there is; and a folder, when
// the user names one on the desktop, receives a JSON copy of each write so
// an autosave survives a wiped settings store too.

const RING_KEY = 'recovery.ring';
export const AUTOSAVE_KEEP_MIN = 1;
export const AUTOSAVE_KEEP_MAX = 50;

/** The preference store, reached lazily (this module is on the boot path). */
function autosavePrefs(): { keep: number; location: string | null } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy seam: this module is on the boot path, see layoutStore.ts
    const { usePreferenceStore } = require('@stores/preferenceStore') as typeof import('@stores/preferenceStore');
    const s = usePreferenceStore.getState();
    const keep = typeof s.autosaveKeep === 'number' && Number.isFinite(s.autosaveKeep)
      ? Math.min(AUTOSAVE_KEEP_MAX, Math.max(AUTOSAVE_KEEP_MIN, Math.round(s.autosaveKeep)))
      : 5;
    return { keep, location: typeof s.autosaveLocation === 'string' && s.autosaveLocation ? s.autosaveLocation : null };
  } catch {
    return { keep: 5, location: null };
  }
}

/** A ring entry is the whole snapshot — light enough at N ≤ 50 for a settings store. */
export function readRecoveryRing(): RecoverySnapshot[] {
  try {
    const v = getSettingsManager().get<RecoverySnapshot[] | null>(RING_KEY, null);
    return Array.isArray(v) ? v.filter((r) => r && typeof r.savedAt === 'number') : [];
  } catch {
    return [];
  }
}

function keepRing(snap: RecoverySnapshot): void {
  try {
    const { keep } = autosavePrefs();
    const ring = [snap, ...readRecoveryRing().filter((r) => r.savedAt !== snap.savedAt)].slice(0, keep);
    getSettingsManager().set(RING_KEY, ring);
  } catch {
    /* the primary snapshot is already written; the ring is a bonus */
  }
}

let ringSlot = 0;

/** Where the folder copy of a snapshot goes: a slot that wraps at keep-N. */
export function autosaveFileName(projectId: string, slot: number): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `${safe}-autosave-${slot}.json`;
}

async function copyToFolder(snap: RecoverySnapshot): Promise<void> {
  const { keep, location } = autosavePrefs();
  if (!location) return;
  const write = typeof window !== 'undefined' ? window.motionEditor?.file?.write : undefined;
  if (!write) return;
  const slot = ringSlot++ % keep;
  const sep = location.includes('\\') ? '\\' : '/';
  const path = `${location.replace(/[\\/]+$/, '')}${sep}${autosaveFileName(snap.projectId ?? 'project', slot)}`;
  try {
    await write(path, JSON.stringify(snap));
  } catch {
    /* an unwritable folder must not stop the in-app snapshot, which already landed */
  }
}

export function readRecovery(): RecoverySnapshot | null {
  const v = getSettingsManager().get<RecoverySnapshot | null>(KEY, null);
  return v && typeof v.savedAt === 'number' && v.scene && typeof v.projectId === 'string' && v.projectId.trim() !== '' ? v : null;
}

export function clearRecovery(): void {
  // The dashboard calls this BEFORE the editor boots (Create & Launch), when
  // core services aren't registered yet — there is nothing to clear then, and
  // throwing here broke the entire launch flow.
  try {
    getSettingsManager().delete(KEY);
  } catch {
    /* app not booted — no settings, so no snapshot to clear */
  }
}

/** Restore a snapshot into the live engines (non-destructive). Returns the time. */
export function restoreRecovery(snap: RecoverySnapshot): number {
  if (snap.doc) {
    restoreDocument(structuredClone(snap.doc));
  } else {
    // Pre-1.1 snapshot: scene + animation only, and no version field — so it is
    // assembled into a document at the implied legacy version and put through
    // the same door every other foreign state uses.
    //
    // It used to call `defaultAnimation.restore` directly, which was harmless
    // only while every schema change happened to be additive. Document 1.6.0
    // changes the SHAPE of `animation.expressions`, and this was the one path
    // from a persisted snapshot to the engine with no migration in between — an
    // old snapshot's expressions would have been silently dropped by the
    // restore that exists to not lose work. Rule 4c asked prospectively: which
    // guard observes this crossing? None did.
    restoreDocument({
      version: IMPLIED_LEGACY_VERSION,
      scene: structuredClone(snap.scene),
      animation: snap.anim,
    });
  }
  // Recovering IS a load: undo must not be able to step behind it into the
  // seeded starter scene captured at boot.
  baselineHistory('Recovered');
  return snap.time;
}
