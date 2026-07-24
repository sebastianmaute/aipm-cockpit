import { describe, it, expect } from "vitest";
import {
  isAchieved, isAtRisk, milestoneStatus, sortMilestones,
  partitionMilestones, milestoneScheduleContribution,
  filterMilestones,
  bucketMilestonesByHorizon, HORIZON_THIS_WEEK_DAYS, HORIZON_NEXT_DAYS,
} from "./milestones";
import type { Milestone, Task } from "./types";

function ms(o: Partial<Milestone> = {}): Milestone {
  return { id: 1, name: "M", date: "2026-08-01", linkedTaskIds: [], ...o };
}
function task(o: Partial<Task> = {}): Task {
  return { id: 1, taskName: "T", assignee: "A", assigneeEmail: "a@x.io", dueDate: "2026-07-01", lastUpdateDate: "2026-06-01", status: "To Do", priority: "Medium", blockers: "", description: "", ...o };
}
const today = "2026-06-02";
const holidays = new Set<string>();
const byId = (...ts: Task[]) => new Map(ts.map((t) => [t.id, t]));

describe("isAchieved", () => {
  it("true only when achievedDate set", () => {
    expect(isAchieved(ms({ achievedDate: "2026-07-30" }))).toBe(true);
    expect(isAchieved(ms())).toBe(false);
  });
});

describe("isAtRisk", () => {
  it("true when a linked task's effective end is after the milestone date", () => {
    const m = ms({ date: "2026-08-01", linkedTaskIds: [10] });
    expect(isAtRisk(m, byId(task({ id: 10, dueDate: "2026-08-05" })))).toBe(true);
  });
  it("false when linked tasks finish on time", () => {
    const m = ms({ date: "2026-08-01", linkedTaskIds: [10] });
    expect(isAtRisk(m, byId(task({ id: 10, dueDate: "2026-07-20" })))).toBe(false);
  });
  it("uses completedDate over dueDate, and ignores achieved milestones + missing tasks", () => {
    const m = ms({ date: "2026-08-01", linkedTaskIds: [10, 99] });
    expect(isAtRisk(m, byId(task({ id: 10, dueDate: "2026-09-01", completedDate: "2026-07-15" })))).toBe(false);
    expect(isAtRisk(ms({ date: "2026-08-01", achievedDate: "2026-08-02", linkedTaskIds: [10] }), byId(task({ id: 10, dueDate: "2026-09-01" })))).toBe(false);
  });
});

describe("milestoneStatus precedence", () => {
  it("achieved > overdue > at-risk > due-soon > on-track", () => {
    expect(milestoneStatus(ms({ date: "2026-05-01", achievedDate: "2026-05-02" }), byId(), today, holidays)).toBe("achieved");
    expect(milestoneStatus(ms({ date: "2026-05-01" }), byId(), today, holidays)).toBe("overdue");
    expect(milestoneStatus(ms({ date: "2026-08-01", linkedTaskIds: [10] }), byId(task({ id: 10, dueDate: "2026-08-10" })), today, holidays)).toBe("at-risk");
    expect(milestoneStatus(ms({ date: "2026-06-03" }), byId(), today, holidays)).toBe("due-soon");
    expect(milestoneStatus(ms({ date: "2026-12-01" }), byId(), today, holidays)).toBe("on-track");
  });

  it("returns overdue (not at-risk) when a past milestone also has a late linked task", () => {
    expect(milestoneStatus(
      ms({ date: "2026-05-01", linkedTaskIds: [10] }),
      byId(task({ id: 10, dueDate: "2026-05-15" })), // linked task also past the milestone date
      today, holidays,
    )).toBe("overdue");
  });
});

describe("sortMilestones", () => {
  it("sorts by date then id", () => {
    expect(sortMilestones([ms({ id: 2, date: "2026-09-01" }), ms({ id: 1, date: "2026-08-01" })]).map((m) => m.id)).toEqual([1, 2]);
  });
});

describe("partitionMilestones", () => {
  it("buckets overdue / at-risk / due-soon, excludes achieved + on-track", () => {
    const tasksById = byId(task({ id: 10, dueDate: "2026-08-10" }));
    const list = [
      ms({ id: 1, date: "2026-05-01" }),
      ms({ id: 2, date: "2026-08-01", linkedTaskIds: [10] }),
      ms({ id: 3, date: "2026-06-03" }),
      ms({ id: 4, date: "2026-12-01" }),
      ms({ id: 5, date: "2026-05-01", achievedDate: "2026-05-02" }),
    ];
    const p = partitionMilestones(list, tasksById, today, holidays);
    expect(p.overdue.map((m) => m.id)).toEqual([1]);
    expect(p.atRisk.map((m) => m.id)).toEqual([2]);
    expect(p.dueSoon.map((m) => m.id)).toEqual([3]);
  });
});

