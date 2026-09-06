/**
 * ContextMenu — a right-click menu at a point on screen.
 *
 *   <ContextMenu open x={e.clientX} y={e.clientY} items={items} onClose={close} />
 *
 * The reusable half of what ContextMenuHost used to do inline: a portalled
 * <Menu> (items, submenus, shortcut column, `role="menu"`) clamped to the
 * viewport, closed by outside pointerdown, Escape, or activating an item.
 *
 * Scene / canvas right-click lists are long. The shared Menu defaults to a
 * 280px scroller; this opts out so every item is visible, and measures the
 * real box after paint so a tall menu still stays on screen.
 *
 * FOCUS. On open the first enabled item takes focus, so the arrows work at
 * once; on close focus goes BACK to whatever had it before — the layer row,
 * the canvas — instead of falling to <body>, where the next keystroke goes to
 * the global shortcut handler rather than the thing the user was working on.
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@utils/cn';
import { Menu, MenuItem, MenuSeparator, type MenuSelectModifiers } from '@components/Menu';
import type { IconName } from '@components/Icon';
import styles from './ContextMenu.module.css';

export interface ContextMenuEntry {
  id: string;
  label?: ReactNode;
  icon?: IconName;
  /** Right-aligned shortcut column — a formatted chord string. */
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Toggle state: renders a menuitemcheckbox. */
  checked?: boolean;
  /** Render a divider instead of an action. */
  separator?: boolean;
  onSelect?: (modifiers: MenuSelectModifiers) => void;
  /** Nested items — renders this entry as a submenu (opens to the right). */
  children?: ReadonlyArray<ContextMenuEntry>;
}

export interface ContextMenuProps {
  open: boolean;
  /** Viewport coordinates of the top-left corner (before clamping). */
  x: number;
  y: number;
  items: ReadonlyArray<ContextMenuEntry>;
  onClose: () => void;
  ariaLabel?: string;
  className?: string;
}

const VIEW_PAD = 8;

/** Render items (recursively for submenus — Menu handles nesting/portals). */
export function renderContextMenuItems(items: ReadonlyArray<ContextMenuEntry>): ReactNode {
  return items.map((it) =>
    it.separator ? (
      <MenuSeparator key={it.id} />
    ) : (
      <MenuItem
        key={it.id}
        id={it.id}
        label={it.label}
        icon={it.icon}
        shortcut={it.shortcut}
        disabled={it.disabled}
        danger={it.danger}
        checked={it.checked}
        onSelect={it.onSelect}
      >
        {it.children && it.children.length > 0 ? renderContextMenuItems(it.children) : undefined}
      </MenuItem>
    ),
  );
}

function clampToViewport(el: HTMLElement, x: number, y: number): void {
  const menu = (el.querySelector('[role="menu"]') as HTMLElement | null) ?? el;
  menu.style.maxHeight = '';
  menu.style.overflowY = '';
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxH = vh - VIEW_PAD * 2;
  if (menu.scrollHeight > maxH) {
    menu.style.maxHeight = `${maxH}px`;
    menu.style.overflowY = 'auto';
  }
  const { width, height } = el.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + width > vw - VIEW_PAD) left = Math.max(VIEW_PAD, vw - width - VIEW_PAD);
  if (top + height > vh - VIEW_PAD) top = Math.max(VIEW_PAD, vh - height - VIEW_PAD);
  if (left < VIEW_PAD) left = VIEW_PAD;
  if (top < VIEW_PAD) top = VIEW_PAD;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function ContextMenu({ open, x, y, items, onClose, ariaLabel, className }: ContextMenuProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    clampToViewport(ref.current, x, y);
  }, [open, x, y, items]);

  // Focus: capture the previous owner on open, hand it back on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    restoreTo.current = prev && prev !== document.body ? prev : null;
    const first = ref.current?.querySelector<HTMLElement>(
      '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])',
    );
    first?.focus();
    return () => {
      const target = restoreTo.current;
      restoreTo.current = null;
      if (target && target.isConnected) target.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      // Submenus portal to document.body (outside `ref`), so also keep the
      // menu open for pointerdowns inside any open menu popup.
      const t = e.target as Element | null;
      if (ref.current && !ref.current.contains(e.target as Node) && !t?.closest('[role="menu"]')) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div ref={ref} className={cn(styles.root, className)} style={{ left: x, top: y }} data-context-menu="">
      <Menu noScroll spacious ariaLabel={ariaLabel} onItemActivate={onClose}>
        {renderContextMenuItems(items)}
      </Menu>
    </div>,
    document.body,
  );
}
