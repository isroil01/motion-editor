/**
 * The per-layer audio switch.
 *
 * The claim under test is that ONE writer serves every place the switch is
 * drawn. Before this module the logic lived inline in `App.tsx`, so the pop-out
 * timeline could not offer the switch at all — and any second implementation
 * would have had to re-derive "audio layers keep the flag on their Audio
 * component, video layers keep it on their Transform", which is exactly the
 * kind of duplicated knowledge that drifts.
 */

import SceneGraph from '@core/scene/SceneGraph';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import type { SceneNode } from '@core/types';
import { isLayerAudioMuted, toggleLayerAudioMute } from './audioLayerSwitches';
import { VIDEO_AUDIO_MUTED_PROP } from './audioScene';

/**
 * Kind lives on a COMPONENT's props (`readNodeKind` walks the render
 * components), not on the node — a fixture that puts it on the node reads back
 * as a shape layer and every assertion here quietly passes for the wrong reason.
 */
function baseNode(id: string, kind: string): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [{ id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: kind } }],
  } as unknown as SceneNode;
}

/** As `insertAudio` builds one, including the explicit `__muted: false`. */
function audioNode(id: string): SceneNode {
  const n = baseNode(id, 'audio');
  n.components.push({
    id: `${id}_a`,
    type: 'Audio',
    props: { __assetId: 'as1', __src: 'x.wav', __level: 100, __muted: false },
  });
  return n;
}

const videoNode = (id: string): SceneNode => baseNode(id, 'video');
const shapeNode = (id: string): SceneNode => baseNode(id, 'shape');

const propsOf = (nodeId: string, compType: string): Record<string, unknown> =>
  (defaultSceneGraph.getNode(nodeId)!.components.find((c) => c.type === compType)!.props ??
    {}) as Record<string, unknown>;

describe('toggleLayerAudioMute', () => {
  beforeEach(() => {
    (defaultSceneGraph as unknown as SceneGraph).clear();
  });

  it('writes __muted on an audio layer', () => {
    defaultSceneGraph.addNode(audioNode('snd'));
    expect(isLayerAudioMuted('snd')).toBe(false);

    toggleLayerAudioMute('snd')!.apply();
    expect(propsOf('snd', 'Audio').__muted).toBe(true);
    expect(isLayerAudioMuted('snd')).toBe(true);
  });

  it('writes the video prop on a video layer — a different component entirely', () => {
    defaultSceneGraph.addNode(videoNode('vid'));

    toggleLayerAudioMute('vid')!.apply();
    expect(propsOf('vid', 'Transform')[VIDEO_AUDIO_MUTED_PROP]).toBe(true);
    expect(isLayerAudioMuted('vid')).toBe(true);
  });

  /**
   * Unmuting must leave NO prop behind. `false` would be a document change on a
   * layer the user only toggled and untoggled, which shows up as a dirty file
   * and, for the video prop, as a key that did not exist before this feature.
   */
  it('clears the flag rather than writing false', () => {
    defaultSceneGraph.addNode(audioNode('snd'));
    toggleLayerAudioMute('snd')!.apply();
    toggleLayerAudioMute('snd')!.apply();
    expect(propsOf('snd', 'Audio')).not.toHaveProperty('__muted', false);
    expect(propsOf('snd', 'Audio').__muted).toBeUndefined();
    expect(isLayerAudioMuted('snd')).toBe(false);
  });

  it('labels the undo entry by the direction it is going', () => {
    defaultSceneGraph.addNode(audioNode('snd'));
    const on = toggleLayerAudioMute('snd')!;
    expect(on.label).toBe('Mute layer audio');
    on.apply();
    expect(toggleLayerAudioMute('snd')!.label).toBe('Unmute layer audio');
  });

  it('refuses a layer that makes no sound, so the caller opens no undo entry', () => {
    defaultSceneGraph.addNode(shapeNode('sq'));
    expect(toggleLayerAudioMute('sq')).toBeNull();
    expect(isLayerAudioMuted('sq')).toBe(false);
  });

  it('refuses a node that is not in the graph', () => {
    expect(toggleLayerAudioMute('nope')).toBeNull();
  });
});
