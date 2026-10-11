import { describe, expect, test } from "vitest";
import type { Task } from "../types";
import {
  MAX_SPLIT_PIECES,
  MAX_WBS_ESTIMATE_MINUTES,
  groundWbsProposal,
  type RawWbsItem,
  type WbsSkipReason,
} from "./wbs-plan";

const task = (id: number, over: Partial<Task> = {}): Task =>
  ({
    id,
    taskName: `Task ${id}`,
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-11-01",
    lastUpdateDate: "2026-10-01",
    priority: "Medium",
    status: "Open",
    blockers: "",
    description: "",
    ...over,
  }) as Task;

const TASKS = [task(1), task(2), task(3)];

function ground(items: RawWbsItem[], tasks: readonly Task[] = TASKS, scope?: number[], truncated = false) {
  return groundWbsProposal({ items, truncated }, tasks, {
    taskIds: new Set(scope ?? tasks.map((t) => t.id)),
  });
}

function reasons(items: RawWbsItem[], tasks: readonly Task[] = TASKS, scope?: number[]): WbsSkipReason[] {
  return ground(items, tasks, scope).skipped.map((s) => s.reason);
}

const split = (taskId: number, n = 2): RawWbsItem => ({
  kind: "split",
  taskId,
  pieces: Array.from({ length: n }, (_, i) => ({ taskName: `P${i + 1}` })),
  why: "",
});
const newTask = (ref: string, over: Partial<Extract<RawWbsItem, { kind: "newTask" }>> = {}): RawWbsItem => ({
  kind: "newTask",
  ref,
  taskName: `New ${ref}`,
  dueDate: "2026-12-01",
  why: "",
  ...over,
});
const link = (
  from: Extract<RawWbsItem, { kind: "link" }>["from"],
  to: Extract<RawWbsItem, { kind: "link" }>["to"],
): RawWbsItem => ({ kind: "link", from, to, why: "" });
const T = (id: number) => ({ kind: "task" as const, id });
const R = (ref: string) => ({ kind: "ref" as const, ref });
const P = (taskId: number, piece: number) => ({ kind: "piece" as const, taskId, piece });

describe("groundWbsProposal — the existing-task rule (R1)", () => {
  test("unknownTask", () => {
    expect(reasons([{ kind: "regroup", taskId: 99, group: "G", why: "" }])).toEqual(["unknownTask"]);
  });

  test("closedTask, with a Done task and with a Cancelled task", () => {
    const tasks = [task(1, { status: "Done" }), task(2, { status: "Cancelled" })];
    expect(reasons([split(1), split(2)], tasks)).toEqual(["closedTask", "closedTask"]);
  });

  test("jiraTask", () => {
    expect(reasons([split(1)], [task(1, { jiraKey: "PRJ-1" })])).toEqual(["jiraTask"]);
  });

  test("outOfScope", () => {
    expect(reasons([split(2)], TASKS, [1])).toEqual(["outOfScope"]);
  });

  test("a closed task wins over Jira and scope, and Jira wins over scope", () => {
    const tasks = [task(1, { status: "Done", jiraKey: "PRJ-1" }), task(2, { jiraKey: "PRJ-2" })];
    expect(reasons([split(1), split(2)], tasks, [])).toEqual(["closedTask", "jiraTask"]);
  });

  test("checks both endpoints of a link, an estimate target and a piece's task id", () => {
    expect(
      reasons([
        link(T(1), T(99)),
        link(T(98), T(1)),
        { kind: "estimate", target: T(97), estimateMinutes: 60, why: "" },
        { kind: "estimate", target: P(96, 1), estimateMinutes: 60, why: "" },
        link(P(95, 2), T(1)),
      ]),
    ).toEqual(["unknownTask", "unknownTask", "unknownTask", "unknownTask", "unknownTask"]);
  });
});

