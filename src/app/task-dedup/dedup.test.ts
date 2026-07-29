import { describe, expect, test } from "vitest";
import {
  applyMerges,
  buildDedupContext,
  buildDedupSystemPrompt,
  groundMergeGroups,
  MAX_MERGE_GROUPS,
  parseMergeProposal,
  PROPOSE_MERGES_TOOL,
  type RawMergeGroup,
} from "./dedup";
import { type Task } from "../types";

function task(over: Partial<Task> & { id: number }): Task {
  return {
    taskName: over.taskName ?? `Task ${over.id}`,
    assignee: over.assignee ?? "",
    assigneeEmail: over.assigneeEmail ?? "",
    dueDate: over.dueDate ?? "2026-08-01",
    lastUpdateDate: over.lastUpdateDate ?? "2026-07-01",
    priority: over.priority ?? "Medium",
    status: over.status ?? "To Do",
    blockers: over.blockers ?? "",
    description: over.description ?? "",
    ...over,
  };
}

const TASKS: Task[] = [
  task({ id: 1, taskName: "Write API docs" }),
  task({ id: 2, taskName: "Write the API documentation" }),
  task({ id: 3, taskName: "Deploy service" }),
];

describe("parseMergeProposal", () => {
  test("returns null when input is not an object or lacks a groups array", () => {
    expect(parseMergeProposal(null)).toBeNull();
    expect(parseMergeProposal("x")).toBeNull();
    expect(parseMergeProposal({})).toBeNull();
    expect(parseMergeProposal({ groups: "nope" })).toBeNull();
  });

  test("maps well-formed groups and coerces numeric strings", () => {
    const parsed = parseMergeProposal({
      groups: [
        { keepId: "1", mergeIds: ["2", 4], rationale: " dup ", unifiedFields: { title: "Docs", description: "d" } },
      ],
    });
    expect(parsed).toEqual([
      { keepId: 1, mergeIds: [2, 4], rationale: "dup", unifiedFields: { taskName: "Docs", description: "d" } },
    ]);
  });

  test("drops malformed groups but keeps an empty array shape", () => {
    expect(parseMergeProposal({ groups: [] })).toEqual([]);
    expect(parseMergeProposal({ groups: [{ mergeIds: [1] }, null, 5] })).toEqual([]);
  });
});

describe("groundMergeGroups (anti-hallucination)", () => {
  test("drops hallucinated keepId and mergeId that do not exist in the live tasks", () => {
    const raw: RawMergeGroup[] = [
      { keepId: 999, mergeIds: [2], rationale: "x" }, // keepId not real
      { keepId: 1, mergeIds: [2, 888], rationale: "y" }, // 888 not real → dropped, 2 kept
    ];
    const grounded = groundMergeGroups(raw, TASKS);
    expect(grounded).toHaveLength(1);
    expect(grounded[0].keepId).toBe(1);
    expect(grounded[0].merged.map((m) => m.id)).toEqual([2]);
  });

  test("drops a group with no real duplicates (< 2 tasks total)", () => {
    const grounded = groundMergeGroups([{ keepId: 1, mergeIds: [777], rationale: "x" }], TASKS);
    expect(grounded).toEqual([]);
  });

  test("keepId can never be in its own mergeIds", () => {
    const grounded = groundMergeGroups([{ keepId: 1, mergeIds: [1, 2], rationale: "x" }], TASKS);
    expect(grounded[0].merged.map((m) => m.id)).toEqual([2]);
  });

  test("a task appears in only one group (no double-claim across groups)", () => {
    const raw: RawMergeGroup[] = [
      { keepId: 1, mergeIds: [2], rationale: "a" },
      { keepId: 3, mergeIds: [2], rationale: "b" }, // 2 already claimed → group dropped
    ];
    const grounded = groundMergeGroups(raw, TASKS);
    expect(grounded).toHaveLength(1);
    expect(grounded[0].keepId).toBe(1);
  });

  test("a keepId already claimed as a merged duplicate is rejected", () => {
    const raw: RawMergeGroup[] = [
      { keepId: 1, mergeIds: [2], rationale: "a" },
      { keepId: 2, mergeIds: [3], rationale: "b" }, // 2 was merged away → cannot be a keep
    ];
    const grounded = groundMergeGroups(raw, TASKS);
    expect(grounded).toHaveLength(1);
    expect(grounded[0].keepId).toBe(1);
  });

  test("sanitizes unified fields and ignores a blank unified title", () => {
    const grounded = groundMergeGroups(
      [{ keepId: 1, mergeIds: [2], rationale: "x", unifiedFields: { taskName: "   ", description: "merged notes" } }],
      TASKS,
    );
    expect(grounded[0].unified.taskName).toBeUndefined();
    expect(grounded[0].unified.description).toBe("merged notes");
  });

  test("caps the number of returned groups", () => {
    const many: Task[] = [];
    const raw: RawMergeGroup[] = [];
    for (let i = 1; i <= (MAX_MERGE_GROUPS + 5) * 2; i += 2) {
      many.push(task({ id: i, taskName: `A${i}` }));
      many.push(task({ id: i + 1, taskName: `A${i}` }));
      raw.push({ keepId: i, mergeIds: [i + 1], rationale: "d" });
    }
    expect(groundMergeGroups(raw, many)).toHaveLength(MAX_MERGE_GROUPS);
  });
});

