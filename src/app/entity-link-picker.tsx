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
import { Input } from "./form-controls";
import { INTERACTIVE } from "./interaction-styles";

/** One selectable/selected entity, flattened to what the picker renders. */
export interface LinkPickerEntry {
  id: number;
  /** Short monospace identifier supplied by the caller, e.g. "#42" for a task
   *  or "R#7" for a RAID item. Also disambiguates the remove button's
   *  accessible name, so it must be unique within the list. */
  code: string;
  /** Human-readable name; truncates rather than wrapping. */
  label: string;
}

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
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  /** Accessible name for the search box. A placeholder is NOT an accessible
   *  name (it fails the axe gate), so this is required, not optional. */
  searchLabel: string;
  placeholder: string;
  /** Base name for each chip's × button; the chip's `code` is appended so the
   *  N remove buttons in a list get row-UNIQUE names (WCAG 2.4.6) instead of N
   *  identical ones. `title` keeps the short unsuffixed wording. */
  removeLabel: string;
  /** Makes each chip's body a button that navigates to that entity. Omit and
   *  the chip body is inert text — there is nowhere to go. */
  onOpen?: (id: number) => void;
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
  onOpen,
  inputSize = "xs",
}: EntityLinkPickerProps) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {selected.length === 0 && (
          <span className="text-xs italic text-muted-foreground">—</span>
        )}
        {selected.map((entry) => (
          <span
            key={entry.id}
            className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground"
          >
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(entry.id)}
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
                <span aria-hidden="true" className="font-mono">↩</span>
                <span className="font-mono">{entry.code}</span>
                <span className="max-w-[220px] truncate">{entry.label}</span>
              </button>
            ) : (
              <>
                <span className="font-mono">{entry.code}</span>
                <span className="max-w-[220px] truncate">{entry.label}</span>
              </>
            )}
            <button
              type="button"
              onClick={() => onRemove(entry.id)}
              aria-label={`${removeLabel} ${entry.code}`}
              title={removeLabel}
              className={`text-muted-foreground hover:text-ui-pink ${INTERACTIVE}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <Input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label={searchLabel}
          placeholder={placeholder}
          size={inputSize}
          className="w-full"
        />
        {query.trim() !== "" && options.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
            {options.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onAdd(entry.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  <span className="font-mono text-xs text-muted-foreground">{entry.code}</span>
                  <span className="truncate">{entry.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
