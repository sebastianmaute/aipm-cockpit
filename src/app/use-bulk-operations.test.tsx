// src/app/use-bulk-operations.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Lang } from "./i18n";
import type { Task } from "./types";
import { defaultSettings } from "./settings-types";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import { TaskFormProvider, useTaskForm } from "./task-form-context";
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
    showToast: vi.fn(),
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
    }),
    { wrapper: Wrapper },
  );
  return { result, args };
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
            notes: "",
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
            notes: "",
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
      const capture = vi.fn();
      const { result } = renderBulk({ logActivity, showToast, capture });
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
            notes: "",
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
      // Undo captured the selected row's PRE-edit image (priority still Medium).
      expect(capture).toHaveBeenCalledTimes(1);
      const capOpts = capture.mock.calls[0][0] as { kind: string; edited: { id: number; priority: string }[] };
      expect(capOpts.kind).toBe("bulk.edit");
      expect(capOpts.edited).toEqual([expect.objectContaining({ id: 1, priority: "Medium" })]);
    });

    it("skips Jira-managed fields on synced rows but applies local-only fields; warns", () => {
      const { result, args } = renderBulk({});
      const base = {
        assignee: "Alice", assigneeEmail: "", dueDate: "2026-06-01",
        lastUpdateDate: "2026-05-20", status: "To Do" as const, priority: "Medium" as const,
        blockers: "", notes: "", group: "", inquiriesSent: 0,
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
            blockers: "", notes: "", group: "", inquiriesSent: 0, localModifiedAt: "STAMP" },
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
      notes: "",
      inquiriesSent: 0,
      localModifiedAt: "2026-05-20T00:00:00.000Z",
    });

    it("does nothing when tasks is empty", () => {
      const { result } = renderBulk();
      act(() => { result.current.bulk.handleClearAll(); });
      expect(result.current.workspace.tasks).toHaveLength(0);
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
        notes: "",
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
            notes: "",
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
            notes: "",
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
        notes: "",
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
});
