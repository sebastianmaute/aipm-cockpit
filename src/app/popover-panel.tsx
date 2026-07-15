"use client";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * A floating popover panel that ESCAPES `overflow` clipping. Inline panels
 * positioned `absolute` inside a scroll container (e.g. the actions-panel
 * `overflow-auto` list) are clipped at the container edge — z-index can't escape
 * overflow. This portals the panel to `document.body` and positions it `fixed`
 * from the anchor's bounding rect (right-aligned to the anchor, mirroring the old
 * `right-0 top-full`). Precedent: `info-tooltip.tsx`.
 *
 * Owns: positioning, outside-click dismiss (covers BOTH the anchor and the
 * portaled panel — a single-ref check would treat clicks inside the portal as
 * outside), Escape, close-on-scroll/resize, and focus-first-control on open.
 * The caller owns `open`/`onClose` and the trigger button (with `anchorRef`).
 * `onClose` MUST be stable (useCallback) so the listeners aren't re-subscribed.
 */
const VIEWPORT_MARGIN = 8;
/** Min px below the anchor before we flip the panel ABOVE it (covers the date /
 *  escalate panels; avoids painting a fixed panel off the bottom of the fold). */
const MIN_SPACE_BELOW = 220;

export function PopoverPanel({
  open,
  anchorRef,
  onClose,
  className = "",
  role,
  ariaLabel,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Width/padding classes for the panel (e.g. "w-64 p-2"). */
  className?: string;
  role?: "dialog" | "menu";
  ariaLabel?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLSpanElement>(null);
  // Fixed-viewport coords; `right` right-aligns the panel to the anchor without
  // needing the panel width (so a `w-max` menu works too). `top` OR `bottom` is
  // set depending on whether the panel opens below or flips above the anchor.
  // null until measured.
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return; // stale pos is harmless — the panel is gated on `open && pos`
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const right = Math.max(VIEWPORT_MARGIN, window.innerWidth - r.right);
    const spaceBelow = window.innerHeight - r.bottom;
    // Flip ABOVE the anchor when there isn't room below — otherwise a fixed panel
    // low in the viewport paints off the fold, and the scroll-to-reveal would fire
    // the close-on-scroll listener below (making it unreachable).
    if (spaceBelow >= MIN_SPACE_BELOW || spaceBelow >= r.top) {
      setPos({ right, top: r.bottom + 4 });
    } else {
      setPos({ right, bottom: window.innerHeight - r.top + 4 });
    }
    // Close when an ANCESTOR scroller moves (the panel detaches from its anchor),
    // but NOT when the user scrolls a scrollable child INSIDE the panel (e.g. the
    // nested ResourcePicker's `overflow-y-auto` resource list in Assign/Escalate)
    // — a capture-phase window listener observes those inner scrolls too, and
    // closing on them would dismiss the popover mid-selection.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    // Close only on a WIDTH change (real layout resize). A height-only resize is
    // usually a mobile keyboard / native date-sheet opening over the input — closing
    // then would dismiss the panel the instant the user interacts with the field.
    const widthAtOpen = window.innerWidth;
    const onResize = () => { if (window.innerWidth !== widthAtOpen) onClose(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, anchorRef, onClose]);

  // Post-paint left-edge clamp. The panel is right-aligned via CSS `right`, which
  // alone can't stop the LEFT edge going off-screen on a narrow viewport with a
  // left-positioned anchor (e.g. a 375px drawer, a `w-72` panel whose left edge
  // lands negative). The width isn't known until the panel renders, so measure it
  // and shrink `right` so the left edge clears the margin. Measurement-driven
  // setState (allowed in an effect); self-terminating — once clamped the left edge
  // is >= margin so the guard is false and it won't re-run.
  useEffect(() => {
    if (!open || !pos) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    if (rect.left < VIEWPORT_MARGIN - 0.5) {
      const maxRight = window.innerWidth - rect.width - VIEWPORT_MARGIN;
      const clampedRight = Math.max(VIEWPORT_MARGIN, maxRight);
      if (clampedRight !== pos.right) setPos((p) => (p ? { ...p, right: clampedRight } : p));
    }
  }, [open, pos]);

  // Focus the first control once mounted+positioned. preventScroll so the
  // programmatic focus can't scroll an ancestor and fire close-on-scroll.
  useEffect(() => {
    if (open && pos) {
      panelRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus({ preventScroll: true });
    }
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !pos || typeof document === "undefined") return null;
  return createPortal(
    <span
      ref={panelRef}
      role={role}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
      className={`fixed z-[100] rounded-md border border-line bg-surface ${className}`}
    >
      {children}
    </span>,
    document.body,
  );
}
