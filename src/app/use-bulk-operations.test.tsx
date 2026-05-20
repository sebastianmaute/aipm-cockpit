// src/app/use-bulk-operations.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Lang } from "./i18n";
import type { Task } from "./types";
import { defaultSettings } from "./settings-menu";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import { TaskFormProvider } from "./task-form-context";
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
  });

  describe("bulk edit", () => {
    it("applyBulkEdit shows error toast when no fields enabled", () => {
      const showToast = vi.fn();
      const { result } = renderBulk({ showToast });
      act(() => { result.current.bulk.applyBulkEdit(); });
      expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    });
  });

  describe("handleClearAll", () => {
    it("does nothing when tasks is empty", () => {
      const { result } = renderBulk();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      act(() => { result.current.bulk.handleClearAll(); });
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it("clears tasks when window.confirm returns true", () => {
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
            priority: "Medium",
            blockers: "",
            notes: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
        ]);
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      act(() => { result.current.bulk.handleClearAll(); });
      expect(result.current.workspace.tasks).toHaveLength(0);
      expect(result.current.bulk.selectedIds.size).toBe(0);
      confirmSpy.mockRestore();
    });

    it("does NOT clear tasks when window.confirm returns false", () => {
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
            priority: "Medium",
            blockers: "",
            notes: "",
            inquiriesSent: 0,
            localModifiedAt: "2026-05-20T00:00:00.000Z",
          },
        ]);
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      act(() => { result.current.bulk.handleClearAll(); });
      expect(result.current.workspace.tasks).toHaveLength(1);
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
    it("opens mailto link and logs bulk.inquiries for selected task with email", () => {
      const logActivity = vi.fn();
      const { result } = renderBulk({ logActivity });
      const task: Task = {
        id: 1,
        taskName: "Task A",
        assignee: "Alice",
        assigneeEmail: "alice@test.com",
        dueDate: "2026-06-01",
        lastUpdateDate: "2026-05-20",
        priority: "Medium",
        blockers: "",
        notes: "",
        inquiriesSent: 0,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.workspace.setTasks([task]); });
      act(() => { result.current.bulk.onToggleSelect(1); });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
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
