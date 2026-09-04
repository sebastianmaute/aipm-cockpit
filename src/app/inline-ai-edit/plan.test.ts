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
      { field: "dueDate", before: "2026-08-12", after: "2026-08-15", raw: "2026-08-15" },
      { field: "status", before: "To Do", after: "In Progress", raw: "In Progress" },
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
  // ★ `resources` belongs in the base: describeEntityCalls reads `ws[d.wsKey]`
  // UNGUARDED when it builds `ownIds`, so a workspace missing the descriptor's
  // own slice throws rather than producing an empty plan.
  return { tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], resources: [], ...part } as unknown as Workspace;
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
    expect(plan.updates).toEqual([{ field: "title", before: "Old", after: "New", raw: "New" }]);
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
    // ★ The category diff is model-supplied, so it carries `raw`; the induced
    // status reset is the sanitizer's own default and carries none.
    expect(plan.updates).toContainEqual({ field: "category", before: "R", after: "I", raw: "I" });
    expect(plan.updates).toContainEqual({ field: "status", before: "Mitigated", after: "Open" });
    expect(plan.rejected).toHaveLength(0);
  });

  it("does not induce a status reset when the current status stays valid across categories", () => {
    // "Open" is valid for both R and I → category change alone, no induced reset.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, category: "I" } }],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.updates).toEqual([{ field: "category", before: "R", after: "I", raw: "I" }]);
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

  it("leaves the plain-text stakeholder.notes verbatim, though raid shares the name shape", () => {
    // ★★ SCOPE LEAK THIS PINS: the set was keyed on the BARE field name and
    // included "notes" — the task descriptor's stale alias for its rich
    // `description`. But `notes` is also the STAKEHOLDER descriptor's own field,
    // and Stakeholder.notes is plain text (sanitizeText, plain textarea),
    // deliberately outside slice B. So a stakeholder note previewed with its
    // newlines collapsed by htmlToText's whitespace run.
    const stk = { id: 3, name: "Dana", category: "Sponsor", influence: "Medium", interest: "Medium", notes: "old" };
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_stakeholder", input: { id: 3, notes: "line one\nline two" } }],
      { descriptor: INLINE_DESCRIPTORS.stakeholder, item: stk, ws: wsWith({ stakeholders: [stk] as never }) },
    );
    // The newline SURVIVES. Projected, it would collapse to "line one line two".
    expect(plan.updates).toContainEqual({ field: "notes", before: "old", after: "line one\nline two", raw: "line one\nline two" });
  });

  it("still projects the task's rich description", () => {
    // The other direction: entity-qualifying the set must not stop projecting
    // the one TASK field that IS rich.
    //
    // ★★ RICH_FIELDS is keyed `${entity}.${field}` off the DESCRIPTOR's spelling,
    // so it and `diffFields` move together. This case was written against the
    // pre-0.196.0 `notes`; renaming the descriptor to `description` without
    // renaming the RICH_FIELDS key drops the task out of the set and the preview
    // silently renders raw HTML — which is what this assertion catches.
    const t2 = { id: 9, taskName: "T", description: "<p>old <strong>note</strong></p>" };
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 9, description: "<p>new note</p>" } }],
      { descriptor: INLINE_DESCRIPTORS.task, item: t2, ws: wsWith({ tasks: [t2] as never }) },
    );
    expect(plan.updates).toContainEqual({ field: "description", before: "old note", after: "new note", raw: "<p>new note</p>" });
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
      { field: "title", before: "<p>Old <strong>title</strong></p>", after: "<p>New <strong>title</strong></p>", raw: "<p>New <strong>title</strong></p>" },
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
    expect(plan.updates).toContainEqual({ field: "category", before: "R", after: "I", raw: "I" });
    expect(plan.updates).toContainEqual({ field: "status", before: "Open", after: "Resolved", raw: "Resolved" });
    expect(plan.updates).toContainEqual({ field: "mitigation", before: "old plan", after: "new plan", raw: "<p>new plan</p>" });
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

describe("the applied value stays raw while the preview is projected", () => {
  it("carries the verbatim stored value alongside the projected preview", () => {
    // ★★ The preview is projected to text for display; the value the confirm
    // path applies must stay RAW, or an inline-AI edit writes projected text
    // over the user's formatting. That distinction was a function-local
    // scratchpad no test could reach — projecting it failed nothing.
    //
    // ★ This test asserts the RAW value. A test that re-asserts the preview is
    // projected is exactly what passes with the bug present.
    const richTask = { ...task, description: "<p>old</p>" } as typeof task;
    const richWs = { ...ws, tasks: [richTask] } as typeof ws;
    const plan = describeToolCalls(
      [block("update_task", { id: 42, description: "<p>new</p>" })],
      { task: richTask, ws: richWs },
    );
    const diff = plan.updates.find((u) => u.field === "description");
    expect(diff).toBeDefined();
    expect(diff!.after).toBe("new");
    expect(diff!.raw).toBe("<p>new</p>");
  });
});

