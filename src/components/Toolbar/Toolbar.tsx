/**
 * Toolbar — a horizontal (or vertical) group of controls that is ONE tab stop.
 *
 *   <Toolbar aria-label="Transport" overflow={<Dropdown … />}>
 *     <IconButton aria-label="Play">…</IconButton>
 *     <ToolbarSeparator />
 *     <ToolbarGroup>…</ToolbarGroup>
 *   </Toolbar>
 *
 * `role="toolbar"` with a ROVING tabindex per the WAI-ARIA pattern: Tab lands
 * on one control (the last one used, else the first), Arrow keys move between
 * the rest, Home/End jump to the ends. Without this every tool in a 20-button
 * bar is its own tab stop and keyboard users tab through the whole bar to
 * reach the canvas.
 *
 * Children are arbitrary; the toolbar discovers focusable descendants itself
 * (buttons, inputs, selects, anything with a tabindex) and re-discovers them
 * when the DOM under it changes, so conditional tools need no bookkeeping.
 *
 * `overflow` is a slot pinned to the far end for a "more" menu; it is part of
 * the roving set, so it is reachable with the same arrows.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@utils/cn';
import styles from './Toolbar.module.css';

export interface ToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  children: ReactNode;
  /** Required: a toolbar with no name is announced as "toolbar", which says nothing. */
  'aria-label': string;
  orientation?: 'horizontal' | 'vertical';
  /** Pinned to the end — the "more" menu. */
  overflow?: ReactNode;
  size?: 'sm' | 'md';
}

/** Everything the toolbar could hand focus to, disabled or not. */
const CANDIDATES = 'button, [role="button"], input, select, textarea, a[href], [tabindex]';

function isDisabled(el: HTMLElement): boolean {
  return (
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.hidden ||
    el.getAttribute('aria-hidden') === 'true'
  );
}

/** Belongs to THIS toolbar (not a nested one) and is not disabled. */
function eligible(el: HTMLElement, root: HTMLElement): boolean {
  if (el.closest('[role="toolbar"]') !== root) return false;
  // Skip a nested focusable inside a control we already manage (an icon
  // wrapped in a button); the outermost one is the tool.
  const owner = el.parentElement?.closest(CANDIDATES);
  if (owner && owner !== root && root.contains(owner)) return false;
  return !isDisabled(el);
}

export function Toolbar({
  children,
  orientation = 'horizontal',
  overflow,
  size = 'md',
  className,
  onKeyDown,
  onFocus,
  ...rest
}: ToolbarProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);

  /** The roving set: this toolbar's enabled tools, in DOM order. */
  const items = useCallback((): HTMLElement[] => {
    const root = ref.current;
    if (!root) return [];
    // No visibility test here: jsdom reports `offsetParent` null for every
    // element, and a `display: none` tool is skipped by the browser's own
    // focus() anyway.
    return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter((el) => eligible(el, root));
  }, []);

  /** Make exactly one item tabbable; disabled tools are never a tab stop. */
  const assign = useCallback((active: HTMLElement | null): void => {
    const root = ref.current;
    if (!root) return;
    const list = items();
    const target =
      list.length === 0
        ? null
        : active && list.includes(active)
          ? active
          : (list.find((el) => el === activeRef.current) ?? list[0]!);
    activeRef.current = target;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES))) {
      if (el.closest('[role="toolbar"]') !== root) continue;
      el.setAttribute('data-toolbar-managed', '');
      el.tabIndex = el === target ? 0 : -1;
    }
  }, [items]);

  useEffect(() => {
    assign(null);
    const root = ref.current;
    if (!root || typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => assign(null));
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
    return () => mo.disconnect();
  }, [assign]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const list = items();
    if (list.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    const index = current ? list.indexOf(current) : -1;
    if (index === -1) return;

    const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const prev = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    let to = -1;
    if (e.key === next) to = (index + 1) % list.length;
    else if (e.key === prev) to = (index - 1 + list.length) % list.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list.length - 1;
    if (to === -1) return;

    // A text field owns Left/Right for its caret.
    const tag = current?.tagName;
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && orientation === 'horizontal' && (e.key === next || e.key === prev)) return;

    e.preventDefault();
    const target = list[to]!;
    assign(target);
    target.focus();
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-orientation={orientation}
      className={cn(styles.root, className)}
      data-orientation={orientation}
      data-size={size}
      onKeyDown={handleKeyDown}
      onFocus={(e) => {
        onFocus?.(e);
        // Remember where the user was, so Tab comes back to the same tool.
        const t = e.target as HTMLElement;
        if (items().includes(t)) assign(t);
      }}
      {...rest}
    >
      <div className={styles.items}>{children}</div>
      {overflow ? <div className={styles.overflow}>{overflow}</div> : null}
    </div>
  );
}

export function ToolbarSeparator(): JSX.Element {
  return <div role="separator" aria-orientation="vertical" className={styles.separator} />;
}

export function ToolbarGroup({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div role="group" className={cn(styles.group, className)} {...rest}>
      {children}
    </div>
  );
}
