/**
 * Badge — a small, read-only label that carries a STATUS or a COUNT.
 *
 *   <Badge variant="success">Cached</Badge>
 *   <Badge variant="accent" size="sm">12</Badge>
 *   <Badge variant="warning" dot>Modified</Badge>
 *
 * Not interactive — for a removable or selectable label use <Chip>.
 */

import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@utils/cn';
import styles from './Badge.module.css';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Draw a leading status dot in the variant colour. */
  dot?: boolean;
  children: ReactNode;
}

export function Badge({
  variant = 'neutral',
  size = 'md',
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(styles.root, className)}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      {dot ? <span className={styles.dot} aria-hidden /> : null}
      {children}
    </span>
  );
}
