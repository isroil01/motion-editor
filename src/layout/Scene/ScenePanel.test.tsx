/**
 * The Scene panel's tree, as the user sees it: what the footer counts, whether
 * the keyframe filter notices a keyframe, and whether a reparented layer stays
 * on screen while a search is active.
 *
 * Three reports, one panel:
 *   • "Only layers with keyframes" kept its answer from the last scene edit —
 *     keyframes announce themselves on the event bus, never through the scene
 *     revision the tree is keyed on, so the filter had to subscribe;
 *   • parenting a layer while a search was active left its branch shut: the
 *     tree is controlled under a filter and drops the reveal a reparent sends;
 *   • the footer said "7 items" for a comp with four layers (every node of
 *     every comp, roots included) and "3 shown" for one match (ancestors kept
 *     as the path to it).
 *
 * jsdom has no layout: the tree virtualizes on `clientHeight`, so it is pinned
 * to a tall viewport and ResizeObserver is a no-op.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ScenePanel } from './ScenePanel';
import { TooltipProvider } from '@components/Tooltip';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { reparentNode } from '@core/scene/parenting';
import { defaultAnimation } from '@motion/animation';
import { getEventBus } from '@core/events/EventBus';
import { useProjectStore } from '@stores/projectStore';
import { useSelectionStore } from '@stores/selectionStore';
import { CommandSystem, setCommandSystem } from '@core/commands/CommandSystem';
import type { SceneNode } from '@core/types';

const ROOT = 'comp_main';
const OTHER = 'comp_other';

class NoopResizeObserver {
  observe(): void { /* no layout in jsdom */ }
  unobserve(): void { /* no layout in jsdom */ }
  disconnect(): void { /* no layout in jsdom */ }
}

beforeAll(() => {
  // The row switches are undoable document edits now, and `runDocumentEdit`
  // needs a command system to record into.
  setCommandSystem(new CommandSystem({ services: {} as never, getState: () => ({}) } as never));
  (globalThis as unknown as Record<string, unknown>)['ResizeObserver'] = NoopResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 320 });
});

function compRoot(id: string, name: string): SceneNode {
  return {
    id,
    name,
    parent: null,
    children: [],
    visible: true,
    locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [{ id: `${id}_meta`, type: 'group', props: { __kind: 'group' } }],
  } as unknown as SceneNode;
}

