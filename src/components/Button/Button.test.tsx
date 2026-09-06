import { render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('exposes variant and size as data attributes', () => {
    render(<Button variant="danger" size="xs">Delete</Button>);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toHaveAttribute('data-variant', 'danger');
    expect(btn).toHaveAttribute('data-size', 'xs');
  });

  it('covers every variant the layouts use', () => {
    for (const v of ['primary', 'secondary', 'ghost', 'tertiary', 'danger'] as const) {
      const { unmount } = render(<Button variant={v}>{v}</Button>);
      expect(screen.getByRole('button', { name: v })).toHaveAttribute('data-variant', v);
      unmount();
    }
  });

  it('keeps the label in the accessible name while loading and marks itself busy', () => {
    render(<Button loading>Export</Button>);
    const btn = screen.getByRole('button', { name: 'Export' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
  });

  it('renders `icon` as the leading slot', () => {
    render(<Button icon={<svg data-testid="glyph" />}>Add</Button>);
    const btn = screen.getByRole('button', { name: 'Add' });
    expect(btn.firstElementChild).toContainElement(screen.getByTestId('glyph'));
  });

  it('iconOnly hides the label visually but keeps it as the name', () => {
    render(<Button iconOnly icon={<svg data-testid="glyph" />}>Close</Button>);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn).toHaveAttribute('data-icon-only', 'true');
    expect(screen.getByText('Close')).toBeInTheDocument();
  });
});
