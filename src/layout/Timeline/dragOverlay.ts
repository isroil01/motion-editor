/**
 * Drag previews, scoped to the ROWS they touch.
 *
 * A clip or keyframe drag re-renders at pointer rate. Handing the whole
 * preview list (a fresh array or Map per move) to every visible row made every
 * row re-render per move — `areRowPropsEqual` compares by identity, and the
 * identity changed for all of them. These helpers give a row the live preview
 * ONLY when one of its own clips / keyframes is in it, and a shared, stable
 * empty value otherwise, so an untouched row's props are `Object.is`-equal
 * across the drag and its memo holds.
 *
 * Pure, so the contract is pinned by `rowMemo.test.ts` without a DOM.
 */

export interface ClipPreview {
  id: string;
  start: number;
  duration: number;
  sourceInSec?: number;
}

/** The one Map every row without a dragged keyframe shares. Never mutated. */
export const EMPTY_KF_PREVIEW: ReadonlyMap<string, number> = new Map<string, number>();

/** The previews for a row, or `null` when none of `clipIds` is being dragged. */
export function previewsForRow(
  previews: ReadonlyArray<ClipPreview> | null,
  clipIds: ReadonlyArray<{ id: string }> | undefined,
): ReadonlyArray<ClipPreview> | null {
  if (!previews || previews.length === 0 || !clipIds || clipIds.length === 0) return null;
  for (const c of clipIds) for (const p of previews) if (p.id === c.id) return previews;
  return null;
}

/** The live keyframe preview for a row, or the shared empty Map. */
export function kfPreviewForRow(
  preview: ReadonlyMap<string, number>,
  keyframes: ReadonlyArray<{ id: string }>,
): ReadonlyMap<string, number> {
  if (preview.size === 0) return EMPTY_KF_PREVIEW;
  for (const k of keyframes) if (preview.has(k.id)) return preview;
  return EMPTY_KF_PREVIEW;
}
