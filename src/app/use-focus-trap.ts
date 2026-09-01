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
  // ★★★ THE PUSH AND THE LISTENER ARE GATED DIFFERENTLY, AND NOTHING
  // RECONCILES THEM. This effect returns on `!active` alone; the keydown effect
  // below returns on `!active || !ref.current`. A consumer whose container ref
  // is NOT populated in the same commit that flips `active` — a lazy/Suspense
  // boundary, or a ref forwarded through a child that mounts a tick later —
  // therefore registers a topmost `"modal"` entry with NO keydown listener
  // behind it: it stands every other trap down (`isTopmostOfKind` goes false
  // for them) and traps nothing itself. Permanently, for that open — refs are
  // not reactive, so the listener effect never re-runs when `ref.current`
  // fills in.
  // ★ LATENT, not live: all three of today's consumers (`tour-overlay`,
  // `inline-ai-edit-popover`, and the drawer in `modern-shell`) attach their
  // ref in the same commit that flips `active`.
  // ★ Do NOT "fix" it by pushing from the listener effect instead — that puts
  // `onEscape` back in this effect's deps and reintroduces the
  // re-push-to-top hazard that bit `modal.tsx` twice.
  // ★ Same asymmetry `docs/AGENTS/ui-shell.md` already records for
  // `PopoverPanel` (push on `open`, cycle on `rendered`).
  //
  // ★ And the deps below are `[active, hasEscape]`, so a `hasEscape` FLIP pops
  // and re-pushes — moving this token to the TOP of the stack, the very hazard
  // the note three lines above warns about. Benign today: no consumer swaps
  // `onEscape` between defined and undefined.
  //
  // ★★ SURVIVING MUTANT, recorded rather than papered over: the
  // `items.length === 0` bail in the Tab branch below is pinned by NOTHING.
  // Measured 2026-09-01 — neutralising it left ALL FIVE files that exercise
  // this hook green, 0 failed / 54 passed (`use-focus-trap`, `tour-overlay`,
  // `dismissal-integration`, `inline-ai-edit-popover`, `modern-shell`; the
  // full suite was not run, so read "nothing" as scoped to those five).
  // Nothing exercises a trap over a container with no focusables, and no
  // consumer can reach that state today — the tour card renders ≥2 Buttons
  // every step, `inline-ai-edit-popover` renders its ✕ IconButton
  // unconditionally, and the drawer always renders `SidebarNav`. It is also
  // ASYMMETRIC with `modal.tsx`, which in the same state preventDefaults and
  // parks focus on its dialog root. Judgement with no test behind it; left
  // that way deliberately rather than pinning a hole nothing can reach.
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
      // ★★ Honour `e.defaultPrevented`, mirroring the identical bail in
      // `popover-panel.tsx`: a consumer that handles Tab ITSELF — closing and
      // returning focus to its trigger, as `sidebar-nav.tsx`'s `onMenuKeyDown`
      // does — must not have that overridden from here. This trap needs the
      // term MORE than `popover-panel.tsx` does, because the membership term
      // below makes it act on every state that is not an interior tab stop,
      // where a containment term would simply have declined.
      // ★ MEASURED 2026-09-01, not assumed: a React `onKeyDown` runs BEFORE a
      // `document`-registered listener like this one, and that listener then
      // sees `defaultPrevented === true`. Probed with a React button whose
      // `onKeyDown` calls `preventDefault` alongside a `document` listener,
      // both pushing to one array → `["react","document:true"]`. The usual
      // explanation — React delegating on a root container BELOW `document`,
      // which `popover-panel.tsx` states — is consistent with that order but
      // is not proved by it. What the probe does NOT cover: a rival NATIVE
      // listener on `document` itself, which is ordered by registration and
      // could lose the race.
      if (e.key !== "Tab" || e.defaultPrevented) return;
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
      // `first`. Measured 2026-09-01: none of the THREE consumers reaches it.
      // `inline-ai-edit-popover` renders no `tabIndex` at all; the only
      // `tabIndex={-1}` controls under the drawer are `CollapsedNavFlyout`'s
      // menuitems — which `renderSidebar(false, …)` never renders there, and
      // which a `PopoverPanel` portals OUT of the container regardless, so
      // containment would already have treated them as outside; and
      // `tour-overlay`'s single `tabIndex={-1}` is the CARD, i.e. the trap's
      // own CONTAINER, which is the §8 case stated above and not a descendant
      // at all. ★ An earlier revision said "neither consumer", counting two —
      // it was written before `tour-overlay` adopted this hook on the same
      // branch, and was already stale when it landed.
      // ★★ RE-MEASURE REPO-WIDE, NOT PER FILE, before adding a fourth consumer.
      // A two-file grep is narrower than the claim: the drawer's real surface
      // is `Sidebar` PLUS the `footer` slot, which arrives as a PROP, and
      // `modern-shell.tsx`'s own comment says no import-closure check over
      // `sidebar.tsx` can see what lands there. What matters is not the
      // attribute but whether anything FOCUSES such a node, so enumerate the
      // sites and then check each for a `.focus(`:
      //   grep -rnE 'tabIndex=\{.*-1' src/app --include=*.tsx | grep -v '\.test\.'
      // ★★★ THE OBVIOUS LITERAL PATTERN FINDS NOT ONE OF THEM, and this
      // comment shipped handing the reader exactly that. `tabIndex={[-]1}`
      // matches ZERO roving-tabindex widgets, because every one of them spells
      // it CONDITIONALLY (`tabIndex={cond ? 0 : -1}`), so the command could not
      // support the claim it was attached to.
      // ★★ The `.*` above is load-bearing and a `[^}]*` variant is NOT a safe
      // tightening: measured 2026-09-01, `[^}]*` returns 15 files where `.*`
      // returns 16, and the one it drops is a genuine roving widget whose
      // expression carries a template literal — so there is a `}` before the
      // `-1`. That is a property of JSX, not of one file, so any pattern that
      // refuses to cross a brace will keep losing this class.
      // ★★★ AND THE ENUMERATION HAS A FLOOR NO ATTRIBUTE GREP CAN LIFT: a
      // value threaded in as a PROP (`tabIndex={tabIndex}`) is invisible to
      // every pattern over this attribute, and one shared button primitive
      // renders the whole rich-text toolbar that way. Treat the hits as a
      // lower bound and follow the props.
      // ★★ IT ALSO COUNTS ITS OWN DOCUMENTATION — 8 of its 28 hits on
      // 2026-09-01 were PROSE, not markup. This file is `.ts` and the pattern
      // is `.tsx`-scoped, which is the only reason THIS comment does not
      // inflate it. Read the hits, never the count.
      // ★★★ AND DO NOT WRITE THE HIT LIST DOWN HERE. A first cut of this
      // comment named four files as the ones ever focused programmatically;
      // re-running the command refuted TWO of them within the hour —
      // `undo-control` carries `tabIndex={0}`, not `-1`, so it is not a hit at
      // all, and `chat-panel` is a hit that the list omitted. An enumeration
      // pasted beside its own command reads as though the command produced it.
      // Run it. Then, for each hit, ask the only question that matters: does
      // anything `.focus()` that node, and is the node a descendant of a trap
      // container? None of today's three consumers holds one.
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
