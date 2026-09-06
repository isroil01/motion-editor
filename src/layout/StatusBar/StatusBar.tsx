/**
 * StatusBar — bottom strip for app-wide status indicators.
 *
 * Slots: left, center, right, each taking arbitrary content (chips, text, small
 * buttons). Purely a layout shell; `EditorStatusBar` fills all three with live
 * state — save state, layer and selection counts, the comp chip, the job
 * tray, playhead, zoom — and App.tsx mounts that.
 */

import type { ReactNode } from 'react';
import { cn } from '@utils/cn';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
}

export function StatusBar({ left, center, right, className }: StatusBarProps): JSX.Element {
  return (
    <footer className={cn(styles.root, className)} role="status">
      <div className={cn(styles.group, styles.left)}>{left}</div>
      <div className={cn(styles.group, styles.center)}>{center}</div>
      <div className={cn(styles.group, styles.right)}>{right}</div>
    </footer>
  );
}
