import { describe, expect, it } from "vitest";
import { milestoneStatusBucket, taskStatusBuckets } from "./gantt-status-buckets";
import { type Milestone, type Task } from "./types";

const today = new Date("2026-08-03T00:00:00Z");
const bar = (end: string) => ({ start: new Date("2026-01-01T00:00:00Z"), end: new Date(`${end}T00:00:00Z`) });
const task = (over: Partial<Task>): Task => ({ id: 1, status: "To Do", ...over } as Task);

describe("taskStatusBuckets", () => {
  it("an unfinished task past its end is open AND overdue", () => {
    const b = taskStatusBuckets(task({ status: "To Do" }), bar("2026-07-01"), today);
    expect([...b].sort()).toEqual(["open", "overdue"]);
  });

  it("an unfinished task in the future is open only", () => {
    const b = taskStatusBuckets(task({ status: "In Progress" }), bar("2026-09-01"), today);
    expect([...b]).toEqual(["open"]);
  });

  it("a done task is completed only", () => {
    const b = taskStatusBuckets(
      task({ status: "Done", completedDate: "2026-07-01" }),
      bar("2026-07-01"),
      today,
    );
    expect([...b]).toEqual(["completed"]);
  });

  it("a CANCELLED task is completed, never open or overdue", () => {
    const b = taskStatusBuckets(task({ status: "Cancelled" }), bar("2026-07-01"), today);
    expect([...b]).toEqual(["completed"]);
  });
});

describe("milestoneStatusBucket", () => {
  const ms = (over: Partial<Milestone>): Milestone => ({ id: 1, name: "M", date: "2026-09-01", ...over } as Milestone);

  it("achieved is completed", () => {
    expect(milestoneStatusBucket(ms({ achievedDate: "2026-07-01" }), "2026-08-03")).toBe("completed");
  });

  it("unachieved and past due is overdue", () => {
    expect(milestoneStatusBucket(ms({ date: "2026-07-01" }), "2026-08-03")).toBe("overdue");
  });

  it("unachieved and future is open", () => {
    expect(milestoneStatusBucket(ms({ date: "2026-09-01" }), "2026-08-03")).toBe("open");
  });

  it("an unparseable date is open, never overdue", () => {
    expect(milestoneStatusBucket(ms({ date: "" }), "2026-08-03")).toBe("open");
  });
});
