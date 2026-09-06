/**
 * Kbd — a keyboard chord drawn as keycaps.
 *
 *   <Kbd chord="Ctrl+Shift+P" />      Ctrl · Shift · P
 *   <Kbd chord={formatChord(chord)} />  ⌘ · ⇧ · K
 *
 * Accepts the compact string `formatChord()` (layout/Menu/formatChord.ts)
 * produces — modifiers run together with no separator ("Ctrl⇧K") — as well as
 * the `+`-joined spelling humans type. `splitChord` is the tokenizer and is
 * exported so the menu bar and the command palette can share it.
 */

import { cn } from '@utils/cn';
import styles from './Kbd.module.css';

export interface KbdProps {
  /** The chord, e.g. "Ctrl+Shift+P" or "⌘⇧K". */
  chord: string;
  size?: 'sm' | 'md';
  className?: string;
}

const GLYPHS = new Set(['⌘', '⌥', '⇧', '⌃', '⎋', '⏎', '⌫', '⇥', '␣']);
const WORD_MODIFIERS = /^(Ctrl|Control|Alt|Shift|Meta|Cmd|Command|Win|Option|Super)(?=[^a-z]|$)/i;

/** "Ctrl⇧K" → ["Ctrl", "⇧", "K"]; "Ctrl+Shift+P" → ["Ctrl", "Shift", "P"]. */
export function splitChord(chord: string): string[] {
  const out: string[] = [];
  for (const part of chord.split('+').map((p) => p.trim()).filter(Boolean)) {
    let rest = part;
    while (rest.length > 0) {
      const first = [...rest][0]!;
      if (GLYPHS.has(first)) {
        out.push(first);
        rest = rest.slice(first.length);
        continue;
      }
      const word = WORD_MODIFIERS.exec(rest);
      if (word && word[0].length < rest.length) {
        out.push(word[0]);
        rest = rest.slice(word[0].length);
        continue;
      }
      out.push(rest);
      rest = '';
    }
  }
  return out;
}

export function Kbd({ chord, size = 'md', className }: KbdProps): JSX.Element {
  const keys = splitChord(chord);
  return (
    <kbd className={cn(styles.root, className)} data-size={size} aria-label={keys.join(' ')}>
      {keys.map((k, i) => (
        <kbd key={`${k}-${i}`} className={styles.key} aria-hidden>
          {k}
        </kbd>
      ))}
    </kbd>
  );
}
