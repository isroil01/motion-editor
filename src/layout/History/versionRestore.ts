/**
 * Restore a saved version as ONE undoable edit.
 *
 * `versionHistoryStore.restore` goes through the server and then rehydrates
 * the running engines (`restoreDocument` + `bumpScene`). The snapshot history
 * sees that rehydration as ordinary writes, so without care it would be folded
 * into whatever edit was still pending in the debounce window — and one Ctrl+Z
 * would then discard both the restore and the edit before it. Flushing first
 * gives the pending edit its own entry; naming a record afterwards gives the
 * restore its own row, so undo brings the pre-restore document back in one
 * step and the History panel shows "Restore version" rather than "Edit 41".
 */

import { useHistoryStore } from '@stores/historyStore';
import { useVersionHistoryStore } from '@stores/versionHistoryStore';

export async function restoreVersionAsOneEdit(versionId: string): Promise<void> {
  useHistoryStore.getState().flush();
  await useVersionHistoryStore.getState().restore(versionId);
  // A named record always produces a row (see `historyStore.record`); the
  // later debounced auto-record then sees an unchanged state and records
  // nothing, so the restore is exactly one entry.
  useHistoryStore.getState().record('Restore version', true);
}
