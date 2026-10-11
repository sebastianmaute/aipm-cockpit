import { describe, expect, test } from "vitest";
import type { Task } from "../types";
import {
  applyWbsProposal,
  countNewRows,
  groundWbsProposal,
  type GroundedWbsItem,
  type RawWbsItem,
} from "./wbs-plan";

const TODAY = "2026-10-11";

const task = (id: number, over: Partial<Task> = {}): Task =>
  Object.freeze({
    id,
    taskName: `Task ${id}`,
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-11-01",
    lastUpdateDate: "2026-10-01",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
    ...over,
  }) as Task;

const TASKS: readonly Task[] = Object.freeze([task(1), task(2), task(3)]);

function ground(items: RawWbsItem[], tasks: readonly Task[] = TASKS, scope?: number[]) {
  return groundWbsProposal({ items, truncated: false }, tasks, {
    taskIds: new Set(scope ?? tasks.map((t) => t.id)),
  });
}

function apply(
  ticked: readonly GroundedWbsItem[],
  prev: readonly Task[] = TASKS,
  newIds: readonly number[] = [100, 101, 102, 103, 104, 105],
  scope?: number[],
) {
  return applyWbsProposal(prev, Object.freeze([...ticked]), Object.freeze([...newIds]), TODAY, {
    taskIds: new Set(scope ?? prev.map((t) => t.id)),
  });
}

const split = (taskId: number, pieces: Extract<RawWbsItem, { kind: "split" }>["pieces"]): RawWbsItem => ({
  kind: "split",
  taskId,
  pieces,
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

const byId = (rows: readonly Task[], id: number) => rows.find((t) => t.id === id) as Task;

describe("applyWbsProposal — splits", () => {
  test("split keeps the original id and appends the other pieces", () => {
    const prev = Object.freeze([
      task(1, {
        assignee: "Ada",
        assigneeEmail: "ada@example.com",
        resourceId: 7,
        group: "Build",
        labels: ["x"],
        priority: "High",
        dueDate: "2026-11-20",
        originalEstimateMinutes: 960,
      }),
      task(2),
    ]);
    const g = ground(
      [split(1, [{ taskName: "Design", estimateMinutes: 240 }, { taskName: "Code", description: "write it", estimateMinutes: 480 }])],
      prev,
    );
    const r = apply(g.items, prev);
    const original = byId(r.nextTasks, 1);
    expect(original.taskName).toBe("Design");
    expect(original.originalEstimateMinutes).toBe(240);
    expect(original.lastUpdateDate).toBe(TODAY);
    const piece2 = byId(r.nextTasks, 100);
    expect(piece2).toMatchObject({
      id: 100,
      taskName: "Code",
      description: "<p>write it</p>", // through sanitizeAiRichText at grounding
      originalEstimateMinutes: 480,
      assignee: "Ada",
      assigneeEmail: "ada@example.com",
      resourceId: 7,
      group: "Build",
      labels: ["x"],
      priority: "High",
      dueDate: "2026-11-20",
      status: "To Do",
      blockers: "",
      inquiriesSent: 0,
      createdDate: TODAY,
      lastUpdateDate: TODAY,
    });
    expect(piece2.dependencies ?? []).toEqual([]);
    expect(r.created.map((t) => t.id)).toEqual([100]);
    expect(r.applied).toBe(1);
    expect(r.nextTasks.map((t) => t.id)).toEqual([1, 2, 100]);
  });

  test("split piece 1 keeps notes, time booked and dependencies", () => {
    const noteLog = [{ id: 1, timestamp: "2026-10-01T00:00:00.000Z", html: "<p>n</p>", text: "n" }];
    const prev = Object.freeze([
      task(1, {
        noteLog,
        timeSpentMinutes: 90,
        description: "<p>old</p>",
        dependencies: [{ taskId: 2, type: "SS" }],
      }),
      task(2),
    ]);
    const g = ground([split(1, [{ taskName: "A" }, { taskName: "B" }])], prev);
    const original = byId(apply(g.items, prev).nextTasks, 1);
    expect(original.noteLog).toEqual(noteLog);
    expect(original.timeSpentMinutes).toBe(90);
    expect(original.description).toBe("<p>old</p>"); // no piece description → kept
    expect(original.dependencies).toEqual([{ taskId: 2, type: "SS" }]);
    expect(original.originalEstimateMinutes).toBeUndefined(); // no piece estimate → kept (absent)
  });

  test("split piece 1 description replaces the original's", () => {
    const g = ground([split(1, [{ taskName: "A", description: "new" }, { taskName: "B" }])]);
    expect(byId(apply(g.items).nextTasks, 1).description).toBe("<p>new</p>");
  });

  test.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["markup that sanitizes to nothing", "<p><script>alert(1)</script></p>"],
    ["an empty paragraph", "<p> </p>"],
  ])("a %s piece-1 description is treated as absent — the original's is kept", (_label, description) => {
    const prev = Object.freeze([task(1, { description: "<p>old</p>" }), task(2)]);
    const g = ground([split(1, [{ taskName: "A", description }, { taskName: "B" }])], prev);
    expect(g.items).toHaveLength(1);
    const item = g.items[0].item;
    expect(item.kind === "split" ? item.pieces[0].description : "not a split").toBeUndefined();
    expect(byId(apply(g.items, prev).nextTasks, 1).description).toBe("<p>old</p>");
  });

  test("a split and a regroup of the same task both land on the one row", () => {
    const g = ground([split(1, [{ taskName: "A" }, { taskName: "B" }]), { kind: "regroup", taskId: 1, group: "G", why: "" }]);
    const r = apply(g.items);
    expect(byId(r.nextTasks, 1)).toMatchObject({ taskName: "A", group: "G" });
    expect(r.editedBefore.map((t) => t.id)).toEqual([1]);
    expect(r.editedAfter.map((t) => t.id)).toEqual([1]);
    expect(r.applied).toBe(2);
  });

  // Regroups are written before splits, so the order the model gave them in
  // does not decide which group the new pieces land in.
  test.each([
    ["split then regroup", [split(1, [{ taskName: "A" }, { taskName: "B" }, { taskName: "C" }]), { kind: "regroup", taskId: 1, group: "G", why: "" } as RawWbsItem]],
    ["regroup then split", [{ kind: "regroup", taskId: 1, group: "G", why: "" } as RawWbsItem, split(1, [{ taskName: "A" }, { taskName: "B" }, { taskName: "C" }])]],
  ])("a split and a regroup of the same task put every piece in the new group (%s)", (_label, items) => {
    const prev = Object.freeze([task(1, { group: "Old" }), TASKS[1], TASKS[2]]);
    const r = apply(ground(items, prev).items, prev);
    expect([1, 100, 101].map((id) => byId(r.nextTasks, id).group)).toEqual(["G", "G", "G"]);
    expect(r.applied).toBe(2);
  });
});

