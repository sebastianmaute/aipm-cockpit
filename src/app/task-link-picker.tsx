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

  // A selected id whose task is gone still renders (with an empty name) so the
  // stale link stays visible and unlinkable — dropping the chip would hide a
  // dangling reference the user can no longer clear.
  const selected = useMemo(
    () => selectedIds.map((tid) => toEntry(tid, tasks.find((x) => x.id === tid)?.taskName ?? "")),
    [selectedIds, tasks],
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
      onAdd={(id) => {
        onAdd(id);
        setQuery("");
      }}
      onRemove={onRemove}
      searchLabel={label}
      placeholder={t(lang, "taskLinkSearchPlaceholder")}
      removeLabel={t(lang, "taskUnlink")}
    />
  );
}
