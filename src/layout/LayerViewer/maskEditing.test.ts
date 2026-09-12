/**
 * The Layer panel's mask geometry: pure point edits, so a drag previews on a
 * draft and commits once.
 */

import type { MaskPoint } from '@core/effects/mask';
import {
  localToScreen,
  maskFromDrag,
  moveHandle,
  moveVertex,
  penPath,
  penPoint,
  screenToLocal,
  translatePoints,
} from './maskEditing';

const corner = (x: number, y: number): MaskPoint => ({ x, y, inX: x, inY: y, outX: x, outY: y });

describe('mask editing geometry', () => {
  it('maps layer space to the panel and back', () => {
    const view = { scale: 0.5, offsetX: 10, offsetY: 20 };
    // The layer's top-left corner (−w/2, −h/2) sits at the fit's offset.
    expect(localToScreen(view, 400, 200, -200, -100)).toEqual([10, 20]);
    const [sx, sy] = localToScreen(view, 400, 200, 30, -40);
    expect(screenToLocal(view, 400, 200, sx, sy)).toEqual([30, -40]);
  });

  it('moves a vertex with its handles, and a whole path', () => {
    const pts = [corner(0, 0), { x: 10, y: 0, inX: 5, inY: -5, outX: 15, outY: 5 }];
    const moved = moveVertex(pts, 1, 2, 3);
    expect(moved[0]).toEqual(pts[0]);
    expect(moved[1]).toEqual({ x: 12, y: 3, inX: 7, inY: -2, outX: 17, outY: 8 });
    expect(translatePoints(pts, 1, 1)[0]).toEqual({ x: 1, y: 1, inX: 1, inY: 1, outX: 1, outY: 1 });
  });

  it('mirrors the opposite handle unless broken (Alt)', () => {
    const pts = [corner(10, 10)];
    expect(moveHandle(pts, 0, 'out', 20, 10, false)[0]).toMatchObject({ outX: 20, outY: 10, inX: 0, inY: 10 });
    expect(moveHandle(pts, 0, 'in', 10, 0, true)[0]).toMatchObject({ inX: 10, inY: 0, outX: 10, outY: 10 });
  });

  it('builds rectangle and ellipse masks from a drag, ignoring a click', () => {
    const rect = maskFromDrag('rect', -50, -20, 50, 40)!;
    expect(rect.closed).toBe(true);
    expect(rect.points.map((p) => [p.x, p.y])).toEqual([[-50, -20], [50, -20], [50, 40], [-50, 40]]);
    const ell = maskFromDrag('ellipse', 0, 0, 100, 60)!;
    expect(ell.points.map((p) => [p.x, p.y])).toEqual([[50, 0], [100, 30], [50, 60], [0, 30]]);
    expect(maskFromDrag('rect', 5, 5, 6, 6)).toBeNull();
  });

  it('makes pen corners and smooth points, and closes three or more into a path', () => {
    expect(penPoint(1, 2)).toEqual(corner(1, 2));
    expect(penPoint(0, 0, 10, 0)).toEqual({ x: 0, y: 0, outX: 10, outY: 0, inX: -10, inY: 0 });
    expect(penPath([corner(0, 0), corner(1, 0)], 'p')).toBeNull();
    const path = penPath([corner(0, 0), corner(10, 0), corner(5, 8)], 'p')!;
    expect(path).toMatchObject({ id: 'p', closed: true, mode: 'add' });
    expect(path.points).toHaveLength(3);
  });
});
