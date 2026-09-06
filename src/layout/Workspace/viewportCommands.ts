/**
 * The viewport's commands — everything the comp viewer does that deserves a
 * key, a palette entry or a menu row: JKL shuttle and in/out marks (the
 * shared transport controller), snapshot compare, camera bookmarks, guide
 * lock / clear / show, display modes, the HUD, snap-to-pixel, PAR
 * correction, the viewer LUT, the Roto Brush tool and the inline AI prompt.
 *
 * Registered from `Workspace.tsx` (mounted once per editor), the same pattern
 * as `previewCacheCommands`. Menu rows are NOT added here — `menuModel.ts` is
 * not this directory's to edit — the rows wanted are listed at the bottom.
 *
 * ## Chords that share a key
 *
 * `K` is also the Knife tool (`tool.knife` in `Providers.tsx`) and `F6` the
 * Render Queue. `ShortcutManager` dispatches the most recently registered
 * ENABLED binding for a chord and lets a disabled one fall through, so a
 * command that returns false from `enabled()` hands the key back.
 *
 * J and L collide with nothing, so they take the permissive rule: the
 * viewport or its transport bar has focus, OR nothing has focus, OR a shuttle
 * is already running.
 *
 * K takes a STRICTER one — a running shuttle, or real focus in the viewport.
 * The permissive rule would have been wrong for it: "nothing has focus" is the
 * app's ordinary resting state, so K would have been taken from the Knife
 * essentially always, and a niche tool would have lost its key to a transport
 * nobody had started. Under the strict rule, K stops a shuttle the instant
 * there is one to stop (pressing J or L is how you get one), and otherwise
 * cuts a path exactly as it did before.
 *
 * `F6` shows the comparison only once a snapshot exists; with none, the
 * Render Queue keeps the key.
 */

import { asCommandId } from '@app-types/common';
import { getCommandRegistry, type Command } from '@core/commands/Command';
import { getShortcutManager } from '@core/commands/ShortcutManager';
import { aiEnabled } from '@core/config/edition';
import { getWorkspaceController } from '@core/workspace/WorkspaceController';
import {
  getCompositionShuttle,
  markIn,
  markOut,
  goToIn,
  goToOut,
  clearInOut,
  hasInOut,
  installAudioScrub,
  isAudioScrubEnabled,
  setAudioScrubEnabled,
} from '@core/timeline/transportController';
import {
  BOOKMARK_SLOTS,
  bookmarkAt,
  recallCameraBookmark,
  saveCameraBookmark,
} from '@core/workspace/cameraBookmarks';
import { useCompareStore, canCompare, COMPARE_MODE_LABEL, type CompareMode } from '@stores/compareStore';
import { useGuidesStore } from '@stores/guidesStore';
import { useSelectionStore } from '@stores/selectionStore';
import { useUIStore } from '@stores/uiStore';
import { useViewportDisplayStore, DISPLAY_MODE_LABEL, type DisplayMode } from '@stores/viewportDisplayStore';
import { useViewerLutStore } from '@stores/viewerLutStore';
import { openViewerLutPicker } from './viewerLutPicker';
import { openInlineAiPrompt } from './inlineAiPromptStore';

export const VIEWPORT_COMMAND_IDS = {
  shuttleReverse: 'transport.shuttleReverse',
  shuttleStop: 'transport.shuttleStop',
  shuttleForward: 'transport.shuttleForward',
  markIn: 'transport.markIn',
  markOut: 'transport.markOut',
  goToIn: 'transport.goToIn',
  goToOut: 'transport.goToOut',
  clearInOut: 'transport.clearInOut',
  audioScrub: 'transport.audioScrub',
  snapshot: 'view.snapshot',
  compareToggle: 'view.compareToggle',
  compareFlip: 'view.compareFlip',
  compareClear: 'view.compareClear',
  compareMode: (m: CompareMode) => `view.compareMode.${m}`,
  bookmarkRecall: (n: number) => `view.cameraBookmark.recall${n}`,
  bookmarkSave: (n: number) => `view.cameraBookmark.save${n}`,
  guidesLock: 'view.guides.lockAll',
  guidesUnlock: 'view.guides.unlockAll',
  guidesClear: 'view.guides.clear',
  guidesShow: 'view.guides.show',
  displayMode: (m: DisplayMode) => `view.displayMode.${m}`,
  displayModeCycle: 'view.displayMode.cycle',
  hud: 'view.hud',
  snapToPixel: 'view.snapToPixel',
  pixelAspectCorrection: 'view.pixelAspectCorrection',
  viewerLutLoad: 'view.viewerLut.load',
  viewerLutClear: 'view.viewerLut.clear',
  rotoTool: 'tool.roto',
  inlineAiPrompt: 'ai.inlinePrompt',
} as const;

