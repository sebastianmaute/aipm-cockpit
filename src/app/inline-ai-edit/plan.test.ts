// src/app/inline-ai-edit/plan.test.ts
import { describe, it, expect } from "vitest";
import { describeToolCalls, describeEntityCalls, type ToolUseLike } from "./plan";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { type Workspace } from "../workspace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const task = { id: 42, taskName: "Fix login bug", assignee: "Anna", dueDate: "2026-08-12", status: "To Do", priority: "Medium" } as any;
const ws = { tasks: [task], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as Workspace;

function block(name: string, input: Record<string, unknown>): ToolUseLike {
  return { type: "tool_use", id: "b1", name, input };
}

describe("describeToolCalls", () => {
  it("diffs an update_task on the target task", () => {
    const plan = describeToolCalls([block("update_task", { id: 42, dueDate: "2026-08-15", status: "In Progress" })], { task, ws });
    expect(plan.updates).toEqual([
      { field: "dueDate", before: "2026-08-12", after: "2026-08-15" },
      { field: "status", before: "To Do", after: "In Progress" },
    ]);
    expect(plan.creates).toEqual([]);
    expect(plan.rejected).toEqual([]);
  });

  it("summarises a related create", () => {
    const plan = describeToolCalls([block("create_raid_item", { category: "Risk", title: "Payment timeout" })], { task, ws });
    expect(plan.creates).toEqual([{ entity: "raid", title: "Payment timeout", toolName: "create_raid_item", input: { category: "Risk", title: "Payment timeout" } }]);
  });

  it("rejects an update whose id is not the target task and not in the workspace", () => {
    const plan = describeToolCalls([block("update_task", { id: 999, status: "Done" })], { task, ws });
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([{ toolName: "update_task", reason: "unknown-id", detail: "999" }]);
  });

  it("returns an empty plan for no blocks", () => {
    expect(describeToolCalls([], { task, ws })).toEqual({ updates: [], creates: [], deletes: [], rejected: [] });
  });

  it("ignores read-only tool calls (list_tasks/get_task)", () => {
    const plan = describeToolCalls([block("list_tasks", {})], { task, ws });
    expect(plan).toEqual({ updates: [], creates: [], deletes: [], rejected: [] });
  });

  it("rejects an out-of-enum status/priority instead of previewing an undroppable diff", () => {
    const bad = describeToolCalls([block("update_task", { id: 42, status: "Frobnicate", priority: "Critical" })], { task, ws });
    expect(bad.updates).toEqual([]);
    expect(bad.rejected).toEqual([
      { toolName: "update_task", reason: "bad-input", detail: "status=Frobnicate" },
      { toolName: "update_task", reason: "bad-input", detail: "priority=Critical" },
    ]);
  });

  it("ignores startDate/resourceId in update_task (not dispatcher-writable)", () => {
    const plan = describeToolCalls([block("update_task", { id: 42, startDate: "2026-01-01", resourceId: 5 })], { task, ws });
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([]);
  });

  it("rejects clearing the required dueDate (dispatcher throws on empty)", () => {
    const plan = describeToolCalls([block("update_task", { id: 42, dueDate: "" })], { task, ws });
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([{ toolName: "update_task", reason: "bad-input", detail: "dueDate=empty" }]);
  });

  it("deletes the target task but rejects delete_task on a different task", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const other = { id: 43, taskName: "Other" } as any;
    const ws2 = { tasks: [task, other], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as Workspace;
    const del = describeToolCalls([block("delete_task", { id: 42 })], { task, ws: ws2 });
    expect(del.deletes).toEqual([{ entity: "task", label: "Fix login bug", toolName: "delete_task", id: 42 }]);
    expect(del.rejected).toEqual([]);
    const rej = describeToolCalls([block("delete_task", { id: 43 })], { task, ws: ws2 });
    expect(rej.deletes).toEqual([]);
    expect(rej.rejected).toEqual([{ toolName: "delete_task", reason: "unsupported", detail: "43" }]);
  });
});

function wsWith(part: Partial<Workspace>): Workspace {
  return { tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], ...part } as unknown as Workspace;
}

