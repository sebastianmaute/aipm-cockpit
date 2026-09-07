"use client";

// EntityLinkPicker — the shared "chips + search dropdown" link picker: a row
// of selected-entity chips (each with an unlink ×, optionally click-through to
// the entity) above a search box whose dropdown adds one.
//
// Extracted from TaskLinkPicker and RaidCausedByField, which hand-rolled the
// same markup for `Task` and `RaidItem` respectively. Both now render THIS.
// Distinct from StakeholderChipPicker, which is deliberately NOT folded in: it
// renders EVERY item as a checkbox chip for a bounded list, with no search and
// no add/remove asymmetry — a different control for a different problem, not a
// variant of this one.
//
// Presentational and entity-agnostic: callers map their own entity to
// `LinkPickerEntry` and own both the query state and the option filtering
// (which is where the two callers genuinely diverge — the task picker filters
// by text alone, the RAID cause picker must also exclude self and any pick
// that would close a cycle). Nothing here knows what a task or a RAID item is.
//
// The keyboard/highlight mechanics live in `useEntityCombobox`
// (`entity-combobox.ts`), shared with SingleEntityPicker. That file's docblock
// carries the three-condition `active` derivation, the render-time reconcile,
// the rAF `scrollIntoView` and the four-point record of why `combobox-shared`
// is deliberately NOT the substrate here — read it before concluding the app
// has two combobox cores by accident.
import { entityOptionId, useEntityCombobox } from "./entity-combobox";
import { EntityComboboxSearch } from "./entity-combobox-search";
import { INTERACTIVE } from "./interaction-styles";
import { XMarkIcon } from "./icons";
import { IconButton } from "./icon-button";

/** One selectable/selected entity, flattened to what the picker renders. */
export interface LinkPickerEntry {
  id: number;
  /** Short monospace identifier supplied by the caller, e.g. "#42" for a task
   *  or "R#7" for a RAID item. Also disambiguates the remove button's
   *  accessible name, so it must be unique within the list. */
  code: string;
  /** Human-readable name; truncates rather than wrapping. */
  label: string;
  /** Stable identity when `id` alone is not unique — a picker spanning several
   *  entity kinds has colliding ids. Defaults to `String(id)`. */
  key?: string;
}

const entryKey = (entry: LinkPickerEntry): string => entry.key ?? String(entry.id);

// Every user-facing string arrives already translated (searchLabel,
// placeholder, removeLabel), so this component takes no `lang` and calls no
// `t()` — it stays i18n-free the way the pure engines do.
interface EntityLinkPickerProps {
  /** Currently-linked entities, rendered as chips. */
  selected: readonly LinkPickerEntry[];
  /** Candidates for the dropdown — ALREADY filtered by the caller (query and
   *  any domain rules). Rendered only while the query is non-blank.
   *
   *  ★★ HISTORY worth keeping, because a correction here was itself the defect
   *  twice over. A 2026-09-05 measurement of what the callers do to this array
   *  covered the ADD path ALONE, and an earlier revision of it stated the
   *  conclusion unscoped ("none defeats it"); an earlier one still named
   *  `RaidCausedByField` (`raid-edit-fields.tsx`) as a violator because its
   *  `onAdd` arrow does not clear the query — false, the `addCausedBy` it calls
   *  clears the query one layer down in `raid-edit-modal.tsx`. Every backticked
   *  name in that claim was real, so no symbol check could object. Enumerate
   *  the callers before repeating any of it, and follow each `onAdd` into its
   *  handler (the `$` anchor keeps this comment out of its own result, the `-v`
   *  drops the test file):
   *    grep -rn "<EntityLinkPicker$" src/app --include=*.tsx | grep -v "\.test\."
   *
   *  ★ The add-path clear is still asserted for its own sake by "clears the
   *  search query when a cause is added" (`raid-edit-modal.test.tsx`) — it is
   *  what empties the field and closes the list after an add. Its sibling "does
   *  not add a second cause when Enter is pressed again on an unchanged query"
   *  is now belt-and-braces: the hook's identity check catches that shrink
   *  independently. */
  options: readonly LinkPickerEntry[];
  query: string;
  onQueryChange: (value: string) => void;
  onAdd: (entry: LinkPickerEntry) => void;
  onRemove: (entry: LinkPickerEntry) => void;
  /** Accessible name for the search box. A placeholder is NOT an accessible
   *  name (it fails the axe gate), so this is required, not optional. */
  searchLabel: string;
  placeholder: string;
  /** Base name for each chip's × button; the chip's `code` is appended so the
   *  N remove buttons in a list get row-UNIQUE names (WCAG 2.4.6) instead of N
   *  identical ones. `title` keeps the short unsuffixed wording. */
  removeLabel: string;
  /** Already-translated accessible name for the query box's clear button.
   *  Callers QUALIFY it (e.g. "Clear – Linked tasks – <card name>") because
   *  several pickers can render on one surface, and N identical "Clear" names
   *  is a WCAG 2.4.6 failure — the same reason `removeLabel` gets the chip's
   *  `code` appended. */
  clearLabel: string;
  /** Makes each chip's body a button that navigates to that entity. Omit and
   *  the chip body is inert text — there is nowhere to go. Takes the ENTRY,
   *  not a bare id: a picker spanning several entity kinds has colliding ids
   *  (a document's task#7 and raid#7 both resolve to `7`), so a caller that
   *  needs the kind reads it off `entry.key`/`entry.code` itself. */
  onOpen?: (entry: LinkPickerEntry) => void;
  /** Matches the surrounding form's control scale. */
  inputSize?: "xs" | "md";
}