/**
 * Whether the comp transport may take J/K/L right now — see the header.
 * Exported for the test; reads the DOM, so a headless caller gets `true`
 * whenever a shuttle is running and otherwise "nothing has focus".
 */
export function transportChordsActive(): boolean {
  if (getCompositionShuttle().rate() !== 0) return true;
  if (typeof document === 'undefined') return true;
  const el = document.activeElement;
  if (!el || el === document.body) return true;
  return viewportHasFocus(el);
}

/**
 * The strict rule, for `K` alone — see the header. No "nothing has focus"
 * branch: a resting app must not take the Knife's key.
 */
export function transportStopChordActive(): boolean {
  if (getCompositionShuttle().rate() !== 0) return true;
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  return !!el && viewportHasFocus(el);
}

function viewportHasFocus(el: Element): boolean {
  return !!el.closest('[data-workspace-viewport], [data-transport-bar]');
}

export function buildViewportCommands(): ReadonlyArray<Command> {
  const cmds: Command[] = [
    // ── Transport ────────────────────────────────────────────────────
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.shuttleReverse),
      label: 'Shuttle Reverse',
      description: 'J — reverse; again for 2× and 4×. With K held, step one frame back.',
      icon: 'skip-back',
      shortcut: { key: 'j' },
      enabled: transportChordsActive,
      execute: () => getCompositionShuttle().keyDown('j'),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.shuttleStop),
      label: 'Shuttle Stop',
      description: 'K — stop the shuttle. Hold with J / L to step frames.',
      icon: 'pause',
      shortcut: { key: 'k' },
      // The STRICT gate — the Knife keeps `k` until a shuttle is running or
      // the viewport genuinely has focus.
      enabled: transportStopChordActive,
      execute: () => getCompositionShuttle().keyDown('k'),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.shuttleForward),
      label: 'Shuttle Forward',
      description: 'L — forward; again for 2× and 4×. With K held, step one frame forward.',
      icon: 'skip-forward',
      shortcut: { key: 'l' },
      enabled: transportChordsActive,
      execute: () => getCompositionShuttle().keyDown('l'),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.markIn),
      label: 'Mark In at Playhead',
      icon: 'trim-in',
      shortcut: { key: 'i' },
      enabled: () => true,
      execute: () => markIn(),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.markOut),
      label: 'Mark Out at Playhead',
      icon: 'trim-out',
      shortcut: { key: 'o' },
      enabled: () => true,
      execute: () => markOut(),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.goToIn),
      label: 'Go to In Point',
      icon: 'skip-back',
      shortcut: { key: 'i', shift: true },
      enabled: hasInOut,
      execute: () => { goToIn(); },
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.goToOut),
      label: 'Go to Out Point',
      icon: 'skip-forward',
      shortcut: { key: 'o', shift: true },
      enabled: hasInOut,
      execute: () => { goToOut(); },
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.clearInOut),
      label: 'Clear In and Out',
      enabled: hasInOut,
      execute: () => clearInOut(),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.audioScrub),
      label: 'Audio Scrub While Dragging',
      description: 'Sound a short slice of the audio under the playhead as it is dragged.',
      enabled: () => true,
      isChecked: isAudioScrubEnabled,
      execute: () => setAudioScrubEnabled(!isAudioScrubEnabled()),
    },
    // ── Snapshot compare ─────────────────────────────────────────────
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.snapshot),
      label: 'Take Snapshot',
      description: 'Freeze the frame on screen for A/B, wipe or difference comparison.',
      icon: 'camera',
      shortcut: { key: 'F5' },
      enabled: () => true,
      execute: () => {
        useCompareStore.getState().requestCapture();
        getWorkspaceController().requestRender();
      },
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.compareToggle),
      label: 'Show Snapshot',
      description: 'Show or hide the comparison with the last snapshot.',
      icon: 'eye',
      shortcut: { key: 'F6' },
      enabled: canCompare,
      isChecked: () => useCompareStore.getState().visible,
      execute: () => useCompareStore.getState().toggleVisible(),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.compareFlip),
      label: 'Flip A/B',
      enabled: () => canCompare() && useCompareStore.getState().visible,
      execute: () => useCompareStore.getState().flip(),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.compareClear),
      label: 'Clear Snapshots',
      enabled: canCompare,
      execute: () => useCompareStore.getState().clear(),
    },
    ...(Object.keys(COMPARE_MODE_LABEL) as CompareMode[]).map<Command>((m) => ({
      id: asCommandId(VIEWPORT_COMMAND_IDS.compareMode(m)),
      label: `Compare: ${COMPARE_MODE_LABEL[m]}`,
      enabled: () => true,
      isChecked: () => useCompareStore.getState().mode === m,
      execute: () => useCompareStore.getState().setMode(m),
    })),
    // ── Camera bookmarks ─────────────────────────────────────────────
    ...BOOKMARK_SLOTS.map<Command>((n) => ({
      id: asCommandId(VIEWPORT_COMMAND_IDS.bookmarkRecall(n)),
      label: `Recall Camera Bookmark ${n}`,
      icon: 'camera',
      shortcut: { key: String(n), meta: true, alt: true },
      enabled: () => bookmarkAt(n) !== null,
      execute: () => { recallCameraBookmark(n); },
    })),
    ...BOOKMARK_SLOTS.map<Command>((n) => ({
      id: asCommandId(VIEWPORT_COMMAND_IDS.bookmarkSave(n)),
      label: `Save Camera Bookmark ${n}`,
      icon: 'camera',
      shortcut: { key: String(n), meta: true, alt: true, shift: true },
      enabled: () => true,
      execute: () => {
        const b = saveCameraBookmark(n);
        useUIStore.getState().notify({ level: 'success', message: `Saved “${b.name}” (Ctrl+Alt+${n} recalls it)`, durationMs: 2400 });
      },
    })),
    // ── Guides ───────────────────────────────────────────────────────
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.guidesLock),
      label: 'Lock Guides',
      enabled: () => getWorkspaceController().ws.guides.list().some((g) => g.kind === 'user' && !g.locked),
      execute: () => setAllGuidesLocked(true),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.guidesUnlock),
      label: 'Unlock Guides',
      enabled: () => getWorkspaceController().ws.guides.list().some((g) => g.kind === 'user' && g.locked),
      execute: () => setAllGuidesLocked(false),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.guidesClear),
      label: 'Clear Guides',
      description: 'Remove every unlocked guide.',
      enabled: () => getWorkspaceController().ws.guides.list().some((g) => g.kind === 'user'),
      execute: () => {
        getWorkspaceController().ws.guides.clear(false);
        getWorkspaceController().requestRender();
      },
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.guidesShow),
      label: 'Show Guides',
      shortcut: { key: ';', meta: true },
      enabled: () => true,
      isChecked: () => useGuidesStore.getState().guidesVisible,
      execute: () => {
        useGuidesStore.getState().toggleGuidesVisible();
        getWorkspaceController().requestRender();
      },
    },
    // ── Display modes ────────────────────────────────────────────────
    ...(Object.keys(DISPLAY_MODE_LABEL) as DisplayMode[]).map<Command>((m) => ({
      id: asCommandId(VIEWPORT_COMMAND_IDS.displayMode(m)),
      label: `Display: ${DISPLAY_MODE_LABEL[m]}`,
      enabled: () => true,
      isChecked: () => useViewportDisplayStore.getState().displayMode === m,
      execute: () => useViewportDisplayStore.getState().setDisplayMode(m),
    })),
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.displayModeCycle),
      label: 'Cycle Display Mode',
      description: 'Shaded → Wireframe → Bounding box.',
      shortcut: { key: 'F4', shift: true },
      enabled: () => true,
      execute: () => useViewportDisplayStore.getState().cycleDisplayMode(),
    },
    // ── HUD / snap / PAR ─────────────────────────────────────────────
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.hud),
      label: 'Viewport HUD',
      description: 'fps, frame time, cache hits, resolution and backend in the viewport corner.',
      shortcut: { key: 'h', meta: true, alt: true },
      enabled: () => true,
      isChecked: () => useViewportDisplayStore.getState().hud,
      execute: () => useViewportDisplayStore.getState().toggleHud(),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.snapToPixel),
      label: 'Snap to Pixel',
      description: 'Round positions and sizes to whole pixels while dragging or nudging.',
      shortcut: { key: 'p', meta: true, alt: true, shift: true },
      enabled: () => true,
      isChecked: () => useViewportDisplayStore.getState().snapToPixel,
      execute: () => useViewportDisplayStore.getState().toggleSnapToPixel(),
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.pixelAspectCorrection),
      label: 'Pixel Aspect Ratio Correction',
      description: 'Stretch the preview by the composition’s pixel aspect so non-square pixels look right.',
      enabled: () => true,
      isChecked: () => useViewportDisplayStore.getState().pixelAspectCorrection,
      execute: () => useViewportDisplayStore.getState().togglePixelAspectCorrection(),
    },
    // ── Viewer LUT ───────────────────────────────────────────────────
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.viewerLutLoad),
      label: 'Load Viewer LUT…',
      description: 'A .cube monitor look for the viewport only — never in output.',
      enabled: () => true,
      execute: () => { openViewerLutPicker(); },
    },
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.viewerLutClear),
      label: 'Clear Viewer LUT',
      enabled: () => useViewerLutStore.getState().lut !== null,
      execute: () => useViewerLutStore.getState().clear(),
    },
    // ── Tools ────────────────────────────────────────────────────────
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.rotoTool),
      label: 'Roto Brush Tool',
      description: 'Paint over the subject to cut a matte; Alt-paint marks background.',
      icon: 'brush',
      shortcut: { key: 'w', alt: true },
      enabled: () => true,
      execute: () => useUIStore.getState().setActiveTool('roto'),
    },
    // ── AI ───────────────────────────────────────────────────────────
    {
      id: asCommandId(VIEWPORT_COMMAND_IDS.inlineAiPrompt),
      label: 'Ask AI About Selection…',
      description: 'An inline prompt anchored to the selected layers.',
      icon: 'sparkles',
      shortcut: { key: 'Enter', meta: true },
      enabled: () => aiEnabled() && useSelectionStore.getState().ids.length > 0,
      execute: () => openInlineAiPrompt(),
    },
  ];
  return cmds;
}

