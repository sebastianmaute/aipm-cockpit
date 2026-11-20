import { afterEach, describe, expect, it } from "vitest";
import type { Milestone, Resource, Role, Stakeholder, Task } from "./types";
import {
  ganttSetupSteps,
  isViewSetupDismissed,
  raciSetupSteps,
  resourcesSetupSteps,
  setViewSetupDismissed,
} from "./view-setup";

const task = (over: Partial<Task> = {}) => ({ id: 1, taskName: "T", dueDate: "", ...over }) as unknown as Task;
const milestone = { id: 1, name: "M" } as unknown as Milestone;
const stakeholder = (raci: Record<string, string> = {}) => ({ id: 1, name: "S", raci }) as unknown as Stakeholder;
const role = (rate: number) => ({ id: 1, name: "Dev", internalRate: rate, externalRate: 0 }) as unknown as Role;
const person = { id: 1, firstName: "Ann", lastName: "Lee" } as unknown as Resource;

describe("ganttSetupSteps (§736)", () => {
  it("nothing done: step 1 (a dated task) is next", () => {
    expect(ganttSetupSteps({ tasks: [task()], milestones: [], milestonesApplicable: true }))
      .toEqual({ datedDone: false, depsDone: false, milestonesDone: false, milestonesApplicable: true, next: 1 });
  });
  it("a task with a due date ticks step 1; dependencies are next", () => {
    expect(ganttSetupSteps({ tasks: [task({ dueDate: "2026-12-01" })], milestones: [], milestonesApplicable: true }).next).toBe(2);
  });
  it("a dependency ticks step 2; milestones are next", () => {
    const tasks = [task({ dueDate: "2026-12-01", dependencies: [{ taskId: 2, type: "FS" }] } as Partial<Task>)];
    const s = ganttSetupSteps({ tasks, milestones: [], milestonesApplicable: true });
    expect(s.depsDone).toBe(true);
    expect(s.next).toBe(3);
  });
  it("all three done: next is null", () => {
    const tasks = [task({ dueDate: "2026-12-01", dependencies: [{ taskId: 2, type: "FS" }] } as Partial<Task>)];
    expect(ganttSetupSteps({ tasks, milestones: [milestone], milestonesApplicable: true }).next).toBeNull();
  });
  it("with milestones switched off, step 3 is never next", () => {
    const tasks = [task({ dueDate: "2026-12-01", dependencies: [{ taskId: 2, type: "FS" }] } as Partial<Task>)];
    expect(ganttSetupSteps({ tasks, milestones: [], milestonesApplicable: false }).next).toBeNull();
  });
});

describe("raciSetupSteps (§734)", () => {
  it("names both missing inputs at once", () => {
    expect(raciSetupSteps({ milestones: [], stakeholders: [] }))
      .toEqual({ milestonesDone: false, stakeholdersDone: false, assignedDone: false, next: 1 });
  });
  it("milestones but no stakeholders: step 2 is next", () => {
    expect(raciSetupSteps({ milestones: [milestone], stakeholders: [] }).next).toBe(2);
  });
  it("stakeholders but no milestones: step 1 stays next and step 2 is ticked", () => {
    const s = raciSetupSteps({ milestones: [], stakeholders: [stakeholder()] });
    expect(s.stakeholdersDone).toBe(true);
    expect(s.next).toBe(1);
  });
  it("an assignment ticks step 3; an empty raci record does not", () => {
    expect(raciSetupSteps({ milestones: [milestone], stakeholders: [stakeholder()] }).next).toBe(3);
    expect(raciSetupSteps({ milestones: [milestone], stakeholders: [stakeholder({ "1": "R" })] }).next).toBeNull();
  });
});

describe("resourcesSetupSteps (§731)", () => {
  it("a role without a rate does not tick step 1", () => {
    const s = resourcesSetupSteps({ roles: [role(0)], disciplines: [], grades: [], resources: [] });
    expect(s).toEqual({ ratesDone: false, structureDone: false, peopleDone: false, next: 1 });
  });
  it("disciplines AND grades are both needed for step 2", () => {
    expect(resourcesSetupSteps({ roles: [role(90)], disciplines: [{ id: 1, name: "Eng" }], grades: [], resources: [] }).next).toBe(2);
    expect(resourcesSetupSteps({ roles: [role(90)], disciplines: [{ id: 1, name: "Eng" }], grades: [{ id: 1, name: "Senior" }], resources: [] }).next).toBe(3);
  });
  it("people tick step 3", () => {
    expect(resourcesSetupSteps({ roles: [role(90)], disciplines: [{ id: 1, name: "Eng" }], grades: [{ id: 1, name: "Senior" }], resources: [person] }).next).toBeNull();
  });
});

describe("view setup dismissal", () => {
  afterEach(() => localStorage.clear());
  it("is per view and per project", () => {
    expect(isViewSetupDismissed("gantt", "p1")).toBe(false);
    setViewSetupDismissed("gantt", "p1");
    expect(isViewSetupDismissed("gantt", "p1")).toBe(true);
    expect(isViewSetupDismissed("gantt", "p2")).toBe(false);
  });
});
