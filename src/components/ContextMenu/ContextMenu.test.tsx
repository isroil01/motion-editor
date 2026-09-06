import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu } from './ContextMenu';

const ITEMS = [
  { id: 'rename', label: 'Rename', shortcut: 'F2' },
  { id: 'sep', separator: true },
  { id: 'arrange', label: 'Arrange', children: [{ id: 'front', label: 'Bring to Front' }] },
  { id: 'delete', label: 'Delete', danger: true },
];

describe('ContextMenu', () => {
  it('renders a menu with every item, shortcut column and submenu trigger', () => {
    render(<ContextMenu open x={10} y={10} items={ITEMS} onClose={() => {}} ariaLabel="Layer" />);
    expect(screen.getByRole('menu', { name: 'Layer' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Rename/ })).toHaveTextContent('F2');
    expect(screen.getByRole('menuitem', { name: /Arrange/ })).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('opts out of the 280px scroller for long lists', () => {
    const { container } = render(<ContextMenu open x={0} y={0} items={ITEMS} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement(); // portalled
    // CSS-module classes are stubbed in jest, so read the data attributes the
    // Menu mirrors its flags onto.
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('data-no-scroll', 'true');
    expect(menu).toHaveAttribute('data-spacious', 'true');
  });

  it('moves focus into the menu on open and restores it on close', () => {
    const before = document.createElement('button');
    before.textContent = 'Layer row';
    document.body.appendChild(before);
    before.focus();
    expect(document.activeElement).toBe(before);

    const { rerender } = render(<ContextMenu open x={0} y={0} items={ITEMS} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Rename/ }));

    rerender(<ContextMenu open={false} x={0} y={0} items={ITEMS} onClose={() => {}} />);
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('closes on Escape and on an outside pointerdown, but not inside', () => {
    const onClose = jest.fn();
    render(<ContextMenu open x={0} y={0} items={ITEMS} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: /Rename/ }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes after activating an item', () => {
    const onClose = jest.fn();
    const onSelect = jest.fn();
    render(<ContextMenu open x={0} y={0} items={[{ id: 'a', label: 'Act', onSelect }]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Act' }));
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
