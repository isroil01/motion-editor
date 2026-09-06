/**
 * Toast — one notice card. The VISUAL only; the queue, auto-dismiss and
 * progress bookkeeping live in uiStore, and NotificationHost maps store rows
 * onto this.
 *
 *   <Toast level="success" message="Exported" onDismiss={…} />
 *   <Toast level="info" message="Rendering…" progress={0.4} sticky />
 *   <Toast level="error" message="Export failed" detail={err} action={{ label: 'Retry', onSelect }} />
 *
 * `progress` (0–1 or 'indeterminate') draws a <Progress> bar under the
 * message; a toast with progress is not done, so callers should pass `sticky`
 * with it. `sticky` is a data attribute here — what it MEANS (ignore the
 * timer) is the store's business; the card only stops advertising a timeout.
 *
 * Errors use `role="alert"` so they interrupt; everything else is a polite
 * `role="status"`.
 */

import { type ReactNode } from 'react';
import { cn } from '@utils/cn';
import { Icon, type IconName } from '@components/Icon';
import { IconButton } from '@components/IconButton';
import { Progress } from '@components/Progress';
import styles from './Toast.module.css';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onSelect(): void;
}

export interface ToastProps {
  level: ToastLevel;
  message: ReactNode;
  /** Optional second line — an error's detail, a file path. */
  detail?: ReactNode;
  /** 0–1 draws a bar; 'indeterminate' draws a sweep. Absent = plain notice. */
  progress?: number | 'indeterminate';
  /** Stays until dismissed. Marks the card; the timer lives in the store. */
  sticky?: boolean;
  /** One inline action, not a row of them: a toast with buttons is a dialog in disguise. */
  action?: ToastAction;
  /** Fires from the dismiss button. Omit to hide the button. */
  onDismiss?: () => void;
  className?: string;
}

const LEVEL_ICON: Record<ToastLevel, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'warning',
  error: 'error',
};

export function Toast({
  level,
  message,
  detail,
  progress,
  sticky = false,
  action,
  onDismiss,
  className,
}: ToastProps): JSX.Element {
  const hasProgress = progress !== undefined;
  const label = typeof message === 'string' ? message : undefined;
  return (
    <div
      className={cn(styles.root, className)}
      data-level={level}
      data-sticky={sticky || undefined}
      data-progress={hasProgress || undefined}
      role={level === 'error' ? 'alert' : 'status'}
    >
      <span className={styles.icon}>
        <Icon name={LEVEL_ICON[level]} size="md" />
      </span>
      <div className={styles.body}>
        <div className={styles.message}>{message}</div>
        {detail ? <div className={styles.detail}>{detail}</div> : null}
        {hasProgress ? (
          <Progress
            className={styles.progress}
            size="sm"
            variant={level === 'error' ? 'danger' : level === 'success' ? 'success' : 'default'}
            value={typeof progress === 'number' ? progress : 0}
            indeterminate={progress === 'indeterminate'}
            aria-label={label ?? 'Progress'}
          />
        ) : null}
      </div>
      {action ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            // Dismiss first: the action may quit the app (Restart now), and a
            // toast still on screen while the window tears down reads as a hang.
            onDismiss?.();
            action.onSelect();
          }}
        >
          {action.label}
        </button>
      ) : null}
      {onDismiss ? (
        <IconButton aria-label="Dismiss" size="sm" className={styles.dismiss} onClick={onDismiss}>
          <Icon name="close" size="sm" />
        </IconButton>
      ) : null}
    </div>
  );
}
