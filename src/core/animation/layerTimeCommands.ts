/**
 * Layer ▸ Time — the footage verbs as COMMANDS: Time-Reverse Layer, Freeze
 * Frame at playhead, Time Stretch…, Enable/Remove Time Remapping, and the
 * frame-blend modes.
 *
 * Every one of these already existed as a switch somewhere — the Compositing
 * section's Time group, the viewport's right-click Video submenu — but the
 * application menu's Time entry listed two speed ramps and nothing else, so
 * the menu (and the command palette that reads it) said the editor could not
 * reverse or freeze footage. After Effects keeps all of these under
 * Layer ▸ Time; so does this. The writes go through the same
 * `updateNodeLayerTime` / time-remap track the switches use, so the two
 * surfaces cannot disagree.
 */

import { asCommandId } from '@app-types/common';
import type { Command } from '@core/commands/Command';
import { defaultAnimation } from '@motion/animation';
import { customPrompt } from '@components/Modal';
import { useUIStore } from '@stores/uiStore';
import { useProjectStore } from '@stores/projectStore';
import { useSelectionStore } from '@stores/selectionStore';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { isPrecomp } from '@core/scene/precomp';
import { readNodeKind } from '@core/scene/sceneDerive';
import { getNodeLayerTime, updateNodeLayerTime, type FrameBlend } from '@core/scene/layerTime';
import { compToKeyframeTime } from '@core/timeline/TimelineController';
import { runAnimEdit } from './animationCommands';

/** Same prop names PrecompControl writes — one track, two surfaces. */
const REMAP = 'timeRemap';
const LEGACY_REMAP = 'precompTime';

function playhead(): number {
  const project = useProjectStore.getState();
  return (project.activeTabId ? project.tabs[project.activeTabId]?.time : 0) ?? 0;
}

/** Layers whose source has a time axis to retime: footage, audio, precomps. */
function retimable(nodeId: string): boolean {
  const node = defaultSceneGraph.getNode(nodeId);
  if (!node) return false;
  const kind = readNodeKind(node);
  return kind === 'video' || kind === 'audio' || isPrecomp(node);
}

export function timeTargets(): string[] {
  return useSelectionStore.getState().ids.filter(retimable);
}

function notify(message: string): void {
  useUIStore.getState().notify({ level: 'info', message, durationMs: 3500 });
}

/** Reverse (or un-reverse) every selected footage layer. */
export function toggleReverse(ids: ReadonlyArray<string>): void {
  const anyForward = ids.some((id) => !getNodeLayerTime(id).reverse);
  for (const id of ids) updateNodeLayerTime(id, { reverse: anyForward });
}

/** Freeze every selected layer on the frame under the playhead (or unfreeze). */
export function toggleFreeze(ids: ReadonlyArray<string>, compTime: number): void {
  const anyLive = ids.some((id) => !getNodeLayerTime(id).freeze);
  for (const id of ids) {
    updateNodeLayerTime(id, anyLive ? { freeze: true, freezeTime: compTime } : { freeze: false });
  }
}

/** Time stretch as a percentage of the original duration (100 = as shot). */
export function applyStretch(ids: ReadonlyArray<string>, percent: number): void {
  const stretch = Math.max(1, Math.min(1000, Math.round(percent)));
  for (const id of ids) updateNodeLayerTime(id, { stretch });
}

export function setFrameBlend(ids: ReadonlyArray<string>, frameBlend: FrameBlend): void {
  for (const id of ids) updateNodeLayerTime(id, { frameBlend });
}

export function hasTimeRemap(nodeId: string): boolean {
  return defaultAnimation.isAnimated(nodeId, REMAP) || defaultAnimation.isAnimated(nodeId, LEGACY_REMAP);
}

/**
 * Enable time remapping: one keyframe at the playhead holding the current
 * source time (the identity — nothing moves until a second keyframe does),
 * exactly what PrecompControl's switch writes. Remove drops both tracks.
 */
export function toggleTimeRemap(ids: ReadonlyArray<string>, compTime: number): void {
  const anyOff = ids.some((id) => !hasTimeRemap(id));
  runAnimEdit(anyOff ? 'Enable time remap' : 'Remove time remap', () => defaultAnimation.batch(() => {
    for (const id of ids) {
      if (anyOff) {
        if (hasTimeRemap(id)) continue;
        const remapT = compToKeyframeTime(id, compTime, REMAP);
        defaultAnimation.setKeyframe(id, REMAP, remapT, compTime);
      } else {
        defaultAnimation.removeTrack(id, REMAP);
        defaultAnimation.removeTrack(id, LEGACY_REMAP);
      }
    }
  }));
}

export function buildLayerTimeCommands(): ReadonlyArray<Command> {
  const enabled = (): boolean => timeTargets().length > 0;
  return [
    {
      id: asCommandId('time.reverseLayer'),
      label: 'Time-Reverse Layer',
      description: 'Play the selected footage backwards (toggle)',
      icon: 'clock',
      enabled,
      execute: () => toggleReverse(timeTargets()),
    },
    {
      id: asCommandId('time.freezeFrame'),
      label: 'Freeze Frame',
      description: 'Hold the selected footage on the frame under the playhead (toggle)',
      icon: 'clock',
      enabled,
      execute: () => toggleFreeze(timeTargets(), playhead()),
    },
    {
      id: asCommandId('time.timeStretch'),
      label: 'Time Stretch…',
      description: 'Stretch the selected footage to a percentage of its duration',
      icon: 'clock',
      enabled,
      execute: async () => {
        const ids = timeTargets();
        if (ids.length === 0) return;
        const current = getNodeLayerTime(ids[0]!).stretch;
        const raw = await customPrompt('Time Stretch', 'Stretch factor (% of original duration — 200 = half speed, 50 = double speed)', String(current));
        if (raw === null) return;
        const pct = Number(raw);
        if (!Number.isFinite(pct) || pct <= 0) { notify('Enter a percentage above 0.'); return; }
        applyStretch(ids, pct);
      },
    },
    {
      id: asCommandId('time.enableTimeRemap'),
      label: 'Enable Time Remapping',
      description: 'Keyframe the source time of the selected footage (toggle)',
      icon: 'clock',
      enabled,
      execute: () => toggleTimeRemap(timeTargets(), playhead()),
    },
    ...([
      ['none', 'Frame Blend: Off'],
      ['mix', 'Frame Blend: Frame Mix'],
      ['pixelMotion', 'Frame Blend: Pixel Motion'],
    ] as ReadonlyArray<[FrameBlend, string]>).map(([mode, label]) => ({
      id: asCommandId(`time.frameBlend.${mode}`),
      label,
      description: 'Frame blending for slowed or stretched footage',
      icon: 'clock',
      enabled,
      execute: () => setFrameBlend(timeTargets(), mode),
    })),
  ];
}
