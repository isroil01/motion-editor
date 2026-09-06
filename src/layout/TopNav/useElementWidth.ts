/**
 * The rendered width of an element, live.
 *
 * `TopNav` used to collapse tool groups on `window.innerWidth`. The bar is
 * not the window: a popped-out timeline, a split screen, or simply the
 * browser's own chrome all change what the bar can afford without changing
 * the window. So the bar measures ITSELF with a ResizeObserver, and the
 * collapse thresholds (`toolbarCollapse.ts`) are applied to that.
 *
 * Falls back to `window.innerWidth` + resize events where ResizeObserver is
 * absent (jsdom without a polyfill, very old engines), so the hook never
 * returns 0 for a bar that is clearly on screen.
 */

import { useEffect, useState, type RefObject } from 'react';

export function useElementWidth(ref: RefObject<HTMLElement>, fallback = 1000): number {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return fallback;
    return window.innerWidth || fallback;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      const onResize = (): void => setWidth(el.getBoundingClientRect().width || window.innerWidth || fallback);
      onResize();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const w = entry?.contentRect.width ?? el.getBoundingClientRect().width;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    const initial = el.getBoundingClientRect().width;
    if (initial > 0) setWidth(initial);
    return () => ro.disconnect();
  }, [ref, fallback]);

  return width;
}
