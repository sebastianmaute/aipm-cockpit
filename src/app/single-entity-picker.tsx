"use client";

// SingleEntityPicker — the single-select sibling of EntityLinkPicker: one
// current value shown above a search box whose dropdown replaces it.
//
// Why not EntityLinkPicker itself: that component is multi-select by
// construction — `selected` is an ARRAY with add/remove asymmetry and there is
// no empty state, because an unlinked entity is simply absent from the list. A
// single-value control needs the opposite: exactly one value, an explicit
// "none", and replace-rather-than-append semantics. Bolting a mode onto the
// shared component would put TaskLinkPicker and RaidCausedByField at risk for a
// third caller's benefit.
//
// Why not `combobox-shared` either (`useCombobox` / `ComboboxChevron` /
// `ComboboxOptions`, behind ComboInput, GlobalSearchBox and LabelsInput): all
// three exports mismatch this control, each in a way that would have to be
// undone rather than configured. `useCombobox` owns `open` as its OWN state,
// with an outside-click effect to close it; `open` here is DERIVED
// (`hasQuery && options.length > 0 && !dismissed`), so the caller's filtering
// alone can close the list and there is no second source of truth to keep in
// step. Its `moveHighlight` moves the highlight through a FUNCTION updater and
// schedules no `scrollIntoView` — this `max-h-60` list needs one, and it cannot
// be scheduled from inside a pure updater (see `move` below). `ComboboxOptions`
// renders `filtered: string[]` plus an "add new" row, not `{value, code, label}`
// triples with no add path. And `ComboboxChevron` takes a `lang` and calls
// `t()`, which would break the i18n-free contract stated below.
// Recorded rather than merely decided: `src/app` already carries several
// `role="combobox"` controls over more than one substrate (enumerate with
// `grep -rln 'role="combobox"' src/app --include=*.tsx`), and "use a shared
// primitive or ASK" means the next author should not have to re-derive whether
// the shared module was even considered.
//
// What IS shared is the pure engine: callers filter with `filterPickerOptions`
// (picker-filter.ts), which already layers `wildcardMatcher` over an `#id`
// exact match. Nothing is reimplemented here.
//
// Presentational and entity-agnostic. Every user-facing string arrives already
// translated, so this file takes no `lang` and calls no `t()` — same contract as
// EntityLinkPicker.
import { useId, useRef, useState } from "react";
import { Input } from "./form-controls";
import { ClearableSearchInput } from "./clearable-search-input";

/** One selectable entity, flattened to what the picker renders. */
export interface SingleEntityOption {
  /** Opaque value handed back to the caller on selection. Unique in the list. */
  value: string;
  /** Short qualifier rendered monospace, e.g. "Task" or "RAID". */
  code: string;
  /** Human-readable name; truncates rather than wrapping. */
  label: string;
}

