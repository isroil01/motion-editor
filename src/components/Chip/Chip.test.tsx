import { render, screen, fireEvent } from '@testing-library/react';
import { Chip } from './Chip';

describe('Chip', () => {
  it('is a toggle button when selectable', () => {
    const onSelect = jest.fn();
    render(<Chip selected onSelect={onSelect}>Video</Chip>);
    const btn = screen.getByRole('button', { name: 'Video' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('is a plain label when not selectable', () => {
    render(<Chip>Static</Chip>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Static')).toBeInTheDocument();
  });

  it('renders a named remove button that does not trigger select', () => {
    const onSelect = jest.fn();
    const onRemove = jest.fn();
    render(<Chip onSelect={onSelect} onRemove={onRemove}>tag</Chip>);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('removes on Backspace / Delete from the keyboard', () => {
    const onRemove = jest.fn();
    render(<Chip onSelect={() => {}} onRemove={onRemove}>tag</Chip>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'tag' }), { key: 'Backspace' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'tag' }), { key: 'Delete' });
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('disables both buttons together', () => {
    render(<Chip disabled onSelect={() => {}} onRemove={() => {}}>tag</Chip>);
    expect(screen.getByRole('button', { name: 'tag' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove tag' })).toBeDisabled();
  });
});
