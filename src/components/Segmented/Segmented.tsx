/**
 * Segmented — a single-select control: N options, exactly one on.
 *
 *   <Segmented
 *     aria-label="Interface density"
 *     value={density}
 *     onChange={setDensity}
 *     options={[
 *       { value: 'compact', label: 'Compact' },
 *       { value: 'default', label: 'Default' },
 *       { value: 'comfortable', label: 'Comfortable' },
 *     ]}
 *   />
 *
 * Accessibility: `role="radiogroup"` with one `role="radio"` per option and a
 * ROVING tabindex — the group is one tab stop, and Left/Right (Up/Down) move
 * the selection the way native radios do. Home/End jump to the ends.
 *
 * The CustomizeDialog used to hand-roll this three times with a `.segmented`
 * class and no roles; this is the one to reach for from now on.
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@utils/cn';
import { Icon, type IconName } from '@components/Icon';
import styles from './Segmented.module.css';

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  /** Accessible name for an icon-only option. */
  ariaLabel?: string;
}

export interface SegmentedProps<V extends string> {
  options: ReadonlyArray<SegmentedOption<V>>;
  value: V;
  onChange: (value: V) => void;
  size?: 'sm' | 'md';
  /** Stretch to the container and share the width equally. */
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  disabled = false,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SegmentedProps<V>): JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabled = options.map((o, i) => ({ o, i })).filter(({ o }) => !o.disabled && !disabled);

  const move = (from: number, step: number): void => {
    if (enabled.length === 0) return;
    const pos = enabled.findIndex(({ i }) => i === from);
    const next = enabled[(pos + step + enabled.length) % enabled.length]!;
    onChange(next.o.value);
    refs.current[next.i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        e.preventDefault();
        if (enabled[0]) { onChange(enabled[0].o.value); refs.current[enabled[0].i]?.focus(); }
        break;
      case 'End': {
        e.preventDefault();
        const last = enabled[enabled.length - 1];
        if (last) { onChange(last.o.value); refs.current[last.i]?.focus(); }
        break;
      }
      default:
        break;
    }
  };

  const selectedIndex = options.findIndex((o) => o.value === value);
  // The tab stop is the selected option; if that is disabled, the first enabled.
  const tabStop = selectedIndex >= 0 && !options[selectedIndex]?.disabled
    ? selectedIndex
    : (enabled[0]?.i ?? -1);

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-disabled={disabled || undefined}
      className={cn(styles.root, fullWidth && styles.fullWidth, className)}
      data-size={size}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.ariaLabel}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={disabled || o.disabled}
            className={styles.item}
            data-checked={checked || undefined}
            onClick={() => { if (!checked) onChange(o.value); }}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon ? <Icon name={o.icon} size="sm" className={styles.icon} /> : null}
            {o.label ? <span className={styles.label}>{o.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
