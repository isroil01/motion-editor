import { usePreferenceStore } from '@stores/preferenceStore';
import { getCommandRegistry } from '@core/commands/Command';
import {
  TIMELINE_TOGGLE_SNAP_COMMAND,
  installTimelineSnapCommands,
  isTimelineSnapOn,
  resetTimelineSnapCommandsForTest,
  snapForDrag,
  toggleTimelineSnap,
} from './snapCommands';

describe('timeline snap', () => {
  beforeEach(() => {
    resetTimelineSnapCommandsForTest();
    usePreferenceStore.getState().set('timelineSnap', true);
  });

  it('Alt inverts the switch, whichever way it is set', () => {
    expect(snapForDrag(true, false)).toBe(true);
    expect(snapForDrag(true, true)).toBe(false);
    expect(snapForDrag(false, false)).toBe(false);
    expect(snapForDrag(false, true)).toBe(true);
  });

  it('toggles the persisted preference', () => {
    expect(isTimelineSnapOn()).toBe(true);
    expect(toggleTimelineSnap()).toBe(false);
    expect(usePreferenceStore.getState().timelineSnap).toBe(false);
  });

  it('registers a checkable command with no global chord', () => {
    installTimelineSnapCommands();
    const cmd = getCommandRegistry().get(TIMELINE_TOGGLE_SNAP_COMMAND);
    expect(cmd).toBeDefined();
    expect(cmd?.shortcut).toBeUndefined();
    expect(cmd?.isChecked?.()).toBe(true);
    void cmd?.execute({} as never);
    expect(cmd?.isChecked?.()).toBe(false);
  });
});
