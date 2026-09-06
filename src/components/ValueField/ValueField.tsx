/**
 * ValueField — the signature numeric control of Motion Studio.
 *
 * Every numeric property in the app is edited through this one control, which
 * is simultaneously:
 *   • a scrubbable slider — click-drag horizontally to adjust (AE/Blender)
 *   • a text input — click (without dragging) to type an exact value
 *   • modifier-aware — Shift = 10× step, Alt = 0.1× step; ↑/↓ nudge
 *   • a calculator — accepts math: `960/2`, `+15`, `*1.5`, `(3+4)*2`
 *
 * The spec calls this the make-or-break interaction: "If this one interaction
 * feels perfect, the entire application feels professional."
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cn } from '@utils/cn';
import { applyValueExpression } from '@utils/evalMath';
import {
  stepScale,
  clamp,
  format,
  beginScrub,
  advanceScrub,
  SCRUB_DEAD_ZONE_PX,
  type ScrubState,
} from './scrubMath';
import styles from './ValueField.module.css';

export interface ValueFieldProps {
  value: number;
  onChange: (value: number) => void;
  /** Optional live callback while scrubbing (defaults to onChange). */
  onScrub?: (value: number) => void;
  /**
   * Fired once when a pointer drag crosses the dead zone and becomes a scrub,
   * before the first `onScrub`. A caller that scrubs SEVERAL properties off
   * one field (proportional scrubbing) needs to snapshot their start values
   * here — by the first `onScrub` they have already moved.
   */
  onScrubStart?: () => void;
  /** Fired after the final `onChange` of a scrub. Not fired for a click. */
  onScrubEnd?: () => void;
  min?: number;
  max?: number;
  /** Base increment for one pixel of drag / one arrow press. */
  step?: number;
  /** Decimal places shown when not editing. Default 2, trailing zeros trimmed. */
  precision?: number;
  /** Unit label shown after the number (e.g. "°", "px", "%"). */
  unit?: string;
  disabled?: boolean;
  'aria-label'?: string;
  /**
   * The field describes SEVERAL values that disagree — a multi-selection.
   * Shows `—` instead of a number, and switches the gestures to RELATIVE:
   * a scrub reports a delta through `onRelative` rather than an absolute
   * through `onChange`, so each underlying value moves by the same amount
   * from where it was; typed text goes through `onCommitText` so `+10` can
   * be evaluated per value. Typing a plain number still means "set all".
   */
  mixed?: boolean;
  /**
   * Relative gesture sink, used when `mixed`. `cumulative` is true during a
   * scrub (delta measured from the scrub's start, re-reported on every move
   * and once more on release) and false for a one-shot nudge (an arrow key),
   * which applies to wherever the values are now.
   */
  onRelative?: (delta: number, cumulative: boolean) => void;
  /**
   * Typed-text sink, used when `mixed`. Receives the raw draft (`+10`,
   * `*2`, `100`) and returns false when it could not be applied, which
   * flashes the field exactly as an unparsable expression does.
   */
  onCommitText?: (raw: string) => boolean;
}

// clamp / format / stepScale live in scrubMath.ts (pure + unit-tested).

