/**
 * Tooltip — a fast, styled floating label, built on Radix Tooltip (accessible,
 * portalled, collision-aware). Wrap any focusable element:
 *
 *   <Tooltip label="Play">{trigger}</Tooltip>
 *
 * A single <TooltipProvider> must sit near the app root (see main.tsx).
 */

import * as RTooltip from '@radix-ui/react-tooltip';
import { type ReactElement, type ReactNode } from 'react';
import { Kbd } from '@components/Kbd';
import styles from './Tooltip.module.css';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  label: ReactNode;
  placement?: TooltipPlacement;
  /** The trigger element. */
  children: ReactElement;
  className?: string;
  /**
   * A keyboard chord ("Ctrl+Shift+P", or `formatChord()` output) drawn as
   * keycaps after the label. Optional: most tooltips have no shortcut, and a
   * tooltip that shows one should show it the same way everywhere.
   */
  shortcut?: string;
}

/** One provider near the app root controls delay/skip behaviour for all tooltips. */
export function TooltipProvider({ children }: { children: ReactNode }): JSX.Element {
  return (
    <RTooltip.Provider delayDuration={320} skipDelayDuration={240}>
      {children}
    </RTooltip.Provider>
  );
}

export function Tooltip({ label, placement = 'top', children, className, shortcut }: TooltipProps): ReactElement {
  if (label === null || label === undefined || label === '') return children;
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          className={className ? `${styles.pop} ${className}` : styles.pop}
          side={placement}
          sideOffset={6}
          collisionPadding={8}
        >
          <span className={styles.label}>{label}</span>
          {shortcut ? <Kbd chord={shortcut} size="sm" className={styles.shortcut} /> : null}
          <RTooltip.Arrow className={styles.arrow} />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
