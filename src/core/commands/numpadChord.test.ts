/**
 * The numpad is a separate keyboard.
 *
 * After Effects' audio shortcuts depend on this and nothing else does: Numpad
 * `.` is "preview only audio", while `.` on the main keyboard must stay an
 * ordinary full stop. `KeyboardEvent.key` reports both as '.', so the pair can
 * only be told apart by `code` — and if that ever regresses, the failure is
 * silent and nasty: typing a full stop into a text field would start a preview.
 *
 * Numpad digits and Enter are deliberately NOT remapped. They are widely used
 * as plain digits and Enter (the pen tool claims `NumpadEnter` by name), and
 * renaming them would break existing bindings for anyone on a full keyboard.
 */

import { chordFromEvent } from './CommandSystem';

const ev = (init: { key: string; code?: string; alt?: boolean }): KeyboardEvent =>
  ({
    key: init.key,
    code: init.code ?? '',
    ctrlKey: false,
    metaKey: false,
    altKey: init.alt ?? false,
    shiftKey: false,
  }) as KeyboardEvent;

describe('chordFromEvent separates the numpad', () => {
  it('names Numpad . distinctly from the main-keyboard full stop', () => {
    expect(chordFromEvent(ev({ key: '.', code: 'NumpadDecimal' })).key).toBe('Numpad.');
    expect(chordFromEvent(ev({ key: '.', code: 'Period' })).key).toBe('.');
  });

  it('names Numpad * distinctly from Shift+8', () => {
    expect(chordFromEvent(ev({ key: '*', code: 'NumpadMultiply' })).key).toBe('Numpad*');
    // Shift+8 normalises to '8' — the pre-existing Digit rule, so that a
    // shortcut bound to a digit fires whatever the shift state and the layout.
    // Either way it is NOT 'Numpad*', which is all this pair has to guarantee.
    expect(chordFromEvent(ev({ key: '*', code: 'Digit8' })).key).toBe('8');
  });

  it('carries modifiers through, so Alt+Numpad . is its own chord', () => {
    const c = chordFromEvent(ev({ key: '.', code: 'NumpadDecimal', alt: true }));
    expect(c).toMatchObject({ key: 'Numpad.', alt: true });
  });

  it('leaves numpad digits and Enter alone', () => {
    // Digit remapping already exists for the MAIN row (Digit1 when the layout
    // reports something else); the numpad must not join it.
    expect(chordFromEvent(ev({ key: '1', code: 'Numpad1' })).key).toBe('1');
    expect(chordFromEvent(ev({ key: 'Enter', code: 'NumpadEnter' })).key).toBe('Enter');
    expect(chordFromEvent(ev({ key: '+', code: 'NumpadAdd' })).key).toBe('+');
  });
});