describe("applyMerges", () => {
  test("removes duplicates and applies unified fields to the keep task", () => {
    const grounded = groundMergeGroups(
      [{ keepId: 1, mergeIds: [2], rationale: "x", unifiedFields: { taskName: "API documentation", description: "n" } }],
      TASKS,
    );
    const res = applyMerges(TASKS, grounded, "2026-07-17T00:00:00.000Z");
    expect(res.nextTasks.map((tk) => tk.id)).toEqual([1, 3]);
    expect(res.removed.map((tk) => tk.id)).toEqual([2]);
    expect(res.removedCount).toBe(1);
    const keep = res.nextTasks.find((tk) => tk.id === 1)!;
    expect(keep.taskName).toBe("API documentation");
    expect(keep.description).toBe("n");
    expect(keep.localModifiedAt).toBe("2026-07-17T00:00:00.000Z");
    expect(res.editedBefore.map((tk) => tk.id)).toEqual([1]);
    // originals untouched (immutability)
    expect(TASKS.find((tk) => tk.id === 1)!.taskName).toBe("Write API docs");
  });

  test("no unified change → keep is not re-stamped and not counted as edited", () => {
    const grounded = groundMergeGroups([{ keepId: 1, mergeIds: [2], rationale: "x" }], TASKS);
    const res = applyMerges(TASKS, grounded, "NOW");
    const keep = res.nextTasks.find((tk) => tk.id === 1)!;
    expect(keep.localModifiedAt).toBeUndefined();
    expect(res.editedBefore).toEqual([]);
  });

  test("a Jira-synced keep keeps its own fields but its duplicates are removed", () => {
    const tasks = [
      task({ id: 1, taskName: "Write API docs", jiraKey: "LOP-1" }),
      task({ id: 2, taskName: "dup" }),
    ];
    const grounded = groundMergeGroups(
      [{ keepId: 1, mergeIds: [2], rationale: "x", unifiedFields: { taskName: "changed" } }],
      tasks,
    );
    const res = applyMerges(tasks, grounded, "NOW");
    expect(res.nextTasks.map((tk) => tk.id)).toEqual([1]);
    expect(res.nextTasks[0].taskName).toBe("Write API docs"); // unchanged (read-only)
    expect(res.editedBefore).toEqual([]);
  });
});

describe("buildDedupContext", () => {
  test("emits one compact line per task with status/assignee/due/title", () => {
    const ctx = buildDedupContext([task({ id: 7, taskName: "Ship it", assignee: "Ada", dueDate: "2026-09-01", status: "In Progress", description: "line1\nline2" })]);
    expect(ctx).toContain("#7 [In Progress] Ada due:2026-09-01 — Ship it :: line1 line2");
  });

  test("falls back to unassigned / '-' for blank assignee and due date", () => {
    const ctx = buildDedupContext([task({ id: 5, taskName: "x", assignee: "", dueDate: "" })]);
    expect(ctx).toContain("#5 [To Do] unassigned due:- — x");
  });

  test("does not FUSE the words either side of a block boundary", () => {
    // ★★ The BEHAVIOURAL pin for the five-consumer fix. htmlToText strips tags
    // leaving nothing in their place, so it read "delayMitigation"; only
    // descriptionText separates the boundary first. A source-scan for
    // `htmlToText(....description` guards the literal revert but not a
    // destructured or aliased one — this pins the property instead of the
    // spelling.
    //
    // ★ The sibling fixture above ("line1\nline2") CANNOT distinguish the two:
    // it is a legacy plain value, so descriptionHtml turns the newline into a
    // <br> that both projections handle identically. A block boundary is
    // required to tell fix from bug.
    const ctx = buildDedupContext([
      task({ id: 9, taskName: "t", description: "<p>Vendor delay</p><p>Mitigation plan</p>" }),
    ]);
    expect(ctx).toContain("Vendor delay Mitigation plan");
    expect(ctx).not.toContain("delayMitigation");
    expect(ctx).not.toContain("<p>");
  });
});

describe("tool + prompt", () => {
  test("PROPOSE_MERGES_TOOL is the forced tool name with a groups schema", () => {
    expect(PROPOSE_MERGES_TOOL.name).toBe("propose_task_merges");
    expect(PROPOSE_MERGES_TOOL.input_schema.required).toContain("groups");
  });

  test("system prompt tells the model to return empty groups when nothing is a clear duplicate", () => {
    expect(buildDedupSystemPrompt().toLowerCase()).toContain("empty");
  });
});