describe("applyWbsProposal — piece 1 is the original row", () => {
  test("a link to piece 1 still lands on the original row when the split is unticked", () => {
    const g = ground([split(1, [{ taskName: "A" }, { taskName: "B" }]), link(T(2), P(1, 1))]);
    const ticked = g.items.filter((it) => it.item.kind === "link");
    expect(ticked).toHaveLength(1);
    const r = apply(ticked);
    expect(byId(r.nextTasks, 1).dependencies).toEqual([{ taskId: 2, type: "FS" }]);
    expect(byId(r.nextTasks, 1).taskName).toBe("Task 1");
    expect(r.applied).toBe(1);
    expect(r.skippedStale).toBe(0);
    expect(r.created).toEqual([]);
  });

  test("an estimate on piece 1 still lands on the original row when the split is unticked", () => {
    const g = ground([
      split(1, [{ taskName: "A" }, { taskName: "B" }]),
      { kind: "estimate", target: P(1, 1), estimateMinutes: 90, why: "" },
    ]);
    const ticked = g.items.filter((it) => it.item.kind === "estimate");
    expect(ticked).toHaveLength(1);
    const r = apply(ticked);
    expect(byId(r.nextTasks, 1).originalEstimateMinutes).toBe(90);
    expect(r.applied).toBe(1);
    expect(r.skippedStale).toBe(0);
  });
});