describe("describeEntityCalls — raid", () => {
  const raidItem = { id: 7, category: "R", title: "Old", status: "Open" };
  const ws2 = wsWith({ raid: [raidItem] as never });
  const d = INLINE_DESCRIPTORS.raid;

  it("previews a valid field diff on the target item", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, title: "New" } }],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.updates).toEqual([{ field: "title", before: "Old", after: "New" }]);
  });

  it("rejects a status invalid for the item's category", () => {
    // "Resolved" is Issue-only; item is category R (Risk) → coerced by sanitizer → reject.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, status: "Resolved" } }],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
  });

  it("accepts a status valid for a co-changed category", () => {
    // Same call sets category=I AND status=Resolved → effective category I → valid.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, category: "I", status: "Resolved" } }],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.updates.map((u) => u.field).sort()).toEqual(["category", "status"]);
    expect(plan.rejected).toHaveLength(0);
  });

  it("rejects an out-of-range probability", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, probability: 9 } }],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
  });

  it("surfaces the sanitizer-induced status reset when a category change invalidates the status", () => {
    // category R + status "Mitigated" (Risk-only). Model changes category to I
    // WITHOUT naming status → the sanitizer resets status to the Issue default
    // ("Open"). The preview MUST show both the category diff AND the induced
    // status reset — not just the one field the model named.
    const item = { id: 8, category: "R", title: "T", status: "Mitigated" };
    const ws3 = wsWith({ raid: [item] as never });
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 8, category: "I" } }],
      { descriptor: d, item, ws: ws3 },
    );
    expect(plan.updates).toContainEqual({ field: "category", before: "R", after: "I" });
    expect(plan.updates).toContainEqual({ field: "status", before: "Mitigated", after: "Open" });
    expect(plan.rejected).toHaveLength(0);
  });

  it("does not induce a status reset when the current status stays valid across categories", () => {
    // "Open" is valid for both R and I → category change alone, no induced reset.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, category: "I" } }],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.updates).toEqual([{ field: "category", before: "R", after: "I" }]);
  });

  it("rejects an out-of-range date year (guard matches sanitizeIsoDate)", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, targetDate: "2150-01-01" } }],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
  });

  it("rejects update targeting a different id", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 99, title: "X" } }],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.rejected[0]).toMatchObject({ reason: "unknown-id" });
  });

  it("allows a cross-entity create + the own delete", () => {
    const plan = describeEntityCalls(
      [
        { type: "tool_use", name: "create_task", input: { taskName: "follow up" } },
        { type: "tool_use", name: "delete_raid_item", input: { id: 7 } },
      ],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.creates).toHaveLength(1);
    expect(plan.deletes).toHaveLength(1);
  });
});

describe("rich fields preview as text (slice B)", () => {
  // Slice B stores RAID description+mitigation, Change description+
  // impactDescription+resolutionNotes and Milestone description as rich HTML.
  // The confirm dialog must show the user WORDS, not the markup around them.
  const d = INLINE_DESCRIPTORS.raid;
  const richItem = {
    id: 1,
    category: "R",
    // NOT a rich field — deliberately carries markup so a blanket projection
    // would visibly change it (see the "verbatim" test below).
    title: "<p>Old <strong>title</strong></p>",
    status: "Open",
    mitigation: "<p>old <strong>plan</strong></p>",
  };
  const richWs = wsWith({ raid: [richItem] as never });

  it("projects a rich mitigation diff to plain text", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 1, mitigation: "<p>new plan</p>" } }],
      { descriptor: d, item: richItem, ws: richWs },
    );
    const diff = plan.updates.find((u) => u.field === "mitigation");
    expect(diff?.before).toBe("old plan");
    expect(diff?.after).toBe("new plan");
  });

  it("leaves a non-rich field's diff verbatim", () => {
    // `title` is plain text. Its stored value happens to contain markup here, so
    // if forPreview were a blanket transform instead of a rich-field FILTER the
    // tags below would be stripped and this fails.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 1, title: "<p>New <strong>title</strong></p>" } }],
      { descriptor: d, item: richItem, ws: richWs },
    );
    expect(plan.updates).toEqual([
      { field: "title", before: "<p>Old <strong>title</strong></p>", after: "<p>New <strong>title</strong></p>" },
    ]);
  });

  // The applied value must stay RAW — it feeds the incremental enum validation
  // (`validSetFor(..., {...item, ...applied})`) and the confirm step replays the
  // ORIGINAL tool calls, so a projection here would write plain text back into a
  // rich field.
  //
  // ★ HONEST LIMIT: this pins that the enum path still works when a rich field
  // is co-changed in the SAME call, but it CANNOT detect `applied[f]` being
  // projected — `applied` is a local scratchpad that never reaches the returned
  // plan, and no enum resolver reads a rich field (RAID status keys off
  // `category`). Verified by mutation: projecting `applied[f]` fails nothing.
  it("still validates and applies the RAW value, not the projection", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 1, mitigation: "<p>new plan</p>", category: "I", status: "Resolved" } }],
      { descriptor: d, item: richItem, ws: richWs },
    );
    // "Resolved" is Issue-only: it validates only because the co-changed
    // category landed in `applied` first, alongside the rich field.
    expect(plan.rejected).toEqual([]);
    expect(plan.updates).toContainEqual({ field: "category", before: "R", after: "I" });
    expect(plan.updates).toContainEqual({ field: "status", before: "Open", after: "Resolved" });
    expect(plan.updates).toContainEqual({ field: "mitigation", before: "old plan", after: "new plan" });
  });
});

describe("describeEntityCalls — milestone required field", () => {
  const m = { id: 3, name: "Kickoff", date: "2026-01-01" };
  const ws2 = wsWith({ milestones: [m] as never });
  it("rejects blanking a required name", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_milestone", input: { id: 3, name: "" } }],
      { descriptor: INLINE_DESCRIPTORS.milestone, item: m, ws: ws2 },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
  });
  it("rejects an invalid date", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_milestone", input: { id: 3, date: "next friday" } }],
      { descriptor: INLINE_DESCRIPTORS.milestone, item: m, ws: ws2 },
    );
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
  });
});
