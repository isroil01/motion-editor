/**
 * VirtualList — renders only the visible window of a large list.
 *
 * <VirtualList
 *   items={items}            // up to ~1M elements
 *   itemHeight={28}          // px; fixed height for fast math
 *   overscan={6}
 *   renderItem={(item, i) => <Row... />}
 * />
 *
 * Two optional extensions, both off by default so `FontPicker`'s fixed-height
 * list is exactly what it was:
 *
 *  • `getItemHeight(item, i)` — per-row heights. A prefix sum is built once
 *    per `items` change and the visible window is found by binary search, so
 *    a list that mixes 26px folder headers with 24px rows (the Effects
 *    browser) or 26px list rows with 96px grid rows (the Assets panel) can
 *    still virtualise. `itemHeight` becomes the fallback for rows the
 *    function does not size.
 *  • `scrollToIndex` — when it CHANGES, the row is brought into view
 *    (nearest edge), which is what keyboard traversal needs: the focused row
 *    must be rendered before it can be focused.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@utils/cn';
import styles from './VirtualList.module.css';

export interface VirtualListProps<T> {
  items: ReadonlyArray<T>;
  itemHeight: number;
  overscan?: number;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  /** Render header content above the list (inside the scroll container). */
  header?: ReactNode;
  /** Render footer content below the list (inside the scroll container). */
  footer?: ReactNode;
  /** Optional fixed total height override (defaults to parent's height). */
  height?: number | string;
  /** Current scrollTop (controlled). */
  scrollTop?: number;
  /** Fires when the user scrolls. */
  onScroll?: (scrollTop: number) => void;
  /** Per-row height; `itemHeight` is the fallback. See the header comment. */
  getItemHeight?: (item: T, index: number) => number;
  /** Bring this index into view whenever the value changes. */
  scrollToIndex?: number;
  /** Stable key per row; defaults to the index. */
  itemKey?: (item: T, index: number) => string | number;
  /** ARIA role for the scroll container (e.g. `tree`, `listbox`). */
  role?: string;
  'aria-label'?: string;
  /** Extra attributes on the scroll container — `data-*`, `tabIndex`, key handlers. */
  containerProps?: React.HTMLAttributes<HTMLDivElement>;
}

/** Row offsets: `offsets[i]` is where row i starts, `offsets[n]` the total. */
function buildOffsets<T>(
  items: ReadonlyArray<T>,
  itemHeight: number,
  getItemHeight: ((item: T, index: number) => number) | undefined,
): Float64Array | null {
  if (!getItemHeight) return null;
  const out = new Float64Array(items.length + 1);
  let y = 0;
  for (let i = 0; i < items.length; i++) {
    out[i] = y;
    const h = getItemHeight(items[i]!, i);
    y += Number.isFinite(h) && h > 0 ? h : itemHeight;
  }
  out[items.length] = y;
  return out;
}

/** The last row whose offset is <= y (binary search). */
function rowAt(offsets: Float64Array, count: number, y: number): number {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function VirtualList<T>({
  items,
  itemHeight,
  overscan = 6,
  renderItem,
  className,
  header,
  footer,
  height = '100%',
  scrollTop,
  onScroll,
  getItemHeight,
  scrollToIndex,
  itemKey,
  role,
  'aria-label': ariaLabel,
  containerProps,
}: VirtualListProps<T>): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [internalScrollTop, setInternalScrollTop] = useState(0);

  const currentScrollTop = scrollTop ?? internalScrollTop;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const offsets = useMemo(() => buildOffsets(items, itemHeight, getItemHeight), [items, itemHeight, getItemHeight]);
  const count = items.length;
  const totalHeight = offsets ? offsets[count]! : count * itemHeight;

  let startIndex: number;
  let endIndex: number;
  if (offsets && count > 0) {
    startIndex = Math.max(0, rowAt(offsets, count, currentScrollTop) - overscan);
    endIndex = Math.min(count, rowAt(offsets, count, currentScrollTop + viewportHeight) + 1 + overscan);
  } else {
    startIndex = Math.max(0, Math.floor(currentScrollTop / itemHeight) - overscan);
    endIndex = Math.min(count, Math.ceil((currentScrollTop + viewportHeight) / itemHeight) + overscan);
  }

  const visible = items.slice(startIndex, endIndex);
  const windowTop = offsets ? offsets[startIndex] ?? 0 : startIndex * itemHeight;

  // Bring `scrollToIndex` into view when it changes. Nearest edge, so arrowing
  // down one row scrolls one row, not a whole page.
  useEffect(() => {
    const el = ref.current;
    if (!el || scrollToIndex === undefined || scrollToIndex < 0 || scrollToIndex >= count) return;
    const top = offsets ? offsets[scrollToIndex]! : scrollToIndex * itemHeight;
    const h = offsets ? offsets[scrollToIndex + 1]! - top : itemHeight;
    const view = el.clientHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + h > el.scrollTop + view) el.scrollTop = top + h - view;
    // A programmatic scroll fires no React onScroll in every environment;
    // mirror it so the window recomputes even where it does not.
    if (scrollTop === undefined) setInternalScrollTop(el.scrollTop);
    // Only when the index CHANGES — not when the list re-renders around it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToIndex]);

  const onScrollHandler = (e: React.UIEvent<HTMLDivElement>): void => {
    const top = e.currentTarget.scrollTop;
    if (scrollTop === undefined) setInternalScrollTop(top);
    onScroll?.(top);
    containerProps?.onScroll?.(e);
  };

  return (
    <div
      {...containerProps}
      ref={ref}
      role={role ?? containerProps?.role}
      aria-label={ariaLabel ?? containerProps?.['aria-label']}
      className={cn(styles.root, className, containerProps?.className)}
      style={{ height, ...containerProps?.style }}
      onScroll={onScrollHandler}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {header ? <div className={styles.header}>{header}</div> : null}
        <div
          className={styles.window}
          style={{ transform: `translateY(${windowTop}px)` }}
        >
          {visible.map((item, i) => {
            const index = startIndex + i;
            const h = offsets ? offsets[index + 1]! - offsets[index]! : itemHeight;
            return (
              <div
                key={itemKey ? itemKey(item, index) : index}
                className={styles.row}
                style={{ height: h }}
                data-index={index}
              >
                {renderItem(item, index)}
              </div>
            );
          })}
        </div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>
  );
}
