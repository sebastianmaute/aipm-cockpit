import { describe, expect, test } from "vitest";
import type { Milestone, Task } from "../types";
import {
  MAX_SPLIT_PIECES,
  MAX_WBS_ESTIMATE_MINUTES,
  MAX_WBS_ITEMS,
  PROPOSE_WBS_TOOL,
  buildWbsContext,
  buildWbsSystemPrompt,
  parseWbsProposal,
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

describe("parseWbsProposal", () => {
  test("returns null for a non-object and for a missing items array", () => {
    expect(parseWbsProposal(null)).toBeNull();
    expect(parseWbsProposal("x")).toBeNull();
    expect(parseWbsProposal({})).toBeNull();
    expect(parseWbsProposal({ items: "no" })).toBeNull();
  });

  test("keeps each of the five kinds with its fields", () => {
    const r = parseWbsProposal({
      items: [
        { kind: "split", taskId: 1, why: "big", pieces: [{ taskName: "A", description: "d", estimateMinutes: 60 }, { taskName: "B" }] },
        { kind: "regroup", taskId: 2, group: "Build", why: "w" },
        { kind: "newTask", ref: "n1", taskName: "New", dueDate: "2026-12-01", group: "G", description: "d", assignee: "Ann", estimateMinutes: 120, why: "w" },
        { kind: "estimate", target: { taskId: 3 }, estimateMinutes: 480, why: "w" },
        { kind: "link", from: { taskId: 1 }, to: { ref: "n1" }, why: "w" },
      ],
    });
    expect(r?.truncated).toBe(false);
    expect(r?.items).toEqual([
      { kind: "split", taskId: 1, why: "big", pieces: [{ taskName: "A", description: "d", estimateMinutes: 60 }, { taskName: "B" }] },
      { kind: "regroup", taskId: 2, group: "Build", why: "w" },
      { kind: "newTask", ref: "n1", taskName: "New", dueDate: "2026-12-01", group: "G", description: "d", assignee: "Ann", estimateMinutes: 120, why: "w" },
      { kind: "estimate", target: { kind: "task", id: 3 }, estimateMinutes: 480, why: "w" },
      { kind: "link", from: { kind: "task", id: 1 }, to: { kind: "ref", ref: "n1" }, why: "w" },
    ]);
  });

  test("drops unknown kinds and items missing a required field without throwing", () => {
    const r = parseWbsProposal({
      items: [
        null,
        "x",
        { kind: "delete", taskId: 1, why: "w" },
        { kind: "regroup", taskId: 2, why: "w" },
        { kind: "regroup", group: "G", why: "w" },
        { kind: "split", taskId: 1, why: "w", pieces: [{ taskName: "only" }] },
        { kind: "split", taskId: 1, why: "w", pieces: [{ taskName: "a" }, { taskName: "" }] },
        { kind: "split", taskId: 1, why: "w", pieces: [{ taskName: "a" }, 5] },
        { kind: "newTask", ref: "", taskName: "N", dueDate: "2026-12-01", why: "w" },
        { kind: "newTask", ref: "r", taskName: "N", why: "w" },
        { kind: "estimate", target: { taskId: 1 }, why: "w" },
        { kind: "estimate", target: { taskId: 1 }, estimateMinutes: 0, why: "w" },
        { kind: "estimate", target: { taskId: 1 }, estimateMinutes: MAX_WBS_ESTIMATE_MINUTES + 1, why: "w" },
        { kind: "link", from: { taskId: 1 }, why: "w" },
      ],
    });
    expect(r).toEqual({ items: [], truncated: false });
  });

  test("caps split pieces and drops out-of-range piece estimates", () => {
    const pieces = Array.from({ length: MAX_SPLIT_PIECES + 3 }, (_, i) => ({
      taskName: `P${i}`,
      estimateMinutes: i === 0 ? 99999 : 10,
    }));
    const item = parseWbsProposal({ items: [{ kind: "split", taskId: 1, why: "w", pieces }] })?.items[0];
    expect(item?.kind === "split" && item.pieces).toHaveLength(MAX_SPLIT_PIECES);
    expect(item?.kind === "split" && item.pieces[0]).toEqual({ taskName: "P0" });
  });

  test("maps the three target encodings", () => {
    const mk = (target: unknown) =>
      parseWbsProposal({ items: [{ kind: "estimate", target, estimateMinutes: 60, why: "w" }] })?.items[0];
    expect(mk({ taskId: 3 })).toMatchObject({ target: { kind: "task", id: 3 } });
    expect(mk({ ref: "a" })).toMatchObject({ target: { kind: "ref", ref: "a" } });
    expect(mk({ taskId: 3, piece: 2 })).toMatchObject({ target: { kind: "piece", taskId: 3, piece: 2 } });
  });

  test("drops an item whose target is empty, ambiguous or malformed", () => {
    const link = (to: unknown) =>
      parseWbsProposal({ items: [{ kind: "link", from: { taskId: 1 }, to, why: "w" }] })?.items;
    expect(link({})).toEqual([]);
    expect(link({ taskId: 3, ref: "a" })).toEqual([]);
    expect(link({ ref: "a", piece: 1 })).toEqual([]);
    expect(link({ ref: "  " })).toEqual([]);
    expect(link({ taskId: 3, piece: 0 })).toEqual([]);
    expect(link({ taskId: 3, piece: 1.5 })).toEqual([]);
    expect(link({ piece: 2 })).toEqual([]);
    expect(link("x")).toEqual([]);
    expect(link(null)).toEqual([]);
  });

  test("cuts the list to MAX_WBS_ITEMS and flags truncation", () => {
    const items = Array.from({ length: MAX_WBS_ITEMS + 5 }, (_, i) => ({
      kind: "regroup",
      taskId: i,
      group: "G",
      why: "w",
    }));
    const r = parseWbsProposal({ items });
    expect(r?.items).toHaveLength(MAX_WBS_ITEMS);
    expect(r?.truncated).toBe(true);
    expect(parseWbsProposal({ items: items.slice(0, MAX_WBS_ITEMS) })?.truncated).toBe(false);
  });

  test("coerces numeric strings for ids", () => {
    const r = parseWbsProposal({ items: [{ kind: "regroup", taskId: "7", group: "G", why: "w" }] });
    expect(r?.items[0]).toMatchObject({ taskId: 7 });
  });
});

describe("buildWbsContext", () => {
  const milestones: Milestone[] = [{ id: 1, name: "Go-live", date: "2026-12-15", linkedTaskIds: [] }];

  test("marks only scope ids, lists milestones, groups and project", () => {
    const tasks = [
      task(1, {
        group: "Build",
        description: "<p>Hello <b>world</b></p>",
        dependencies: [{ taskId: 2, type: "FS" }],
        originalEstimateMinutes: 120,
      }),
      task(2, { group: "Build" }),
      task(3, { group: "Test" }),
    ];
    const out = buildWbsContext({
      tasks,
      scopeIds: new Set([2]),
      milestones,
      project: { name: "Apollo", startDate: "2026-01-01", endDate: "2026-12-31" } as never,
    });
    expect(out).toContain("Apollo");
    expect(out).toContain("2026-01-01");
    expect(out).toContain("2026-12-31");
    expect(out).toContain("GROUPS: Build, Test");
    expect(out).toContain("2026-12-15 Go-live");
    expect(out.match(/\[in scope\]/g)).toHaveLength(1);
    expect(out).toMatch(/#2 \[in scope\]/);
    expect(out).not.toMatch(/#1 \[in scope\]/);
    expect(out).toContain("deps=2");
    expect(out).toContain("estimate=120m");
    expect(out).toContain("Hello world");
    expect(out).not.toContain("<b>");
    expect(out.indexOf("#2 ")).toBeLessThan(out.indexOf("#1 "));
  });

  test("cuts descriptions to 300 characters", () => {
    const out = buildWbsContext({
      tasks: [task(1, { description: "x".repeat(500) })],
      scopeIds: new Set(),
      milestones: [],
      project: undefined,
    });
    expect(out).toContain("x".repeat(300) + "…");
    expect(out).not.toContain("x".repeat(301));
    expect(out).toContain("(none)");
  });

  test("caps a 401-task list and says how many were omitted", () => {
    const tasks = Array.from({ length: 401 }, (_, i) => task(i + 1));
    const out = buildWbsContext({ tasks, scopeIds: new Set([401]), milestones: [], project: undefined });
    expect(out).toContain("…(1 more tasks omitted)");
    expect(out).toMatch(/#401 \[in scope\]/);
    expect(out).not.toMatch(/^#400 /m);
  });
});

describe("tool and prompt", () => {
  test("tool name and required items", () => {
    expect(PROPOSE_WBS_TOOL.name).toBe("propose_wbs_changes");
    expect(PROPOSE_WBS_TOOL.input_schema.required).toContain("items");
  });

  test("system prompt states the guarantees and caps", () => {
    const p = buildWbsSystemPrompt();
    expect(p).toContain("never deletes");
    expect(p).toContain(String(MAX_WBS_ITEMS));
    expect(p).toContain("prioritise");
  });
});
