import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders its label with the variant and size on the root', () => {
    render(<Badge variant="success" size="sm">Cached</Badge>);
    const el = screen.getByText('Cached');
    expect(el).toHaveAttribute('data-variant', 'success');
    expect(el).toHaveAttribute('data-size', 'sm');
  });

  it('defaults to neutral / md', () => {
    render(<Badge>12</Badge>);
    const el = screen.getByText('12');
    expect(el).toHaveAttribute('data-variant', 'neutral');
    expect(el).toHaveAttribute('data-size', 'md');
  });

  it('draws a decorative dot only when asked', () => {
    const { rerender } = render(<Badge>Plain</Badge>);
    expect(screen.getByText('Plain').querySelector('[aria-hidden]')).toBeNull();
    rerender(<Badge dot>Dotted</Badge>);
    expect(screen.getByText('Dotted').querySelector('[aria-hidden]')).not.toBeNull();
  });

  it('passes through native attributes', () => {
    render(<Badge title="Frames in cache" data-testid="b">40</Badge>);
    expect(screen.getByTestId('b')).toHaveAttribute('title', 'Frames in cache');
  });
});
