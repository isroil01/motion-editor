import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { openCompositionSettings, CompositionSettings } from './CompositionSettingsDialog';
import { useModalStore } from '@stores/modalStore';
import { useProjectStore } from '@stores/projectStore';
import { useCompositionStore, DEFAULT_COMPOSITION } from '@stores/compositionStore';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { CommandSystem, setCommandSystem } from '@core/commands/CommandSystem';
import { TooltipProvider } from '@components/Tooltip';

const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

function resetScene(): void {
  const ids: string[] = [];
  defaultSceneGraph.traverse((n) => ids.push(n.id));
  for (const id of ids) defaultSceneGraph.removeNode(id);
}

describe('CompositionSettingsDialog', () => {
  const testCompId = 'comp_test_1';

  beforeEach(() => {
    resetScene();
    setCommandSystem(new CommandSystem({ services: {} as never, getState: () => ({}) }));
    useModalStore.setState({ stack: [] });

    // Setup active tab and comp in project store
    const testComp = {
      ...DEFAULT_COMPOSITION,
      id: testCompId,
      name: 'Main Showcase',
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 10,
      background: '#101014',
      transparent: false,
    };

    useProjectStore.setState({
      comps: { [testCompId]: testComp },
      tabs: {
        tab_1: {
          id: 'tab_1',
          compositionId: testCompId,
          breadcrumbPath: [testCompId],
          title: 'Main Showcase',
          time: 0,
          frame: 0,
          playing: false,
          dirty: false,
        },
      },
      activeTabId: 'tab_1',
    });
  });

  it('opens modal with size "lg", descriptive subtitle, and title "Composition Settings"', () => {
    openCompositionSettings();
    const stack = useModalStore.getState().stack;
    expect(stack.length).toBe(1);
    expect(stack[0]?.title).toBe('Composition Settings');
    expect(stack[0]?.size).toBe('lg');
    expect(stack[0]?.description).toContain('Main Showcase');
    expect(stack[0]?.description).toContain('1920 × 1080');
    expect(stack[0]?.description).toContain('30 fps');
  });

  it('renders initial composition values and live visual preview', () => {
    render(<CompositionSettings close={jest.fn()} />);

    // Name field
    const nameInput = screen.getByLabelText(/composition name/i);
    expect(nameInput).toHaveValue('Main Showcase');

    // Visual preview info
    expect(screen.getByText('1920 × 1080 px')).toBeInTheDocument();
    expect(screen.getByText('Landscape')).toBeInTheDocument();
    expect(screen.getAllByText('16:9').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/30 fps/i).length).toBeGreaterThanOrEqual(1);

    // Resolution preset indicator
    expect(screen.getAllByText('YouTube 1080p').length).toBeGreaterThanOrEqual(1);
  });

  it('updates resolution, locks aspect ratio, and swaps dimensions', () => {
    render(<CompositionSettings close={jest.fn()} />);

    // Swap orientation (1920x1080 -> 1080x1920)
    const swapBtn = screen.getByLabelText(/swap width and height/i);
    fireEvent.click(swapBtn);

    const comp = useCompositionStore.getState().comp();
    expect(comp.width).toBe(1080);
    expect(comp.height).toBe(1920);
    expect(screen.getByText('Portrait')).toBeInTheDocument();
    expect(screen.getAllByText('9:16').length).toBeGreaterThanOrEqual(1);

    // Toggle aspect ratio lock
    const lockBtn = screen.getByLabelText(/lock aspect ratio/i);
    fireEvent.click(lockBtn);
    expect(screen.getByLabelText(/unlock aspect ratio/i)).toBeInTheDocument();

    // Enter edit mode on Width spinbutton
    const widthSpin = screen.getByRole('spinbutton', { name: 'Width' });
    fireEvent.keyDown(widthSpin, { key: 'Enter' });

    // Change width to 540
    const widthInput = screen.getByDisplayValue('1080');
    fireEvent.change(widthInput, { target: { value: '540' } });
    fireEvent.blur(widthInput);

    // Height should proportionally scale: 540 / (1080/1920) = 960
    expect(screen.getByText('540 × 960 px')).toBeInTheDocument();
  });

  it('selects quick popular presets', () => {
    render(<CompositionSettings close={jest.fn()} />);

    // Click 4K UHD preset chip
    const uhdChip = screen.getByRole('button', { name: /4K UHD/i });
    fireEvent.click(uhdChip);

    const comp = useCompositionStore.getState().comp();
    expect(comp.width).toBe(3840);
    expect(comp.height).toBe(2160);
    expect(screen.getByText('3840 × 2160 px')).toBeInTheDocument();
  });

  it('switches to Background tab and updates transparency and studio swatches', () => {
    render(<CompositionSettings close={jest.fn()} />);

    // Switch to Background tab
    const bgTab = screen.getByRole('tab', { name: /background/i });
    fireEvent.click(bgTab);

    expect(screen.getByText(/scene canvas background/i)).toBeInTheDocument();

    // Toggle transparent switch
    const transparentSwitch = screen.getByRole('switch', { name: /canvas transparency/i });
    expect(transparentSwitch).not.toBeChecked();
    fireEvent.click(transparentSwitch);

    expect(useCompositionStore.getState().transparent).toBe(true);

    // Click Studio Dark swatch (re-enables solid color)
    const studioDarkSwatch = screen.getByLabelText(/studio dark/i);
    fireEvent.click(studioDarkSwatch);

    expect(useCompositionStore.getState().transparent).toBe(false);
    expect(useCompositionStore.getState().background).toBe('#101014');
  });

  it('switches between all tabs without errors', () => {
    render(<CompositionSettings close={jest.fn()} />);

    // Grid tab
    fireEvent.click(screen.getByRole('tab', { name: /grid & guides/i }));
    expect(screen.getByText(/pixel grid/i)).toBeInTheDocument();

    // World tab
    fireEvent.click(screen.getByRole('tab', { name: /world/i }));
    expect(screen.getByText(/default sky preset/i)).toBeInTheDocument();

    // Time tab
    fireEvent.click(screen.getByRole('tab', { name: /time/i }));
    expect(screen.getByText(/responsive time/i)).toBeInTheDocument();

    // Color tab
    fireEvent.click(screen.getByRole('tab', { name: /color/i }));
    expect(screen.getByText(/working space/i)).toBeInTheDocument();
  });

  it('reverts modifications when clicking Cancel', () => {
    const close = jest.fn();
    render(<CompositionSettings close={close} />);

    // Change comp name
    const nameInput = screen.getByLabelText(/composition name/i);
    fireEvent.change(nameInput, { target: { value: 'Modified Name' } });

    // Change resolution
    const uhdChip = screen.getByRole('button', { name: /4K UHD/i });
    fireEvent.click(uhdChip);

    expect(useCompositionStore.getState().name).toBe('Modified Name');
    expect(useCompositionStore.getState().width).toBe(3840);

    // Click Cancel
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    // Store should be restored to initial state
    expect(useCompositionStore.getState().name).toBe('Main Showcase');
    expect(useCompositionStore.getState().width).toBe(1920);
    expect(useCompositionStore.getState().height).toBe(1080);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('persists modifications when clicking Save Changes', () => {
    const close = jest.fn();
    render(<CompositionSettings close={close} />);

    // Change FPS
    const fps60 = screen.getByRole('button', { name: /60 fps/i });
    fireEvent.click(fps60);

    expect(useCompositionStore.getState().fps).toBe(60);

    // Click Save Changes
    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveBtn);

    expect(useCompositionStore.getState().fps).toBe(60);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
