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
import { useEntityCombobox } from "./entity-combobox";
import { EntityComboboxSearch } from "./entity-combobox-search";
import { EntityComboboxList } from "./entity-combobox-list";

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
        {/* Rendered INSIDE this `relative` div, not around it: the listbox below
            is positioned against this same box, so wrapping outside would put
            the ✕ over the option list instead of over the field. */}
        <EntityComboboxSearch
          listId={listId}
          open={open}
          active={active}
          onKeyDown={onKeyDown}
          reopen={reopen}
          query={query}
          onQueryChange={onQueryChange}
          searchLabel={searchLabel}
          placeholder={placeholder}
          clearLabel={clearLabel}
          inputSize={inputSize}
        />
        <EntityComboboxList
          listId={listId}
          listRef={listRef}
          open={open}
          active={active}
          options={options}
          optionKey={(entry) => entry.value}
          onPick={(entry) => onSelect(entry.value)}
        />
      </div>
    </div>
  );
}
