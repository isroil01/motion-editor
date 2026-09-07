/**
 * The Scene panel's Show / Hide / Lock / Solo toggles.
 *
 *   • The context menu labels its item after the RIGHT-CLICKED row; the action
 *     must follow that row, not `ids[0]` — in a mixed selection those differed
 *     and "Unlock" locked everything.
 *   • The per-row eye is an undoable document edit like every other
 *     visibility path (it used to flip the flag in place and bump).
 */
import defaultSceneGraph from './DefaultSceneGraph';
import { toggleSelectedLocked, toggleSelectedVisible, toggleNodeVisible } from './sceneInsert';
import { useSelectionStore } from '@stores/selectionStore';
import { CommandSystem, setCommandSystem, getCommandSystem } from '@core/commands/CommandSystem';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import type { SceneNode } from '@core/types';

function shape(id: string, extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [{ id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'shape', x: 0, y: 0, width: 10, height: 10 } }],
    ...extra,
  } as unknown as SceneNode;
}

beforeAll(() => {
  setCommandSystem(new CommandSystem({ services: {} as never, getState: () => ({}) } as never));
});

beforeEach(() => {
  defaultSceneGraph.clear();
  defaultSceneGraph.addNode(shape('a'));
  defaultSceneGraph.addNode(shape('b', { locked: true }));
  useSelectionStore.getState().set([]);
});

describe('toggleSelected* with an anchor', () => {
  it('follows the anchor row, not ids[0], across a mixed selection', () => {
    useSelectionStore.getState().set(['a', 'b']); // a unlocked first, b locked
    toggleSelectedLocked('b'); // the menu said "Unlock" on b
    expect(defaultSceneGraph.getNode('a')!.locked).toBe(false);
    expect(defaultSceneGraph.getNode('b')!.locked).toBe(false);
  });

  it('without an anchor keeps the old first-selected rule', () => {
    useSelectionStore.getState().set(['a', 'b']);
    toggleSelectedLocked();
    expect(defaultSceneGraph.getNode('a')!.locked).toBe(true);
    expect(defaultSceneGraph.getNode('b')!.locked).toBe(true);
  });

  it('an anchor outside the selection toggles only itself', () => {
    useSelectionStore.getState().set(['a']);
    toggleSelectedVisible('b');
    expect(defaultSceneGraph.getNode('b')!.visible).toBe(false);
    expect(defaultSceneGraph.getNode('a')!.visible).toBe(true);
  });
});

describe('toggleNodeVisible', () => {
  it('hides and is undoable', () => {
    toggleNodeVisible('a');
    expect(defaultSceneGraph.getNode('a')!.visible).toBe(false);
    getCommandSystem().getHistory().undo();
    expect(defaultSceneGraph.getNode('a')!.visible).toBe(true);
  });
});
