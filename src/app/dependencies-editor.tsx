"use client";

// One direction's worth of a task's relation links, rendered by the task modal
// TWICE — once for predecessors, once for successors. Chips + a searchable
// dropdown come from the shared EntityLinkPicker (the same primitive the
// knowledge/change/raid linked-task fields use), and the option filtering from
// the shared useTaskPickerOptions, so link-to-tasks behaviour cannot drift.
//
// Direction is STRUCTURAL — the caller wraps each instance in its own labelled
// Field — so it needs no toggle, no arrow glyph and no colour. That is also
// what makes it announce correctly: EntityLinkPicker takes ONE removeLabel for
// all chips, so the direction word has to come from the instance, not the chip.
//
// The caller owns both link lists (they live on the form draft) and applies the
// successor ones on Save. Nothing here writes to another task.

import { useCallback, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Select } from "./form-controls";
import { EntityLinkPicker, type LinkPickerEntry } from "./entity-link-picker";
import { useTaskPickerOptions } from "./use-task-picker-options";
import { wouldCreateDependencyCycle } from "./sanitize";
import {
  DEPENDENCY_TYPES,
  type DependencyType,
  type Task,
  type TaskDependency,
} from "./types";

export type LinkDirection = "predecessor" | "successor";

/** Per-direction translation keys. Exhaustive by construction, so a new
 *  direction is a type error rather than a silently reused label. */
const DIRECTION_KEYS = {
  predecessor: {
    search: "depSearchPredecessors",
    type: "depTypePredecessor",
    remove: "depUnlinkPredecessor",
  },
  successor: {
    search: "depSearchSuccessors",
    type: "depTypeSuccessor",
    remove: "depUnlinkSuccessor",
  },
} as const;

export function DependencyLinkGroup({
  lang,
  direction,
  links,
  allTasks,
  ownTaskId,
  onChange,
}: {
  lang: Lang;
  direction: LinkDirection;
  /** This direction's links. For successors the entry names the OTHER task and
   *  the write lands there on Save — the shape is identical either way. */
  links: readonly TaskDependency[];
  /** Snapshot of all tasks; populates the dropdown and validates cycles. */
  allTasks: readonly Task[];
  /** Id of the task being edited; null when creating (no graph yet). */
  ownTaskId: number | null;
  onChange: (next: TaskDependency[]) => void;
}) {
  const [pendingType, setPendingType] = useState<DependencyType>("FS");
  const [query, setQuery] = useState("");
  const keys = DIRECTION_KEYS[direction];

  const taskById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const tk of allTasks) m.set(tk.id, tk);
    return m;
  }, [allTasks]);

  const selectedIds = useMemo(() => links.map((l) => l.taskId), [links]);

  // ★★★ The successor arm runs the guard REVERSED. Adding successor S means S
  // gains a dependency on this task, so the walk starts here and looks for S:
  // wouldCreateDependencyCycle(S, ownTaskId, …), NOT the predecessor form.
  // Written the predecessor way round it compiles, passes any chain-free
  // fixture, and lets the user close a cycle. Mirrors resolveSuccessorLinks,
  // which applies these links on Save — the two must agree or the picker
  // offers a link the resolver then silently skips.
  //
  // ★ The self case needs no branch: the guard returns true when its two ids
  // are equal, so the owning task filters itself out of both directions. On the
  // create path ownTaskId is null and nothing can depend on a task that does
  // not exist yet, so the guard is skipped entirely.
  //
  // ★ useCallback, not an inline arrow: useTaskPickerOptions memoises on this
  // identity, and a fresh one each render would re-filter on every keystroke-
  // free re-render.
  const extraFilter = useCallback(
    (task: Task) => {
      if (ownTaskId === null) return true;
      return direction === "successor"
        ? !wouldCreateDependencyCycle(task.id, ownTaskId, taskById)
        : !wouldCreateDependencyCycle(ownTaskId, task.id, taskById);
    },
    [direction, ownTaskId, taskById],
  );

  const available = useTaskPickerOptions(allTasks, selectedIds, query, extraFilter);

  const selected = useMemo<LinkPickerEntry[]>(
    () =>
      links.map((link) => ({
        id: link.taskId,
        // The type rides `code`, which EntityLinkPicker renders monospace and
        // appends to each remove button's name — so two links to different
        // tasks get row-unique names (WCAG 2.4.6).
        code: `${link.type} #${link.taskId}`,
        label: taskById.get(link.taskId)?.taskName ?? t(lang, "depMissing"),
      })),
    [links, taskById, lang],
  );

  const options = useMemo<LinkPickerEntry[]>(
    () => available.map((tk) => ({ id: tk.id, code: `#${tk.id}`, label: tk.taskName })),
    [available],
  );

  const searchLabel = t(lang, keys.search);

  return (
    <div className="space-y-2">
      <EntityLinkPicker
        selected={selected}
        options={options}
        query={query}
        onQueryChange={setQuery}
        onAdd={(id) => {
          onChange([...links, { taskId: id, type: pendingType }]);
          setQuery("");
        }}
        onRemove={(id) => onChange(links.filter((l) => l.taskId !== id))}
        searchLabel={searchLabel}
        // The group's own label is already direction-unique, so the clear
        // inherits that uniqueness instead of announcing a bare "Clear" twice
        // on one modal (TaskLinkPicker precedent).
        clearLabel={`${t(lang, "clear")} – ${searchLabel}`}
        placeholder={t(lang, "depSearchPlaceholder")}
        removeLabel={t(lang, keys.remove)}
      />
      <Select
        size="xs"
        value={pendingType}
        onChange={(e) => setPendingType(e.target.value as DependencyType)}
        aria-label={t(lang, keys.type)}
        className="font-mono"
      >
        {DEPENDENCY_TYPES.map((dt) => (
          <option key={dt} value={dt}>
            {dt} — {t(lang, depTypeShortKey(dt))}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Translation key for a one-word friendly name of each dependency type. */
function depTypeShortKey(
  type: DependencyType,
): "depTypeFsShort" | "depTypeSsShort" | "depTypeFfShort" | "depTypeSfShort" {
  switch (type) {
    case "FS":
      return "depTypeFsShort";
    case "SS":
      return "depTypeSsShort";
    case "FF":
      return "depTypeFfShort";
    case "SF":
      return "depTypeSfShort";
  }
}
