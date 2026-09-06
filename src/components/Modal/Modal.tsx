/**
 * Modal — dialog built on Radix Dialog (robust focus-trap, scroll-lock,
 * Escape, and accessible labelling). The public API is unchanged, so the
 * ModalHost and every `openModal(...)` caller keep working:
 *
 *   <Modal open onClose={...} title="Settings" size="md" footer={...}>
 *...content...
 *   </Modal>
 *
 * ── Two variants ────────────────────────────────────────────────────────
 * `blocking` (default) is the classic dialog: scrim, focus trap, the app
 * behind it waits. `floating` is a TOOL WINDOW: no scrim, the app stays live
 * (Radix `modal={false}` — no focus trap, no scroll lock, no aria-hidden on the
 * rest of the page), it drags by its header, optionally resizes by a corner
 * grip, and its frame is remembered per `id` in the preference store so the
 * Smoother comes back where you parked it. Escape still closes it.
 *
 * ── Enter confirms ──────────────────────────────────────────────────────
 * Enter anywhere in a dialog runs its primary action, unless the focused
 * element owns Enter itself — see `enterToConfirm.ts` for the rule. The action
 * comes from, in order: the `primaryAction` prop; whatever the body registered
 * with `useDialogPrimaryAction` (a body that holds the form state registers its
 * own confirm); the button `DialogFooter` marked as primary. Ctrl/Cmd+Enter
 * confirms from anywhere, textareas included.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@utils/cn';
import { IconButton } from '@components/IconButton';
import { Icon } from '@components/Icon';
import {
  clampGeometry,
  centredGeometry,
  currentViewport,
  readDialogGeometry,
  writeDialogGeometry,
  MIN_DIALOG_HEIGHT,
  MIN_DIALOG_WIDTH,
  type DialogGeometry,
} from './dialogGeometry';
import { enterShouldConfirm, findPrimaryButton } from './enterToConfirm';
import styles from './Modal.module.css';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';
export type ModalVariant = 'blocking' | 'floating';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Stable identity. Required for a floating dialog to remember its frame —
   * without one it opens centred every time, which is still correct.
   */
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  size?: ModalSize;
  variant?: ModalVariant;
  /** Floating only: show a resize grip and remember the size as well. */
  resizable?: boolean;
  /** Hide the header (used for fully custom layouts). */
  hideHeader?: boolean;
  hideCloseButton?: boolean;
  /** Disable Escape-to-close. */
  persistent?: boolean;
  /** Disable scrim click. */
  persistentScrim?: boolean;
  footer?: ReactNode;
  /** What Enter does. See the module comment for the fallbacks. */
  primaryAction?: () => void;
  /**
   * The dialog is below another in the stack: it is rendered but not
   * interactive (`inert`), so only the top of the stack takes input.
   */
  inert?: boolean;
  children: ReactNode;
  className?: string;
}

const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/** The CSS widths per size, for centring a floating dialog before it has a frame. */
const SIZE_WIDTH: Record<ModalSize, number> = { sm: 420, md: 540, lg: 860, xl: 1000, fullscreen: 1000 };
/** A guess at height for first-open centring; the real height is measured after mount. */
const SIZE_HEIGHT: Record<ModalSize, number> = { sm: 320, md: 420, lg: 560, xl: 640, fullscreen: 640 };

// ── Primary-action registration ────────────────────────────────────────

interface DialogActions {
  setPrimary(fn: (() => void) | null): void;
}

const DialogActionsContext = createContext<DialogActions | null>(null);

/**
 * Register the dialog's primary action from inside its body.
 *
 * For dialogs whose confirm needs body state (the Smoother's tolerance, a
 * prompt's text): the body calls this with its confirm handler and Enter runs
 * it. Pass `null`/`undefined` to unregister (e.g. while the form is invalid).
 */
export function useDialogPrimaryAction(fn: (() => void) | null | undefined): void {
  const ctx = useContext(DialogActionsContext);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ctx) return;
    ctx.setPrimary(() => ref.current?.());
    return () => ctx.setPrimary(null);
  }, [ctx]);
}

