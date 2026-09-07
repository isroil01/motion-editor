/**
 * Face picking — the geometry, not the wiring.
 *
 * These use an explicit projector so a failure means the picking maths is wrong,
 * not that a camera moved.
 *
 * Two paths are under test. The MESH path is what the renderer draws (glyphs,
 * path shapes, rounded rects); jsdom has no canvas, so text tracing is mocked
 * to a square "glyph" inside a wider layer box. The QUAD fallback is what both
 * the renderer and the picker use when no outline can be produced; it is
 * reached here through the same seam the render tests use.
 */

import { projectedFaces, pickFace, faceHighlightGroups } from './facePicking';
import { setExtrusionMeshPath, clearExtrusionMeshCaches } from './extrusionMesh';
import { Matrix4Math } from '@motion/scene';
import type { SceneNode } from '@core/types';

const textPaintSpecFromNode = jest.fn();
const traceTextSpec = jest.fn();
jest.mock('@core/scene/shapesFromText', () => ({
  textPaintSpecFromNode: (node: unknown) => textPaintSpecFromNode(node),
  traceTextSpec: (spec: unknown) => traceTextSpec(spec),
}));

/** Orthographic-down-the-z-axis projector: screen == x/y, depth == z. */
const ortho = (p: { x: number; y: number; z: number }) => ({ x: p.x, y: p.y, depth: p.z });

function node(props: Record<string, unknown>, extra: Array<{ id: string; type: string; props: Record<string, unknown> }> = []): SceneNode {
  return {
    id: 'n1',
    name: 'n',
    parent: null,
    children: [],
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [{ id: 'tr', type: 'Transform', props }, ...extra],
  } as unknown as SceneNode;
}

const IDENTITY = Matrix4Math.compose({
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  anchor: { x: 0, y: 0, z: 0 },
});

/** 90° about Y: the right-hand wall faces the camera, the caps go edge-on. */
const TURNED_Y = Matrix4Math.compose({
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: Math.PI / 2, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  anchor: { x: 0, y: 0, z: 0 },
});

/** ~35° about Y: the front cap AND the right-hand wall are both in view. */
const TILTED_Y = Matrix4Math.compose({
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0.6, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  anchor: { x: 0, y: 0, z: 0 },
});

/** A 20×20 square "glyph" centred in whatever box the text layer measures. */
const square = [
  { x: -10, y: -10, inX: -10, inY: -10, outX: -10, outY: -10 },
  { x: 10, y: -10, inX: 10, inY: -10, outX: 10, outY: -10 },
  { x: 10, y: 10, inX: 10, inY: 10, outX: 10, outY: 10 },
  { x: -10, y: 10, inX: -10, inY: 10, outX: -10, outY: 10 },
];

beforeEach(() => {
  clearExtrusionMeshCaches();
  setExtrusionMeshPath(true);
  textPaintSpecFromNode.mockReset();
  traceTextSpec.mockReset();
  textPaintSpecFromNode.mockReturnValue(null);
  traceTextSpec.mockReturnValue(null);
});

afterAll(() => setExtrusionMeshPath(true));

describe('projectedFaces — quad fallback (no outline available)', () => {
  beforeEach(() => setExtrusionMeshPath(false));

  it('returns nothing for an unextruded layer (it is just the plane)', () => {
    expect(projectedFaces(node({ extrusionDepth: 0 }), IDENTITY, 100, 100, ortho)).toEqual([]);
  });

  it('emits a front cap, a back cap and four walls for a plain box', () => {
    const faces = projectedFaces(node({ extrusionDepth: 50 }), IDENTITY, 100, 80, ortho);
    const kinds = faces.map((f) => f.kind);
    expect(kinds.filter((k) => k === 'front')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'back')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'side')).toHaveLength(4);
    expect(kinds).not.toContain('bevel');
    expect(faces.every((f) => f.verts === undefined)).toBe(true);
  });

  it('classifies chamfer rings as bevel, not side', () => {
    const faces = projectedFaces(node({ extrusionDepth: 60, bevelDepth: 10 }), IDENTITY, 100, 100, ortho);
    expect(faces.filter((f) => f.kind === 'bevel').length).toBeGreaterThan(0);
    // Bevels must not be miscounted as walls — that is what makes the two
    // material rows address different geometry.
    expect(faces.filter((f) => f.kind === 'side').length).toBe(4);
  });

  it('puts the back cap further from the camera than the front', () => {
    const faces = projectedFaces(node({ extrusionDepth: 50 }), IDENTITY, 100, 100, ortho);
    const front = faces.find((f) => f.kind === 'front')!;
    const back = faces.find((f) => f.kind === 'back')!;
    expect(back.depth).toBeGreaterThan(front.depth);
  });

  it('insets the front cap by the bevel, exactly as the renderer draws it', () => {
    const bevelled = projectedFaces(node({ extrusionDepth: 60, bevelDepth: 10 }), IDENTITY, 100, 100, ortho)
      .find((f) => f.kind === 'front')!;
    const xs = bevelled.quad.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80, 5);
  });
});