describe("groundWbsProposal — value checks", () => {
  test("badPieces, with 1 piece and with 7", () => {
    expect(reasons([split(1, 1), split(2, MAX_SPLIT_PIECES + 1)])).toEqual(["badPieces", "badPieces"]);
  });

  test("keeps a split of 2 and of MAX_SPLIT_PIECES pieces", () => {
    const r = ground([split(1, 2), split(2, MAX_SPLIT_PIECES)]);
    expect(r.skipped).toEqual([]);
    expect(r.items).toHaveLength(2);
  });

  test("emptyName, for a whitespace name on a piece and on a newTask", () => {
    expect(
      reasons([
        { kind: "split", taskId: 1, pieces: [{ taskName: "A" }, { taskName: "   " }], why: "" },
        newTask("a", { taskName: " \t " }),
      ]),
    ).toEqual(["emptyName", "emptyName"]);
  });

  test("emptyName, for a blank regroup group and a blank newTask ref", () => {
    expect(reasons([{ kind: "regroup", taskId: 1, group: "  ", why: "" }, newTask("  ")])).toEqual([
      "emptyName",
      "emptyName",
    ]);
  });

  test("badDate", () => {
    expect(reasons([newTask("a", { dueDate: "2026-02-30" }), newTask("b", { dueDate: "" })])).toEqual([
      "badDate",
      "badDate",
    ]);
  });

  test("badEstimate, for 0, -5, 1.5 and 9601 (and 9600 is kept)", () => {
    const est = (id: number, m: number): RawWbsItem => ({ kind: "estimate", target: T(id), estimateMinutes: m, why: "" });
    const tasks = [task(1), task(2), task(3), task(4), task(5)];
    const r = groundWbsProposal(
      { items: [est(1, 0), est(2, -5), est(3, 1.5), est(4, MAX_WBS_ESTIMATE_MINUTES + 1), est(5, MAX_WBS_ESTIMATE_MINUTES)], truncated: false },
      tasks,
      { taskIds: new Set([1, 2, 3, 4, 5]) },
    );
    expect(r.skipped.map((s) => s.reason)).toEqual(["badEstimate", "badEstimate", "badEstimate", "badEstimate"]);
    expect(r.items.map((i) => i.item)).toEqual([est(5, MAX_WBS_ESTIMATE_MINUTES)]);
  });

  test("badEstimate on a split piece and on a newTask", () => {
    expect(
      reasons([
        { kind: "split", taskId: 1, pieces: [{ taskName: "A", estimateMinutes: 0 }, { taskName: "B" }], why: "" },
        newTask("a", { estimateMinutes: 9601 }),
      ]),
    ).toEqual(["badEstimate", "badEstimate"]);
  });

  test("hasEstimate on an existing task that already has one", () => {
    expect(
      reasons([{ kind: "estimate", target: T(1), estimateMinutes: 60, why: "" }], [task(1, { originalEstimateMinutes: 120 })]),
    ).toEqual(["hasEstimate"]);
  });

  test("an estimate on a ref or a piece is kept", () => {
    const r = ground([
      newTask("a"),
      split(1, 3),
      { kind: "estimate", target: R("a"), estimateMinutes: 60, why: "" },
      { kind: "estimate", target: P(1, 3), estimateMinutes: 30, why: "" },
    ]);
    expect(r.skipped).toEqual([]);
    expect(r.items).toHaveLength(4);
  });

  test("hasEstimate when the proposal already estimates that target", () => {
    expect(
      reasons([
        newTask("a", { estimateMinutes: 60 }),
        { kind: "estimate", target: R("a"), estimateMinutes: 30, why: "" },
        { kind: "split", taskId: 1, pieces: [{ taskName: "A" }, { taskName: "B", estimateMinutes: 5 }], why: "" },
        { kind: "estimate", target: P(1, 2), estimateMinutes: 30, why: "" },
        { kind: "estimate", target: T(2), estimateMinutes: 30, why: "" },
        { kind: "estimate", target: T(2), estimateMinutes: 40, why: "" },
      ]),
    ).toEqual(["hasEstimate", "hasEstimate", "hasEstimate"]);
  });

  test("an estimate on piece 1 is the original row's estimate", () => {
    expect(
      reasons(
        [split(1), { kind: "estimate", target: P(1, 1), estimateMinutes: 30, why: "" }],
        [task(1, { originalEstimateMinutes: 10 })],
      ),
    ).toEqual(["hasEstimate"]);
  });

  test("an estimate on piece 2 is allowed though the original row has one", () => {
    const r = ground(
      [split(1), { kind: "estimate", target: P(1, 2), estimateMinutes: 30, why: "" }],
      [task(1, { originalEstimateMinutes: 10 })],
    );
    expect(r.skipped).toEqual([]);
    expect(r.items.map((g) => g.item.kind)).toEqual(["split", "estimate"]);
  });

  test("duplicateRef: a second regroup or split of the same task, and a repeated newTask ref", () => {
    expect(
      reasons([
        { kind: "regroup", taskId: 1, group: "A", why: "" },
        { kind: "regroup", taskId: 1, group: "B", why: "" },
        split(2),
        split(2, 3),
        newTask("a"),
        newTask("a"),
      ]),
    ).toEqual(["duplicateRef", "duplicateRef", "duplicateRef"]);
  });

  test("a split and a regroup of the same task are both kept", () => {
    expect(reasons([split(1), { kind: "regroup", taskId: 1, group: "G", why: "" }])).toEqual([]);
  });
});

