/**
 * Progress — a bar for work that takes time.
 *
 *   <Progress value={0.4} label="Rendering" />          determinate, 0–1
 *   <Progress indeterminate label="Connecting…" />       sweep
 *   <Progress value={1} variant="success" size="sm" />
 *
 * `role="progressbar"` with `aria-valuenow` in PERCENT (0–100) — the value
 * prop is a fraction because every producer in the app (render jobs, uploads,
 * the cache) already reports one, and a bar that took 0–100 would have every
 * caller multiplying. Indeterminate bars carry no `aria-valuenow`, which is
 * how assistive tech is told the bar is busy rather than at zero.
 */

import { useId, type ReactNode } from 'react';
import { cn } from '@utils/cn';
import styles from './Progress.module.css';

export type ProgressVariant = 'default' | 'success' | 'warning' | 'danger';

export interface ProgressProps {
  /** 0–1. Ignored when `indeterminate`. */
  value?: number;
  indeterminate?: boolean;
  size?: 'sm' | 'md';
  variant?: ProgressVariant;
  /** Visible label above the bar; also the accessible name. */
  label?: ReactNode;
  /** Show the percentage after the label (determinate only). */
  showValue?: boolean;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  className?: string;
}

export function Progress({
  value = 0,
  indeterminate = false,
  size = 'md',
  variant = 'default',
  label,
  showValue = false,
  'aria-label': ariaLabel,
  className,
}: ProgressProps): JSX.Element {
  const id = useId();
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const percent = Math.round(clamped * 100);
  const hasLabel = label !== undefined && label !== null && label !== '';

  return (
    <div
      className={cn(styles.root, className)}
      data-size={size}
      data-variant={variant}
      data-indeterminate={indeterminate || undefined}
    >
      {hasLabel || (showValue && !indeterminate) ? (
        <div className={styles.head}>
          {hasLabel ? <span id={id} className={styles.label}>{label}</span> : <span />}
          {showValue && !indeterminate ? (
            <span className={styles.value} data-numeric>{percent}%</span>
          ) : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-labelledby={hasLabel ? id : undefined}
        aria-label={hasLabel ? undefined : ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : percent}
        aria-busy={indeterminate || undefined}
        className={styles.track}
      >
        <div
          className={styles.fill}
          style={indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
