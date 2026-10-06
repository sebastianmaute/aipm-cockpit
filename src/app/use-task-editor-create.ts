// src/app/use-task-editor-create.ts
//
// The task editor's "create from the editor" wiring: the create-RAID mini-form
// (Task 7) and the new-linked-task modal (Task 8). In edit mode each applies at
// once to the task being edited; in create mode, where the task has no id yet,
// each is staged in the editor buffer (`useTaskEditorBuffer`) and flushed once
// the new parent id is resolved on save. Also the live RAID mirror the RAID
// apply mints ids from, and the linked-task modal's open state. Extracted from
// task-manager.tsx (§491); move-only.
//
// ★ It keeps the inline `useCallback` memoization on purpose, against
// Extraction convention 1 (non-memoized handlers): the buffer's `flush`
// depends on both applies and feeds `useTaskBudgetLink`, so an unstable apply
// would give `flush` a new identity on every render. (`discard` has no deps in
// `use-task-editor-buffer.ts` and is stable either way.) The dependency arrays are the inline ones, with
// one addition: `handleCreateLinkedTask` now lists `tasksRef`, which arrives as
// a dep instead of a local `useRef` and is the same ref object on every render.
"use client";
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ActivityKind } from "./activity-log";
import { type RaidItem, type Task, DEFAULT_TASK_STATUS } from "./types";
import { useTaskEditorBuffer, type RaidSpec, type LinkSpec } from "./use-task-editor-buffer";
import type { LinkedTaskDraft } from "./task-linked-task-modal";
import { applyTaskLink } from "./task-link";
import { applyStatusChange } from "./task-status";
import { sanitizeRaidItem } from "./sanitize";
import { mintId } from "./id-mint-session";
import { nextRaidId } from "./raid";

export interface TaskEditorCreateDeps {
  /** task-manager's live task mirror; the linked-task create mints from it and advances it. */
  tasksRef: RefObject<readonly Task[]>;
  raid: readonly RaidItem[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  setRaid: Dispatch<SetStateAction<readonly RaidItem[]>>;
  /** The id of the task open in the editor, or null while creating a new one. */
  editingId: number | null;
  today: string;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export function useTaskEditorCreate(deps: TaskEditorCreateDeps) {
  const { tasksRef, raid, setTasks, setRaid, editingId, today, logActivity } = deps;

  // Live mirror of the RAID list so RAID created from the task editor mints ids +
  // logs OUTSIDE the setState updater (updaters must be pure — strict mode double-
  // invokes them), while staying fresh across a buffer flush loop (N in one tick).
  const raidRef = useRef(raid);
  useEffect(() => {
    raidRef.current = raid;
  }, [raid]);

  // Task editor: create RAID (Task 7) + linked tasks (Task 8) from the editor.
  // Edit-mode applies immediately; create-mode stages in `editorBuffer` and
  // flushes once the new parent id is resolved on save.
  const applyRaidFromTask = useCallback(
    (taskId: number, spec: RaidSpec) => {
      const id = nextRaidId(raidRef.current);
      const raw = {
        id,
        category: spec.category,
        title: spec.title,
        raisedDate: today,
        linkedTaskIds: [taskId],
      } as RaidItem;
      const clean = sanitizeRaidItem(raw);
      if (!clean) return; // malformed (e.g. empty title) → skip rather than persist raw
      const next = [...raidRef.current, clean];
      raidRef.current = next; // keep back-to-back flushes minting distinct ids
      setRaid(next);
      // ★★ THREE ARGS, ORDER (id, category, title) — matching `use-raid-items.ts`. `activityRaidCreated` is "RAID #{0} created ({1}): {2}" and `logActivity` ends in `...args`, so a two-arg call typechecks; it shipped, putting the title in the CATEGORY slot and rendering a literal "{2}" to the user and (since search_history) to the model. Read the SANITIZED row, not `spec` — `sanitizeRaidItem` decides what was stored. Pinned by `use-task-editor-create.test.ts`, which checks all three args against the sanitized row.
      logActivity("raid.created", clean.id, clean.category, clean.title);
    },
    [setRaid, today, logActivity],
  );
  const applyLinkFromTask = useCallback(
    (parentId: number, spec: LinkSpec) => {
      setTasks((prev) => applyTaskLink(prev, parentId, spec));
    },
    [setTasks],
  );
  const editorBuffer = useTaskEditorBuffer({ applyRaid: applyRaidFromTask, applyLink: applyLinkFromTask });
  const { stageRaid: stageEditorRaid, stageLink: stageEditorLink } = editorBuffer;

  // create-RAID (Task 7): apply immediately in edit-mode, stage in create-mode.
  const handleAddRaidFromEditor = useCallback(
    (spec: RaidSpec) => {
      if (editingId !== null) applyRaidFromTask(editingId, spec);
      else stageEditorRaid(spec);
    },
    [editingId, applyRaidFromTask, stageEditorRaid],
  );

  // create linked task (Task 8): mirror the normal create path (mint id,
  // functional setTasks, route status through applyStatusChange), then wire the
  // parent↔child link (immediate for an existing parent, staged for a new one).
  const [linkedTaskOpen, setLinkedTaskOpen] = useState(false);
  const handleCreateLinkedTask = useCallback(
    (draft: LinkedTaskDraft) => {
      const childId = mintId("task", tasksRef.current);
      const base: Task = {
        id: childId,
        taskName: draft.taskName,
        assignee: draft.assignee,
        assigneeEmail: "",
        dueDate: draft.dueDate,
        lastUpdateDate: today,
        priority: draft.priority,
        status: DEFAULT_TASK_STATUS,
        blockers: "",
        description: "",
        inquiriesSent: 0,
        dependencies: [],
      };
      const child = applyStatusChange(base, DEFAULT_TASK_STATUS, today);
      const nextList = [...tasksRef.current, child];
      tasksRef.current = nextList;
      setTasks(nextList);
      logActivity("task.created", childId, child.taskName);
      const spec: LinkSpec = { childId, direction: draft.direction, type: "FS" };
      if (editingId !== null) applyLinkFromTask(editingId, spec);
      else stageEditorLink(spec);
      // NOTE (by design): the child task is committed here immediately (real id),
      // while for a NEW parent only the LINK is staged. Cancelling the parent
      // editor discards the staged link but keeps the child task — a nested child
      // is a real task the moment it's saved, independent of the parent's outcome.
      setLinkedTaskOpen(false);
    },
    [tasksRef, today, setTasks, logActivity, editingId, applyLinkFromTask, stageEditorLink, setLinkedTaskOpen],
  );

  return { editorBuffer, handleAddRaidFromEditor, linkedTaskOpen, setLinkedTaskOpen, handleCreateLinkedTask };
}
