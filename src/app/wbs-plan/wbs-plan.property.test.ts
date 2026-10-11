import { describe, expect, test } from "vitest";
import fc from "fast-check";
import type { Task, TaskStatus } from "../types";
import { isTaskClosed } from "../task-closed";
import {
  applyWbsProposal,
  countNewRows,
  groundWbsProposal,
  type RawWbsItem,
  type WbsTarget,
} from "./wbs-plan";

const TODAY = "2026-10-11";
const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2026, 0, 1);
// Open statuses repeated so roughly a third of rows are closed, not half.
const STATUSES: TaskStatus[] = ["To Do", "To Do", "In Progress", "On Hold", "In Review", "Cancelled", "Done"];

/** Integer-based date: never `fc.date()` (it can emit an Invalid Date). */
const isoDay = fc.integer({ min: 0, max: 400 }).map((d) => new Date(EPOCH + d * DAY_MS).toISOString().slice(0, 10));

const taskSpec = fc.record({
  status: fc.constantFrom(...STATUSES),
  jira: fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
  group: fc.constantFrom("", "Build", "Test"),
  estimate: fc.option(fc.integer({ min: 1, max: 2000 }), { nil: undefined }),
  depSeeds: fc.array(fc.nat(), { maxLength: 3 }),
  due: isoDay,
});

/** Tasks 1..n; each depends only on LOWER ids, so the live graph is acyclic. */
const tasksArb = fc.array(taskSpec, { minLength: 3, maxLength: 10 }).map((specs) =>
  specs.map((s, i): Task => {
    const id = i + 1;
    const deps = id === 1 ? [] : [...new Set(s.depSeeds.map((n) => (n % (id - 1)) + 1))];
    return Object.freeze({
      id,
      taskName: `Task ${id}`,
      assignee: id % 2 === 0 ? "Ada" : "",
      assigneeEmail: "",
      dueDate: s.due,
      lastUpdateDate: "2026-10-01",
      priority: "Medium",
      status: s.status,
      blockers: "",
      description: "",
      ...(s.status === "Done" ? { completedDate: "2026-10-01" } : {}),
      ...(s.jira ? { jiraKey: `J-${id}` } : {}),
      ...(s.group ? { group: s.group } : {}),
      ...(s.estimate !== undefined ? { originalEstimateMinutes: s.estimate } : {}),
      ...(deps.length > 0 ? { dependencies: deps.map((taskId) => ({ taskId, type: "FS" as const })) } : {}),
    }) as Task;
  }),
);

// Ids beyond the list (0, and above its length) exercise unknownTask; the
// range stays small so two endpoints of one link often both resolve.
const idArb = fc.integer({ min: 0, max: 7 });
const refArb = fc.constantFrom("r1", "r2", "r3");
const estArb = fc.integer({ min: 0, max: 10_000 });
const targetArb: fc.Arbitrary<WbsTarget> = fc.oneof(
  { weight: 3, arbitrary: idArb.map((id) => ({ kind: "task" as const, id })) },
  { weight: 1, arbitrary: refArb.map((ref) => ({ kind: "ref" as const, ref })) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(idArb, fc.integer({ min: 0, max: 3 }))
      .map(([taskId, piece]) => ({ kind: "piece" as const, taskId, piece })),
  },
);

const itemArb: fc.Arbitrary<RawWbsItem> = fc.oneof(
  fc.record({
    kind: fc.constant("split" as const),
    taskId: idArb,
    pieces: fc.array(
      fc.record(
        { taskName: fc.constantFrom("a", "b", "c", "d", ""), estimateMinutes: estArb },
        { requiredKeys: ["taskName"] },
      ),
      { minLength: 1, maxLength: 7 },
    ),
    why: fc.constant(""),
  }),
  fc.record({ kind: fc.constant("regroup" as const), taskId: idArb, group: fc.constantFrom("G1", "G2", ""), why: fc.constant("") }),
  fc.record({
    kind: fc.constant("newTask" as const),
    ref: refArb,
    taskName: fc.constantFrom("n", "n", "n", ""),
    dueDate: fc.oneof({ weight: 3, arbitrary: isoDay }, { weight: 1, arbitrary: fc.constant("not a date") }),
    estimateMinutes: fc.option(estArb, { nil: undefined }),
    why: fc.constant(""),
  }),
  fc.record({ kind: fc.constant("estimate" as const), target: targetArb, estimateMinutes: estArb, why: fc.constant("") }),
  // Weighted up: both endpoints must resolve, so most generated links skip.
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("link" as const), from: targetArb, to: targetArb, why: fc.constant("") }) },
);

describe("applyWbsProposal — properties (ground → tick all → apply)", () => {
  test("never removes a row, never touches a closed, Jira or out-of-scope row", () => {
    // Anti-vacuity: count runs that actually wrote something, so a generator
    // that only ever produces skipped items cannot pass this test.
    const seen = { created: 0, edited: 0, linked: 0 };
    fc.assert(
      fc.property(
        tasksArb,
        fc.array(itemArb, { maxLength: 16 }),
        fc.array(fc.integer({ min: 0, max: 3 }).map((n) => n > 0), { minLength: 10, maxLength: 10 }),
        (tasks, items, inScope) => {
          const prev = Object.freeze(tasks);
          const scope = { taskIds: new Set(tasks.filter((_, i) => inScope[i]).map((t) => t.id)) };
          const ticked = groundWbsProposal({ items, truncated: false }, prev, scope).items;
          const need = countNewRows(ticked);
          const newIds = Array.from({ length: need }, (_, i) => 1000 + i);
          const r = applyWbsProposal(prev, ticked, newIds, TODAY, scope);

          // Nothing changed between ground and apply, so nothing is stale.
          expect(r.skippedStale).toBe(0);
          expect(r.applied).toBe(ticked.length);
          expect(r.created).toHaveLength(need);

          const next = new Map(r.nextTasks.map((t) => [t.id, t] as const));
          expect(next.size).toBe(r.nextTasks.length); // no duplicate ids
          const createdIds = new Set(r.created.map((t) => t.id));
          for (const t of prev) {
            const after = next.get(t.id);
            expect(after).toBeDefined(); // every input id is still present
            if (isTaskClosed(t) || t.jiraKey || !scope.taskIds.has(t.id)) expect(after).toBe(t);
          }
          for (const t of r.nextTasks) {
            if (!createdIds.has(t.id)) expect(prev.some((p) => p.id === t.id)).toBe(true);
            for (const d of t.dependencies ?? []) expect(next.has(d.taskId)).toBe(true);
          }
          expect(r.editedBefore.map((t) => t.id)).toEqual(r.editedAfter.map((t) => t.id));
          if (r.created.length > 0) seen.created++;
          if (r.editedAfter.length > 0) seen.edited++;
          if (ticked.some((g) => g.item.kind === "link")) seen.linked++;
        },
      ),
      { seed: 20261011, numRuns: 500 },
    );
    // Measured at this seed: created 149, edited 99, linked 23 of 500 runs.
    // The floors sit near half, so a generator change that starves a kind fails.
    expect(seen.created).toBeGreaterThanOrEqual(75);
    expect(seen.edited).toBeGreaterThanOrEqual(50);
    expect(seen.linked).toBeGreaterThanOrEqual(10);
  });
});
