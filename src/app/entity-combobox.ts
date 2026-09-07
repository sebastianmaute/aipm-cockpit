"use client";

// useEntityCombobox — the keyboard/highlight mechanics shared by the two ENTITY
// pickers, `EntityLinkPicker` (multi-select) and `SingleEntityPicker`
// (single-select). Both grew the same `listId` / `listRef` / `highlight` /
// armed-identity / `dismissed` / `prevQuery` machinery independently, comment
// blocks and all; this file is that machinery's first single home. Rendering
// stays with each picker — only the state and the key handling move here.
//
// ★★★ THIS IS A SECOND COMBOBOX CORE, NOT A REPLACEMENT FOR `combobox-shared`,
// and merging the two would be a regression rather than a tidy-up. That module
// (`useCombobox` / `ComboboxChevron` / `ComboboxOptions`, behind ComboInput,
// GlobalSearchBox and LabelsInput) serves a genuinely different shape, and its
// four mismatches with this one would each have to be UNDONE rather than
// configured. Re-verified against `combobox-shared.tsx` on 2026-09-07 — every
// point below was checked one at a time, not copied forward:
//   1. `useCombobox` owns `open` as its OWN `useState`, closed by an
//      outside-click `mousedown` effect. `open` here is DERIVED
//      (`hasQuery && options.length > 0 && !dismissed`), so the caller's
//      filtering alone can close the list and there is no second source of
//      truth to keep in step.
//   2. Its `moveHighlight` moves the highlight through a FUNCTION updater and
//      schedules no `scrollIntoView` (the file contains neither that call nor a
//      `requestAnimationFrame`). These `max-h-60` lists need one, and it cannot
//      be scheduled from inside a pure updater — see `move` below.
//   3. `ComboboxOptions` renders `filtered: string[]` plus an "add new" row,
//      not `{value, code, label}` triples with no add path.
//   4. `ComboboxChevron` takes a `lang` and calls `t()`, which would break the
//      i18n-free contract both entity pickers state: every user-facing string
//      arrives already translated.
// Recorded rather than merely decided, per "use a shared primitive or ASK": the
// next author looking at two combobox hooks should not have to re-derive
// whether the other one was considered.
//
// What was already shared and is NOT re-implemented here: the pure filtering
// engine `filterPickerOptions` (`picker-filter.ts`), which callers apply before
// handing `options` in.
//
// Entity-agnostic and i18n-free: this file takes no `lang` and calls no `t()`.
import { useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";

/** The id of one rendered option row.
 *
 *  ★★ ONE source for a string that was spelled THREE times — this hook's own
 *  `scrollIntoView` query and each picker's `id=` / `aria-activedescendant`
 *  markup — with nothing enforcing that they agreed. A mismatch fails SILENTLY:
 *  the query selector simply finds nothing, so the highlight stops scrolling
 *  into view with no error and no failing test. Both pickers and the query
 *  below derive from here.
 *
 *  ★ The rendered string is unchanged from the three hand-spelled copies. This
 *  is a de-duplication, not a rename — the id is what `aria-activedescendant`
 *  points at, and tests assert on it. */
export function entityOptionId(listId: string, index: number): string {
  return `${listId}-opt-${index}`;
}

export interface EntityComboboxInput<T> {
  /** The live search text. Owned by the caller; drives the reconcile below. */
  query: string;
  /** Candidates — ALREADY filtered by the caller. */
  options: readonly T[];
  /** How an option is keyed. `(o) => o.value` for `SingleEntityPicker`,
   *  `entryKey` for `EntityLinkPicker` (whose ids collide across entity kinds).
   *
   *  ★★ CONTRACT, unenforced: the identity must be UNIQUE within one `options`
   *  array. Two options sharing one are indistinguishable here, and the
   *  identity check in `active` would then accept the wrong one. */
  identity: (option: T) => string;
  /** Called on Enter with the ARMED option — the whole option, not a field of
   *  it, since `EntityLinkPicker` commits the entry itself while
   *  `SingleEntityPicker` unwraps a `value`.
   *
   *  ★ REQUIRED on purpose. Both consumers always have a handler, so
   *  optionality bought nothing and spent the loud failure: `onKeyDown` calls
   *  `preventDefault()` before committing, so a picker that forgot to pass one
   *  would swallow Enter and then do nothing at all — a dead key no test above
   *  this hook can see. Required makes that a compile error instead. */
  onCommit: (option: T) => void;
}

export interface EntityCombobox {
  /** `useId` value the caller builds row ids from — via `entityOptionId`, never
   *  by re-spelling the template. */
  listId: string;
  /** Attach to the `<ul role="listbox">`; `move` scrolls through it. */
  listRef: RefObject<HTMLUListElement | null>;
  /** Whether the dropdown should render. DERIVED, never state — see (1) above. */
  open: boolean;
  /** The armed option index, or -1. See the three conditions in the body. */
  active: number;
  /** Move the highlight one row, wrapping at both ends. */
  move: (delta: 1 | -1) => void;
  /** Wire to the search input's `onKeyDown`. */
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Undo an Escape dismissal.
   *
   *  ★ Wire to onCLICK, not onFocus. Escape must STICK: with an onFocus reopen,
   *  tabbing away and back reopens the list over the rest of the form. */
  reopen: () => void;
}

export function useEntityCombobox<T>({
  query,
  options,
  identity,
  onCommit,
}: EntityComboboxInput<T>): EntityCombobox {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  // Active option index for the combobox. VIEW state, so it lives here even
  // though `query` stays controlled by the caller — the caller owns which
  // entities are selectable, not which one the keyboard is currently on.
  const [highlight, setHighlight] = useState(-1);
  // The OPTION the index was armed against, by the same `identity` that keys
  // the rendered rows. Read with `highlight` below: an index whose option no
  // longer matches is not armed.
  const [armedKey, setArmedKey] = useState<string | null>(null);
  // Escape closes the dropdown without touching the query. Reset whenever the
  // query changes, so typing on reopens the list.
  const [dismissed, setDismissed] = useState(false);
  const [prevQuery, setPrevQuery] = useState(query);

  // Render-time reconcile, NOT an effect (`set-state-in-effect` is fatal here).
  // Keyed on the QUERY, not on the `options` identity: callers re-filter and
  // hand us a fresh array every render, so reconciling on identity would reset
  // the highlight on every keystroke-free re-render and the arrow keys would
  // never stick.
  if (prevQuery !== query) {
    setPrevQuery(query);
    setHighlight(-1);
    setArmedKey(null);
    setDismissed(false);
  }

  const hasQuery = query.trim() !== "";
  const open = hasQuery && options.length > 0 && !dismissed;
  // THREE conditions, and none of them subsumes another:
  //   1. the RECONCILE above clears both pieces of state on a query change;
  //   2. the RANGE clamp drops an index past the end of a shrunken list — it
  //      stays load-bearing regardless of (3), because the identity read
  //      itself indexes `options[highlight]`;
  //   3. the IDENTITY check catches what neither can see — `options` GROWING
  //      or being SWAPPED under a standing query, where the stale index is
  //      still in range but now names a DIFFERENT entity.
  //
  // ★★ Identity of the OPTION, not identity of the `options` ARRAY. Callers
  // re-filter and hand a fresh array every render, so reconciling on the array
  // would reset the highlight on every keystroke-free re-render and the arrow
  // keys would never stick. Comparing the option's identity is immune to that:
  // it clears only when the entity actually under the index changed.
  //
  // ★★★ WHAT (3) ENFORCES — a real defect until 2026-09-06, and the reason
  // this is a data-correctness guard rather than a cosmetic one. All four of
  // `EntityLinkPicker`'s `onRemove` arrows change the caller's selected set
  // with the query untouched, each caller's option list is derived by EXCLUDING
  // that set (`useTaskPickerOptions` for `task-link-picker.tsx` and
  // `dependencies-editor.tsx`, the `linked` set in `document-links-field.tsx`,
  // `availableCauses` in `raid-edit-modal.tsx`), and `filterPickerOptions`
  // (`picker-filter.ts`) is an order-preserving `.filter()` chain with no sort.
  // So unlinking an entity that still matched the standing query put it BACK
  // at its SOURCE position and shifted every index at or after it: arm the
  // third option, unlink the second chip, click back into the field, press
  // Enter — and the picker RE-ADDED the entity just removed. The visible half
  // needed no keystroke at all: `aria-selected` and `aria-activedescendant`
  // named the wrong row the moment the list re-rendered, so a mouse user
  // clicking the highlighted row was misled too.
  //
  // ★★ AND THE EXEMPTION THAT SUGGESTS ITSELF NEVER HELD — checked, not
  // assumed. "Clicking a chip's remove button moves focus off the search box,
  // so Enter never reaches `onKeyDown`" covers only the very next keystroke:
  // `IconButton` sets no `onMouseDown` preventDefault, so the click really does
  // take focus — but the search box's reopen handler is `onClick` calling
  // `reopen()` and it resets nothing else, so clicking back into the field
  // restored the open list with the stale highlight intact.
  const active =
    highlight >= 0 &&
    highlight < options.length &&
    identity(options[highlight]) === armedKey
      ? highlight
      : -1;

  function move(delta: 1 | -1) {
    // ★ `next` is computed OUTSIDE the updater and the scroll scheduled beside
    // it: a setState updater must be PURE, and React StrictMode double-invokes
    // it, which would schedule the rAF twice. Safe to read `active` here rather
    // than through an updater — `move` is only ever called from `onKeyDown`,
    // where the clamped `active` is already current for this render.
    const cur = active;
    const next =
      delta === 1
        ? cur + 1 >= options.length
          ? 0
          : cur + 1
        : cur <= 0
          ? options.length - 1
          : cur - 1;
    setHighlight(next);
    // ★ Armed against the OPTION, so a later render whose `options` shifted
    // under this index disarms it (see `active`). `move` is only reached from
    // `onKeyDown`, which returns early on an empty list, so `options[next]`
    // always exists.
    setArmedKey(identity(options[next]));
    // ★ The lists are `max-h-60 overflow-auto` (~8 rows) and the keyboard path
    // is aria-activedescendant, which browsers do NOT auto-scroll — focus never
    // moves, so nothing brings the row into view. Past row 8 the ring, the
    // weight and the fill all move below the fold, which would defeat the
    // contrast work these option rows carry. Deferred a frame so the row
    // carrying the new index has rendered.
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`#${CSS.escape(entityOptionId(listId, next))}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!hasQuery || options.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setDismissed(false);
      move(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Enter") {
      // ★ Only an ARMED option claims Enter. These pickers sit inside <form>
      // edit modals where a bare Enter submits, so swallowing it merely because
      // a dropdown happens to be open would silently break submitting from this
      // field.
      if (!open || active < 0) return;
      e.preventDefault();
      onCommit(options[active]);
      return;
    }
    if (e.key === "Escape") {
      // Only ours while the dropdown is actually open — otherwise Escape
      // belongs to the enclosing modal.
      if (!open) return;
      // ★★ preventDefault is what actually contains this: the shared Modal's
      // document-level Escape handler bails on `e.defaultPrevented`, which is
      // the ONLY mechanism available. stopPropagation cannot do it — React 19
      // delegates on `document` (Next hydrates the root there), the same node
      // Modal listens on, and stopPropagation does not suppress a listener
      // co-registered on the SAME node. It reads as though it works only
      // because React Testing Library renders into a div under body, putting
      // React's listener on a descendant — a topology the real app never has.
      e.preventDefault();
      // ★ Kept as defence-in-depth for a host listening on an ANCESTOR or on
      // `window` rather than on `document` — propagation to those genuinely is
      // cut by this, and `defaultPrevented` only helps a host that checks it.
      // It has been load-bearing before: while the change edit modal still
      // stacked a window-level Escape listener over `Modal`, this line was the
      // only thing keeping Escape from discarding that draft. That listener has
      // since been deleted, so today `preventDefault` above is the real
      // mechanism — but "no host needs this right now" is not the same as
      // "no host can", which is why it stays.
      e.stopPropagation();
      setDismissed(true);
      setHighlight(-1);
      setArmedKey(null);
    }
  }

  return {
    listId,
    listRef,
    open,
    active,
    move,
    onKeyDown,
    reopen: () => setDismissed(false),
  };
}
