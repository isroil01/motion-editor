import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip, TooltipProvider } from './Tooltip';

function renderWithProvider(ui: JSX.Element) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// jsdom has no ResizeObserver, and Radix's Popper constructs one when the
// content mounts.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('Tooltip', () => {
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
  });
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('renders the shortcut as keycaps after the label', () => {
    renderWithProvider(
      <Tooltip label="Command palette" shortcut="Ctrl+Shift+P">
        <button type="button">Open</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Open' }));
    act(() => { jest.advanceTimersByTime(500); });
    const tip = screen.getAllByText('Command palette')[0]!;
    expect(tip).toBeInTheDocument();
    expect(screen.getAllByLabelText('Ctrl Shift P')[0]!.tagName).toBe('KBD');
  });

  it('draws no keycaps when there is no shortcut', () => {
    renderWithProvider(
      <Tooltip label="Play">
        <button type="button">Play</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Play' }));
    act(() => { jest.advanceTimersByTime(500); });
    expect(document.querySelector('kbd')).toBeNull();
  });
});
