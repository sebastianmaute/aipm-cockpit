"use client";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useDismissable } from "./use-dismissable";

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
/** Gap between the anchor and the panel, on whichever axis they meet. */
const ANCHOR_GAP = 4;

/**
 * Where the panel sits relative to its anchor.
 * - `bottom-end` (default) — under the anchor, right edges aligned. Every
 *   toolbar/row popover uses this; it drives `right` + `top`/`bottom`.
 * - `right-start` — BESIDE the anchor, top edges aligned. For the collapsed
 *   sidebar rail, whose 64px-wide trigger has no room beneath it. Drives
 *   `left` + `top`.
 * ★★ The two are mutually exclusive edge sets, not variations of one — see the
 * clamp effect below, which branches on `pos.left !== undefined`.
 */
export type PopoverPlacement = "bottom-end" | "right-start";

export function PopoverPanel({
  open,
  anchorRef,
  onClose,
  className = "",
  placement = "bottom-end",
  role,
  ariaLabel,
  id,
  autoFocus = true,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Width/padding classes for the panel (e.g. "w-64 p-2"). */
  className?: string;
  placement?: PopoverPlacement;
  role?: "dialog" | "menu";
  ariaLabel?: string;
  /** For a trigger's aria-controls to reference (e.g. a ToolbarButton with
   *  stateKind="disclosure"). Omit when nothing points at this panel. */
  id?: string;
  /** Move focus to the first control on open (default true — correct for menus).
   *  Set false when the first control is destructive (e.g. a one-click "remove")
   *  so opening the panel can't land focus on it; focus then stays on the trigger,
   *  as it did before this panel was portaled. */
  autoFocus?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLSpanElement>(null);
  // Fixed-viewport coords; `right` right-aligns the panel to the anchor without
  // needing the panel width (so a `w-max` menu works too). `top` OR `bottom` is
  // set depending on whether the panel opens below or flips above the anchor.
  // null until measured.
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number } | null>(null);

  useEffect(() => {
    if (!open) return; // stale pos is harmless — the panel is gated on `open && pos`
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    if (placement === "right-start") {
      // Beside the anchor, top edges aligned. No flip: the only consumer is the
      // left-hand rail, where there is always more room to the right than to the
      // left, and the post-paint effect clamps both axes into the viewport.
      setPos({ left: r.right + ANCHOR_GAP, top: r.top });
    } else {
      const right = Math.max(VIEWPORT_MARGIN, window.innerWidth - r.right);
      const spaceBelow = window.innerHeight - r.bottom;
      // Flip ABOVE the anchor when there isn't room below — otherwise a fixed panel
      // low in the viewport paints off the fold, and the scroll-to-reveal would fire
      // the close-on-scroll listener below (making it unreachable).
      if (spaceBelow >= MIN_SPACE_BELOW || spaceBelow >= r.top) {
        setPos({ right, top: r.bottom + ANCHOR_GAP });
      } else {
        setPos({ right, bottom: window.innerHeight - r.top + ANCHOR_GAP });
      }
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
  }, [open, anchorRef, onClose, placement]);

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
    // `right-start` is positioned by its LEFT edge, so the clamp above (which
    // shrinks `right`) does not apply. Clamp the stored coordinates — NOT the
    // measured ones: min/max over a stored value cannot chase the panel across
    // the screen one paint at a time, which clamping `rect.left` would.
    // ★★ It TERMINATES, but it is not flatly idempotent and an earlier comment
    // here claimed it was. A `fixed` element with only `left` set is
    // shrink-to-fit within `viewportWidth - left`, so moving it leftward can
    // GROW `rect.width` and lower the next `Math.min`, giving a third pass.
    // `left` is monotone non-increasing and floored at `VIEWPORT_MARGIN`, so it
    // converges rather than oscillating — the cost of an extra pass is a re-run
    // of the autoFocus effect below, which re-focuses the first control.
    // Unreachable for today's consumers (a `min-w-44` menu anchored at x≈0–64).
    // ★ A panel LARGER than the viewport pins at the margin and simply
    // overflows: there is no `max-height`/`overflow` here, so a very tall
    // `right-start` menu would need one.
    if (pos.left !== undefined) {
      const left = Math.max(VIEWPORT_MARGIN, Math.min(pos.left, window.innerWidth - rect.width - VIEWPORT_MARGIN));
      const top = Math.max(VIEWPORT_MARGIN, Math.min(pos.top ?? VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN));
      if (left !== pos.left || top !== pos.top) setPos((p) => (p ? { ...p, left, top } : p));
      return;
    }
    if (pos.right !== undefined && rect.left < VIEWPORT_MARGIN - 0.5) {
      const maxRight = window.innerWidth - rect.width - VIEWPORT_MARGIN;
      const clampedRight = Math.max(VIEWPORT_MARGIN, maxRight);
      if (clampedRight !== pos.right) setPos((p) => (p ? { ...p, right: clampedRight } : p));
    }
  }, [open, pos]);

  // Focus the first TAB-STOP once mounted+positioned. preventScroll so the
  // programmatic focus can't scroll an ancestor and fire close-on-scroll.
  //
  // ★★ The `:not([tabindex="-1"])` on each arm is load-bearing, not tidying. A
  // roving-tabindex widget (`SegmentedControl`) renders every UNCHECKED radio at
  // -1, and the bare `input,button,[tabindex]` selector matched those — so the
  // field-visibility popover opened with focus on the FIRST radio ("Simple")
  // while a different one was checked ("Advanced"). The radios are real
  // `<button>`s carrying their own `onClick`, so Enter or Space on that
  // mis-focused radio SELECTED it, silently changing the tier; in custom mode
  // that discarded a hand-picked field set. AT announced the wrong state too.
  // ★ `querySelector` with a comma list returns the first match in DOCUMENT
  // order (not selector order), so this lands on the checked radio wherever it
  // sits among its siblings. Inert for every panel whose first control is
  // already tabbable — which is all of them but this one.
  // ★ When a roving group has NOTHING checked, its first radio IS the tab-stop
  // (SegmentedControl's `hasSelection` fallback), so focus correctly stays put.
  // ★★ The `??` fallback is NOT redundant: a panel whose every candidate is a
  // roving -1 (an all-`tabIndex={-1}` menu — `project-switcher.tsx` renders
  // exactly that shape today) matches the narrow selector NOWHERE, and a bare
  // `?.focus()` would then silently no-op. That is the one outcome this effect
  // must never produce: the panel is PORTALED, so with nothing focused the
  // user's next Tab leaves it entirely — the very failure `autoFocus` exists to
  // prevent. Programmatic `.focus()` works on a -1 element, so the fallback is
  // functional, not cosmetic.
  // ★★ `sidebar-nav.tsx`'s `CollapsedNavFlyout` IS that consumer as of the
  // portal migration — every one of its menuitems is `tabIndex={-1}`, so this
  // arm is the ONLY thing that lands focus in that flyout, and a test there
  // pins it. This comment previously said no consumer needed it, which is the
  // ordinary way a "here for the next one" note goes stale: the next one
  // arrived and nothing pointed back here. `project-switcher.tsx`, named above
  // as the example shape, hand-rolls with `usePopoverDismiss` and is NOT a
  // `PopoverPanel` consumer — it illustrates the shape, not a call site.
  useEffect(() => {
    if (autoFocus && open && pos) {
      const panel = panelRef.current;
      (
        panel?.querySelector<HTMLElement>(
          'input:not([tabindex="-1"]),button:not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])',
        ) ?? panel?.querySelector<HTMLElement>("input,button,[tabindex]")
      )?.focus({ preventScroll: true });
    }
  }, [autoFocus, open, pos]);

  // Escape goes through the dismissal stack — see `use-popover-dismiss` for
  // why this is no longer a capture-phase listener.
  useDismissable({ open, kind: "layer", onDismiss: onClose });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, anchorRef, onClose]);

  if (!open || !pos || typeof document === "undefined") return null;
  return createPortal(
    <span
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right }}
      className={`fixed z-[100] rounded-md border border-line bg-surface ${className}`}
    >
      {children}
    </span>,
    document.body,
  );
}
