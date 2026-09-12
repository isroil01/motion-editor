/**
 * A TIME-REMAPPED composition layer plays its nested audio along the remap —
 * varispeed, as a remapped footage clip does — instead of going silent.
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
import { defaultAnimation } from '@motion/animation';
import { readAudioLayers } from './audioScene';

const IDENTITY = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } };

function addRoot(id: string): void {
  defaultSceneGraph.addNode({
    id, name: id, parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [{ id: `${id}_meta`, type: 'group', props: { [SCENE_KIND_PROP]: 'group' } }],
  } as unknown as SceneNode);
}

beforeEach(() => {
  const ids: string[] = [];
  defaultSceneGraph.traverse((n) => ids.push(n.id));
  for (const id of ids) {
    defaultAnimation.clearNode(id);
    defaultSceneGraph.removeNode(id);
  }
  for (const k of Object.keys(mockClips)) delete mockClips[k];
  addRoot('comp_root');
  addRoot('comp_b');
  defaultSceneGraph.addChild('comp_b', {
    id: 'aud', name: 'aud', parent: 'comp_b', children: [], visible: true, locked: false, transform: IDENTITY,
    components: [{
      id: 'aud_a',
      type: 'Audio',
      props: { [SCENE_KIND_PROP]: 'audio', __assetId: 'asset1', __src: 'blob:a.mp3', __level: 100, __duration: 10 },
    }],
  } as never);
  defaultSceneGraph.addChild('comp_root', {
    id: 'inst', name: 'inst', parent: 'comp_root', children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      { id: 'inst_t', type: 'Transform', props: { [SCENE_KIND_PROP]: 'comp', x: 960, y: 540, width: 1920, height: 1080 } },
      { id: 'inst_fx', type: 'fx', props: { precomp: true, [COMP_REF_PROP]: 'comp_b' } },
    ],
  } as never);
  // Inside the comp the audio runs from 1s to 3s; the instance spans 0–10s.
  mockClips.aud = [{ id: 'ca', enabled: true, clip: { start: 30, duration: 60, sourceIn: 0 } }];
  mockClips.inst = [{ id: 'ci', enabled: true, clip: { start: 0, duration: 300, sourceIn: 0 } }];
});

describe('nested audio through a time remap', () => {
  it('plays at the remap speed, at the host time the remap reaches it', () => {
    // Double speed for the first 2s of the host: inner 0 → 4.
    defaultAnimation.setKeyframes('inst', 'timeRemap', [
      { t: 0, value: 0, easing: 'linear' },
      { t: 2, value: 4, easing: 'linear' },
    ] as never);

    const voices = readAudioLayers('comp_root');
    expect(voices).toHaveLength(1);
    const v = voices[0]!;
    // Inner 1s is reached at host 0.5s, inner 3s at host 1.5s.
    expect(v.startSec).toBeCloseTo(0.5, 2);
    expect(v.outSec - v.inSec).toBeCloseTo(1, 2);
    expect(v.inSec).toBeCloseTo(0, 2);
    expect(v.playbackRate).toBeCloseTo(2, 2);
    expect(v.retimeReverse).toBeFalsy();
  });

  it('plays backwards where the remap runs backwards', () => {
    // Inner 4 → 0 over host 0–2s: reversed, double speed.
    defaultAnimation.setKeyframes('inst', 'timeRemap', [
      { t: 0, value: 4, easing: 'linear' },
      { t: 2, value: 0, easing: 'linear' },
    ] as never);

    const [v] = readAudioLayers('comp_root');
    expect(v).toBeDefined();
    // Inner 3s is reached at host 0.5s, inner 1s at host 1.5s.
    expect(v!.startSec).toBeCloseTo(0.5, 2);
    expect(v!.outSec - v!.inSec).toBeCloseTo(1, 2);
    expect(v!.playbackRate).toBeCloseTo(2, 2);
    expect(v!.retimeReverse).toBe(true);
  });

  it('is silent where the remap holds a frame', () => {
    defaultAnimation.setKeyframes('inst', 'timeRemap', [
      { t: 0, value: 2, easing: 'linear' },
      { t: 10, value: 2, easing: 'linear' },
    ] as never);
    expect(readAudioLayers('comp_root')).toHaveLength(0);
  });
});
