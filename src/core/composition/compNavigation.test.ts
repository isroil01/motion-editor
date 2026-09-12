/**
 * AE nested-composition navigation: double-click opens the comp a precomp
 * layer shows, the Composition Navigator trail walks back out and in, Shift+Esc
 * returns to the previous comp, and the playhead is mapped through the layer
 * at every step ("Synchronize Time Of All Related Items").
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { COMP_REF_PROP } from '@core/scene/compInstance';
import { precomposeSelected } from '@core/scene/sceneInsert';
import { getTimelineController } from '@core/timeline/TimelineController';
import { useProjectStore, type CompositionSettings, type TabInfo } from '@stores/projectStore';
import { useSelectionStore } from '@stores/selectionStore';
import { getTime, setTime } from '@stores/playbackClockStore';
import { deleteComposition } from './compositionOps';
import {
  canOpenPreviousComposition,
  isRealComposition,
  navigateToCrumb,
  nestedTargetOf,
  openLayerComposition,
  openPreviousComposition,
  repairNestedTabs,
} from './compNavigation';
import type { SceneNode } from '@core/types';

const IDENTITY = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } };

function comp(id: string, name: string): CompositionSettings {
  return {
    id, name, width: 1920, height: 1080, fps: 30,
    durationSeconds: 10, background: '#101014', transparent: false, startFrame: 0,
  };
}

function addRoot(id: string, name: string): void {
  defaultSceneGraph.addNode({
    id, name, parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [{ id: `${id}_meta`, type: 'group', props: { [SCENE_KIND_PROP]: 'group' } }],
  } as unknown as SceneNode);
}

function addLayer(id: string, parent: string): void {
  defaultSceneGraph.addChild(parent, {
    id, name: id, parent, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'shape', x: 10, y: 10, width: 20, height: 20 } },
      { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#fff' } },
    ],
  } as never);
}

/** A composition placed as a layer — what Insert ▸ Composition makes. */
function addInstance(id: string, parent: string, ref: string): void {
  defaultSceneGraph.addChild(parent, {
    id, name: id, parent, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'comp', x: 960, y: 540, width: 1920, height: 1080 } },
      { id: `${id}_fx`, type: 'fx', props: { precomp: true, [COMP_REF_PROP]: ref } },
    ],
  } as never);
}

function resetScene(): void {
  const ids: string[] = [];
  defaultSceneGraph.traverse((n) => ids.push(n.id));
  for (const id of ids) defaultSceneGraph.removeNode(id);
}

function active(): TabInfo {
  const s = useProjectStore.getState();
  return s.tabs[s.activeTabId!]!;
}

function tabsFor(compId: string): TabInfo[] {
  return Object.values(useProjectStore.getState().tabs).filter((t) => t.compositionId === compId);
}

beforeEach(() => {
  resetScene();
  const actions = useProjectStore.getState().actions;
  actions.resetTabs();
  addRoot('comp_root', 'Main');
  addRoot('comp_b', 'Lower Third');
  actions.replaceComps({ comp_root: comp('comp_root', 'Main'), comp_b: comp('comp_b', 'Lower Third') });
  useSelectionStore.getState().clear();
});

/** The instance starts 1s into Main, so Main's 2s is Lower Third's 1s. */
function placeLowerThirdAtOneSecond(): void {
  addInstance('inst', 'comp_root', 'comp_b');
  const controller = getTimelineController();
  controller.syncFromScene('comp_root');
  const clip = controller.getLayersForNode('inst')[0]!;
  controller.timeline.setLayerStart(clip.id, 30);
  setTime(active().id, 2);
}

describe('what a double-click opens', () => {
  it('opens the referenced comp for an instance, the subtree for a group, nothing otherwise', () => {
    addInstance('inst', 'comp_root', 'comp_b');
    addLayer('shape', 'comp_root');
    expect(nestedTargetOf('inst')).toEqual({ compId: 'comp_b', title: 'Lower Third', kind: 'instance' });
    expect(nestedTargetOf('shape')).toBeNull();
    // A comp's own root is the composition, not a layer in one.
    expect(nestedTargetOf('comp_root')).toBeNull();
    expect(openLayerComposition('shape')).toBe(false);
    expect(active().compositionId).toBe('comp_root');
  });

  it('opens nothing for an instance whose source comp is gone', () => {
    addInstance('orphan', 'comp_root', 'comp_missing');
    expect(openLayerComposition('orphan')).toBe(false);
  });
});

