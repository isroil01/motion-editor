/**
 * Button — primary interactive control in the design system.
 *
 * Variants: primary | secondary | ghost | tertiary | danger
 * Sizes:    xs | sm | md | lg
 *
 * Behaviour:
 *   - Disabled state is visible and removes pointer events.
 *   - Loading state replaces label with a spinner (label stays in the
 *     accessible name; `aria-busy` announces the wait).
 *   - `icon` (alias of `leftIcon`) and `iconOnly` — a square button whose
 *     label is visually hidden but still read, so the 279 local `.button`
 *     classes in src/layout can migrate mechanically: `<button className=
 *     {styles.iconBtn}><Icon/></button>` becomes `<Button iconOnly icon=…>
 *     Label</Button>`.
 *   - Forwards ref for parent focus management.
 */

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@utils/cn';
import type { Size, Variant } from '@app-types/common';
import styles from './Button.module.css';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  /** Leading icon. `icon` and `leftIcon` are the same slot; `icon` wins if both are given. */
  icon?: ReactNode;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /**
   * Square, icon-only. The children are still REQUIRED — they become the
   * accessible name (visually hidden) unless an `aria-label` is passed.
   */
  iconOnly?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

import { usePreferenceStore } from '@stores/preferenceStore';

function ButtonInner(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    fullWidth = false,
    icon,
    leftIcon,
    rightIcon,
    iconOnly = false,
    disabled,
    className,
    style,
    children,
    type = 'button',
    ...rest
  }: ButtonProps,
  ref: Ref<HTMLButtonElement>,
): JSX.Element {
  const buttonPref = usePreferenceStore((s) => s.buttonSize);
  const scaleMult = buttonPref === 'sm' ? 0.88 : buttonPref === 'lg' ? 1.15 : 1.0;
  const mergedStyle = scaleMult !== 1 ? { transform: `scale(${scaleMult})`, transformOrigin: 'center center', ...style } : style;

  const isDisabled = disabled || loading;
  const leading = icon ?? leftIcon;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      style={mergedStyle}
      className={cn(
        styles.root,
        fullWidth && styles.fullWidth,
        loading && styles.loading,
        iconOnly && styles.iconOnly,
        className,
      )}
      {...rest}
    >
      {leading ? <span className={styles.icon}>{leading}</span> : null}
      <span className={cn(styles.label, iconOnly && styles.srOnly)}>{children}</span>
      {rightIcon && !iconOnly ? <span className={styles.icon}>{rightIcon}</span> : null}
      {loading ? <span className={styles.spinner} aria-hidden /> : null}
    </button>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(ButtonInner);
Button.displayName = 'Button';
