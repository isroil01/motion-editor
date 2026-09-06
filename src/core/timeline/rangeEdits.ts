/**
 * Lift, Extract and Ripple Delete — the three ways an NLE removes material.
 *
 * They differ in exactly one thing, and it is worth naming because the words
 * are used loosely everywhere else:
 *
 *   • **Lift**    removes what is inside a time range and LEAVES THE HOLE.
 *                 Everything after it stays where it was, so a cut you were
 *                 happy with three minutes later is still on the same frame.
 *   • **Extract** removes the same material and CLOSES the hole — every bar
 *                 after the range slides left by the range's length.
 *   • **Ripple delete** is Extract addressed by LAYER rather than by range:
 *                 the layer goes and its own track closes up behind it.
 *
 * ## Why this is not in the Timeline package
 *
 * Removing a range is not one edit. It splits every bar that straddles either
 * boundary, deletes the pieces that fall inside, and (Extract) slides the rest.
 * The splits create SCENE NODES that did not exist when the operation began, so
 * the engine's own command history — which records clip geometry and nothing
 * else — cannot describe the inverse. `runAsOneHistoryEntry` captures the whole
 * document before and after instead, which is the same route
 * `transcriptOps.deleteTimeRanges` takes for the same reason, and the reason
 * `TimelineController.splitLayerAtFrame` documents at length.
 *
 * ## Frames, not seconds, at the boundary
 *
 * Bars are frames (`Clip.start/duration`, `Layer.start/end`, end EXCLUSIVE);
 * the range arrives in comp seconds because that is what the playhead, the work
 * area and the transcript all speak. The conversion happens ONCE, here, and
 * every comparison below is integer-on-integer — a half-frame boundary is the
 * classic way a cut lands one frame early on some layers and not others.
 */

import { getTimelineController } from './TimelineController';
import { activeCompRootId } from '@core/scene/activeComp';
import { runAsOneHistoryEntry } from '@core/composition/compositeEdit';

/** A half-open span of COMPOSITION seconds. */
export interface RangeSeconds {
  start: number;
  end: number;
}

export interface RangeEditResult {
  /** Comp seconds the edit removed (0 when nothing was in the range). */
  removedSeconds: number;
  /** Bars cut at a range boundary. */
  splits: number;
  /** Bar pieces removed outright. */
  deletedClips: number;
  /** Bars slid left to close the gap. Always 0 for a lift. */
  rippled: number;
}

const EMPTY: RangeEditResult = { removedSeconds: 0, splits: 0, deletedClips: 0, rippled: 0 };

/**
 * Whether a bar lies wholly inside `[startF, endF)`.
 *
 * Pure and exported because it is the one predicate that decides whether a
 * piece is deleted or kept, and getting it wrong by one frame either orphans a
 * one-frame sliver at each boundary or eats a frame the user could see. `end`
 * is EXCLUSIVE on both sides, so a bar ending exactly at `endF` is inside.
 */
export function barIsInsideRange(
  bar: { start: number; end: number },
  startF: number,
  endF: number,
): boolean {
  return bar.start >= startF && bar.end <= endF;
}

/** Whether a boundary falls strictly inside a bar, i.e. the bar must be split. */
export function barStraddles(bar: { start: number; end: number }, frame: number): boolean {
  return bar.start < frame && bar.end > frame;
}

/**
 * Remove a comp-time range.
 *
 * `ripple` is the ONLY difference between Lift and Extract — see the header —
 * so they share one implementation rather than two that drift.
 *
 * `nodeIds`, when non-empty, restricts the edit to those scene nodes. Empty (the
 * default) means every unlocked bar the range crosses, which is what "remove
 * this moment" means: the picture, its separate audio, and the title over it.
 */
export async function removeRange(
  range: RangeSeconds,
  opts: { ripple: boolean; nodeIds?: readonly string[]; label?: string } = { ripple: false },
): Promise<RangeEditResult> {
  const controller = getTimelineController();
  const rootId = activeCompRootId();
  const fps = controller.fps || 30;
  const startF = Math.round(range.start * fps);
  const endF = Math.round(range.end * fps);
  // Nothing to remove in less than a frame. Rounding UP would eat a frame the
  // user can see, which is worse than refusing an edit they cannot express.
  if (endF <= startF) return EMPTY;

  const restrict = opts.nodeIds && opts.nodeIds.length > 0 ? new Set(opts.nodeIds) : null;
  const cuttable = (sourceId: string | null): boolean =>
    !restrict || (sourceId !== null && restrict.has(sourceId));

  const label = opts.label ?? (opts.ripple ? 'Extract' : 'Lift');

  return runAsOneHistoryEntry(label, () => {
    const result: RangeEditResult = {
      removedSeconds: (endF - startF) / fps,
      splits: 0,
      deletedClips: 0,
      rippled: 0,
    };

    // Two passes over the boundaries, not one: splitting at the IN point
    // CREATES the bar that then has to be split at the OUT point, and a single
    // pass over a snapshot of the list would never see it.
    for (const edge of [startF, endF]) {
      for (const layer of [...controller.layersOfComp(rootId)]) {
        if (layer.locked || !cuttable(layer.sourceId)) continue;
        if (barStraddles(layer, edge) && controller.splitClip(layer.id, edge / fps)) {
          result.splits += 1;
        }
      }
    }

    for (const layer of [...controller.layersOfComp(rootId)]) {
      if (layer.locked || !cuttable(layer.sourceId)) continue;
      if (barIsInsideRange(layer, startF, endF)) {
        // Never `rippleDeleteLayer` here: the ripple is applied once, below,
        // across EVERY bar. Per-layer rippling would slide the same bar twice
        // when two pieces of it fell inside the range.
        if (controller.deleteLayerForClip(layer.id, { ripple: false })) result.deletedClips += 1;
      }
    }

    if (opts.ripple) {
      const gap = endF - startF;
      for (const layer of [...controller.layersOfComp(rootId)]) {
        // Locked bars stay put — the engine refuses to move them anyway, and
        // counting them would report a shift that did not happen.
        if (layer.locked || layer.start < endF) continue;
        controller.setClipStart(layer.id, Math.max(0, layer.start - gap) / fps);
        result.rippled += 1;
      }
    }

    controller.invalidateLayerIndex();
    return result;
  });
}

/** Remove the range and leave the hole. */
export function liftRange(range: RangeSeconds, nodeIds?: readonly string[]): Promise<RangeEditResult> {
  return removeRange(range, { ripple: false, nodeIds, label: 'Lift' });
}

/** Remove the range and close the hole. */
export function extractRange(range: RangeSeconds, nodeIds?: readonly string[]): Promise<RangeEditResult> {
  return removeRange(range, { ripple: true, nodeIds, label: 'Extract' });
}

/**
 * The range Lift / Extract act on: the work area if there is one, otherwise
 * null.
 *
 * Deliberately NOT "the playhead to the end" as a fallback. A silent fallback
 * to a range the user never set is how a keystroke aimed at two seconds removes
 * the second half of a composition; refusing, and saying why, is the honest
 * answer.
 */
export function workAreaRange(): RangeSeconds | null {
  const wa = getTimelineController().getWorkArea();
  if (!wa || wa.end - wa.start <= 0) return null;
  return { start: wa.start, end: wa.end };
}
