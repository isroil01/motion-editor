/**
 * Apply-to-"this layer" guard — the decision, kept pure so it can be tested
 * without a scene graph or a modal.
 *
 * The Apply dropdown lists the tracked footage itself, and people pick it by
 * accident: the row reads "(this layer)", it is selected by default, and the
 * button says Apply. Position keyframes on the FOOTAGE move it under its own
 * track — the object the user picked drifts away from where they picked it,
 * which is the one outcome nobody tracking an object wants. The tracker's
 * canonical answer is a null that carries the motion (Create null & apply),
 * so the guard offers that instead of silently writing the keyframes.
 *
 * Stabilize is the deliberate exception: its whole point is inverse motion
 * on this layer, and it never reads the target dropdown at all.
 */

import type { TrackerMode } from '@stores/trackerStore';

/** Modes whose Apply writes the FORWARD track onto the chosen target. */
const TARGETED_MODES: ReadonlySet<TrackerMode> = new Set<TrackerMode>(['follow', 'transform', 'corner']);

/**
 * True when Apply would write a forward track onto the layer the track was
 * measured on. Every other target — a null, a text layer, a camera, another
 * clip — is what the tracker is for, and applies without a question.
 */
export function needsSelfApplyConfirm(args: {
  mode: TrackerMode;
  targetId: string;
  sourceId: string;
}): boolean {
  return TARGETED_MODES.has(args.mode) && args.targetId === args.sourceId;
}

/** The confirm's copy, stated once so the test and the dialog agree. */
export function selfApplyConfirmCopy(args: { mode: TrackerMode; layerName: string }): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  const what =
    args.mode === 'corner'
      ? 'Corner-pin keyframes on it pin the footage to a region of itself'
      : args.mode === 'transform'
        ? 'Position, rotation and scale keyframes on it move the footage under its own track'
        : 'Position keyframes on it move the footage under its own track';
  return {
    title: 'Apply to the tracked footage?',
    message:
      `“${args.layerName}” is the layer this track was measured on. ${what}, so the object ` +
      'you picked drifts away from where you picked it. The usual choice is a null that carries ' +
      'the motion — anything parented to it follows the track. Create one instead?',
    confirmLabel: 'Create null & apply',
  };
}
