/**
 * The composition network the Mini-Flowchart shows: the comps IMMEDIATELY
 * upstream (nested in this one) and downstream (this one is placed in them),
 * one entry per comp with every layer that uses it.
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { COMP_REF_PROP } from '@core/scene/compInstance';
import { getTimelineController } from '@core/timeline/TimelineController';
import { useProjectStore, type CompositionSettings, type TabInfo } from '@stores/projectStore';
import { getTime, setTime } from '@stores/playbackClockStore';
import type { SceneNode } from '@core/types';
import { compNetworkOf } from './compNetwork';
import { openContainingComposition } from './compNavigation';

const IDENTITY = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } };

function comp(id: string, name: string): CompositionSettings {
  return { id, name, width: 1920, height: 1080, fps: 30, durationSeconds: 10, background: '#101014', transparent: false, startFrame: 0 };
}

function addRoot(id: string): void {
  defaultSceneGraph.addNode({
    id, name: id, parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [{ id: `${id}_meta`, type: 'group', props: { [SCENE_KIND_PROP]: 'group' } }],
  } as unknown as SceneNode);
}

function addGroup(id: string, parent: string): void {
  defaultSceneGraph.addChild(parent, {
    id, name: id, parent, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'group', x: 0, y: 0 } },
      { id: `${id}_m`, type: 'group', props: { [SCENE_KIND_PROP]: 'group' } },
    ],
  } as never);
}

function addInstance(id: string, parent: string, ref: string): void {
  defaultSceneGraph.addChild(parent, {
    id, name: id, parent, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'comp', x: 960, y: 540, width: 1920, height: 1080 } },
      { id: `${id}_fx`, type: 'fx', props: { precomp: true, [COMP_REF_PROP]: ref } },
    ],
  } as never);
}

const active = (): TabInfo => {
  const s = useProjectStore.getState();
  return s.tabs[s.activeTabId!]!;
};

beforeEach(() => {
  const ids: string[] = [];
  defaultSceneGraph.traverse((n) => ids.push(n.id));
  for (const id of ids) defaultSceneGraph.removeNode(id);
  const actions = useProjectStore.getState().actions;
  actions.resetTabs();
  addRoot('comp_root');
  addRoot('comp_b');
  addRoot('comp_c');
  actions.replaceComps({
    comp_root: comp('comp_root', 'Main'),
    comp_b: comp('comp_b', 'Lower Third'),
    comp_c: comp('comp_c', 'Bug'),
  });
  // Main (back → front): i1→B, i3→C, precomp group G holding i4→C, i2→B.
  addInstance('i1', 'comp_root', 'comp_b');
  addInstance('i3', 'comp_root', 'comp_c');
  addGroup('G', 'comp_root');
  defaultSceneGraph.setPrecomp('G', true);
  addInstance('i4', 'G', 'comp_c');
  addInstance('i2', 'comp_root', 'comp_b');
});

describe('compNetworkOf', () => {
  it('lists the comps nested in this one once each, with every layer that uses them', () => {
    const net = compNetworkOf('comp_root');
    expect(net.name).toBe('Main');
    expect(net.upstream.map((e) => [e.name, e.layerIds])).toEqual([
      ['Bug', ['i3']],
      ['G', ['G']],
      ['Lower Third', ['i2', 'i1']],
    ]);
    // i4 is inside G — upstream of G, not of Main.
    expect(compNetworkOf('G').upstream.map((e) => e.compId)).toEqual(['comp_c']);
  });

  it('sorts upstream by layer order on request (frontmost first)', () => {
    expect(compNetworkOf('comp_root', 'layer').upstream.map((e) => e.compId)).toEqual(['comp_b', 'G', 'comp_c']);
  });

  it('lists the comps this one is placed in', () => {
    expect(compNetworkOf('comp_b').downstream.map((e) => [e.compId, e.layerIds])).toEqual([['comp_root', ['i2', 'i1']]]);
    expect(compNetworkOf('comp_c').downstream.map((e) => [e.name, e.layerIds])).toEqual([
      ['G', ['i4']],
      ['Main', ['i3']],
    ]);
    // A precomp group is shown by the comp around it.
    expect(compNetworkOf('G').downstream.map((e) => e.compId)).toEqual(['comp_root']);
    expect(compNetworkOf('comp_root').downstream).toEqual([]);
  });
});

describe('openContainingComposition', () => {
  it('opens the comp around this one with the playhead mapped out, keeping this comp on the trail', () => {
    const controller = getTimelineController();
    controller.syncFromScene('comp_root');
    // i1 starts 1s into Main.
    controller.timeline.setLayerStart(controller.getLayersForNode('i1')[0]!.id, 30);
    useProjectStore.getState().actions.openTab('comp_b', ['comp_b'], 'Lower Third');
    setTime(active().id, 0.5);

    expect(openContainingComposition('comp_root', 'i1')).toBe(true);
    expect(active().compositionId).toBe('comp_root');
    expect(active().breadcrumbPath).toEqual(['comp_root', 'comp_b']);
    expect(getTime(active().id)).toBeCloseTo(1.5, 5);
  });
});