interface SingleEntityPickerProps {
  /** The current value, or "" for none. */
  value: string;
  /** Already-translated label for the current value. Omit for none. */
  selectedLabel?: string;
  /** Candidates — ALREADY filtered by the caller. Rendered only while the
   *  query is non-blank, mirroring EntityLinkPicker.
   *
   *  ★★ CONTRACT, relied on and NOT enforced: `options` may only change as a
   *  RESULT of `query` changing. The highlight is reconciled on the query and
   *  clamped against the list LENGTH, so a caller that swaps `options` while
   *  `query` stands still can leave an index armed that is still in range but
   *  now names a DIFFERENT entity — Enter would then commit something the user
   *  never picked. EntityLinkPicker rests on the same contract.
   *
   *  ★★★ THE 2026-09-05 MEASUREMENT BEHIND THAT COVERED THE ADD PATH ALONE,
   *  and an earlier revision of this line stated its conclusion unscoped —
   *  "all four of its call sites honour it". On ADD they do: each clears the
   *  query. On REMOVE none of them does. Every `onRemove` arrow at the four
   *  sites changes the caller's selected set with the query untouched, and
   *  each caller's option list is derived by EXCLUDING that set
   *  (`useTaskPickerOptions` for `task-link-picker.tsx` and
   *  `dependencies-editor.tsx`, the `linked` set in `document-links-field.tsx`,
   *  `availableCauses` in `raid-edit-modal.tsx`), so unlinking an entity that
   *  still matches the standing query puts it BACK into the list and shifts
   *  every index after it.
   *
   *  ★★★ AND THE EXEMPTION THAT SUGGESTS ITSELF DOES NOT HOLD — checked, not
   *  assumed. "Clicking a chip's remove button moves focus off the search box,
   *  so Enter never reaches the key handler" covers only the very next
   *  keystroke: `IconButton` sets no `onMouseDown` preventDefault, so the click
   *  really does take focus — but the search box's reopen handler is `onClick`
   *  calling `setDismissed(false)` and it resets nothing else, so clicking back
   *  into the field restores the open list with the stale highlight intact.
   *  Read removes as UNCOVERED by the measurement, never as exempt from the
   *  contract.
   *
   *  ★★★ AN EARLIER REVISION OF THIS COMMENT SAID `RaidCausedByField`
   *  (`raid-edit-fields.tsx`) DID NOT, and called the contract already broken.
   *  That was false, and it is worth keeping the record of how: its `onAdd`
   *  arrow really does not clear, but the `addCausedBy` it calls clears the
   *  query itself one layer down in `raid-edit-modal.tsx`. The claim was
   *  written from the arrow alone and dated as if measured, which is exactly
   *  the shape nothing gates — every backticked name in it was real, so no
   *  symbol check could object. Enumerate the callers before repeating any of
   *  this, and follow each `onAdd` into its handler:
   *    grep -rn "<EntityLinkPicker$" src/app --include=*.tsx | grep -v "\.test\."
   *
   *  The contract is still unenforced, and this component has no callers at all
   *  yet — which is when an unwritten contract is freest to be violated. */
  options: readonly SingleEntityOption[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (value: string) => void;
  /** Accessible name for the search box. A placeholder is NOT an accessible
   *  name (it fails the axe gate), so this is required. */
  searchLabel: string;
  placeholder: string;
  /** Already-translated accessible name for the query box's clear button. */
  clearLabel: string;
  /** Shown in place of a selection when `value` is "". */
  emptyLabel: string;
  /** Matches the surrounding form's control scale. */
  inputSize?: "xs" | "md";
}

export function SingleEntityPicker({
  value,
  selectedLabel,
  options,
  query,
  onQueryChange,
  onSelect,
  searchLabel,
  placeholder,
  clearLabel,
  emptyLabel,
  inputSize = "xs",
}: SingleEntityPickerProps) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  // Active option index for the combobox. VIEW state, so it lives here even
  // though `query` stays controlled by the caller.
  const [highlight, setHighlight] = useState(-1);
  // Escape closes the dropdown without touching the query. Reset whenever the
  // query changes, so typing on reopens the list.
  const [dismissed, setDismissed] = useState(false);
  const [prevQuery, setPrevQuery] = useState(query);

  // Render-time reconcile, NOT an effect — `react-hooks/set-state-in-effect` is
  // fatal here. Keyed on the QUERY, not on the `options` identity: callers
  // re-filter and hand a fresh array every render, so reconciling on identity
  // would reset the highlight on every keystroke-free re-render.
  if (prevQuery !== query) {
    setPrevQuery(query);
    setHighlight(-1);
    setDismissed(false);
  }

  const hasQuery = query.trim() !== "";
  const open = hasQuery && options.length > 0 && !dismissed;
  // Clamped on READ: the caller's filtering can shrink `options` under a stored
  // index. This drops an index now out of RANGE; the reconcile above covers an
  // index still in range but naming a different entity — and only because every
  // caller re-filters in RESPONSE to the query changing. A caller that swapped
  // `options` WITHOUT changing `query` defeats the reconcile outright, but
  // defeats THIS clamp only when the stale index is still in range in the new
  // list: an index past the new end is still caught here, which is what
  // "drops an active option that the shrinking option list no longer has"
  // pins. See the CONTRACT on the `options` prop, which this rests on rather
  // than enforces.
  const active = highlight >= 0 && highlight < options.length ? highlight : -1;

