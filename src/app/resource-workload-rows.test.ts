import { describe, it, expect } from "vitest";
import { buildResourceWorkload } from "./resource-workload-rows";
import type { Absence, RaidItem, Resource, Shift, Task } from "./types";

const res = (id: number, firstName: string, lastName: string, email?: string): Resource =>
  ({ id, firstName, lastName, email, roleId: null, utilizationMode: "percent", utilization: {} });
const task = (id: number, assignee: string, over: Partial<Task> = {}): Task =>
  ({ id, taskName: `T${id}`, assignee, assigneeEmail: "", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01",
     status: "To Do", priority: "Medium", blockers: "", description: "", inquiriesSent: 0, ...over });
const raidItem = (id: number, over: Partial<RaidItem> = {}): RaidItem =>
  ({ id, category: "R", title: `R${id}`, status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01",
     causedByRaidIds: [], stakeholderIds: [], ...over });

describe("buildResourceWorkload", () => {
  it("joins tasks to a managed resource by resourceId", () => {
    const r = res(1, "Sample", "Dummy");
    const { managed, unlinked } = buildResourceWorkload([r], [task(10, "whatever", { resourceId: 1 })], [], [], [], "2026-06-01");
    expect(unlinked).toHaveLength(0);
    expect(managed).toHaveLength(1);
    expect(managed[0].openCount).toBe(1);
  });
  it("falls back to case-folded name when a task has no resourceId", () => {
    const { managed } = buildResourceWorkload([res(1, "Sample", "Dummy")], [task(10, "Alex Example")], [], [], [], "2026-06-01");
    expect(managed[0].openCount).toBe(1);
  });
  it("counts overdue open tasks", () => {
    const { managed } = buildResourceWorkload([res(1, "Sample", "Dummy")], [task(10, "Alex Example", { resourceId: 1, dueDate: "2026-01-01" })], [], [], [], "2026-06-01");
    expect(managed[0].overdueCount).toBe(1);
  });
  it("carries the overdue task objects for inline triage (#24)", () => {
    const { managed } = buildResourceWorkload(
      [res(1, "Sample", "Dummy")],
      [
        task(10, "Alex Example", { resourceId: 1, dueDate: "2026-01-01" }),
        task(11, "Alex Example", { resourceId: 1, dueDate: "2099-01-01" }), // not overdue
      ],
      [], [], [], "2026-06-01",
    );
    expect(managed[0].overdueTasks.map((t) => t.id)).toEqual([10]);
  });
  it("ignores completed tasks for open/overdue counts", () => {
    const { managed } = buildResourceWorkload([res(1, "Sample", "Dummy")], [task(10, "Alex Example", { resourceId: 1, dueDate: "2026-01-01", completedDate: "2026-02-01" })], [], [], [], "2026-06-01");
    expect(managed[0].openCount).toBe(0);
    expect(managed[0].overdueCount).toBe(0);
  });
  it("groups an unknown assignee under unlinked with a split name + email seed", () => {
    const { managed, unlinked } = buildResourceWorkload([], [task(10, "Bob Lee", { assigneeEmail: "bob@x.com" })], [], [], [], "2026-06-01");
    expect(managed).toHaveLength(0);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatchObject({ firstName: "Bob", lastName: "Lee", email: "bob@x.com", openCount: 1 });
  });
  it("treats a dangling resourceId + unknown name as unlinked", () => {
    const { managed, unlinked } = buildResourceWorkload([res(1, "Sample", "Dummy")], [task(10, "Ghost", { resourceId: 999 })], [], [], [], "2026-06-01");
    expect(managed[0].openCount).toBe(0);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0].display).toBe("Ghost");
  });
  it("includes a managed resource with no tasks", () => {
    const { managed } = buildResourceWorkload([res(1, "Sample", "Dummy")], [], [], [], [], "2026-06-01");
    expect(managed).toHaveLength(1);
    expect(managed[0].openCount).toBe(0);
    expect(managed[0].weeklyHours).toBeGreaterThan(0);
    expect(managed[0].shift).toBeNull();
  });
  it("attaches a shift's weekly hours by name match", () => {
    const shift: Shift = { id: 1, assignee: "Alex Example", hoursPerWeekday: [0, 10, 10, 10, 10, 0, 0] };
    const { managed } = buildResourceWorkload([res(1, "Sample", "Dummy")], [], [], [shift], [], "2026-06-01");
    expect(managed[0].weeklyHours).toBe(40);
    expect(managed[0].shift).not.toBeNull();
  });
  it("attaches a shift by resourceId even when the assignee name differs", () => {
    // The FK wins over the name: a stale/mismatched assignee string still
    // resolves to the linked resource. Would land in `unlinked` if the shift
    // join ignored resourceId.
    const shift: Shift = { id: 1, assignee: "stale name", resourceId: 1, hoursPerWeekday: [0, 8, 8, 8, 8, 0, 0] };
    const { managed, unlinked } = buildResourceWorkload([res(1, "Sample", "Dummy")], [], [], [shift], [], "2026-06-01");
    expect(unlinked).toHaveLength(0);
    expect(managed[0].shift).not.toBeNull();
    expect(managed[0].weeklyHours).toBe(32);
  });
  it("collects only upcoming absences within the 60-day horizon", () => {
    const mk = (id: number, s: string, e: string): Absence => ({ id, assignee: "Alex Example", startDate: s, endDate: e, type: "vacation", resourceId: 1 });
    const { managed } = buildResourceWorkload([res(1, "Sample", "Dummy")], [], [mk(1,"2026-01-01","2026-01-05"), mk(2,"2026-06-10","2026-06-12"), mk(3,"2026-12-01","2026-12-05")], [], [], "2026-06-01");
    expect(managed[0].upcoming.map((a) => a.id)).toEqual([2]);
  });
});