describe("milestoneScheduleContribution", () => {
  it("R if any overdue, A if any at-risk/due-soon, else null", () => {
    expect(milestoneScheduleContribution([ms({ date: "2026-05-01" })], byId(), today, holidays)).toBe("R");
    expect(milestoneScheduleContribution([ms({ date: "2026-06-03" })], byId(), today, holidays)).toBe("A");
    expect(milestoneScheduleContribution([ms({ date: "2026-12-01" })], byId(), today, holidays)).toBeNull();
    expect(milestoneScheduleContribution([], byId(), today, holidays)).toBeNull();
  });
});

const mk = (over: Partial<Milestone> & Pick<Milestone, "id" | "name" | "date">): Milestone =>
  ({ linkedTaskIds: [], ...over });

describe("filterMilestones", () => {
  const filterToday = "2026-06-05";
  const a = mk({ id: 1, name: "Alpha kickoff", date: "2026-06-10" });            // pending, future
  const b = mk({ id: 2, name: "Beta gate", date: "2026-06-01" });                // overdue
  const c = mk({ id: 3, name: "Gamma review", date: "2026-05-01", achievedDate: "2026-05-02" }); // achieved
  const all = [a, b, c];

  it("filters by name query (case-insensitive)", () => {
    expect(filterMilestones(all, { query: "beta", status: "all", today: filterToday }).map((m) => m.id)).toEqual([2]);
  });
  it("status=pending = unachieved & not overdue", () => {
    expect(filterMilestones(all, { query: "", status: "pending", today: filterToday }).map((m) => m.id)).toEqual([1]);
  });
  it("status=overdue = unachieved with date < today", () => {
    expect(filterMilestones(all, { query: "", status: "overdue", today: filterToday }).map((m) => m.id)).toEqual([2]);
  });
  it("status=achieved = has achievedDate", () => {
    expect(filterMilestones(all, { query: "", status: "achieved", today: filterToday }).map((m) => m.id)).toEqual([3]);
  });
  it("status=all returns everything", () => {
    expect(filterMilestones(all, { query: "", status: "all", today: filterToday }).map((m) => m.id).sort()).toEqual([1, 2, 3]);
  });
});

describe("bucketMilestonesByHorizon", () => {
  const today = "2026-06-21";
  const noTasks = new Map<number, Task>();
  const hs = new Set<string>();
  const ms = (id: number, date: string, extra: Partial<Milestone> = {}): Milestone =>
    ({ id, name: `M${id}`, date, linkedTaskIds: [], ...extra } as Milestone);

  it("excludes achieved milestones", () => {
    const b = bucketMilestonesByHorizon([ms(1, "2026-06-25", { achievedDate: "2026-06-20" })], noTasks, today, hs);
    expect(b.overdue.length + b.thisWeek.length + b.next2Weeks.length + b.later.length).toBe(0);
  });

  it("buckets a past unachieved milestone as overdue", () => {
    const b = bucketMilestonesByHorizon([ms(1, "2026-06-10")], noTasks, today, hs);
    expect(b.overdue.map((e) => e.milestone.id)).toEqual([1]);
    expect(b.overdue[0].status).toBe("overdue");
  });

  it("buckets by calendar-day windows (boundaries 0,7,8,21,22)", () => {
    const list = [
      ms(1, "2026-06-21"),
      ms(2, "2026-06-28"),
      ms(3, "2026-06-29"),
      ms(4, "2026-07-12"),
      ms(5, "2026-07-13"),
    ];
    const b = bucketMilestonesByHorizon(list, noTasks, today, hs);
    expect(b.thisWeek.map((e) => e.milestone.id)).toEqual([1, 2]);
    expect(b.next2Weeks.map((e) => e.milestone.id)).toEqual([3, 4]);
    expect(b.later.map((e) => e.milestone.id)).toEqual([5]);
  });

  it("carries the at-risk status into a future bucket", () => {
    const tasks = new Map<number, Task>([[10, { id: 10, dueDate: "2026-06-30" } as Task]]);
    const b = bucketMilestonesByHorizon([ms(1, "2026-06-28", { linkedTaskIds: [10] })], tasks, today, hs);
    expect(b.thisWeek[0].status).toBe("at-risk");
  });

  it("sorts each bucket by date then id", () => {
    const b = bucketMilestonesByHorizon([ms(2, "2026-07-30"), ms(1, "2026-07-20")], noTasks, today, hs);
    expect(b.later.map((e) => e.milestone.id)).toEqual([1, 2]);
  });

  it("treats a malformed date as later (never crashes, never mis-overdues)", () => {
    const b = bucketMilestonesByHorizon([ms(1, "not-a-date")], noTasks, today, hs);
    expect(b.overdue.length).toBe(0);
    expect(b.later.map((e) => e.milestone.id)).toEqual([1]);
  });

  it("exposes the window threshold constants", () => {
    expect(HORIZON_THIS_WEEK_DAYS).toBe(7);
    expect(HORIZON_NEXT_DAYS).toBe(21);
  });
});
