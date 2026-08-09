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

import { useCallback, useId, useMemo, useState } from "react";
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
  // Per-instance, so the two groups' captions bind to their OWN select rather
  // than both pointing at whichever rendered first.
  const typeSelectId = useId();

  const taskById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const tk of allTasks) m.set(tk.id, tk);
    return m;
  }, [allTasks]);

  // ★★ ONE CHIP PER TASK, first link wins. `sanitizeDependencies` dedupes on the
  // (taskId, type) PAIR (`pushUniqueDependency` keys on `${tid}:${type}`), so
  // [{2,"FS"},{2,"SS"}] survives sanitization and persists — reachable via the AI
  // `update_task` tool, a CSV/JSON import or a hand-edited file. Rendered raw,
  // both chips took the SAME React key (`entry.id`) and either ✕ removed both.
  // The picker itself can never mint a duplicate (the second link's task is
  // already excluded from the options), so this only normalises imported data —
  // but it makes the one-per-task model explicit rather than accidental, and it
  // feeds BOTH the chip list and the exclusion set so display, exclusion and
  // removal cannot disagree. Removal stays filter-by-taskId: one chip, one ✕,
  // and the task is unlinked entirely.
  const uniqueLinks = useMemo(() => {
    const seen = new Set<number>();
    const out: TaskDependency[] = [];
    for (const link of links) {
      if (seen.has(link.taskId)) continue;
      seen.add(link.taskId);
      out.push(link);
    }
    return out;
  }, [links]);

  const selectedIds = useMemo(() => uniqueLinks.map((l) => l.taskId), [uniqueLinks]);

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
  // not exist yet, so the guard is skipped entirely — `null` here means "no
  // restriction", which is NOT the same as an empty set.
  //
  // ★★ Computed ONCE per task-list change, not per keystroke. `filterPickerOptions`
  // applies `extraFilter` BEFORE the query filter and before `.slice(0, limit)`,
  // and `useTaskPickerOptions` memoises on `query` — so leaving the DFS inline
  // re-walked the graph once per task in the workspace on every keystroke, in
  // both mounted groups. `picker-filter.ts`'s order is deliberately NOT changed
  // (the RAID caller depends on it); the work is hoisted out of the query path
  // instead.
  const allowedIds = useMemo(() => {
    if (ownTaskId === null) return null;
    return new Set(
      allTasks
        .filter((tk) =>
          direction === "successor"
            ? !wouldCreateDependencyCycle(tk.id, ownTaskId, taskById)
            : !wouldCreateDependencyCycle(ownTaskId, tk.id, taskById),
        )
        .map((tk) => tk.id),
    );
  }, [allTasks, ownTaskId, direction, taskById]);

  // ★ useCallback, not an inline arrow: useTaskPickerOptions memoises on this
  // identity, and a fresh one each render would re-filter on every keystroke-
  // free re-render.
  const extraFilter = useCallback(
    (task: Task) => allowedIds === null || allowedIds.has(task.id),
    [allowedIds],
  );

  const available = useTaskPickerOptions(allTasks, selectedIds, query, extraFilter);

  const selected = useMemo<LinkPickerEntry[]>(
    () =>
      uniqueLinks.map((link) => ({
        id: link.taskId,
        // The type rides `code`, which EntityLinkPicker renders monospace and
        // appends to each remove button's name — so two links to different
        // tasks get row-unique names (WCAG 2.4.6).
        code: `${link.type} #${link.taskId}`,
        label: taskById.get(link.taskId)?.taskName ?? t(lang, "depMissing"),
      })),
    [uniqueLinks, taskById, lang],
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
      {/* ★★ The select governs the NEXT link added, not the ones already
          chipped above it, and an aria-label alone said that to nobody looking
          at the screen.
          ★★ A REAL <label htmlFor>, and `aria-label` STAYS. Both are needed and
          neither is redundant: `aria-label` outranks a `<label>` in the accname
          computation, so the announced name stays DIRECTION-QUALIFIED (two
          groups render on one modal, and N identical names is a WCAG 2.4.6
          failure) while the `<label>` buys the click-to-focus a <span> cannot.
          AT therefore never sees this element as a name source — dropping the
          aria-label would collapse both names to the same string.
          ★★★ WCAG 2.5.3 (label-in-name) then requires the accessible name to
          CONTAIN this visible text, which is why `depTypePredecessor` /
          `depTypeSuccessor` were reworded to end in `depTypeForNext`'s wording
          rather than keeping "…dependency type". The match is CASE-INSENSITIVE
          by the spec, not by our leniency — Understanding SC 2.5.3, "Punctuation
          and capitalization": "differences in capitalization and punctuation are
          not relevant when evaluating this criterion" (its worked example pairs
          a visible `First Name:` with `aria-label="first name"` and passes).
          https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html
          Nothing else can catch drift here — axe 4.12.1 has no label-in-name
          rule and the task modal is not in A11Y_VIEWS — so the test reads BOTH
          sides out of the DOM rather than comparing against literals. */}
      {/* Own wrapper so the caption sits TIGHT above its select (mb-1) instead
          of inheriting the group's space-y-2, which would read as two unrelated
          rows. */}
      <div>
        <label
          htmlFor={typeSelectId}
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          {t(lang, "depTypeForNext")}
        </label>
        <Select
          id={typeSelectId}
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
