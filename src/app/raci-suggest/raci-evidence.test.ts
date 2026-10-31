import { describe, expect, it } from "vitest";
import { buildMatchCtx, buildRaciEvidence, evidenceLine, stakeholdersForItem } from "./raci-evidence";
import type { RaciEvidence } from "./raci-evidence";
import type { ChangeItem, Milestone, RaidItem, Resource, Stakeholder, Task } from "../types";

const sh = (id: number, name: string, extra: Partial<Stakeholder> = {}): Stakeholder =>
  ({ id, name, category: "Internal", influence: "High", interest: "High", raci: {}, ...extra } as Stakeholder);
const res = (id: number, firstName: string, lastName: string): Resource =>
  ({ id, firstName, lastName } as Resource);
const task = (id: number, extra: Partial<Task> = {}): Task =>
  ({ id, taskName: `T${id}`, assignee: "", status: "To Do", ...extra } as Task);
const ms = (id: number, linkedTaskIds: number[]): Milestone =>
  ({ id, name: `M${id}`, date: "2026-03-01", linkedTaskIds } as Milestone);
const raid = (id: number, extra: Partial<RaidItem>): RaidItem =>
  ({ id, category: "R", title: `R${id}`, status: "Open", linkedTaskIds: [], ...extra } as RaidItem);
const change = (id: number, extra: Partial<ChangeItem>): ChangeItem =>
  ({ id, title: `C${id}`, linkedTaskIds: [], ...extra } as ChangeItem);

describe("stakeholdersForItem", () => {
  it("a task linked by resource id matches only the stakeholder linked to that resource", () => {
    const ctx = buildMatchCtx([sh(1, "Ada", { resourceId: 7 }), sh(2, "Bo")], [res(7, "Ada", "Lovelace")]);
    expect(stakeholdersForItem({ resourceId: 7, person: "Bo" }, ctx)).toEqual([1]);
  });

  it("a task with no resource id matches a linked stakeholder by the resource's display name", () => {
    const ctx = buildMatchCtx([sh(1, "Countess", { resourceId: 7 })], [res(7, "Ada", "Lovelace")]);
    expect(stakeholdersForItem({ person: " ada LOVELACE " }, ctx)).toEqual([1]);
  });

  it("a dangling stakeholder resourceId counts as unlinked", () => {
    const ctx = buildMatchCtx([sh(1, "Ada", { resourceId: 99 })], [res(7, "Zed", "Zee")]);
    expect(stakeholdersForItem({ person: "ada" }, ctx)).toEqual([1]);
    expect(stakeholdersForItem({ resourceId: 99, person: "ada" }, ctx)).toEqual([1]);
  });

  it("a live resource id with no linked stakeholder matches none, with no name fallback", () => {
    const ctx = buildMatchCtx([sh(1, "Bo")], [res(7, "Zed", "Zee")]);
    expect(stakeholdersForItem({ resourceId: 7, person: "Bo" }, ctx)).toEqual([]);
  });

  it("a name shared by two stakeholders matches neither", () => {
    const ctx = buildMatchCtx([sh(1, "Sam"), sh(2, "sam")], []);
    expect(stakeholdersForItem({ person: "Sam" }, ctx)).toEqual([]);
  });

  it("two stakeholders linked to one resource match neither by link", () => {
    const ctx = buildMatchCtx([sh(1, "A", { resourceId: 7 }), sh(2, "B", { resourceId: 7 })], [res(7, "X", "Y")]);
    expect(stakeholdersForItem({ resourceId: 7 }, ctx)).toEqual([]);
  });

  it("one stakeholder reached by name and display name counts once", () => {
    const ctx = buildMatchCtx([sh(1, "Ada Lovelace", { resourceId: 7 })], [res(7, "Ada", "Lovelace")]);
    expect(stakeholdersForItem({ person: "Ada Lovelace" }, ctx)).toEqual([1]);
  });

  it("no person and no resource matches nothing", () => {
    const ctx = buildMatchCtx([sh(1, "Ada")], []);
    expect(stakeholdersForItem({ person: "  " }, ctx)).toEqual([]);
    expect(stakeholdersForItem({}, ctx)).toEqual([]);
  });
});