describe('pickFace — quad fallback', () => {
  beforeEach(() => setExtrusionMeshPath(false));
  const faces = () => projectedFaces(node({ extrusionDepth: 50 }), IDENTITY, 100, 100, ortho);

  it('picks the front face at the centre — it is nearest the camera', () => {
    expect(pickFace(faces(), { x: 0, y: 0 })!.kind).toBe('front');
  });

  it('returns null outside the object', () => {
    expect(pickFace(faces(), { x: 500, y: 500 })).toBeNull();
  });

  it('prefers the nearest face where faces overlap', () => {
    // Both caps project onto the same square down this axis; the front wins.
    const picked = pickFace(faces(), { x: 10, y: 10 })!;
    const back = faces().find((f) => f.kind === 'back')!;
    expect(picked.depth).toBeLessThan(back.depth);
  });

  it('picks a side wall when the object is turned so a wall faces the camera', () => {
    const f = projectedFaces(node({ extrusionDepth: 50 }), TURNED_Y, 100, 100, ortho);
    expect(pickFace(f, { x: 0, y: 0 })!.kind).toBe('side');
  });

  it('ignores an edge-on face even though it sits at the nearest depth', () => {
    // Turned 90°, the front cap collapses to a line THROUGH the origin at z = 0
    // — nearer than the wall the user is actually looking at. Nearest-wins alone
    // would hand it every click.
    const f = projectedFaces(node({ extrusionDepth: 50 }), TURNED_Y, 100, 100, ortho);
    const front = f.find((x) => x.kind === 'front')!;
    expect(front.area).toBeLessThan(1);
    expect(front.depth).toBeLessThan(pickFace(f, { x: 0, y: 0 })!.depth);
  });

  it('carries the renderer face suffix, so a highlight can name the exact quad', () => {
    const picked = pickFace(faces(), { x: 0, y: 0 })!;
    expect(typeof picked.suffix).toBe('string');
    expect(picked.suffix.length).toBeGreaterThan(0);
  });
});