describe("applyWbsProposal — new tasks", () => {
  test("a new task has the chat-created row shape", () => {
    const g = ground([newTask("a", { group: "Ops", assignee: "Bo", description: "d", estimateMinutes: 60 })]);
    const r = apply(g.items);
    expect(r.created).toEqual([
      {
        id: 100,
        taskName: "New a",
        assignee: "Bo",
        assigneeEmail: "",
        dueDate: "2026-12-01",
        lastUpdateDate: TODAY,
        createdDate: TODAY,
        priority: "Medium",
        status: "To Do",
        blockers: "",
        description: "<p>d</p>",
        inquiriesSent: 0,
        group: "Ops",
        labels: [],
        originalEstimateMinutes: 60,
      },
    ]);
  });

  test("consumes new ids in proposal order and throws when they run out", () => {
    const g = ground([newTask("a"), split(1, [{ taskName: "A" }, { taskName: "B" }, { taskName: "C" }]), newTask("b")]);
    const r = apply(g.items);
    expect(r.created.map((t) => [t.id, t.taskName])).toEqual([
      [100, "New a"],
      [101, "B"],
      [102, "C"],
      [103, "New b"],
    ]);
    expect(() => apply(g.items, TASKS, [100, 101, 102])).toThrow();
  });
});

describe("applyWbsProposal — existing rows", () => {
  test("a regroup changes only group and lastUpdateDate", () => {
    const g = ground([{ kind: "regroup", taskId: 2, group: "New", why: "" }]);
    const r = apply(g.items);
    expect(byId(r.nextTasks, 2)).toEqual({ ...TASKS[1], group: "New", lastUpdateDate: TODAY });
    expect(byId(r.nextTasks, 1)).toBe(TASKS[0]);
  });

  test("an estimate fills an empty estimate", () => {
    const g = ground([{ kind: "estimate", target: T(3), estimateMinutes: 120, why: "" }]);
    const r = apply(g.items);
    expect(byId(r.nextTasks, 3)).toEqual({ ...TASKS[2], originalEstimateMinutes: 120, lastUpdateDate: TODAY });
  });

  test("an estimate on a new task's ref lands on the created row", () => {
    const g = ground([newTask("a"), { kind: "estimate", target: R("a"), estimateMinutes: 30, why: "" }]);
    const r = apply(g.items);
    expect(byId(r.nextTasks, 100).originalEstimateMinutes).toBe(30);
    expect(r.editedBefore).toEqual([]);
  });
});

describe("applyWbsProposal — links", () => {
  test("a link from an existing row to a new row lands on the new row's dependencies", () => {
    const g = ground([newTask("a"), link(T(1), R("a"))]);
    const r = apply(g.items);
    expect(byId(r.nextTasks, 100).dependencies).toEqual([{ taskId: 1, type: "FS" }]);
    expect(byId(r.nextTasks, 1)).toBe(TASKS[0]);
    expect(r.editedBefore).toEqual([]);
  });

  test("a link into an existing row appends FS and makes it an edited row", () => {
    const prev = Object.freeze([task(1), task(2, { dependencies: [{ taskId: 3, type: "SS" }] }), task(3)]);
    const g = ground([newTask("a"), link(R("a"), T(2))], prev);
    const r = apply(g.items, prev);
    expect(byId(r.nextTasks, 2).dependencies).toEqual([
      { taskId: 3, type: "SS" },
      { taskId: 100, type: "FS" },
    ]);
    expect(byId(r.nextTasks, 2).lastUpdateDate).toBe(TODAY);
    expect(r.editedAfter.map((t) => t.id)).toEqual([2]);
  });

  test("a link to a split piece lands on that piece's new row", () => {
    const g = ground([split(1, [{ taskName: "A" }, { taskName: "B" }]), link(P(1, 1), P(1, 2))]);
    const r = apply(g.items);
    expect(byId(r.nextTasks, 100).dependencies).toEqual([{ taskId: 1, type: "FS" }]);
  });

  test("drops a ticked link whose endpoint is unticked", () => {
    const g = ground([split(1, [{ taskName: "A" }, { taskName: "B" }]), link(T(2), P(1, 2))]);
    const ticked = g.items.filter((it) => it.item.kind !== "split");
    expect(ticked).toHaveLength(1);
    const r = apply(ticked);
    const ids = new Set(r.nextTasks.map((t) => t.id));
    for (const t of r.nextTasks) for (const d of t.dependencies ?? []) expect(ids.has(d.taskId)).toBe(true);
    expect(r.applied).toBe(0);
    expect(r.skippedStale).toBe(0);
    expect(r.created).toEqual([]);
    expect(r.nextTasks).toEqual(TASKS);
  });

  test("a link whose requirement is unticked is not counted stale, even when its row changed", () => {
    const g = ground([split(1, [{ taskName: "A" }, { taskName: "B" }]), link(T(2), P(1, 2))]);
    const ticked = g.items.filter((it) => it.item.kind === "link");
    const prev = Object.freeze([task(1, { taskName: "edited" }), TASKS[1], TASKS[2]]);
    const r = apply(ticked, prev);
    expect(r.skippedStale).toBe(0);
    expect(r.applied).toBe(0);
  });

  test("a link whose endpoint went stale is dropped without being counted", () => {
    const g = ground([split(1, [{ taskName: "A" }, { taskName: "B" }]), link(T(2), P(1, 2))]);
    const prev = Object.freeze([task(1, { taskName: "edited" }), TASKS[1], TASKS[2]]);
    const r = apply(g.items, prev);
    expect(r.skippedStale).toBe(1);
    expect(r.applied).toBe(0);
    expect(r.nextTasks).toEqual(prev);
  });
});

