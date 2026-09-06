import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Segmented } from './Segmented';

const OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'default', label: 'Default' },
  { value: 'comfortable', label: 'Comfortable' },
] as const;

type Density = (typeof OPTIONS)[number]['value'];

function Harness({ onChange, disabledValue }: { onChange?: (v: Density) => void; disabledValue?: Density }) {
  const [value, setValue] = useState<Density>('default');
  return (
    <Segmented
      aria-label="Density"
      value={value}
      onChange={(v) => { setValue(v); onChange?.(v); }}
      options={OPTIONS.map((o) => ({ ...o, disabled: o.value === disabledValue }))}
    />
  );
}

describe('Segmented', () => {
  it('is a radiogroup with exactly one checked radio', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Density' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');
  });

  it('is one tab stop: only the checked radio is tabbable', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'Default' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('tabindex', '-1');
  });

  it('selects on click', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Comfortable' }));
    expect(onChange).toHaveBeenCalledWith('comfortable');
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves selection with Left / Right, wrapping, and focuses the new radio', () => {
    render(<Harness />);
    const def = screen.getByRole('radio', { name: 'Default' });
    def.focus();
    fireEvent.keyDown(def, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Comfortable' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'true');
  });

  it('skips disabled options when moving', () => {
    render(<Harness disabledValue="comfortable" />);
    const def = screen.getByRole('radio', { name: 'Default' });
    fireEvent.keyDown(def, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Home / End jump to the ends', () => {
    render(<Harness />);
    const def = screen.getByRole('radio', { name: 'Default' });
    fireEvent.keyDown(def, { key: 'End' });
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');
  });
});
