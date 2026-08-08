"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUturnLeftIcon, ArrowUturnRightIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { t, type Lang, type TranslationKey } from "../i18n";
import { FOCUS_RING, INTERACTIVE } from "../interaction-styles";
import { PopoverPanel } from "../popover-panel";
import { type UndoMeta } from "./undo-stack";

const BUTTON_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm text-muted-foreground hover:text-ui-dark-blue dark:hover:text-ui-light-grey";

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
  const caretRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // ★★ Return focus to the caret. The `<ul tabIndex={0}>` is what `PopoverPanel`
  // autofocuses, and neither it nor `useDismissable` restores focus — so on
  // Escape / Enter / an option click the focused node UNMOUNTS and focus falls
  // to <body>, restarting the next Tab at the top of the document (WCAG 2.4.3).
  // Fixed HERE rather than in the shared panel: every other consumer keeps its
  // current behaviour.
  const close = useCallback(() => {
    setOpen(false);
    caretRef.current?.focus();
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
    setOpen(true);
  }, []);

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
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={onActivate}
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