describe("buildResourceWorkload — raidOpenCount", () => {
  it("counts open RAID a resource owns, by ownerResourceId and by owner name", () => {
    const r = res(1, "Sample", "Dummy");
    const raid = [raidItem(10, { ownerResourceId: 1 }), raidItem(11, { owner: "Alex Example" })];
    const { managed } = buildResourceWorkload([r], [], [], [], raid, "2026-06-01");
    expect(managed[0].raidOpenCount).toBe(2);
  });
  it("does not count terminal/closed RAID", () => {
    const r = res(1, "Sample", "Dummy");
    const raid = [raidItem(10, { ownerResourceId: 1, status: "Closed" })];
    const { managed } = buildResourceWorkload([r], [], [], [], raid, "2026-06-01");
    expect(managed[0].raidOpenCount).toBe(0);
  });
  it("prefers ownerResourceId over a mismatched owner name", () => {
    const r = res(1, "Sample", "Dummy");
    const raid = [raidItem(10, { ownerResourceId: 1, owner: "stale name" })];
    const { managed, unlinked } = buildResourceWorkload([r], [], [], [], raid, "2026-06-01");
    expect(managed[0].raidOpenCount).toBe(1);
    expect(unlinked).toHaveLength(0);
  });
  it("buckets a free-text RAID owner with no match under unlinked", () => {
    const raid = [raidItem(10, { owner: "External Owner", ownerEmail: "e@x.com" })];
    const { managed, unlinked } = buildResourceWorkload([res(1, "Sample", "Dummy")], [], [], [], raid, "2026-06-01");
    expect(managed[0].raidOpenCount).toBe(0);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatchObject({ display: "External Owner", raidOpenCount: 1 });
  });
  it("skips a RAID item with neither owner nor FK", () => {
    const raid = [raidItem(10, {})];
    const { managed, unlinked } = buildResourceWorkload([res(1, "Sample", "Dummy")], [], [], [], raid, "2026-06-01");
    expect(managed[0].raidOpenCount).toBe(0);
    expect(unlinked).toHaveLength(0);
  });
});
