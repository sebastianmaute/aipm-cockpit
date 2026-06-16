import { describe, it, expect } from "vitest";
import { milestoneRebaselineDate, applyMilestoneRebaseline, isValidIsoDate } from "./action-rebaseline";
import type { Milestone, Task } from "./types";

function milestone(over: Partial<Milestone> = {}): Milestone {
  return { id: 1, name: "M1", date: "2026-06-01", linkedTaskIds: [], ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: 1, title: "T", status: "todo", dueDate: "2026-06-01", linkedTaskIds: [], ...over } as Task;
}

describe("milestoneRebaselineDate", () => {
  it("returns the linked-task forecast when it slips past today", () => {
    const m = milestone({ date: "2026-06-01", linkedTaskIds: [1] });
    const tasks = [task({ id: 1, dueDate: "2026-08-15" })];
    expect(milestoneRebaselineDate(m, tasks, "2026-06-16")).toBe("2026-08-15");
  });
  it("returns today when forecast is in the past (overdue, no slip)", () => {
    const m = milestone({ date: "2026-05-01", linkedTaskIds: [] });
    expect(milestoneRebaselineDate(m, [], "2026-06-16")).toBe("2026-06-16");
  });
  it("returns the milestone date when it is future and has no linked tasks", () => {
    const m = milestone({ date: "2026-09-01", linkedTaskIds: [] });
    expect(milestoneRebaselineDate(m, [], "2026-06-16")).toBe("2026-09-01");
  });
  it("returns today when the milestone date equals today (tie-case, no linked tasks)", () => {
    const m = milestone({ date: "2026-06-16", linkedTaskIds: [] });
    expect(milestoneRebaselineDate(m, [], "2026-06-16")).toBe("2026-06-16");
  });
});

describe("applyMilestoneRebaseline", () => {
  it("moves the matched milestone's date immutably", () => {
    const ms = [milestone({ id: 1, date: "2026-06-01" }), milestone({ id: 2, date: "2026-07-01" })];
    const next = applyMilestoneRebaseline(ms, 1, "2026-08-15");
    expect(next).not.toBe(ms);
    expect(next[0].date).toBe("2026-08-15");
    expect(next[1]).toBe(ms[1]); // untouched
    expect(ms[0].date).toBe("2026-06-01"); // original unmutated
  });
  it("returns the SAME array ref when no milestone matches", () => {
    const ms = [milestone({ id: 1 })];
    expect(applyMilestoneRebaseline(ms, 99, "2026-08-15")).toBe(ms);
  });
});

describe("isValidIsoDate", () => {
  it("accepts a real YYYY-MM-DD date", () => { expect(isValidIsoDate("2026-06-16")).toBe(true); });
  it("rejects an out-of-range month", () => { expect(isValidIsoDate("2026-13-01")).toBe(false); });
  it("rejects unpadded parts", () => { expect(isValidIsoDate("2026-6-1")).toBe(false); });
  it("rejects empty and junk", () => {
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate("not-a-date")).toBe(false);
  });
  it("accepts a leap-year Feb 29", () => { expect(isValidIsoDate("2024-02-29")).toBe(true); });
  it("rejects a non-leap-year Feb 29", () => { expect(isValidIsoDate("2025-02-29")).toBe(false); });
});