describe('projectedFaces — mesh path (what the renderer draws)', () => {
  it('routes a plain rect through the mesh: triangles per kind, back faces culled', () => {
    const faces = projectedFaces(node({ extrusionDepth: 50 }), IDENTITY, 100, 80, ortho);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((f) => f.verts !== undefined && f.quad.length === 3)).toBe(true);
    // Looking straight down z: the front cap faces us, the back cap is culled.
    expect(faces.some((f) => f.kind === 'front')).toBe(true);
    expect(faces.some((f) => f.kind === 'back')).toBe(false);
    // The suffix of a mesh face is its kind, so every triangle of a surface
    // highlights together.
    expect(faces.every((f) => f.suffix === f.kind)).toBe(true);
  });

  it('picks the front cap at the centre, and nothing outside the box', () => {
    const faces = projectedFaces(node({ extrusionDepth: 50 }), IDENTITY, 100, 80, ortho);
    expect(pickFace(faces, { x: 0, y: 0 })!.kind).toBe('front');
    expect(pickFace(faces, { x: 500, y: 500 })).toBeNull();
  });

  it('shows the back cap, not the front, when the object is turned around', () => {
    const flipped = Matrix4Math.compose({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      anchor: { x: 0, y: 0, z: 0 },
    });
    const faces = projectedFaces(node({ extrusionDepth: 50 }), flipped, 100, 80, ortho);
    expect(pickFace(faces, { x: 0, y: 0 })!.kind).toBe('back');
    expect(faces.some((f) => f.kind === 'front')).toBe(false);
  });

  it('picks a wall when the box is turned so a wall faces the camera', () => {
    const faces = projectedFaces(node({ extrusionDepth: 50 }), TURNED_Y, 100, 100, ortho);
    expect(pickFace(faces, { x: 0, y: 0 })!.kind).toBe('side');
  });

  it('classifies bevel triangles as bevel and insets the front cap by the mesh bevel', () => {
    const faces = projectedFaces(node({ extrusionDepth: 60, bevelDepth: 10 }), IDENTITY, 100, 100, ortho);
    expect(faces.some((f) => f.kind === 'bevel')).toBe(true);
    // Just inside the outer edge is chamfer, the centre is the cap.
    expect(pickFace(faces, { x: 0, y: 0 })!.kind).toBe('front');
    expect(pickFace(faces, { x: 45, y: 0 })!.kind).toBe('bevel');
  });

  it('outlines an ellipse as a ring, so a click in the corner of its box misses', () => {
    const faces = projectedFaces(node({ extrusionDepth: 40 }), IDENTITY, 100, 100, ortho, true);
    expect(pickFace(faces, { x: 0, y: 0 })!.kind).toBe('front');
    expect(pickFace(faces, { x: 47, y: 47 })).toBeNull();
  });

  it('uses a path shape\'s own outline rather than its bounding box', () => {
    // A triangle filling the lower-left half of a 100×100 box.
    const tri = [
      { x: -50, y: -50, inX: -50, inY: -50, outX: -50, outY: -50 },
      { x: -50, y: 50, inX: -50, inY: 50, outX: -50, outY: 50 },
      { x: 50, y: 50, inX: 50, inY: 50, outX: 50, outY: 50 },
    ];
    const n = node({ extrusionDepth: 40 }, [{ id: 'g', type: 'Geometry', props: { points: tri } }]);
    const faces = projectedFaces(n, IDENTITY, 100, 100, ortho);
    expect(pickFace(faces, { x: -30, y: 30 })!.kind).toBe('front');
    // Inside the box, outside the triangle: nothing is drawn there.
    expect(pickFace(faces, { x: 30, y: -30 })).toBeNull();
  });

  describe('text', () => {
    const textNode = () => node({ extrusionDepth: 40 }, [{ id: 'k', type: 'Text', props: { __kind: 'text' } }]);
    beforeEach(() => {
      textPaintSpecFromNode.mockReturnValue({ text: 'I', fontSize: 48, color: '#ffffff', width: 200, height: 80 });
      traceTextSpec.mockReturnValue([{ points: square, open: false }]);
    });

    it('outlines the glyph in the measured text box the renderer extrudes', () => {
      projectedFaces(textNode(), IDENTITY, 200, 80, ortho);
      expect(textPaintSpecFromNode).toHaveBeenCalledTimes(1);
      expect(traceTextSpec).toHaveBeenCalledTimes(1);
      expect(traceTextSpec.mock.calls[0]![0]).toMatchObject({ text: 'I', width: 200, height: 80 });
    });

    it('picks the glyph wall where it is drawn, and nothing in the box beside the glyph', () => {
      const faces = projectedFaces(textNode(), TILTED_Y, 200, 80, ortho);
      // Straight ahead: the glyph's front cap.
      expect(pickFace(faces, { x: 0, y: 0 })!.kind).toBe('front');
      // Tilted 0.6 rad about Y, the glyph's right wall (x = 10, z ∈ [0, 40])
      // sweeps screen x from 10·cos to 10·cos + 40·sin ≈ 8.3 … 30.8.
      const wall = pickFace(faces, { x: 20, y: 0 });
      expect(wall).not.toBeNull();
      expect(wall!.kind).toBe('side');
      // Well inside the 200×80 layer box, but no glyph there: the old rect
      // faces would have answered 'front' here.
      expect(pickFace(faces, { x: 70, y: 0 })).toBeNull();
      expect(pickFace(faces, { x: 0, y: 30 })).toBeNull();
    });

    it('falls back to the box faces when the text cannot be traced (headless)', () => {
      traceTextSpec.mockReturnValue(null);
      const faces = projectedFaces(textNode(), IDENTITY, 200, 80, ortho);
      expect(faces.length).toBeGreaterThan(0);
      expect(faces.every((f) => f.verts === undefined)).toBe(true);
      expect(pickFace(faces, { x: 70, y: 0 })!.kind).toBe('front');
    });
  });
});

describe('faceHighlightGroups', () => {
  it('keeps every quad-fallback face as its own surface with its four edges', () => {
    setExtrusionMeshPath(false);
    const faces = projectedFaces(node({ extrusionDepth: 50 }), TILTED_Y, 100, 100, ortho);
    const groups = faceHighlightGroups(faces);
    const visible = faces.filter((f) => f.area >= 4);
    expect(groups).toHaveLength(visible.length);
    expect(groups.every((g) => g.polygons.length === 1 && g.outline.length === 4)).toBe(true);
  });

  it('merges every triangle of a mesh kind into one surface outlined by its boundary', () => {
    const faces = projectedFaces(node({ extrusionDepth: 50 }), IDENTITY, 100, 80, ortho);
    const groups = faceHighlightGroups(faces);
    const front = groups.find((g) => g.kind === 'front')!;
    expect(front.polygons.length).toBeGreaterThanOrEqual(2);
    // The cap's boundary is the rectangle: four edges, however it triangulates.
    expect(front.outline).toHaveLength(4);
    expect(groups.filter((g) => g.kind === 'front')).toHaveLength(1);
  });
});
