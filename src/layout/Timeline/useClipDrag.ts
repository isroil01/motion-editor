/**
 * Clip bar gestures — move, trim (with ripple), slip, slide and roll — moved
 * whole out of `Timeline.tsx`. The composer passes in the refs it shares with
 * the razor, the transitions and the auto-follow; the hook owns the drag state
 * and hands back the preview bars, the snap line and the pointer-down.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { collectClipSnapTargets, snapClipEdges, type ClipSnapTarget } from './clipSnap';
import { findClipCutNear, type ClipCut } from './clipCuts';
import { getTimelineController } from '@core/timeline/TimelineController';
import { clamp } from '@utils/lang';
import type { TimelineModel, TimelineClip } from './TimelineModel';
import { exceedsDragThreshold } from './marqueeSelection';
import { createEdgeAutoScroller } from './playheadFollow';
import { snapForDrag } from './snapCommands';
import { ROLL_GRAB_PX } from './timelineShared';
import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import { hudLines, type DragHudState } from './DragHudOverlay';
import type { TimelineEditMode } from './timelineEditMode';
import type { TimelineProps } from './Timeline';

/** Everything a clip drag needs to build its snap targets, refreshed each render. */
export interface ClipSnapCtx {
  tracks: TimelineModel['tracks'];
  markers: TimelineModel['markers'];
  workArea: TimelineModel['workArea'];
  currentTime: number;
  duration: number;
}

export interface UseClipDragArgs {
  model: TimelineModel;
  pps: number;
  totalSeconds: number;
  snapOn: boolean;
  editMode: TimelineEditMode;
  lanesRef: MutableRefObject<HTMLDivElement | null>;
  lanesTimeAt: (clientX: number) => number | null;
  razorAtTime: (time: number, all: boolean, clipId?: string) => void;
  snapRazorTime: (time: number) => number;
  clipCutsRef: MutableRefObject<ReadonlyArray<ClipCut>>;
  clipSnapCtx: MutableRefObject<ClipSnapCtx>;
  fpsRef: MutableRefObject<number>;
  dragScrollBusyRef: MutableRefObject<boolean>;
  edgeScrollerRef: MutableRefObject<ReturnType<typeof createEdgeAutoScroller> | null>;
  lastDragEventRef: MutableRefObject<PointerEvent | null>;
  setDragHud: Dispatch<SetStateAction<DragHudState | null>>;
  selectedTrackIds: TimelineProps['selectedTrackIds'];
  onTrackSelect: TimelineProps['onTrackSelect'];
  onClipMove: TimelineProps['onClipMove'];
  onClipTrim: TimelineProps['onClipTrim'];
  onClipSlip: TimelineProps['onClipSlip'];
  onClipSlide: TimelineProps['onClipSlide'];
}

