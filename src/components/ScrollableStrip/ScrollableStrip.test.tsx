import { render, screen, fireEvent, act } from '@testing-library/react';
import { ScrollableStrip } from './ScrollableStrip';

describe('ScrollableStrip', () => {
  it('renders children with semantic role and accessible label', () => {
    render(
      <ScrollableStrip role="tablist" ariaLabel="Test tabs">
        <button type="button" role="tab" aria-selected="true">Tab 1</button>
        <button type="button" role="tab" aria-selected="false">Tab 2</button>
      </ScrollableStrip>,
    );

    const tablist = screen.getByRole('tablist', { name: 'Test tabs' });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tab 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tab 2' })).toBeInTheDocument();
  });

  it('updates swipe buttons when overflowing and handles smooth scrolling', () => {
    render(
      <ScrollableStrip role="tablist" ariaLabel="Test tabs">
        <button type="button" role="tab" style={{ width: 100 }}>Tab 1</button>
        <button type="button" role="tab" style={{ width: 100 }}>Tab 2</button>
        <button type="button" role="tab" style={{ width: 100 }}>Tab 3</button>
      </ScrollableStrip>,
    );

    const scrollContainer = screen.getByRole('tablist');
    const scrollByMock = jest.fn();
    scrollContainer.scrollBy = scrollByMock;

    // Simulate overflow: clientWidth = 150, scrollWidth = 300, scrollLeft = 0
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 150, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollLeft', { value: 0, writable: true, configurable: true });

    // Trigger scroll event to update scroll state
    act(() => {
      fireEvent.scroll(scrollContainer);
    });

    const rightBtn = screen.getByRole('button', { name: 'Scroll right' });
    expect(rightBtn).toBeInTheDocument();

    // Click right swipe button
    fireEvent.click(rightBtn);
    expect(scrollByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        left: expect.any(Number),
        behavior: 'smooth',
      }),
    );
    expect(scrollByMock.mock.calls[0][0].left).toBeGreaterThan(0);

    // Simulate scrolled right: scrollLeft = 100
    scrollContainer.scrollLeft = 100;
    act(() => {
      fireEvent.scroll(scrollContainer);
    });

    const leftBtn = screen.getByRole('button', { name: 'Scroll left' });
    expect(leftBtn).toBeInTheDocument();

    // Click left swipe button
    fireEvent.click(leftBtn);
    expect(scrollByMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        left: expect.any(Number),
        behavior: 'smooth',
      }),
    );
    expect(scrollByMock.mock.calls[1][0].left).toBeLessThan(0);
  });
});
