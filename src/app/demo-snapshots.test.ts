import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoSnapshots, demoSnapshotFridays, workspaceAsOf } from "./demo-snapshots";
import { DEMO_AS_OF } from "./demo-workspace";
import { decodeSampleMaster } from "./sample-workspace-variants";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { ActivityEntry } from "./activity-log";
import type { BudgetHistoryEntry } from "./budget-history";
import type { BudgetBucket, ChangeItem, Milestone, RaidItem, Task } from "./types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readRoot = (name: string): string => readFileSync(join(ROOT, name), "utf8").replace(/\r\n/g, "\n");

const AS_OF = "2026-07-10";

const task = (over: Partial<Task>): Task => ({
  id: 1, taskName: "t", assignee: "", assigneeEmail: "", dueDate: "2026-09-30",
  lastUpdateDate: "2026-06-01", createdDate: "2026-06-01", priority: "Medium",
  status: "To Do", blockers: "", description: "", ...over,
});
const raid = (over: Partial<RaidItem>): RaidItem => ({
  id: 1, category: "R", title: "r", status: "Open", linkedTaskIds: [], raisedDate: "2026-06-01",
  causedByRaidIds: [], stakeholderIds: [], ...over,
});
const change = (over: Partial<ChangeItem>): ChangeItem => ({
  id: 1, title: "c", description: "", type: "Scope", status: "Under Review", raisedDate: "2026-06-01",
  linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], ...over,
});
const milestone = (over: Partial<Milestone>): Milestone => ({
  id: 1, name: "m", date: "2026-08-01", linkedTaskIds: [], ...over,
});
const bucket = (over: Partial<BudgetBucket>): BudgetBucket => ({
  id: 1, name: "b", type: "tm", currency: "EUR", startDate: "2026-03-01", endDate: "2026-12-31",
  status: "open", createdDate: "2026-03-02", allocations: [], ...over,
});
const activity = (id: string, timestamp: string): ActivityEntry =>
  ({ id, timestamp, kind: "task.created", args: [] }) as ActivityEntry;
const history = (id: string, date: string): BudgetHistoryEntry => ({
  id, at: `${date}T09:00:00.000Z`, date, kind: "baseline", bucketId: null, bucketName: "",
  projectBacHours: 0, projectBacValue: 0, deltaHours: 0, deltaValue: 0,
});

function fixture(): Workspace {
  return {
    ...emptyWorkspace(),
    tasks: [
      task({ id: 1, status: "Done", completedDate: "2026-08-01", lastUpdateDate: "2026-08-01" }),
      task({ id: 2, status: "Done", completedDate: "2026-07-01", lastUpdateDate: "2026-07-01" }),
      task({
        id: 3, createdDate: "2026-07-20", lastUpdateDate: "2026-07-25", status: "In Progress",
        healthOverride: "R", timeSpentMinutes: 60, remainingEstimateMinutes: 30, originalEstimateMinutes: 90,
      }),
      task({ id: 6, createdDate: "2026-07-20", status: "Cancelled" }),
      task({ id: 4, status: "Done", completedDate: "2026-08-01", startDate: "2026-07-15" }),
      task({
        id: 5,
        blockers: "x",
        blockerLog: [
          { id: 1, text: "early", createdAt: "2026-07-01T09:00:00.000Z", resolvedAt: "2026-07-20T09:00:00.000Z" },
          { id: 2, text: "late", createdAt: "2026-07-15T09:00:00.000Z" },
          { id: 3, text: "gone", createdAt: "2026-06-01T09:00:00.000Z", resolvedAt: "2026-06-05T09:00:00.000Z" },
        ],
      }),
    ],
    raid: [
      raid({ id: 1, raisedDate: "2026-07-01" }),
      raid({ id: 2, raisedDate: "2026-07-11" }),
      raid({ id: 3, category: "R", status: "Closed", closedDate: "2026-08-21" }),
      raid({ id: 4, category: "A", status: "Validated", closedDate: "2026-08-21" }),
      raid({ id: 5, category: "I", status: "Resolved", closedDate: "2026-08-21" }),
      raid({ id: 6, category: "D", status: "Delivered", closedDate: "2026-07-05" }),
    ],
    changes: [
      change({ id: 1, raisedDate: "2026-07-01" }),
      change({ id: 2, raisedDate: "2026-09-01" }),
      change({ id: 3, status: "Approved", decisionDate: "2026-09-04", decisionBy: "Sponsor" }),
      change({ id: 4, status: "Rejected", decisionDate: "2026-07-02", decisionBy: "Sponsor" }),
    ],
    milestones: [
      milestone({ id: 1, achievedDate: "2026-08-21" }),
      milestone({ id: 2, achievedDate: "2026-06-02" }),
    ],
    budgets: [
      bucket({
        id: 1,
        allocations: [{
          roleId: 1, resourceIds: [], budgetHours: { "2026-08": 10 },
          actualHours: { "2026-07": 5, "2026-08": 7, "2026-W27": 1, "2026-W29": 2, "2026-07-09": 3, "2026-07-13": 4, junk: 9 },
        }],
        disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 1, "2026-09": 2 } }],
      }),
      bucket({ id: 2, createdDate: "2026-07-20" }),
      bucket({ id: 3, status: "closed", closedDate: "2026-07-31" }),
      bucket({ id: 4, status: "closed", closedDate: "2026-06-30" }),
    ],
    activityLog: [activity("a1", "2026-07-10T16:00:00.000Z"), activity("a2", "2026-07-11T08:00:00.000Z")],
    budgetHistory: [history("h1", "2026-07-01"), history("h2", "2026-08-01")],
    status: { ragOverride: "A", narrative: "later", narrativeUpdatedAt: "2026-09-16T09:00:00.000Z" },
  };
}

