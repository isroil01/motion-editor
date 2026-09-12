/**
 * The per-layer audio switch — AE's speaker in the A/V Features column.
 *
 * One writer, because the switch is drawn in three places (the timeline's track
 * header, the clip bar's glyph, and the inspector's Mute row) and all three are
 * views of ONE prop. It used to live inline in `App.tsx`, which meant the
 * pop-out timeline could not offer the switch at all without copying it.
 *
 * Audio layers and video layers store the flag differently — an audio layer has
 * an `Audio` component with `__muted`, a video layer carries
 * `audioMuted` on its Transform — so callers must not reach for the prop
 * themselves. Ask here instead.
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { readNodeKind } from '@core/scene/sceneDerive';
import { VIDEO_AUDIO_MUTED_PROP } from './audioScene';

/** Where a node's audio-mute flag lives, or null when it makes no sound. */
function muteSite(nodeId: string): { componentId: string; prop: string; muted: boolean } | null {
  const node = defaultSceneGraph.getNode(nodeId);
  if (!node) return null;
  const kind = readNodeKind(node);
  if (kind !== 'audio' && kind !== 'video') return null;
  const componentType = kind === 'audio' ? 'Audio' : 'Transform';
  const prop = kind === 'audio' ? '__muted' : VIDEO_AUDIO_MUTED_PROP;
  const comp = node.components.find((c) => c.type === componentType);
  if (!comp) return null;
  return {
    componentId: comp.id,
    prop,
    muted: (comp.props as Record<string, unknown>)?.[prop] === true,
  };
}

/** True when this layer's audio is currently muted. */
export function isLayerAudioMuted(nodeId: string): boolean {
  return muteSite(nodeId)?.muted === true;
}

/**
 * Flip this layer's audio switch. Returns the label for the undo entry, or null
 * when the node makes no sound (so the caller can skip opening one).
 *
 * Writes `undefined` rather than `false` to clear, so an unmuted layer holds no
 * prop at all and a document that never touched the switch round-trips byte
 * for byte.
 */
export function toggleLayerAudioMute(nodeId: string): { label: string; apply: () => void } | null {
  const site = muteSite(nodeId);
  if (!site) return null;
  return {
    label: site.muted ? 'Unmute layer audio' : 'Mute layer audio',
    apply: () => {
      defaultSceneGraph.writeProp(nodeId, site.componentId, site.prop, site.muted ? undefined : true);
    },
  };
}
