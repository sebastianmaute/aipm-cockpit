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
    today: "2026-06-20",
    logActivity: vi.fn(),
    showToast: vi.fn(),
    workdayHours: 8,
    holidaySet: new Set<string>(),
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

    it("handleOpenAddAbsence drops a non-plain (event-like) seed instead of spreading it", () => {
      const { result } = renderPlanner();
      // Simulate `onClick={onAddAbsence}` forwarding a React synthetic event.
      // A real SyntheticEvent is a CLASS INSTANCE (non-Object prototype) carrying
      // own-enumerable `nativeEvent`/`target` — exactly what plainSeed must reject.
      class FakeSyntheticEvent {
        nativeEvent = {};
        target = {};
        currentTarget = {};
        type = "click";
      }
      const eventLike = new FakeSyntheticEvent();
      act(() => {
        // @ts-expect-error — deliberately passing an event-like object, not a Partial<Absence>.
        result.current.planner.handleOpenAddAbsence(eventLike);
      });
      const draft = result.current.planner.editingAbsence!.absence;
      expect(draft).not.toHaveProperty("nativeEvent");
      expect(draft).not.toHaveProperty("target");
      // Falls back to the empty draft shape.
      expect(draft.assignee).toBe("");
      expect(draft.id).toBe(1);
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

    it("routes absence.updated through logActivityChanges with a per-field diff (#22)", () => {
      const logActivity = vi.fn();
      const logActivityChanges = vi.fn();
      const { result } = renderPlanner({ logActivity, logActivityChanges });
      const absence: Absence = {
        id: 1,
        assignee: "Alice",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        type: "vacation",
      };
      act(() => { result.current.planner.handleSaveAbsence(absence); });
      logActivity.mockClear();
      logActivityChanges.mockClear();
      act(() => { result.current.planner.handleSaveAbsence({ ...absence, type: "sick" }); });
      expect(logActivity).not.toHaveBeenCalled();
      expect(logActivityChanges).toHaveBeenCalledOnce();
      const [kind, changes] = logActivityChanges.mock.calls[0] as [
        string,
        { field: string; from: string; to: string }[],
      ];
      expect(kind).toBe("absence.updated");
      expect(changes).toContainEqual({ field: "type", from: "vacation", to: "sick" });
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

  describe("resource activity logging", () => {
    it("handleSaveResource logs resource.created for a new resource", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const resource: Resource = {
        id: 1, firstName: "Nora", lastName: "Ito",
        roleId: null, utilizationMode: "percent", utilization: {},
      };
      act(() => { result.current.planner.handleSaveResource(resource); });
      expect(logActivity).toHaveBeenCalledOnce();
      expect(logActivity).toHaveBeenCalledWith("resource.created", 1, "Nora Ito");
    });

    it("handleSaveResource logs resource.updated for an existing resource", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const resource: Resource = {
        id: 2, firstName: "Marc", lastName: "Jordan",
        roleId: null, utilizationMode: "percent", utilization: {},
      };
      act(() => { result.current.workspace.setResources([resource]); });
      act(() => { result.current.planner.handleSaveResource({ ...resource, title: "Lead" }); });
      expect(logActivity).toHaveBeenCalledOnce();
      expect(logActivity).toHaveBeenCalledWith("resource.updated", 2, "Marc Jordan");
    });

    it("surfaces a toast and drops the edit when the resource was concurrently deleted", () => {
      const showToast = vi.fn();
      const { result } = renderPlanner({ showToast });
      const ghost: Resource = {
        id: 9, firstName: "Ghost", lastName: "Gone",
        roleId: null, utilizationMode: "percent", utilization: {},
      };
      // Open the editor (isNew=false intent), but the row is NOT in the list —
      // a concurrent writer deleted it between open and save.
      act(() => { result.current.planner.handleEditResource(ghost); });
      act(() => { result.current.planner.handleSaveResource(ghost); });
      expect(result.current.workspace.resources.find((r) => r.id === 9)).toBeUndefined();
      expect(result.current.planner.editingResource).toBeNull(); // modal still closed
      expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    });

    it("handleDeleteResource logs resource.deleted with name", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const resource: Resource = {
        id: 5, firstName: "Del", lastName: "Ete",
        roleId: null, utilizationMode: "percent", utilization: {},
      };
      act(() => { result.current.workspace.setResources([resource]); });
      act(() => { result.current.planner.handleDeleteResource(5); });
      expect(result.current.workspace.resources).toHaveLength(0);
      expect(logActivity).toHaveBeenCalledOnce();
      expect(logActivity).toHaveBeenCalledWith("resource.deleted", 5, "Del Ete");
    });
  });

  describe("role activity logging", () => {
    it("handleSaveRole logs role.updated for an existing role", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const role: Role = { id: 1, disciplineId: 2, gradeId: 3, internalRate: 100, externalRate: 150 };
      act(() => { result.current.workspace.setRoles([role]); });
      act(() => { result.current.planner.handleSaveRole({ ...role, internalRate: 200 }); });
      expect(logActivity).toHaveBeenCalledOnce();
      expect(logActivity).toHaveBeenCalledWith("role.updated", 1, "2/3");
    });

    it("resolveOrCreateRole logs role.created when creating a new role", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      act(() => { result.current.planner.resolveOrCreateRole(1, 2); });
      expect(logActivity).toHaveBeenCalledOnce();
      expect(logActivity).toHaveBeenCalledWith("role.created", expect.any(Number), "1/2");
    });

    it("resolveOrCreateRole does NOT log when role already exists (idempotent)", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const role: Role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 };
      act(() => { result.current.workspace.setRoles([role]); });
      act(() => { result.current.planner.resolveOrCreateRole(1, 1); });
      expect(logActivity).not.toHaveBeenCalled();
    });

    it("handleDeleteRole logs role.deleted with disciplineId/gradeId label", () => {
      const logActivity = vi.fn();
      const { result } = renderPlanner({ logActivity });
      const role: Role = { id: 7, disciplineId: 3, gradeId: 2, internalRate: 0, externalRate: 0 };
      act(() => { result.current.workspace.setRoles([role]); });
      act(() => { result.current.planner.handleDeleteRole(7); });
      expect(result.current.workspace.roles.some((r) => r.id === 7)).toBe(false);
      expect(logActivity).toHaveBeenCalledOnce();
      expect(logActivity).toHaveBeenCalledWith("role.deleted", 7, "3/2");
    });
  });

  describe("resource modal", () => {
    it("editingResource is null initially", () => {
      const { result } = renderPlanner();
      expect(result.current.planner.editingResource).toBeNull();
    });

    it("handleOpenAddResource opens a blank draft with isNew=true and id=1", () => {
      const { result } = renderPlanner();
      act(() => { result.current.planner.handleOpenAddResource(); });
      expect(result.current.planner.editingResource!.isNew).toBe(true);
      expect(result.current.planner.editingResource!.resource.firstName).toBe("");
      expect(result.current.planner.editingResource!.resource.id).toBe(1);
    });

    it("handleEditResource opens with isNew=false and the same resource", () => {
      const { result } = renderPlanner();
      const resource: Resource = {
        id: 3, firstName: "Sample", lastName: "Dummy",
        roleId: null, utilizationMode: "percent", utilization: {},
      };
      act(() => { result.current.planner.handleEditResource(resource); });
      expect(result.current.planner.editingResource!.isNew).toBe(false);
      expect(result.current.planner.editingResource!.resource).toBe(resource);
    });

    it("handleSaveResource adds a new resource and closes the modal", () => {
      const { result } = renderPlanner();
      act(() => { result.current.planner.handleOpenAddResource(); });
      const draft = result.current.planner.editingResource!.resource;
      act(() => { result.current.planner.handleSaveResource({ ...draft, firstName: "Nora", lastName: "Ito" }); });
      expect(result.current.planner.editingResource).toBeNull();
      expect(result.current.workspace.resources).toHaveLength(1);
      expect(result.current.workspace.resources[0].firstName).toBe("Nora");
    });

    it("does NOT clobber a resource that took the open-time id since the modal opened (id-mint race)", () => {
      const { result } = renderPlanner();
      // Open Add reserves id 1 (nextId of the empty list).
      act(() => { result.current.planner.handleOpenAddResource(); });
      const draft = result.current.planner.editingResource!.resource;
      expect(draft.id).toBe(1);
      // A concurrent writer (AI create_resource / another tab / bulk) commits id 1
      // while the modal is still open.
      act(() => {
        result.current.workspace.setResources([
          { id: 1, firstName: "AI", lastName: "Bot", roleId: null, utilizationMode: "percent", utilization: {} },
        ]);
      });
      // The user saves their draft (still carrying the stale id 1).
      act(() => { result.current.planner.handleSaveResource({ ...draft, firstName: "User", lastName: "Human" }); });
      const rs = result.current.workspace.resources;
      // Both survive: the AI row is intact, the user's is appended with a fresh id.
      expect(rs).toHaveLength(2);
      expect(rs.find((r) => r.firstName === "AI")).toBeTruthy();
      const user = rs.find((r) => r.firstName === "User");
      expect(user).toBeTruthy();
      expect(user!.id).not.toBe(1);
    });

    it("handleSaveResource updates an existing resource in place", () => {
      const { result } = renderPlanner();
      const resource: Resource = {
        id: 2, firstName: "Marc", lastName: "Jordan",
        roleId: null, utilizationMode: "percent", utilization: {},
      };
      act(() => { result.current.workspace.setResources([resource]); });
      act(() => { result.current.planner.handleSaveResource({ ...resource, title: "Lead" }); });
      expect(result.current.workspace.resources).toHaveLength(1);
      expect(result.current.workspace.resources[0].title).toBe("Lead");
    });

    it("handleDeleteResource removes by id and closes", () => {
      const { result } = renderPlanner();
      const resource: Resource = {
        id: 9, firstName: "Del", lastName: "Ete",
        roleId: null, utilizationMode: "percent", utilization: {},
      };
      act(() => { result.current.workspace.setResources([resource]); });
      act(() => { result.current.planner.handleEditResource(resource); });
      act(() => { result.current.planner.handleDeleteResource(9); });
      expect(result.current.workspace.resources).toHaveLength(0);
      expect(result.current.planner.editingResource).toBeNull();
    });

    it("handleDeleteResource cascades: removes the person's absences + shifts (by name), keeps others", () => {
      const { result } = renderPlanner();
      const del: Resource = { id: 9, firstName: "Del", lastName: "Ete", email: "del@x.io", roleId: null, utilizationMode: "percent", utilization: {} };
      const keep: Resource = { id: 10, firstName: "Kept", lastName: "One", roleId: null, utilizationMode: "percent", utilization: {} };
      act(() => { result.current.workspace.setResources([del, keep]); });
      act(() => {
        result.current.workspace.setAbsences([
          { id: 1, assignee: "Del Ete", startDate: "2026-07-01", endDate: "2026-07-02", type: "vacation" },
          { id: 2, assignee: "Kept One", startDate: "2026-07-03", endDate: "2026-07-04", type: "vacation" },
        ]);
        result.current.workspace.setShifts([
          { id: 1, assignee: "Del Ete", hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] },
          { id: 2, assignee: "Kept One", hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] },
        ]);
      });
      act(() => { result.current.planner.handleDeleteResource(9); });
      expect(result.current.workspace.absences.map((a) => a.id)).toEqual([2]);
      expect(result.current.workspace.shifts.map((s) => s.id)).toEqual([2]);
    });

    it("cascade does NOT sweep a surviving twin's entries on a name collision (name-only match)", () => {
      const { result } = renderPlanner();
      const del: Resource = { id: 5, firstName: "John", lastName: "Smith", roleId: null, utilizationMode: "percent", utilization: {} };
      const twin: Resource = { id: 9, firstName: "John", lastName: "Smith", roleId: null, utilizationMode: "percent", utilization: {} };
      act(() => { result.current.workspace.setResources([del, twin]); });
      act(() => {
        result.current.workspace.setAbsences([
          // Precise link to the deleted resource → removed.
          { id: 1, resourceId: 5, assignee: "John Smith", startDate: "2026-07-01", endDate: "2026-07-02", type: "vacation" },
          // No resourceId, name shared with the surviving twin → KEPT (ambiguous).
          { id: 2, assignee: "John Smith", startDate: "2026-07-03", endDate: "2026-07-04", type: "vacation" },
        ]);
      });
      act(() => { result.current.planner.handleDeleteResource(5); });
      expect(result.current.workspace.absences.map((a) => a.id)).toEqual([2]);
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
        stakeholderIds: [],
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
        stakeholderIds: [],
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

    it("re-mints a known-create whose open-time id was taken since — no clobber (id-mint race)", () => {
      const { result } = renderPlanner();
      const mk = (id: number, title: string): RaidItem => ({
        id, category: "R", title, description: "", severity: "Medium", status: "Open",
        owner: "", ownerEmail: "", mitigation: undefined, linkedTaskIds: [], causedByRaidIds: [],
        stakeholderIds: [], raisedDate: "2026-05-20", targetDate: undefined,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      });
      // A concurrent writer committed id 1 after this modal opened at id 1.
      act(() => { result.current.planner.handleSaveRaidItem(mk(1, "Existing")); });
      // The modal now saves as a KNOWN create (isNew=true).
      act(() => { result.current.planner.handleSaveRaidItem(mk(1, "Fresh"), true); });
      const raid = result.current.workspace.raid as RaidItem[];
      expect(raid).toHaveLength(2);
      expect(raid.find((r) => r.title === "Existing")).toBeTruthy();
      const fresh = raid.find((r) => r.title === "Fresh");
      expect(fresh).toBeTruthy();
      expect(fresh?.id).not.toBe(1);
    });

    it("surfaces a toast and drops the edit when the RAID row was concurrently deleted", () => {
      const showToast = vi.fn();
      const { result } = renderPlanner({ showToast });
      const ghost: RaidItem = {
        id: 9, category: "R", title: "Ghost", description: "", severity: "Medium", status: "Open",
        owner: "", ownerEmail: "", mitigation: undefined, linkedTaskIds: [], causedByRaidIds: [],
        stakeholderIds: [], raisedDate: "2026-05-20", targetDate: undefined,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      };
      // Editing (isNew=false) a row not in the list — deleted by a concurrent writer.
      act(() => { result.current.planner.handleSaveRaidItem(ghost, false); });
      expect(result.current.workspace.raid).toHaveLength(0);
      expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    });

    it("persists every one of N back-to-back saves in a single tick (bulk edit)", () => {
      const { result } = renderPlanner();
      const base = (id: number, title: string): RaidItem => ({
        id, category: "R", title, description: "", severity: "Medium", status: "Open",
        owner: "", ownerEmail: "", mitigation: undefined, linkedTaskIds: [], causedByRaidIds: [],
        stakeholderIds: [], raisedDate: "2026-05-20", targetDate: undefined,
        localModifiedAt: "2026-05-20T00:00:00.000Z",
      });
      act(() => { result.current.planner.handleSaveRaidItem(base(1, "A")); });
      act(() => { result.current.planner.handleSaveRaidItem(base(2, "B")); });
      // Two updates in ONE tick (a bulk apply) — both must compose, not clobber.
      act(() => {
        result.current.planner.handleSaveRaidItem({ ...base(1, "A"), severity: "High" });
        result.current.planner.handleSaveRaidItem({ ...base(2, "B"), severity: "Low" });
      });
      const raid = result.current.workspace.raid as RaidItem[];
      expect(raid.find((r) => r.id === 1)?.severity).toBe("High");
      expect(raid.find((r) => r.id === 2)?.severity).toBe("Low");
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
        stakeholderIds: [],
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

    it("handleAssignRoleById sets an existing role id directly and clears with null", () => {
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
      act(() => { result.current.planner.handleAssignRoleById(1, 7); });
      expect(result.current.workspace.resources[0].roleId).toBe(7);
      act(() => { result.current.planner.handleAssignRoleById(1, null); });
      expect(result.current.workspace.resources[0].roleId).toBeNull();
    });

    it("handleBulkEditResources applies the same patch to ALL selected in one tick", () => {
      const { result } = renderPlanner();
      const mk = (id: number): Resource => ({ id, firstName: `R${id}`, lastName: "", roleId: null, utilizationMode: "percent", utilization: {} });
      act(() => { result.current.workspace.setResources([mk(1), mk(2), mk(3)]); });
      act(() => { result.current.planner.handleBulkEditResources([1, 2, 3], { department: "Ops", isExternal: true }); });
      // Every selected row got the patch — the functional-setter guard (not
      // last-write-wins) is what makes all three land.
      for (const r of result.current.workspace.resources) {
        expect(r).toMatchObject({ department: "Ops", isExternal: true });
      }
    });

    it("handleBulkDeleteResources removes all selected in one tick", () => {
      const { result } = renderPlanner();
      const mk = (id: number): Resource => ({ id, firstName: `R${id}`, lastName: "", roleId: null, utilizationMode: "percent", utilization: {} });
      act(() => { result.current.workspace.setResources([mk(1), mk(2), mk(3)]); });
      act(() => { result.current.planner.handleBulkDeleteResources([1, 3]); });
      expect(result.current.workspace.resources.map((r) => r.id)).toEqual([2]);
    });

    it("handleBulkDeleteResources cascades: drops absences/shifts for every deleted resource (by resourceId + name)", () => {
      const { result } = renderPlanner();
      const mk = (id: number, first: string): Resource => ({ id, firstName: first, lastName: "", roleId: null, utilizationMode: "percent", utilization: {} });
      act(() => { result.current.workspace.setResources([mk(1, "R1"), mk(2, "R2"), mk(3, "R3")]); });
      act(() => {
        result.current.workspace.setAbsences([
          { id: 1, resourceId: 1, assignee: "R1", startDate: "2026-07-01", endDate: "2026-07-02", type: "vacation" },
          { id: 2, assignee: "R3", startDate: "2026-07-01", endDate: "2026-07-02", type: "vacation" },
          { id: 3, assignee: "R2", startDate: "2026-07-01", endDate: "2026-07-02", type: "vacation" },
        ]);
        result.current.workspace.setShifts([
          { id: 1, assignee: "R1", hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] },
          { id: 2, assignee: "R2", hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] },
        ]);
      });
      act(() => { result.current.planner.handleBulkDeleteResources([1, 3]); });
      // R1 (by resourceId) + R3 (by name) gone; R2 kept.
      expect(result.current.workspace.absences.map((a) => a.id)).toEqual([3]);
      expect(result.current.workspace.shifts.map((s) => s.id)).toEqual([2]);
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

  describe("discipline/grade delete + reorder", () => {
    it("deleting a discipline degrades its roles to n/a (id 0) with zero rates", () => {
      const { result } = renderPlanner();
      act(() => {
        result.current.workspace.setDisciplines([{ id: 1, name: "Dev" }]);
        result.current.workspace.setGrades([{ id: 1, name: "Jr" }]);
        result.current.workspace.setRoles([{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }]);
      });
      act(() => { result.current.planner.onDeleteDiscipline(1); });
      expect(result.current.workspace.disciplines.some((d) => d.id === 1)).toBe(false);
      expect(result.current.workspace.roles[0].disciplineId).toBe(0);
      expect(result.current.workspace.roles[0].internalRate).toBe(0);
      expect(result.current.workspace.roles[0].externalRate).toBe(0);
      expect(result.current.workspace.roles[0].gradeId).toBe(1);
    });

    it("deleting a grade degrades its roles to n/a (id 0) with zero rates", () => {
      const { result } = renderPlanner();
      act(() => {
        result.current.workspace.setDisciplines([{ id: 1, name: "Dev" }]);
        result.current.workspace.setGrades([{ id: 1, name: "Jr" }]);
        result.current.workspace.setRoles([{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }]);
      });
      act(() => { result.current.planner.onDeleteGrade(1); });
      expect(result.current.workspace.grades.some((g) => g.id === 1)).toBe(false);
      expect(result.current.workspace.roles[0].gradeId).toBe(0);
      expect(result.current.workspace.roles[0].internalRate).toBe(0);
      expect(result.current.workspace.roles[0].externalRate).toBe(0);
      expect(result.current.workspace.roles[0].disciplineId).toBe(1);
    });

    it("reordering disciplines applies the given id order", () => {
      const { result } = renderPlanner();
      act(() => {
        result.current.workspace.setDisciplines([
          { id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" },
        ]);
      });
      act(() => { result.current.planner.onReorderDisciplines([3, 1, 2]); });
      expect(result.current.workspace.disciplines.map((d) => d.id)).toEqual([3, 1, 2]);
    });

    it("onReorderRoles rewrites each moved role's order to its new index", () => {
      const { result } = renderPlanner();
      act(() => {
        result.current.workspace.setRoles([
          { id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 },
          { id: 2, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 0 },
          { id: 3, disciplineId: 2, gradeId: 1, internalRate: 0, externalRate: 0 },
        ]);
      });
      act(() => { result.current.planner.onReorderRoles([3, 1, 2]); });
      const byId = new Map(result.current.workspace.roles.map((r) => [r.id, r.order]));
      expect(byId.get(3)).toBe(0);
      expect(byId.get(1)).toBe(1);
      expect(byId.get(2)).toBe(2);
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

    it("handleSetAllUtilizationMode converts all resources' utilization and switches mode", () => {
      // Seed: Feb 2026, monthly granularity, 8h/day, no holidays.
      // Feb 2026 = 20 workdays → possible = 20 × 8 = 160 h.
      // percent→hours: Math.round(pct/100 × 160).
      // r1 at 100% → 160 h; r2 at 50% → 80 h.
      const { result } = renderPlanner();
      const r1: Resource = {
        id: 1, firstName: "A", lastName: "", roleId: null,
        utilizationMode: "percent", utilization: { "2026-02": 100 },
      };
      const r2: Resource = {
        id: 2, firstName: "B", lastName: "", roleId: null,
        utilizationMode: "percent", utilization: { "2026-02": 50 },
      };
      act(() => { result.current.workspace.setResources([r1, r2]); });
      // Pin the plan window so generatePeriods produces exactly the "2026-02" period.
      act(() => { result.current.planner.handleSetPlanWindow("2026-02-01", "2026-02-28"); });
      act(() => { result.current.planner.handleSetAllUtilizationMode("hours"); });
      const updated = result.current.workspace.resources;
      expect(updated[0].utilizationMode).toBe("hours");
      expect(updated[1].utilizationMode).toBe("hours");
      expect(updated[0].utilization["2026-02"]).toBe(160);
      expect(updated[1].utilization["2026-02"]).toBe(80);
    });

    it("handleSetAllUtilizationMode is a no-op when all resources are already in the target mode", () => {
      const { result } = renderPlanner();
      const r1: Resource = {
        id: 1, firstName: "A", lastName: "", roleId: null,
        utilizationMode: "hours", utilization: { "2026-02": 160 },
      };
      act(() => { result.current.workspace.setResources([r1]); });
      act(() => { result.current.planner.handleSetAllUtilizationMode("hours"); });
      // Mode and utilization unchanged — localModifiedAt not updated
      expect(result.current.workspace.resources[0].utilization["2026-02"]).toBe(160);
      expect(result.current.workspace.resources[0].utilizationMode).toBe("hours");
    });
  });
});
