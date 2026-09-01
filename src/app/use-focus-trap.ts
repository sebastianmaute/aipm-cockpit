"use client";
import { useEffect, useRef, type RefObject } from "react";
import {
  claimsEscape,
  isTopmostOfKind,
  popDismissal,
  pushDismissal,
} from "./dismissal-stack";
import { FOCUSABLE_SELECTOR } from "./focusables";

/**
 * Trap keyboard focus within `ref` while `active`. On activation it focuses
 * `initialFocusRef` if supplied (e.g. a text input that should receive the
 * caret), else the first focusable element; Tab/Shift+Tab wrap within the
 * container; Escape calls `onEscape`; on deactivation focus is restored to
 * whatever had it before.
 *
 * Used by the mobile sidebar drawer (#25) — the app's first real off-canvas
 * surface with a focus trap. `onEscape` must be stable (wrap in useCallback) or
 * the effect re-runs and re-focuses the first element each render.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const tokenRef = useRef<symbol>(Symbol("focus-trap"));
  // ★★ Always register while active, and DECLINE Escape rather than staying
  // out of the stack. An always-claiming entry that does nothing would swallow
  // the key and block every layer beneath — `inline-ai-edit-popover` passes no
  // handler, so that shape is live, not hypothetical — but the `claims`
  // predicate closes that without hiding the entry: `escapeOwner()` walks past
  // a declining entry to the one underneath. Being absent instead made the
  // trap invisible to `isTopmostOfKind`, so nothing could ask it to stand down
  // and the Tab branch below could not consult the stack at all (§318).
  // ★ Gate on a BOOLEAN, not on `onEscape` itself: an unstable handler
  // identity in the deps would re-push the token to the top of the stack on
  // every parent render — the bug that bit `modal.tsx` twice.
  const hasEscape = onEscape !== undefined;
  useEffect(() => {
    if (!active) return;
    const token = tokenRef.current;
    pushDismissal(token, "modal", () => hasEscape);
    return () => popDismissal(token);
  }, [active, hasEscape]);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    (initialFocusRef?.current ?? focusables()[0])?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // ★★ Escape is arbitrated by the dismissal stack, not by listener
        // phase: act only when this trap is the layer that owns the key. The
        // handler check is now redundant with the entry's own `claims`
        // predicate and is kept as the local, readable statement of the same
        // rule.
        if (!onEscape) return;
        if (!claimsEscape(e, tokenRef.current)) return;
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      // ★★ Tab consults the stack too, exactly as `modal.tsx` and
      // `popover-panel.tsx` do. `kind` MEANS "traps Tab", so a `"modal"` above
      // this one runs a trap of its own and deferring to it strands nobody;
      // a `"layer"` traps nothing and never takes Tab away, so containment is
      // still never waivable by a surface that cannot honour it (WCAG 2.4.3).
      if (!isTopmostOfKind(tokenRef.current, "modal")) return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      // ★★★ Focus that is on NONE of this trap's own focusables matches
      // NEITHER edge, so without this term the trap silently declines to act
      // and Tab walks out of the surface. Two live states reach it: focus
      // escaped to a portal, and focus sitting on a container node that
      // `FOCUSABLE_SELECTOR` excludes (a `tabIndex={-1}` card focused for AT)
      // — which is the state a surface is in on the FIRST keypress, the only
      // one that matters.
      // ★★★ THE TEST IS MEMBERSHIP, NOT CONTAINMENT, and the difference is the
      // whole of §8. `Node.contains` is REFLEXIVE, so the `tabIndex={-1}` card
      // `tour-overlay` focuses on open reports as INSIDE its own container and
      // a `!container.contains(activeEl)` term stays FALSE there — measured in
      // the real render, not reasoned: `activeElement === card` and
      // `card.contains(card)` are both true, and both arms declined with
      // `defaultPrevented === false`. Membership subsumes containment (`items`
      // are container DESCENDANTS, so anything outside is a non-member too)
      // and still leaves a non-edge focusable alone, which is the case the
      // trap must not touch.
      // ★★ `modal.tsx` carries the CONTAINMENT spelling and is NOT defective
      // for it — a different guard covers it there. It falls back to focusing
      // its dialog root ONLY when the panel has no focusable content at all
      // (`initialFocusRef ?? firstFocusable ?? root`), and its Tab branch
      // special-cases that same state a few lines earlier. So focus never
      // rests on its container while focusables exist. A first cut of this
      // comment said the hole was live on every modal in the app; it is not.
      // Check the guard before copying this term across.
      // ★ MEMBERSHIP IS THE WIDER TEST, and the set it adds over containment
      // is a focusable DESCENDANT that `FOCUSABLE_SELECTOR` excludes — where a
      // roving-tabindex widget parks focus. Inside a trap, Tab from such a
      // control should reach the next tab stop rather than be yanked to
      // `first`. Measured 2026-09-01: neither consumer reaches it.
      // `inline-ai-edit-popover` renders no `tabIndex` at all, and the only
      // `tabIndex={-1}` controls under the drawer are `CollapsedNavFlyout`'s
      // menuitems — which `renderSidebar(false, …)` never renders there, and
      // which a `PopoverPanel` portals OUT of the container regardless, so
      // containment would already have treated them as outside.
      // ★★ RE-MEASURE REPO-WIDE, NOT PER FILE, before adding a third consumer.
      // A two-file grep is narrower than the claim: the drawer's real surface
      // is `Sidebar` PLUS the `footer` slot, which arrives as a PROP, and
      // `modern-shell.tsx`'s own comment says no import-closure check over
      // `sidebar.tsx` can see what lands there. What matters is not the
      // attribute but whether anything FOCUSES such a node, so enumerate the
      // sites and then check each for a `.focus(`:
      //   grep -rn 'tabIndex={[-]1}' src/app --include=*.tsx | grep -v '\.test\.'
      // ★★★ THAT COMMAND COUNTS ITS OWN DOCUMENTATION — 8 of its 20 hits on
      // 2026-09-01 were PROSE, not markup, so a bare tally over-reports by
      // two thirds. This file is `.ts` and the pattern is `.tsx`-scoped, which
      // is the only reason THIS comment does not inflate it. Read the hits,
      // never the count.
      // ★★★ AND DO NOT WRITE THE HIT LIST DOWN HERE. A first cut of this
      // comment named four files as the ones ever focused programmatically;
      // re-running the command refuted TWO of them within the hour —
      // `undo-control` carries `tabIndex={0}`, not `-1`, so it is not a hit at
      // all, and `chat-panel` is a hit that the list omitted. An enumeration
      // pasted beside its own command reads as though the command produced it.
      // Run it. Then, for each hit, ask the only question that matters: does
      // anything `.focus()` that node, and is the node a descendant of a trap
      // container? Neither of today's two consumers holds one.
      const untrapped = activeEl === null || !items.includes(activeEl);
      if (e.shiftKey && (activeEl === first || untrapped)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || untrapped)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      prevFocus?.focus?.();
    };
  }, [active, ref, onEscape, initialFocusRef]);
}
