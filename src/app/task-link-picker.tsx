"use client";

// Reusable "link to tasks" chip picker: selected-task chips (with unlink) + a
// search box whose dropdown adds a task. Reuses the shared task-option filter
// `useTaskPickerOptions` (the same primitive the change/raid linked-task fields
// use) so the link-to-tasks behavior can't drift. Self-contained query state so
// several can render at once (e.g. one per Knowledge-library card).
import { useState } from "react";
import { type Lang, t } from "./i18n";
import { Input } from "./form-controls";
import { INTERACTIVE } from "./interaction-styles";
import { useTaskPickerOptions } from "./use-task-picker-options";
import type { Task } from "./types";

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
  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-1.5">
        {selectedIds.length === 0 && (
          <span className="text-xs italic text-muted-foreground">—</span>
        )}
        {selectedIds.map((tid) => {
          const tk = tasks.find((x) => x.id === tid);
          return (
            <span
              key={tid}
              className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground"
            >
              <span className="font-mono">#{tid}</span>
              <span className="max-w-[160px] truncate">{tk?.taskName ?? ""}</span>
              <button
                type="button"
                onClick={() => onRemove(tid)}
                aria-label={`${t(lang, "taskUnlink")} #${tid}`}
                title={t(lang, "taskUnlink")}
                className={`text-muted-foreground hover:text-ui-pink ${INTERACTIVE}`}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <div className="relative">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={label}
          placeholder={t(lang, "taskLinkSearchPlaceholder")}
          size="xs"
          className="w-full"
        />
        {query.trim() !== "" && available.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-line bg-surface">
            {available.map((tk) => (
              <li key={tk.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(tk.id);
                    setQuery("");
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  <span className="font-mono text-xs text-muted-foreground">#{tk.id}</span>
                  <span className="truncate">{tk.taskName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
