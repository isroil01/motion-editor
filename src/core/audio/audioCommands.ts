/**
 * Audio editing commands: fade in / out, remove silence, duck music.
 *
 * Both are dialog-first — they have four parameters each and a readout that
 * only means something once the audio has been analysed, so "run it and see"
 * is not an option and a one-click menu entry would be a coin toss. The command
 * therefore opens the dialog rather than doing the edit; the edit lives in
 * `silenceRemoval.ts` / `ducking.ts` and is reachable without any UI at all.
 *
 * ## Why the opener is injected
 *
 * A command in `core/` opening a React dialog in `layout/` would be the first
 * production import from core into layout in this tree, and the direction that
 * points is the one where the engine cannot be built or tested without the
 * panels. So the dialogs REGISTER themselves here ({@link setAudioToolOpener})
 * when their module loads, and the commands ask for whatever is registered. A
 * command whose dialog has not loaded says so instead of throwing.
 */

import { asCommandId } from '@app-types/common';
import { getCommandRegistry, type Command } from '@core/commands/Command';
import { useSelectionStore } from '@stores/selectionStore';
import { useUIStore } from '@stores/uiStore';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { audioVoices } from './silenceRemoval';
import { applyFade, DEFAULT_FADE_SEC, type FadeSide } from './audioFades';
import { defaultAnimation } from '@motion/animation';
import { runAnimEdit } from '@core/animation/animationCommands';
import { bumpScene } from '@stores/sceneStore';

export const REMOVE_SILENCE_COMMAND = asCommandId('audio.removeSilence');
export const DUCK_MUSIC_COMMAND = asCommandId('audio.duckMusic');
export const GATE_COMMAND = asCommandId('audio.gate');
export const FADE_IN_COMMAND = asCommandId('audio.fadeIn');
export const FADE_OUT_COMMAND = asCommandId('audio.fadeOut');

/** Which dialog an opener stands for. */
export type AudioTool = 'silence' | 'ducking' | 'gate';

const openers = new Map<AudioTool, (nodeId: string) => void>();

/** Called by each dialog module as it loads. Replacing is fine (HMR). */
export function setAudioToolOpener(tool: AudioTool, open: (nodeId: string) => void): void {
  openers.set(tool, open);
}

function notify(message: string, level: 'info' | 'warning' = 'warning'): void {
  useUIStore.getState().notify({ level, message, durationMs: 5000 });
}

/**
 * The selected layer that has sound, or undefined.
 *
 * Membership of the VOICE list is the test, not `readNodeKind(n) === 'audio'`:
 * a video layer carries its own track in this app (see `audioScene`), and both
 * of these commands are as meaningful on a piece to camera as on a wav.
 */
export function selectedAudioNodeId(): string | undefined {
  const ids = useSelectionStore.getState().ids;
  if (ids.length === 0) return undefined;
  const voices = audioVoices();
  return ids.find(
    (id) => defaultSceneGraph.getNode(id) !== undefined && voices.some((v) => v.nodeId === id),
  );
}

function run(tool: AudioTool, what: string): void {
  const nodeId = selectedAudioNodeId();
  if (!nodeId) {
    notify(`Select a layer with sound first — ${what} needs something to listen to.`);
    return;
  }
  const open = openers.get(tool);
  if (!open) {
    notify('The audio panel has not loaded yet. Open the Inspector and try again.', 'info');
    return;
  }
  open(nodeId);
}

/**
 * Every SELECTED layer that has sound.
 *
 * The fades act on the whole selection, unlike the two dialog commands above,
 * which need one layer to talk about. "Fade these three out" is one act and
 * should be one undo entry.
 */
function selectedAudioNodeIds(): string[] {
  const ids = useSelectionStore.getState().ids;
  if (ids.length === 0) return [];
  const voices = audioVoices();
  return ids.filter(
    (id) => defaultSceneGraph.getNode(id) !== undefined && voices.some((v) => v.nodeId === id),
  );
}

function runFade(side: FadeSide): void {
  const ids = selectedAudioNodeIds();
  if (ids.length === 0) {
    notify('Select a layer with sound first — a fade needs something to fade.');
    return;
  }
  let faded = 0;
  runAnimEdit(side === 'in' ? 'Fade Audio In' : 'Fade Audio Out', () => {
    defaultAnimation.batch(() => {
      for (const id of ids) if (applyFade(id, side)) faded += 1;
    });
    bumpScene();
  });
  if (faded === 0) {
    notify('Those layers have no audible span to fade — check their bars are not zero-length.');
  }
}

/** Every audio command, for `buildStaticCommands` or a direct registration. */
export function buildAudioCommands(): ReadonlyArray<Command> {
  return [
    {
      id: REMOVE_SILENCE_COMMAND,
      label: 'Remove Silence…',
      description:
        'Find the dead air in this layer and cut it out, closing the gaps — '
        + 'picture and sound from the same file stay in sync.',
      icon: 'audio',
      enabled: () => selectedAudioNodeId() !== undefined,
      execute: () => run('silence', 'silence removal'),
    },
    {
      id: DUCK_MUSIC_COMMAND,
      label: 'Duck Under Voice…',
      description:
        'Hold this layer’s level down whenever another layer is talking, as level keyframes.',
      icon: 'audio',
      enabled: () => selectedAudioNodeId() !== undefined,
      execute: () => run('ducking', 'ducking'),
    },
    {
      id: GATE_COMMAND,
      label: 'Noise Gate…',
      description:
        'Pull this layer down wherever it is below a threshold — room tone between phrases, '
        + 'hiss under a take — as level keyframes you can reshape.',
      icon: 'audio',
      enabled: () => selectedAudioNodeId() !== undefined,
      execute: () => run('gate', 'the noise gate'),
    },
    {
      id: FADE_IN_COMMAND,
      label: 'Fade In',
      description:
        `Ramp this layer up from silence over ${DEFAULT_FADE_SEC}s from where its bar starts, `
        + 'as ordinary level keyframes you can reshape in the graph editor.',
      icon: 'audio',
      enabled: () => selectedAudioNodeIds().length > 0,
      execute: () => runFade('in'),
    },
    {
      id: FADE_OUT_COMMAND,
      label: 'Fade Out',
      description:
        `Ramp this layer down to silence over the last ${DEFAULT_FADE_SEC}s of its bar, `
        + 'as ordinary level keyframes you can reshape in the graph editor.',
      icon: 'audio',
      enabled: () => selectedAudioNodeIds().length > 0,
      execute: () => runFade('out'),
    },
  ];
}

/** Put both commands in the registry. Idempotent — registering replaces. */
export function registerAudioCommands(): void {
  const registry = getCommandRegistry();
  for (const command of buildAudioCommands()) registry.register(command);
}

// Registered on import. The inspector's audio section imports this module, so
// the commands exist as soon as anything that could invoke them does.
registerAudioCommands();
