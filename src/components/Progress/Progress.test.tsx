import { render, screen } from '@testing-library/react';
import { Progress } from './Progress';

describe('Progress', () => {
  it('is a progressbar reporting the value in percent', () => {
    render(<Progress value={0.42} aria-label="Rendering" />);
    const bar = screen.getByRole('progressbar', { name: 'Rendering' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps out-of-range values', () => {
    const { rerender } = render(<Progress value={1.7} aria-label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<Progress value={-3} aria-label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    rerender(<Progress value={Number.NaN} aria-label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('drops aria-valuenow and sets aria-busy when indeterminate', () => {
    render(<Progress indeterminate aria-label="Connecting" />);
    const bar = screen.getByRole('progressbar', { name: 'Connecting' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-busy', 'true');
  });

  it('uses the visible label as the accessible name and can show the value', () => {
    render(<Progress value={0.5} label="Uploading" showValue />);
    expect(screen.getByRole('progressbar', { name: 'Uploading' })).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('exposes size and variant on the root', () => {
    const { container } = render(<Progress value={1} size="sm" variant="success" aria-label="x" />);
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute('data-size', 'sm');
    expect(root).toHaveAttribute('data-variant', 'success');
  });
});