describe("workspaceAsOf", () => {
  const ws = fixture();
  const out = workspaceAsOf(ws, AS_OF);
  const byId = <T extends { id: number }>(rows: readonly T[] | undefined, id: number): T | undefined =>
    rows?.find((r) => r.id === id);

  it("reopens a task completed after asOf — clearing BOTH status and completedDate", () => {
    const t = byId(out.tasks, 1)!;
    expect(t.status).not.toBe("Done");
    expect(t.status).toBe("In Progress");
    expect(t.completedDate).toBeUndefined();
    expect(t.lastUpdateDate).toBe(AS_OF);
  });

  it("reopens a task that had not started by asOf to To Do", () => {
    const t = byId(out.tasks, 4)!;
    expect(t.status).toBe("To Do");
    expect(t.completedDate).toBeUndefined();
  });

  it("keeps a task completed before asOf unchanged", () => {
    expect(byId(out.tasks, 2)).toEqual(byId(ws.tasks, 2));
  });

  it("keeps a task created after asOf as planned scope, not started and without work on it", () => {
    expect(out.tasks.map((t) => t.id)).toEqual([1, 2, 3, 6, 4, 5]);
    const t = byId(out.tasks, 3)!;
    expect(t.status).toBe("To Do");
    expect(t.lastUpdateDate).toBe(AS_OF);
    expect(t.originalEstimateMinutes).toBe(90);
    expect(["healthOverride", "timeSpentMinutes", "remainingEstimateMinutes"].filter((k) => k in t)).toEqual([]);
  });

  it("leaves a not-yet-created Cancelled task Cancelled (cancellation is undated)", () => {
    expect(byId(out.tasks, 6)!.status).toBe("Cancelled");
  });

  it("drops blockers raised after asOf, reopens ones resolved after it, and re-derives the text", () => {
    const t = byId(out.tasks, 5)!;
    expect(t.blockerLog).toEqual([
      { id: 1, text: "early", createdAt: "2026-07-01T09:00:00.000Z" },
      { id: 3, text: "gone", createdAt: "2026-06-01T09:00:00.000Z", resolvedAt: "2026-06-05T09:00:00.000Z" },
    ]);
    expect(t.blockers).toBe("early");
  });

  it("drops budget actuals in periods after asOf and keeps earlier ones", () => {
    const b = byId(out.budgets, 1)!;
    expect(b.allocations[0].actualHours).toEqual({ "2026-07": 5, "2026-W27": 1, "2026-07-09": 3, junk: 9 });
    expect(b.allocations[0].budgetHours).toEqual({ "2026-08": 10 });
    expect(b.disciplineAllocations![0].actualHours).toEqual({ "2026-06": 1 });
  });

  it("removes a bucket created after asOf and reopens one closed after it", () => {
    expect(byId(out.budgets, 2)).toBeUndefined();
    const reopened = byId(out.budgets, 3)!;
    expect(reopened.status).toBe("open");
    expect(reopened.closedDate).toBeUndefined();
    expect(byId(out.budgets, 4)).toEqual(byId(ws.budgets, 4));
  });

  it("removes RAID items raised after asOf and keeps earlier ones", () => {
    expect(byId(out.raid, 1)).toEqual(byId(ws.raid, 1));
    expect(byId(out.raid, 2)).toBeUndefined();
  });

  it("reopens RAID items closed after asOf to their category's first status", () => {
    expect([3, 4, 5].map((id) => [byId(out.raid, id)!.status, byId(out.raid, id)!.closedDate]))
      .toEqual([["Open", undefined], ["Pending", undefined], ["Open", undefined]]);
    expect(byId(out.raid, 6)).toEqual(byId(ws.raid, 6));
  });

  it("removes changes raised after asOf and keeps earlier ones", () => {
    expect(byId(out.changes, 1)).toEqual(byId(ws.changes, 1));
    expect(byId(out.changes, 2)).toBeUndefined();
  });

  it("reverts a change decided after asOf to Under Review, without decision fields", () => {
    const c = byId(out.changes, 3)!;
    expect(c.status).toBe("Under Review");
    expect(c.decisionDate).toBeUndefined();
    expect(c.decisionBy).toBeUndefined();
    expect(byId(out.changes, 4)).toEqual(byId(ws.changes, 4));
  });

  it("un-achieves a milestone achieved after asOf and keeps an earlier achievement", () => {
    expect(byId(out.milestones, 1)!.achievedDate).toBeUndefined();
    expect(byId(out.milestones, 2)!.achievedDate).toBe("2026-06-02");
  });

  it("removes activity entries after asOf and keeps entries on or before it", () => {
    expect(out.activityLog!.map((a) => a.id)).toEqual(["a1"]);
  });

  it("removes budget-history entries dated after asOf", () => {
    expect(out.budgetHistory!.map((h) => h.id)).toEqual(["h1"]);
  });

  it("drops a PM status set after asOf", () => {
    expect(out.status).toEqual({});
    const kept = workspaceAsOf({ ...ws, status: { ragOverride: "R", narrativeUpdatedAt: "2026-07-01T09:00:00.000Z" } }, AS_OF);
    expect(kept.status).toEqual({ ragOverride: "R", narrativeUpdatedAt: "2026-07-01T09:00:00.000Z" });
  });

  it("tolerates a workspace whose optional slices are absent", () => {
    const bare: Workspace = { ...emptyWorkspace(), budgets: undefined, changes: undefined, milestones: undefined, activityLog: undefined, budgetHistory: undefined, status: undefined };
    const r = workspaceAsOf(bare, AS_OF);
    expect([r.budgets, r.changes, r.milestones, r.activityLog, r.budgetHistory, r.status]).toEqual([[], [], [], [], [], {}]);
  });

  it("does not mutate its input", () => {
    const input = fixture();
    const before = structuredClone(input);
    workspaceAsOf(input, AS_OF);
    expect(input).toEqual(before);
  });
});

