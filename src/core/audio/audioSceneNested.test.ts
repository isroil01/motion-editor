/**
 * A placed composition's audio plays in the comp it is placed in, on that
 * comp's clock, cut to the instance's bar — After Effects' nested audio.
 *
 * Before this, `readAudioLayers(scope)` kept only nodes whose OWN root was the
 * scope, so every placed comp was silent where it was used; with real
 * Pre-compose, precomposing a clip silenced it.
 */

import type { SceneNode } from '@core/types';

type MockClip = { id: string; enabled: boolean; clip: { start: number; duration: number; sourceIn: number } };
const mockClips: Record<string, MockClip[]> = {};

jest.mock('@core/timeline/TimelineController', () => ({
  getTimelineController: () => ({
    getLayersForNode: (id: string) => mockClips[id] ?? [],
    fpsForNode: () => 30,
  }),
  // The clip retime for a bar at 0 with no trim: identity.
  compToKeyframeTime: (_id: string, t: number) => t,
}));
jest.mock('@stores/assetStore', () => ({
  useAssetStore: { getState: () => ({ assets: [] }) },
}));
jest.mock('@core/api/client', () => ({ assetUrl: (s: string) => s }));

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { COMP_REF_PROP } from '@core/scene/compInstance';
import { readAudioLayers } from './audioScene';

const IDENTITY = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } };

function addRoot(id: string): void {
  defaultSceneGraph.addNode({
    id, name: id, parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [{ id: `${id}_meta`, type: 'group', props: { [SCENE_KIND_PROP]: 'group' } }],
  } as unknown as SceneNode);
}

function addAudio(id: string, parent: string): void {
  defaultSceneGraph.addChild(parent, {
    id, name: id, parent, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [{
      id: `${id}_a`,
      type: 'Audio',
      props: { [SCENE_KIND_PROP]: 'audio', __assetId: 'asset1', __src: 'blob:a.mp3', __level: 100, __duration: 10 },
    }],
  } as never);
}

function addInstance(id: string, parent: string, ref: string, transformExtra: Record<string, unknown> = {}): void {
  defaultSceneGraph.addChild(parent, {
    id, name: id, parent, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'comp', x: 960, y: 540, width: 1920, height: 1080, ...transformExtra } },
      { id: `${id}_fx`, type: 'fx', props: { precomp: true, [COMP_REF_PROP]: ref } },
    ],
  } as never);
}

function bar(id: string, start: number, duration: number, sourceIn = 0, enabled = true): MockClip {
  return { id, enabled, clip: { start, duration, sourceIn } };
}

beforeEach(() => {
  const ids: string[] = [];
  defaultSceneGraph.traverse((n) => ids.push(n.id));
  for (const id of ids) defaultSceneGraph.removeNode(id);
  for (const k of Object.keys(mockClips)) delete mockClips[k];
  addRoot('comp_root');
  addRoot('comp_b');
  addAudio('aud', 'comp_b');
  // Inside Lower Third the audio starts at 1s and runs 2s.
  mockClips.aud = [bar('ca', 30, 60)];
});

describe('nested composition audio', () => {
  it('plays on the host clock through the instance bar', () => {
    addInstance('inst', 'comp_root', 'comp_b');
    // Placed at 2s, showing the comp from its 0.5s, for 3s.
    mockClips.inst = [bar('ci', 60, 90, 15)];

    const voices = readAudioLayers('comp_root');
    expect(voices).toHaveLength(1);
    expect(voices[0]).toMatchObject({ id: 'inst::ci::ca', nodeId: 'aud', startSec: 2.5, inSec: 0, outSec: 2, muted: false });
  });

  it('cuts the voice to the part of the comp the bar shows', () => {
    addInstance('inst', 'comp_root', 'comp_b');
    // Showing the comp from 1.5s: the voice's first 0.5s is before the bar.
    mockClips.inst = [bar('ci', 60, 60, 45)];

    const [v] = readAudioLayers('comp_root');
    expect(v).toMatchObject({ startSec: 2, inSec: 0.5 });
    expect(v!.outSec).toBeCloseTo(2, 6);
  });

  it('honours the instance’s mute and a disabled bar', () => {
    addInstance('inst', 'comp_root', 'comp_b', { audioMuted: true });
    mockClips.inst = [bar('ci', 0, 300)];
    expect(readAudioLayers('comp_root')[0]!.muted).toBe(true);

    defaultSceneGraph.removeNode('inst');
    addInstance('inst2', 'comp_root', 'comp_b');
    mockClips.inst2 = [bar('ci2', 0, 300, 0, false)];
    expect(readAudioLayers('comp_root')[0]!.muted).toBe(true);
  });

  it('keeps a comp’s own scope unchanged and stops at a reference cycle', () => {
    addInstance('inst', 'comp_root', 'comp_b');
    addInstance('back', 'comp_b', 'comp_root');
    mockClips.inst = [bar('ci', 0, 300)];
    mockClips.back = [bar('cb', 0, 300)];

    expect(readAudioLayers('comp_b').map((v) => v.id)).toEqual(['ca']);
    expect(readAudioLayers('comp_root').map((v) => v.id)).toEqual(['inst::ci::ca']);
  });
});
