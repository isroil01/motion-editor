/**
 * Empty-state shortcut hints: grouped by where focus was, most specific
 * family first, and only for chords that actually resolve.
 */

import { detectPaletteContext, shortcutHintsFor, type HintCommand } from './shortcutHints';

const CMDS: HintCommand[] = [
  { id: 'tool.select', label: 'Selection Tool', shortcut: { key: 'v' } },
  { id: 'timeline.zoomToFit', label: 'Fit Composition', shortcut: { key: 'f', shift: true } },
  { id: 'edit.undo', label: 'Undo', shortcut: { key: 'z', ctrl: true } },
  { id: 'project.save', label: 'Save', shortcut: { key: 's', ctrl: true } },
  { id: 'layer.newSolid', label: 'Solid…' }, // no chord → never a hint
  { id: 'effect.blur', label: 'Blur', shortcut: { key: 'b', alt: true } }, // no family → never a hint
];

const defaultChord = (c: HintCommand): HintCommand['shortcut'] => c.shortcut;

describe('shortcutHintsFor', () => {
  it('puts the focused surface first, then the global families, and drops the rest', () => {
    const ids = shortcutHintsFor(CMDS, 'viewport', defaultChord).map((h) => h.command.id);
    expect(ids).toEqual(['tool.select', 'edit.undo', 'project.save']);
    const tl = shortcutHintsFor(CMDS, 'timeline', defaultChord).map((h) => h.command.id);
    expect(tl).toEqual(['timeline.zoomToFit', 'edit.undo', 'project.save']);
    const global = shortcutHintsFor(CMDS, 'global', defaultChord).map((h) => h.command.id);
    expect(global).toEqual(['edit.undo', 'project.save']);
  });

  it('shows the resolved chord, and omits a command whose chord was disabled', () => {
    const hints = shortcutHintsFor(CMDS, 'viewport', (c) => (c.id === 'edit.undo' ? undefined : c.shortcut));
    expect(hints.map((h) => h.command.id)).toEqual(['tool.select', 'project.save']);
    expect(hints[0]!.chord).toEqual({ key: 'v' });
  });

  it('honours the limit', () => {
    expect(shortcutHintsFor(CMDS, 'viewport', defaultChord, 1).map((h) => h.command.id)).toEqual(['tool.select']);
  });
});

describe('detectPaletteContext', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('reads the viewport marker and the explicit tag, else global', () => {
    document.body.innerHTML = [
      '<div data-workspace-viewport=""><button id="vp"></button></div>',
      '<div data-palette-context="timeline"><button id="tl"></button></div>',
      '<button id="other"></button>',
    ].join('');
    expect(detectPaletteContext(document.getElementById('vp'))).toBe('viewport');
    expect(detectPaletteContext(document.getElementById('tl'))).toBe('timeline');
    expect(detectPaletteContext(document.getElementById('other'))).toBe('global');
    expect(detectPaletteContext(null)).toBe('global');
  });
});
