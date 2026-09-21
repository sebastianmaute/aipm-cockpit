"use client";

// EntityComboboxList — the `role="listbox"` dropdown both entity pickers render
// under their shared search box.
//
// ★★★ THE REASON THIS FILE DID NOT EXIST WAS MEASURED FALSE. `entity-combobox-search.tsx`
// left the listbox at the call site "because the two pickers key and commit
// their rows differently" — and they do, but that is the ONLY way they differ.
// Cold review re-measured it on 2026-09-07: comment-stripped, the two blocks
// were 29 lines each and 27 byte-identical, differing only in `key={…}` and
// `onClick={…}`. Those are exactly the two concerns `useEntityCombobox` already
// parameterises as `identity` and `onCommit`, so the stated reason for keeping
// them apart was an argument for extracting them.
//
// ★★ The cost of the duplication was not the lines — it was the CONTRAST
// RATIONALE. The full measurement lived on EntityLinkPicker's row and
// SingleEntityPicker carried a paraphrase that said outright "the measurements
// behind that are the sibling's". Neither picker is reachable from an axe
// `A11Y_VIEWS` scan, so a contrast fix landing on one file and not the other
// had nothing anywhere that would report it. One row, one rationale.
//
// Presentational and entity-agnostic: every user-facing string arrives already
// translated, so this file takes no `lang` and calls no `t()` — same contract as
// `entity-combobox-search.tsx` and both pickers.
import { entityOptionId, type EntityCombobox } from "./entity-combobox";

/** What a row needs to render. Both pickers' option types already satisfy it —
 *  `SingleEntityOption` and `LinkPickerEntry` — which is why the constraint is
 *  structural rather than a shared base interface either would have to import. */
export interface EntityComboboxOption {
  /** Short qualifier rendered monospace, e.g. "Task", "RAID" or "#42". */
  code: string;
  /** Human-readable name; truncates rather than wrapping. */
  label: string;
}

interface EntityComboboxListProps<T extends EntityComboboxOption>
  extends Pick<EntityCombobox, "listId" | "listRef" | "open" | "active"> {
  /** Candidates — ALREADY filtered by the caller. */
  options: readonly T[];
  /** React key AND the identity `useEntityCombobox` arms the highlight against.
   *  ★ Pass the SAME function given to the hook as `identity`, or the armed row
   *  and the rendered row disagree about which entry an index refers to. */
  optionKey: (option: T) => string;
  /** Commit one row. Called on click; the keyboard path commits through the
   *  hook's own `onKeyDown`, not here. */
  onPick: (option: T) => void;
}

export function EntityComboboxList<T extends EntityComboboxOption>({
  listId,
  listRef,
  open,
  active,
  options,
  optionKey,
  onPick,
}: EntityComboboxListProps<T>) {
  if (!open) return null;
  return (
    <ul
      id={listId}
      ref={listRef}
      role="listbox"
      className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface"
    >
      {options.map((entry, i) => (
        // ★ The row itself is the option — NOT a <button> inside one. An
        // interactive child of role="option" is an axe nested-interactive
        // violation, and the keyboard path is aria-activedescendant, so the
        // button bought nothing. Mirrors global-search-box.
        <li
          key={optionKey(entry)}
          id={entityOptionId(listId, i)}
          role="option"
          aria-selected={i === active}
          // Keeps focus in the input so commit-on-blur callers don't close the
          // editor out from under the selection (ResourcePicker precedent).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(entry)}
          // ★★ The active row keeps `text-foreground`. `text-ui-dark-blue` is
          // the brand NAVY, which in every dark scheme sits on a dark
          // `--surface-muted` at ~1.0-1.2:1 — the arrowed-to option would be
          // marked by its text becoming INVISIBLE. The row background cannot
          // carry the state alone either: `bg-surface-muted` is ~1.1:1 against
          // the dropdown's own `bg-surface` AND is what inactive rows use on
          // hover.
          // ★★ The ring is `--foreground`, NOT an accent. Any brand accent is
          // tuned for one mode: `ring-ui-green` measures 6.0-7.9:1 on the dark
          // row fills but only 1.7-2.1:1 on the light ones, under the 3:1 WCAG
          // 1.4.11 asks of a non-text state indicator — which would have left
          // light schemes leaning on `font-medium` alone. `--foreground` clears
          // 3:1 against that fill in every shipped scheme because it is the text
          // colour FOR that surface — 12-15:1 in the six built-ins, and 4.79:1
          // in Petrol/Mockup light, whose foreground is a mid grey rather than
          // near-black. State cues here must be scheme-independent; pinned by
          // scheme-contrast-cues.test.ts.
          // ★ Nothing here measured the rest of the palette — read this as those
          // named tokens, not as a claim about every brand accent.
          className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground ${
            i === active
              ? "bg-surface-muted font-medium ring-1 ring-inset ring-foreground"
              : "hover:bg-surface-muted"
          }`}
        >
          <span className="font-mono text-xs text-muted-foreground">{entry.code}</span>
          <span className="truncate">{entry.label}</span>
        </li>
      ))}
    </ul>
  );
}