describe("buildRaciEvidence", () => {
  const base = {
    stakeholders: [sh(1, "Ada"), sh(2, "Bo")],
    milestones: [ms(10, [1, 2, 3])],
    tasks: [
      task(1, { assignee: "Ada", status: "Done" }),
      task(2, { assignee: "ada" }),
      task(3, { assignee: "Bo" }),
      task(4, { assignee: "Ada" }),
    ],
    raid: [] as RaidItem[],
    changes: [] as ChangeItem[],
    resources: [] as Resource[],
  };

  it("counts owned and closed tasks within the milestone scope only", () => {
    const [a, b] = buildRaciEvidence(base);
    expect(a).toMatchObject({ stakeholderId: 1, milestoneId: 10, tasksOwned: 2, tasksClosed: 1, scopeSize: 3 });
    expect(b).toMatchObject({ stakeholderId: 2, tasksOwned: 1, tasksClosed: 0 });
  });

  it("RAID counts by ownerResourceId, else owner; open by isRaidActiveForReview", () => {
    const ev = buildRaciEvidence({
      ...base,
      stakeholders: [sh(1, "Ada", { resourceId: 7 }), sh(2, "Bo")],
      resources: [res(7, "Ada", "L")],
      tasks: [task(1)],
      milestones: [ms(10, [1])],
      raid: [
        raid(1, { ownerResourceId: 7, owner: "Bo", linkedTaskIds: [1], category: "R" }),
        raid(2, { owner: "bo", linkedTaskIds: [1], category: "I", status: "Closed" }),
        raid(3, { owner: "Bo", linkedTaskIds: [1], category: "D", status: "Open", closedDate: "2026-01-01" }),
        raid(4, { owner: "Bo", linkedTaskIds: [99], category: "A" }),
      ],
    });
    expect(ev.find((e) => e.stakeholderId === 1)?.raidOpen).toEqual({ R: 1 });
    const bo = ev.find((e) => e.stakeholderId === 2);
    expect(bo?.raidOpen).toEqual({});
    expect(bo?.raidClosed).toEqual({ I: 1, D: 1 });
  });

  it("a change counts by requestedBy, scoped through shared linkedTaskIds", () => {
    const ev = buildRaciEvidence({
      ...base,
      changes: [
        change(1, { requestedBy: "BO", linkedTaskIds: [3, 50] }),
        change(2, { requestedBy: "Bo", linkedTaskIds: [50] }),
      ],
    });
    expect(ev.find((e) => e.stakeholderId === 2)?.changesRequested).toBe(1);
  });

  it("a milestone with no linked tasks yields no evidence", () => {
    expect(buildRaciEvidence({ ...base, milestones: [ms(10, []), ms(11, [404])] })).toEqual([]);
  });

  it("ties on every count fall back to stakeholder id ascending, not slice position", () => {
    const ev = buildRaciEvidence({
      ...base,
      stakeholders: [sh(2, "Bo"), sh(1, "Ada")],
      tasks: [task(1, { assignee: "Ada" }), task(2, { assignee: "Bo" })],
      milestones: [ms(10, [1, 2])],
    });
    expect(ev.map((e) => e.stakeholderId)).toEqual([1, 2]);
  });

  it("after owned tasks, more owned RAID ranks first; then more requested changes", () => {
    const stakeholders = [sh(1, "Ada"), sh(2, "Bo"), sh(3, "Cy"), sh(4, "Di")];
    const ev = buildRaciEvidence({
      ...base,
      stakeholders,
      tasks: [task(1)],
      milestones: [ms(10, [1])],
      raid: [
        raid(1, { owner: "Bo", linkedTaskIds: [1] }),
        raid(2, { owner: "Bo", linkedTaskIds: [1] }),
        raid(3, { owner: "Ada", linkedTaskIds: [1] }),
      ],
      changes: [
        change(1, { requestedBy: "Cy", linkedTaskIds: [1] }),
        change(2, { requestedBy: "Cy", linkedTaskIds: [1] }),
        change(3, { requestedBy: "Di", linkedTaskIds: [1] }),
        change(4, { requestedBy: "Ada", linkedTaskIds: [1] }),
        change(5, { requestedBy: "Ada", linkedTaskIds: [1] }),
        change(6, { requestedBy: "Ada", linkedTaskIds: [1] }),
      ],
    });
    // Bo 2 RAID, Ada 1 RAID (3 changes must not outrank Bo), then Cy 2 changes, Di 1
    expect(ev.map((e) => e.stakeholderId)).toEqual([2, 1, 3, 4]);
  });

  it("order: milestone slice order, then strongest first", () => {
    const ev = buildRaciEvidence({
      ...base,
      milestones: [ms(20, [3]), ms(10, [1, 2, 3])],
    });
    expect(ev.map((e) => [e.milestoneId, e.stakeholderId])).toEqual([[20, 2], [10, 1], [10, 2]]);
  });
});

describe("evidenceLine", () => {
  const e = (extra: Partial<RaciEvidence>): RaciEvidence => ({
    stakeholderId: 1, milestoneId: 1, tasksOwned: 0, tasksClosed: 0, scopeSize: 5,
    raidOpen: {}, raidClosed: {}, changesRequested: 0, ...extra,
  });

  it("renders every part", () => {
    expect(
      evidenceLine(e({ tasksOwned: 3, tasksClosed: 1, raidOpen: { R: 1 }, raidClosed: { I: 1 }, changesRequested: 1 })),
    ).toBe("owns 3 of 5 tasks (1 closed); owns open R×1, closed I×1; requested 1 change");
  });

  it("evidenceLine omits zero parts", () => {
    expect(evidenceLine(e({ tasksOwned: 2 }))).toBe("owns 2 of 5 tasks");
    expect(evidenceLine(e({ changesRequested: 2 }))).toBe("requested 2 changes");
    expect(evidenceLine(e({ raidClosed: { A: 2 } }))).toBe("owns closed A×2");
  });
});
