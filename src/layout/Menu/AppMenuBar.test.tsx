/**
 * The menu bar is a real ARIA menubar: roving focus, Left/Right between
 * groups (also while a menu is open), Escape closes and returns focus.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppMenuBar } from './AppMenuBar';

const GROUPS = [
  { id: 'file', label: 'File', items: [{ label: 'New Thing', onSelect: jest.fn() }] },
  { id: 'edit', label: 'Edit', items: [{ label: 'Undo Thing', onSelect: jest.fn() }] },
  { id: 'view', label: 'View', items: [{ label: 'Zoom Thing', onSelect: jest.fn() }] },
];

jest.mock('./useAppMenuGroups', () => ({
  ...jest.requireActual('./useAppMenuGroups'),
  useAppMenuGroups: () => GROUPS,
}));

function groupButton(label: string): HTMLButtonElement {
  return screen.getByRole('menuitem', { name: label }) as HTMLButtonElement;
}

describe('AppMenuBar keyboard navigation', () => {
  it('is a menubar with one tabbable group and popup semantics on each', () => {
    render(<AppMenuBar />);
    expect(screen.getByRole('menubar')).toBeTruthy();
    const buttons = ['File', 'Edit', 'View'].map(groupButton);
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    for (const b of buttons) {
      expect(b.getAttribute('aria-haspopup')).toBe('menu');
      expect(b.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('moves focus with Left/Right (wrapping) and Home/End', () => {
    render(<AppMenuBar />);
    const file = groupButton('File');
    act(() => file.focus());
    fireEvent.keyDown(file, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(groupButton('Edit'));
    expect(groupButton('Edit').tabIndex).toBe(0);
    expect(groupButton('File').tabIndex).toBe(-1);
    fireEvent.keyDown(groupButton('Edit'), { key: 'ArrowLeft' });
    fireEvent.keyDown(groupButton('File'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(groupButton('View'));
    fireEvent.keyDown(groupButton('View'), { key: 'Home' });
    expect(document.activeElement).toBe(groupButton('File'));
    fireEvent.keyDown(groupButton('File'), { key: 'End' });
    expect(document.activeElement).toBe(groupButton('View'));
  });

  it('opens with Down, switches the open menu with Right, and closes on Escape with focus restored', () => {
    render(<AppMenuBar />);
    const file = groupButton('File');
    act(() => file.focus());
    fireEvent.keyDown(file, { key: 'ArrowDown' });
    expect(file.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('New Thing')).toBeTruthy();

    // Right while open: Edit's menu replaces File's.
    fireEvent.keyDown(file, { key: 'ArrowRight' });
    expect(groupButton('Edit').getAttribute('aria-expanded')).toBe('true');
    expect(file.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Undo Thing')).toBeTruthy();
    expect(screen.queryByText('New Thing')).toBeNull();

    // Right from INSIDE the open menu (the item has focus) also moves on.
    const item = screen.getByText('Undo Thing').closest('button') as HTMLButtonElement;
    act(() => item.focus());
    fireEvent.keyDown(item, { key: 'ArrowRight' });
    expect(groupButton('View').getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(groupButton('View').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Zoom Thing')).toBeNull();
    expect(document.activeElement).toBe(groupButton('View'));
  });

  it('mirrors Left/Right in a right-to-left layout, in the bar and in an open menu', () => {
    render(<div dir="rtl"><AppMenuBar /></div>);
    const file = groupButton('File');
    act(() => file.focus());
    // The groups run File · Edit · View from the RIGHT, so Right goes "back".
    fireEvent.keyDown(file, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(groupButton('View'));
    fireEvent.keyDown(groupButton('View'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(groupButton('File'));
    fireEvent.keyDown(file, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(groupButton('Edit'));

    // Same mirroring while a menu is open and an item inside it has focus.
    fireEvent.keyDown(groupButton('Edit'), { key: 'ArrowDown' });
    const item = screen.getByText('Undo Thing').closest('button') as HTMLButtonElement;
    act(() => item.focus());
    fireEvent.keyDown(item, { key: 'ArrowLeft' });
    expect(groupButton('View').getAttribute('aria-expanded')).toBe('true');
    expect(groupButton('Edit').getAttribute('aria-expanded')).toBe('false');
  });
});
