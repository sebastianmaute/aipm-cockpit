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
   *  ★★ A swap under a STANDING query is now SAFE, and this block used to say
   *  the opposite. It read: "CONTRACT, relied on and NOT enforced — `options`
   *  may only change as a RESULT of `query` changing", because the highlight
   *  was reconciled on the query and clamped against the list LENGTH alone, so
   *  an index still in range but now naming a DIFFERENT entity stayed armed
   *  and Enter committed something the user never picked. The highlight is now
   *  additionally checked against the armed option's `value` (see `active`),
   *  which catches a grow, a shrink-within-range and a same-length swap alike.
   *  EntityLinkPicker carries the same three-condition guard.
   *
   *  ★★★ WHY IT WAS WORTH FIXING RATHER THAN DOCUMENTING, measured on the
   *  sibling: its four call sites all derive `options` by EXCLUDING the
   *  selected set (`useTaskPickerOptions` for `task-link-picker.tsx` and
   *  `dependencies-editor.tsx`, the `linked` set in `document-links-field.tsx`,
   *  `availableCauses` in `raid-edit-modal.tsx`), `filterPickerOptions`
   *  (`picker-filter.ts`) preserves source order and never sorts, and no
   *  `onRemove` touches the query — so an unlink put the entity BACK at its
   *  source position, shifted every later index, and Enter re-added the entity
   *  the user had just removed. The ADD path never showed it: each site clears
   *  the query on add, which fires the reconcile.
   *
   *  ★★ WHAT REMAINS A CONTRACT, unenforced: `value` must be UNIQUE within one
   *  `options` array, as this interface already documents. Two options sharing
   *  a `value` are indistinguishable here and the identity check would accept
   *  the wrong one.
   *
   *  ★★ HISTORY worth keeping, because a correction here was itself the defect
   *  twice over. The 2026-09-05 measurement covered the ADD path ALONE while
   *  an earlier revision stated its conclusion unscoped ("all four of its call
   *  sites honour it"); an earlier one still named `RaidCausedByField`
   *  (`raid-edit-fields.tsx`) as a violator because its `onAdd` arrow does not
   *  clear the query — false, the `addCausedBy` it calls clears the query one
   *  layer down in `raid-edit-modal.tsx`. The claim was written from the arrow
   *  alone and dated as if measured, which is exactly the shape nothing gates:
   *  every backticked name in it was real, so no symbol check could object.
   *  Enumerate the callers before repeating any of this, and follow each
   *  `onAdd` into its handler:
   *    grep -rn "<EntityLinkPicker$" src/app --include=*.tsx | grep -v "\.test\."
   */
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
  // The OPTION the index was armed against, by the same `value` that keys the
  // rendered rows — the interface documents it as unique in the list. Read
  // with `highlight` below: an index whose option no longer matches is not
  // armed.
  const [armedValue, setArmedValue] = useState<string | null>(null);
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
    setArmedValue(null);
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
  //      still in range but now names a DIFFERENT option.
  // Identity of the OPTION, not of the `options` ARRAY: callers hand a fresh
  // array every render, so reconciling on the array would reset the highlight
  // on every keystroke-free re-render. See the `options` prop's own block for
  // the defect this closed on the sibling and what is still only a contract.
  const active =
    highlight >= 0 &&
    highlight < options.length &&
    options[highlight].value === armedValue
      ? highlight
      : -1;

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
    // ★ Armed against the OPTION, so a later render whose `options` shifted
    // under this index disarms it (see `active`). `move` is only reached from
    // `onKeyDown`, which returns early on an empty list, so `options[next]`
    // always exists.
    setArmedValue(options[next].value);
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
      setArmedValue(null);
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
