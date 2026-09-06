/**
 * A pin placed on a DEFORMED character lands with a position keyframe at the
 * placement time (the clicked point), nested in the same undo step as the pin.
 * Without it the pin's live position is its rest anchor and the artwork under
 * the click jumps the instant the pin lands — see `restPointFromDeformed`.
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { defaultAnimation } from '@motion/animation';
import { setCommandSystem, CommandSystem, getCommandSystem } from '@core/commands/CommandSystem';
import { addPuppetPin } from './puppetCommands';
import { readNodePuppet } from './puppet';
import { pinPropPath } from './livePins';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';

function shapeNode(id: string): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [{
      id: `${id}_t`, type: 'Transform',
      props: { [SCENE_KIND_PROP]: 'shape', x: 0, y: 0, rotation: 0, width: 200, height: 160 },
    }],
  } as unknown as SceneNode;
}

beforeEach(() => {
  setCommandSystem(new CommandSystem({ services: {} as never, getState: () => ({}) }));
  try { defaultSceneGraph.removeNode('n1'); } catch { /* fresh */ }
  defaultSceneGraph.addNode(shapeNode('n1'));
  defaultAnimation.clear?.();
});

describe('addPuppetPin with a placement position', () => {
  it('writes the clicked point as a position keyframe at the placement time', () => {
    addPuppetPin('n1', { id: 'p', name: 'P', x: 10, y: 20, kind: 'position' }, { t: 1.5, x: 30, y: 45 });
    const rig = readNodePuppet(defaultSceneGraph.getNode('n1')!)!;
    expect(rig.pins[0]).toMatchObject({ x: 10, y: 20 }); // the anchor stays the REST point
    const live = defaultAnimation.sampleData('n1', pinPropPath('p', 'position'), 1.5) as Array<{ x: number; y: number }>;
    expect(live[0]).toEqual({ x: 30, y: 45 });
  });

  it('writes nothing when the placement equals the anchor (undeformed layer)', () => {
    addPuppetPin('n1', { id: 'p', name: 'P', x: 10, y: 20, kind: 'position' }, { t: 0, x: 10, y: 20 });
    expect(defaultAnimation.getDataTrack('n1', pinPropPath('p', 'position'))).toBeFalsy();
  });

  it('undo removes the pin AND its placement keyframe as one step', () => {
    addPuppetPin('n1', { id: 'p', name: 'P', x: 10, y: 20, kind: 'position' }, { t: 0, x: 30, y: 45 });
    expect(readNodePuppet(defaultSceneGraph.getNode('n1')!)!.pins).toHaveLength(1);
    getCommandSystem().getHistory().undo();
    expect(readNodePuppet(defaultSceneGraph.getNode('n1')!)?.pins ?? []).toHaveLength(0);
    const track = defaultAnimation.getDataTrack('n1', pinPropPath('p', 'position'));
    expect(track?.keyframes?.length ?? 0).toBe(0);
    getCommandSystem().getHistory().redo();
    expect(readNodePuppet(defaultSceneGraph.getNode('n1')!)!.pins).toHaveLength(1);
    const live = defaultAnimation.sampleData('n1', pinPropPath('p', 'position'), 0) as Array<{ x: number; y: number }>;
    expect(live[0]).toEqual({ x: 30, y: 45 });
  });
});
