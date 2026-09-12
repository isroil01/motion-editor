/**
 * The Layer panel's paint stroke: layer-space points and layer-pixel size as
 * they are, the eraser always erasing, and clone strokes aimed from the
 * Alt-clicked source.
 */

import { appendPoint, paintStrokeFrom, type LayerPaintSettings } from './layerPaint';

const BASE: LayerPaintSettings = {
  tool: 'paint',
  mode: 'paint',
  color: '#ff0000',
  size: 20,
  opacity: 0.5,
  hardness: 0.8,
  cloneSource: null,
};

describe('Layer panel paint strokes', () => {
  it('writes the drag as it is — layer space, layer pixels', () => {
    const s = paintStrokeFrom([{ x: -10, y: 5 }, { x: 30, y: 5 }], BASE)!;
    expect(s).toMatchObject({ color: '#ff0000', size: 20, opacity: 0.5, hardness: 0.8, mode: 'paint' });
    expect(s.points).toEqual([{ x: -10, y: 5 }, { x: 30, y: 5 }]);
  });

  it('erases with the eraser whatever the Paint panel mode is', () => {
    expect(paintStrokeFrom([{ x: 0, y: 0 }], { ...BASE, tool: 'eraser', mode: 'clone' })!.mode).toBe('erase');
  });

  it('aims a clone stroke from the source, and writes nothing without one', () => {
    const s = paintStrokeFrom([{ x: 10, y: 10 }, { x: 20, y: 10 }], { ...BASE, mode: 'clone', cloneSource: { x: 50, y: 40 } })!;
    expect(s).toMatchObject({ mode: 'clone', cloneOffsetX: 40, cloneOffsetY: 30 });
    expect(paintStrokeFrom([{ x: 0, y: 0 }], { ...BASE, mode: 'clone' })).toBeNull();
    expect(paintStrokeFrom([], BASE)).toBeNull();
  });

  it('drops sub-pixel jitter', () => {
    expect(appendPoint([{ x: 0, y: 0 }], { x: 0.2, y: 0.1 })).toHaveLength(1);
    expect(appendPoint([{ x: 0, y: 0 }], { x: 3, y: 0 })).toHaveLength(2);
  });
});
