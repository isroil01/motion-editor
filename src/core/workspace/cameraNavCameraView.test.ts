/**
 * The C tool / Alt-drag must drive the camera being LOOKED THROUGH.
 *
 * In a `camera:<id>` view the camera on screen is not the topmost one. If
 * navigation kept resolving the topmost camera, every orbit would move a camera
 * the user is not watching — the "drag does nothing" bug the shared selection
 * rule was written to kill, reintroduced by the view.
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { useGuidesStore } from '@stores/guidesStore';
import type { SceneNode } from '@core/types';
import { defaultCustomViews } from './customViews';
import { findCameraNav, findNavTarget } from './cameraNav';

const ROOT = 'camnav-camview-root';
const SHAPE = 'camnav-camview-shape';
const LOW = 'camnav-camview-low';
const HIGH = 'camnav-camview-high';

function makeNode(id: string, props: Record<string, unknown>): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [{ id: `${id}_t`, type: 'Transform', props }],
  } as unknown as SceneNode;
}

beforeEach(() => {
  useGuidesStore.setState({ camera3dMode: 'active', customViews: defaultCustomViews(), lastCustomView: 'custom1' });
  defaultSceneGraph.addNode(makeNode(ROOT, { [SCENE_KIND_PROP]: 'group' }));
  defaultSceneGraph.addChild(ROOT,
    makeNode(SHAPE, { [SCENE_KIND_PROP]: 'shape', x: 100, y: 100, z: 0, rotationX: 0, rotationY: 0 }),
  );
  // Paint order: LOW under HIGH, so HIGH is the active camera.
  defaultSceneGraph.addChild(ROOT, makeNode(LOW, { [SCENE_KIND_PROP]: 'camera', x: 960, y: 540 }));
  defaultSceneGraph.addChild(ROOT, makeNode(HIGH, { [SCENE_KIND_PROP]: 'camera', x: 960, y: 540 }));
});

afterEach(() => {
  for (const id of [SHAPE, LOW, HIGH, ROOT]) {
    try { defaultSceneGraph.removeNode(id); } catch { /* already gone */ }
  }
});

describe('navigation follows the camera view', () => {
  it('Active Camera navigates the topmost camera', () => {
    expect(findNavTarget()).toEqual({ kind: 'scene', nodeId: HIGH, transId: `${HIGH}_t` });
  });

  it('a camera view navigates the camera it names', () => {
    useGuidesStore.getState().setCamera3dMode(`camera:${LOW}`);
    expect(findNavTarget()).toEqual({ kind: 'scene', nodeId: LOW, transId: `${LOW}_t` });
    expect(findCameraNav()?.nodeId).toBe(LOW);
  });

  it('a stale camera view navigates the active camera — the one it renders through', () => {
    useGuidesStore.getState().setCamera3dMode('camera:not-a-node');
    expect(findNavTarget()).toEqual({ kind: 'scene', nodeId: HIGH, transId: `${HIGH}_t` });
  });
});
