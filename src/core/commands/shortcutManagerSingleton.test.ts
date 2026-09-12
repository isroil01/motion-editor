/**
 * One live shortcut listener per session.
 *
 * Every `ShortcutManager` attaches a window keydown listener in its
 * constructor, and a session builds more than one: `Application.boot` makes a
 * fresh manager each time `Providers` mounts (twice under StrictMode, again on
 * every Dashboard → Editor entry). `setShortcutManager` used to swap only the
 * pointer, so the replaced managers kept listening — every chord ran its
 * command once per leaked manager, and a toggle (Shift+Esc between two comps)
 * ran twice and ended where it began.
 */

import { ShortcutManager, getShortcutManager, setShortcutManager } from './ShortcutManager';

function keydownRemovals(spy: jest.SpyInstance): number {
  return spy.mock.calls.filter(([type]) => type === 'keydown').length;
}

describe('setShortcutManager', () => {
  it('detaches the manager it replaces', () => {
    const remove = jest.spyOn(window, 'removeEventListener');
    const first = new ShortcutManager();
    setShortcutManager(first);
    const second = new ShortcutManager();
    remove.mockClear();

    setShortcutManager(second);

    expect(getShortcutManager()).toBe(second);
    expect(keydownRemovals(remove)).toBe(1);
    second.detach();
    remove.mockRestore();
  });

  it('re-installing the same manager leaves it attached', () => {
    const remove = jest.spyOn(window, 'removeEventListener');
    const manager = new ShortcutManager();
    setShortcutManager(manager);
    remove.mockClear();

    setShortcutManager(manager);

    expect(keydownRemovals(remove)).toBe(0);
    manager.detach();
    remove.mockRestore();
  });
});
