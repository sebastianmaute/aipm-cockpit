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
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  clampToViewport,
  loadGeom,
  serializeGeom,
  type ModalGeom,
} from "./modal-geometry";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { useMediaQuery } from "./use-media-query";
import { SIDEBAR_NARROW_QUERY } from "./use-sidebar-collapsed";

// localStorage prefix for per-modal persisted geometry (only when a caller
// opts in with `persistKey`).
const GEOM_KEY_PREFIX = "lop-app:modal-geom:";

// Stack of currently-open modal tokens (mount order). Only the TOPMOST modal
// responds to Escape / Tab so a nested modal (e.g. the setup wizard opened from
// inside the create-project modal) doesn't double-fire — one Escape would
// otherwise close BOTH and discard the underlying draft.
const modalStack: symbol[] = [];

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
  /** Override the backdrop classes (e.g. `bg-black/40` for the absence/shift
   *  modals which historically used a darker overlay). Default matches the
   *  task / Jira / due-dates modals. */
  backdropClassName?: string;
  /** Vertical alignment of the panel within the viewport. */
  align?: "start" | "center";
  /** Override the z-index. Default 40 matches the existing app shell. */
  zIndex?: number;
  /** Optional element to focus when the modal opens. Falls back to the
   *  dialog root (so the next Tab walks naturally into the first input). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Language for the drag-handle / reset-size accessible labels. Defaults to
   *  en-US so plain callers (which pass a pre-translated `ariaLabel`) don't
   *  have to thread it. */
  lang?: Lang;
  /** Opt a modal into draggable + resizable chrome. When set (and the viewport
   *  is not narrow), the panel gets a move handle + reset button + resize grip,
   *  and its geometry persists to `lop-app:modal-geom:<persistKey>`. Modals
   *  without a persistKey stay centered with NO drag chrome (preserves the
   *  focus-trap contract + keyboard operability of the simple dialogs). */
  persistKey?: string;
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
  backdropClassName = "bg-AIPM-dark-blue/40",
  align = "start",
  zIndex = 40,
  initialFocusRef,
  lang = "en-US",
  persistKey,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
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
      const target =
        initialFocusRef?.current ?? dialogRef.current ?? null;
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

  // --- Draggable / resizable geometry (opt-in via persistKey) -------------
  // Below the app's narrow breakpoint we keep the modal centered/full-screen
  // with drag+resize DISABLED and never persist.
  const isNarrow = useMediaQuery(SIDEBAR_NARROW_QUERY);

  const [geom, setGeomState] = useState<ModalGeom | null>(() => {
    if (!persistKey || typeof window === "undefined") return null;
    try {
      const loaded = loadGeom(
        window.localStorage.getItem(GEOM_KEY_PREFIX + persistKey),
      );
      if (!loaded) return null;
      return clampToViewport(loaded, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
    } catch {
      return null;
    }
  });
  // Mirror geom in a ref so a pointerup at the end of a gesture persists the
  // latest value without waiting for a state flush.
  const geomRef = useRef<ModalGeom | null>(geom);
  const setGeom = useCallback((g: ModalGeom | null) => {
    geomRef.current = g;
    setGeomState(g);
  }, []);

  const draggable = !!persistKey && !isNarrow;

  const persistGeom = useCallback(
    (g: ModalGeom | null) => {
      if (!persistKey || isNarrow || typeof window === "undefined") return;
      try {
        if (g) {
          window.localStorage.setItem(
            GEOM_KEY_PREFIX + persistKey,
            serializeGeom(g),
          );
        } else {
          window.localStorage.removeItem(GEOM_KEY_PREFIX + persistKey);
        }
      } catch {
        /* ignore quota / disabled storage */
      }
    },
    [persistKey, isNarrow],
  );

  const resetGeom = useCallback(() => {
    setGeom(null);
    if (persistKey && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(GEOM_KEY_PREFIX + persistKey);
      } catch {
        /* ignore */
      }
    }
  }, [persistKey, setGeom]);

  // Base geometry for a gesture: the live geom if positioned, else the panel's
  // current on-screen rect (so the first drag/resize starts from the centered
  // position).
  const baseGeom = useCallback((): ModalGeom => {
    if (geomRef.current) return geomRef.current;
    const r = panelRef.current?.getBoundingClientRect();
    return {
      x: r?.left ?? 0,
      y: r?.top ?? 0,
      w: r?.width ?? 0,
      h: r?.height ?? 0,
    };
  }, []);

  const runGesture = useCallback(
    (
      e: ReactPointerEvent,
      compute: (base: ModalGeom, dx: number, dy: number) => ModalGeom,
    ) => {
      if (!draggable || typeof window === "undefined") return;
      e.preventDefault();
      e.stopPropagation();
      const base = baseGeom();
      const startX = e.clientX;
      const startY = e.clientY;
      const move = (ev: PointerEvent) => {
        setGeom(
          clampToViewport(compute(base, ev.clientX - startX, ev.clientY - startY), {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        persistGeom(geomRef.current);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
    },
    [draggable, baseGeom, setGeom, persistGeom],
  );

  const beginDrag = useCallback(
    (e: ReactPointerEvent) =>
      runGesture(e, (base, dx, dy) => ({
        x: base.x + dx,
        y: base.y + dy,
        w: base.w,
        h: base.h,
      })),
    [runGesture],
  );

  const beginResize = useCallback(
    (e: ReactPointerEvent) =>
      runGesture(e, (base, dx, dy) => ({
        x: base.x,
        y: base.y,
        w: base.w + dx,
        h: base.h + dy,
      })),
    [runGesture],
  );

  if (!open) return null;

  // When narrow or not opted-in, ignore any stored geometry and stay centered.
  const activeGeom = draggable ? geom : null;

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
      } justify-center p-4 sm:p-10 ${backdropClassName}`}
      style={{ zIndex }}
    >
      {draggable ? (
        <div
          ref={panelRef}
          className="relative flex max-h-full flex-col"
          style={
            activeGeom
              ? {
                  position: "fixed",
                  left: activeGeom.x,
                  top: activeGeom.y,
                  width: activeGeom.w,
                  height: activeGeom.h,
                }
              : undefined
          }
        >
          <div className="flex items-center justify-between gap-2 rounded-t-xl border border-b-0 border-line bg-surface px-2 py-1">
            <button
              type="button"
              aria-label={t(lang, "modalMove")}
              onPointerDown={beginDrag}
              className={`cursor-move touch-none rounded p-1 text-muted-foreground hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
                className="h-4 w-4"
              >
                <circle cx="7" cy="5" r="1.4" />
                <circle cx="13" cy="5" r="1.4" />
                <circle cx="7" cy="10" r="1.4" />
                <circle cx="13" cy="10" r="1.4" />
                <circle cx="7" cy="15" r="1.4" />
                <circle cx="13" cy="15" r="1.4" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={t(lang, "modalResetSize")}
              onClick={resetGeom}
              className={`rounded p-1 text-muted-foreground hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
                className="h-4 w-4"
              >
                <path d="M10 3a7 7 0 105.66 2.87V3.5a.75.75 0 00-1.5 0v1.06A7 7 0 0010 3zm0 1.5a5.5 5.5 0 11-4.2 1.95l1.02 1.02a.75.75 0 001.06-1.06L6.1 5.53A5.47 5.47 0 0110 4.5z" />
              </svg>
            </button>
          </div>
          {children}
          <div
            aria-hidden="true"
            tabIndex={-1}
            onPointerDown={beginResize}
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
          />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
