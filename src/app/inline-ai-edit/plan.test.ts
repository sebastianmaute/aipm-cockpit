// src/app/inline-ai-edit/plan.test.ts
import { describe, it, expect } from "vitest";
import { describeToolCalls, describeEntityCalls, isEmptyPlan, type EditPlan, type ToolUseLike } from "./plan";
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
    expect(describeToolCalls([], { task, ws })).toEqual({ updates: [], creates: [], deletes: [], rejected: [], links: [] });
  });

  it("ignores read-only tool calls (list_tasks/get_task)", () => {
    const plan = describeToolCalls([block("list_tasks", {})], { task, ws });
    expect(plan).toEqual({ updates: [], creates: [], deletes: [], rejected: [], links: [] });
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

describe("a person is named by their name, never by their job title", () => {
  // ★★★ `Stakeholder.title` and `Resource.title` are both JOB titles. The
  // generic label chain reads `title` first, so before this was fixed a delete
  // confirmation offered to delete "Programme Director" when the row was a
  // person — a wrong-target prompt on an irreversible action.
  //
  // ★★ The fixture is the whole test. Both fields must be populated AND
  // DIFFERENT, or the assertion cannot tell a name-first chain from a
  // title-first one. A stakeholder with no `title`, or whose title equals their
  // name, passes against the unfixed code.
  const stk = {
    id: 11,
    name: "R. Achebe",
    title: "Programme Director",
    organization: "Acme",
    category: "Sponsor",
  } as unknown as { id: number };
  const stkWs = wsWith({ stakeholders: [stk] as never });
  const d = INLINE_DESCRIPTORS.stakeholder;

  it("offers to delete the PERSON, not their job title", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "delete_stakeholder", input: { id: 11 } }],
      { descriptor: d, item: stk, ws: stkWs },
    );
    expect(plan.deletes).toHaveLength(1);
    expect(plan.deletes[0]).toEqual({
      entity: "stakeholder",
      label: "R. Achebe",
      toolName: "delete_stakeholder",
      id: 11,
    });
    // Stated as its own assertion because it is the defect, not a detail: the
    // job title must not appear as the deletion's target under any spelling.
    expect(plan.deletes[0].label).not.toBe("Programme Director");
    expect(plan.rejected).toEqual([]);
  });

  it("titles a stakeholder create by name, not by job title", () => {
    const plan = describeEntityCalls(
      [
        {
          type: "tool_use",
          name: "create_stakeholder",
          input: { name: "R. Achebe", title: "Programme Director" },
        },
      ],
      { descriptor: d, item: stk, ws: stkWs },
    );
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]).toMatchObject({
      entity: "stakeholder",
      title: "R. Achebe",
      toolName: "create_stakeholder",
    });
  });

  it("still titles a non-person entity by its title field", () => {
    // The anti-over-reach pin. `PERSON_ENTITIES` must not swallow entities whose
    // `title` really IS their name — a milestone titled "Go live" must keep it,
    // and a set widened by one careless member would silently rename every
    // milestone card to its id.
    const ms = { id: 21, title: "Go live" } as unknown as { id: number };
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "delete_milestone", input: { id: 21 } }],
      {
        descriptor: INLINE_DESCRIPTORS.milestone,
        item: ms,
        ws: wsWith({ milestones: [ms] as never }),
      },
    );
    expect(plan.deletes[0].label).toBe("Go live");
  });
});