describe("describeEntityCalls — resource", () => {
  // ★★ `Resource.title` is a JOB TITLE, not a display label. Every fixture here
  // carries one so a create card or a delete label that reaches for `title`
  // (as the generic `str(input.title ?? …)` chain does for every other entity)
  // renders "Engineer" where the person's name belongs.
  const resource = { id: 5, firstName: "M.", lastName: "Jordan", title: "Engineer", department: "Delivery" };
  const other = { id: 6, firstName: "R.", lastName: "Frank", title: "Analyst" };
  const resWs = wsWith({ resources: [resource, other] as never });
  const d = INLINE_DESCRIPTORS.resource;

  it("describes a resource create under the person's name, not their job title", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "create_resource", input: { firstName: "M.", lastName: "Jordan", title: "Engineer" } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].entity).toBe("resource");
    expect(plan.creates[0].title).toBe("M. Jordan");
  });

  it("falls back to the full-name alias when the parts are not given", () => {
    // `create_resource` accepts EITHER firstName/lastName OR a single `name`
    // (chat-tool-defs.ts `resourceFields`), so the card must name both shapes.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "create_resource", input: { name: "M. Jordan" } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(plan.creates[0]).toMatchObject({ entity: "resource", title: "M. Jordan", toolName: "create_resource" });
  });

  it("describes a resource delete against a live row", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "delete_resource", input: { id: resource.id } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(plan.deletes).toHaveLength(1);
    // The person, not "Engineer".
    expect(plan.deletes[0]).toEqual({ entity: "resource", label: "M. Jordan", toolName: "delete_resource", id: 5 });
    expect(plan.rejected).toEqual([]);
  });

  it("rejects the OWN delete tool aimed at another row as unsupported, not unknown-id", () => {
    // ★★ The own-entity same-row guard runs BEFORE any existence lookup, so for
    // the descriptor's own deleteTool ANY id but the opened row's is
    // "unsupported" — whether or not that id exists. "unknown-id" is
    // unreachable on this path.
    const live = describeEntityCalls(
      [{ type: "tool_use", name: "delete_resource", input: { id: other.id } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(live.deletes).toEqual([]);
    expect(live.rejected).toEqual([{ toolName: "delete_resource", reason: "unsupported", detail: "6" }]);

    const absent = describeEntityCalls(
      [{ type: "tool_use", name: "delete_resource", input: { id: 999999 } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(absent.rejected).toEqual([{ toolName: "delete_resource", reason: "unsupported", detail: "999999" }]);
  });

  it("rejects a CROSS-entity delete_resource for an id that does not exist", () => {
    // The other half of the new DELETE_TOOLS entry: reached from a different
    // descriptor, the row is grounded against the live list and a miss is
    // "unknown-id". This is the shape a whole-plan grounding pass uses.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "delete_resource", input: { id: 999999 } }],
      { descriptor: INLINE_DESCRIPTORS.task, item: { id: 42 }, ws: resWs },
    );
    expect(plan.deletes).toEqual([]);
    expect(plan.rejected).toEqual([{ toolName: "delete_resource", reason: "unknown-id", detail: "999999" }]);
  });

  it("diffs a department change on the opened row", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, department: "Advisory" } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(plan.updates).toEqual([{ field: "department", before: "Delivery", after: "Advisory", raw: "Advisory" }]);
    expect(plan.rejected).toEqual([]);
  });

  it("ignores roleId and emails — neither round-trips verbatim through sanitizeResource", () => {
    // roleId is an FK (excluded like Task.resourceId); `emails` is deduped
    // against the primary and capped by sanitizeEmailList, so a previewed value
    // would diverge from the stored one.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, roleId: 3, emails: ["a@b.co"] } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([]);
  });

  it("rejects blanking a name part (sanitizeResource returns null for a nameless row)", () => {
    // ★ The sanitizer's real rule is "at least ONE part non-empty"; the
    // descriptor can only express a per-field requirement, so BOTH parts are
    // marked required. Over-rejecting is the safe direction — the alternative
    // previews a diff whose Apply throws "invalid resource update".
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, firstName: "" } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([{ toolName: "update_resource", reason: "bad-input", detail: "firstName=empty" }]);
  });

  it("rejects an update aimed at another row, by whether that row exists", () => {
    // ★★ The one-item binding a whole-plan grounding pass depends on: an update
    // is only ever described for `ctx.item`. The REASON splits on existence —
    // a live row is "unsupported" (real, just not this one), a missing one is
    // "unknown-id".
    const live = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 6, department: "X" } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(live.updates).toEqual([]);
    expect(live.rejected).toEqual([{ toolName: "update_resource", reason: "unsupported", detail: "6" }]);

    const absent = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 999999, department: "X" } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(absent.rejected).toEqual([{ toolName: "update_resource", reason: "unknown-id", detail: "999999" }]);
  });
});

describe("task descriptor field name", () => {
  it("names the live description field, not the field it was renamed from", () => {
    // ★ Task.notes became Task.description in 0.196.0. The descriptor still said
    // "notes" and worked ONLY because chat-tools accepts it as a write alias —
    // tighten that alias and the inline-AI task editor silently stops being able
    // to write a description.
    expect(INLINE_DESCRIPTORS.task.diffFields).toContain("description");
    expect(INLINE_DESCRIPTORS.task.diffFields).not.toContain("notes");
  });
});
