/**
 * Rail keyboard traversal.
 *
 * The rail is a `role="tablist"` with a roving tabindex; these pin the arrow
 * / Home / End movement and Enter / Space activation that make the roving
 * index reachable without a mouse.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { DockPanel } from './DockPanel';
import { TooltipProvider } from '@components/Tooltip';
import { useLayoutStore } from '@stores/layoutStore';

// jsdom has no ResizeObserver, and the rail's Radix tooltips construct one
// when their content mounts.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function resetLayoutStore(): void {
  useLayoutStore.setState({
    panels: {},
    panelOrder: {
      leftSidebar: [],
      leftSidebar_bottom: [],
      rightInspector: [],
      rightInspector_bottom: [],
      centerWorkspace: [],
      bottomTimeline: [],
    },
    activePanelByRegion: {},
  });
}

const renderers = {
  alpha: () => <div>alpha body</div>,
  beta: () => <div>beta body</div>,
  gamma: () => <div>gamma body</div>,
};

function mount(): void {
  act(() => {
    const s = useLayoutStore.getState();
    s.registerPanel({ id: 'alpha', region: 'rightInspector', title: 'Alpha' });
    s.registerPanel({ id: 'beta', region: 'rightInspector', title: 'Beta' });
    s.registerPanel({ id: 'gamma', region: 'rightInspector', title: 'Gamma' });
    s.openPanel('alpha');
  });
  render(<TooltipProvider><DockPanel region="rightInspector" renderers={renderers} /></TooltipProvider>);
}

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });

describe('DockPanel rail keyboard traversal', () => {
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
  });

  beforeEach(resetLayoutStore);

  it('only the active tab is in the tab order', () => {
    mount();
    expect(tab('Alpha').tabIndex).toBe(0);
    expect(tab('Beta').tabIndex).toBe(-1);
    expect(tab('Gamma').tabIndex).toBe(-1);
  });

  it('ArrowDown / ArrowUp move focus and the roving index, wrapping at the ends', () => {
    mount();
    tab('Alpha').focus();
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tab('Beta'));
    expect(tab('Beta').tabIndex).toBe(0);
    expect(tab('Alpha').tabIndex).toBe(-1);
    // Focus moved, activation did not.
    expect(screen.getByText('alpha body')).toBeInTheDocument();

    fireEvent.keyDown(tab('Beta'), { key: 'ArrowUp' });
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(tab('Gamma'));
    fireEvent.keyDown(tab('Gamma'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Alpha'));
  });

  it('Home and End jump to the first and last tab', () => {
    mount();
    tab('Alpha').focus();
    fireEvent.keyDown(tab('Alpha'), { key: 'End' });
    expect(document.activeElement).toBe(tab('Gamma'));
    fireEvent.keyDown(tab('Gamma'), { key: 'Home' });
    expect(document.activeElement).toBe(tab('Alpha'));
  });

  it('Enter and Space activate the focused tab', () => {
    mount();
    tab('Alpha').focus();
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowDown' });
    fireEvent.keyDown(tab('Beta'), { key: 'Enter' });
    expect(screen.getByText('beta body')).toBeInTheDocument();
    expect(useLayoutStore.getState().activePanelByRegion.rightInspector).toBe('beta');

    fireEvent.keyDown(tab('Beta'), { key: 'ArrowDown' });
    fireEvent.keyDown(tab('Gamma'), { key: ' ' });
    expect(screen.getByText('gamma body')).toBeInTheDocument();
  });
});