export function ValueField({
  value,
  onChange,
  onScrub,
  onScrubStart,
  onScrubEnd,
  min = -Infinity,
  max = Infinity,
  step = 1,
  precision = 2,
  unit,
  disabled = false,
  'aria-label': ariaLabel,
  mixed = false,
  onRelative,
  onCommitText,
}: ValueFieldProps): JSX.Element {
  // Relative mode: a mixed field whose caller can take a delta. A mixed field
  // WITHOUT a relative sink degrades to absolute — dragging it sets every
  // value to the same number, which is still a sane thing for it to do.
  const relative = mixed && onRelative !== undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scrub bookkeeping held in refs so the pointer handlers never go stale.
  const scrub = useRef<{
    startX: number;
    /** Previous clientX, for the pre-lock delta. Meaningless once locked —
     *  a locked pointer's clientX is frozen, which is the whole point. */
    lastX: number;
    moved: boolean;
    /** Lock state as of the PREVIOUS move, so a change of state can be spotted
     *  and that one frame's bogus delta thrown away. Never a source of truth —
     *  `document.pointerLockElement` is. */
    locked: boolean;
    active: boolean;
    state: ScrubState;
  }>({
    startX: 0,
    lastX: 0,
    moved: false,
    locked: false,
    active: false,
    state: beginScrub(value, { shiftKey: false, altKey: false }),
  });
  const fieldRef = useRef<HTMLDivElement>(null);
  const commitScrub = onScrub ?? onChange;

  // Focus + select the input when we enter edit mode.
  useLayoutEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const beginEdit = useCallback(() => {
    // A mixed field has no one number to pre-fill; an empty draft says so and
    // lets `+10` be typed without first deleting a value that was never there.
    setDraft(mixed ? '' : format(value, precision));
    setInvalid(false);
    setEditing(true);
  }, [value, precision, mixed]);

  const commitEdit = useCallback(() => {
    if (mixed && onCommitText) {
      setEditing(false);
      if (draft.trim() === '') return; // nothing typed — leave every value alone
      if (!onCommitText(draft)) setInvalid(true);
      return;
    }
    const next = applyValueExpression(value, draft);
    if (next === null) {
      // Invalid — flash and revert.
      setInvalid(true);
      setEditing(false);
      return;
    }
    setEditing(false);
    onChange(clamp(next, min, max));
  }, [draft, value, min, max, onChange, mixed, onCommitText]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setInvalid(false);
  }, []);

  // ── Keyboard operation on the resting field (role="spinbutton") ─────
  // Reachable by Tab; arrows nudge (Shift 10× / Alt 0.1×), Enter opens edit.
  const onFieldKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled || editing) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * stepScale(e);
      if (relative) onRelative(delta, false);
      else onChange(clamp(value + delta, min, max));
    } else if (e.key === 'Home' && Number.isFinite(min)) {
      e.preventDefault();
      onChange(min);
    } else if (e.key === 'End' && Number.isFinite(max)) {
      e.preventDefault();
      onChange(max);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      beginEdit();
    }
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // While typing, arrows nudge the drafted number (if it is one).
      const cur = Number(draft);
      if (Number.isFinite(cur)) {
        e.preventDefault();
        const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * stepScale(e);
        const next = clamp(cur + delta, min, max);
        setDraft(format(next, precision));
      }
    }
  };

  // ── Scrub (pointer drag on the field when not editing) ──────────────
  //
  // Pointer lock is what makes the drag CONTINUOUS. Without it the gesture is
  // bounded by the monitor: the cursor reaches the screen edge, `clientX` stops
  // changing, and the value freezes mid-drag — so a wide range could not be
  // crossed in one gesture, which is the one thing this control exists to do.
  // Locked, the cursor is hidden and parked while `movementX` keeps arriving,
  // exactly like After Effects.
  //
  // The lock is requested only AFTER the dead zone is crossed. Requesting it on
  // pointer-down would hide the cursor on every click that turns out to be a
  // click, and the browser would flash its "press Esc to show your cursor"
  // banner for a gesture the user never made.
  const releaseLock = useCallback(() => {
    scrub.current.active = false;
    scrub.current.locked = false;
    try {
      if (
        typeof document !== 'undefined' &&
        document.pointerLockElement === fieldRef.current &&
        document.exitPointerLock
      ) {
        document.exitPointerLock();
      }
    } catch {
      /* lock already gone (Esc, tab switch) — nothing to release */
    }
  }, []);

  /*
   * The window listeners are STABLE functions that forward to the latest
   * handlers through a ref, and they are removed only on pointer-up or unmount.
   *
   * This is the bug behind "dragging works, but not continuously like AE".
   * The handlers are `useCallback`s over `onChange`/`step`/`min`/`max`, and the
   * cleanup used to list them as effect dependencies — so the first committed
   * value re-rendered the parent, handed this field a fresh inline `onChange`,
   * changed the callbacks' identity, and the cleanup tore the listeners off
   * MID-GESTURE. The drag applied exactly one delta and then went dead until
   * you released and pressed again. Which is precisely what a user sees as
   * "it works, but it's not continuous".
   */
  const latest = useRef<{
    move: (e: PointerEvent) => void;
    up: () => void;
  }>({ move: () => {}, up: () => {} });

  const windowHandlers = useRef({
    move: (e: PointerEvent): void => latest.current.move(e),
    up: (): void => latest.current.up(),
  });

  const detachWindowListeners = useCallback((): void => {
    window.removeEventListener('pointermove', windowHandlers.current.move);
    window.removeEventListener('pointerup', windowHandlers.current.up);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const s = scrub.current;
      if (!s.moved) {
        // Dead-zone measured from the press point, not accumulated, so a shaky
        // click that returns to where it started stays a click.
        if (Math.abs(e.clientX - s.startX) < SCRUB_DEAD_ZONE_PX) return;
        s.moved = true;
        s.lastX = s.startX;
        setDragging(true);
        onScrubStart?.();
        const el = fieldRef.current;
        if (el && typeof el.requestPointerLock === 'function') {
          try {
            // Chromium returns a promise here; older engines return void. It
            // rejects when the user recently pressed Esc, or the document is
            // not focused. A scrub that stays cursor-bound is a fine fallback,
            // so every path simply leaves the scrub unlocked.
            //
            // Nothing here records that the lock was GRANTED. `document`
            // already knows, and it knows sooner: the cursor is locked before
            // this promise resolves, so a flag set from the callback is stale
            // for exactly the frames where being wrong hurts most.
            const req = el.requestPointerLock() as unknown as Promise<void> | undefined;
            if (req && typeof req.then === 'function') {
              req.then(
                () => {
                  // A request can resolve after its own scrub has ended (a
                  // short flick releases before the browser answers). Whoever
                  // is still dragging adopts the lock by reading `document`;
                  // if nobody is, it must be handed back or the cursor stays
                  // hidden with nothing listening.
                  if (document.pointerLockElement !== el) return;
                  if (!scrub.current.active) document.exitPointerLock?.();
                },
                () => { /* denied — the scrub stays cursor-bound */ },
              );
            }
          } catch {
            /* pointer lock unavailable — cursor-bound scrubbing still works */
          }
        }
      }
      /*
       * Lock state is re-read from the DOM on EVERY move, and the frame that
       * CHANGES it contributes nothing.
       *
       * Acquiring: Chromium delivers one enormous `movementX` on the event that
       * takes the lock — the jump from the real cursor to the locked origin,
       * not a hand movement. It points from the cursor back towards the origin,
       * so a drag to the RIGHT arrives as a large NEGATIVE spike. That is the
       * whole of "I drag right and the value goes to minus", and it lands at
       * the same instant the cursor vanishes, which is why the two were
       * reported as one bug. Clamping the spike (`sanitizeMovement`) bounds the
       * damage without fixing the direction — the event carries no travel at
       * all, so the only correct delta for it is zero.
       *
       * Losing it (Esc, tab switch, window blur): `clientX` on that frame is
       * the frozen coordinate the locked cursor was parked at, so measuring
       * against it teleports the value by however far the cursor really moved.
       *
       * Dropping one frame per transition is imperceptible. Either spike is not.
       */
      const el = fieldRef.current;
      const lockedNow =
        typeof document !== 'undefined' && el !== null && document.pointerLockElement === el;
      const delta = lockedNow !== s.locked
        ? 0
        : lockedNow
          // Locked: clientX is frozen, so movementX is the only signal.
          ? e.movementX
          // Unlocked: clientX deltas are exact and free of the platform's
          // raw-input scaling, so prefer them.
          : Number.isFinite(s.lastX) ? e.clientX - s.lastX : 0;
      s.locked = lockedNow;
      s.lastX = e.clientX;
      // Relative: the scrub state carries the DELTA from the press, unbounded
      // here — each underlying value clamps itself when the caller applies it.
      s.state = relative
        ? advanceScrub(s.state, delta, step, e)
        : advanceScrub(s.state, delta, step, e, min, max);
      if (relative) onRelative(s.state.value, true);
      else commitScrub(s.state.value);
    },
    [step, min, max, commitScrub, onScrubStart, relative, onRelative],
  );

  const onPointerUp = useCallback(() => {
    detachWindowListeners();
    releaseLock();
    const s = scrub.current;
    if (s.moved) {
      setDragging(false);
      // Ensure the final value is committed through onChange (not just onScrub).
      if (relative) onRelative(s.state.value, true);
      else onChange(clamp(s.state.value, min, max));
      onScrubEnd?.();
    } else {
      // No drag → treat as a click: enter edit mode.
      beginEdit();
    }
  }, [detachWindowListeners, onChange, min, max, beginEdit, onScrubEnd, releaseLock, relative, onRelative]);

  // Refreshed every render so the stable listeners always call TODAY's
  // handlers, with today's `onChange`, `step`, `min` and `max`.
  latest.current.move = onPointerMove;
  latest.current.up = onPointerUp;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || editing) return;
    if (e.button !== 0) return;
    // Stop the browser starting a text selection or a native drag under the
    // gesture: with the pointer locked a live selection keeps growing
    // invisibly and swallows the pointerup.
    e.preventDefault();
    scrub.current = {
      startX: e.clientX,
      lastX: e.clientX,
      moved: false,
      locked: false,
      active: true,
      // Relative: the scrub measures a delta, so it starts from zero.
      state: beginScrub(relative ? 0 : value, e),
    };
    window.addEventListener('pointermove', windowHandlers.current.move);
    window.addEventListener('pointerup', windowHandlers.current.up);
  };

  // Esc, a tab switch or a window blur drops the lock out from under an
  // in-flight scrub. No listener is needed to cope: `onPointerMove` re-reads
  // `document.pointerLockElement` every frame, so it sees the loss on the next
  // move, discards that frame's stale delta and resumes cursor-bound tracking.

  // Unmount only. Listing the handlers here (which is what this used to do) is
  // what killed a drag on its first re-render — see `windowHandlers` above.
  useEffect(() => detachWindowListeners, [detachWindowListeners]);

  // Release the lock if the field unmounts mid-scrub (panel closed, layer
  // deleted) — otherwise the cursor stays hidden with nothing listening.
  useEffect(() => releaseLock, [releaseLock]);

  return (
    <div
      ref={fieldRef}
      className={cn(
        styles.field,
        dragging && styles.dragging,
        editing && styles.editing,
        invalid && styles.invalid,
        disabled && styles.disabled,
        mixed && styles.mixed,
      )}
      onPointerDown={onPointerDown}
      onKeyDown={onFieldKeyDown}
      data-numeric
      data-mixed={mixed || undefined}
      title={mixed ? 'Mixed values — drag to offset all, type to set all (+10, *2 apply per layer)' : undefined}
      {...(!editing
        ? {
            role: 'spinbutton',
            tabIndex: disabled ? -1 : 0,
            'aria-label': ariaLabel,
            'aria-valuenow': !mixed && Number.isFinite(value) ? value : undefined,
            'aria-valuemin': Number.isFinite(min) ? min : undefined,
            'aria-valuemax': Number.isFinite(max) ? max : undefined,
            'aria-valuetext': mixed ? 'Mixed' : `${format(value, precision)}${unit ?? ''}`,
            'aria-disabled': disabled || undefined,
          }
        : {})}
    >
      {editing ? (
        <input
          ref={inputRef}
          className={styles.input}
          value={draft}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            if (invalid) setInvalid(false);
          }}
          onKeyDown={onInputKeyDown}
          onBlur={commitEdit}
          aria-label={ariaLabel}
        />
      ) : (
        <span className={styles.value} aria-label={ariaLabel}>
          {mixed ? '—' : format(value, precision)}
          {unit && !mixed ? <span className={styles.unit}>{unit}</span> : null}
        </span>
      )}
    </div>
  );
}

export default ValueField;