export function useClipDrag({
  model,
  pps,
  totalSeconds,
  snapOn,
  editMode,
  lanesRef,
  lanesTimeAt,
  razorAtTime,
  snapRazorTime,
  clipCutsRef,
  clipSnapCtx,
  fpsRef,
  dragScrollBusyRef,
  edgeScrollerRef,
  lastDragEventRef,
  setDragHud,
  selectedTrackIds,
  onTrackSelect,
  onClipMove,
  onClipTrim,
  onClipSlip,
  onClipSlide,
}: UseClipDragArgs) {
  // ── Clip drag (body = move; Alt+body = slip; Shift+Alt = slide; edges = trim) ──
  // Live geometry lives on the ref (survives without a render); a preview state
  // drives the visual; the engine is only told the final value on release.
  const clipDrag = useRef<
    null | {
      id: string;
      /** Scene node behind the bar — the unit selection actually addresses. */
      trackId: string;
      /** Set when pointer-down landed on an ALREADY-selected bar: the
       *  selection collapses to it on release, but only if no drag happened. */
      collapseSelectionOnUp: boolean;
      /** Client-space pointer-down origin, for the click-vs-drag threshold. */
      downX: number;
      downY: number;
      /** Set once the pointer travels past the drag threshold. */
      moved: boolean;
      mode: 'move' | 'start' | 'end' | 'slip' | 'slide' | 'roll';
      ripple: boolean;
      startX: number;
      start: number;
      duration: number;
      sourceInSec: number;
      live: { start: number; duration: number; sourceInSec: number };
      /**
       * ROLL only — the cut being dragged and how far it may travel.
       *
       * The limits come from the ENGINE at pointer-down (`rollLimitsFor`), not
       * from the view model, because only the engine knows the source handles:
       * a bar's `sourceInSec`/`sourceOutSec` say where its window is but not how
       * much media lies outside it. Clamping the preview to anything else means
       * the bars move under the pointer and then snap back on release, which
       * reads as a bug rather than as a limit.
       */
      roll?: {
        cut: ClipCut;
        /** Frames, converted to seconds at the comp rate. */
        minSec: number;
        maxSec: number;
        left: { start: number; duration: number; sourceInSec: number };
        right: { start: number; duration: number; sourceInSec: number };
        /** Applied delta in seconds, updated as the pointer moves. */
        deltaSec: number;
      };
      /**
       * What this drag may latch onto, snapshotted at pointer-DOWN.
       *
       * The list cannot change mid-gesture (no clip but this one is moving, and
       * markers/work area are not editable during a drag), and rebuilding it on
       * every pointermove would walk every clip on every track at pointer rate.
       */
      snapTargets: readonly ClipSnapTarget[];
    }
  >(null);
  /** What the in-flight clip drag is latched onto — drives the guide line. */
  const [clipSnap, setClipSnap] = useState<ClipSnapTarget | null>(null);
  /** Mirror of `clipSnap`, so pointermove can skip a re-render when the latch
   *  has not actually changed — this runs at pointer rate. */
  const clipSnapShown = useRef<ClipSnapTarget | null>(null);
  /**
   * The in-flight drag's bars, drawn instead of the model's until release.
   *
   * A LIST, not one bar: a roll moves two of them at once, and previewing only
   * the one under the pointer would show the cut opening a gap that the commit
   * then does not produce. Every other gesture pushes a single entry.
   */
  const [clipPreviews, setClipPreviews] = useState<null | ReadonlyArray<{
    id: string;
    start: number;
    duration: number;
    sourceInSec?: number;
  }>>(null);

  const onClipDown = useCallback(
    (clip: TimelineClip, mode: 'move' | 'start' | 'end', e: ReactPointerEvent<HTMLDivElement>, locked = false) => {
      // Selection happens even when no clip-edit handler is wired: clicking a
      // bar in the lanes is how most people reach for a layer, and requiring
      // them to travel back to the name column for it was the single most
      // repeated complaint about the timeline. Runs BEFORE the drag guard so
      // a read-only timeline still selects.
      //
      // Deferred-collapse rules (standard for draggable rows):
      //   • additive modifier      → add to the selection now
      //   • bar not yet selected   → select it now, so the drag moves the
      //                              thing under the cursor
      //   • bar already selected   → wait for pointer-up: collapsing a
      //                              multi-selection on pointer-DOWN would
      //                              make a group impossible to drag
      // RAZOR intercepts the press entirely: it is a click, not a drag, and it
      // must not also select or start a move on the bar it is about to destroy.
      if (editMode === 'razor') {
        e.stopPropagation();
        e.preventDefault();
        const raw = lanesTimeAt(e.clientX);
        if (raw === null) return;
        razorAtTime(snapRazorTime(raw), e.shiftKey, clip.id);
        return;
      }

      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      const alreadySelected = selectedTrackIds?.includes(clip.trackId) ?? false;
      let collapseSelectionOnUp = false;
      if (onTrackSelect) {
        if (additive || !alreadySelected) onTrackSelect(clip.trackId, additive);
        else collapseSelectionOnUp = true;
      }

      // A LOCKED layer still selects — you can point at it — but no drag
      // starts. The controller refused the edit on release before; the bar
      // followed the pointer for a second and snapped back, which reads as
      // a bug rather than as a lock. The cursor says so (`.clipLocked`).
      if (locked || (!onClipMove && !onClipTrim && !onClipSlip && !onClipSlide) || !lanesRef.current) {
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      // What this press means, in priority order:
      //   • an armed TOOL (slip / slide / roll), for a press on the body;
      //   • otherwise the modifiers, unchanged: Alt = slip, Alt+Shift = slide.
      // Edge presses stay trims in every mode — an edge handle has exactly one
      // meaning, and hijacking it would leave trim unreachable while a tool is
      // armed for no gain.
      let actualMode: 'move' | 'start' | 'end' | 'slip' | 'slide' | 'roll' = mode;
      let rollState: NonNullable<NonNullable<typeof clipDrag.current>['roll']> | undefined;
      if (mode === 'move' && editMode === 'slip' && onClipSlip) actualMode = 'slip';
      else if (mode === 'move' && editMode === 'slide' && onClipSlide) actualMode = 'slide';
      else if (mode === 'move' && editMode === 'roll') {
        // A roll needs a CUT, not a clip: the press only counts when it lands
        // within a few pixels of one. Anywhere else on the bar there is nothing
        // to roll, so the gesture is refused rather than silently downgraded to
        // a move the user did not ask for.
        const raw = lanesTimeAt(e.clientX);
        const cut =
          raw === null
            ? null
            : findClipCutNear(
                clipCutsRef.current,
                raw,
                pps > 0 ? ROLL_GRAB_PX / pps : 0,
                clip.trackId,
              );
        if (!cut) return;
        const limits = getTimelineController().rollLimitsFor(cut.leftNodeId, cut.rightNodeId);
        if (!limits) return;
        const fps = model.frameRate || 30;
        const bars = new Map<string, TimelineClip>();
        for (const t of model.tracks) for (const c of t.clips ?? []) bars.set(c.id, c);
        const leftBar = bars.get(cut.leftClipId);
        const rightBar = bars.get(cut.rightClipId);
        if (!leftBar || !rightBar) return;
        actualMode = 'roll';
        rollState = {
          cut,
          minSec: limits.min / fps,
          maxSec: limits.max / fps,
          left: { start: leftBar.start, duration: leftBar.duration, sourceInSec: leftBar.sourceInSec ?? 0 },
          right: { start: rightBar.start, duration: rightBar.duration, sourceInSec: rightBar.sourceInSec ?? 0 },
          deltaSec: 0,
        };
      } else if (mode === 'move' && e.altKey && e.shiftKey && onClipSlide) actualMode = 'slide';
      else if (mode === 'move' && e.altKey && onClipSlip) actualMode = 'slip';
      const lanesRect = lanesRef.current.getBoundingClientRect();
      const sourceInSec = clip.sourceInSec ?? 0;
      clipDrag.current = {
        id: clip.id,
        trackId: clip.trackId,
        collapseSelectionOnUp,
        downX: e.clientX,
        downY: e.clientY,
        moved: false,
        mode: actualMode,
        // Ctrl/Cmd on an edge → ripple trim (in or out).
        ripple: (actualMode === 'start' || actualMode === 'end') && (e.ctrlKey || e.metaKey),
        startX: e.clientX - lanesRect.left + lanesRef.current.scrollLeft,
        start: clip.start,
        duration: clip.duration,
        sourceInSec,
        live: { start: clip.start, duration: clip.duration, sourceInSec },
        ...(rollState ? { roll: rollState } : {}),
        // The dragged bar is excluded from its own target list — otherwise its
        // start would pull it straight back to where it began and the bar would
        // be immovable inside one snap radius.
        snapTargets: collectClipSnapTargets({
          tracks: clipSnapCtx.current.tracks,
          excludeClipIds: [clip.id],
          playheadTime: clipSnapCtx.current.currentTime,
          markers: clipSnapCtx.current.markers,
          workArea: clipSnapCtx.current.workArea ?? null,
          compDuration: clipSnapCtx.current.duration,
        }),
      };
      setClipPreviews(
        rollState
          ? [
            { id: rollState.cut.leftClipId, ...rollState.left },
            { id: rollState.cut.rightClipId, ...rollState.right },
          ]
          : [{ id: clip.id, start: clip.start, duration: clip.duration, sourceInSec }],
      );
      try {
        lanesRef.current.setPointerCapture(e.pointerId);
      } catch {
        /* best-effort capture */
      }
      document.body.style.userSelect = 'none';
      // `col-resize` for a roll and `ew-resize` for the other two: a roll moves
      // a BOUNDARY between two things, which is the one cursor the platform
      // already has a glyph for, and the difference is what tells you at a
      // glance which of the two you have hold of.
      document.body.style.cursor =
        actualMode === 'roll'
          ? 'col-resize'
          : actualMode === 'slip' || actualMode === 'slide'
            ? 'ew-resize'
            : '';
    },
    [
      onClipMove, onClipTrim, onClipSlip, onClipSlide, onTrackSelect, selectedTrackIds,
      editMode, lanesTimeAt, razorAtTime, snapRazorTime, model.tracks, model.frameRate, pps,
      // Stable for the life of the composer (refs); listed so the array is honest.
      clipCutsRef, clipSnapCtx, lanesRef,
    ],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const d = clipDrag.current;
      if (!d || !lanesRef.current) return;
      // Threshold, not "any pointermove": trackpads and high-DPI mice emit
      // sub-pixel moves during an ordinary click, and treating those as a drag
      // swallowed the collapse-selection-on-release case below.
      if (!d.moved && exceedsDragThreshold(e.clientX - d.downX, e.clientY - d.downY)) d.moved = true;
      /*
        Edge auto-scroll: a drag that reaches within 24px of a lane edge keeps
        scrolling on its own. Without it, moving a clip past the right edge of
        the panel meant dropping it, scrolling, picking it up again — and at any
        real zoom the destination is almost always off screen.

        The scroller re-runs THIS handler after each step (`onScrolled` replays
        the last pointer event), because the pointer has not moved but the
        content under it has, and the drag is measured in content pixels.
      */
      if (d.moved) {
        dragScrollBusyRef.current = true;
        if (!edgeScrollerRef.current) {
          edgeScrollerRef.current = createEdgeAutoScroller(
            lanesRef.current,
            () => {
              const last = lastDragEventRef.current;
              if (last) onMove(last);
            },
            { axes: 'x' },
          );
        }
        lastDragEventRef.current = e;
        edgeScrollerRef.current.update(e.clientX, e.clientY);
      }
      const lanesRect = lanesRef.current.getBoundingClientRect();
      const currentScrollLeft = lanesRef.current.scrollLeft;
      const deltaSec = (e.clientX - lanesRect.left + currentScrollLeft - d.startX) / pps;
      const frameDur = 1 / (model.frameRate || 30);
      const minGap = frameDur;
      // Snapping. The frame grid is the LAST resort inside `snapClipEdges`, so
      // a drag that latches onto nothing still quantizes exactly as it always
      // did (the engine stores whole frames, so an unsnapped preview visibly
      // jumped on release) — but a bar that comes within a few pixels of a
      // neighbour's edge, the playhead, a marker or a work-area bound now lands
      // on it exactly, which is the alignment people were doing by eye.
      //
      // The snap SWITCH says whether this drag snaps; Alt inverts it for the
      // one drag. Slip and slide always snap, because Alt is the modifier that
      // CHOSE those modes and cannot also mean "no snap".
      const snapDisabled =
        d.mode !== 'slip' && d.mode !== 'slide' && d.mode !== 'roll' && !snapForDrag(snapOn, e.altKey);
      const snapOpts = { pixelsPerSecond: pps, frameDuration: frameDur, disabled: snapDisabled };
      const snapToFrame = (v: number): number =>
        snapDisabled || frameDur <= 0 ? v : Math.round(v / frameDur) * frameDur;
      // Boxed so TypeScript keeps the declared type: a plain `let` written only
      // from inside `snapBody` narrows to `never` at the read site below.
      const hit: { target: ClipSnapTarget | null } = { target: null };
      /** Snap a set of MOVING edges as one body; returns the offset to apply. */
      const snapBody = (edges: readonly number[]): number => {
        const { delta, target } = snapClipEdges(edges, d.snapTargets, snapOpts);
        // No guide line for the frame grid: it is quantization, not an
        // alignment the user was aiming at, and a line on every drag would be
        // noise. Same rule as the keyframe snapper's indicator.
        hit.target = target && target.kind !== 'frame' ? target : null;
        return delta;
      };
      let start = d.start;
      let duration = d.duration;
      let sourceInSec = d.sourceInSec;
      // AE semantics: clip bars may OVERHANG the composition end freely (the
      // render simply stops at the comp bound) — only the left edge pins at 0.
      // Clamping to totalSeconds made full-comp clips immovable and turned
      // every "expand" gesture into a shrink.
      if (d.mode === 'slip') {
        // Drag right → later into the source (positive sourceIn), matching AE.
        // Frame grid only: slip does not move the BAR, so there is no edge to
        // align with anything on the timeline axis.
        sourceInSec = snapToFrame(Math.max(0, d.sourceInSec + deltaSec));
      } else if (d.mode === 'move' || d.mode === 'slide') {
        const rawStart = Math.max(0, d.start + deltaSec);
        // Both edges are candidates — a bar is just as often butted up by its
        // tail as by its head, and only trying the head would make the common
        // "snap the out-point to the playhead" gesture impossible.
        start = Math.max(0, rawStart + snapBody([rawStart, rawStart + d.duration]));
      } else if (d.mode === 'start') {
        const end = d.start + d.duration;
        const raw = clamp(d.start + deltaSec, 0, end - minGap);
        start = clamp(raw + snapBody([raw]), 0, end - minGap);
        duration = end - start;
      } else if (d.mode === 'end') {
        const raw = Math.max(d.start + minGap, d.start + d.duration + deltaSec);
        const end = Math.max(d.start + minGap, raw + snapBody([raw]));
        duration = Math.max(minGap, end - d.start);
      }
      // A ROLL deliberately falls through all of these. It was reaching the
      // final branch back when that branch was a bare `else`, which trimmed the
      // dragged bar's tail AND lit the snap guide for an edge that was never
      // moving — the roll's own geometry, computed below, then overwrote the
      // preview and hid the damage until release.
      // Only while the gesture is a real drag: a guide flashing under a plain
      // click on a bar would be feedback for an edit that never happened.
      const nextSnap = d.moved ? hit.target : null;
      if ((nextSnap?.time ?? null) !== (clipSnapShown.current?.time ?? null) ||
          (nextSnap?.kind ?? null) !== (clipSnapShown.current?.kind ?? null)) {
        clipSnapShown.current = nextSnap;
        setClipSnap(nextSnap);
      }
      if (d.mode === 'roll' && d.roll) {
        // Clamped to the ENGINE's limits, so the two bars stop exactly where
        // the commit will stop them. Snapped to the frame grid only: a cut has
        // no free edge to align against — both of its sides are moving, and the
        // things it could latch onto are the very bars it is made of.
        const r = d.roll;
        const wanted = clamp(snapToFrame(deltaSec), r.minSec, r.maxSec);
        r.deltaSec = wanted;
        setClipPreviews([
          { id: r.cut.leftClipId, start: r.left.start, duration: r.left.duration + wanted, sourceInSec: r.left.sourceInSec },
          {
            id: r.cut.rightClipId,
            start: r.right.start + wanted,
            duration: r.right.duration - wanted,
            sourceInSec: r.right.sourceInSec + wanted,
          },
        ]);
      } else {
        d.live = { start, duration, sourceInSec };
        setClipPreviews([{ id: d.id, start, duration, sourceInSec }]);
      }

      // The read-out. Only for the three edits whose effect is otherwise
      // invisible, and only once the gesture is a real drag — a badge under a
      // plain click would be feedback for an edit that never happened.
      if (d.moved && (d.mode === 'slip' || d.mode === 'slide' || d.mode === 'roll')) {
        setDragHud({ x: e.clientX, y: e.clientY, lines: hudLines(d, fpsRef.current) });
      }
    };
    const onUp = (): void => {
      edgeScrollerRef.current?.stop();
      edgeScrollerRef.current = null;
      lastDragEventRef.current = null;
      dragScrollBusyRef.current = false;
      const d = clipDrag.current;
      if (!d) return;
      if (clipSnapShown.current) {
        clipSnapShown.current = null;
        setClipSnap(null);
      }
      // A click that never became a drag on an already-selected bar collapses
      // the selection down to it (the deferred half of the rule in onClipDown).
      if (d.collapseSelectionOnUp && !d.moved) onTrackSelect?.(d.trackId, false);
      const { start, duration, sourceInSec } = d.live;
      // Below the drag threshold this was a SELECT, not an edit. Committing
      // anyway pushed an identity move onto the undo stack, so every click on
      // a bar cost the user one Ctrl+Z before their real edit.
      if (!d.moved) {
        clipDrag.current = null;
        setClipPreviews(null);
        setDragHud(null);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        return;
      }
      if (d.mode === 'roll') {
        // Straight to the controller, like the razor and for the same reason:
        // a roll is one edit over TWO bars on two different scene nodes, which
        // none of this component's per-clip callbacks can express.
        if (d.roll && d.roll.deltaSec !== 0) {
          getTimelineController().rollEditSeconds(
            d.roll.cut.leftNodeId,
            d.roll.cut.rightNodeId,
            d.roll.deltaSec,
          );
        }
      } else if (d.mode === 'slip') onClipSlip?.(d.id, sourceInSec);
      else if (d.mode === 'slide') onClipSlide?.(d.id, start);
      else if (d.mode === 'move') onClipMove?.(d.id, start);
      else if (d.mode === 'start') onClipTrim?.(d.id, 'start', start, { ripple: d.ripple });
      else onClipTrim?.(d.id, 'end', start + duration, { ripple: d.ripple });
      clipDrag.current = null;
      setClipPreviews(null);
      setDragHud(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (clipDrag.current) {
        clipDrag.current = null;
        clipSnapShown.current = null;
        setClipSnap(null);
        setDragHud(null);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, [
    pps, totalSeconds, onClipMove, onClipTrim, onClipSlip, onClipSlide, onTrackSelect, model.frameRate, snapOn,
    // Stable for the life of the composer (refs + a state setter); listed so the array is honest.
    dragScrollBusyRef, edgeScrollerRef, fpsRef, lanesRef, lastDragEventRef, setDragHud,
  ]);

  return { clipSnap, clipPreviews, onClipDown };
}