describe("preview matches what Apply stores", () => {
  it("shows a trimmed value, not the raw padded one", () => {
    const item = { id: 1, assignee: "Ada" };
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 1, assignee: "  Ada  " } }],
      { descriptor: INLINE_DESCRIPTORS.task, item, ws: wsWith({ tasks: [item] as never }) },
    );
    // "  Ada  " trims to "Ada", which EQUALS the stored value — so there is no
    // change to show at all, and the old code showed a spurious one.
    expect(plan.updates).toEqual([]);
  });

  it("shows the empty string a non-string coerces to, not its String() form", () => {
    const item = { id: 1, assignee: "Ada" };
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 1, assignee: 42 } }],
      { descriptor: INLINE_DESCRIPTORS.task, item, ws: wsWith({ tasks: [item] as never }) },
    );
    expect(plan.updates.map((u) => u.after)).toEqual([""]);
  });

  // ★★ THE FIXTURE PUTS THE `@` INSIDE THE CAP ON PURPOSE. This test is about
  //  the CAP, and an over-cap address whose `@x.com` sits PAST 320 is clipped
  //  into something `isValidEmail` rejects — which `buildTaskCleanPatch` throws
  //  on, so the preview rejects it too (the case below). Using such a value
  //  here would make this test assert the REJECTION while claiming to assert
  //  the clip. Measured: this value stores at length 320 with its tail intact.
  it("clips an over-cap email at the task cap", () => {
    const item = { id: 1, assigneeEmail: "old@x.com" };
    const long = `${"a".repeat(300)}@x.com${"b".repeat(100)}`;
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 1, assigneeEmail: long } }],
      { descriptor: INLINE_DESCRIPTORS.task, item, ws: wsWith({ tasks: [item] as never }) },
    );
    expect(plan.updates[0].after.length).toBe(320);
  });

  // ★★★ A THROW ON APPLY COSTS THE WHOLE PATCH. `buildTaskCleanPatch` throws
  //  "assigneeEmail is invalid" for an address `isValidEmail` rejects, and the
  //  dispatcher surfaces that as a failed tool call — so every OTHER field the
  //  same edit changed is lost with it. Before `emailFormatFields` the preview
  //  had no format guard and happily showed this as an accepted diff; the
  //  clipped value here (320 "a"s, the `@x.com` cut off) is exactly what Apply
  //  chokes on. Found by `plan.sanitizer-parity.test.ts`, which had to carry
  //  the pair as an enumerated exception until this guard existed.
  it("rejects an email the sanitizer's clip makes malformed", () => {
    const item = { id: 1, assigneeEmail: "old@x.com" };
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 1, assigneeEmail: `${"a".repeat(400)}@x.com` } }],
      { descriptor: INLINE_DESCRIPTORS.task, item, ws: wsWith({ tasks: [item] as never }) },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected.map((r) => r.reason)).toEqual(["bad-input"]);
  });

  // ★ Blanking an address stays legal — the sanitizer's own guard is
  //  `if (e && !isValidEmail(e))`, so the format check must exempt "".
  it("allows clearing an email", () => {
    const item = { id: 1, assigneeEmail: "old@x.com" };
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 1, assigneeEmail: "" } }],
      { descriptor: INLINE_DESCRIPTORS.task, item, ws: wsWith({ tasks: [item] as never }) },
    );
    expect(plan.rejected).toEqual([]);
    expect(plan.updates.map((u) => u.after)).toEqual([""]);
  });

  it("clips a stakeholder email at ITS cap, which is not the task one", () => {
    const item = { id: 1, email: "old@x.com" };
    const long = "a".repeat(400) + "@x.com";
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_stakeholder", input: { id: 1, email: long } }],
      { descriptor: INLINE_DESCRIPTORS.stakeholder, item, ws: wsWith({ stakeholders: [item] as never }) },
    );
    expect(plan.updates[0].after.length).toBe(200);
  });
});

