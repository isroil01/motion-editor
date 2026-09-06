/**
 * Combobox — a text field that filters a list and picks one entry.
 *
 *   <Combobox
 *     aria-label="Font"
 *     options={fonts.map((f) => ({ value: f.id, label: f.name }))}
 *     value={fontId}
 *     onChange={setFontId}
 *     placeholder="Search fonts…"
 *   />
 *
 * Built on Radix Popover for the floating, collision-aware list, with the
 * ARIA 1.2 combobox pattern on top: the <input> is `role="combobox"`, the
 * list is a `role="listbox"` it `aria-controls`, and the highlighted row is
 * announced through `aria-activedescendant` — focus never leaves the field,
 * so typing keeps filtering while the arrows move the highlight.
 *
 * Keyboard: type to filter · ↓/↑ move (↓ also opens) · Enter picks · Esc
 * closes and restores the field · Home/End · Tab closes.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@utils/cn';
import { Icon } from '@components/Icon';
import styles from './Combobox.module.css';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary line under the label. */
  description?: string;
  disabled?: boolean;
  /** Custom row content; `label` is still what is filtered and shown in the field. */
  render?: () => ReactNode;
}

export interface ComboboxProps {
  options: ReadonlyArray<ComboboxOption>;
  /** The selected option's value, or null for nothing. */
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  fullWidth?: boolean;
  /** Shown when the filter matches nothing. */
  emptyText?: string;
  /** Override the default case-insensitive "label includes query". */
  filter?: (option: ComboboxOption, query: string) => boolean;
  className?: string;
}

const defaultFilter = (o: ComboboxOption, q: string): boolean =>
  o.label.toLowerCase().includes(q.toLowerCase());

export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  id,
  size = 'md',
  disabled = false,
  fullWidth = false,
  emptyText = 'No matches',
  filter = defaultFilter,
  className,
}: ComboboxProps): JSX.Element {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-listbox`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const visible = useMemo(
    () => (query === '' ? options : options.filter((o) => filter(o, query))),
    [options, query, filter],
  );

  // Keep the highlight on a real row as the filter changes.
  useEffect(() => {
    if (active >= visible.length) setActive(Math.max(0, visible.length - 1));
  }, [visible.length, active]);

  // Scroll the highlighted row into view.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const optionId = (i: number): string => `${autoId}-opt-${i}`;

  const openList = (): void => {
    if (disabled) return;
    setQuery('');
    const idx = visible.findIndex((o) => o.value === value);
    setActive(Math.max(0, idx));
    setOpen(true);
  };

  const closeList = (): void => {
    setOpen(false);
    setQuery('');
  };

  const pick = (o: ComboboxOption | undefined): void => {
    if (!o || o.disabled) return;
    onChange(o.value);
    closeList();
  };

  const step = (from: number, dir: 1 | -1): number => {
    if (visible.length === 0) return 0;
    let i = from;
    for (let n = 0; n < visible.length; n++) {
      i = (i + dir + visible.length) % visible.length;
      if (!visible[i]?.disabled) return i;
    }
    return from;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList();
        else setActive((a) => step(a, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList();
        else setActive((a) => step(a, -1));
        break;
      case 'Home':
        if (open) { e.preventDefault(); setActive(step(-1, 1)); }
        break;
      case 'End':
        if (open) { e.preventDefault(); setActive(step(0, -1)); }
        break;
      case 'Enter':
        if (open) { e.preventDefault(); pick(visible[active]); }
        break;
      case 'Escape':
        if (open) { e.preventDefault(); e.stopPropagation(); closeList(); }
        break;
      case 'Tab':
        if (open) closeList();
        break;
      default:
        break;
    }
  };

  const shown = open ? query : (selected?.label ?? '');

  return (
    <Popover.Root open={open} onOpenChange={(next) => (next ? openList() : closeList())}>
      <Popover.Anchor asChild>
        <div
          className={cn(styles.field, fullWidth && styles.fullWidth, disabled && styles.disabled, className)}
          data-size={size}
          data-open={open || undefined}
        >
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-expanded={open}
            aria-controls={listId}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-activedescendant={open && visible[active] ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            className={styles.input}
            placeholder={placeholder}
            disabled={disabled}
            value={shown}
            onChange={(e) => {
              if (!open) setOpen(true);
              setQuery(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            onClick={() => { if (!open) openList(); }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? 'Close list' : 'Open list'}
            className={styles.toggle}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { if (open) closeList(); else { openList(); inputRef.current?.focus(); } }}
          >
            <Icon name="chevron-down" size="sm" />
          </button>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className={styles.pop}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // A click on the field itself is not "outside".
            const t = e.target as Node | null;
            if (t && inputRef.current?.parentElement?.contains(t)) e.preventDefault();
          }}
        >
          <ul ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className={styles.list}>
            {visible.length === 0 ? (
              <li className={styles.empty} aria-disabled="true">{emptyText}</li>
            ) : (
              visible.map((o, i) => (
                <li
                  key={o.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  data-index={i}
                  data-active={i === active || undefined}
                  className={styles.option}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => { if (i !== active) setActive(i); }}
                  onClick={() => pick(o)}
                >
                  {o.render ? o.render() : (
                    <>
                      <span className={styles.optionLabel}>{o.label}</span>
                      {o.description ? <span className={styles.optionDesc}>{o.description}</span> : null}
                    </>
                  )}
                  {o.value === value ? <Icon name="check" size="sm" className={styles.check} /> : null}
                </li>
              ))
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