export function EntityLinkPicker({
  selected,
  options,
  query,
  onQueryChange,
  onAdd,
  onRemove,
  searchLabel,
  placeholder,
  removeLabel,
  clearLabel,
  onOpen,
  inputSize = "xs",
}: EntityLinkPickerProps) {
  // ★ The commit call stays at THIS call site, and it is the plain handler:
  // this picker adds the WHOLE entry, which is why the hook hands the option
  // back rather than unwrapping a field of it (the single-select sibling
  // unwraps a `value` in its own `onCommit`).
  //
  // ★★ `identity` is `entryKey`, NOT `String(entry.id)`: a picker spanning
  // several entity kinds has colliding ids (a document's task#7 and raid#7 both
  // resolve to `7`), so the highlight is armed against the same key that gives
  // the rendered rows their React `key`. Pinned by "arms the highlight against
  // the entry key, not the id it shares with another kind".
  const { listId, listRef, open, active, onKeyDown, reopen } =
    useEntityCombobox<LinkPickerEntry>({
      query,
      options,
      identity: entryKey,
      onCommit: onAdd,
    });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {selected.length === 0 && (
          <span className="text-xs italic text-muted-foreground">—</span>
        )}
        {selected.map((entry) => (
          <span
            key={entryKey(entry)}
            className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground"
          >
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(entry)}
                title={entry.label}
                // Named explicitly rather than left to name-from-content:
                // adjacent inline spans concatenate with NO separator, so the
                // computed name was "R#3Vendor delay". A space text node
                // between them would fix the name but become a stray flex item
                // in this `gap-1` row, so the name is pinned here instead
                // (CalendarChip's `ariaLabel` precedent).
                aria-label={`${entry.code} ${entry.label}`}
                className={`inline-flex items-center gap-1 hover:underline ${INTERACTIVE}`}
              >
                {/* The ↩ glyph rides the presence of onOpen rather than a prop
                    of its own: it means "jump to this", which is exactly the
                    affordance onOpen adds. aria-hidden — the chip's own text
                    already names the target. */}
                <span aria-hidden="true" className="font-mono">
                  ↩
                </span>
                <span className="font-mono">{entry.code}</span>
                <span className="max-w-full truncate">{entry.label}</span>
              </button>
            ) : (
              <>
                <span className="font-mono">{entry.code}</span>
                <span className="max-w-full truncate">{entry.label}</span>
              </>
            )}
            <IconButton
              variant="danger"
              onClick={() => onRemove(entry)}
              // ★ In the INERT branch (no onOpen) this remove button is the chip's only
              // focusable element, so a name of just "Unlink Risk#3" leaves a
              // screen-reader user with a code and no idea what it refers to —
              // the chip's own label is unreachable. The click-through branch
              // already names the entity on the chip body, so it only needs the
              // code here (row-uniqueness) and stays terse.
              label={
                onOpen
                  ? `${removeLabel} ${entry.code}`
                  : `${removeLabel} ${entry.code} ${entry.label}`
              }
              // Visible tooltip stays short in both branches.
              title={removeLabel}
            >
              <XMarkIcon aria-hidden="true" className="h-3 w-3" />
            </IconButton>
          </span>
        ))}
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
              // violation, and the keyboard path is aria-activedescendant, so
              // the button bought nothing. Mirrors global-search-box.
              <li
                key={entryKey(entry)}
                id={entityOptionId(listId, i)}
                role="option"
                aria-selected={i === active}
                // Keeps focus in the input so commit-on-blur callers don't close
                // the editor out from under the add (ResourcePicker precedent).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onAdd(entry)}
                // ★★ The active row keeps `text-foreground`. `text-ui-dark-blue`
                // is the brand NAVY, which in every dark scheme sits on a dark
                // `--surface-muted` at ~1.0-1.2:1 — the arrowed-to option would
                // be marked by its text becoming INVISIBLE. The row background
                // cannot carry the state alone either: `bg-surface-muted` is
                // ~1.1:1 against the dropdown's own `bg-surface` AND is what
                // inactive rows use on hover.
                // ★★ The ring is `--foreground`, NOT an accent. Any brand accent
                // is tuned for one mode: `ring-ui-green` measures 6.0-7.9:1 on
                // the dark row fills but only 1.7-2.1:1 on the light ones, under
                // the 3:1 WCAG 1.4.11 asks of a non-text state indicator — which
                // would have left light schemes leaning on `font-medium` alone.
                // `--foreground` clears 3:1 against that fill in every shipped
                // scheme because it is the text colour FOR that surface — 12-15:1
                // in the six built-ins, and 4.79:1 in AIPM/Mockup light, whose
                // foreground is a mid grey rather than near-black. State cues
                // here must be scheme-independent; pinned by scheme-contrast-cues.test.ts.
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