describe("resource rename sent as the name alias", () => {
  const item = { id: 1, firstName: "Grace", lastName: "Hopper" };
  const resWs = wsWith({ resources: [item] as never });

  it("previews the split parts instead of an empty plan", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 1, name: "Ada Lovelace" } }],
      { descriptor: INLINE_DESCRIPTORS.resource, item, ws: resWs },
    );
    expect(plan.updates.map((u) => [u.field, u.before, u.after])).toEqual([
      ["firstName", "Grace", "Ada"],
      ["lastName", "Hopper", "Lovelace"],
    ]);
  });

  // ★★★ THIS ONE PASSES AGAINST THE UNFIXED CODE, AND IT IS STILL LOAD-BEARING —
  //  do not delete it as vacuous. `firstName` is already a `diffFields` member,
  //  so the pre-§372 loop diffed it here anyway; the alias projection never even
  //  fires, because the explicit part blocks it. What it pins is the PREDICATE,
  //  not the projection: it is the only test in the suite that fails when the
  //  two part-tests are dropped ALTOGETHER. Measured, not reasoned — replacing
  //  both conditions with `true` makes exactly this test red with
  //  `expected [['firstName','Ada'], …] to deeply equal [['firstName','Anita']]`,
  //  i.e. the split silently overwriting the value the model asked for.
  //  ★★★ IT PINS THE PREDICATE'S PRESENCE, NOT ITS SPELLING, and an earlier
  //  revision of this comment claimed otherwise. `true && true` is the strictly
  //  WEAKER mutant; the one that matters is narrowing `typeof … !== "string"` to
  //  `… === undefined`, which this test CANNOT see (an explicit string part
  //  blocks the split under either spelling). That narrower mutant is pinned by
  //  "splits a rename whose part is an explicit JSON null" below — the two tests
  //  are a pair, and deleting either leaves a live mutant.
  it("does not override explicit parts, matching the dispatcher", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 1, name: "Ada Lovelace", firstName: "Anita" } }],
      { descriptor: INLINE_DESCRIPTORS.resource, item, ws: resWs },
    );
    expect(plan.updates.map((u) => [u.field, u.after])).toEqual([["firstName", "Anita"]]);
  });

  // ★★★ THE `typeof` SPELLING IS WHAT THIS PINS, and nothing else in the suite
  //  does. `updateResource` in `use-chat-dispatcher.ts` tests the parts with
  //  `typeof … !== "string"` precisely because a JSON `null` is neither a string
  //  NOR `undefined`: with `=== undefined` the split is skipped and `firstName:
  //  null` is then spread over the stored row, which `sanitizeResource` reduces
  //  to `""` — the rename dropped and the first name WIPED, the surviving last
  //  name keeping the record valid enough to save. That is a real divergence,
  //  not a stylistic one: under the narrowed predicate the PREVIEW shows a
  //  `firstName=empty` rejection (the `requiredNonEmpty` guard fires on the
  //  blanked part) while the DISPATCHER performs the rename, so the card
  //  contradicts the write.
  it("splits a rename whose part is an explicit JSON null", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 1, name: "Ada Lovelace", firstName: null } }],
      { descriptor: INLINE_DESCRIPTORS.resource, item, ws: resWs },
    );
    expect(plan.updates.map((u) => [u.field, u.before, u.after])).toEqual([
      ["firstName", "Grace", "Ada"],
      ["lastName", "Hopper", "Lovelace"],
    ]);
    expect(plan.rejected).toEqual([]);
  });

  it("ignores a blank name, matching the dispatcher", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 1, name: "   " } }],
      { descriptor: INLINE_DESCRIPTORS.resource, item, ws: resWs },
    );
    expect(plan.updates).toEqual([]);
  });
});