function layer(id: string, name: string, parent: string, kind: 'shape' | 'group'): SceneNode {
  return {
    id,
    name,
    parent,
    children: [],
    visible: true,
    locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: kind === 'group'
      ? [{ id: `${id}_t`, type: 'Transform', props: { __kind: 'group', x: 0, y: 0 } }]
      : [
          { id: `${id}_t`, type: 'Transform', props: { __kind: 'shape', x: 0, y: 0, width: 100, height: 100 } },
          { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#3b8276' } },
        ],
  } as unknown as SceneNode;
}

/**
 * Main:  Alpha, Beta, Grp ▸ Child   (four layers)
 * Other: Solo                        (a second comp, so the count can get it wrong)
 */
beforeEach(() => {
  defaultAnimation.clear();
  useSelectionStore.getState().set([]);
  for (const r of [...defaultSceneGraph.getRoots()]) defaultSceneGraph.removeNode(r.id);
  defaultSceneGraph.addNode(compRoot(ROOT, 'Main'));
  defaultSceneGraph.addChild(ROOT, layer('alpha', 'Alpha', ROOT, 'shape'));
  defaultSceneGraph.addChild(ROOT, layer('beta', 'Beta', ROOT, 'shape'));
  defaultSceneGraph.addChild(ROOT, layer('grp', 'Grp', ROOT, 'group'));
  defaultSceneGraph.addChild('grp', layer('child', 'Child', 'grp', 'shape'));
  defaultSceneGraph.addNode(compRoot(OTHER, 'Other'));
  defaultSceneGraph.addChild(OTHER, layer('solo', 'Solo', OTHER, 'shape'));
  useProjectStore.getState().actions.openTab(ROOT, [ROOT], 'Main');
});

const renderPanel = (): ReturnType<typeof render> =>
  render(<TooltipProvider><ScenePanel /></TooltipProvider>);

const rowIds = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"][data-id]')).map((el) => el.dataset.id!);

const search = (text: string): void => {
  fireEvent.change(screen.getByLabelText('Search layers'), { target: { value: text } });
};

describe('footer counts', () => {
  it('counts the ACTIVE composition\'s layers, not every node of every comp', () => {
    renderPanel();
    // Not 7 (two roots + five layers) and not 5 (both comps' layers).
    expect(screen.getByText('4 layers')).toBeInTheDocument();
  });

  it('reports the rows that match, not the ancestors kept as their path', () => {
    renderPanel();
    search('child');
    // Main and Grp are on screen only because Child is inside them.
    expect(rowIds()).toEqual([ROOT, 'grp', 'child']);
    expect(screen.getByText('1 match')).toBeInTheDocument();
    expect(screen.queryByText('3 shown')).toBeNull();
  });
});

describe('"Only layers with keyframes" follows the animation, not the scene revision', () => {
  it('a keyframe added while the filter is on brings the layer in', () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText('Only layers with keyframes'));
    expect(screen.getByText('No layers match this filter.')).toBeInTheDocument();

    act(() => {
      defaultAnimation.setKeyframes('beta', 'x', [{ t: 0, value: 0 }, { t: 1, value: 100 }]);
      // The engine's change sink is what the app binds onto this event; the
      // panel listens to the bus, so that is the signal under test.
      getEventBus().emit('AnimationChanged', { nodeId: 'beta' });
    });
    // No scene edit happened between the two renders — only the animation did.
    expect(rowIds()).toEqual([ROOT, 'beta']);
    expect(screen.getByText('1 match')).toBeInTheDocument();
  });
});

describe('reveal after reparent', () => {
  it('opens the destination branch when no filter is active', () => {
    renderPanel();
    // Groups start shut: Child is not a row yet. Both comps are listed — the
    // tree is the project's, which is why the footer has to say which count
    // it is reporting.
    expect(rowIds()).toEqual([ROOT, 'grp', 'beta', 'alpha', OTHER, 'solo']);
    act(() => { reparentNode('alpha', 'grp'); });
    expect(rowIds()).toContain('alpha');
    expect(rowIds()).toContain('child');
  });

  it('keeps the reparented layer on screen while a search is active, and after it clears', () => {
    renderPanel();
    search('alpha');
    expect(rowIds()).toEqual([ROOT, 'alpha']);
    act(() => { reparentNode('alpha', 'grp'); });
    // The match is now inside Grp; Grp is kept as its path and is open.
    expect(rowIds()).toEqual([ROOT, 'grp', 'alpha']);
    // Clearing the search hands expansion back to the tree: the branch the
    // reparent opened must still be open, or Alpha vanishes here.
    search('');
    expect(rowIds()).toContain('alpha');
  });
});

describe('row switches', () => {
  it('draws a lock and a solo glyph per row and toggles them undoably through the anchor', () => {
    renderPanel();
    const row = within(document.querySelector<HTMLElement>('[data-id="beta"]')!);
    fireEvent.click(row.getByLabelText('Lock layer'));
    expect(defaultSceneGraph.getNode('beta')?.locked).toBe(true);
    // Beta is not selected, so the anchor toggles only itself.
    expect(defaultSceneGraph.getNode('alpha')?.locked).toBe(false);
    expect(row.getByLabelText('Unlock layer')).toHaveAttribute('data-on');

    fireEvent.click(row.getByLabelText('Solo layer'));
    expect(defaultSceneGraph.getNode('beta')?.solo).toBe(true);
    expect(row.getByLabelText('Unsolo layer')).toHaveAttribute('data-on');
  });
});
