/**
 * The backtick key reaches its chord on any layout.
 *
 * ` / Shift+` are the focus-mode chords (AE's maximize-panel key). `e.key` is
 * the PRODUCED character, so Shift+` reports `~` on a US layout and something
 * else again elsewhere; `chordKeyFromEvent` resolves the key from `e.code`, the
 * way it already does for the digit and bracket rows.
 */

import { chordFromEvent } from './CommandSystem';
import { chordKey } from './Command';

function keydown(init: { key: string; code: string; shift?: boolean; ctrl?: boolean }): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: init.key,
    code: init.code,
    shiftKey: init.shift === true,
    ctrlKey: init.ctrl === true,
  });
}

describe('backtick chords', () => {
  it('plain ` is `', () => {
    expect(chordKey(chordFromEvent(keydown({ key: '`', code: 'Backquote' })))).toBe('`');
  });

  it('Shift+` is Shift+` even though the browser reports "~"', () => {
    expect(chordKey(chordFromEvent(keydown({ key: '~', code: 'Backquote', shift: true })))).toBe('Shift+`');
  });

  it('the timeline’s Ctrl+` and Ctrl+Shift+` resolve the same way', () => {
    expect(chordKey(chordFromEvent(keydown({ key: '`', code: 'Backquote', ctrl: true })))).toBe('Ctrl+`');
    expect(chordKey(chordFromEvent(keydown({ key: '~', code: 'Backquote', ctrl: true, shift: true })))).toBe('Ctrl+Shift+`');
  });

  it('leaves a character produced on another key alone', () => {
    expect(chordKey(chordFromEvent(keydown({ key: '~', code: 'KeyN', shift: true })))).toBe('Shift+~');
  });
});
