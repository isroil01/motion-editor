/**
 * The `custom` row.
 *
 * Menus are lists of commands, and every other item type here is a command
 * with a label. The Overlays menu above the stage needs one row that is not:
 * the overlay-opacity slider. This pins that a `custom` item renders its node
 * inside the open menu, sits OUTSIDE the menu's item roles (so a screen reader
 * counts commands, not chrome), and does not close the menu when interacted
 * with the way a command would.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { Dropdown } from './Dropdown';

function open(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
}

it('renders a custom row inside the open menu', () => {
  render(
    <Dropdown
      trigger={<button type="button">Open</button>}
      items={[
        { type: 'item', id: 'a', label: 'A command', onSelect: () => {} },
        { type: 'custom', id: 'slider', render: <input type="range" aria-label="Overlay opacity" /> },
      ]}
    />,
  );
  expect(screen.queryByLabelText('Overlay opacity')).toBeNull();
  open();
  expect(screen.getByLabelText('Overlay opacity')).toBeInTheDocument();
  // The row is chrome, not a command: it carries no menuitem role of its own.
  expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  expect(screen.getByLabelText('Overlay opacity').closest('[data-menu-custom]')).not.toBeNull();
});

it('leaves the menu open while the custom row is used', () => {
  const onChange = jest.fn();
  render(
    <Dropdown
      trigger={<button type="button">Open</button>}
      items={[
        { type: 'custom', id: 'slider', render: <input type="range" aria-label="Overlay opacity" onChange={(e) => onChange(e.target.value)} /> },
      ]}
    />,
  );
  open();
  fireEvent.change(screen.getByLabelText('Overlay opacity'), { target: { value: '40' } });
  expect(onChange).toHaveBeenCalledWith('40');
  expect(screen.getByLabelText('Overlay opacity')).toBeInTheDocument();
});

it('renders a custom row inside a submenu too', () => {
  render(
    <Dropdown
      trigger={<button type="button">Open</button>}
      items={[
        {
          type: 'item',
          id: 'more',
          label: 'More',
          submenu: [{ type: 'custom', id: 'sub-slider', render: <input type="range" aria-label="Sub slider" /> }],
        },
      ]}
    />,
  );
  open();
  fireEvent.click(screen.getByRole('menuitem', { name: 'More' }));
  expect(screen.getByLabelText('Sub slider')).toBeInTheDocument();
});
