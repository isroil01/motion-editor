/**
 * When an extruded TEXT layer must NOT grow (all of) its body:
 *   • while it is being edited in place — the body is traced from the
 *     layer's text, and showed the pre-edit string through the edit overlay;
 *   • per-character 3D with a bevel — the glyph planes draw the front, so the
 *     mesh must not also paint the whole string on an inset front cap.
 */
import { buildSnapshot } from './buildSnapshot';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { useTextEditStore } from '@stores/textEditStore';
import { clearExtrusionMeshCaches } from '@core/scene/extrusionMesh';

const COMP = { width: 800, height: 600, background: '#101014' };

// Mesh path needs an outline; jsdom has no canvas, so hand the tracer a square.
const square = [
  { x: -10, y: -10, inX: -10, inY: -10, outX: -10, outY: -10 },
  { x: 10, y: -10, inX: 10, inY: -10, outX: 10, outY: -10 },
  { x: 10, y: 10, inX: 10, inY: 10, outX: 10, outY: 10 },
  { x: -10, y: 10, inX: -10, inY: 10, outX: -10, outY: 10 },
];
jest.mock('@core/scene/shapesFromText', () => ({
  traceTextSpec: () => [{ points: square, open: false }],
}));

function text3D(id: string, props: Record<string, unknown> = {}): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 400, y: 300 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [
      { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'text', x: 400, y: 300, rotation: 0, width: 400, height: 80, z: 0, extrusionDepth: 60, ...props } },
      { id: `${id}_x`, type: 'Text', props: { content: 'AB', fontSize: 40, fontFamily: 'Inter', align: 'center' } },
      { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#ffffff' } },
    ],
  } as unknown as SceneNode;
}

const snap = (g: SceneGraph) => buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, COMP);

beforeEach(() => {
  clearExtrusionMeshCaches();
  useTextEditStore.getState().end();
});

describe('buildSnapshot — extruded text body gates', () => {
  it('grows a body normally', () => {
    const g = new SceneGraph();
    g.addNode(text3D('t'));
    expect(snap(g).layers.some((l) => l.id.startsWith('t::ext-'))).toBe(true);
  });

  it('drops the body while the layer is being edited in place, and only that layer', () => {
    const g = new SceneGraph();
    g.addNode(text3D('t'));
    g.addNode(text3D('u'));
    useTextEditStore.getState().begin('t');
    const ids = snap(g).layers.map((l) => l.id);
    expect(ids.some((id) => id.startsWith('t::ext-'))).toBe(false);
    expect(ids.some((id) => id.startsWith('u::ext-'))).toBe(true);
    expect(ids).toContain('t');
  });

  it('per-character 3D + bevel: the mesh has no textured front cap (the glyph planes are the front)', () => {
    const g = new SceneGraph();
    g.addNode(text3D('t', { perChar3D: true, bevelDepth: 4 }));
    const layers = snap(g).layers;
    const mesh = layers.find((l) => l.id === 't::ext-mesh');
    expect(mesh?.extrudedMesh).toBeDefined();
    expect(mesh!.extrudedMesh!.ranges.some((r) => r.role === 'front')).toBe(false);
    expect(layers.filter((l) => l.id.startsWith('t::ch')).length).toBe(2);
  });

  it('plain text + bevel: the mesh DOES own the front cap (control for the case above)', () => {
    const g = new SceneGraph();
    g.addNode(text3D('t', { bevelDepth: 4 }));
    const mesh = snap(g).layers.find((l) => l.id === 't::ext-mesh');
    expect(mesh!.extrudedMesh!.ranges.some((r) => r.role === 'front')).toBe(true);
  });
});