describe("applyWbsProposal — stale items", () => {
  test("skips an item whose target row changed since the proposal", () => {
    const g = ground([
      { kind: "regroup", taskId: 2, group: "G", why: "" },
      { kind: "estimate", target: T(3), estimateMinutes: 60, why: "" },
    ]);
    const edited = task(2, { taskName: "edited elsewhere" });
    const prev = Object.freeze([TASKS[0], edited, TASKS[2]]);
    const r = apply(g.items, prev);
    expect(r.skippedStale).toBe(1);
    expect(r.applied).toBe(1);
    expect(byId(r.nextTasks, 2)).toBe(edited);
    expect(r.editedAfter.map((t) => t.id)).toEqual([3]);
  });

  test("a target closed since the proposal is skipped as stale", () => {
    const g = ground([{ kind: "regroup", taskId: 2, group: "G", why: "" }]);
    const closed = task(2, { status: "Done", completedDate: "2026-10-10" });
    const prev = Object.freeze([TASKS[0], closed, TASKS[2]]);
    const r = apply(g.items, prev);
    expect(r.skippedStale).toBe(1);
    expect(byId(r.nextTasks, 2)).toBe(closed);
  });

  test("a target deleted since the proposal is skipped as stale", () => {
    const g = ground([{ kind: "regroup", taskId: 2, group: "G", why: "" }]);
    const prev = Object.freeze([TASKS[0], TASKS[2]]);
    const r = apply(g.items, prev);
    expect(r.skippedStale).toBe(1);
    expect(r.nextTasks).toEqual(prev);
  });

  test("re-grounding drops an item the scope no longer covers, though the row is identical", () => {
    const g = ground([{ kind: "regroup", taskId: 2, group: "G", why: "" }]);
    const r = apply(g.items, TASKS, [100], [1, 3]);
    expect(r.skippedStale).toBe(1);
    expect(r.nextTasks).toEqual(TASKS);
  });

});

describe("applyWbsProposal — bookkeeping", () => {
  test("countNewRows for 1 newTask plus a 3-piece split is 3", () => {
    const g = ground([newTask("a"), split(1, [{ taskName: "A" }, { taskName: "B" }, { taskName: "C" }])]);
    expect(countNewRows(g.items)).toBe(3);
    expect(countNewRows([])).toBe(0);
  });

  test("editedBefore and editedAfter hold the same ids in the same order, created rows absent", () => {
    const g = ground([
      { kind: "regroup", taskId: 3, group: "G", why: "" },
      newTask("a"),
      split(1, [{ taskName: "A" }, { taskName: "B" }]),
      link(R("a"), T(2)),
    ]);
    const r = apply(g.items);
    const before = r.editedBefore.map((t) => t.id);
    expect(before).toEqual(r.editedAfter.map((t) => t.id));
    expect(new Set(before)).toEqual(new Set([1, 2, 3]));
    expect(before).toHaveLength(3);
    for (const c of r.created) expect(before).not.toContain(c.id);
    r.editedBefore.forEach((t) => expect(t).toBe(byId(TASKS, t.id)));
    expect(r.applied).toBe(4);
  });

  test("inputs are left unmutated", () => {
    const prev = Object.freeze([task(1, { labels: Object.freeze(["l"]) as string[], dependencies: Object.freeze([]) as never }), task(2), task(3)]);
    const g = ground(
      [split(1, [{ taskName: "A" }, { taskName: "B" }]), newTask("a"), link(R("a"), T(1)), link(T(2), P(1, 2))],
      prev,
    );
    const items = g.items.map((it) => Object.freeze(it));
    const snapshot = JSON.stringify(prev);
    const r = apply(items, prev);
    expect(JSON.stringify(prev)).toBe(snapshot);
    expect(r.applied).toBe(4);
  });
});
