/**
 * DataGrid — a lightweight, virtualised table: sortable columns, row
 * selection, keyboard navigation. Deliberately small; it is the grid for the
 * asset list, the render queue, the shortcut editor — not a spreadsheet.
 *
 *   <DataGrid
 *     aria-label="Assets"
 *     columns={[
 *       { key: 'name', header: 'Name', sortable: true },
 *       { key: 'size', header: 'Size', width: 90, align: 'end', sortable: true,
 *         render: (r) => formatBytes(r.size) },
 *     ]}
 *     rows={assets}
 *     rowKey={(r) => r.id}
 *     selection="multiple"
 *     selectedKeys={selected}
 *     onSelectionChange={setSelected}
 *     onRowActivate={(r) => open(r)}
 *   />
 *
 * ARIA: `role="grid"`, a header `row` of `columnheader`s carrying `aria-sort`,
 * body `row`s with `aria-selected` and `gridcell`s. The grid is ONE tab stop;
 * ↑/↓ move the focused row (the whole row, not a cell — every consumer here
 * acts on rows), Home/End jump, Space toggles selection, Shift+↑/↓ extends a
 * multiple selection, Enter activates. Rows are rendered through
 * <VirtualList>, so a 10,000-row grid costs what its viewport costs.
 *
 * Sorting is uncontrolled by default (click a sortable header: asc → desc →
 * off) and controlled via `sort` / `onSortChange`. The default comparator
 * handles numbers, strings (locale, numeric-aware) and null-last; pass
 * `compare` on a column for anything else.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@utils/cn';
import { Icon } from '@components/Icon';
import { VirtualList } from '@components/VirtualList';
import styles from './DataGrid.module.css';

export type SortDirection = 'asc' | 'desc';

export interface DataGridSort {
  key: string;
  direction: SortDirection;
}

export interface DataGridColumn<T> {
  key: string;
  header: ReactNode;
  /** px, or a CSS track size ('1fr', 'minmax(80px, 1fr)'). Defaults to 1fr. */
  width?: number | string;
  align?: 'start' | 'center' | 'end';
  sortable?: boolean;
  /** Cell content. Defaults to `String(row[key])`. */
  render?: (row: T, index: number) => ReactNode;
  /** Value to sort by. Defaults to `row[key]`. */
  sortValue?: (row: T) => unknown;
  /** Full custom comparator for this column (ascending). */
  compare?: (a: T, b: T) => number;
}

export type SelectionMode = 'none' | 'single' | 'multiple';

