"use client";

// Shared modal shell. Owns the cross-cutting a11y concerns so the four
// concrete modals in this app don't each re-implement them inconsistently:
//
//   • role="dialog" + aria-modal + aria-label/aria-labelledby
//   • Document-level Escape handler (fires regardless of focus location;
//     replaces three different ad-hoc implementations).
//   • Focus trap — Tab and Shift+Tab cycle within the dialog. Without this,
//     Tab can move focus to the disabled underlying UI (WCAG 2.4.3).
//   • Initial focus on open — `initialFocusRef` if supplied, else the
//     dialog root (so the first Tab lands on the first focusable child).
//   • Focus restore on close to whichever element had focus before opening.
//   • Backdrop click closes (via `e.target === e.currentTarget` so clicks
//     inside the panel never bubble to dismissal).
//
// What it intentionally does NOT own:
//   • The panel itself. Callers render their own panel as `children` and
//     keep full control of width/height, resizability (useResizable / CSS
//     `resize`), scroll behavior, and internal layout.
//   • i18n. The component takes a plain string label so it never has to
//     reach into the lazy-loaded German dictionary.
//
// Migration note: the four migrated modals previously rolled their own
// Escape handling (three different implementations) and none of them
// trapped focus or restored it on close — this component fixes all four.

import {
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { type Lang } from "./i18n";

// Stack of currently-open modal tokens (mount order). Only the TOPMOST modal
// responds to Escape / Tab so a nested modal (e.g. the setup wizard opened from
// inside the create-project modal) doesn't double-fire — one Escape would
// otherwise close BOTH and discard the underlying draft.
const modalStack: symbol[] = [];

/** Canonical modal backdrop tint — the AIPM dark-blue scrim every modal shares.
 *  `Modal` defaults to it; hand-rolled overlays (popovers that can't use `Modal`)
 *  import it so the whole app dims consistently. Emphasis tiers (confirm/empty)
 *  intentionally use a stronger variant and are not folded onto this. */
export const MODAL_BACKDROP_CLASS = "bg-ui-dark-blue/40";

// Standard "focusable element" selector. Excludes negative-tabindex (which
// the dialog root itself uses) and disabled inputs/buttons/etc.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

interface BaseProps {
  /** When false the modal renders nothing and listeners aren't attached. */
  open: boolean;
  /** Fired by Escape, backdrop click, and (if the caller wires it) the X button. */
  onClose: () => void;
  /** Override the backdrop classes. Default is the canonical AIPM dark-blue
   *  tint shared by every modal; callers should almost never override it
   *  (an off-palette override was removed in the DS defect sweep). */
  backdropClassName?: string;
  /** Vertical alignment of the panel within the viewport. */
  align?: "start" | "center";
  /** Let the backdrop scroll when a tall panel exceeds the viewport (used by
   *  start-aligned edit modals whose panel can be taller than the screen).
   *  Default off so centered modals are unchanged. */
  backdropScroll?: boolean;
  /** Override the z-index. Default 40 matches the existing app shell. */
  zIndex?: number;
  /** Optional element to focus when the modal opens. Falls back to the
   *  dialog root (so the next Tab walks naturally into the first input). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Accepted but ignored — the modal has no i18n chrome of its own. Kept only
   *  so callers that thread a `lang` through their dialog props still typecheck;
   *  the panel + all labels are rendered by the caller's children. */
  lang?: Lang;
  children: ReactNode;
}

// Exactly one of aria-label / aria-labelledby is required. Express that in
// the type so callers can't accidentally render a label-less dialog.
type ModalProps =
  | (BaseProps & { ariaLabel: string; ariaLabelledby?: never })
  | (BaseProps & { ariaLabel?: never; ariaLabelledby: string });

export function Modal({
  open,
  onClose,
  ariaLabel,
  ariaLabelledby,
  backdropClassName = MODAL_BACKDROP_CLASS,
  align = "start",
  backdropScroll = false,
  zIndex = 40,
  initialFocusRef,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const pressStartedOnBackdrop = useRef(false);
  // Stable per-instance token for the open-modal stack (topmost-only handling).
  const tokenRef = useRef<symbol>(Symbol("modal"));
  // Mirror onClose into a ref so the keydown effect can depend on [open] ALONE.
  // If it depended on [open, onClose], an unstable parent onClose identity would
  // re-run the effect and re-order the stack — making the wrong (parent) modal
  // topmost and misrouting Escape/Tab to it (closing a nested modal's parent).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Open-modal stack membership — keyed on [open] ONLY, so push/pop happens
  // exactly on mount-open / unmount-close. Stack order == mount order, so the
  // last-opened (nested) modal is always topmost.
  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    modalStack.push(token);
    return () => {
      const i = modalStack.lastIndexOf(token);
      if (i !== -1) modalStack.splice(i, 1);
    };
  }, [open]);

  // Focus management: save the previously-focused element, move focus into
  // the dialog after children mount, restore on close/unmount.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    // Defer one frame so deep children (e.g. lazy datalist options) have
    // committed before we look up focusables.
    const raf = requestAnimationFrame(() => {
      // Prefer an explicit target, then the first real focusable child, and
      // only fall back to the dialog root (which is tabIndex=-1 and carries no
      // focus ring) when the panel has no focusable content at all. Landing on
      // the root leaves a keyboard user with focus on the un-ringed backdrop
      // (WCAG 2.4.7); a real control is both visible-focus correct and the
      // natural start of the tab order.
      const root = dialogRef.current;
      const firstFocusable =
        root?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? null;
      const target = initialFocusRef?.current ?? firstFocusable ?? root ?? null;
      target?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      // Only restore if the previously-focused element is still in the
      // document — it may have been removed if the user navigated.
      if (
        previouslyFocused &&
        typeof document !== "undefined" &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
    // initialFocusRef is a ref; reading .current doesn't justify a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keyboard handling: Escape closes; Tab and Shift+Tab trap focus inside
  // the dialog. Attached to `document` so it fires regardless of where
  // focus currently sits (handles the case where the user has Tabbed all
  // the way out before realising they want to dismiss).
  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;

    function onKeyDown(e: KeyboardEvent) {
      // Only the topmost open modal handles keyboard — nested modals stack.
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const container = dialogRef.current;
      if (!container) return;
      // No visibility filter on purpose. A naive `offsetParent / getClientRects`
      // check fails under jsdom (no layout engine → every element looks
      // hidden), and in real usage modals only contain elements meant to be
      // focusable. The `:not([disabled])` parts of FOCUSABLE_SELECTOR
      // already handle the common "skip me" cases.
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) {
        // No focusable children — keep focus on the dialog root.
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // onClose is read via onCloseRef, so [open] is the complete dep set.
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      tabIndex={-1}
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressStartedOnBackdrop.current) onClose();
        pressStartedOnBackdrop.current = false;
      }}
      className={`fixed inset-0 flex ${
        align === "center" ? "items-center" : "items-start"
      } justify-center ${backdropScroll ? "overflow-y-auto " : ""}p-4 sm:p-10 ${backdropClassName}`}
      style={{ zIndex }}
    >
      {children}
    </div>
  );
}
