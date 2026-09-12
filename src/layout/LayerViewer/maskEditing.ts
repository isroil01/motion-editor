/**
 * maskEditing — the geometry behind drawing and reshaping masks in the Layer
 * panel. Pure: every function takes points and returns NEW points, so a drag
 * previews on a draft and commits once, and the whole module is testable
 * without a canvas.
 *
 * Mask points are in the layer's own space, CENTRED on its origin
 * ([-w/2, w/2] × [-h/2, h/2]); handles are absolute positions, equal to the
 * vertex for a corner (see `MaskPoint`).
 */

import { ellipseMask, rectangleMask, type MaskPath, type MaskPoint } from '@core/effects/mask';

export interface ViewFit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Layer-local (centred) → screen, through the panel's fit of a `w × h` frame. */
export function localToScreen(view: ViewFit, w: number, h: number, x: number, y: number): [number, number] {
  return [view.offsetX + view.scale * (x + w / 2), view.offsetY + view.scale * (y + h / 2)];
}

/** Screen → layer-local (centred). */
export function screenToLocal(view: ViewFit, w: number, h: number, sx: number, sy: number): [number, number] {
  return [(sx - view.offsetX) / view.scale - w / 2, (sy - view.offsetY) / view.scale - h / 2];
}

const shift = (p: MaskPoint, dx: number, dy: number): MaskPoint => ({
  ...p,
  x: p.x + dx, y: p.y + dy,
  inX: p.inX + dx, inY: p.inY + dy,
  outX: p.outX + dx, outY: p.outY + dy,
});

/** Move a whole path. */
export function translatePoints(points: ReadonlyArray<MaskPoint>, dx: number, dy: number): MaskPoint[] {
  return points.map((p) => shift(p, dx, dy));
}

/** Move one vertex; its handles travel with it, as in every pen tool. */
export function moveVertex(points: ReadonlyArray<MaskPoint>, index: number, dx: number, dy: number): MaskPoint[] {
  return points.map((p, i) => (i === index ? shift(p, dx, dy) : p));
}

/**
 * Put one handle of vertex `index` at (x, y). Unless `broken` (Alt in AE), the
 * opposite handle mirrors it through the vertex, keeping the curve smooth.
 */
export function moveHandle(
  points: ReadonlyArray<MaskPoint>,
  index: number,
  which: 'in' | 'out',
  x: number,
  y: number,
  broken: boolean,
): MaskPoint[] {
  return points.map((p, i) => {
    if (i !== index) return p;
    const mx = 2 * p.x - x;
    const my = 2 * p.y - y;
    if (which === 'out') return { ...p, outX: x, outY: y, ...(broken ? {} : { inX: mx, inY: my }) };
    return { ...p, inX: x, inY: y, ...(broken ? {} : { outX: mx, outY: my }) };
  });
}

/**
 * A rectangle or ellipse mask spanning a drag from (x0, y0) to (x1, y1) in
 * layer space, or null for a drag too small to mean a shape (a click).
 */
export function maskFromDrag(kind: 'rect' | 'ellipse', x0: number, y0: number, x1: number, y1: number): MaskPath | null {
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (w < 2 || h < 2) return null;
  const base = kind === 'rect' ? rectangleMask(w, h) : ellipseMask(w, h);
  return { ...base, points: translatePoints(base.points, (x0 + x1) / 2, (y0 + y1) / 2) };
}

/**
 * One pen vertex at (x, y). A plain click makes a corner; dragging to (dx, dy)
 * pulls a smooth point — the outgoing handle follows the pointer and the
 * incoming one mirrors it.
 */
export function penPoint(x: number, y: number, dragX?: number, dragY?: number): MaskPoint {
  if (dragX === undefined || dragY === undefined || Math.hypot(dragX - x, dragY - y) < 1) {
    return { x, y, inX: x, inY: y, outX: x, outY: y };
  }
  return { x, y, outX: dragX, outY: dragY, inX: 2 * x - dragX, inY: 2 * y - dragY };
}

/** A closed path from pen points, or null with fewer than three. */
export function penPath(points: ReadonlyArray<MaskPoint>, id: string): MaskPath | null {
  if (points.length < 3) return null;
  return {
    id, mode: 'add', closed: true, feather: 0, opacity: 1, expansion: 0, inverted: false,
    points: points.map((p) => ({ ...p })),
  };
}