describe("groundWbsProposal — links", () => {
  test("selfLink, between two ids and between piece 1 and its own task", () => {
    expect(reasons([link(T(1), T(1)), split(2), link(P(2, 1), T(2))])).toEqual(["selfLink", "selfLink"]);
  });

  test("duplicateLink, against an existing dependency and against an earlier proposed link", () => {
    const tasks = [task(1, { dependencies: [{ taskId: 2, type: "FS" }] }), task(2), task(3)];
    expect(reasons([link(T(2), T(1)), link(T(3), T(2)), link(T(3), T(2))], tasks)).toEqual([
      "duplicateLink",
      "duplicateLink",
    ]);
  });

  test("unresolvedRef, for an unknown ref and for piece 3 on a two-piece split", () => {
    expect(reasons([split(1, 2), link(R("nope"), T(2)), link(P(1, 3), T(2)), link(T(2), P(1, 0))])).toEqual([
      "unresolvedRef",
      "unresolvedRef",
      "unresolvedRef",
    ]);
  });

  test("unresolvedRef for a piece of a dropped split, a dropped newTask's ref, and an unsplit task", () => {
    expect(
      reasons([
        split(1, 1),
        newTask("a", { dueDate: "nope" }),
        link(P(1, 2), T(2)),
        link(R("a"), T(2)),
        link(P(3, 2), T(2)),
        { kind: "estimate", target: R("a"), estimateMinutes: 10, why: "" },
      ]),
    ).toEqual(["badPieces", "badDate", "unresolvedRef", "unresolvedRef", "unresolvedRef", "unresolvedRef"]);
  });

  // The brief said "task 1 depends on 2", which makes 2 → a → 1 a second path
  // into 1, not a cycle (see the next test). The cycle needs 2 to depend on 1.
  test("refuses a link that cycles through a proposed new task", () => {
    const tasks = [task(1), task(2, { dependencies: [{ taskId: 1, type: "FS" }] })];
    const items = [newTask("a"), link(T(2), R("a")), link(R("a"), T(1))];
    const r = ground(items, tasks);
    expect(r.skipped).toEqual([{ item: items[2], reason: "cycle" }]);
    expect(r.items.map((i) => i.key)).toEqual(["i0", "i1"]);
  });

  test("keeps a second path into a task, which is not a cycle", () => {
    const tasks = [task(1, { dependencies: [{ taskId: 2, type: "FS" }] }), task(2)];
    expect(reasons([newTask("a"), link(T(2), R("a")), link(R("a"), T(1))], tasks)).toEqual([]);
  });

  test("refuses a cycle through a split piece", () => {
    const tasks = [task(1), task(2)];
    const items = [split(1, 2), link(P(1, 2), T(2)), link(T(2), P(1, 2))];
    expect(reasons(items, tasks)).toEqual(["cycle"]);
  });

  test("a ref may be cited before the newTask that defines it", () => {
    expect(reasons([link(R("a"), T(1)), newTask("a")])).toEqual([]);
  });

  test("a link between existing tasks is kept, writing no live row", () => {
    const tasks = [task(1), task(2)];
    const r = ground([link(T(1), T(2)), link(T(2), T(1))], tasks);
    expect(r.skipped.map((s) => s.reason)).toEqual(["cycle"]);
    expect(tasks[1].dependencies).toBeUndefined();
  });
});