describe("demoSnapshotFridays", () => {
  const fridays = demoSnapshotFridays("2026-03-02", "2026-09-18");
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`).getTime();

  it("runs from the second Friday after the start to the last Friday before asOf", () => {
    expect(fridays[0]).toBe("2026-03-13");
    expect(fridays[fridays.length - 1]).toBe("2026-09-11");
    expect(fridays).toHaveLength(27);
  });

  it("holds only Fridays, a week apart", () => {
    expect(fridays.every((f) => new Date(`${f}T00:00:00.000Z`).getUTCDay() === 5)).toBe(true);
    for (let i = 1; i < fridays.length; i++) expect(day(fridays[i]) - day(fridays[i - 1])).toBe(7 * 86_400_000);
  });

  it("counts a start that is itself a Friday as week zero", () => {
    expect(demoSnapshotFridays("2026-03-06", "2026-03-21")).toEqual(["2026-03-20"]);
  });

  it("is empty when asOf comes before the second Friday", () => {
    expect(demoSnapshotFridays("2026-03-02", "2026-03-13")).toEqual([]);
  });
});

describe("buildDemoSnapshots over the sample master", () => {
  const master = decodeSampleMaster(readRoot("sample-workspace-small.json"));
  const records = buildDemoSnapshots(master, DEMO_AS_OF);

  it("records one weekly auto snapshot per replay Friday, the first as baseline", () => {
    expect(records).toHaveLength(demoSnapshotFridays(master.plan.startDate, DEMO_AS_OF).length);
    expect(records.map((r) => r.isBaseline)).toEqual(records.map((_, i) => i === 0));
    expect(records.every((r) => r.capturedAt.endsWith("T17:00:00.000Z"))).toBe(true);
    expect(records.every((r) => r.cadence === "weekly" && r.trigger === "auto")).toBe(true);
  });

  it("captures each Friday it replays", () => {
    expect(records.map((r) => r.capturedAt.slice(0, 10))).toEqual(demoSnapshotFridays(master.plan.startDate, DEMO_AS_OF));
  });

  it("never loses progress over the first ten weeks", () => {
    const pct = records.slice(0, 10).map((r) => r.pctComplete);
    expect(pct.every((p) => p !== null)).toBe(true);
    for (let i = 1; i < pct.length; i++) expect(pct[i]!).toBeGreaterThanOrEqual(pct[i - 1]!);
    expect(pct[9]!).toBeGreaterThan(pct[0]!);
  });

  it("shows the July slip as an SPI below 1", () => {
    const july = records.filter((r) => r.capturedAt.startsWith("2026-07"));
    expect(july.length).toBeGreaterThan(0);
    expect(july.some((r) => r.spi !== null && r.spi < 1)).toBe(true);
  });

  it("matches the committed sample-demo-snapshots.json", () => {
    expect(JSON.parse(readRoot("sample-demo-snapshots.json"))).toEqual(records);
  });
});
