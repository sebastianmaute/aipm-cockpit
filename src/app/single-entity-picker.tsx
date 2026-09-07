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
// The keyboard/highlight mechanics live in `useEntityCombobox`
// (`entity-combobox.ts`), shared with EntityLinkPicker. That file's docblock
// carries the four-point record of why `combobox-shared` (`useCombobox` /
// `ComboboxChevron` / `ComboboxOptions`) is deliberately NOT the substrate here
// — read it before concluding the app has two combobox cores by accident.
//
// What IS shared beyond it is the pure engine: callers filter with
// `filterPickerOptions` (picker-filter.ts), which already layers
// `wildcardMatcher` over an `#id` exact match. Nothing is reimplemented here.
//
// Presentational and entity-agnostic. Every user-facing string arrives already
// translated, so this file takes no `lang` and calls no `t()` — same contract as
// EntityLinkPicker.
import { entityOptionId, useEntityCombobox } from "./entity-combobox";
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
  // ★ The commit call stays at THIS call site: the hook hands back the whole
  // option, because the multi-select sibling commits the entry itself while
  // this control unwraps a `value`.
  const { listId, listRef, open, active, onKeyDown, reopen } =
    useEntityCombobox<SingleEntityOption>({
      query,
      options,
      identity: (o) => o.value,
      onCommit: (o) => onSelect(o.value),
    });

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
            onClick={reopen}
            onKeyDown={onKeyDown}
            aria-label={searchLabel}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={
              open && active >= 0 ? entityOptionId(listId, active) : undefined
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
                id={entityOptionId(listId, i)}
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
