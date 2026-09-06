/**
 * Editing a marker in place — the half of the feature that did not exist.
 *
 * Markers could be added and removed and nothing else: renaming one meant
 * deleting it and adding another at the right frame. `updateMarker` closes
 * that, and the two things it can get wrong are both tested here because
 * neither is visible in a screenshot:
 *
 *   • the LIST must be re-sorted after a move, or the binary searches behind
 *     `next` / `previous` / `goToMarkerIndex` walk a broken order and a number
 *     key jumps to the wrong marker;
 *   • a LAYER marker is stored layer-relative and drawn in comp time, so a
 *     write has to be the exact inverse of the read — while a DURATION, being
 *     a difference between two instants, must not be mapped at all.
 */

import { getTimelineController } from './TimelineController';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { useProjectStore } from '@stores/projectStore';
import { CommandSystem, setCommandSystem, getCommandSystem } from '@core/commands/CommandSystem';
import type { SceneNode } from '@core/types';

const NODE = 'me_rect';

function resetScene(): void {
  const ids: string[] = [];
  defaultSceneGraph.traverse((n) => ids.push(n.id));
  for (const id of ids) defaultSceneGraph.removeNode(id);
}

beforeEach(() => {
  // The engine's own history is BRIDGED into the app's CommandSystem
  // (`initTimeline`'s `onPush`), so `timeline.history.undo()` pops nothing —
  // the entries are not there. Undo has to be driven from the same place the
  // application drives it, which is what this stands up.
  setCommandSystem(new CommandSystem({ services: {} as never, getState: () => ({}) }));
  resetScene();
  defaultSceneGraph.addNode({
    id: 'comp_root', name: 'Main', parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [{ id: 'comp_root_meta', type: 'group', props: { [SCENE_KIND_PROP]: 'group' } }],
  } as unknown as SceneNode);
  defaultSceneGraph.addChild('comp_root', {
    id: NODE, name: NODE, parent: 'comp_root', children: [], visible: true, locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [
      { id: `${NODE}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'shape', x: 10, y: 10, width: 20, height: 20 } },
      { id: `${NODE}_s`, type: 'Style', props: { opacity: 100, fill: '#fff' } },
    ],
  } as never);
  useProjectStore.getState().actions.replaceComps({
    comp_root: {
      id: 'comp_root', name: 'Main', width: 1920, height: 1080, fps: 30,
      durationSeconds: 10, background: '#101014', transparent: false, startFrame: 0,
    },
  });
  const proj = useProjectStore.getState();
  const tabId = proj.actions.openTab('comp_root', ['comp_root'], 'Main');
  proj.actions.setActiveTab(tabId);
  getTimelineController().syncFromScene('comp_root');
  // Every marker from the previous test, gone. The controller is a module
  // singleton and its timelines outlive a `resetScene` — `getMarkers()[0]` is
  // only "the marker this test added" once that is true.
  const c = getTimelineController();
  for (const m of [...c.getMarkers()]) c.removeMarker(m.id);
  for (const m of [...c.getLayerMarkers(NODE)]) c.removeMarker(m.id);
  getCommandSystem().getHistory().clear();
});


describe('marker edits', () => {
  it('moves a COMP marker to a new time, and can undo it', () => {
    const c = getTimelineController();
    c.seekSeconds(1);
    c.addMarkerAtPlayhead('beat');
    const id = c.getMarkers()[0]!.id;

    expect(c.moveMarker(id, 2.5)).toBe(true);
    expect(c.getMarkers()[0]!.time).toBeCloseTo(2.5, 2);

    // ONE undo step for the move, not one per field written.
    getCommandSystem().getHistory().undo();
    expect(c.getMarkers()[0]!.time).toBeCloseTo(1, 2);
  });

  it('renames and recolours in a single undo step', () => {
    const c = getTimelineController();
    c.seekSeconds(0.5);
    c.addMarkerAtPlayhead('old');
    const id = c.getMarkers()[0]!.id;

    c.updateMarker(id, { label: 'new', color: '#ff0000', comment: 'note' });
    let m = c.getMarkers()[0]!;
    expect(m.label).toBe('new');
    expect(m.color).toBe('#ff0000');
    expect(m.comment).toBe('note');

    getCommandSystem().getHistory().undo();
    m = c.getMarkers()[0]!;
    expect(m.label).toBe('old');
    expect(m.comment).toBe('');
  });

  it('keeps the marker list sorted after a move', () => {
    const c = getTimelineController();
    for (const t of [1, 2, 3]) {
      c.seekSeconds(t);
      c.addMarkerAtPlayhead(`m${t}`);
    }
    // Drag the FIRST one past the last. A list that is not reindexed leaves
    // the binary searches behind `next` / `previous` / `goToMarkerIndex`
    // walking a broken order.
    const first = c.getMarkers().find((m) => m.label === 'm1')!;
    c.moveMarker(first.id, 4);

    const times = c.getMarkers().map((m) => m.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(c.getMarkers()[2]!.label).toBe('m1');
  });

  it('writes a LAYER marker on the same axis it reads it back on', () => {
    const c = getTimelineController();
    const layer = c.getLayersForNode(NODE)[0]!;
    const fps = c.timeline.getFrameRate().fps;
    c.timeline.setLayerStart(layer.id, Math.round(2 * fps));
    c.seekSeconds(3);
    c.addLayerMarkerAtPlayhead(NODE, 'L');
    const id = c.getLayerMarkers(NODE)[0]!.id;

    // Dragged to comp time 4. Stored layer-relative (2s in), read back as 4 —
    // a write that skipped the conversion would read back as 6.
    expect(c.moveMarker(id, 4)).toBe(true);
    expect(c.getLayerMarkers(NODE)[0]!.time).toBeCloseTo(4, 2);
  });

  it('does not map a DURATION through the layer offset', () => {
    const c = getTimelineController();
    const layer = c.getLayersForNode(NODE)[0]!;
    const fps = c.timeline.getFrameRate().fps;
    c.timeline.setLayerStart(layer.id, Math.round(2 * fps));
    c.seekSeconds(3);
    c.addLayerMarkerAtPlayhead(NODE, 'span');
    const id = c.getLayerMarkers(NODE)[0]!.id;

    c.updateMarker(id, { duration: 1 });
    // A length is a DIFFERENCE between two instants; adding the layer's start
    // offset to it turns a 1s span into a 3s one.
    expect(c.getLayerMarkers(NODE)[0]!.duration).toBeCloseTo(1, 2);
  });

  it('finds a marker of either scope by id, and reports which', () => {
    const c = getTimelineController();
    c.seekSeconds(1);
    c.addMarkerAtPlayhead('comp one');
    c.addLayerMarkerAtPlayhead(NODE, 'layer one');

    const comp = c.getMarkerById(c.getMarkers()[0]!.id);
    expect(comp?.scope).toBe('comp');
    expect(comp?.label).toBe('comp one');

    const layer = c.getMarkerById(c.getLayerMarkers(NODE)[0]!.id);
    expect(layer?.scope).toBe('layer');
    expect(layer?.label).toBe('layer one');
  });

  it('reports false for a marker that is no longer there', () => {
    expect(getTimelineController().updateMarker('gone', { label: 'x' })).toBe(false);
    expect(getTimelineController().getMarkerById('gone')).toBeNull();
  });
});