// ── Component ──────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  id,
  title,
  description,
  size = 'md',
  variant = 'blocking',
  resizable = false,
  hideHeader = false,
  hideCloseButton = false,
  persistent = false,
  persistentScrim = false,
  footer,
  primaryAction,
  inert = false,
  children,
  className,
}: ModalProps): JSX.Element {
  const floating = variant === 'floating';
  const descId = useId();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const registeredPrimary = useRef<(() => void) | null>(null);
  const actions = useRef<DialogActions>({
    setPrimary: (fn) => {
      registeredPrimary.current = fn;
    },
  });

  // `inert` is applied imperatively: React 18's types do not know the
  // attribute, and a boolean would serialize as "false", which is still inert.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (inert) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [inert]);

  const runPrimary = useCallback((): boolean => {
    if (primaryAction) {
      primaryAction();
      return true;
    }
    if (registeredPrimary.current) {
      registeredPrimary.current();
      return true;
    }
    const button = findPrimaryButton(contentRef.current);
    if (button) {
      button.click();
      return true;
    }
    return false;
  }, [primaryAction]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.altKey) return;
    const force = e.ctrlKey || e.metaKey;
    if (!force && (e.shiftKey || !enterShouldConfirm(e.target))) return;
    if (runPrimary()) e.preventDefault();
  };

  // ── Floating geometry ─────────────────────────────────────────────
  const [geom, setGeom] = useState<DialogGeometry | null>(() => {
    if (!floating) return null;
    const vp = currentViewport();
    return (id ? readDialogGeometry(id, vp) : null) ?? centredGeometry(SIZE_WIDTH[size], SIZE_HEIGHT[size], vp);
  });
  const geomRef = useRef(geom);
  geomRef.current = geom;

  // Measure the real height once mounted (a non-resizable floating dialog is
  // as tall as its content) and re-centre vertically on that first frame.
  const measured = useRef(false);
  useLayoutEffect(() => {
    if (!floating || !open || measured.current || !contentRef.current || !geom) return;
    measured.current = true;
    const rect = contentRef.current.getBoundingClientRect();
    const hasMemory = id ? readDialogGeometry(id) !== null : false;
    if (hasMemory) return;
    const vp = currentViewport();
    setGeom(centredGeometry(rect.width, rect.height, vp));
  }, [floating, open, geom, id]);

  // Keep the frame on screen when the window shrinks.
  useEffect(() => {
    if (!floating) return;
    const onResize = (): void => {
      const g = geomRef.current;
      if (g) setGeom(clampGeometry(g, currentViewport()));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [floating]);

  const persist = useCallback(
    (g: DialogGeometry) => {
      if (id) writeDialogGeometry(id, g);
    },
    [id],
  );

  /** One pointer gesture: drag (move) or resize (grow), clamped live. */
  const beginGesture = (e: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize'): void => {
    if (e.button !== 0 || !geomRef.current) return;
    // A click on a control inside the header (the close button) is not a drag.
    if (mode === 'move' && (e.target as HTMLElement).closest('button, input, select, a')) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const origin = geomRef.current;
    const el = contentRef.current;
    const rect = el?.getBoundingClientRect();
    // Height is measured, not stored, for a non-resizable dialog.
    const base: DialogGeometry = { ...origin, w: rect?.width ?? origin.w, h: rect?.height ?? origin.h };
    let last = base;
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      const next: DialogGeometry =
        mode === 'move'
          ? { ...base, x: base.x + dx, y: base.y + dy }
          : {
              ...base,
              w: Math.max(MIN_DIALOG_WIDTH, base.w + dx),
              h: Math.max(MIN_DIALOG_HEIGHT, base.h + dy),
            };
      last = clampGeometry(next, currentViewport());
      setGeom(last);
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      persist(last);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Measured geometry is inherently dynamic; this is the one inline style the
  // component carries, and it holds numbers rather than design decisions.
  const floatingStyle: CSSProperties | undefined =
    floating && geom
      ? {
          left: geom.x,
          top: geom.y,
          width: geom.w,
          ...(resizable ? { height: geom.h } : {}),
        }
      : undefined;

  const content = (
    <Dialog.Content
      ref={contentRef}
      className={cn(styles.dialog, styles[size], floating && styles.floating, className)}
      style={floatingStyle}
      data-variant={variant}
      onKeyDown={onKeyDown}
      onEscapeKeyDown={(e) => persistent && e.preventDefault()}
      // A floating dialog is non-blocking by definition: a click on the app
      // behind it is a click on the app, never a dismissal.
      onPointerDownOutside={(e) => (persistentScrim || floating) && e.preventDefault()}
      onInteractOutside={(e) => (persistentScrim || floating) && e.preventDefault()}
      onFocusOutside={(e) => floating && e.preventDefault()}
      aria-describedby={description ? descId : undefined}
    >
      {/* Radix requires a Title for a11y; hide it visually when unused. */}
      {hideHeader || !title ? (
        <Dialog.Title style={SR_ONLY}>{title ?? 'Dialog'}</Dialog.Title>
      ) : null}

      {!hideHeader ? (
        <header
          className={cn(styles.header, floating && styles.dragHandle)}
          onPointerDown={floating ? (e) => beginGesture(e, 'move') : undefined}
        >
          <div className={styles.headerText}>
            {title ? <Dialog.Title className={styles.title}>{title}</Dialog.Title> : null}
            {description ? (
              <Dialog.Description id={descId} className={styles.description}>
                {description}
              </Dialog.Description>
            ) : null}
          </div>
          {!hideCloseButton ? (
            <Dialog.Close asChild>
              <IconButton aria-label="Close" size="sm">
                <Icon name="close" size="sm" />
              </IconButton>
            </Dialog.Close>
          ) : null}
        </header>
      ) : null}

      <div className={styles.body}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}

      {floating && resizable ? (
        <div
          className={styles.resizeGrip}
          aria-hidden
          onPointerDown={(e) => beginGesture(e, 'resize')}
        />
      ) : null}
    </Dialog.Content>
  );

  return (
    <DialogActionsContext.Provider value={actions.current}>
      <Dialog.Root
        open={open}
        modal={!floating}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <Dialog.Portal>
          {floating ? content : <Dialog.Overlay className={styles.scrim}>{content}</Dialog.Overlay>}
        </Dialog.Portal>
      </Dialog.Root>
    </DialogActionsContext.Provider>
  );
}
