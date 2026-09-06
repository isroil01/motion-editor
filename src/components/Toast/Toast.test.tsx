import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@components/Tooltip';
import { Toast } from './Toast';

// The dismiss button is an <IconButton>, which wraps itself in a Tooltip; in
// the app the provider sits at the root (main.tsx), so mirror that here.
const render = (ui: JSX.Element) => rtlRender(ui, { wrapper: TooltipProvider });

describe('Toast', () => {
  it('is a polite status by default and an alert for errors', () => {
    const { rerender } = render(<Toast level="info" message="Saved" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    rerender(<Toast level="error" message="Failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  });

  it('draws a determinate progress bar from a 0–1 value', () => {
    render(<Toast level="info" message="Rendering" progress={0.25} sticky />);
    const bar = screen.getByRole('progressbar', { name: 'Rendering' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByRole('status')).toHaveAttribute('data-sticky', 'true');
  });

  it('draws an indeterminate sweep', () => {
    render(<Toast level="info" message="Connecting" progress="indeterminate" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('has no progress bar for a plain notice', () => {
    render(<Toast level="success" message="Done" />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('dismisses before running the action, then dismisses on the X', () => {
    const order: string[] = [];
    render(
      <Toast
        level="warning"
        message="Update ready"
        action={{ label: 'Restart', onSelect: () => order.push('action') }}
        onDismiss={() => order.push('dismiss')}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(order).toEqual(['dismiss', 'action']);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(order).toEqual(['dismiss', 'action', 'dismiss']);
  });

  it('hides the dismiss button when there is no handler, and shows detail', () => {
    render(<Toast level="error" message="Export failed" detail="ENOSPC: disk full" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.getByText('ENOSPC: disk full')).toBeInTheDocument();
  });
});
