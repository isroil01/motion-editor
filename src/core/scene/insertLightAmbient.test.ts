import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { readNodeLight } from '@core/scene/light';
import { flattenComposition, readNodeKind } from '@core/scene/sceneDerive';
import { AMBIENT_FILL_INTENSITY, compHasAmbientLight, insertLight } from '@core/scene/sceneInsert';
import { useSelectionStore } from '@stores/selectionStore';

const ROOT = 'comp_root';

function lights(): Array<{ name: string; type: string; intensity: number }> {
  return flattenComposition(defaultSceneGraph, ROOT)
    .filter((n) => readNodeKind(n) === 'light')
    .map((n) => ({ name: n.name ?? '', type: readNodeLight(n).type, intensity: readNodeLight(n).intensity }));
}

beforeEach(() => {
  if (!defaultSceneGraph.getNode(ROOT)) {
    defaultSceneGraph.addNode({
      id: ROOT, name: 'Comp', parent: null, children: [], visible: true, locked: false,
      transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
      components: [{ id: `${ROOT}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'group' } }],
    } as never);
  }
  for (const n of flattenComposition(defaultSceneGraph, ROOT)) {
    if (readNodeKind(n) === 'light') defaultSceneGraph.removeNode(n.id);
  }
});

describe('the first positional light brings an ambient fill', () => {
  it('a point light into an unlit comp adds Ambient Fill below it and keeps the point light selected', () => {
    expect(compHasAmbientLight(ROOT)).toBe(false);
    insertLight({ name: 'Key' });
    expect(lights()).toEqual([
      { name: 'Ambient Fill', type: 'ambient', intensity: AMBIENT_FILL_INTENSITY },
      { name: 'Key', type: 'point', intensity: 100 },
    ]);
    const selected = useSelectionStore.getState().ids;
    expect(selected).toHaveLength(1);
    expect(defaultSceneGraph.getNode(selected[0]!)?.name).toBe('Key');
  });

  it('a second positional light adds no second fill', () => {
    insertLight({ name: 'Key' });
    insertLight({ name: 'Rim', type: 'spot' });
    expect(lights().filter((l) => l.type === 'ambient')).toHaveLength(1);
  });

  it('an ambient or environment light never brings a companion, and satisfies a later point light', () => {
    insertLight({ type: 'environment' });
    expect(lights()).toHaveLength(1);
    insertLight({ name: 'Key' });
    expect(lights().map((l) => l.type)).toEqual(['environment', 'point']);
  });
});
