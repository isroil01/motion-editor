import { render, screen, fireEvent, act } from '@testing-library/react';
import { Toolbar, ToolbarSeparator, ToolbarGroup } from './Toolbar';

function renderBar(extra?: React.ReactNode) {
  return render(
    <Toolbar aria-label="Transport" overflow={<button type="button">More</button>}>
      <button type="button">Play</button>
      <ToolbarSeparator />
      <ToolbarGroup>
        <button type="button">Stop</button>
        <button type="button" disabled>Record</button>
      </ToolbarGroup>
      {extra}
    </Toolbar>,
  );
}

describe('Toolbar', () => {
  it('is a named toolbar with exactly one tab stop', () => {
    renderBar();
    expect(screen.getByRole('toolbar', { name: 'Transport' })).toBeInTheDocument();
    const tabbable = screen.getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(tabbable.map((b) => b.textContent)).toEqual(['Play']);
    expect(screen.getByRole('button', { name: 'Stop' }).tabIndex).toBe(-1);
  });

  it('moves with Right / Left, skipping disabled tools and reaching the overflow slot', () => {
    renderBar();
    const play = screen.getByRole('button', { name: 'Play' });
    play.focus();
    fireEvent.keyDown(play, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(play);
    fireEvent.keyDown(play, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }));
  });

  it('Home / End jump to the ends and the tab stop follows focus', () => {
    renderBar();
    const play = screen.getByRole('button', { name: 'Play' });
    play.focus();
    fireEvent.keyDown(play, { key: 'End' });
    const more = screen.getByRole('button', { name: 'More' });
    expect(document.activeElement).toBe(more);
    expect(more.tabIndex).toBe(0);
    expect(play.tabIndex).toBe(-1);
    fireEvent.keyDown(more, { key: 'Home' });
    expect(document.activeElement).toBe(play);
  });

  it('renders separators with the separator role', () => {
    renderBar();
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('re-discovers tools when the children change', async () => {
    const { rerender } = renderBar();
    rerender(
      <Toolbar aria-label="Transport">
        <button type="button">Only</button>
      </Toolbar>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Only' }).tabIndex).toBe(0);
  });
});
