/**
 * DialogFooter — the one arrangement of dialog buttons.
 *
 *   [secondary] [destructive]     [note…]                [primary]
 *
 * Secondary (Cancel, Back) sits left; a destructive verb (Delete, Discard)
 * sits beside it, in danger red, so the safe way out and the irreversible
 * one are never adjacent to the primary; the primary sits alone at the right,
 * where Enter finds it (`Modal` clicks the footer's primary-variant button
 * when no action was registered — see `enterToConfirm.ts`).
 */

import type { ReactNode } from 'react';
import { cn } from '@utils/cn';
import { DIALOG_PRIMARY_ATTR } from './enterToConfirm';
import styles from './DialogFooter.module.css';

export interface DialogFooterProps {
  /** The one thing the dialog is for. Right-aligned. */
  primary?: ReactNode;
  /** The way out — Cancel, Back. Left-aligned. */
  secondary?: ReactNode;
  /** An irreversible verb, in danger styling. Left, after secondary. */
  destructive?: ReactNode;
  /** Quiet text beside the buttons — a file name, "Previewing on the composition". */
  note?: ReactNode;
  className?: string;
}

export function DialogFooter({ primary, secondary, destructive, note, className }: DialogFooterProps): JSX.Element {
  return (
    <div className={cn(styles.root, className)}>
      <div className={styles.start}>
        {secondary}
        {destructive}
        {note ? <span className={styles.note}>{note}</span> : null}
      </div>
      {/* Stamped so `Modal`'s Enter fallback finds the primary wherever the
          footer is rendered — the modal's footer slot or the body's end. */}
      <div className={styles.end} {...{ [DIALOG_PRIMARY_ATTR]: '' }}>{primary}</div>
    </div>
  );
}
