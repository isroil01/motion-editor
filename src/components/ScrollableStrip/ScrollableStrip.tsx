/**
 * ScrollableStrip — horizontal scroll container with intuitive swipe/scroll
 * buttons and edge fading when content overflows.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type UIEvent,
} from 'react';
import { Icon } from '@components/Icon';
import { cn } from '@utils/cn';
import styles from './ScrollableStrip.module.css';

export interface ScrollableStripProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Custom wrapper CSS class. */
  className?: string;
  /** Custom scroll container CSS class. */
  scrollClassName?: string;
  /** Semantic ARIA role for the scrollable container (e.g. "tablist"). */
  role?: string;
  /** Accessible label for the scroll container when it has a role. */
  ariaLabel?: string;
  /** Fixed step distance in px. If omitted, uses 65% of visible clientWidth. */
  scrollStep?: number;
  /** Inline styles for the outer wrapper (e.g. `--strip-bg`). */
  style?: CSSProperties;
  /** Automatically scroll active item (`[aria-selected="true"]`) into view. Default true. */
  autoScrollSelected?: boolean;
}

export const ScrollableStrip = forwardRef<HTMLDivElement, ScrollableStripProps>(function ScrollableStrip(
  {
    children,
    className,
    scrollClassName,
    role,
    ariaLabel,
    scrollStep,
    style,
    autoScrollSelected = true,
    ...rest
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => containerRef.current as HTMLDivElement);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    // Subpixel margin of 2px
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      updateScrollState();
      rest.onScroll?.(e);
    },
    [updateScrollState, rest],
  );

  const scrollByDelta = useCallback(
    (direction: -1 | 1) => {
      const el = containerRef.current;
      if (!el) return;
      const step = scrollStep ?? Math.max(120, Math.round(el.clientWidth * 0.65));
      el.scrollBy({ left: direction * step, behavior: 'smooth' });
    },
    [scrollStep],
  );

  const scrollLeft = useCallback(() => {
    scrollByDelta(-1);
  }, [scrollByDelta]);

  const scrollRight = useCallback(() => {
    scrollByDelta(1);
  }, [scrollByDelta]);

  // Keep scroll overflow indicators up to date with DOM changes & resizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    updateScrollState();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateScrollState();
      });
      resizeObserver.observe(el);
    }

    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        updateScrollState();
      });
      mutationObserver.observe(el, { childList: true, subtree: true });
    }

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [updateScrollState, children]);

  // Smoothly scroll active tab into view if outside container bounds
  useEffect(() => {
    if (!autoScrollSelected) return;
    const el = containerRef.current;
    if (!el) return;

    const activeEl = el.querySelector<HTMLElement>(
      '[aria-selected="true"], [data-selected="true"], [data-active="true"]',
    );
    if (!activeEl) return;

    const elRect = el.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();

    if (activeRect.left < elRect.left || activeRect.right > elRect.right) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [children, autoScrollSelected]);

  return (
    <div className={cn(styles.wrapper, className)} style={style}>
      <div
        className={cn(
          styles.swipeOverlayLeft,
          canScrollLeft && styles.swipeOverlayVisible,
        )}
        aria-hidden={!canScrollLeft}
      >
        <button
          type="button"
          className={styles.swipeBtn}
          onClick={scrollLeft}
          title="Scroll left"
          aria-label="Scroll left"
          tabIndex={canScrollLeft ? 0 : -1}
        >
          <Icon name="chevron-left" size="sm" />
        </button>
      </div>

      <div
        ref={containerRef}
        className={cn(styles.scrollArea, scrollClassName)}
        role={role}
        aria-label={ariaLabel}
        onScroll={handleScroll}
        {...rest}
      >
        {children}
      </div>

      <div
        className={cn(
          styles.swipeOverlayRight,
          canScrollRight && styles.swipeOverlayVisible,
        )}
        aria-hidden={!canScrollRight}
      >
        <button
          type="button"
          className={styles.swipeBtn}
          onClick={scrollRight}
          title="Scroll right"
          aria-label="Scroll right"
          tabIndex={canScrollRight ? 0 : -1}
        >
          <Icon name="chevron-right" size="sm" />
        </button>
      </div>
    </div>
  );
});
