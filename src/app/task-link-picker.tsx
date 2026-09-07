"use client";

// The task flavour of the shared EntityLinkPicker: owns the query state and
// the task-specific option filtering (`useTaskPickerOptions`, the same
// primitive the change/raid linked-task fields use, so link-to-tasks behavior
// can't drift), then hands flat entries to the shared picker for rendering.
// Self-contained query state so several can render at once (e.g. one per
// Knowledge-library card).
import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { EntityLinkPicker, type LinkPickerEntry } from "./entity-link-picker";
import { useTaskPickerOptions } from "./use-task-picker-options";
import type { Task } from "./types";

/** Module-level (closes over nothing) so the memos below can depend on their
 *  real inputs alone — a render-scope helper would be a fresh identity every
 *  render and a fatal exhaustive-deps warning under --max-warnings=0. */
const toEntry = (id: number, name: string): LinkPickerEntry => ({
  id,
  code: `#${id}`,
  label: name,
});

export function TaskLinkPicker({
  lang,
  tasks,
  selectedIds,
  onAdd,
  onRemove,
  label,
}: {
  lang: Lang;
  tasks: readonly Task[];
  selectedIds: readonly number[];
  onAdd: (taskId: number) => void;
  onRemove: (taskId: number) => void;
  /** Accessible name for the search box (row-unique in a list). */
  label: string;
}) {
  const [query, setQuery] = useState("");
  const available = useTaskPickerOptions(tasks, selectedIds, query);

  // A selected id whose task is gone still renders so the stale link stays
  // visible and unlinkable — dropping the chip would hide a dangling reference
  // the user can no longer clear.
  // ★★★ IT NAMES ITSELF RATHER THAN RENDERING AN EMPTY LABEL. The empty string
  // this used to fall back to reached the shared picker's INERT branch, where
  // the unlink button is the chip's only focusable element and composes its
  // accessible name as `${removeLabel} ${code} ${label}` — so a dangling chip
  // announced "Unlink #99" with a trailing space, which is the bare-code state
  // that branch exists to avoid. Found by cold review 2026-09-07.
  // ★ The fallback is translated, not a literal: this string is announced.
  const selected = useMemo(
    () =>
      selectedIds.map((tid) =>
        toEntry(tid, tasks.find((x) => x.id === tid)?.taskName ?? t(lang, "taskLinkDeletedTask")),
      ),
    [selectedIds, tasks, lang],
  );
  const options = useMemo(
    () => available.map((tk) => toEntry(tk.id, tk.taskName)),
    [available],
  );

  return (
    <EntityLinkPicker
      selected={selected}
      options={options}
      query={query}
      onQueryChange={setQuery}
      onAdd={(entry) => {
        onAdd(entry.id);
        setQuery("");
      }}
      onRemove={(entry) => onRemove(entry.id)}
      searchLabel={label}
      // `label` is already row-unique per Knowledge card, so the clear inherits
      // that uniqueness instead of announcing a bare "Clear" N times.
      clearLabel={`${t(lang, "clear")} – ${label}`}
      placeholder={t(lang, "taskLinkSearchPlaceholder")}
      removeLabel={t(lang, "taskUnlink")}
    />
  );
}
