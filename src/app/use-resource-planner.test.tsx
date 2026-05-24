// src/app/use-resource-planner.test.tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Absence, RaidItem, Resource, Role, Shift } from "./types";
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

  describe("roles modal", () => {
    it("rolesModalOpen is false initially", () => {
      const { result } = renderPlanner();
      expect(result.current.planner.rolesModalOpen).toBe(false);
    });

    it("handleOpenRolesModal sets rolesModalOpen to true", () => {
      const { result } = renderPlanner();
      act(() => { result.current.planner.handleOpenRolesModal(); });
      expect(result.current.planner.rolesModalOpen).toBe(true);
    });

    it("handleCloseRolesModal sets rolesModalOpen to false", () => {
      const { result } = renderPlanner();
      act(() => { result.current.planner.handleOpenRolesModal(); });
      act(() => { result.current.planner.handleCloseRolesModal(); });
      expect(result.current.planner.rolesModalOpen).toBe(false);
    });
  });

  describe("role CRUD", () => {
    it("resolveOrCreateRole creates a role once, then is idempotent", () => {
      const { result } = renderPlanner();
      let id1 = 0;
      let id2 = 0;
      act(() => { id1 = result.current.planner.resolveOrCreateRole(1, 1); });
      act(() => { id2 = result.current.planner.resolveOrCreateRole(1, 1); });
      expect(id1).toBe(id2);
      expect(result.current.workspace.roles).toHaveLength(1);
    });

    it("resolveOrCreateRole creates distinct roles for different discipline/grade combos", () => {
      const { result } = renderPlanner();
      let id1 = 0;
      let id2 = 0;
      act(() => { id1 = result.current.planner.resolveOrCreateRole(1, 1); });
      act(() => { id2 = result.current.planner.resolveOrCreateRole(1, 2); });
      expect(id1).not.toBe(id2);
      expect(result.current.workspace.roles).toHaveLength(2);
    });

    it("handleAssignResourceRole sets the resource's roleId", () => {
      const { result } = renderPlanner();
      const resource: Resource = {
        id: 1,
        firstName: "Sample",
        lastName: "",
        roleId: null,
        utilizationMode: "percent",
        utilization: {},
      };
      act(() => { result.current.workspace.setResources([resource]); });
      act(() => { result.current.planner.handleAssignResourceRole(1, 1, 1); });
      expect(result.current.workspace.resources[0].roleId).not.toBeNull();
    });

    it("handleClearResourceRole sets the resource's roleId to null", () => {
      const { result } = renderPlanner();
      const resource: Resource = {
        id: 1,
        firstName: "Sample",
        lastName: "",
        roleId: 5,
        utilizationMode: "percent",
        utilization: {},
      };
      act(() => { result.current.workspace.setResources([resource]); });
      act(() => { result.current.planner.handleClearResourceRole(1); });
      expect(result.current.workspace.resources[0].roleId).toBeNull();
    });

    it("handleDeleteRole removes the role and clears referencing resources' roleId", () => {
      const { result } = renderPlanner();
      const role: Role = {
        id: 5,
        disciplineId: 1,
        gradeId: 1,
        internalRate: 0,
        externalRate: 0,
      };
      const resource: Resource = {
        id: 1,
        firstName: "Sample",
        lastName: "",
        roleId: 5,
        utilizationMode: "percent",
        utilization: {},
      };
      act(() => {
        result.current.workspace.setRoles([role]);
        result.current.workspace.setResources([resource]);
      });
      act(() => { result.current.planner.handleDeleteRole(5); });
      expect(result.current.workspace.roles.some((r) => r.id === 5)).toBe(false);
      expect(result.current.workspace.resources[0].roleId).toBeNull();
    });

    it("handleSaveRole updates an existing role in-place", () => {
      const { result } = renderPlanner();
      const role: Role = {
        id: 1,
        disciplineId: 1,
        gradeId: 1,
        internalRate: 100,
        externalRate: 150,
      };
      act(() => { result.current.workspace.setRoles([role]); });
      act(() => {
        result.current.planner.handleSaveRole({ ...role, internalRate: 200 });
      });
      expect(result.current.workspace.roles[0].internalRate).toBe(200);
    });
  });

  describe("discipline CRUD", () => {
    it("handleAddDiscipline appends a trimmed discipline and returns its id", () => {
      const { result } = renderPlanner();
      act(() => {
        result.current.workspace.setDisciplines([{ id: 1, name: "Developer" }]);
      });
      let id = 0;
      act(() => { id = result.current.planner.handleAddDiscipline("  QA  ")!; });
      const added = result.current.workspace.disciplines.find((d) => d.id === id);
      expect(added?.name).toBe("QA");
    });

    it("handleAddDiscipline returns null for blank input", () => {
      const { result } = renderPlanner();
      let id: number | null = -1;
      act(() => { id = result.current.planner.handleAddDiscipline("   "); });
      expect(id).toBeNull();
    });

    it("handleRenameDiscipline updates the discipline name", () => {
      const { result } = renderPlanner();
      act(() => {
        result.current.workspace.setDisciplines([{ id: 1, name: "Developer" }]);
      });
      act(() => { result.current.planner.handleRenameDiscipline(1, "Engineer"); });
      expect(result.current.workspace.disciplines[0].name).toBe("Engineer");
    });
  });

  describe("grade CRUD", () => {
    it("handleAddGrade appends a trimmed grade and returns its id", () => {
      const { result } = renderPlanner();
      act(() => {
        result.current.workspace.setGrades([{ id: 1, name: "Junior" }]);
      });
      let id = 0;
      act(() => { id = result.current.planner.handleAddGrade("  Senior  ")!; });
      const added = result.current.workspace.grades.find((g) => g.id === id);
      expect(added?.name).toBe("Senior");
    });

    it("handleAddGrade returns null for blank input", () => {
      const { result } = renderPlanner();
      let id: number | null = -1;
      act(() => { id = result.current.planner.handleAddGrade(""); });
      expect(id).toBeNull();
    });

    it("handleRenameGrade updates the grade name", () => {
      const { result } = renderPlanner();
      act(() => {
        result.current.workspace.setGrades([{ id: 1, name: "Junior" }]);
      });
      act(() => { result.current.planner.handleRenameGrade(1, "Mid"); });
      expect(result.current.workspace.grades[0].name).toBe("Mid");
    });
  });

  describe("utilization / plan handlers", () => {
    const seedResource: Resource = {
      id: 1,
      firstName: "S",
      lastName: "",
      roleId: null,
      utilizationMode: "percent",
      utilization: {},
    };

    it("handleSetUtilization writes resource.utilization[periodKey]", () => {
      const { result } = renderPlanner();
      act(() => { result.current.workspace.setResources([seedResource]); });
      act(() => { result.current.planner.handleSetUtilization(1, "2026-02", 80); });
      expect(result.current.workspace.resources[0].utilization["2026-02"]).toBe(80);
    });

    it("handleSetUtilizationMode switches a resource's mode", () => {
      const { result } = renderPlanner();
      act(() => { result.current.workspace.setResources([seedResource]); });
      act(() => { result.current.planner.handleSetUtilizationMode(1, "hours"); });
      expect(result.current.workspace.resources[0].utilizationMode).toBe("hours");
    });

    it("handleSetAbsenceOverride sets and clears (null removes the key)", () => {
      const { result } = renderPlanner();
      act(() => { result.current.workspace.setResources([seedResource]); });
      act(() => { result.current.planner.handleSetAbsenceOverride(1, "2026-02", 16); });
      expect(result.current.workspace.resources[0].absenceOverride?.["2026-02"]).toBe(16);
      act(() => { result.current.planner.handleSetAbsenceOverride(1, "2026-02", null); });
      expect(result.current.workspace.resources[0].absenceOverride?.["2026-02"]).toBeUndefined();
    });

    it("handleSetPlanWindow and handleSetPlanGranularity update the plan", () => {
      const { result } = renderPlanner();
      act(() => { result.current.planner.handleSetPlanWindow("2026-01-01", "2026-06-30"); });
      act(() => { result.current.planner.handleSetPlanGranularity("week"); });
      expect(result.current.workspace.plan.startDate).toBe("2026-01-01");
      expect(result.current.workspace.plan.endDate).toBe("2026-06-30");
      expect(result.current.workspace.plan.granularity).toBe("week");
    });
  });
});
