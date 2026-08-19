// src/app/use-bulk-operations.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { t, type Lang } from "./i18n";
import type { BudgetBucket, Task } from "./types";
import { defaultSettings } from "./settings-types";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { FiltersProvider, useFilters } from "./filters-context";
import { TaskFormProvider, useTaskForm } from "./task-form-context";
import { useUndoStack } from "./undo/use-undo-stack";
import { useBudgetBuckets } from "./use-budget-buckets";
import { bucketIdForTask } from "./budget-task-link";
import {
  useBulkOperations,
  type UseBulkOperationsArgs,
} from "./use-bulk-operations";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <TaskFormProvider>{children}</TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

function makeArgs(
  overrides?: Partial<UseBulkOperationsArgs>,
): UseBulkOperationsArgs {
  return {
    lang: "en-US" as Lang,
    settings: defaultSettings,
    setSettings: vi.fn(),
    handlers: {
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onSendInquiry: vi.fn(),
    },
    onCancelEdit: vi.fn(),
    logActivity: vi.fn(),
    capture: vi.fn(),
    captureFieldRows: vi.fn(),
    commitBuckets: vi.fn(),
    showToast: vi.fn(),
    today: "2026-08-03",
    holidaySet: new Set<string>(),
    ...overrides,
  };
}

function renderBulk(overrides?: Partial<UseBulkOperationsArgs>) {
  const args = makeArgs(overrides);
  const { result } = renderHook(
    () => ({
      bulk: useBulkOperations(args),
      workspace: useWorkspace(),
      taskForm: useTaskForm(),
      filters: useFilters(),
    }),
    { wrapper: Wrapper },
  );
  return { result, args };
}

// Mounts a REAL useUndoStack (and, for the bucket-composite case, a REAL
// useBudgetBuckets) beside the hook under test, rather than mocked
// capture/captureFieldRows — needed to prove a concurrent write (a note
// landed through the notes window) actually survives an undo, not merely
// that the right args were passed. Mirrors use-change-log.test.tsx's
// renderChangeLogWithRealUndo.
function renderBulkWithRealUndo(overrides?: Partial<UseBulkOperationsArgs>) {
  const logActivity = vi.fn();
  const showToast = vi.fn();
  const { result } = renderHook(
    () => {
      const undoApi = useUndoStack({
        lang: "en-US" as Lang,
        logActivity,
        showToast,
        showToastAction: vi.fn(),
      });
      const workspace = useWorkspace();
      const { commitBuckets } = useBudgetBuckets({
        budgets: workspace.budgets,
        setBudgets: workspace.setBudgets,
        capture: undoApi.capture,
        captureComposite: undoApi.captureComposite,
        logActivity,
      });
      const args = makeArgs({
        logActivity,
        showToast,
        capture: undoApi.capture,
        captureFieldRows: undoApi.captureFieldRows,
        commitBuckets,
        ...overrides,
      });
      return {
        bulk: useBulkOperations(args),
        workspace,
        taskForm: useTaskForm(),
        filters: useFilters(),
        undo: undoApi.undo,
        redo: undoApi.redo,
        // The REAL stack's metas — `captureFieldRows` pushes `edits.length` as
        // the entry's `count`, so this is where the undo label's count can be
        // compared against the toast's without mocking either.
        undoStack: undoApi.stack,
      };
    },
    { wrapper: Wrapper },
  );
  return { result, logActivity, showToast };
}