function setAllGuidesLocked(locked: boolean): void {
  const ws = getWorkspaceController().ws;
  for (const g of ws.guides.list()) if (g.kind === 'user') ws.guides.setLocked(g.id, locked);
  getWorkspaceController().requestRender();
}

let installed = false;
let teardown: (() => void) | null = null;

/**
 * Register the commands, re-scan the shortcut bindings, and start the two
 * listeners the shuttle needs beyond the command system: K key-UP (the
 * dispatcher only sees key-down, and "K held" must end when the key lifts)
 * and audio scrub on playhead drags. Idempotent.
 */
export function installViewportCommands(): void {
  if (installed) return;
  installed = true;
  const registry = getCommandRegistry();
  for (const c of buildViewportCommands()) registry.register(c);
  getShortcutManager().rehydrateFromRegistry();

  if (typeof window !== 'undefined') {
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'k' || e.key === 'K') getCompositionShuttle().keyUp('k');
    };
    window.addEventListener('keyup', onKeyUp, { capture: true });
    const offScrub = installAudioScrub();
    teardown = () => {
      window.removeEventListener('keyup', onKeyUp, { capture: true } as EventListenerOptions);
      offScrub();
    };
  }
}

/** Test seam. */
export function resetViewportCommandsForTest(): void {
  teardown?.();
  teardown = null;
  installed = false;
}

/*
 * Menu rows wanted in `menuModel.ts` (not this directory's file):
 *
 *   View ▸ Guides:          view.guides.show (checkbox) · view.guides.lockAll ·
 *                           view.guides.unlockAll · view.guides.clear
 *   View ▸ Display Mode:    view.displayMode.shaded / wireframe / bounds (radio)
 *   View ▸ Camera Bookmarks: view.cameraBookmark.recall1…9 · save1…9
 *   View:                   view.hud (checkbox) · view.snapToPixel (checkbox) ·
 *                           view.pixelAspectCorrection (checkbox)
 *   View ▸ Snapshot:        view.snapshot · view.compareToggle (checkbox) ·
 *                           view.compareFlip · view.compareMode.* (radio) · view.compareClear
 *   View ▸ Preview:         view.viewerLut.load · view.viewerLut.clear
 *   Composition ▸ Transport: transport.markIn · transport.markOut ·
 *                           transport.goToIn · transport.goToOut ·
 *                           transport.clearInOut · transport.audioScrub (checkbox)
 *   Tools:                  tool.roto
 *   AI:                     ai.inlinePrompt
 */
