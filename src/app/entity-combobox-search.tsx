"use client";

// EntityComboboxSearch — the search box both entity pickers put above their
// dropdown: a `ClearableSearchInput` wrapping the `role="combobox"` `Input`,
// with the full ARIA wiring (`aria-expanded` / `aria-controls` /
// `aria-activedescendant` / `aria-autocomplete`) driven off `useEntityCombobox`.
//
// `SingleEntityPicker` and `EntityLinkPicker` spelled this block out
// character-for-character — re-measured before the extraction with the
// comment-stripped range diff, 28 lines each, exit 0 — so the ARIA attributes
// could drift apart in one picker without anything noticing. They share it now.
//
// ★ MUST be rendered INSIDE the picker's own `relative` div, not around it: the
// listbox is positioned against that same box, so wrapping outside would put
// the overlaid ✕ over the option list instead of over the field.
// ★★ The listbox is `entity-combobox-list.tsx` and is no longer at the call
// site. This spot used to say it stayed there "because the two pickers key and
// commit their rows differently" — true, and it was the whole of the
// difference: 27 of 29 comment-stripped lines were byte-identical, and keying
// and committing are what `useEntityCombobox` already parameterises. Measured
// by cold review 2026-09-07 and extracted the same day.
//
// Presentational and entity-agnostic. Every user-facing string arrives already
// translated, so this file takes no `lang` and calls no `t()` — same contract as
// both its callers.
import { entityOptionId, type EntityCombobox } from "./entity-combobox";
import { Input } from "./form-controls";
import { ClearableSearchInput } from "./clearable-search-input";

interface EntityComboboxSearchProps
  extends Pick<EntityCombobox, "listId" | "open" | "active" | "onKeyDown" | "reopen"> {
  /** The live query. Owned by the picker's caller, threaded through. */
  query: string;
  onQueryChange: (value: string) => void;
  /** Accessible name for the search box. A placeholder is NOT an accessible
   *  name (it fails the axe gate), so this is required. */
  searchLabel: string;
  placeholder: string;
  /** Already-translated accessible name for the query box's clear button. */
  clearLabel: string;
  /** Matches the surrounding form's control scale. */
  inputSize: "xs" | "md";
}

export function EntityComboboxSearch({
  listId,
  open,
  active,
  onKeyDown,
  reopen,
  query,
  onQueryChange,
  searchLabel,
  placeholder,
  clearLabel,
  inputSize,
}: EntityComboboxSearchProps) {
  return (
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
        // See `reopen`'s own docblock. ArrowDown/Up also reopen (the APG
        // affordance), so a keyboard user is never stuck behind an Escape.
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
        //   off the visible placeholder in the (common) empty state. Same
        //   rule as TableFilter and PaneSearchInput.
        className={`w-full${query ? " pr-8" : ""}`}
      />
    </ClearableSearchInput>
  );
}