export interface DataGridProps<T> {
  columns: ReadonlyArray<DataGridColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  'aria-label': string;
  /** px. Default 26 (`--control-height-row`). */
  rowHeight?: number;
  height?: number | string;
  selection?: SelectionMode;
  selectedKeys?: ReadonlySet<string> | ReadonlyArray<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  /** Enter or double-click on a row. */
  onRowActivate?: (row: T) => void;
  sort?: DataGridSort | null;
  defaultSort?: DataGridSort | null;
  onSortChange?: (sort: DataGridSort | null) => void;
  emptyText?: ReactNode;
  className?: string;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** Ascending comparator for two NON-empty values; empties are handled by the caller. */
function defaultCompare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function trackSize(width: number | string | undefined): string {
  if (width === undefined) return 'minmax(0, 1fr)';
  return typeof width === 'number' ? `${width}px` : width;
}

export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  'aria-label': ariaLabel,
  rowHeight = 26,
  height = '100%',
  selection = 'none',
  selectedKeys,
  onSelectionChange,
  onRowActivate,
  sort: sortProp,
  defaultSort = null,
  onSortChange,
  emptyText = 'Nothing to show',
  className,
}: DataGridProps<T>): JSX.Element {
  const [internalSort, setInternalSort] = useState<DataGridSort | null>(defaultSort);
  const sort = sortProp !== undefined ? sortProp : internalSort;
  const setSort = (next: DataGridSort | null): void => {
    if (sortProp === undefined) setInternalSort(next);
    onSortChange?.(next);
  };

  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const selected = useMemo<ReadonlySet<string>>(() => {
    if (selectedKeys === undefined) return internalSelected;
    return selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys);
  }, [selectedKeys, internalSelected]);
  const setSelected = (next: Set<string>): void => {
    if (selectedKeys === undefined) setInternalSelected(next);
    onSelectionChange?.(next);
  };

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.direction === 'asc' ? 1 : -1;
    const value = col.sortValue ?? ((r: T) => (r as Record<string, unknown>)[col.key]);
    const cmp: (a: T, b: T) => number = col.compare
      ? (a, b) => col.compare!(a, b) * dir
      : (a, b) => {
          // Empty cells sink to the bottom in BOTH directions — flipping the
          // sign would float every blank to the top of a descending sort.
          const va = value(a);
          const vb = value(b);
          const aNull = isEmpty(va);
          const bNull = isEmpty(vb);
          if (aNull || bNull) return aNull && bNull ? 0 : aNull ? 1 : -1;
          return defaultCompare(va, vb) * dir;
        };
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => cmp(a.r, b.r) || a.i - b.i)
      .map(({ r }) => r);
  }, [rows, sort, columns]);

  const [focusIndex, setFocusIndex] = useState(0);
  const anchor = useRef(0);
  useEffect(() => {
    if (focusIndex >= sorted.length) setFocusIndex(Math.max(0, sorted.length - 1));
  }, [sorted.length, focusIndex]);

  const [scrollTop, setScrollTop] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /** Keep `index` inside the viewport. */
  const reveal = useCallback((index: number): void => {
    const viewport = bodyRef.current?.clientHeight ?? 0;
    if (viewport === 0) return;
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    setScrollTop((st) => {
      if (top < st) return top;
      if (bottom > st + viewport) return bottom - viewport;
      return st;
    });
  }, [rowHeight]);

  const select = (index: number, opts: { toggle?: boolean; extend?: boolean } = {}): void => {
    if (selection === 'none') return;
    const row = sorted[index];
    if (row === undefined) return;
    const key = rowKey(row);
    if (selection === 'single') {
      setSelected(opts.toggle && selected.has(key) ? new Set() : new Set([key]));
      anchor.current = index;
      return;
    }
    if (opts.extend) {
      const [lo, hi] = anchor.current <= index ? [anchor.current, index] : [index, anchor.current];
      const next = new Set<string>();
      for (let i = lo; i <= hi; i++) next.add(rowKey(sorted[i]!));
      setSelected(next);
      return;
    }
    if (opts.toggle) {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key); else next.add(key);
      setSelected(next);
    } else {
      setSelected(new Set([key]));
    }
    anchor.current = index;
  };

  const moveFocus = (index: number, e?: KeyboardEvent): void => {
    const clamped = Math.max(0, Math.min(sorted.length - 1, index));
    setFocusIndex(clamped);
    reveal(clamped);
    if (e?.shiftKey && selection === 'multiple') select(clamped, { extend: true });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (sorted.length === 0) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveFocus(focusIndex + 1, e); break;
      case 'ArrowUp': e.preventDefault(); moveFocus(focusIndex - 1, e); break;
      case 'PageDown': e.preventDefault(); moveFocus(focusIndex + 10, e); break;
      case 'PageUp': e.preventDefault(); moveFocus(focusIndex - 10, e); break;
      case 'Home': e.preventDefault(); moveFocus(0, e); break;
      case 'End': e.preventDefault(); moveFocus(sorted.length - 1, e); break;
      case ' ': e.preventDefault(); select(focusIndex, { toggle: true }); break;
      case 'Enter': {
        e.preventDefault();
        const row = sorted[focusIndex];
        if (row !== undefined) onRowActivate?.(row);
        break;
      }
      case 'a':
      case 'A':
        if ((e.ctrlKey || e.metaKey) && selection === 'multiple') {
          e.preventDefault();
          setSelected(new Set(sorted.map(rowKey)));
        }
        break;
      default: break;
    }
  };

  const onHeaderClick = (col: DataGridColumn<T>): void => {
    if (!col.sortable) return;
    if (!sort || sort.key !== col.key) setSort({ key: col.key, direction: 'asc' });
    else if (sort.direction === 'asc') setSort({ key: col.key, direction: 'desc' });
    else setSort(null);
  };

  const template = columns.map((c) => trackSize(c.width)).join(' ');
  const focusedKey = sorted[focusIndex] !== undefined ? rowKey(sorted[focusIndex]!) : undefined;

  return (
    <div
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={sorted.length + 1}
      aria-colcount={columns.length}
      aria-multiselectable={selection === 'multiple' || undefined}
      aria-activedescendant={focusedKey !== undefined ? `${ariaLabel}-row-${focusedKey}` : undefined}
      tabIndex={0}
      className={cn(styles.root, className)}
      style={{ height, ['--grid-template' as string]: template }}
      onKeyDown={onKeyDown}
    >
      <div role="row" aria-rowindex={1} className={styles.headerRow}>
        {columns.map((col, i) => {
          const active = sort?.key === col.key;
          const ariaSort = !col.sortable ? undefined : active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none';
          return (
            <div
              key={col.key}
              role="columnheader"
              aria-colindex={i + 1}
              aria-sort={ariaSort}
              className={cn(styles.headerCell, col.sortable && styles.sortable)}
              data-align={col.align ?? 'start'}
              onClick={() => onHeaderClick(col)}
            >
              <span className={styles.headerLabel}>{col.header}</span>
              {col.sortable ? (
                <span className={styles.sortIcon} data-active={active || undefined} aria-hidden>
                  <Icon name={active && sort!.direction === 'desc' ? 'chevron-down' : 'chevron-up'} size="sm" />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div ref={bodyRef} className={styles.body}>
        {sorted.length === 0 ? (
          <div className={styles.empty} role="row" aria-rowindex={2}>
            <div role="gridcell" aria-colindex={1}>{emptyText}</div>
          </div>
        ) : (
          <VirtualList
            items={sorted}
            itemHeight={rowHeight}
            scrollTop={scrollTop}
            onScroll={setScrollTop}
            renderItem={(row, index) => {
              const key = rowKey(row);
              const isSelected = selected.has(key);
              return (
                <div
                  id={`${ariaLabel}-row-${key}`}
                  role="row"
                  aria-rowindex={index + 2}
                  aria-selected={selection === 'none' ? undefined : isSelected}
                  className={styles.row}
                  data-selected={isSelected || undefined}
                  data-focused={index === focusIndex || undefined}
                  onClick={(e) => {
                    setFocusIndex(index);
                    if (e.shiftKey && selection === 'multiple') select(index, { extend: true });
                    else if ((e.ctrlKey || e.metaKey) && selection !== 'none') select(index, { toggle: true });
                    else select(index);
                  }}
                  onDoubleClick={() => onRowActivate?.(row)}
                >
                  {columns.map((col, ci) => (
                    <div
                      key={col.key}
                      role="gridcell"
                      aria-colindex={ci + 1}
                      className={styles.cell}
                      data-align={col.align ?? 'start'}
                    >
                      {col.render ? col.render(row, index) : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </div>
                  ))}
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
