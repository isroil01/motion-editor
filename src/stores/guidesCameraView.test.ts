import { useGuidesStore, isCamera3dMode, type CameraBookmark } from './guidesStore';

/**
 * `camera:<id>` view modes are view state like every other mode: they must
 * round-trip through the store (main view, 2-up, 4-up cells), change the render
 * key, and survive a document's bookmarks being read back — which is the one
 * place a mode crosses a trust boundary.
 */
describe('guidesStore camera views', () => {
  beforeEach(() => {
    useGuidesStore.setState({
      camera3dMode: 'active',
      secondaryViewMode: 'top',
      quadViewModes: ['active', 'front', 'top', 'custom1'],
      cameraBookmarks: {},
    });
  });

  it('holds a camera view as the main, secondary and quad-cell mode', () => {
    const s = useGuidesStore.getState();
    s.setCamera3dMode('camera:cam_b');
    s.setSecondaryViewMode('camera:cam_a');
    s.setQuadViewMode(2, 'camera:cam_a');
    const next = useGuidesStore.getState();
    expect(next.camera3dMode).toBe('camera:cam_b');
    expect(next.secondaryViewMode).toBe('camera:cam_a');
    expect(next.quadViewModes).toEqual(['active', 'front', 'camera:cam_a', 'custom1']);
  });

  it('does not touch lastCustomView (the `2` key target)', () => {
    useGuidesStore.getState().setCamera3dMode('custom3');
    useGuidesStore.getState().setCamera3dMode('camera:cam_b');
    expect(useGuidesStore.getState().lastCustomView).toBe('custom3');
  });

  it('changes the render key between two camera views', () => {
    useGuidesStore.getState().setCamera3dMode('camera:cam_a');
    const a = useGuidesStore.getState().key();
    useGuidesStore.getState().setCamera3dMode('camera:cam_b');
    const b = useGuidesStore.getState().key();
    useGuidesStore.getState().setCamera3dMode('active');
    const active = useGuidesStore.getState().key();
    expect(a).not.toBe(b);
    expect(b).not.toBe(active);
  });

  it('isCamera3dMode accepts every known form and nothing else', () => {
    for (const m of ['active', 'front', 'bottom', 'custom1', 'custom3', 'camera:x']) {
      expect(isCamera3dMode(m)).toBe(true);
    }
    for (const m of ['camera:', 'sideways', 'custom4', '', 7, null, undefined]) {
      expect(isCamera3dMode(m)).toBe(false);
    }
  });

  it('a bookmark on a camera view round-trips through settings() / restore()', () => {
    const bookmark: CameraBookmark = {
      slot: 3,
      name: 'Alt angle',
      mode: 'camera:cam_b',
      framing: { center: { x: 10, y: 20 }, zoom: 1.5 },
    };
    useGuidesStore.getState().saveCameraBookmark('comp1', bookmark);
    const saved = JSON.parse(JSON.stringify(useGuidesStore.getState().settings()));
    useGuidesStore.setState({ cameraBookmarks: {} });
    useGuidesStore.getState().restore(saved);
    expect(useGuidesStore.getState().cameraBookmarks.comp1?.[0]?.mode).toBe('camera:cam_b');
  });

  it('an unknown bookmark mode opens as Active Camera instead of being cast into the union', () => {
    useGuidesStore.getState().restore({
      cameraBookmarks: {
        comp1: [{ slot: 1, name: 'From the future', mode: 'hologram' as never, framing: { center: { x: 0, y: 0 }, zoom: 1 } }],
      },
    });
    const b = useGuidesStore.getState().cameraBookmarks.comp1?.[0];
    expect(b?.mode).toBe('active');
    // Kept, not dropped: its framing and name are still worth having.
    expect(b?.name).toBe('From the future');
  });
});
