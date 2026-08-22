"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUturnLeftIcon, ArrowUturnRightIcon, ChevronDownIcon } from "../icons";
import { t, type Lang, type TranslationKey } from "../i18n";
import { FOCUS_RING, INTERACTIVE } from "../interaction-styles";
import { PopoverPanel } from "../popover-panel";
import { type UndoMeta } from "./undo-stack";

const BUTTON_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm text-muted-foreground hover:text-ui-dark-blue dark:hover:text-ui-light-grey";

// Same list `use-focus-trap.ts` uses. Kept local rather than exported from
// there: that module owns a trap, not a focus-order utility, and widening its
// API for one caller is the parameterise-a-working-thing move this repo avoids.
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The element a Tab from `root` would have reached — the first focusable in
 * DOCUMENT order that FOLLOWS `root` and is not inside it.
 *
 * ★ It has to be captured while `root` is still in the tree. Once the last undo
 *   entry is reverted the whole control is gone, and with it every anchor a
 *   "where should focus go" question could be asked from.
 * ★ `querySelectorAll` returns document order, so the first FOLLOWING match is
 *   the right one; `compareDocumentPosition` is what makes "after" precise
 *   across the portal (`PopoverPanel` mounts at the end of <body>, i.e. after us).
 */
function nextFocusableAfter(root: HTMLElement): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))) {
    if (root.contains(el)) continue;
    if (root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) return el;
  }
  return null;
}

/**
 * A top-bar undo/redo control: the action button plus an Excel-style caret that
 * opens the MULTI-STEP history. The action button still performs exactly ONE
 * undo/redo; the history lets the user revert through a chosen entry in one
 * commit. The caret opens a `PopoverPanel` (portaled, escapes top-bar clipping)
 * which keeps `role="dialog"` — the listbox is its CONTENT, so the panel's
 * `role` union is deliberately not widened for this one caller. Self-hides on an
 * empty stack. Wired into BOTH header mounts; in the top bar → axe-scanned every
 * view, so the action button, the caret and every option carry explicit
 * aria-labels. Not in popouts.
 *
 * ★ ONE `activeIndex` drives the band across rows `0..activeIndex`, the footer
 *   count and `aria-activedescendant`, so the drawn and announced states cannot
 *   disagree. Hover sets it too.
 * ★★★ IT IS READ THROUGH `clamp` EVERYWHERE, never raw — the entry list can
 *   SHRINK while this panel is open. `use-undo-hotkey` fires Ctrl/⌘+Z from a
 *   `document` keydown listener that skips only INPUT/TEXTAREA/SELECT/
 *   contenteditable, and the focused `<ul>` is none of those, so an End-then-
 *   Ctrl+Z leaves `activeIndex` pointing past the end: the footer over-counted
 *   ("Undo 3 action(s)" above two rows), `aria-activedescendant` dangled at a
 *   removed id, and Enter threw on `options[activeIndex].id`. Deriving during
 *   render is deliberate — `react-hooks/set-state-in-effect` is fatal, so this
 *   must NOT be an effect that syncs state.
 * ★ `aria-selected` marks the ACTIVE option only — the band is visual grouping;
 *   the footer count is what tells a screen-reader user how many entries Enter
 *   reverts.
 */
