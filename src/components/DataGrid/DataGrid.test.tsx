import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { DataGrid, type DataGridColumn } from './DataGrid';

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
  // jsdom has no layout; give the virtual list a viewport so rows render.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
});

interface Row { id: string; name: string; size: number | null }

const ROWS: Row[] = [
  { id: 'b', name: 'beta.mp4', size: 20 },
  { id: 'a', name: 'alpha.png', size: 5 },
  { id: 'c', name: 'gamma.wav', size: null },
  { id: 'd', name: 'file10.mov', size: 100 },
  { id: 'e', name: 'file2.mov', size: 50 },
];

const COLUMNS: DataGridColumn<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'size', header: 'Size', width: 80, align: 'end', sortable: true },
];

const rowNames = (): string[] =>
  screen.getAllByRole('row').slice(1).map((r) => r.querySelector('[role="gridcell"]')!.textContent!);

function Harness(props: Partial<React.ComponentProps<typeof DataGrid<Row>>> = {}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <DataGrid<Row>
      aria-label="Assets"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.id}
      selection="multiple"
      selectedKeys={selected}
      onSelectionChange={setSelected}
      height={400}
      {...props}
    />
  );
}

describe('DataGrid', () => {
  it('is a grid with column headers and one row per item', () => {
    render(<Harness />);
    const grid = screen.getByRole('grid', { name: 'Assets' });
    expect(grid).toHaveAttribute('aria-rowcount', '6');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Size']);
    expect(rowNames()).toEqual(['beta.mp4', 'alpha.png', 'gamma.wav', 'file10.mov', 'file2.mov']);
  });

  it('sorts asc → desc → off on header click, numeric-aware, nulls last', () => {
    render(<Harness />);
    const name = screen.getByRole('columnheader', { name: 'Name' });
    expect(name).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(name);
    expect(name).toHaveAttribute('aria-sort', 'ascending');
    expect(rowNames()).toEqual(['alpha.png', 'beta.mp4', 'file2.mov', 'file10.mov', 'gamma.wav']);
    fireEvent.click(name);
    expect(name).toHaveAttribute('aria-sort', 'descending');
    expect(rowNames()[0]).toBe('gamma.wav');
    fireEvent.click(name);
    expect(name).toHaveAttribute('aria-sort', 'none');
    expect(rowNames()[0]).toBe('beta.mp4');

    fireEvent.click(screen.getByRole('columnheader', { name: 'Size' }));
    expect(rowNames()).toEqual(['alpha.png', 'beta.mp4', 'file2.mov', 'file10.mov', 'gamma.wav']);
  });

  it('selects on click, toggles with Ctrl, extends with Shift', () => {
    render(<Harness />);
    const rows = () => screen.getAllByRole('row').slice(1);
    fireEvent.click(rows()[0]!);
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(rows()[2]!, { shiftKey: true });
    expect(rows().map((r) => r.getAttribute('aria-selected'))).toEqual(['true', 'true', 'true', 'false', 'false']);
    fireEvent.click(rows()[1]!, { ctrlKey: true });
    expect(rows()[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('is one tab stop and navigates rows with the keyboard', () => {
    const onRowActivate = jest.fn();
    render(<Harness onRowActivate={onRowActivate} />);
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByRole('row')[1]!.hasAttribute('tabindex')).toBe(false);

    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(grid.getAttribute('aria-activedescendant')).toBe('Assets-row-c');
    fireEvent.keyDown(grid, { key: ' ' });
    expect(screen.getAllByRole('row')[3]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });
    expect(screen.getAllByRole('row')[4]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onRowActivate).toHaveBeenCalledWith(ROWS[3]);
    fireEvent.keyDown(grid, { key: 'Home' });
    expect(grid.getAttribute('aria-activedescendant')).toBe('Assets-row-b');
    fireEvent.keyDown(grid, { key: 'End' });
    expect(grid.getAttribute('aria-activedescendant')).toBe('Assets-row-e');
  });

  it('shows the empty text with no rows', () => {
    render(<Harness rows={[]} emptyText="No assets" />);
    expect(screen.getByText('No assets')).toBeInTheDocument();
  });

  it('honours a controlled sort', () => {
    const onSortChange = jest.fn();
    render(<Harness sort={{ key: 'size', direction: 'desc' }} onSortChange={onSortChange} />);
    expect(rowNames()[0]).toBe('file10.mov');
    fireEvent.click(screen.getByRole('columnheader', { name: 'Size' }));
    expect(onSortChange).toHaveBeenCalledWith(null);
    expect(rowNames()[0]).toBe('file10.mov'); // still controlled
  });
});
