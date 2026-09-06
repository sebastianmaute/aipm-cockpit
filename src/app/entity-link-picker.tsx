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
import { useId, useRef, useState } from "react";
import { Input } from "./form-controls";
import { ClearableSearchInput } from "./clearable-search-input";
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
   *  any domain rules). Rendered only while the query is non-blank. */
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
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  // Active option index for the combobox. VIEW state, so it lives here even
  // though `query` stays controlled by the caller — the caller owns which
  // entities are linkable, not which one the keyboard is currently on.
  const [highlight, setHighlight] = useState(-1);
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
    setDismissed(false);
  }

  const hasQuery = query.trim() !== "";
  const open = hasQuery && options.length > 0 && !dismissed;
  // Clamped on READ (the band's focusChip precedent): the caller's filtering
  // can shrink `options` under a stored index, so this drops an index that is
  // now out of RANGE. It cannot detect an index that is still in range but now
  // names a DIFFERENT entity — the reconcile above covers that, because every
  // caller re-filters in response to the query changing.
  //
  // ★★ A caller that swapped `options` WITHOUT changing `query` defeats the
  // RECONCILE outright, but defeats THIS clamp only when the stale index is
  // still in range in the new list — a shrink PAST the index is still caught,
  // which is what "drops an active option that the shrinking option list no
  // longer has" (`entity-link-picker.test.tsx`) pins: the query is held at "s"
  // while the options go 2 -> 1. Saying flatly that such a swap defeats BOTH
  // guards would be licence to delete this clamp as moot, so keep the
  // condition. Only the surviving in-range case rests on the contract below.
  //
  // ★★ CONTRACT, relied on and NOT enforced. Measured 2026-09-05, ON THE ADD
  // PATH ONLY: every call site clears the query on add, so no ADD defeats it
  // today. That scope is load-bearing and an earlier revision of this line
  // dropped it, concluding flatly that "none defeats it". Enumerate them —
  // the `$` anchor is what keeps this comment out of its own result, and the
  // `-v` drops the test file (measured after writing this: 4 hits, 0 of them
  // a comment):
  //   grep -rn "<EntityLinkPicker$" src/app --include=*.tsx | grep -v "\.test\."
  // ★★ THREE clear it inline in their own `onAdd` arrow. `RaidCausedByField`
  // (`raid-edit-fields.tsx`) is the one that does NOT, and it is compliant
  // anyway: its `onAdd` calls `addCausedBy`, which clears the query itself one
  // layer down in `raid-edit-modal.tsx`. Reading the arrow alone therefore
  // misreads that caller as a violator — and it is the caller whose adds really
  // do shrink the option list (`availableCauses` excludes
  // `draft.causedByRaidIds`), so a clear lost THERE arms exactly this defect.
  // Pinned by "the query clear is load-bearing" in `raid-edit-modal.test.tsx`,
  // which the clamp below cannot substitute for: it reproduces at index 0 of
  // >= 2 matches, where the surviving index is still in RANGE.
  //
  // ★★★ THE REMOVE PATH IS OUTSIDE THAT MEASUREMENT AND DOES NOT HONOUR THE
  // CONTRACT. All four `onRemove` arrows change the caller's selected set with
  // the query untouched, and each caller's option list is derived by EXCLUDING
  // that set (`useTaskPickerOptions` for `task-link-picker.tsx` and
  // `dependencies-editor.tsx`, the `linked` set in `document-links-field.tsx`,
  // `availableCauses` in `raid-edit-modal.tsx`), so unlinking an entity that
  // still matches the standing query puts it BACK into the list and shifts
  // every index after it.
  //
  // ★★★ AND THE EXEMPTION THAT SUGGESTS ITSELF DOES NOT HOLD — checked, not
  // assumed. "Clicking a chip's remove button moves focus off the search box,
  // so Enter never reaches `onKeyDown`" covers only the very next keystroke:
  // `IconButton` sets no `onMouseDown` preventDefault, so the click really does
  // take focus — but the search box's reopen handler is `onClick` calling
  // `setDismissed(false)` and it resets nothing else, so clicking back into the
  // field restores the open list with the stale highlight intact. Read removes
  // as UNCOVERED by the measurement, never as exempt from the contract.
  const active = highlight >= 0 && highlight < options.length ? highlight : -1;

  function move(delta: 1 | -1) {
    // ★ `next` is computed OUTSIDE the updater and the scroll scheduled beside
    // it: a setState updater must be PURE, and React StrictMode double-invokes
    // it, which would schedule the rAF twice. Safe to read `active` here rather
    // than the updater's `h` — `move` is only ever called from onKeyDown, where
    // the clamped `active` is already current for this render.
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
    // ★ The list is `max-h-60 overflow-auto` (~8 rows) and the keyboard path is
    // aria-activedescendant, which browsers do NOT auto-scroll — focus never
    // moves, so nothing brings the row into view. Past row 8 the ring, the
    // weight and the fill all move below the fold, which would defeat the very
    // contrast work this component just gained. Deferred a frame so the row
    // carrying the new index has rendered.
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
      // ★ Only an ARMED option claims Enter. These pickers sit inside <form>
      // edit modals where a bare Enter submits, so swallowing it merely because
      // a dropdown happens to be open would silently break submitting from this
      // field.
      if (!open || active < 0) return;
      e.preventDefault();
      onAdd(options[active]);
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
    }
  }

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
            // ★ onCLICK, deliberately not onFocus. Escape must STICK: with an
            // onFocus reopen, tabbing away to fix something and Shift+Tabbing back
            // reopens the list over the rest of the form, and the only way to shut
            // it again is deleting the query — the dead end this release exists to
            // remove. A click is a deliberate return to the field; a focus event
            // is not. ArrowDown/Up also reopen (the APG affordance), so a keyboard
            // user is never stuck either.
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
            //   off the visible placeholder in the (common) empty state. Same
            //   rule as TableFilter and PaneSearchInput.
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
              // violation, and the keyboard path is aria-activedescendant, so
              // the button bought nothing. Mirrors global-search-box.
              <li
                key={entryKey(entry)}
                id={`${listId}-opt-${i}`}
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