describe('opening a precomp (AE double-click)', () => {
  it('switches to the nested comp with a trail and the playhead mapped through the layer', () => {
    placeLowerThirdAtOneSecond();
    useSelectionStore.getState().set(['inst']);
    expect(openLayerComposition('inst')).toBe(true);
    const tab = active();
    expect(tab.compositionId).toBe('comp_b');
    expect(tab.breadcrumbPath).toEqual(['comp_root', 'comp_b']);
    expect(tab.breadcrumbVia).toEqual(['inst']);
    expect(getTime(tab.id)).toBeCloseTo(1, 5);
    // The precomp LAYER is not in the comp now in the viewer.
    expect(useSelectionStore.getState().ids).toEqual([]);
  });

  it('re-uses the tab on a second double-click instead of stacking another', () => {
    placeLowerThirdAtOneSecond();
    openLayerComposition('inst');
    navigateToCrumb(0);
    openLayerComposition('inst');
    expect(tabsFor('comp_b')).toHaveLength(1);
  });

  it('opens a precomposed group as its own tab on the parent time axis', () => {
    addLayer('a', 'comp_root');
    useSelectionStore.getState().set(['a']);
    precomposeSelected();
    const groupId = useSelectionStore.getState().ids[0]!;
    setTime(active().id, 3);

    expect(openLayerComposition(groupId)).toBe(true);
    expect(active().compositionId).toBe(groupId);
    expect(active().breadcrumbPath).toEqual(['comp_root', groupId]);
    // The group's layers keep their clips on Main's axis — no offset.
    expect(getTime(active().id)).toBeCloseTo(3, 5);
  });
});

describe('Composition Navigator', () => {
  it('walks back out with the playhead mapped outward, keeping the trail', () => {
    placeLowerThirdAtOneSecond();
    openLayerComposition('inst');
    setTime(active().id, 1.5);

    expect(navigateToCrumb(0)).toBe(true);
    expect(active().compositionId).toBe('comp_root');
    // AE keeps the upstream comp on the bar so it is one click away.
    expect(active().breadcrumbPath).toEqual(['comp_root', 'comp_b']);
    expect(getTime(active().id)).toBeCloseTo(2.5, 5);

    // …and back in through the kept crumb.
    expect(navigateToCrumb(1)).toBe(true);
    expect(active().compositionId).toBe('comp_b');
    expect(getTime(active().id)).toBeCloseTo(1.5, 5);
  });

  it('refuses the current crumb and out-of-range indexes', () => {
    placeLowerThirdAtOneSecond();
    openLayerComposition('inst');
    expect(navigateToCrumb(1)).toBe(false);
    expect(navigateToCrumb(7)).toBe(false);
    expect(active().compositionId).toBe('comp_b');
  });
});

describe('Shift+Esc (open previous composition)', () => {
  it('toggles between a precomp and the comp it was opened from', () => {
    placeLowerThirdAtOneSecond();
    expect(canOpenPreviousComposition()).toBe(false);
    openLayerComposition('inst');

    expect(canOpenPreviousComposition()).toBe(true);
    expect(openPreviousComposition()).toBe(true);
    expect(active().compositionId).toBe('comp_root');
    expect(getTime(active().id)).toBeCloseTo(2, 5);

    expect(openPreviousComposition()).toBe(true);
    expect(active().compositionId).toBe('comp_b');
    expect(getTime(active().id)).toBeCloseTo(1, 5);
  });
});

describe('groups opened in a tab are not compositions', () => {
  it('is not listed as a comp and cannot be deleted as one', () => {
    addLayer('a', 'comp_root');
    useSelectionStore.getState().set(['a']);
    precomposeSelected();
    const groupId = useSelectionStore.getState().ids[0]!;
    openLayerComposition(groupId);

    // openTab seeded a settings record for the tab…
    expect(useProjectStore.getState().comps[groupId]).toBeDefined();
    // …but it is a layer of Main, not a composition.
    expect(isRealComposition(groupId)).toBe(false);
    expect(isRealComposition('comp_b')).toBe(true);
    expect(deleteComposition(groupId)).toBe(false);
    expect(defaultSceneGraph.getNode(groupId)).toBeDefined();
    expect(defaultSceneGraph.getNode('a')).toBeDefined();
  });

  it('steps back out when the group under an open tab disappears (e.g. undo)', () => {
    addLayer('a', 'comp_root');
    useSelectionStore.getState().set(['a']);
    precomposeSelected();
    const groupId = useSelectionStore.getState().ids[0]!;
    openLayerComposition(groupId);

    defaultSceneGraph.removeNode(groupId);
    repairNestedTabs();

    expect(active().compositionId).toBe('comp_root');
    expect(tabsFor(groupId)).toHaveLength(0);
  });
});