describe("groundWbsProposal — the grounded items", () => {
  test("a kept split's baseRows[0] is the very live row object", () => {
    const r = ground([split(2)]);
    expect(r.items[0].baseRows[0]).toBe(TASKS[1]);
    expect(r.items[0].key).toBe("i0");
  });

  test("a link to a piece ≥ 2 requires the split's key", () => {
    const r = ground([{ kind: "regroup", taskId: 3, group: "G", why: "" }, split(1, 3), link(T(2), P(1, 3))]);
    expect(r.items[2].requires).toEqual(["i1"]);
    expect(r.items[2].baseRows).toEqual([TASKS[1], TASKS[0]]);
  });

  test("a link to piece 1 requires nothing", () => {
    const r = ground([split(1), link(T(2), P(1, 1))]);
    expect(r.items[1].requires).toEqual([]);
  });

  test("piece 1 is stored as its task, so the item does not depend on the split", () => {
    const r = ground([split(1), link(T(2), P(1, 1)), { kind: "estimate", target: P(1, 1), estimateMinutes: 30, why: "" }]);
    expect(r.items[1].item).toMatchObject({ kind: "link", to: T(1) });
    expect(r.items[2].item).toMatchObject({ kind: "estimate", target: T(1) });
  });

  test("a link to piece 1 of a skipped split is kept on the original row", () => {
    const r = ground([split(1, 1), link(T(2), P(1, 1))]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["badPieces"]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].item).toMatchObject({ kind: "link", from: T(2), to: T(1) });
  });

  test("a link to a ref requires that newTask's key", () => {
    const r = ground([newTask("a"), newTask("b"), link(R("a"), R("b"))]);
    expect(r.items[2].requires).toEqual(["i0", "i1"]);
    expect(r.items[2].baseRows).toEqual([]);
  });

  test("an estimate on a ref or piece ≥ 2 requires its item", () => {
    const r = ground([
      split(1),
      newTask("a"),
      { kind: "estimate", target: R("a"), estimateMinutes: 10, why: "" },
      { kind: "estimate", target: P(1, 2), estimateMinutes: 10, why: "" },
    ]);
    expect(r.items[2].requires).toEqual(["i1"]);
    expect(r.items[3].requires).toEqual(["i0"]);
    expect(r.items[3].baseRows[0]).toBe(TASKS[0]);
  });

  test("a description containing <script> comes back sanitized", () => {
    const r = ground([
      newTask("a", { description: "<p>ok</p><script>alert(1)</script>" }),
      { kind: "split", taskId: 1, pieces: [{ taskName: "A", description: "<script>x</script><b>b</b>" }, { taskName: "B" }], why: "" },
    ]);
    const nt = r.items[0].item as Extract<RawWbsItem, { kind: "newTask" }>;
    expect(nt.description).toContain("ok");
    expect(nt.description).not.toContain("<script");
    const sp = r.items[1].item as Extract<RawWbsItem, { kind: "split" }>;
    expect(sp.pieces[0].description).not.toContain("<script");
  });

  test("names, groups, assignees and refs are sanitized", () => {
    const r = ground([
      newTask(" a ", { taskName: "  Name  ", group: " G ", assignee: " Ann " }),
      { kind: "regroup", taskId: 1, group: "  Build ", why: "" },
      link(R("a"), T(2)),
    ]);
    expect(r.items[0].item).toMatchObject({ ref: "a", taskName: "Name", group: "G", assignee: "Ann" });
    expect(r.items[1].item).toMatchObject({ group: "Build" });
    expect(r.items[2].requires).toEqual(["i0"]);
  });

  test("keeps proposal order and carries truncated", () => {
    const r = ground([link(T(1), T(2)), split(3), newTask("a")], TASKS, undefined, true);
    expect(r.truncated).toBe(true);
    expect(r.items.map((i) => i.key)).toEqual(["i0", "i1", "i2"]);
    expect(ground([]).truncated).toBe(false);
  });

  test("a regroup and a non-ref estimate touch their one live row", () => {
    const r = ground([
      { kind: "regroup", taskId: 1, group: "G", why: "" },
      { kind: "estimate", target: T(2), estimateMinutes: 10, why: "" },
    ]);
    expect(r.items[0].baseRows).toEqual([TASKS[0]]);
    expect(r.items[0].baseRows[0]).toBe(TASKS[0]);
    expect(r.items[1].baseRows[0]).toBe(TASKS[1]);
    expect(r.items[1].requires).toEqual([]);
  });
});