describe("useBulkOperations", () => {
  describe("initial state", () => {
    it("selectedIds is empty initially", () => {
      const { result } = renderBulk();
      expect(result.current.bulk.selectedIds.size).toBe(0);
    });

    it("allVisibleSelected is false initially", () => {
      const { result } = renderBulk();
      expect(result.current.bulk.allVisibleSelected).toBe(false);
    });
  });

  describe("selection", () => {
    it("onToggleSelect adds id; calling again removes it", () => {
      const { result } = renderBulk();
      act(() => { result.current.bulk.onToggleSelect(1); });
      expect(result.current.bulk.selectedIds.has(1)).toBe(true);
      act(() => { result.current.bulk.onToggleSelect(1); });
      expect(result.current.bulk.selectedIds.has(1)).toBe(false);
    });

    it("clearSelection empties selectedIds", () => {
      const { result } = renderBulk();
      act(() => { result.current.bulk.onToggleSelect(1); });
      act(() => { result.current.bulk.onToggleSelect(2); });
      act(() => { result.current.bulk.clearSelection(); });
      expect(result.current.bulk.selectedIds.size).toBe(0);
    });

    it("toggleSelectAllVisible selects all filtered tasks; calling again deselects", () => {
      const { result } = renderBulk();
      act(() => {
        result.current.workspace.setTasks([
          {
            id: 1,
            taskName: "Task A",
            assignee: "Alice",
            assigneeEmail: "alice@test.com",
            dueDate: "2026-06-01",
            lastUpdateDate: "2026-05-20",
            status: "To Do",
            priority: "Medium",
            blockers: "",
            description: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
          {
            id: 2,
            taskName: "Task B",
            assignee: "Bob",
            assigneeEmail: "bob@test.com",
            dueDate: "2026-06-01",
            lastUpdateDate: "2026-05-20",
            status: "To Do",
            priority: "Medium",
            blockers: "",
            description: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
        ]);
      });
      act(() => { result.current.bulk.toggleSelectAllVisible(); });
      expect(result.current.bulk.selectedIds.has(1)).toBe(true);
      expect(result.current.bulk.selectedIds.has(2)).toBe(true);
      act(() => { result.current.bulk.toggleSelectAllVisible(); });
      expect(result.current.bulk.selectedIds.size).toBe(0);
    });

    // GUARD 1 of 2 — what select-all can REACH. The hook used to derive its
    // visible set from `filteredSortedTasks`, upstream of the pane's
    // hide-finished and health filters, so it picked up invisible rows.
    it("select-all skips rows hidden by hide-finished", () => {
      const { result } = renderBulk({
        settings: { ...defaultSettings, hideFinishedTasks: true },
      });
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Open", status: "To Do" },
          { id: 2, taskName: "Finished", status: "Done", completedDate: "2026-08-01" },
          { id: 3, taskName: "Cancelled", status: "Cancelled" },
        ] as unknown as Task[]);
      });
      act(() => { result.current.bulk.toggleSelectAllVisible(); });
      expect([...result.current.bulk.selectedIds].sort()).toEqual([1]);
      // The header checkbox now reports on the SAME set it acts on AND the same
      // set the table renders. (It always agreed with itself — both read
      // `visibleIds` — so the pre-fix defect was the set, not the agreement:
      // "all selected" was true while two unrendered rows were also selected.)
      expect(result.current.bulk.allVisibleSelected).toBe(true);
    });

    it("select-all skips rows hidden by the RAG health filter", () => {
      const { result } = renderBulk();
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Overdue", status: "To Do", dueDate: "2020-01-01" },
          { id: 2, taskName: "Fine", status: "To Do", dueDate: "2027-01-01" },
        ] as unknown as Task[]);
      });
      act(() => { result.current.filters.setHealthFilter("red"); });
      act(() => { result.current.bulk.toggleSelectAllVisible(); });
      expect([...result.current.bulk.selectedIds]).toEqual([1]);
    });
  });

  describe("bulk edit", () => {
    it("applyBulkEdit shows error toast when no fields enabled", () => {
      const showToast = vi.fn();
      const { result } = renderBulk({ showToast });
      act(() => { result.current.bulk.applyBulkEdit(); });
      expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    });

    it("applyBulkEdit patches selected tasks with enabled fields, logs bulk.edit, clears selection", () => {
      const logActivity = vi.fn();
      const showToast = vi.fn();
      const captureFieldRows = vi.fn();
      const { result } = renderBulk({ logActivity, showToast, captureFieldRows });
      act(() => {
        result.current.workspace.setTasks([
          {
            id: 1,
            taskName: "Task A",
            assignee: "Alice",
            assigneeEmail: "alice@test.com",
            dueDate: "2026-06-01",
            lastUpdateDate: "2026-05-20",
            status: "To Do",
            priority: "Medium",
            blockers: "",
            description: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
        ]);
      });
      act(() => { result.current.bulk.onToggleSelect(1); });
      act(() => {
        result.current.taskForm.setBulkEdit(prev => ({
          ...prev,
          enabled: { ...prev.enabled, priority: true },
          priority: "High",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });
      expect(result.current.workspace.tasks[0].priority).toBe("High");
      expect(logActivity).toHaveBeenCalledWith("bulk.edit", 1);
      expect(result.current.bulk.selectedIds.size).toBe(0);
      // Undo captured the selected row's field PATCH, not a whole-row image —
      // undoing it must revert only what this apply wrote (open-followups #50).
      expect(captureFieldRows).toHaveBeenCalledTimes(1);
      const capOpts = captureFieldRows.mock.calls[0][0] as {
        kind: string;
        edits: { id: number; before: Partial<Task>; after: Partial<Task> }[];
      };
      expect(capOpts.kind).toBe("bulk.edit");
      expect(capOpts.edits).toEqual([
        { id: 1, before: { priority: "Medium" }, after: { priority: "High" } },
      ]);
    });

    // GUARD 2 of 2 — what a STALE selection can REACH. Guard 1 stops select-all
    // picking up a hidden row; this stops a row selected WHILE VISIBLE from
    // being written after a later filter change hid it. The filter change is
    // the whole point: a fixture that never changes it passes either way.
    it("bulk apply never touches a selected row that a filter has since hidden", () => {
      const { result, args } = renderBulk();
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Overdue", status: "To Do", dueDate: "2020-01-01",
            priority: "Medium", assignee: "", assigneeEmail: "", blockers: "",
            description: "", inquiriesSent: 0, lastUpdateDate: "2026-05-20",
            localModifiedAt: "STAMP" },
          { id: 2, taskName: "Fine", status: "To Do", dueDate: "2027-01-01",
            priority: "Medium", assignee: "", assigneeEmail: "", blockers: "",
            description: "", inquiriesSent: 0, lastUpdateDate: "2026-05-20",
            localModifiedAt: "STAMP" },
        ] as unknown as Task[]);
      });
      // Both rows are visible right now, so both are legitimately selectable.
      act(() => { result.current.bulk.onToggleSelect(1); result.current.bulk.onToggleSelect(2); });
      expect(result.current.bulk.selectedIds.size).toBe(2);
      // …then the user narrows the view, hiding row 2 while it stays selected.
      act(() => { result.current.filters.setHealthFilter("red"); });
      act(() => {
        result.current.taskForm.setBulkEdit((prev) => ({
          ...prev,
          enabled: { ...prev.enabled, priority: true },
          priority: "High",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });

      const visible = result.current.workspace.tasks.find((x) => x.id === 1)!;
      const hidden = result.current.workspace.tasks.find((x) => x.id === 2)!;
      expect(visible.priority).toBe("High");
      // Untouched — not even a localModifiedAt bump.
      expect(hidden.priority).toBe("Medium");
      expect(hidden.localModifiedAt).toBe("STAMP");
      // The "N updated" count claims only the rows actually written.
      expect(result.current.bulk.selectedIds.size).toBe(0);
      // …and the user is TOLD about the one that was withheld. Skipping it
      // silently would look identical to an edit that simply did not take.
      expect(args.showToast).toHaveBeenCalledWith(
        "info",
        t("en-US", "bulkEditHiddenSkipped", 1),
      );
      expect(args.showToast).toHaveBeenCalledWith("info", t("en-US", "bulkEditDoneOne"));
    });

    it("a bulk apply whose whole selection is hidden writes nothing, and says so", () => {
      const logActivity = vi.fn();
      const { result, args } = renderBulk({ logActivity });
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Fine", status: "To Do", dueDate: "2027-01-01",
            priority: "Medium", localModifiedAt: "STAMP" },
        ] as unknown as Task[]);
      });
      act(() => { result.current.bulk.onToggleSelect(1); });
      const before = result.current.workspace.tasks;
      act(() => { result.current.filters.setHealthFilter("red"); });
      act(() => {
        result.current.taskForm.setBulkEdit((prev) => ({
          ...prev, enabled: { ...prev.enabled, priority: true }, priority: "High",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });
      // Reference-identical: no fresh array, so nothing dirties the workspace.
      expect(result.current.workspace.tasks).toBe(before);
      expect(logActivity).not.toHaveBeenCalledWith("bulk.edit", expect.anything());
      // The modal closes and the selection clears either way, so WITHOUT this
      // notice the whole apply is indistinguishable from one that worked.
      expect(args.showToast).toHaveBeenCalledWith(
        "info",
        t("en-US", "bulkEditHiddenSkipped", 1),
      );
      // …and it must not also claim rows were updated.
      expect(args.showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditDoneOne"));
    });

    it("skips Jira-managed fields on synced rows but applies local-only fields; warns", () => {
      const { result, args } = renderBulk({});
      const base = {
        assignee: "Alice", assigneeEmail: "", dueDate: "2026-06-01",
        lastUpdateDate: "2026-05-20", status: "To Do" as const, priority: "Medium" as const,
        blockers: "", description: "", group: "", inquiriesSent: 0,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Synced", jiraKey: "PROJ-1", ...base },
          { id: 2, taskName: "Local", ...base },
        ]);
      });
      act(() => { result.current.bulk.onToggleSelect(1); result.current.bulk.onToggleSelect(2); });
      act(() => {
        result.current.taskForm.setBulkEdit(prev => ({
          ...prev,
          enabled: { ...prev.enabled, priority: true, group: true },
          priority: "High", group: "Alpha",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });

      const synced = result.current.workspace.tasks.find(t => t.id === 1)!;
      const local = result.current.workspace.tasks.find(t => t.id === 2)!;
      // Synced: managed field (priority) skipped, local-only field (group) applied.
      expect(synced.priority).toBe("Medium");
      expect(synced.group).toBe("Alpha");
      // Non-synced: everything applied.
      expect(local.priority).toBe("High");
      expect(local.group).toBe("Alpha");
      expect(args.showToast).toHaveBeenCalledWith("info", expect.stringContaining("1"));
    });

    it("leaves a synced row untouched when only managed fields are enabled (no localModifiedAt bump)", () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const logActivity = vi.fn();
      const { result } = renderBulk({ logActivity });
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Synced", jiraKey: "PROJ-1", assignee: "Alice", assigneeEmail: "",
            dueDate: "2026-06-01", lastUpdateDate: "2026-05-20", status: "To Do", priority: "Medium",
            blockers: "", description: "", group: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
        ]);
      });
      act(() => { result.current.bulk.onToggleSelect(1); });
      act(() => {
        result.current.taskForm.setBulkEdit(prev => ({
          ...prev, enabled: { ...prev.enabled, priority: true }, priority: "High",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });
      const synced = result.current.workspace.tasks.find(t => t.id === 1)!;
      expect(synced.priority).toBe("Medium");
      expect(synced.localModifiedAt).toBe("STAMP"); // untouched
      // Nothing actually changed → no "N updated" activity logged.
      expect(logActivity).not.toHaveBeenCalledWith("bulk.edit", expect.anything());
      alertSpy.mockRestore();
    });

    it("bulk status change routes through applyStatusChange (sets completedDate on Done)", () => {
      const { result } = renderBulk({});
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "",
            lastUpdateDate: "2026-05-20", status: "To Do", priority: "Medium",
            blockers: "", description: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
        ]);
      });
      act(() => { result.current.bulk.onToggleSelect(1); });
      act(() => {
        result.current.taskForm.setBulkEdit(prev => ({
          ...prev, enabled: { ...prev.enabled, status: true }, status: "Done",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });
      const task = result.current.workspace.tasks[0];
      expect(task.status).toBe("Done");
      expect(task.completedDate).toBeTruthy(); // Done ⟺ completedDate invariant held
    });

    it("bulk status is skipped on Jira-synced rows (Jira owns status)", () => {
      const { result } = renderBulk({});
      const base = {
        assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "2026-05-20",
        status: "To Do" as const, priority: "Medium" as const, blockers: "", description: "",
        group: "", inquiriesSent: 0, localModifiedAt: "STAMP",
      };
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Synced", jiraKey: "PROJ-1", ...base },
          { id: 2, taskName: "Local", ...base },
        ]);
      });
      act(() => { result.current.bulk.onToggleSelect(1); result.current.bulk.onToggleSelect(2); });
      act(() => {
        result.current.taskForm.setBulkEdit(prev => ({
          ...prev, enabled: { ...prev.enabled, status: true }, status: "Done",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });
      const synced = result.current.workspace.tasks.find(t => t.id === 1)!;
      const local = result.current.workspace.tasks.find(t => t.id === 2)!;
      expect(synced.status).toBe("To Do");        // untouched — Jira-managed
      expect(synced.localModifiedAt).toBe("STAMP");
      expect(local.status).toBe("Done");          // non-synced applied
      expect(local.completedDate).toBeTruthy();
    });

    // ★★ open-followups §50, tasks half. A whole-row bulk-edit undo used to
    //   revert whatever a concurrent writer changed on those rows meanwhile —
    //   here, a note added through the write-through notes window. The row
    //   patch is now derived and captured as FIELD edits (buildBulkFieldEdits +
    //   captureFieldRows), which merge only the captured keys back onto the
    //   LIVE row on undo.
    //   ★★★ The note is seeded AFTER the bulk apply, not before — seeding it
    //   first would pass against the unfixed whole-row capture too (§48 trap).
    //   ★★★ ANTI-VACUITY: `noteLog` is ALSO shielded under the OLD whole-row
    //   capture by the separate WRITE_THROUGH_FIELDS backstop
    //   (use-undo-stack.ts), which landed before this conversion — so a
    //   noteLog-only assertion here passes against BOTH the fixed and the
    //   unfixed code (measured; see the task report). `group` is a normal
    //   field, NOT on that backstop list, so it is reverted by a whole-row
    //   undo and survives ONLY under the field-patch capture this fix adds —
    //   it is what actually makes this test RED on unfixed code.
    it("undoing a task bulk edit keeps a note (and any other concurrent field write) added since the apply", () => {
      const { result } = renderBulkWithRealUndo();
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Task A", assignee: "", assigneeEmail: "", dueDate: "",
            lastUpdateDate: "2026-05-20", status: "To Do", priority: "Low", group: "",
            blockers: "", description: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
          { id: 2, taskName: "Task B", assignee: "", assigneeEmail: "", dueDate: "",
            lastUpdateDate: "2026-05-20", status: "To Do", priority: "Low", group: "",
            blockers: "", description: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
        ] as unknown as Task[]);
      });
      act(() => { result.current.bulk.onToggleSelect(1); result.current.bulk.onToggleSelect(2); });
      act(() => {
        result.current.taskForm.setBulkEdit((prev) => ({
          ...prev, enabled: { ...prev.enabled, priority: true }, priority: "High",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });

      // The apply landed before we touch the undo path.
      expect(result.current.workspace.tasks.find((r) => r.id === 1)!.priority).toBe("High");

      // Two concurrent writes land on row 1 AFTER the apply — a note through
      // the write-through notes window, and a plain field edit (group) that
      // has no backstop at all. Neither is something the bulk edit's undo
      // wrote, so neither should be reverted by it.
      act(() => {
        result.current.workspace.setTasks((prev) =>
          prev.map((r) =>
            r.id === 1
              ? {
                  ...r,
                  group: "Alpha",
                  noteLog: [
                    ...(r.noteLog ?? []),
                    { id: 1, timestamp: "2026-06-10T00:00:00.000Z", html: "<p>added after the bulk edit</p>", text: "added after the bulk edit" },
                  ],
                }
              : r,
          ),
        );
      });

      act(() => { result.current.undo(); });

      const taskById = (id: number) => result.current.workspace.tasks.find((r) => r.id === id)!;
      expect(taskById(1).priority).toBe("Low");
      expect(taskById(1).noteLog?.map((n) => n.text)).toEqual(["added after the bulk edit"]);
      expect(taskById(1).group).toBe("Alpha");
      expect(taskById(2).priority).toBe("Low");
    });

    // The composite half of §50: a bulk apply that ALSO moves a budget bucket
    // link produces ONE composite undo entry spanning tasks + budgets
    // (use-budget-buckets.ts commitBuckets). The bucket link lives on the
    // BUCKET (BudgetBucket.taskIds), not on the task, so the revert is
    // asserted via bucketIdForTask rather than a task field.
    // ★★★ Same anti-vacuity note as above: `group` (not on the write-through
    // backstop) is what actually distinguishes this from unfixed code.
    it("undoing a bulk edit that ALSO moved buckets keeps concurrent writes and reverts both arrays", () => {
      const { result } = renderBulkWithRealUndo();
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Task A", assignee: "", assigneeEmail: "", dueDate: "",
            lastUpdateDate: "2026-05-20", status: "To Do", priority: "Low", group: "",
            blockers: "", description: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
        ] as unknown as Task[]);
        result.current.workspace.setBudgets([
          { id: 10, name: "Design", taskIds: [1] },
          { id: 20, name: "Build", taskIds: [] },
        ] as unknown as BudgetBucket[]);
      });
      act(() => { result.current.bulk.onToggleSelect(1); });
      act(() => {
        result.current.taskForm.setBulkEdit((prev) => ({
          ...prev,
          enabled: { ...prev.enabled, priority: true, budgetBucket: true },
          priority: "High",
          budgetBucket: "20",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });

      expect(result.current.workspace.tasks[0].priority).toBe("High");
      expect(bucketIdForTask(result.current.workspace.budgets, 1)).toBe(20);

      // A note lands through the notes window AFTER the composite apply, and a
      // plain field (group) is edited concurrently too.
      act(() => {
        result.current.workspace.setTasks((prev) =>
          prev.map((r) =>
            r.id === 1
              ? {
                  ...r,
                  group: "Alpha",
                  noteLog: [
                    { id: 1, timestamp: "2026-06-10T00:00:00.000Z", html: "<p>added after the bulk edit</p>", text: "added after the bulk edit" },
                  ],
                }
              : r,
          ),
        );
      });

      act(() => { result.current.undo(); });

      const task = result.current.workspace.tasks[0];
      expect(task.priority).toBe("Low");
      expect(task.noteLog?.map((n) => n.text)).toEqual(["added after the bulk edit"]);
      expect(task.group).toBe("Alpha");
      // The bucket move WAS reverted — this is a real composite undo, not just
      // the field patch half.
      expect(bucketIdForTask(result.current.workspace.budgets, 1)).toBe(10);
    });

    // ★★★ THE CAPTURE SET AND THE WRITE SET ARE ONE SET. The field-patch
    // conversion gated the capture on `taskEdits.length > 0` (values DIFFER)
    // while leaving the write on `taskFieldsEnabled && targetIds.length > 0`
    // (rows SELECTED). `buildBulkFieldEdits` puts `localModifiedAt` in
    // NEVER_CAPTURE, so a row whose only difference is the fresh stamp yields no
    // edit — and the write stamped it anyway. Bulk-editing a field to the value
    // the rows already hold therefore dirtied every selected row, autosaved,
    // claimed "N tasks updated" and left NOTHING on the undo stack.
    // ★★ ASSERTED ON REAL STATE, not on a `captureFieldRows` spy: the defect is
    // that the STORED ROW moved while nothing was recorded, and a spy on the
    // capture arg can only ever see the half that was already absent. The real
    // `useUndoStack` here is what makes "and nothing was recorded" observable.
    // ★★ WRITING NOTHING IS NOT THE SAME AS SAYING NOTHING. The write half above
    // is correct, but the apply then closed the modal and cleared the selection
    // in silence — indistinguishable from a swallowed error, and the exact
    // failure the `bulkEditHiddenSkipped` notice exists to prevent one case
    // over. So this pins BOTH halves: the rows are untouched AND the user is
    // told why. The "no updated toast" assertions stay key-based rather than a
    // /updated/i regex, so they cannot pass merely because the new message
    // happens to avoid that word.
    it("a bulk apply whose value every selected row ALREADY holds writes nothing, records nothing, and says so", () => {
      const { result, logActivity, showToast } = renderBulkWithRealUndo();
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Task A", assignee: "", assigneeEmail: "", dueDate: "2027-01-01",
            lastUpdateDate: "2026-05-20", status: "To Do", priority: "High", group: "",
            blockers: "", description: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
          { id: 2, taskName: "Task B", assignee: "", assigneeEmail: "", dueDate: "2027-01-01",
            lastUpdateDate: "2026-05-20", status: "To Do", priority: "High", group: "",
            blockers: "", description: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
        ] as unknown as Task[]);
      });
      const before = result.current.workspace.tasks;
      act(() => { result.current.bulk.onToggleSelect(1); result.current.bulk.onToggleSelect(2); });
      // The rows are ALREADY High — the apply has nothing to change but the stamp.
      act(() => {
        result.current.taskForm.setBulkEdit((prev) => ({
          ...prev, enabled: { ...prev.enabled, priority: true }, priority: "High",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });

      // The WRITE half: no fresh stamp on either row…
      expect(result.current.workspace.tasks.find((r) => r.id === 1)!.localModifiedAt).toBe("STAMP");
      expect(result.current.workspace.tasks.find((r) => r.id === 2)!.localModifiedAt).toBe("STAMP");
      // …and no fresh array either, so nothing dirties the workspace for nothing.
      expect(result.current.workspace.tasks).toBe(before);
      // The CAPTURE half: nothing written, so nothing to undo. Both halves agree.
      expect(result.current.undoStack).toHaveLength(0);
      // An apply that wrote nothing must not claim rows or log a row either.
      expect(logActivity).not.toHaveBeenCalledWith("bulk.edit", expect.anything());
      expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditDoneOne"));
      expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditDoneMany", 2));
      // …but it MUST say that nothing needed changing: nothing was withheld here
      // (no hidden row, no Jira-synced row), so this is the only notice the user
      // gets for an apply that closed the modal and cleared the selection.
      expect(showToast).toHaveBeenCalledWith("info", t("en-US", "bulkEditNoChanges"));
    });

    // ★★★ THE THREE CONJUNCTS OF THE no-changes GATE, one test each. The branch's
    // EXISTENCE is pinned by the test above (and by the bucket no-op test further
    // down); its GATING was pinned by nothing, so
    // `targetIds.length > 0 && skippedHidden === 0 && skippedSynced === 0` could
    // be cut back to either half with this whole file green. The source comment
    // spends two paragraphs justifying each conjunct; these are the observations.
    //
    // CONJUNCT `skippedHidden === 0`. Every VISIBLE target already holds the
    // value AND one selected row has since been hidden. Correct code has already
    // explained the outcome with `bulkEditHiddenSkipped`; a second toast would
    // offer the user a DIFFERENT reason for the same closed modal ("nothing
    // needed changing" vs "one row was withheld").
    // ★★ NOT reachable by "a bulk apply whose whole selection is hidden" above:
    // there `targetIds` is EMPTY, so a mutant that keeps only
    // `targetIds.length > 0` stays silent there and passes. The separator is a
    // NON-empty target set that changed nothing, WITH a withheld row beside it.
    // ★★ The `bulkEditDoneOne` assertion is load-bearing, not decoration: if the
    // fixture's visible row DID change, the FIRST branch fires and the else-if is
    // never evaluated, so the test would pass for a reason that has nothing to do
    // with its subject. It pins that the branch under test was reached at all.
    it("a no-change apply that also withheld a hidden row explains the withholding ONLY", () => {
      const showToast = vi.fn();
      const { result } = renderBulk({ showToast });
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Overdue", status: "To Do", dueDate: "2020-01-01",
            priority: "High", assignee: "", assigneeEmail: "", blockers: "",
            description: "", inquiriesSent: 0, lastUpdateDate: "2026-05-20",
            localModifiedAt: "STAMP" },
          { id: 2, taskName: "Fine", status: "To Do", dueDate: "2027-01-01",
            priority: "Low", assignee: "", assigneeEmail: "", blockers: "",
            description: "", inquiriesSent: 0, lastUpdateDate: "2026-05-20",
            localModifiedAt: "STAMP" },
        ] as unknown as Task[]);
      });
      // Both rows are visible now, so both are legitimately selectable…
      act(() => { result.current.bulk.onToggleSelect(1); result.current.bulk.onToggleSelect(2); });
      // …then row 2 is hidden while it stays selected → skippedHidden === 1.
      act(() => { result.current.filters.setHealthFilter("red"); });
      // Row 1, the only remaining target, is ALREADY High → `taskEdits` is empty
      // and `count` is 0, so the else-if is the branch that gets evaluated.
      act(() => {
        result.current.taskForm.setBulkEdit((prev) => ({
          ...prev, enabled: { ...prev.enabled, priority: true }, priority: "High",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });

      const byId = (id: number) => result.current.workspace.tasks.find((r) => r.id === id)!;
      // Nothing was written: the visible target had nothing to change, and the
      // hidden one was withheld.
      expect(byId(1).localModifiedAt).toBe("STAMP");
      expect(byId(2).priority).toBe("Low");
      expect(byId(2).localModifiedAt).toBe("STAMP");
      // The "N updated" branch did NOT fire, so the else-if WAS evaluated.
      expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditDoneOne"));
      // The user gets the withholding notice…
      expect(showToast).toHaveBeenCalledWith("info", t("en-US", "bulkEditHiddenSkipped", 1));
      // …and NOT a second, contradicting explanation for the same outcome.
      expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditNoChanges"));
    });

    // CONJUNCT `skippedSynced === 0` — the other half of the same guard, and it
    // needs its own fixture because a hidden-row fixture leaves `skippedSynced`
    // at 0 and vice versa. One selected Jira-synced row with a managed-fields-only
    // edit: `patchRow`'s `noLocalForSynced` early return leaves the row untouched,
    // so `taskEdits` is empty and `count` is 0 while `skippedSynced` is 1.
    // ★★ The fixture is deliberately the same shape as "leaves a synced row
    // untouched when only managed fields are enabled" above rather than a new
    // invention — but that test asserts the ROW and the ACTIVITY row and says
    // nothing about which toast fires, which is exactly why the gating survived
    // it. This one asserts only the toast gating.
    it("a no-change apply that also withheld a Jira-synced row explains the sync skip ONLY", () => {
      const showToast = vi.fn();
      const logActivity = vi.fn();
      const { result } = renderBulk({ showToast, logActivity });
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Synced", jiraKey: "PROJ-1", assignee: "Alice", assigneeEmail: "",
            dueDate: "2026-06-01", lastUpdateDate: "2026-05-20", status: "To Do", priority: "Medium",
            blockers: "", description: "", group: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
        ]);
      });
      act(() => { result.current.bulk.onToggleSelect(1); });
      act(() => {
        result.current.taskForm.setBulkEdit((prev) => ({
          ...prev, enabled: { ...prev.enabled, priority: true }, priority: "High",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });

      // The row is the sole VISIBLE target, so nothing here is hidden — this is
      // the `skippedSynced` conjunct on its own, not the one above.
      expect(result.current.workspace.tasks[0].localModifiedAt).toBe("STAMP");
      expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditHiddenSkipped", 1));
      // The "N updated" branch did NOT fire, so the else-if WAS evaluated.
      expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditDoneOne"));
      expect(logActivity).not.toHaveBeenCalledWith("bulk.edit", expect.anything());
      // The user gets the Jira notice…
      expect(showToast).toHaveBeenCalledWith(
        "info",
        t("en-US", "jiraBulkManagedFieldsSkipped", 1),
      );
      // …and NOT a second explanation contradicting it.
      expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditNoChanges"));
    });

    // CONJUNCT `targetIds.length > 0`. Reached with NO target rows at all:
    // nothing is selected, so `skippedHidden` (= selection size minus target count)
    // is 0 too and BOTH skip guards are satisfied. Correct code stays silent;
    // without this conjunct the apply announces "those rows already hold those
    // values" about no rows.
    // ★★ An empty selection is the ONLY way to reach an empty `targetIds` with
    // `skippedHidden === 0`, which is why "a bulk apply whose whole selection is
    // hidden" above (selection 1, targets 0, skippedHidden 1) cannot cover this:
    // its `skippedHidden` is non-zero, so a mutant keeping the two skip guards
    // stays silent there anyway.
    // ★★ ANTI-VACUITY: "a toast did NOT fire" also holds if the callback never
    // got there, so two positive observables pin that it did — the
    // `bulkEditNoFields` early return did NOT fire (a field really was enabled),
    // and the draft was reset, which happens on the line AFTER the branch.
    it("an apply with no target rows at all stays silent (nothing to say it about)", () => {
      const showToast = vi.fn();
      const logActivity = vi.fn();
      const { result } = renderBulk({ showToast, logActivity });
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Unselected", status: "To Do", dueDate: "2027-01-01",
            priority: "Low", assignee: "", assigneeEmail: "", blockers: "",
            description: "", inquiriesSent: 0, lastUpdateDate: "2026-05-20",
            localModifiedAt: "STAMP" },
        ] as unknown as Task[]);
      });
      // Deliberately NO onToggleSelect — the row is visible but untargeted.
      expect(result.current.bulk.selectedIds.size).toBe(0);
      act(() => {
        result.current.taskForm.setBulkEdit((prev) => ({
          ...prev, enabled: { ...prev.enabled, priority: true }, priority: "High",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });

      // The two positive observables: a field WAS enabled (so the early return
      // did not fire) and the draft was reset below the branch under test.
      expect(showToast).not.toHaveBeenCalledWith("error", t("en-US", "bulkEditNoFields"));
      expect(result.current.taskForm.bulkEdit.enabled.priority).toBe(false);
      // The untargeted row is untouched.
      expect(result.current.workspace.tasks[0].priority).toBe("Low");
      expect(result.current.workspace.tasks[0].localModifiedAt).toBe("STAMP");
      expect(logActivity).not.toHaveBeenCalled();
      // The message's claim is about "those rows" — with none targeted there are
      // none for it to be about, so it must not fire.
      expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditNoChanges"));
    });

    // The PARTIAL case, which is the same invariant with a witness on both sides:
    // rows 1–2 really change, row 3 already holds the target value. Before the
    // fix all THREE were stamped while only TWO were captured, so row 3's stamp
    // was unrevertable and the undo label ("2") disagreed with the toast and the
    // activity row ("3").
    it("a partial bulk apply writes exactly the rows it records, and counts them once", () => {
      const { result, logActivity, showToast } = renderBulkWithRealUndo();
      act(() => {
        result.current.workspace.setTasks([
          { id: 1, taskName: "Task A", assignee: "", assigneeEmail: "", dueDate: "2027-01-01",
            lastUpdateDate: "2026-05-20", status: "To Do", priority: "Low", group: "",
            blockers: "", description: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
          { id: 2, taskName: "Task B", assignee: "", assigneeEmail: "", dueDate: "2027-01-01",
            lastUpdateDate: "2026-05-20", status: "To Do", priority: "Low", group: "",
            blockers: "", description: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
          { id: 3, taskName: "Task C", assignee: "", assigneeEmail: "", dueDate: "2027-01-01",
            lastUpdateDate: "2026-05-20", status: "To Do", priority: "High", group: "",
            blockers: "", description: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
        ] as unknown as Task[]);
      });
      act(() => { [1, 2, 3].forEach((id) => result.current.bulk.onToggleSelect(id)); });
      act(() => {
        result.current.taskForm.setBulkEdit((prev) => ({
          ...prev, enabled: { ...prev.enabled, priority: true }, priority: "High",
        }));
      });
      act(() => { result.current.bulk.applyBulkEdit(); });

      const byId = (id: number) => result.current.workspace.tasks.find((r) => r.id === id)!;
      expect(byId(1).priority).toBe("High");
      expect(byId(2).priority).toBe("High");
      expect(byId(1).localModifiedAt).not.toBe("STAMP");
      expect(byId(2).localModifiedAt).not.toBe("STAMP");
      // Row 3 had nothing to change, so it must not be stamped — a stamp with no
      // undo entry behind it is exactly the write this guard exists to stop.
      expect(byId(3).priority).toBe("High");
      expect(byId(3).localModifiedAt).toBe("STAMP");
      // ONE count: the undo entry, the toast and the activity row all say 2.
      expect(result.current.undoStack).toHaveLength(1);
      expect(result.current.undoStack[0].count).toBe(2);
      expect(logActivity).toHaveBeenCalledWith("bulk.edit", 2);
      expect(showToast).toHaveBeenCalledWith("info", t("en-US", "bulkEditDoneMany", 2));

      // …and the undo reverts exactly those two, leaving row 3 as it was found.
      act(() => { result.current.undo(); });
      expect(byId(1).priority).toBe("Low");
      expect(byId(2).priority).toBe("Low");
      expect(byId(3).priority).toBe("High");
      expect(byId(3).localModifiedAt).toBe("STAMP");
    });

    // ★★★ PINS `stampField: "localModifiedAt"` on BOTH capture call sites in
    // use-bulk-operations.ts — removing it from both left the suite green.
    // `buildBulkFieldEdits` never captures the stamp (NEVER_CAPTURE), so without
    // `stampField` the undo merges the before-patch and leaves the APPLY's stamp
    // sitting on the row: the content moves backwards while the sync layer is
    // told the row last changed at the apply, so the revert never propagates.
    // ★★ `stampField` re-stamps with NOW on undo AND redo (`captureFieldPart`) —
    // it does NOT restore the pre-apply value, and it must not: the undo IS a new
    // local modification the backends have to push. The assertion is therefore
    // "a stamp minted at undo time", not "the value the row had before".
    // ★ Only `Date` is faked. The apply's and the undo's stamps are otherwise
    // minted within the same millisecond and compare EQUAL, which would make this
    // pass against the unpinned code; faking every timer would put RTL and the
    // React scheduler on a stopped clock this test does not need.
    it("undo and redo of a bulk edit re-stamp localModifiedAt (stampField)", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
        const { result } = renderBulkWithRealUndo();
        act(() => {
          result.current.workspace.setTasks([
            { id: 1, taskName: "Task A", assignee: "", assigneeEmail: "", dueDate: "2027-01-01",
              lastUpdateDate: "2026-05-20", status: "To Do", priority: "Low", group: "",
              blockers: "", description: "", inquiriesSent: 0,
              localModifiedAt: "2026-05-20T00:00:00.000Z" },
          ] as unknown as Task[]);
        });
        act(() => { result.current.bulk.onToggleSelect(1); });
        act(() => {
          result.current.taskForm.setBulkEdit((prev) => ({
            ...prev, enabled: { ...prev.enabled, priority: true }, priority: "High",
          }));
        });
        act(() => { result.current.bulk.applyBulkEdit(); });
        expect(result.current.workspace.tasks[0].priority).toBe("High");
        expect(result.current.workspace.tasks[0].localModifiedAt).toBe("2026-07-01T00:00:00.000Z");

        vi.setSystemTime(new Date("2026-07-02T00:00:00.000Z"));
        act(() => { result.current.undo(); });
        expect(result.current.workspace.tasks[0].priority).toBe("Low");
        // THE KILLER: without `stampField` this is still the apply's stamp.
        expect(result.current.workspace.tasks[0].localModifiedAt).toBe("2026-07-02T00:00:00.000Z");

        vi.setSystemTime(new Date("2026-07-03T00:00:00.000Z"));
        act(() => { result.current.redo(); });
        expect(result.current.workspace.tasks[0].priority).toBe("High");
        expect(result.current.workspace.tasks[0].localModifiedAt).toBe("2026-07-03T00:00:00.000Z");
      } finally {
        vi.useRealTimers();
      }
    });

    // ★★ THE OTHER `stampField` CALL SITE. `use-bulk-operations.ts` passes it
    // twice — once to `captureFieldRows` (the pure task-field path, pinned by the
    // test above) and once to `captureFieldPart` for `tasksPart`, which is
    // reachable ONLY when a bucket change makes the entry a composite. A test
    // that never enables `budgetBucket` cannot distinguish the second site, so
    // deleting just that one would stay green without this.
    it("undo of a bulk edit that ALSO moved buckets re-stamps localModifiedAt (composite stampField)", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
        const { result } = renderBulkWithRealUndo();
        act(() => {
          result.current.workspace.setTasks([
            { id: 1, taskName: "Task A", assignee: "", assigneeEmail: "", dueDate: "2027-01-01",
              lastUpdateDate: "2026-05-20", status: "To Do", priority: "Low", group: "",
              blockers: "", description: "", inquiriesSent: 0,
              localModifiedAt: "2026-05-20T00:00:00.000Z" },
          ] as unknown as Task[]);
          result.current.workspace.setBudgets([
            { id: 10, name: "Design", taskIds: [1] },
            { id: 20, name: "Build", taskIds: [] },
          ] as unknown as BudgetBucket[]);
        });
        act(() => { result.current.bulk.onToggleSelect(1); });
        act(() => {
          result.current.taskForm.setBulkEdit((prev) => ({
            ...prev,
            enabled: { ...prev.enabled, priority: true, budgetBucket: true },
            priority: "High",
            budgetBucket: "20",
          }));
        });
        act(() => { result.current.bulk.applyBulkEdit(); });
        expect(result.current.workspace.tasks[0].localModifiedAt).toBe("2026-07-01T00:00:00.000Z");
        expect(bucketIdForTask(result.current.workspace.budgets, 1)).toBe(20);

        vi.setSystemTime(new Date("2026-07-02T00:00:00.000Z"));
        act(() => { result.current.undo(); });
        expect(result.current.workspace.tasks[0].priority).toBe("Low");
        expect(bucketIdForTask(result.current.workspace.budgets, 1)).toBe(10);
        expect(result.current.workspace.tasks[0].localModifiedAt).toBe("2026-07-02T00:00:00.000Z");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("handleClearAll", () => {
    const seedOne = () => ({
      id: 1,
      taskName: "Task A",
      assignee: "Alice",
      assigneeEmail: "alice@test.com",
      dueDate: "2026-06-01",
      lastUpdateDate: "2026-05-20",
      status: "To Do" as const,
      priority: "Medium" as const,
      blockers: "",
      description: "",
      inquiriesSent: 0,
      localModifiedAt: "2026-05-20T00:00:00.000Z",
    });

    it("does nothing when tasks is empty", () => {
      const logActivity = vi.fn();
      const { result } = renderBulk({ logActivity });
      act(() => { result.current.bulk.handleClearAll(); });
      expect(result.current.workspace.tasks).toHaveLength(0);
      expect(logActivity).not.toHaveBeenCalled();
    });

    // ★★ §163 — the USER half of the `bulk.delete` denominator fix. Before this the
    // kind had exactly ONE writer (the AI's `delete_all_tasks`), so the completion
    // trend corrected itself for AI mass deletes and not for the commoner user path.
    // The count is read BEFORE the setter clears the array.
    it("logs bulk.delete with the number of rows cleared", () => {
      const logActivity = vi.fn();
      const { result } = renderBulk({ logActivity });
      act(() => { result.current.workspace.setTasks([seedOne(), { ...seedOne(), id: 2 }]); });
      act(() => { result.current.bulk.handleClearAll(); });
      expect(logActivity).toHaveBeenCalledWith("bulk.delete", 2);
      // ★ Pin the COUNT too — `toHaveBeenCalledWith` alone passes a double-log,
      // and a duplicate row would double-subtract in the completion-trend walk.
      expect(logActivity).toHaveBeenCalledTimes(1);
    });

    it("clears all tasks unconditionally (the caller owns confirmation)", () => {
      const { result } = renderBulk();
      act(() => { result.current.workspace.setTasks([seedOne()]); });
      // No window.confirm here — the tasks view now gates this with TypeToConfirmDialog.
      act(() => { result.current.bulk.handleClearAll(); });
      expect(result.current.workspace.tasks).toHaveLength(0);
      expect(result.current.bulk.selectedIds.size).toBe(0);
    });

    it("arms allowDestructiveSave when clearing, but NOT when tasks is empty (no strand)", () => {
      const allowDestructiveSave = vi.fn();
      const { result } = renderBulk({ allowDestructiveSave });
      // empty → early-return before arming → not armed (no stranded one-shot)
      act(() => { result.current.bulk.handleClearAll(); });
      expect(allowDestructiveSave).not.toHaveBeenCalled();
      // with tasks → armed (covers the button AND voice paths, which both call handleClearAll)
      act(() => { result.current.workspace.setTasks([seedOne()]); });
      act(() => { result.current.bulk.handleClearAll(); });
      expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
    });

    it("captures all tasks before a clear-all (undo)", () => {
      const capture = vi.fn();
      const { result } = renderBulk({ capture });
      act(() => { result.current.workspace.setTasks([seedOne()]); });
      act(() => { result.current.bulk.handleClearAll(); });
      expect(capture).toHaveBeenCalledTimes(1);
      const opts = capture.mock.calls[0][0] as { kind: string; removed: unknown[] };
      expect(opts.kind).toBe("task.deleted");
      expect(opts.removed).toHaveLength(1);
    });

    it("voice 'clearAll' requests the type-to-confirm dialog instead of wiping directly", () => {
      const requestClearAllConfirm = vi.fn();
      const { result } = renderBulk({ requestClearAllConfirm });
      const confirmSpy = vi.spyOn(window, "confirm");

      // Empty → nothing to clear, no dialog requested.
      act(() => { result.current.bulk.handleCommand({ kind: "clearAll" }, "clear all"); });
      expect(requestClearAllConfirm).not.toHaveBeenCalled();

      // With tasks → requests the dialog; does NOT wipe here and never touches
      // the low-friction window.confirm (the dialog's onConfirm does the wipe).
      act(() => { result.current.workspace.setTasks([seedOne()]); });
      act(() => { result.current.bulk.handleCommand({ kind: "clearAll" }, "clear all"); });
      expect(requestClearAllConfirm).toHaveBeenCalledTimes(1);
      expect(result.current.workspace.tasks).toHaveLength(1);
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });
  });

  describe("handleBulkDelete", () => {
    const seed = (id: number) => ({
      id,
      taskName: `Task ${id}`,
      assignee: "Alice",
      assigneeEmail: "alice@test.com",
      dueDate: "2026-06-01",
      lastUpdateDate: "2026-05-20",
      status: "To Do" as const,
      priority: "Medium" as const,
      blockers: "",
      description: "",
      inquiriesSent: 0,
      localModifiedAt: "2026-05-20T00:00:00.000Z",
    });

    it("removes ONLY the selected ids (functional setter), keeping the rest", () => {
      const { result } = renderBulk();
      act(() => { result.current.workspace.setTasks([seed(1), seed(2), seed(3)]); });
      act(() => { result.current.bulk.handleBulkDelete(new Set([1, 3])); });
      expect(result.current.workspace.tasks.map((t) => t.id)).toEqual([2]);
      expect(result.current.bulk.selectedIds.size).toBe(0);
    });

    it("does nothing when the id set is empty (no arm, no capture)", () => {
      const allowDestructiveSave = vi.fn();
      const capture = vi.fn();
      const logActivity = vi.fn();
      const { result } = renderBulk({ allowDestructiveSave, capture, logActivity });
      act(() => { result.current.workspace.setTasks([seed(1)]); });
      act(() => { result.current.bulk.handleBulkDelete(new Set()); });
      expect(result.current.workspace.tasks).toHaveLength(1);
      expect(allowDestructiveSave).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
      expect(logActivity).not.toHaveBeenCalled();
    });

    // ★★ §163 — the completion trend subtracts `args[0]` of a `bulk.delete` entry
    // from the reconstructed TOTAL, so the count must be the rows actually removed.
    // `ids.size` would be wrong: a stale selection can name ids no longer present,
    // and the trend would over-subtract by the difference.
    it("logs bulk.delete with the rows REMOVED, not the ids requested", () => {
      const logActivity = vi.fn();
      const { result } = renderBulk({ logActivity });
      act(() => { result.current.workspace.setTasks([seed(1), seed(2)]); });
      // id 9 is not present — the selection is stale by one.
      act(() => { result.current.bulk.handleBulkDelete(new Set([1, 9])); });
      expect(logActivity).toHaveBeenCalledWith("bulk.delete", 1);
      expect(logActivity).toHaveBeenCalledTimes(1);
    });

    it("arms allowDestructiveSave and captures the removed rows for undo", () => {
      const allowDestructiveSave = vi.fn();
      const capture = vi.fn();
      const { result } = renderBulk({ allowDestructiveSave, capture });
      act(() => { result.current.workspace.setTasks([seed(1), seed(2)]); });
      act(() => { result.current.bulk.handleBulkDelete(new Set([2])); });
      expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledTimes(1);
      const opts = capture.mock.calls[0][0] as { kind: string; removed: { id: number }[] };
      expect(opts.kind).toBe("task.deleted");
      expect(opts.removed.map((r) => r.id)).toEqual([2]);
    });
  });

  describe("handleCommand", () => {
    it('kind="edit" calls handlers.onEdit with matching task', () => {
      const onEdit = vi.fn();
      const { result } = renderBulk({
        handlers: { onEdit, onDelete: vi.fn(), onSendInquiry: vi.fn() },
      });
      const task: Task = {
        id: 42,
        taskName: "Fix bug",
        assignee: "Alice",
        assigneeEmail: "alice@test.com",
        dueDate: "2026-06-01",
        lastUpdateDate: "2026-05-20",
        status: "To Do",
        priority: "High",
        blockers: "",
        description: "",
        inquiriesSent: 0,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.workspace.setTasks([task]); });
      act(() => {
        result.current.bulk.handleCommand({ kind: "edit", id: 42 }, "");
      });
      expect(onEdit).toHaveBeenCalledWith(task);
    });

    it('kind="search" filters visible tasks', () => {
      const { result } = renderBulk();
      act(() => {
        result.current.workspace.setTasks([
          {
            id: 1,
            taskName: "Alpha task",
            assignee: "Alice",
            assigneeEmail: "alice@test.com",
            dueDate: "2026-06-01",
            lastUpdateDate: "2026-05-20",
            status: "To Do",
            priority: "Medium",
            blockers: "",
            description: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
          {
            id: 2,
            taskName: "Beta task",
            assignee: "Bob",
            assigneeEmail: "bob@test.com",
            dueDate: "2026-06-01",
            lastUpdateDate: "2026-05-20",
            status: "To Do",
            priority: "Medium",
            blockers: "",
            description: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
        ]);
      });
      act(() => {
        result.current.bulk.handleCommand(
          { kind: "search", query: "Alpha" },
          "",
        );
      });
      expect(result.current.workspace.filteredSortedTasks).toHaveLength(1);
      expect(result.current.workspace.filteredSortedTasks[0].id).toBe(1);
    });
  });

  describe("handleBulkSendInquiry", () => {
    it("opens mailto link and logs bulk.inquiries for selected task with email", async () => {
      const logActivity = vi.fn();
      const { result } = renderBulk({ logActivity });
      const task: Task = {
        id: 1,
        taskName: "Task A",
        assignee: "Alice",
        assigneeEmail: "alice@test.com",
        dueDate: "2026-06-01",
        lastUpdateDate: "2026-05-20",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        description: "",
        inquiriesSent: 0,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.workspace.setTasks([task]); });
      act(() => { result.current.bulk.onToggleSelect(1); });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      // Bulk-send keeps a synchronous native confirm (the window.open loop must
      // stay in the click's user-activation gesture); confirm true = proceed.
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      act(() => { result.current.bulk.handleBulkSendInquiry(); });
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("mailto:alice%40test.com"),
      );
      expect(logActivity).toHaveBeenCalledWith("bulk.inquiries", 1);
      openSpy.mockRestore();
      confirmSpy.mockRestore();
    });
  });
  describe("bulk budget-bucket assignment", () => {
    // The link lives on the BUCKET, so every assertion here watches `budgets`.
    function seedBucketFixture() {
      const commitBuckets = vi.fn();
      const r = renderBulk({ commitBuckets });
      act(() => {
        r.result.current.workspace.setTasks([
          { id: 1, taskName: "a", status: "To Do" },
          { id: 2, taskName: "b", status: "To Do" },
          { id: 3, taskName: "c", status: "To Do" },
        ] as unknown as Task[]);
        r.result.current.workspace.setBudgets([
          { id: 1, name: "Design", taskIds: [1, 2] },
          { id: 2, name: "Build", taskIds: [] },
        ] as unknown as BudgetBucket[]);
      });
      act(() => { [1, 2, 3].forEach((id) => r.result.current.bulk.onToggleSelect(id)); });
      return { ...r, commitBuckets };
    }

    function enableBucket(r: ReturnType<typeof seedBucketFixture>, value: string) {
      act(() => {
        r.result.current.taskForm.setBulkEdit((b) => ({
          ...b, budgetBucket: value, enabled: { ...b.enabled, budgetBucket: true },
        }));
      });
    }

    it("bulk-links every selected task to the chosen bucket in ONE commit", () => {
      const r = seedBucketFixture();
      enableBucket(r, "2");
      act(() => { r.result.current.bulk.applyBulkEdit(); });
      expect(r.commitBuckets).toHaveBeenCalledTimes(1);
      const next = r.commitBuckets.mock.calls[0][0] as BudgetBucket[];
      expect(next.find((b) => b.id === 2)!.taskIds).toEqual([1, 2, 3]);
      expect(next.find((b) => b.id === 1)!.taskIds).toEqual([]);
    });

    it("a bucket-only apply leaves the tasks array untouched", () => {
      const r = seedBucketFixture();
      const before = r.result.current.workspace.tasks;
      enableBucket(r, "2");
      act(() => { r.result.current.bulk.applyBulkEdit(); });
      // A no-op task write would bump every selected row’s localModifiedAt,
      // which a Jira pull would then revert.
      expect(r.result.current.workspace.tasks).toBe(before);
    });

    it("a bucket bulk apply tells the boundary the caller owns the activity row", () => {
      const r = seedBucketFixture();
      enableBucket(r, "2");
      act(() => { r.result.current.bulk.applyBulkEdit(); });
      // commitBuckets is MOCKED here, so this pins the WIRING only (that callerLogs
      // is passed). The suppression itself — without which the same apply wrote a
      // SECOND bulk.edit row counting BUCKETS — is proved in use-budget-buckets.test.tsx.
      expect(r.args.logActivity).toHaveBeenCalledTimes(1);
      expect(r.args.logActivity).toHaveBeenCalledWith("bulk.edit", 3);
      expect(r.commitBuckets.mock.calls[0][1].callerLogs).toBe(true);
    });

    it("a bucket apply that changes nothing writes nothing, claims nothing, and says so", () => {
      const r = seedBucketFixture();
      // Tasks 1 and 2 are ALREADY in bucket 1; select only those, target bucket 1.
      act(() => { r.result.current.bulk.clearSelection(); });
      act(() => { [1, 2].forEach((id) => r.result.current.bulk.onToggleSelect(id)); });
      enableBucket(r, "1");
      act(() => { r.result.current.bulk.applyBulkEdit(); });
      expect(r.commitBuckets).not.toHaveBeenCalled();
      // The pre-existing code is careful never to claim rows it did not touch
      // (a managed-fields-only edit on synced rows drives count to 0). A no-op
      // bucket apply must not report "2 tasks updated" or log a bulk.edit row.
      expect(r.args.logActivity).not.toHaveBeenCalled();
      expect(r.args.showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditDoneOne"));
      expect(r.args.showToast).not.toHaveBeenCalledWith("info", t("en-US", "bulkEditDoneMany", 2));
      // The second no-change path (bucket move that moves nothing) reaches the
      // same notice as the field path: nothing was withheld, so silence would be
      // indistinguishable from a swallowed error.
      expect(r.args.showToast).toHaveBeenCalledWith("info", t("en-US", "bulkEditNoChanges"));
    });

    it("the none option unlinks the selected tasks", () => {
      const r = seedBucketFixture();
      enableBucket(r, "");
      act(() => { r.result.current.bulk.applyBulkEdit(); });
      const next = r.commitBuckets.mock.calls[0][0] as BudgetBucket[];
      expect(next.find((b) => b.id === 1)!.taskIds).toEqual([]);
    });

    it("a task field plus a bucket change produce ONE composite entry", () => {
      const r = seedBucketFixture();
      act(() => {
        r.result.current.taskForm.setBulkEdit((b) => ({
          ...b, priority: "High", enabled: { ...b.enabled, priority: true },
        }));
      });
      enableBucket(r, "2");
      act(() => { r.result.current.bulk.applyBulkEdit(); });
      expect(r.args.capture).not.toHaveBeenCalled();
      const meta = r.commitBuckets.mock.calls[0][1];
      expect(meta.kind).toBe("bulk.edit");
      expect(meta.tasksPart).not.toBeNull();
    });
  });
});
