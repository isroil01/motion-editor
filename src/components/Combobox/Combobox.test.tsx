import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { Combobox } from './Combobox';

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
  // Radix's popper reads these; jsdom has neither.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const FONTS = [
  { value: 'plex', label: 'IBM Plex Sans' },
  { value: 'inter', label: 'Inter' },
  { value: 'mono', label: 'IBM Plex Mono', description: 'monospace' },
  { value: 'gone', label: 'Missing Font', disabled: true },
];

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<string | null>('inter');
  return (
    <Combobox
      aria-label="Font"
      options={FONTS}
      value={value}
      onChange={(v) => { setValue(v); onChange?.(v); }}
      placeholder="Search fonts…"
    />
  );
}

const input = (): HTMLInputElement => screen.getByRole('combobox', { name: 'Font' }) as HTMLInputElement;

describe('Combobox', () => {
  it('shows the selected label in the field and is closed at rest', () => {
    render(<Harness />);
    expect(input().value).toBe('Inter');
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens on ArrowDown with the current value highlighted, wired via aria-activedescendant', () => {
    render(<Harness />);
    act(() => { fireEvent.keyDown(input(), { key: 'ArrowDown' }); });
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('listbox');
    expect(input()).toHaveAttribute('aria-controls', list.id);
    const active = document.getElementById(input().getAttribute('aria-activedescendant')!)!;
    expect(active).toHaveTextContent('Inter');
    expect(active).toHaveAttribute('aria-selected', 'true');
  });

  it('filters as you type and picks with Enter', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    act(() => { fireEvent.change(input(), { target: { value: 'mono' } }); });
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['IBM Plex Monomonospace']);
    act(() => { fireEvent.keyDown(input(), { key: 'Enter' }); });
    expect(onChange).toHaveBeenCalledWith('mono');
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input().value).toBe('IBM Plex Mono');
  });

  it('skips disabled options with the arrows and wraps', () => {
    render(<Harness />);
    act(() => { fireEvent.keyDown(input(), { key: 'ArrowDown' }); }); // open on Inter (index 1)
    act(() => { fireEvent.keyDown(input(), { key: 'ArrowDown' }); }); // → mono (2)
    act(() => { fireEvent.keyDown(input(), { key: 'ArrowDown' }); }); // skips Missing (3) → plex (0)
    const active = document.getElementById(input().getAttribute('aria-activedescendant')!)!;
    expect(active).toHaveTextContent('IBM Plex Sans');
  });

  it('Escape closes and restores the field', () => {
    render(<Harness />);
    act(() => { fireEvent.change(input(), { target: { value: 'zzz' } }); });
    expect(screen.getByText('No matches')).toBeInTheDocument();
    act(() => { fireEvent.keyDown(input(), { key: 'Escape' }); });
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input().value).toBe('Inter');
  });

  it('picks with the mouse', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    act(() => { fireEvent.click(input()); });
    act(() => { fireEvent.click(screen.getByRole('option', { name: 'IBM Plex Sans' })); });
    expect(onChange).toHaveBeenCalledWith('plex');
  });
});
