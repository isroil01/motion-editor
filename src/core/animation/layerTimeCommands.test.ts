import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { defaultAnimation } from '@motion/animation';
import { useSelectionStore } from '@stores/selectionStore';
import { getNodeLayerTime } from '@core/scene/layerTime';
import { setCommandSystem, CommandSystem } from '@core/commands/CommandSystem';
import {
  buildLayerTimeCommands,
  timeTargets,
  toggleReverse,
  toggleFreeze,
  applyStretch,
  setFrameBlend,
  toggleTimeRemap,
  hasTimeRemap,
} from './layerTimeCommands';

function bootCommandSystem(): void {
  const services = {
    undo: { push: () => {}, undo: () => {}, redo: () => {}, canUndo: () => false, canRedo: () => false },
    selection: { get: () => [], set: () => {}, clear: () => {} },
    panels: { open: () => {}, close: () => {}, toggle: () => {}, isOpen: () => false },
    workspace: { setActive: () => {}, getActive: () => '' },
    get: () => undefined,
  } as never;
  setCommandSystem(new CommandSystem({ services, getState: () => ({}) as never }));
}

const VIDEO = 'lt_video';
const SHAPE = 'lt_shape';

function addNode(id: string, kind: string): void {
  defaultSceneGraph.addChild('comp_root', {
    id,
    name: id,
    parent: 'comp_root',
    children: [],
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    visible: true,
    locked: false,
    components: [{ id: `${id}_t`, type: 'Transform', props: { __kind: kind } }],
  } as never);
}

beforeEach(() => {
  bootCommandSystem();
  for (const id of [VIDEO, SHAPE]) {
    if (defaultSceneGraph.getNode(id)) defaultSceneGraph.removeNode?.(id);
  }
  addNode(VIDEO, 'video');
  addNode(SHAPE, 'shape');
  defaultAnimation.removeTrack(VIDEO, 'timeRemap');
  useSelectionStore.setState({ ids: [VIDEO, SHAPE] });
});

describe('Layer ▸ Time commands', () => {
  it('only footage-like layers are targets, and the commands enable on them', () => {
    expect(timeTargets()).toEqual([VIDEO]);
    const cmds = buildLayerTimeCommands();
    expect(cmds.map((c) => String(c.id))).toEqual(expect.arrayContaining([
      'time.reverseLayer', 'time.freezeFrame', 'time.timeStretch', 'time.enableTimeRemap', 'time.frameBlend.mix',
    ]));
    for (const c of cmds) expect(c.enabled?.()).toBe(true);
    useSelectionStore.setState({ ids: [SHAPE] });
    for (const c of cmds) expect(c.enabled?.()).toBe(false);
  });

  it('reverse and freeze toggle, freeze holding the playhead time', () => {
    toggleReverse([VIDEO]);
    expect(getNodeLayerTime(VIDEO).reverse).toBe(true);
    toggleReverse([VIDEO]);
    expect(getNodeLayerTime(VIDEO).reverse).toBe(false);

    toggleFreeze([VIDEO], 2.5);
    expect(getNodeLayerTime(VIDEO)).toMatchObject({ freeze: true, freezeTime: 2.5 });
    toggleFreeze([VIDEO], 4);
    expect(getNodeLayerTime(VIDEO).freeze).toBe(false);
  });

  it('stretch is clamped to 1…1000 %, frame blend writes the mode', () => {
    applyStretch([VIDEO], 200);
    expect(getNodeLayerTime(VIDEO).stretch).toBe(200);
    applyStretch([VIDEO], 0);
    expect(getNodeLayerTime(VIDEO).stretch).toBe(1);
    applyStretch([VIDEO], 5000);
    expect(getNodeLayerTime(VIDEO).stretch).toBe(1000);
    setFrameBlend([VIDEO], 'pixelMotion');
    expect(getNodeLayerTime(VIDEO).frameBlend).toBe('pixelMotion');
  });

  it('time remap enables with one identity keyframe at the playhead and removes cleanly', () => {
    expect(hasTimeRemap(VIDEO)).toBe(false);
    toggleTimeRemap([VIDEO], 1.5);
    expect(hasTimeRemap(VIDEO)).toBe(true);
    expect(defaultAnimation.sample(VIDEO, 'timeRemap', 1.5)).toBeCloseTo(1.5);
    toggleTimeRemap([VIDEO], 1.5);
    expect(hasTimeRemap(VIDEO)).toBe(false);
  });
});
