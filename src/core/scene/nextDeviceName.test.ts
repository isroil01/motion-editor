import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { flattenComposition, readNodeKind } from '@core/scene/sceneDerive';
import { insertCamera, insertLight, nextDeviceName } from '@core/scene/sceneInsert';

const ROOT = 'comp_root';

const namesOf = (kind: string): string[] =>
  flattenComposition(defaultSceneGraph, ROOT)
    .filter((n) => readNodeKind(n) === kind)
    .map((n) => n.name ?? '');

beforeEach(() => {
  if (!defaultSceneGraph.getNode(ROOT)) {
    defaultSceneGraph.addNode({
      id: ROOT, name: 'Comp', parent: null, children: [], visible: true, locked: false,
      transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
      components: [{ id: `${ROOT}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'group' } }],
    } as never);
  }
  for (const n of flattenComposition(defaultSceneGraph, ROOT)) {
    const k = readNodeKind(n);
    if (k === 'light' || k === 'camera') defaultSceneGraph.removeNode(n.id);
  }
});

describe('camera and light layers are numbered, not all "… 1"', () => {
  it('a second camera is Camera 2 — the view menu lists cameras by name', () => {
    insertCamera();
    insertCamera();
    expect(namesOf('camera')).toEqual(['Camera 1', 'Camera 2']);
  });

  it('a second light is Light 2; the auto Ambient Fill does not take a number', () => {
    insertLight();
    insertLight();
    expect(namesOf('light').filter((n) => n !== 'Ambient Fill')).toEqual(['Light 1', 'Light 2']);
  });

  it('reuses the lowest free number after a delete', () => {
    insertCamera();
    insertCamera();
    const first = flattenComposition(defaultSceneGraph, ROOT).find((n) => n.name === 'Camera 1')!;
    defaultSceneGraph.removeNode(first.id);
    expect(nextDeviceName('camera')).toBe('Camera 1');
  });

  it('an explicit name still wins', () => {
    insertCamera({ name: 'Hero Cam' });
    expect(namesOf('camera')).toEqual(['Hero Cam']);
  });
});
