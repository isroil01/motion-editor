/**
 * The four comparison modes, against a recording 2D-context stub.
 *
 * `drawCompare` is exported separately from the component for exactly this:
 * the modes are a small amount of geometry with a large amount of meaning
 * (which half is live, where the clip falls, whether difference is amplified),
 * and none of it needs a mounted viewport to check.
 *
 * The property that matters most is the one asserted first: three of the four
 * modes must leave part of the canvas UNPAINTED, because that is what lets the
 * live content canvas underneath show through. A mode that painted everything
 * would show a frozen frame and call it a comparison.
 */

import { drawCompare } from './CompareOverlay';
import type { CompareSnapshot } from '@stores/compareStore';

interface Call {
  op: string;
  args: unknown[];
}

function stubCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const rec = (op: string) => (...args: unknown[]) => { calls.push({ op, args }); };
  const ctx = {
    canvas: { width: 100, height: 50 },
    globalCompositeOperation: 'source-over',
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    rect: rec('rect'),
    clip: rec('clip'),
    drawImage: rec('drawImage'),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function snap(): CompareSnapshot {
  return {
    id: 'snap_1',
    label: 'Snapshot 1',
    time: 0,
    takenAt: 0,
    bitmap: {} as HTMLCanvasElement,
    width: 100,
    height: 50,
    view: { scale: 1, offsetX: 0, offsetY: 0 },
  };
}

const SIZE = { w: 100, h: 50 };

describe('drawCompare', () => {
  it('toggle draws the snapshot only while it is the side being shown', () => {
    const shown = stubCtx();
    drawCompare(shown.ctx, snap(), 'toggle', 0.5, true, SIZE);
    expect(shown.calls.filter((c) => c.op === 'drawImage')).toHaveLength(1);

    // Flipped back to live: nothing is painted, so the content canvas shows.
    const live = stubCtx();
    drawCompare(live.ctx, snap(), 'toggle', 0.5, false, SIZE);
    expect(live.calls.filter((c) => c.op === 'drawImage')).toHaveLength(0);
  });

  it('side-by-side clips the snapshot to the left half', () => {
    const { ctx, calls } = stubCtx();
    drawCompare(ctx, snap(), 'side-by-side', 0.5, true, SIZE);
    const rect = calls.find((c) => c.op === 'rect');
    expect(rect?.args).toEqual([0, 0, 50, 50]);
    expect(calls.some((c) => c.op === 'clip')).toBe(true);
  });

  it('wipe clips at the divider, and the divider moves with it', () => {
    for (const [wipe, expectedWidth] of [[0, 0], [0.25, 25], [1, 100]] as const) {
      const { ctx, calls } = stubCtx();
      drawCompare(ctx, snap(), 'wipe', wipe, true, SIZE);
      expect(calls.find((c) => c.op === 'rect')?.args).toEqual([0, 0, expectedWidth, 50]);
    }
  });

  it('wipe clamps a divider dragged past either edge', () => {
    const { ctx, calls } = stubCtx();
    drawCompare(ctx, snap(), 'wipe', 4, true, SIZE);
    expect(calls.find((c) => c.op === 'rect')?.args).toEqual([0, 0, 100, 50]);
  });

  it('difference draws the snapshot even with no live copy, rather than nothing', () => {
    // No render loop has run, so `liveFrame()` is null. An empty stage would
    // read as "the frames are identical", which is the one wrong answer.
    const { ctx, calls } = stubCtx();
    drawCompare(ctx, snap(), 'difference', 0.5, true, SIZE);
    expect(calls.filter((c) => c.op === 'drawImage')).toHaveLength(1);
    // …and it does not leave a composite operation set on the shared context.
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });
});