function UndoRedoControl({
  entries,
  onActivate,
  onActivateThrough,
  actionLabel,
  labelKey,
  historyButtonKey,
  historyLabelKey,
  countKey,
  lang,
  icon,
}: {
  /** Oldest-first, exactly as `UndoStackApi.stack` provides it. */
  entries: readonly UndoMeta[];
  onActivate: () => void;
  onActivateThrough: (id: number) => void;
  actionLabel: string;
  labelKey: TranslationKey;
  /** Accessible name for the caret — it opens the whole history, not "the next
   *  entry" (which is what the retired "Show next undo" strings claimed). */
  historyButtonKey: TranslationKey;
  historyLabelKey: TranslationKey;
  countKey: TranslationKey;
  lang: Lang;
  icon: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Where focus goes when this control itself disappears — see the effect below.
  const exitFocusRef = useRef<HTMLElement | null>(null);
  const armExitFocus = useCallback(() => {
    const root = rootRef.current;
    exitFocusRef.current = root ? nextFocusableAfter(root) : null;
  }, []);
  // ★★ Return focus to the caret. The `<ul tabIndex={0}>` is what `PopoverPanel`
  // autofocuses, and neither it nor `useDismissable` restores focus — so on
  // Escape / Enter / an option click the focused node UNMOUNTS and focus falls
  // to <body>, restarting the next Tab at the top of the document (WCAG 2.4.3).
  // Fixed HERE rather than in the shared panel: every other consumer keeps its
  // current behaviour.
  // ★★★ ONLY WHEN THE PANEL STILL OWNS FOCUS (or focus was dropped). `close` is
  // NOT just the Escape/Enter/click path: `PopoverPanel` also calls `onClose`
  // from its outside-mousedown, ancestor-scroll and width-resize listeners. An
  // unconditional `caretRef.current?.focus()` therefore yanked focus into the
  // top bar when the user had deliberately tabbed or clicked somewhere else and
  // then merely scrolled — a worse regression than the stranded focus this
  // restore exists to fix. Same "lost counts as ours" rule as
  // `usePanelInitialFocus` / `useClaimsWhenFocusWithin`.
  const close = useCallback(() => {
    setOpen(false);
    if (typeof document === "undefined") return;
    const focused = document.activeElement;
    const lost = focused === null || focused === document.body;
    const inside = focused !== null && listRef.current !== null && listRef.current.contains(focused);
    if (lost || inside) caretRef.current?.focus();
  }, []);

  const depth = entries.length;
  // Display order is newest-first; `entries` arrives oldest-first.
  const options = useMemo(() => [...entries].reverse(), [entries]);

  const optionId = useCallback((i: number) => `undo-history-${labelKey}-opt-${i}`, [labelKey]);

  // ★★★ The single clamped read of `activeIndex` — see the header. `lastIndex`
  // is -1 for an empty list, which `Math.max(0, …)` turns into 0 (that render
  // returns null below, so nothing indexes `options` with it).
  const lastIndex = options.length - 1;
  const clamp = (i: number) => Math.max(0, Math.min(i, lastIndex));
  const active = clamp(activeIndex);

  // Whether the last activation came from the KEYBOARD — read by the scroll
  // effect below AND by the hover guard. A ref, not state: it must not itself
  // cause a render.
  const keyboardMoveRef = useRef(false);

  const openList = useCallback(() => {
    setActiveIndex(0);
    keyboardMoveRef.current = false;
    // Armed here (not at activation) so it also covers the stack draining under
    // an OPEN panel — `use-undo-hotkey` listens on `document` and skips only
    // INPUT/TEXTAREA/SELECT/contenteditable, so Ctrl/⌘+Z fires while the
    // focused <ul> is none of those. The portal does not exist yet at this
    // point (the handler runs before React commits `open`), so the captured
    // target can never be a node inside the panel that is about to close.
    armExitFocus();
    setOpen(true);
  }, [armExitFocus]);

  // ★★ `aria-activedescendant` moves the VIRTUAL focus only — DOM focus never
  // leaves the <ul>, so the browser does NOT scroll the active option into view
  // the way it does for real focus. The list is `max-h-64` (~8 rows) against an
  // UNDO_CAP of 25, so without this, arrowing past the eighth row moves the band
  // and the footer count onto a row the user cannot see — exactly the
  // drawn-vs-announced divergence the single `activeIndex` exists to prevent.
  // ★ KEYBOARD moves only. A hovered row is under the pointer and therefore
  // already visible, and scrolling the list out from under a moving pointer is
  // its own bug — the row that slides under the cursor fires its own
  // `onMouseEnter` and the active option runs away from the user.
  // ★ `block: "nearest"` specifically: "center"/"start" re-scroll on every arrow
  // press and can scroll the PAGE, not just this list.
  useEffect(() => {
    if (!open || !keyboardMoveRef.current) return;
    // Attribute selector, not `#id` — it needs no CSS escaping whatever
    // `labelKey` becomes. Scoped to the list so it cannot match the sibling
    // control's options (undo and redo are both mounted).
    listRef.current
      ?.querySelector<HTMLElement>(`[id="${optionId(active)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active, optionId]);

  // ★★★ THE SCROLL ABOVE FIRES `mouseenter` ON THE ROW THAT SLIDES UNDER A
  // STATIONARY POINTER, and without this the synthetic enter overwrites the
  // index the keyboard just set. Measured in Chromium on an 11-entry stack with
  // the pointer resting on row 3: End landed on option 5 and the footer read
  // "Undo 6 actions" instead of "Undo 11 actions" — so Enter would have reverted
  // six edits after the user asked for eleven. Home was equally wrong (3, not 1).
  // With the pointer parked off the list the same keys landed on 10 and 0.
  // ★ `mousemove` is the exact discriminator and the only one available: a REAL
  //   pointer move always emits it, a scroll-induced enter never does. So the
  //   flag stays set until the user physically moves, which is also what
  //   re-enables hover — no explicit re-arm is needed anywhere.
  // ★ Listening on `window`, not the list: travelling to a row from outside
  //   emits dozens of moves before the boundary is crossed, so a deliberate
  //   hover is already re-armed by the time its `mouseenter` arrives. A
  //   list-scoped listener would swallow that first hover (boundary events
  //   precede the `mousemove` that caused them).
  useEffect(() => {
    if (!open) return;
    const onMove = () => {
      keyboardMoveRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [open]);

  // ★★★ THE PATH `close()` CANNOT FIX: committing THROUGH THE OLDEST ENTRY (or
  // draining the stack with Ctrl+Z, or clicking the action button down to zero)
  // empties `entries`, so the `depth <= 0` return below unmounts the very caret
  // `close()` just focused and focus lands on <body> — the exact WCAG 2.4.3
  // failure the restore was added for, on the path a user is most likely to
  // take. Nothing of ours survives to receive focus, so the target is captured
  // BEFORE the removal (`armExitFocus`) and applied AFTER the commit, here.
  // ★★ Where it goes: the element a Tab from this control would have reached AT
  //   ARM TIME — and arm time is BEFORE the undo, so what is mounted then is
  //   what gets captured. For the undo control on a FIRST undo the redo stack is
  //   empty, so the redo control has returned null and is not in the DOM at all:
  //   measured in Chromium, the captured target was the next top-bar control
  //   ("Voice command"), NOT the redo button. It is the redo button only when a
  //   redo entry ALREADY existed when the panel opened (or the action button was
  //   clicked). Both cases are real; which one is "normal" is simply whether the
  //   user has undone anything yet in this session, so the first undo of a
  //   session lands on the neighbouring control. Predictable either way, and it
  //   keeps the user in the place they were.
  // ★★ ONLY when focus was actually DROPPED. If the user has moved focus
  //   somewhere deliberate, pulling it into the top bar because a background
  //   write happened to empty the stack is focus THEFT, which is worse than the
  //   bug being fixed. `document.contains` also rules out a captured node that
  //   has itself since unmounted.
  // ★ The component is rendered unconditionally by task-manager, so it stays
  //   MOUNTED (only its DOM goes) and this effect still runs. Every hook is
  //   above the early return for that reason — keep it that way.
  useEffect(() => {
    if (depth > 0) return;
    const target = exitFocusRef.current;
    exitFocusRef.current = null;
    if (target === null || !document.contains(target)) return;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    target.focus();
  }, [depth]);

  if (depth <= 0) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      keyboardMoveRef.current = true;
      // Clamp the STORED value before stepping: a stale index past the end must
      // step from the last row, not from wherever it was stranded.
      setActiveIndex((i) => clamp(clamp(i) + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      keyboardMoveRef.current = true;
      setActiveIndex((i) => clamp(clamp(i) - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      keyboardMoveRef.current = true;
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      keyboardMoveRef.current = true;
      setActiveIndex(clamp(lastIndex));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivateThrough(options[active].id);
      close();
    }
  };

  return (
    <span ref={rootRef} className="inline-flex items-center">
      <button
        type="button"
        // Armed before the activation, not after: a click that takes the stack
        // to zero removes THIS button, and by then there is no anchor left to
        // measure "the next focusable" from.
        onClick={() => { armExitFocus(); onActivate(); }}
        aria-label={actionLabel}
        title={actionLabel}
        className={`${BUTTON_CLASS} rounded-r-none border-r-0 ${INTERACTIVE}`}
      >
        {icon}
        <span>{t(lang, labelKey)}</span>
        <span className="rounded-full bg-ui-medium-grey px-1.5 text-xs text-white">{depth}</span>
      </button>
      <button
        ref={caretRef}
        type="button"
        onClick={() => (open ? close() : openList())}
        aria-label={t(lang, historyButtonKey)}
        title={t(lang, historyButtonKey)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${BUTTON_CLASS} rounded-l-none px-1 ${INTERACTIVE}`}
      >
        {/* Chevron (decorative — aria-label carries the name) */}
        <ChevronDownIcon aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <PopoverPanel
        open={open}
        anchorRef={caretRef}
        onClose={close}
        role="dialog"
        className="w-72 p-2"
      >
        {/* One tab stop; the active option is announced via aria-activedescendant,
            so the <li>s carry no tabindex.
            ★ The NAME lives here, not on the panel: labelling both made AT
              announce "Undo history, dialog … Undo history, listbox". The
              listbox is the half that must keep it — axe's `aria-input-field-name`
              (wcag412, i.e. gate-blocking) covers role=listbox, while a nameless
              role=dialog trips only the best-practice `aria-dialog-name`. */}
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-label={t(lang, historyLabelKey)}
          aria-activedescendant={optionId(active)}
          onKeyDown={onKeyDown}
          className={`max-h-64 overflow-y-auto ${FOCUS_RING}`}
        >
          {options.map((m, i) => {
            const banded = i <= active;
            return (
              <li
                key={m.id}
                id={optionId(i)}
                role="option"
                // ★★ The position suffix is what keeps names unique — two edits
                //    to the same named row produce an identical `label`.
                aria-label={t(lang, "undoHistoryOption", m.label, i + 1)}
                aria-selected={i === active}
                data-banded={banded}
                // Ignored while the pointer has not moved since the last key —
                // see the scroll effect above for why a `mouseenter` here is
                // not proof that the user pointed at anything.
                onMouseEnter={() => { if (keyboardMoveRef.current) return; setActiveIndex(i); }}
                onClick={() => { onActivateThrough(m.id); close(); }}
                className={`cursor-pointer rounded px-2 py-1 text-sm ${
                  banded ? "bg-surface-muted text-ui-dark-blue dark:text-ui-light-grey" : "text-muted-foreground"
                }`}
              >
                {m.label}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 border-t border-line pt-2 text-xs font-medium text-muted-foreground">
          {t(lang, countKey, active + 1)}
        </p>
      </PopoverPanel>
    </span>
  );
}

interface UndoControlProps {
  lang: Lang;
  /** The undo stack, oldest-first. Empty → the control renders nothing. */
  entries: readonly UndoMeta[];
  onUndo: () => void;
  onUndoThrough: (id: number) => void;
}

/** Top-bar undo button + a caret opening the multi-step history. */
export function UndoControl({ lang, entries, onUndo, onUndoThrough }: UndoControlProps) {
  return (
    <UndoRedoControl
      entries={entries}
      onActivate={onUndo}
      onActivateThrough={onUndoThrough}
      actionLabel={t(lang, "undoTooltip")}
      labelKey="undo"
      historyButtonKey="undoShowHistory"
      historyLabelKey="undoHistoryLabel"
      countKey="undoNActions"
      lang={lang}
      icon={
        // Undo arrow (decorative — aria-label carries the name)
        <ArrowUturnLeftIcon aria-hidden="true" className="h-4 w-4" />
      }
    />
  );
}

interface RedoControlProps {
  lang: Lang;
  /** The redo stack, oldest-first. Empty → the control renders nothing. */
  entries: readonly UndoMeta[];
  onRedo: () => void;
  onRedoThrough: (id: number) => void;
}

/** Top-bar redo button + multi-step history — mirror of {@link UndoControl}. */
export function RedoControl({ lang, entries, onRedo, onRedoThrough }: RedoControlProps) {
  return (
    <UndoRedoControl
      entries={entries}
      onActivate={onRedo}
      onActivateThrough={onRedoThrough}
      actionLabel={t(lang, "redoTooltip")}
      labelKey="redo"
      historyButtonKey="redoShowHistory"
      historyLabelKey="redoHistoryLabel"
      countKey="redoNActions"
      lang={lang}
      icon={
        // Redo arrow — horizontal mirror of the undo arrow (decorative; aria-label carries the name)
        <ArrowUturnRightIcon aria-hidden="true" className="h-4 w-4" />
      }
    />
  );
}