describe("link fields", () => {
  const linkTasks = [
    { id: 1, taskName: "Draft brief" },
    { id: 2, taskName: "Ship" },
    { id: 3, taskName: "Review" },
  ];
  const vendorRisk = { id: 10, title: "Vendor risk", linkedTaskIds: [1, 3] };
  const linkWs = wsWith({ tasks: linkTasks as never, raid: [vendorRisk] as never });

  it("shows a replaced link list as before -> after", () => {
    // The write REPLACES: supplying [2] drops tasks 1 and 3. The card must show
    // the removal, because nothing can reconstruct the dropped links afterwards.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 10, linkedTaskIds: [2] } }],
      { descriptor: INLINE_DESCRIPTORS.raid, item: vendorRisk, ws: linkWs },
    );
    expect(plan.links).toEqual([{ field: "linkedTaskIds", before: "Draft brief, Review", after: "Ship", rawIds: [2] }]);
    expect(plan.updates).toEqual([]);
  });

  it("emits nothing when the resolved lists match", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 10, linkedTaskIds: [1, 3] } }],
      { descriptor: INLINE_DESCRIPTORS.raid, item: vendorRisk, ws: linkWs },
    );
    expect(plan.links).toEqual([]);
  });

  it("leaves an untouched link field alone", () => {
    // ★ `causedByRaidIds`/`stakeholderIds` are link fields too. A field the
    // model did not send must not be previewed — and, since the patch is built
    // from `links`, must not be WRITTEN either: an emitted empty diff here
    // would wipe two more relationship arrays per edit.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 10, title: "Vendor risk 2" } }],
      { descriptor: INLINE_DESCRIPTORS.raid, item: vendorRisk, ws: linkWs },
    );
    expect(plan.links).toEqual([]);
  });

  it("uses the milestone's OWN id rule, which drops a delimited string", () => {
    // raid/change would parse "1;2" into two links; a milestone stores []. The
    // preview must show what THIS writer does, not what the sibling does.
    const ga = { id: 5, name: "GA", linkedTaskIds: [1] };
    const mws = wsWith({ tasks: linkTasks as never, milestones: [ga] as never });
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_milestone", input: { id: 5, linkedTaskIds: "1;2" } }],
      { descriptor: INLINE_DESCRIPTORS.milestone, item: ga, ws: mws },
    );
    expect(plan.links).toEqual([{ field: "linkedTaskIds", before: "Draft brief", after: "", rawIds: [] }]);
  });

  it("carries the sanitized ids the writer will store, not the titles", () => {
    // ★★★ THE WHOLE POINT OF `rawIds`. The card renders titles; the rebuild
    //  path applies THIS array. If the two ever came from different
    //  computations the preview would stop being a promise about the write.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 10, linkedTaskIds: [2, 3] } }],
      { descriptor: INLINE_DESCRIPTORS.raid, item: vendorRisk, ws: linkWs },
    );
    expect(plan.links[0].rawIds).toEqual([2, 3]);
  });

  // ★★★ A SINGLE FK IS A LINK FIELD TOO, and `rawIds` carries it as a ONE-
  //  ELEMENT ARRAY because `LinkField.sanitize` returns `number[]` for both
  //  kinds. The apply path has to unwrap it — `sanitizeResource` runs
  //  `toNumber(input.roleId)`, and `toNumber([12])` is NaN, so writing the
  //  array verbatim would NULL the role while the card promised a new one.
  //  Pinned on the apply side by "unwraps a single-FK link" in
  //  `use-inline-entity-edit.test.tsx`.
  describe("a single FK (resource.roleId)", () => {
    const ada = { id: 3, firstName: "Ada", lastName: "Lovelace", roleId: 11 };
    const roleWs = wsWith({
      resources: [ada] as never,
      roles: [{ id: 11, disciplineId: 1, gradeId: 1 }, { id: 12, disciplineId: 2, gradeId: 1 }] as never,
      disciplines: [{ id: 1, name: "Engineering" }, { id: 2, name: "Design" }] as never,
      grades: [{ id: 1, name: "L3" }] as never,
    });

    it("renders the role's derived label on both sides", () => {
      const plan = describeEntityCalls(
        [{ type: "tool_use", name: "update_resource", input: { id: 3, roleId: 12 } }],
        { descriptor: INLINE_DESCRIPTORS.resource, item: ada, ws: roleWs },
      );
      expect(plan.links).toEqual([{ field: "roleId", before: "Engineering L3", after: "Design L3", rawIds: [12] }]);
    });

    it("shows a cleared FK as an empty after with no ids", () => {
      const plan = describeEntityCalls(
        [{ type: "tool_use", name: "update_resource", input: { id: 3, roleId: null } }],
        { descriptor: INLINE_DESCRIPTORS.resource, item: ada, ws: roleWs },
      );
      expect(plan.links).toEqual([{ field: "roleId", before: "Engineering L3", after: "", rawIds: [] }]);
    });
  });
});

describe("EditPlan.links", () => {
  it("counts a links-only plan as non-empty", () => {
    // A plan that ONLY changes relationships must still render. Treating it as
    // empty would hide the most destructive write class behind a blank card.
    const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [], links: [
      { field: "linkedTaskIds", before: "Draft brief", after: "Ship", rawIds: [2] },
    ] };
    expect(isEmptyPlan(plan)).toBe(false);
  });

  it("is empty only when every bucket is empty", () => {
    expect(isEmptyPlan({ updates: [], creates: [], deletes: [], rejected: [], links: [] })).toBe(true);
  });
});
