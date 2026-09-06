/**
 * ToolFlyout — a toolbar button that shows the current tool of a family and
 * opens the family as a menu (AE's long-press tool groups).
 *
 * `Dropdown` owns its open state privately, so a trigger it wraps cannot say
 * `aria-expanded`; this uses the controlled `Popover` underneath it directly
 * so the trigger carries the full toolbar contract: `aria-label` (the tool,
 * not the glyph), `aria-pressed` (this family holds the active tool),
 * `aria-haspopup` + `aria-expanded` (it opens a menu). The Snap button was
 * the model for the first two.
 */

import { useState } from 'react';
import { Popover } from '@components/Popover';
import { Menu, MenuItem, MenuSeparator } from '@components/Menu';
import { Icon, type IconName } from '@components/Icon';
import styles from './TopNav.module.css';

export interface ToolFlyoutItem {
  id: string;
  label: string;
  icon: IconName;
  onSelect: () => void;
  /**
   * The tool's live chord, already formatted (`toolShortcuts.ts`). Drawn in the
   * menu row's shortcut column, the same place every other menu in the app
   * draws one — rather than glued onto the end of the label, which is what the
   * toolbar used to do and which no menu row anywhere else does.
   */
  shortcut?: string;
  /** Draw a rule above this entry. */
  separatorBefore?: boolean;
}

export interface ToolFlyoutProps {
  /** The glyph of the family's current tool. */
  icon: IconName;
  /** Accessible name of the current tool, e.g. "Pen Tool (G)". */
  label: string;
  /** Tooltip; defaults to `label`. */
  title?: string;
  /**
   * The current tool's live chord, already formatted (`toolShortcuts.ts`).
   * Appended to the hover title; the accessible name carries it via `label`.
   */
  shortcut?: string;
  /** True when the active tool is one of this family. */
  active: boolean;
  disabled?: boolean;
  items: ReadonlyArray<ToolFlyoutItem>;
  'data-tour'?: string;
}

export function ToolFlyout({ icon, label, title, shortcut, active, disabled, items, 'data-tour': dataTour }: ToolFlyoutProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      placement="bottom-start"
      closeOnOutside
      closeOnEscape
      bare
      open={open}
      onOpenChange={setOpen}
      trigger={
        /*
          A NATIVE `title` here, not <Tooltip> — and this is a constraint, not a
          preference.

          `Popover` takes its trigger as an element and `cloneElement`s it with
          the `ref` it needs for positioning and the `onClick` that opens the
          flyout. A `<Tooltip>` in that slot is a plain function component: it
          would swallow both, so the popover would have no anchor to measure and
          the button would stop opening the menu at all.

          Wrapping the popover from outside does not work either — Radix's
          `Tooltip.Trigger asChild` needs a child that forwards ref and props,
          and `Popover` renders a fragment. So the two live tools that are plain
          buttons DO get the real keycap tooltip (see TopNav), the flyout
          triggers state the chord in their title text, and the flyout's own
          menu rows draw it in the shortcut column like every other menu.
        */
        <button
          type="button"
          className={active ? styles.toolDropdownTriggerActive : styles.toolDropdownTrigger}
          title={shortcut ? `${title ?? label} (${shortcut})` : (title ?? label)}
          aria-label={label}
          aria-pressed={active}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          data-tour={dataTour}
        >
          <Icon name={icon} size="md" />
          <Icon name="chevron-down" size="sm" className={styles.chevron} />
        </button>
      }
    >
      <Menu onItemActivate={() => setOpen(false)}>
        {items.flatMap((it) => [
          it.separatorBefore ? <MenuSeparator key={`sep-${it.id}`} /> : null,
          <MenuItem key={it.id} id={it.id} label={it.label} icon={it.icon} shortcut={it.shortcut} onSelect={it.onSelect} />,
        ])}
      </Menu>
    </Popover>
  );
}
