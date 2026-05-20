// src/app/use-resource-planner.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Absence, RaidItem, Shift } from "./types";
import type { Lang } from "./i18n";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import {
  useResourcePlanner,
  type UseResourcePlannerArgs,
} from "./use-resource-planner";

function makeArgs(
  overrides?: Partial<UseResourcePlannerArgs>,
): UseResourcePlannerArgs {
  return {
    lang: "en-US" as Lang,
    logActivity: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
}

function renderPlanner(overrides?: Partial<UseResourcePlannerArgs>) {
  const logActivity = vi.fn();
  const showToast = vi.fn();
  const args = makeArgs({ logActivity, showToast, ...overrides });
  const { result } = renderHook(
    () => ({
      planner: useResourcePlanner(args),
      workspace: useWorkspace(),
    }),
    {
      wrapper: ({ children }) => (
        <FiltersProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </FiltersProvider>
      ),
    },
  );
  return { result, logActivity, showToast };
}

describe("useResourcePlanner", () => {
  describe("initial state", () => {
    it("editingAbsence is null initially", () => {
      const { result } = renderPlanner();
      expect(result.current.planner.editingAbsence).toBeNull();
    });

    it("editingShift is null initially", () => {
      const { result } = renderPlanner();
      expect(result.current.planner.editingShift).toBeNull();
    });
  });

  describe("absence modal", () => {
    it("handleOpenAddAbsence sets editingAbsence with isNew=true and id=1", () => {
      const { result } = renderPlanner();
      act(() => {
        result.current.planner.handleOpenAddAbsence();
      });
      expect(result.current.planner.editingAbsence).not.toBeNull();
      expect(result.current.planner.editingAbsence!.isNew).toBe(true);
      expect(result.current.planner.editingAbsence!.absence.id).toBe(1);
    });

    it("handleEditAbsence sets editingAbsence with isNew=false", () => {
      const { result } = renderPlanner();
      const absence: Absence = {
        id: 5,
        assignee: "Alice",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        type: "vacation",
      };
      act(() => {
        result.current.planner.handleEditAbsence(absence);
      });
      expect(result.current.planner.editingAbsence!.isNew).toBe(false);
      expect(result.current.planner.editingAbsence!.absence).toBe(absence);
    });

    it("handleCloseAbsenceModal clears editingAbsence", () => {
      const { result } = renderPlanner();
      act(() => { result.current.planner.handleOpenAddAbsence(); });
      act(() => { result.current.planner.handleCloseAbsenceModal(); });
      expect(result.current.planner.editingAbsence).toBeNull();
    });

    it("handleSaveAbsence creates new absence and logs absence.created", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const absence: Absence = {
        id: 1,
        assignee: "Alice",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        type: "vacation",
      };
      act(() => { result.current.planner.handleSaveAbsence(absence); });
      expect(result.current.workspace.absences).toHaveLength(1);
      expect(result.current.workspace.absences[0].assignee).toBe("Alice");
      expect(logActivity).toHaveBeenCalledWith(
        "absence.created",
        1,
        "Alice",
        "2026-06-01",
        "2026-06-07",
      );
    });

    it("handleSaveAbsence updates existing absence and logs absence.updated", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const absence: Absence = {
        id: 1,
        assignee: "Alice",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        type: "vacation",
      };
      act(() => { result.current.planner.handleSaveAbsence(absence); });
      const updated = { ...absence, assignee: "Alice B" };
      act(() => { result.current.planner.handleSaveAbsence(updated); });
      expect(result.current.workspace.absences).toHaveLength(1);
      expect(result.current.workspace.absences[0].assignee).toBe("Alice B");
      expect(logActivity).toHaveBeenLastCalledWith(
        "absence.updated",
        1,
        "Alice B",
        "2026-06-01",
        "2026-06-07",
      );
    });

    it("handleDeleteAbsence removes absence and logs absence.deleted", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const absence: Absence = {
        id: 1,
        assignee: "Alice",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        type: "vacation",
      };
      act(() => { result.current.planner.handleSaveAbsence(absence); });
      act(() => { result.current.planner.handleDeleteAbsence(1); });
      expect(result.current.workspace.absences).toHaveLength(0);
      expect(logActivity).toHaveBeenCalledWith("absence.deleted", 1, "Alice");
    });
  });

  describe("shift modal", () => {
    it("handleSaveShift creates new shift and logs shift.created", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const shift: Shift = {
        id: 1,
        assignee: "Bob",
        hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0],
      };
      act(() => { result.current.planner.handleSaveShift(shift); });
      expect(result.current.workspace.shifts).toHaveLength(1);
      expect(result.current.workspace.shifts[0].assignee).toBe("Bob");
      expect(logActivity).toHaveBeenCalledWith("shift.created", 1, "Bob");
    });

    it("handleDeleteShift removes shift and logs shift.deleted", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const shift: Shift = {
        id: 1,
        assignee: "Bob",
        hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0],
      };
      act(() => { result.current.planner.handleSaveShift(shift); });
      act(() => { result.current.planner.handleDeleteShift(1); });
      expect(result.current.workspace.shifts).toHaveLength(0);
      expect(logActivity).toHaveBeenCalledWith("shift.deleted", 1, "Bob");
    });
  });

  describe("RAID handlers", () => {
    it("handleSaveRaidItem creates new RAID item and logs raid.created", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const item: RaidItem = {
        id: 1,
        category: "R",
        title: "Budget risk",
        description: "May overspend",
        severity: "High",
        status: "Open",
        owner: "Alice",
        ownerEmail: "alice@test.com",
        mitigation: undefined,
        linkedTaskIds: [],
        causedByRaidIds: [],
        raisedDate: "2026-05-20",
        targetDate: undefined,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.planner.handleSaveRaidItem(item); });
      expect(result.current.workspace.raid).toHaveLength(1);
      expect(logActivity).toHaveBeenCalledWith("raid.created", 1, "R", "Budget risk");
    });

    it("handleSaveRaidItem triggers auto-issue on Risk→Realized and calls showToast", () => {
      const logActivity = vi.fn();
      const showToast = vi.fn();
      const { result } = renderPlanner({ logActivity, showToast });
      const riskItem: RaidItem = {
        id: 1,
        category: "R",
        title: "Budget risk",
        description: "May overspend",
        severity: "High",
        status: "Open",
        owner: "Alice",
        ownerEmail: "alice@test.com",
        mitigation: undefined,
        linkedTaskIds: [],
        causedByRaidIds: [],
        raisedDate: "2026-05-20",
        targetDate: undefined,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.planner.handleSaveRaidItem(riskItem); });
      const realizedItem = { ...riskItem, status: "Realized" as const };
      act(() => { result.current.planner.handleSaveRaidItem(realizedItem); });
      expect(result.current.workspace.raid).toHaveLength(2);
      expect(result.current.workspace.raid[1].category).toBe("I");
      expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
      expect(logActivity).toHaveBeenCalledWith("raid.statusChanged", 1, "Open", "Realized");
      expect(logActivity).toHaveBeenCalledWith("raid.autoIssue", 1, expect.any(Number));
    });

    it("handleCreateMitigationTaskFromRaid adds task and links it to raid item", () => {
      const { result } = renderPlanner();
      const raidItem: RaidItem = {
        id: 1,
        category: "A",
        title: "Fix deployment",
        description: "Automate CI",
        severity: "Medium",
        status: "Open",
        owner: "Alice",
        ownerEmail: "alice@test.com",
        mitigation: "Write scripts",
        linkedTaskIds: [],
        causedByRaidIds: [],
        raisedDate: "2026-05-20",
        targetDate: "2026-06-01",
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      act(() => { result.current.workspace.setRaid([raidItem]); });
      let newTaskId: number | null = null;
      act(() => {
        newTaskId = result.current.planner.handleCreateMitigationTaskFromRaid(1);
      });
      expect(newTaskId).not.toBeNull();
      expect(result.current.workspace.tasks).toHaveLength(1);
      expect(result.current.workspace.tasks[0].id).toBe(newTaskId);
      expect(result.current.workspace.raid[0].linkedTaskIds).toContain(newTaskId);
    });
  });
});
