import { describe, expect, test } from "vitest";
import type { Milestone, Task } from "../types";
import { orderBacklog, milestoneChances } from "./milestones";
import { mulberry32 } from "./rng";
import type { SimOptions } from "./simulate";

const TODAY = "2026-10-12"; // a Monday

function task(id: number, over: Partial<Task> = {}): Task {
  return { id, dueDate: "", priority: "Medium", status: "Open", ...over } as Task;
}

function ms(id: number, date: string, linkedTaskIds: number[], over: Partial<Milestone> = {}): Milestone {
  return { id, name: `M${id}`, date, linkedTaskIds, ...over };
}

function opts(over: Partial<SimOptions> = {}): SimOptions {
  return { trials: 100, rng: mulberry32(1), capacity: 1, horizon: 1300, integer: true, ...over };
}

function run(milestones: Milestone[], ordered: Task[], over: { closedIds?: number[]; samples?: number[]; date?: string } = {}) {
  return milestoneChances({
    milestones,
    ordered,
    closedIds: new Set(over.closedIds ?? []),
    sizeOf: () => 1,
    samples: over.samples ?? [1],
    today: over.date ?? TODAY,
    holidaySet: new Set<string>(),
    o: opts(),
  });
}

describe("orderBacklog", () => {
  test("orders by due date, blank last, then priority, then id", () => {
    const out = orderBacklog([
      task(1, { dueDate: "" }),
      task(2, { dueDate: "2026-11-01", priority: "Low" }),
      task(3, { dueDate: "2026-11-01", priority: "Urgent" }),
      task(5, { dueDate: "2026-11-01", priority: "Urgent" }),
      task(4, { dueDate: "2026-10-20" }),
    ]);
    expect(out.map((t) => t.id)).toEqual([4, 3, 5, 2, 1]);
  });
});

describe("milestoneChances", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => task(i + 1));

  test("prioritised chance is at least the due-date chance", () => {
    // task 20 is last of 20; 1/day, date 5 working days out (Mon 12 -> Mon 19)
    const [r] = run([ms(1, "2026-10-19", [20])], twenty);
    expect(r).toEqual({ id: 1, state: "chance", chance: 0, chancePrioritised: 1 });
  });

  test("due today with an open linked task is 0", () => {
    const [r] = run([ms(1, TODAY, [3])], twenty);
    expect(r).toEqual({ id: 1, state: "chance", chance: 0, chancePrioritised: 0 });
  });

  test("due today with all linked tasks closed is 1", () => {
    const [r] = run([ms(1, TODAY, [90])], [], { closedIds: [90] });
    expect(r).toEqual({ id: 1, state: "chance", chance: 1, chancePrioritised: 1 });
  });

  test("overdue milestone has no percent", () => {
    const [r] = run([ms(1, "2026-10-01", [3])], twenty);
    expect(r).toEqual({ id: 1, state: "overdue" });
  });

  test("milestone with no linked tasks reports no-linked-tasks", () => {
    expect(run([ms(1, "2026-11-01", [])], twenty)).toEqual([{ id: 1, state: "no-linked-tasks" }]);
  });

  test("achieved milestone is omitted", () => {
    expect(run([ms(1, "2026-11-01", [3], { achievedDate: "2026-10-01" })], twenty)).toEqual([]);
  });

  test("dangling linked id is ignored", () => {
    const [a] = run([ms(1, "2026-10-19", [3, 999])], twenty);
    expect(a).toMatchObject({ state: "chance", chance: 1 });
    expect(run([ms(2, "2026-10-19", [999])], twenty)).toEqual([{ id: 2, state: "no-linked-tasks" }]);
  });

  test("one pass answers several milestones", () => {
    const res = run([ms(1, "2026-10-14", [2]), ms(2, "2026-10-14", [3])], twenty);
    expect(res.map((r) => (r.state === "chance" ? r.chance : -1))).toEqual([1, 0]);
  });
});
