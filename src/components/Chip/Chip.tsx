/**
 * Chip — a compact label the user can SELECT and/or REMOVE.
 *
 *   <Chip selected={on} onSelect={() => toggle()}>Video</Chip>     filter
 *   <Chip onRemove={() => drop(tag)}>{tag}</Chip>                  token
 *   <Chip selected onSelect={…} onRemove={…}>Both</Chip>
 *
 * Selectable chips render as a toggle button (`aria-pressed`); a bare chip
 * with only `onRemove` is a static label with a remove button. For a
 * read-only status label use <Badge>.
 */

import { type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '@utils/cn';
import { Icon, type IconName } from '@components/Icon';
import styles from './Chip.module.css';

export interface ChipProps {
  children: ReactNode;
  /** Leading icon. */
  icon?: IconName;
  /** Toggled state; only meaningful with `onSelect`. */
  selected?: boolean;
  /** Makes the chip a toggle button. */
  onSelect?: () => void;
  /** Adds a remove button. Also fires on Backspace/Delete while the chip has focus. */
  onRemove?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  /** Accessible name for the remove button; defaults to "Remove {label}" for string labels. */
  removeLabel?: string;
}

export function Chip({
  children,
  icon,
  selected = false,
  onSelect,
  onRemove,
  disabled = false,
  size = 'md',
  className,
  removeLabel,
}: ChipProps): JSX.Element {
  const selectable = typeof onSelect === 'function';
  const labelText = typeof children === 'string' ? children : undefined;
  const removeName = removeLabel ?? (labelText ? `Remove ${labelText}` : 'Remove');

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (disabled) return;
    if (onRemove && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      onRemove();
    }
  };

  const body = (
    <>
      {icon ? <Icon name={icon} size="sm" className={styles.icon} /> : null}
      <span className={styles.label}>{children}</span>
    </>
  );

  return (
    <span
      className={cn(styles.root, className)}
      data-size={size}
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      data-selectable={selectable || undefined}
    >
      {selectable ? (
        <button
          type="button"
          className={styles.main}
          aria-pressed={selected}
          disabled={disabled}
          onClick={onSelect}
          onKeyDown={onKeyDown}
        >
          {body}
        </button>
      ) : (
        <span className={styles.main} onKeyDown={onKeyDown}>
          {body}
        </span>
      )}
      {onRemove ? (
        <button
          type="button"
          className={styles.remove}
          aria-label={removeName}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Icon name="close" size="sm" />
        </button>
      ) : null}
    </span>
  );
}
