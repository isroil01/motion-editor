import { render, screen, fireEvent } from '@testing-library/react';
import { SplitPane, readDockRailWidth } from './SplitPane';

function renderPane(props: Partial<React.ComponentProps<typeof SplitPane>> = {}) {
  return render(
    <SplitPane direction="horizontal" defaultSize={300} minSize={200} maxSize={600} collapsible {...props}>
      <div data-testid="first">First</div>
      <div data-testid="last">Last</div>
    </SplitPane>,
  );
}

const firstPane = (): HTMLElement => screen.getByTestId('first').parentElement as HTMLElement;

describe('SplitPane collapsible', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(performance.now()); return 1; });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads the rail width from --dock-rail-width and falls back to 36', () => {
    // jsdom computes no custom properties from stylesheets, so this is the fallback path.
    expect(readDockRailWidth()).toBe(36);
  });

  it('double-clicking the divider collapses to the rail and restores to the previous size', () => {
    const onCollapseChange = jest.fn();
    renderPane({ onCollapseChange });
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-expanded', 'true');
    expect(firstPane().style.width).toBe('300px');

    fireEvent.doubleClick(sep);
    expect(onCollapseChange).toHaveBeenLastCalledWith(true);
    expect(sep).toHaveAttribute('aria-expanded', 'false');
    expect(firstPane().style.width).toBe('36px');

    fireEvent.doubleClick(sep);
    expect(onCollapseChange).toHaveBeenLastCalledWith(false);
    expect(firstPane().style.width).toBe('300px');
  });

  it('Enter on the focused divider toggles too', () => {
    renderPane();
    const sep = screen.getByRole('separator');
    fireEvent.keyDown(sep, { key: 'Enter' });
    expect(firstPane().style.width).toBe('36px');
    fireEvent.keyDown(sep, { key: 'Enter' });
    expect(firstPane().style.width).toBe('300px');
  });

  it('dragging under half the minimum snaps to the rail on release', () => {
    const onCollapseChange = jest.fn();
    const onResizeEnd = jest.fn();
    renderPane({ onCollapseChange, onResizeEnd });
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { clientX: 300, clientY: 0, button: 0, pointerId: 1 });
    // 300 → 50: under min/2 (100), so the pane collapses rather than clamping to 200.
    fireEvent(window, new PointerEvent('pointermove', { clientX: 50, clientY: 0 }));
    fireEvent(window, new PointerEvent('pointerup', { clientX: 50, clientY: 0 }));
    expect(onCollapseChange).toHaveBeenLastCalledWith(true);
    expect(onResizeEnd).toHaveBeenLastCalledWith(36);
    expect(firstPane().style.width).toBe('36px');
    // The restore size is the last EXPANDED one, not the rail.
    fireEvent.doubleClick(sep);
    expect(firstPane().style.width).toBe('300px');
  });

  it('dragging a little just clamps to the minimum, as before', () => {
    const onCollapseChange = jest.fn();
    renderPane({ onCollapseChange });
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { clientX: 300, clientY: 0, button: 0, pointerId: 1 });
    fireEvent(window, new PointerEvent('pointermove', { clientX: 150, clientY: 0 }));
    fireEvent(window, new PointerEvent('pointerup', { clientX: 150, clientY: 0 }));
    expect(onCollapseChange).not.toHaveBeenCalled();
    expect(firstPane().style.width).toBe('200px');
  });

  it('is inert without `collapsible`, and only reports when controlled', () => {
    const { unmount } = render(
      <SplitPane direction="horizontal" defaultSize={300} minSize={200} maxSize={600}>
        <div data-testid="first">First</div>
        <div>Last</div>
      </SplitPane>,
    );
    const sep = screen.getByRole('separator');
    expect(sep).not.toHaveAttribute('aria-expanded');
    fireEvent.doubleClick(sep);
    expect(firstPane().style.width).toBe('300px');
    unmount();

    const onCollapseChange = jest.fn();
    renderPane({ collapsed: false, size: 300, onCollapseChange });
    fireEvent.doubleClick(screen.getByRole('separator'));
    expect(onCollapseChange).toHaveBeenCalledWith(true);
    expect(firstPane().style.width).toBe('300px'); // the parent decides
  });
});
