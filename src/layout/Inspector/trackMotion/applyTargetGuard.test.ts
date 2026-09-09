import { needsSelfApplyConfirm, selfApplyConfirmCopy } from './applyTargetGuard';

describe('needsSelfApplyConfirm', () => {
  it('asks when the target IS the tracked footage', () => {
    expect(needsSelfApplyConfirm({ mode: 'follow', targetId: 'clip', sourceId: 'clip' })).toBe(true);
    expect(needsSelfApplyConfirm({ mode: 'transform', targetId: 'clip', sourceId: 'clip' })).toBe(true);
    expect(needsSelfApplyConfirm({ mode: 'corner', targetId: 'clip', sourceId: 'clip' })).toBe(true);
  });

  it('never asks for any other target', () => {
    expect(needsSelfApplyConfirm({ mode: 'follow', targetId: 'null_1', sourceId: 'clip' })).toBe(false);
    expect(needsSelfApplyConfirm({ mode: 'transform', targetId: 'text', sourceId: 'clip' })).toBe(false);
    expect(needsSelfApplyConfirm({ mode: 'corner', targetId: 'screen', sourceId: 'clip' })).toBe(false);
  });

  it('never asks in Stabilize — inverse motion on this layer is the point', () => {
    expect(needsSelfApplyConfirm({ mode: 'stabilize', targetId: 'clip', sourceId: 'clip' })).toBe(false);
  });

  it('never asks in the modes that apply as they track', () => {
    expect(needsSelfApplyConfirm({ mode: 'mask', targetId: 'clip', sourceId: 'clip' })).toBe(false);
    expect(needsSelfApplyConfirm({ mode: 'smooth', targetId: 'clip', sourceId: 'clip' })).toBe(false);
  });
});

describe('selfApplyConfirmCopy', () => {
  it('names the layer, says what would happen, and offers the null', () => {
    const c = selfApplyConfirmCopy({ mode: 'follow', layerName: 'Interview.mp4' });
    expect(c.message).toContain('Interview.mp4');
    expect(c.message).toMatch(/move the footage under its own track/);
    expect(c.confirmLabel).toBe('Create null & apply');
  });

  it('describes corner pin in its own terms', () => {
    expect(selfApplyConfirmCopy({ mode: 'corner', layerName: 'x' }).message).toMatch(/pin the footage/);
  });
});
