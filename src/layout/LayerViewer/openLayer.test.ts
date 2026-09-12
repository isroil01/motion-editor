/**
 * What a double-click on a layer opens — AE's rules and its two "Opening
 * Layers with Double-click" preferences (Alt swaps them; a paint tool always
 * means the Layer panel).
 */

jest.mock('@layout/Assets/FootagePreviewDialog', () => ({ openFootagePreview: jest.fn() }));

import { openFootagePreview } from '@layout/Assets/FootagePreviewDialog';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { COMP_REF_PROP } from '@core/scene/compInstance';
import { useProjectStore, type CompositionSettings } from '@stores/projectStore';
import { useLayerViewerStore } from '@stores/layerViewerStore';
import { usePreferenceStore } from '@stores/preferenceStore';
import { useUIStore } from '@stores/uiStore';
import { useAssetStore } from '@stores/assetStore';
import type { SceneNode } from '@core/types';
import { canOpenInLayerPanel, openLayerOnDoubleClick } from './openLayer';

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

function add(id: string, transform: Record<string, unknown>, fx?: Record<string, unknown>): void {
  defaultSceneGraph.addChild('comp_root', {
    id, name: id, parent: 'comp_root', children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      { id: `${id}_t`, type: 'Transform', props: { x: 100, y: 100, width: 320, height: 180, ...transform } },
      { id: `${id}_s`, type: 'Style', props: { opacity: 100 } },
      ...(fx ? [{ id: `${id}_fx`, type: 'fx', props: fx }] : []),
    ],
  } as never);
}

const activeComp = (): string => {
  const s = useProjectStore.getState();
  return s.tabs[s.activeTabId!]!.compositionId;
};
const panel = (): string | null => useLayerViewerStore.getState().nodeId;

beforeEach(() => {
  const ids: string[] = [];
  defaultSceneGraph.traverse((n) => ids.push(n.id));
  for (const id of ids) defaultSceneGraph.removeNode(id);
  const actions = useProjectStore.getState().actions;
  actions.resetTabs();
  addRoot('comp_root');
  addRoot('comp_b');
  actions.replaceComps({ comp_root: comp('comp_root', 'Main'), comp_b: comp('comp_b', 'Lower Third') });

  add('vid', { [SCENE_KIND_PROP]: 'video', assetId: 'asset_1', src: 'blob:clip' });
  add('sol', { [SCENE_KIND_PROP]: 'shape' }, { solid: true, fill: { type: 'solid', color: '#ff0000' } });
  add('txt', { [SCENE_KIND_PROP]: 'text' });
  add('shp', { [SCENE_KIND_PROP]: 'shape' });
  add('inst', { [SCENE_KIND_PROP]: 'comp' }, { precomp: true, [COMP_REF_PROP]: 'comp_b' });

  useAssetStore.setState({ assets: [{ id: 'asset_1', name: 'clip.mp4', type: 'video', src: 'blob:clip' }] } as never);
  useLayerViewerStore.getState().close();
  usePreferenceStore.getState().set('footageLayerOpens', 'layer');
  usePreferenceStore.getState().set('compLayerOpens', 'nested');
  useUIStore.setState({ activeTool: 'select' } as never);
  (openFootagePreview as jest.Mock).mockClear();
});

describe('footage layers', () => {
  it('open in the Layer panel by default', () => {
    expect(openLayerOnDoubleClick('vid')).toBe(true);
    expect(panel()).toBe('vid');
    expect(openFootagePreview).not.toHaveBeenCalled();
  });

  it('open their source with "Source Footage", and Alt opens the Layer panel instead', () => {
    usePreferenceStore.getState().set('footageLayerOpens', 'source');
    expect(openLayerOnDoubleClick('vid')).toBe(true);
    expect(openFootagePreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'asset_1' }));
    expect(panel()).toBeNull();

    expect(openLayerOnDoubleClick('vid', { alt: true })).toBe(true);
    expect(panel()).toBe('vid');
  });

  it('always open the Layer panel with a paint tool, and for a solid (no source to show)', () => {
    usePreferenceStore.getState().set('footageLayerOpens', 'source');
    useUIStore.setState({ activeTool: 'paint' } as never);
    openLayerOnDoubleClick('vid');
    expect(panel()).toBe('vid');

    useUIStore.setState({ activeTool: 'select' } as never);
    openLayerOnDoubleClick('sol');
    expect(panel()).toBe('sol');
    expect(openFootagePreview).not.toHaveBeenCalled();
  });
});

describe('composition layers', () => {
  it('open the nested composition by default', () => {
    expect(openLayerOnDoubleClick('inst')).toBe(true);
    expect(activeComp()).toBe('comp_b');
    expect(panel()).toBeNull();
  });

  it('open in the Layer panel with Alt', () => {
    expect(openLayerOnDoubleClick('inst', { alt: true })).toBe(true);
    expect(panel()).toBe('inst');
    expect(activeComp()).toBe('comp_root');
  });

  it('follow "Composition Layer Opens: Layer Panel", Alt then opening the comp', () => {
    usePreferenceStore.getState().set('compLayerOpens', 'layer');
    openLayerOnDoubleClick('inst');
    expect(panel()).toBe('inst');
    openLayerOnDoubleClick('inst', { alt: true });
    expect(activeComp()).toBe('comp_b');
  });
});

describe('layers with no Layer panel', () => {
  it('open nothing for text and shape layers', () => {
    expect(openLayerOnDoubleClick('txt')).toBe(false);
    expect(openLayerOnDoubleClick('shp')).toBe(false);
    expect(panel()).toBeNull();
    expect(['vid', 'sol', 'inst', 'txt', 'shp'].map((id) => canOpenInLayerPanel(defaultSceneGraph.getNode(id))))
      .toEqual([true, true, true, false, false]);
  });
});
