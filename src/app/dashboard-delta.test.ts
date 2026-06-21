import { describe, expect, test } from "vitest";
import { computeDelta, buildGreeting } from "./dashboard-delta";
import type { ActivityEntry } from "./activity-log";
import type { Task } from "./types";

function entry(id: number, timestamp: string, kind: ActivityEntry["kind"]): ActivityEntry {
  return { id, timestamp, kind, args: [] };
}
function task(id: number, dueDate: string): Task {
  return { id, dueDate, completedDate: undefined } as unknown as Task;
}
const NO_RAG = { overall: null, schedule: null, budget: null, scope: null } as const;

describe("computeDelta", () => {
  test("first visit: no prior lastVisitAt → isFirstVisit, zero total", () => {
    const r = computeDelta({ prior: {}, activity: [entry(1, "2026-06-20T10:00:00.000Z", "task.created")], currentRag: NO_RAG, overdue: [], today: "2026-06-21" });
    expect(r.isFirstVisit).toBe(true);
    expect(r.total).toBe(0);
    expect(r.since).toBeUndefined();
  });

  test("counts activity strictly after lastVisitAt, grouped by entity+verb", () => {
    const r = computeDelta({
      prior: { lastVisitAt: "2026-06-20T00:00:00.000Z" },
      activity: [
        entry(1, "2026-06-19T10:00:00.000Z", "task.created"),
        entry(2, "2026-06-20T10:00:00.000Z", "task.created"),
        entry(3, "2026-06-20T11:00:00.000Z", "task.updated"),
        entry(4, "2026-06-20T12:00:00.000Z", "task.reopened"),
        entry(5, "2026-06-20T13:00:00.000Z", "raid.autoIssue"),
        entry(6, "2026-06-20T14:00:00.000Z", "task.deleted"),
      ],
      currentRag: NO_RAG, overdue: [], today: "2026-06-21",
    });
    expect(r.counts.tasks).toEqual({ created: 1, updated: 2, completed: 0, statusChanged: 0 });
    expect(r.counts.raid.created).toBe(1);
    expect(r.since).toBe("2026-06-20T00:00:00.000Z");
  });

  test("raid.statusChanged maps to statusChanged", () => {
    const r = computeDelta({ prior: { lastVisitAt: "2026-06-20T00:00:00.000Z" }, activity: [entry(1, "2026-06-20T10:00:00.000Z", "raid.statusChanged")], currentRag: NO_RAG, overdue: [], today: "2026-06-21" });
    expect(r.counts.raid.statusChanged).toBe(1);
  });

  test("newOverdue: overdue task whose dueDate >= last-visit date", () => {
    const r = computeDelta({
      prior: { lastVisitAt: "2026-06-20T00:00:00.000Z" },
      activity: [], currentRag: NO_RAG,
      overdue: [task(1, "2026-06-19"), task(2, "2026-06-20"), task(3, "2026-06-21")],
      today: "2026-06-22",
    });
    expect(r.newOverdue.map((t) => t.id)).toEqual([2, 3]);
  });

  test("ragFlips: emitted only when prior != current; worsened flag by rank", () => {
    const r = computeDelta({
      prior: { lastVisitAt: "2026-06-20T00:00:00.000Z", rag: { schedule: "G", budget: "R" } },
      activity: [], currentRag: { overall: null, schedule: "A", budget: "R", scope: null },
      overdue: [], today: "2026-06-21",
    });
    expect(r.ragFlips).toEqual([{ scope: "schedule", from: "G", to: "A", worsened: true }]);
  });

  test("ragFlip from undefined prior treated as null→value", () => {
    const r = computeDelta({ prior: { lastVisitAt: "2026-06-20T00:00:00.000Z" }, activity: [], currentRag: { ...NO_RAG, overall: "R" }, overdue: [], today: "2026-06-21" });
    expect(r.ragFlips).toEqual([{ scope: "overall", from: null, to: "R", worsened: true }]);
  });

  test("total sums activity + newOverdue + flips; zero when nothing changed", () => {
    const quiet = computeDelta({ prior: { lastVisitAt: "2026-06-20T00:00:00.000Z", rag: { overall: "G" } }, activity: [], currentRag: { ...NO_RAG, overall: "G" }, overdue: [], today: "2026-06-21" });
    expect(quiet.total).toBe(0);
  });
});

describe("buildGreeting", () => {
  test("hour thresholds: <12 morning, <18 afternoon, else evening", () => {
    expect(buildGreeting(8, { needsYou: 0, milestonesSoon: 0 }).greetingKey).toBe("dashboardGreetingMorning");
    expect(buildGreeting(13, { needsYou: 0, milestonesSoon: 0 }).greetingKey).toBe("dashboardGreetingAfternoon");
    expect(buildGreeting(20, { needsYou: 0, milestonesSoon: 0 }).greetingKey).toBe("dashboardGreetingEvening");
  });
  test("passes summary counts through", () => {
    expect(buildGreeting(8, { needsYou: 3, milestonesSoon: 2 }).summary).toEqual({ needsYou: 3, milestonesSoon: 2 });
  });
});