  function move(delta: 1 | -1) {
    // ★ `next` is computed BEFORE the setState, rather than through the updater
    // form `combobox-shared`'s `moveHighlight` uses: a setState updater must be
    // PURE, and StrictMode double-invokes it, so scheduling the rAF from inside
    // one would schedule it twice. `setHighlight` below therefore takes a plain
    // value — there is no updater in this file.
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
    // ★ The keyboard path is aria-activedescendant, which browsers do NOT
    // auto-scroll — focus never moves, so nothing brings the row into view.
    // Deferred a frame so the row carrying the new index has rendered.
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`#${CSS.escape(`${listId}-opt-${next}`)}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!hasQuery || options.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setDismissed(false);
      move(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Enter") {
      // ★ Only an ARMED option claims Enter. This control sits inside forms
      // where a bare Enter submits, so swallowing it merely because a dropdown
      // happens to be open would silently break submitting from this field.
      if (!open || active < 0) return;
      e.preventDefault();
      onSelect(options[active].value);
      return;
    }
    if (e.key === "Escape") {
      // Only ours while the dropdown is actually open — otherwise Escape
      // belongs to the enclosing modal.
      if (!open) return;
      // ★★ preventDefault is what actually contains this: the shared Modal's
      // document-level Escape handler bails on `e.defaultPrevented`, which is
      // the ONLY mechanism available. stopPropagation cannot do it — React 19
      // delegates on `document`, the same node Modal listens on, and
      // stopPropagation does not suppress a listener co-registered on the SAME
      // node. It reads as though it works only because RTL renders into a div
      // under body, a topology the real app never has.
      e.preventDefault();
      // ★ Kept as defence-in-depth for a host listening on an ANCESTOR or on
      // `window` rather than on `document` — propagation to those genuinely is
      // cut by this. The one host that ever needed it, the change edit modal's
      // window-level Escape listener, has SINCE BEEN DELETED, so today
      // `preventDefault` above is the real mechanism and this line is a backstop
      // for a hypothetical. "No host needs this right now" is not the same as
      // "no host can", which is why it stays — but do not read it as live.
      e.stopPropagation();
      setDismissed(true);
      setHighlight(-1);
    }
  }

  return (
    <div>
      <div className="mb-1 text-xs text-foreground">
        {value && selectedLabel ? (
          <span className="max-w-full truncate">{selectedLabel}</span>
        ) : (
          <span className="italic text-muted-foreground">{emptyLabel}</span>
        )}
      </div>
      <div className="relative">
        {/* Wrapped INSIDE this `relative` div, not around it: the listbox below
            is positioned against this same box, so wrapping outside would put
            the ✕ over the option list instead of over the field. */}
        <ClearableSearchInput
          value={query}
          onClear={() => onQueryChange("")}
          clearLabel={clearLabel}
        >
          <Input
            type="text"
            role="combobox"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            // ★ onCLICK, not onFocus. Escape must STICK: with an onFocus reopen,
            // tabbing away and back reopens the list over the rest of the form.
            onClick={() => setDismissed(false)}
            onKeyDown={onKeyDown}
            aria-label={searchLabel}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={
              open && active >= 0 ? `${listId}-opt-${active}` : undefined
            }
            aria-autocomplete="list"
            placeholder={placeholder}
            size={inputSize}
            // ★ pr-8 reserves room for the overlaid ✕ and therefore rides the
            //   same condition the ✕ does — unconditionally it would shave ~2rem
            //   off the visible placeholder in the (common) empty state.
            className={`w-full${query ? " pr-8" : ""}`}
          />
        </ClearableSearchInput>
        {open && (
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface"
          >
            {options.map((entry, i) => (
              // ★ The row itself is the option — NOT a <button> inside one. An
              // interactive child of role="option" is an axe nested-interactive
              // violation, and the keyboard path is aria-activedescendant.
              <li
                key={entry.value}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                // Keeps focus in the input so commit-on-blur hosts don't close
                // the editor out from under the selection.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(entry.value)}
                // ★★ The active row keeps `text-foreground` and rings on
                // `--foreground`, never an accent. The measurements behind that
                // are the sibling's, on NAMED tokens: `ring-ui-green` is
                // 6.0-7.9:1 on the dark row fills but only 1.7-2.1:1 on the
                // light ones, under the 3:1 WCAG 1.4.11 asks of a non-text state
                // indicator, while `--foreground` clears 3:1 in every shipped
                // scheme because it is the text colour FOR that surface. The
                // full block sits on EntityLinkPicker's own option row. Nothing
                // here measured the rest of the palette, so read this as those
                // tokens rather than as a claim about every brand accent.
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground ${
                  i === active
                    ? "bg-surface-muted font-medium ring-1 ring-inset ring-foreground"
                    : "hover:bg-surface-muted"
                }`}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {entry.code}
                </span>
                <span className="truncate">{entry.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
