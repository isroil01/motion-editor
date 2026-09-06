/**
 * The snap toggle — clip and keyframe snapping as a switch, not only a held
 * key.
 *
 * Alt still INVERTS whatever the switch says: with snapping on, Alt frees a
 * drag as it always did; with it off, Alt snaps the one drag you hold it for.
 * The switch is a preference (`timelineSnap`), so it survives a restart — the
 * magnet is a fact about how you cut, not about the project.
 *
 * The chord is `S` WITH THE TIMELINE FOCUSED: the root claims it through
 * `data-shortcut-claim` and handles the press itself, so the global `S`
 * (reveal Scale) keeps working everywhere else. The command therefore carries
 * no chord of its own — a global binding would take `S` from the viewport.
 */

import { asCommandId } from '@app-types/common';
import { getCommandRegistry, type Command } from '@core/commands/Command';
import { usePreferenceStore } from '@stores/preferenceStore';

export const TIMELINE_TOGGLE_SNAP_COMMAND = asCommandId('timeline.toggleSnap');

export function isTimelineSnapOn(): boolean {
  return usePreferenceStore.getState().timelineSnap;
}

export function setTimelineSnap(on: boolean): void {
  usePreferenceStore.getState().set('timelineSnap', on);
}

export function toggleTimelineSnap(): boolean {
  const next = !isTimelineSnapOn();
  setTimelineSnap(next);
  return next;
}

/**
 * Whether THIS drag snaps: the switch, inverted by Alt.
 * Pure, so the rule is pinned once rather than re-derived in three drags.
 */
export function snapForDrag(snapOn: boolean, altKey: boolean): boolean {
  return snapOn !== altKey;
}

export function buildTimelineSnapCommands(): ReadonlyArray<Command> {
  return [
    {
      id: TIMELINE_TOGGLE_SNAP_COMMAND,
      label: 'Snap in Timeline',
      description: 'Snap clip and keyframe drags to the playhead, edges, markers and the frame grid. Alt inverts it for one drag.',
      icon: 'magnet',
      isChecked: isTimelineSnapOn,
      execute: () => {
        toggleTimelineSnap();
      },
    },
  ];
}

let installed = false;

export function installTimelineSnapCommands(): void {
  if (installed) return;
  installed = true;
  const registry = getCommandRegistry();
  for (const command of buildTimelineSnapCommands()) registry.register(command);
}

export function resetTimelineSnapCommandsForTest(): void {
  installed = false;
}
