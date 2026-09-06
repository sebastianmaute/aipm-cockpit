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
      { entity: "task", field: "dueDate", before: "2026-08-12", after: "2026-08-15", raw: "2026-08-15" },
      { entity: "task", field: "status", before: "To Do", after: "In Progress", raw: "In Progress" },
    ]);
    expect(plan.creates).toEqual([]);
    expect(plan.rejected).toEqual([]);
  });

  it("summarises a related create", () => {
    const plan = describeToolCalls([block("create_raid_item", { category: "Risk", title: "Payment timeout" })], { task, ws });
    expect(plan.creates).toEqual([{ entity: "raid", title: "Payment timeout", toolName: "create_raid_item", input: { category: "Risk", title: "Payment timeout" } }]);
  });

  it("discloses the links an inline create would write", () => {
    // §390. `plan.creates` hands the model's input VERBATIM to `runTool`, so a
    // create's link fields land whether or not the card names them. Resolved
    // TITLES, exactly as the update path renders them — a raw id on the card is
    // not a disclosure.
    //
    // ★★ The open row is a TASK and the create is a RAID item, which is the
    //  case that matters: the projection must run through the CREATED entity's
    //  descriptor, never the open row's. The task descriptor declares NO link
    //  fields, so a projection reusing `d` emits nothing and this test reds.
    const kickoff = { id: 7, taskName: "Kickoff" };
    const linkWs = wsWith({ tasks: [task, kickoff] as never });
    const plan = describeEntityCalls(
      [block("create_raid_item", { title: "New risk", category: "R", linkedTaskIds: [7] })],
      { descriptor: INLINE_DESCRIPTORS.task, item: task, ws: linkWs },
    );
    expect(plan.creates).toHaveLength(1);
    // `before` is always "" on a create: there is no prior row to drop links from.
    // ★★ `target: "create"` — DISCLOSURE, not a write to the open row. `apply()`
    //  filters on exactly this, and `entity` cannot stand in for it: had the open
    //  row been a RAID item, `entity` would read "raid" here too. See
    //  `LinkDiff.target`.
    // ★★ `subject` is the CREATED item's title (§407), and it is what stops this
    //  line reading as a statement about the OPEN row — `target` is invisible to
    //  the reader of the card. It is the same string `plan.creates` carries, so
    //  a create's two rendered lines cannot name the row differently.
    expect(plan.links).toEqual([{ entity: "raid", target: "create", subject: "New risk", field: "linkedTaskIds", before: "", after: "Kickoff", rawIds: [7] }]);
    expect(plan.links[0]?.subject).toBe(plan.creates[0]?.title);
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

// A model-supplied tool name is matched against CREATE_TOOLS / DELETE_TOOLS.
// Both lookups used `in`, which WALKS THE PROTOTYPE CHAIN, so every key on
// `Object.prototype` matched a branch and yielded a FUNCTION as the entity.
//
// ★★★ THESE CASES ARE PINNED EXPLICITLY BECAUSE `plan.property.test.ts` CANNOT
//  BE RELIED ON TO FIND THEM AGAIN. It generates `fc.string()` names and did hit
//  `toString` — but fast-check is UNSEEDED in this repo, so a green property run
//  is not reproducible evidence and a red one is not re-runnable. An explicit
//  case is both.
//
// ★★ `__proto__` is in the list and is NOT redundant with the other three: it is
//  the one name that is an accessor on `Object.prototype` rather than a plain
//  method, so a guard written as a truthiness or `typeof` check on the looked-up
//  value would treat it differently from `toString`. `hasOwnProperty.call`
//  rejects all four identically, which is the property being pinned.
describe("a prototype-named tool matches no tool map", () => {
  const protoNames = ["toString", "constructor", "hasOwnProperty", "__proto__", "valueOf"];

  // ★★★ `it.each`, NEVER a loop inside ONE `it`. A hard `expect` ABORTS the
  //  test, so under any mutant that trips on `toString` — element 1 — elements
  //  2 to 5 went UNEXECUTED, `__proto__` among them. That is the one name the
  //  comment above argues at length is not redundant, and it was the ONLY case
  //  reaching it: the three sibling tests below all probe `toString` alone. Five
  //  names in one `it` is one certified leg and four decorative ones.
  //  ★ Measured, not reasoned: reverting the `hasOwnProperty` guard above to
  //   `name in CREATE_TOOLS` reddens FIVE tests here, one per name. The same
  //   mutant against the loop form reddened ONE.
  //  ★ The assertion no longer wraps the plan in `{ name, plan }` — that shape
  //   existed only to name the failing element in the diff, which the generated
  //   test name now carries.
  it.each(protoNames)("contributes nothing to the plan for %s, exactly like any unrecognised tool", (name) => {
    const plan = describeToolCalls([block(name, { id: 42, title: "x", linkedTaskIds: [42] })], { task, ws });
    // The same empty plan `list_tasks` and `bogus` produce — an unrecognised
    // tool is IGNORED here, it is not rejected.
    expect(plan).toEqual({ updates: [], creates: [], deletes: [], rejected: [], links: [] });
  });

  it("does not fabricate an unknown-id rejection on the delete branch", () => {
    // The pre-fix behaviour: `toString` destructured {entity, wsKey} off a
    // function, `ws[undefined]` was not an array, and the block was reported to
    // the user as a rejected delete of a row nobody named.
    const plan = describeToolCalls([block("toString", { id: 999 })], { task, ws });
    expect(plan.rejected).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("does not stringify a prototype member into a create's title", () => {
    // The create branch's pre-fix behaviour, before the descriptor lookup turned
    // it into a throw: `titleOf` fell through to the "entity" and rendered
    // "function toString() { [native code] }" as the new row's name.
    const plan = describeToolCalls([block("toString", { category: "R" })], { task, ws });
    expect(plan.creates).toEqual([]);
  });

  it("still matches the real tool names it is meant to", () => {
    // ★ The anti-vacuity half. A guard that rejected EVERYTHING would pass all
    //  three assertions above; this is what proves the maps still resolve.
    const created = describeToolCalls([block("create_raid_item", { title: "Real" })], { task, ws });
    expect(created.creates).toHaveLength(1);
    const deleted = describeToolCalls([block("delete_task", { id: 42 })], { task, ws });
    expect(deleted.deletes).toHaveLength(1);
  });
});

describe("describeEntityCalls — raid", () => {
  const raidItem = { id: 7, category: "R", title: "Old", status: "Open" };
  const ws2 = wsWith({ raid: [raidItem] as never });
  const d = INLINE_DESCRIPTORS.raid;

  it("previews a valid field diff on the target item", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, title: "New" } }],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.updates).toEqual([{ entity: "raid", field: "title", before: "Old", after: "New", raw: "New" }]);
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

  it("rejects a boolean probability in the preview, not merely in the writer", () => {
    // ★★★ THE RENDERED STRING CANNOT SEE THIS. `numberPreview` coerces `true`
    //  to "1" before any rule runs, so a range check over `after` reads a
    //  plausible in-range score and the card showed the fabrication as an
    //  accepted change (§395). The detail string still carries the RENDERED
    //  value — it is what the reader would otherwise have been shown.
    const item = { id: 7, category: "R", title: "Old", status: "Open", probability: 4 };
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, probability: true } }],
      { descriptor: d, item, ws: wsWith({ raid: [item] as never }) },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([
      { toolName: "update_raid_item", reason: "bad-input", detail: "probability=1" },
    ]);
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
    expect(plan.updates).toContainEqual({ entity: "raid", field: "category", before: "R", after: "I", raw: "I" });
    expect(plan.updates).toContainEqual({ entity: "raid", field: "status", before: "Mitigated", after: "Open" });
    expect(plan.rejected).toHaveLength(0);
  });

  it("does not induce a status reset when the current status stays valid across categories", () => {
    // "Open" is valid for both R and I → category change alone, no induced reset.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, category: "I" } }],
      { descriptor: d, item: raidItem, ws: ws2 },
    );
    expect(plan.updates).toEqual([{ entity: "raid", field: "category", before: "R", after: "I", raw: "I" }]);
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

describe("describeEntityCalls — change amount precision (399)", () => {
  const changeItem = { id: 1, title: "C", costImpact: 100, scheduleImpactDays: 2 };
  const wsC = wsWith({ changes: [changeItem] as never });
  const dc = INLINE_DESCRIPTORS.change;

  it("previews a two-decimal cost as an accepted change, matching the write", () => {
    // The PREVIEW is the side that loosens here — AGAINST §399 AS FILED, which
    // is the only baseline that framing is true against. Against the code the
    // §399 commit actually edited (parent `3df2e4d0`, where both predicates were
    // `Number.isFinite(n) && n >= 0` on BOTH sides) cost TIGHTENED, gaining a cap
    // and a precision rule days never had. `acceptsCostAmount`'s docstring in
    // `sanitize-records.ts` carries the full correction and why the unbaselined
    // wording hid a real load-side exposure. What is true either way: `costImpact`
    // is clamped by `describeClamp(..., { round: 2 })` in `change-edit-modal.tsx`,
    // so two decimals are exactly what a person can type and what the writer stores.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_change", input: { id: 1, costImpact: 1500.5 } }],
      { descriptor: dc, item: changeItem, ws: wsC },
    );
    expect(plan.rejected).toEqual([]);
    expect(plan.updates).toEqual([{ entity: "change", field: "costImpact", before: "100", after: "1500.5", raw: "1500.5" }]);
  });

  it("rejects a cost above the cap the form clamps to", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_change", input: { id: 1, costImpact: 2_000_000_000 } }],
      { descriptor: dc, item: changeItem, ws: wsC },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
  });

  it("rejects a boolean on either amount, not merely in the writer", () => {
    // ★★★ THE THIRD BEHAVIOUR CHANGE OF THE §399 COMMIT, AND THE ONLY ONE THAT
    //  HAD NO PREVIEW-SIDE PIN — `sanitize-change-patch.test.ts` covered the
    //  merge side alone. Exactly the §395 shape, one register over:
    //  `numberPreview` coerces `true` to "1" before any rule runs, so a range
    //  check over the RENDERED `after` reads a plausible cost of 1 and the card
    //  shows the fabrication as an accepted change. The guard reads `input[f]`
    //  RAW, so it can still see the boolean.
    //  ★ The rejection `detail` deliberately carries the RENDERED value — it is
    //  what the reader would otherwise have been shown.
    for (const field of ["costImpact", "scheduleImpactDays"]) {
      const plan = describeEntityCalls(
        [{ type: "tool_use", name: "update_change", input: { id: 1, [field]: true } }],
        { descriptor: dc, item: changeItem, ws: wsC },
      );
      expect(plan.updates).toHaveLength(0);
      expect(plan.rejected[0]).toMatchObject({ reason: "bad-input", detail: `${field}=1` });
    }
  });

  it("rejects a fractional schedule-impact day, which the writer no longer stores", () => {
    // The WRITER is the side that tightens here — the opposite direction from
    // the cost rule above ONLY against §399 AS FILED (see the baseline note on
    // that test). Against the code the §399 commit edited, cost tightened
    // exactly as days did, so "the two move in opposite directions" is a
    // property of the register entry, not of the change. What survives either
    // baseline, and is the point of this test: the two amounts do not share a
    // rule, so one "amounts are integers" predicate could never express both —
    // days are integral, money is two-decimal and capped.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_change", input: { id: 1, scheduleImpactDays: 1.5 } }],
      { descriptor: dc, item: changeItem, ws: wsC },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
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
    expect(plan.updates).toContainEqual({ entity: "stakeholder", field: "notes", before: "old", after: "line one\nline two", raw: "line one\nline two" });
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
    expect(plan.updates).toContainEqual({ entity: "task", field: "description", before: "old note", after: "new note", raw: "<p>new note</p>" });
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
      { entity: "raid", field: "title", before: "<p>Old <strong>title</strong></p>", after: "<p>New <strong>title</strong></p>", raw: "<p>New <strong>title</strong></p>" },
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
    expect(plan.updates).toContainEqual({ entity: "raid", field: "category", before: "R", after: "I", raw: "I" });
    expect(plan.updates).toContainEqual({ entity: "raid", field: "status", before: "Open", after: "Resolved", raw: "Resolved" });
    expect(plan.updates).toContainEqual({ entity: "raid", field: "mitigation", before: "old plan", after: "new plan", raw: "<p>new plan</p>" });
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

  it("refuses a non-string description instead of projecting one", () => {
    // ★★★ THE PREVIEW HALF OF §398, AND IT LANDED WITH THE WRITER'S GUARD.
    //  `milestone.description` is RICH, so it has no `fieldSanitizers` entry
    //  (its apply-path sanitizer needs a DOM) and no `numberFields` membership —
    //  `after` is therefore the verbatim `str(true)`, "true", which `forPreview`
    //  would have projected as the new text. The write now DROPS the key
    //  (`dropUnacceptedMilestoneFields`) and keeps the stored rich text, so
    //  projecting one would promise a change that never happens.
    //  ★ The `detail` carries the RENDERED value, like every other rejection
    //  here — it is what the reader would otherwise have been shown.
    const withDesc = { ...m, description: "<p>kept</p>" };
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_milestone", input: { id: 3, description: true } }],
      { descriptor: INLINE_DESCRIPTORS.milestone, item: withDesc, ws: wsWith({ milestones: [withDesc] as never }) },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([
      { toolName: "update_milestone", reason: "bad-input", detail: "description=true" },
    ]);
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
    expect(plan.updates).toEqual([{ entity: "resource", field: "department", before: "Delivery", after: "Advisory", raw: "Advisory" }]);
    expect(plan.rejected).toEqual([]);
  });

  it("keeps roleId out of updates — an FK is disclosed as a link, never as a field diff", () => {
    // ★★ THIS TEST USED TO PIN `emails` AS IGNORED TOO, on the recorded ground
    //  that "sanitizeEmailList dedupes against the primary and caps it, so a
    //  previewed value would diverge". That rationale predates `fieldSanitizers`,
    //  which exists so a preview can CALL the writer's rule instead of
    //  approximating it — see the "resource extra emails" describe below, which
    //  is the assertion that replaced this half (§383).
    // ★ `roleId` stays excluded for a different reason that still holds:
    //  `FieldDiff.raw` becomes the write patch, and a rendered role LABEL
    //  arriving at `toNumber` nulls the FK. It is disclosed via `linkFields`.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, roleId: 3 } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([]);
    expect(plan.links.map((l) => l.field)).toEqual(["roleId"]);
  });

  it("previews blanking ONE name part as the clearing the writer performs", () => {
    // ★★★ 384, and the symmetric half of the mononym case below — this test
    //  used to assert the opposite. The sanitizer's rule is "at least ONE part
    //  non-empty" (`if (!firstName && !lastName) return null`), an OR over the
    //  MERGED row, so blanking `firstName` while `lastName` stands is a legal
    //  write that stores `firstName: ""`. Calling it rejected was not the "safe
    //  direction" the old comment claimed: the two REPLAYING consumers resend
    //  the original tool call and perform the write regardless, so the card
    //  promised a refusal that never happened.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, firstName: "" } }],
      { descriptor: d, item: resource, ws: resWs },
    );
    expect(plan.updates).toEqual([{ entity: "resource", field: "firstName", before: "M.", after: "", raw: "" }]);
    expect(plan.rejected).toEqual([]);
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

describe("resource extra emails (383)", () => {
  const d = INLINE_DESCRIPTORS.resource;
  // ★ A stored row's extras are ALREADY sanitized, so the descriptor entry is
  //  idempotent on `before` and the whole diff below comes from `after`.
  const item = { id: 5, firstName: "M.", lastName: "Jordan", email: "m@x.com", emails: ["b@x.com"] };
  const emailWs = wsWith({ resources: [item] as never });

  it("previews the writer's own dedupe of the extra address list", () => {
    // ★★★ MEASURED AGAINST `sanitizeResource`, NOT ASSUMED, and the measurement
    //  overturned the expectation this test was drafted with. The draft asserted
    //  an EMPTY plan on the ground that the repeat collapses AND the primary is
    //  dropped, leaving what is stored — but "m@x.com" is not IN this list, so
    //  only the dedupe fires: `["b@x.com","b@x.com","a@x.com"]` sanitizes to
    //  `["b@x.com","a@x.com"]` against a stored `["b@x.com"]`. That is a real
    //  change and the preview must show it. Reproduce:
    //  `sanitizeResource({id:5,firstName:"M.",lastName:"Jordan",email:"m@x.com",
    //   emails:["b@x.com","b@x.com","a@x.com"]}).emails` -> ["b@x.com","a@x.com"].
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, emails: ["b@x.com", "b@x.com", "a@x.com"] } }],
      { descriptor: d, item, ws: emailWs },
    );
    expect(plan.updates).toEqual([
      { entity: "resource", field: "emails", before: "b@x.com", after: "b@x.com, a@x.com", raw: "b@x.com, a@x.com" },
    ]);
    expect(plan.rejected).toEqual([]);
  });

  it("emits nothing when the sanitized list already equals the stored one", () => {
    // The other side of the same entry: a repeat that collapses BACK to what is
    // stored is a no-op, and normalising `before` through the same function is
    // what makes it compare equal. Without that, every send would render a diff.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, emails: ["b@x.com", "  b@x.com  "] } }],
      { descriptor: d, item, ws: emailWs },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([]);
  });

  it("previews clearing the extras", () => {
    // `sanitizeEmailList` yields `[]`, `sanitizeResource` then omits the key
    // entirely — the field is genuinely cleared, so `""` is the honest preview.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, emails: [] } }],
      { descriptor: d, item, ws: emailWs },
    );
    expect(plan.updates).toEqual([{ entity: "resource", field: "emails", before: "b@x.com", after: "", raw: "" }]);
  });

  it("drops an extra equal to the row's primary, as the write does", () => {
    // ★★★ WAS A KNOWN DIVERGENCE, CLOSED BY §397 — and this is the expectation
    //  that comment named as the one to flip. A `fieldSanitizers` entry used to
    //  be handed the FIELD's value alone, so the preview ran
    //  `sanitizeEmailList(v, undefined)` where `sanitizeResource` calls it with
    //  the MERGED row's primary: the card KEPT "m@x.com" and the write dropped
    //  it (and, at the 10-address cap, the two disagreed about which address
    //  landed tenth). Entries now take the merged row as a second argument.
    //  Reproduce the writer's half: `sanitizeResource({...item,
    //   emails:["m@x.com","a@x.com"]}).emails` -> ["a@x.com"].
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, emails: ["m@x.com", "a@x.com"] } }],
      { descriptor: d, item, ws: emailWs },
    );
    expect(plan.updates).toEqual([
      { entity: "resource", field: "emails", before: "b@x.com", after: "a@x.com", raw: "a@x.com" },
    ]);
  });

  // ★★ THE SECOND HALF OF §397, which that entry filed as UNPINNED "for want of
  //  a fixture that large". `RESOURCE_EMAILS_MAX` is 10, and the primary is
  //  dropped BEFORE the cap applies — so an extra equal to the primary used to
  //  consume a slot in the preview and not in the write, shifting WHICH address
  //  landed tenth. Here "a10@x.com" is the tenth stored address and was the one
  //  the old preview silently dropped.
  it("agrees with the write about which address lands tenth", () => {
    const extras = Array.from({ length: 10 }, (_, i) => `a${i + 1}@x.com`);
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, emails: ["m@x.com", ...extras] } }],
      { descriptor: d, item, ws: emailWs },
    );
    expect(plan.updates).toEqual([
      { entity: "resource", field: "emails", before: "b@x.com", after: extras.join(", "), raw: extras.join(", ") },
    ]);
  });

  // ★★ MERGED, NOT STORED — the model may change the primary in the SAME call,
  //  and `sanitizeResource` sanitizes the extras against the merged row's
  //  `email`. Passing the STORED primary would drop the wrong address here: the
  //  incoming extra "m@x.com" is no longer the primary and must survive, while
  //  the new primary "a@x.com" must be dropped from the extras.
  it("sanitizes the extras against a primary changed in the same call", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, email: "a@x.com", emails: ["m@x.com", "a@x.com"] } }],
      { descriptor: d, item, ws: emailWs },
    );
    expect(plan.updates).toEqual([
      { entity: "resource", field: "email", before: "m@x.com", after: "a@x.com", raw: "a@x.com" },
      { entity: "resource", field: "emails", before: "b@x.com", after: "m@x.com", raw: "m@x.com" },
    ]);
  });

  // ★★★ THE PRIMARY IS SANITIZED BEFORE IT IS COMPARED, exactly as
  //  `sanitizeResource` does it (`sanitizeEmail(input.email) || undefined`).
  //  `sanitizeEmail` trims and clips to EMAIL_MAX while `sanitizeEmailList`
  //  de-dupes on an EXACT `primary.toLowerCase()`, so a primary arriving with
  //  surrounding whitespace matched nothing: the writer stored `emails: []` and
  //  the card promised `bob@x.com` was kept. Same divergence for an
  //  over-EMAIL_MAX primary, where the writer compares the CLIPPED form.
  //  ★ The `email` diff below is the positive control — without it a green run
  //  could mean the whole call was rejected rather than the extra de-duped.
  it("de-dupes against the SANITIZED primary, not the raw one", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 5, email: "  Bob@X.com  ", emails: ["bob@x.com"] } }],
      { descriptor: d, item, ws: emailWs },
    );
    expect(plan.updates).toEqual([
      { entity: "resource", field: "email", before: "m@x.com", after: "Bob@X.com", raw: "Bob@X.com" },
      { entity: "resource", field: "emails", before: "b@x.com", after: "", raw: "" },
    ]);
  });
});

describe("task lastUpdateDate", () => {
  const d = INLINE_DESCRIPTORS.task;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const item = { id: 1, taskName: "T", dueDate: "2026-01-01", lastUpdateDate: "2026-01-01" } as any;
  const lupWs = wsWith({ tasks: [item] as never });

  it("previews an explicit lastUpdateDate change", () => {
    // Never stamped implicitly by any writer on this path, so an explicit change
    // is signal rather than noise. `buildTaskCleanPatch` persists it verbatim
    // once `sanitizeIsoDate` accepts it.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 1, lastUpdateDate: "2026-02-02" } }],
      { descriptor: d, item, ws: lupWs },
    );
    expect(plan.updates).toEqual([
      { entity: "task", field: "lastUpdateDate", before: "2026-01-01", after: "2026-02-02", raw: "2026-02-02" },
    ]);
    expect(plan.rejected).toEqual([]);
  });

  it("rejects a malformed lastUpdateDate the writer would silently drop", () => {
    // `dateFields` membership is what buys this: `buildTaskCleanPatch` runs
    // `sanitizeIsoDate` and keeps the key only when it parses, so an unparseable
    // value leaves the field untouched. Previewing it as a change would promise
    // a write that does not happen.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 1, lastUpdateDate: "02/02/2026" } }],
      { descriptor: d, item, ws: lupWs },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([{ toolName: "update_task", reason: "bad-input", detail: "lastUpdateDate=02/02/2026" }]);
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
  //  `firstName` CLEARING — the joint rule accepts it, because the surviving
  //  `lastName` keeps the row valid — while the DISPATCHER performs the
  //  RENAME, so the card contradicts the write. ★ That sentence used to say the
  //  preview showed a `firstName=empty` REJECTION, which was true only while
  //  both parts sat in `requiredNonEmpty`; §384 moved them into a
  //  `requiredNonEmptyGroups` entry, so the mutant's symptom changed shape
  //  without becoming any less of a contradiction. Measured under the mutant,
  //  not reasoned.
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

describe("the writer's JOINT name rule (384)", () => {
  // ★★★ The preview judges each field alone; `sanitizeResource`'s gate is a
  //  whole-row OR evaluated AFTER the merge. That mismatch is 384: a mononym
  //  rename previewed `lastName` as REJECTED while the write accepted the row
  //  and stored `lastName: ""`. The two REPLAYING consumers
  //  (`chat-proposal-apply.ts`, `use-insight-recommendations.ts`) resend the
  //  ORIGINAL tool input and never read the plan, so the refusal the card
  //  promised was one nothing performed.
  const cher = { id: 4, firstName: "Cher", lastName: "Bono" };
  const cherWs = wsWith({ resources: [cher] as never });
  const d = INLINE_DESCRIPTORS.resource;

  it("previews a mononym rename as the surname being cleared, not rejected", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 4, name: "Cher" } }],
      { descriptor: d, item: cher, ws: cherWs },
    );
    expect(plan.rejected).toEqual([]);
    expect(plan.updates).toEqual([{ entity: "resource", field: "lastName", before: "Bono", after: "", raw: "" }]);
  });

  it("still rejects emptying BOTH halves of the name", () => {
    // The joint rule is "at least one non-empty" — the writer returns null and
    // the dispatcher throws "invalid resource update", so rejecting is truthful.
    // Both members are judged, so both report the GROUP's detail.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 4, firstName: "", lastName: "" } }],
      { descriptor: d, item: cher, ws: cherWs },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected.map((r) => r.detail)).toContain("firstName+lastName=empty");
  });

  it("does not reject a rename the `name` fallback rescues", () => {
    // ★★★ FOUND IN COLD REVIEW, MEASURED AGAINST THE REAL WRITER. The joint
    //  guard modelled two of `sanitizeResource`'s three legs: it checks the two
    //  parts and missed the fallback that splits `input.name` when BOTH are
    //  empty. The projection above cannot cover this, because it declines to
    //  split whenever an explicit part is a string — mirroring the dispatcher,
    //  whose `renamed` is null then and lets `name` reach the sanitizer raw.
    //  So this input previewed `firstName+lastName=empty` while the write
    //  renamed the row to "Cher Something". On the two REPLAYING consumers the
    //  card stated positively that a change would not land, and it landed —
    //  strictly worse than the silence this slice set out to replace.
    const noFirst = { id: 9, firstName: "", lastName: "Bono" };
    const ws = wsWith({ resources: [noFirst] as never });
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 9, lastName: "", name: "Cher Something" } }],
      { descriptor: d, item: noFirst, ws },
    );
    expect(plan.rejected).toEqual([]);
    // ★★★ ASSERTING ONLY `rejected` IS WHY THE HALF-FIX SHIPPED GREEN. The
    //  first cut suppressed the rejection without projecting the split, so this
    //  test passed while the card said `lastName: Bono → ""` — a clear the write
    //  does not make — and omitted the firstName change altogether. A preview is
    //  a promise about the WRITE, so assert what the card SHOWS, not merely what
    //  it declines to refuse.
    expect(plan.updates).toEqual([
      { entity: "resource", field: "firstName", before: "", after: "Cher", raw: "Cher" },
      { entity: "resource", field: "lastName", before: "Bono", after: "Something", raw: "Something" },
    ]);
  });

  it("still rejects when the `name` fallback cannot rescue it either", () => {
    // The fallback only survives if the split yields a non-empty part, so a
    // blank alias must NOT turn a truthful rejection into a false acceptance.
    const noFirst = { id: 9, firstName: "", lastName: "Bono" };
    const ws = wsWith({ resources: [noFirst] as never });
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 9, lastName: "", name: "   " } }],
      { descriptor: d, item: noFirst, ws },
    );
    expect(plan.rejected.map((r) => r.detail)).toContain("firstName+lastName=empty");
  });

  it("judges the surviving member through ITS OWN sanitizer, not verbatim", () => {
    // ★★★ THE CRUX, and the one shape a `str(input[m])` survivor check gets
    //  wrong in the DANGEROUS direction. `sanitizeAssignee` is
    //  `sanitizeText(_, ASSIGNEE_MAX)`, whose `clipText` returns "" for any
    //  NON-STRING — so `lastName: 42` reaches `sanitizeResource` as an empty
    //  part, both halves are empty, and the write THROWS. Read verbatim, `42`
    //  reads as a surviving surname and the preview would accept a diff whose
    //  Apply fails, losing every other field in the same patch with it.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 4, firstName: "", lastName: 42 } }],
      { descriptor: d, item: cher, ws: cherWs },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejected.map((r) => r.detail)).toContain("firstName+lastName=empty");
  });

  it("reads an unsupplied member from the STORED row, as the writer's spread does", () => {
    // `updateResource` merges `{...existing, ...patch}`, so a member the model
    // did not send keeps its stored value — which is what lets the mononym
    // rename above survive on a `firstName` that is not in the input at all.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 4, lastName: "" } }],
      { descriptor: d, item: cher, ws: cherWs },
    );
    expect(plan.rejected).toEqual([]);
    expect(plan.updates).toEqual([{ entity: "resource", field: "lastName", before: "Bono", after: "", raw: "" }]);
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
    expect(plan.links).toEqual([{ entity: "raid", target: "row", field: "linkedTaskIds", before: "Draft brief, Review", after: "Ship", rawIds: [2] }]);
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

  it("uses the milestone's OWN id rule, which parses a delimited string", () => {
    // WAS "…which drops a delimited string", asserting after "" / rawIds [] —
    // the milestone rule was array-only, so raid/change parsed "1;2" into two
    // links and a milestone stored []. §403 aligned it. What this
    // still pins is the invariant that outlived the divergence: the preview
    // shows what THIS writer does, reached through the milestone's own
    // function, so a later re-divergence moves the card with the write.
    const ga = { id: 5, name: "GA", linkedTaskIds: [1] };
    const mws = wsWith({ tasks: linkTasks as never, milestones: [ga] as never });
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_milestone", input: { id: 5, linkedTaskIds: "1;2" } }],
      { descriptor: INLINE_DESCRIPTORS.milestone, item: ga, ws: mws },
    );
    expect(plan.links).toEqual([
      { entity: "milestone", target: "row", field: "linkedTaskIds", before: "Draft brief", after: "Draft brief, Ship", rawIds: [1, 2] },
    ]);
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
      expect(plan.links).toEqual([{ entity: "resource", target: "row", field: "roleId", before: "Engineering L3", after: "Design L3", rawIds: [12] }]);
    });

    it("shows a cleared FK as an empty after with no ids", () => {
      const plan = describeEntityCalls(
        [{ type: "tool_use", name: "update_resource", input: { id: 3, roleId: null } }],
        { descriptor: INLINE_DESCRIPTORS.resource, item: ada, ws: roleWs },
      );
      expect(plan.links).toEqual([{ entity: "resource", target: "row", field: "roleId", before: "Engineering L3", after: "", rawIds: [] }]);
    });
  });
});

describe("EditPlan.links", () => {
  it("counts a links-only plan as non-empty", () => {
    // A plan that ONLY changes relationships must still render. Treating it as
    // empty would hide the most destructive write class behind a blank card.
    const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [], links: [
      { entity: "raid", target: "row", field: "linkedTaskIds", before: "Draft brief", after: "Ship", rawIds: [2] },
    ] };
    expect(isEmptyPlan(plan)).toBe(false);
  });

  it("is empty only when every bucket is empty", () => {
    expect(isEmptyPlan({ updates: [], creates: [], deletes: [], rejected: [], links: [] })).toBe(true);
  });
});

// §407. `plan.links` is ONE flat bucket, and all three preview surfaces render
// it as flat rows in the SAME list — nothing separates a line projected off a
// `create_*` call from one that really does rewrite the open row. `target`
// closed the WRITE half of that (the rebuild path filters on it); it cannot
// close the DISCLOSURE half, because the reader of the card never sees `target`.
describe("a create's link line names the row it belongs to (§407)", () => {
  const openRow = { id: 4, category: "R", title: "Risk A", status: "Open", linkedTaskIds: [1, 3] };
  const linkWs = wsWith({
    raid: [openRow] as never,
    tasks: [
      { id: 1, taskName: "Draft brief" }, { id: 3, taskName: "Review" },
      { id: 7, taskName: "Task Seven" }, { id: 9, taskName: "Task Nine" },
    ] as never,
  });

  /** The open row rewrites its own links AND a create writes different ones —
   *  the mixed shape. `createInput` is the only variable. */
  function mixedLinks(createInput: Record<string, unknown>): EditPlan["links"] {
    return describeEntityCalls(
      [
        { type: "tool_use", name: "update_raid_item", input: { id: 4, linkedTaskIds: [7] } },
        { type: "tool_use", name: "create_raid_item", input: createInput },
      ],
      { descriptor: INLINE_DESCRIPTORS.raid, item: openRow, ws: linkWs },
    ).links;
  }

  // ★★★ THE MIXED CASE IS THE SHAPE THE DEFECT TAKES, and a create-ONLY fixture
  //  cannot discriminate: qualifying EVERY link line satisfies that one while
  //  making the open row's own line read "Risk A – Linked tasks", the
  //  "Migrate database – Migrate database" render `LinkDiff.subject` forbids.
  //  Here both lines carry the byte-identical field label and different values,
  //  which is exactly what left a reader unable to tell which was the row's.
  it("qualifies the create's diff and leaves the open row's bare", () => {
    const all = mixedLinks({ category: "R", title: "Risk B", linkedTaskIds: [9] });
    expect(all).toHaveLength(2);
    const [rowLink, createLink] = all;
    expect(rowLink).toEqual({ entity: "raid", target: "row", field: "linkedTaskIds", before: "Draft brief, Review", after: "Task Seven", rawIds: [7] });
    // ★★ `toEqual` IGNORES an undefined-valued key, so the assertion above
    //  cannot tell an ABSENT `subject` from one set to `undefined` — and it
    //  cannot tell either from a "" one, which is the render this fix must not
    //  produce. The membership check is what pins the absence.
    expect("subject" in rowLink).toBe(false);
    expect(createLink).toEqual({ entity: "raid", target: "create", subject: "Risk B", field: "linkedTaskIds", before: "", after: "Task Nine", rawIds: [9] });
  });

  // ★ The no-dangling-prefix half. `titleOf`'s `??` chain falls through only on
  //  null/undefined, so an explicitly empty `title` survives it and returns "".
  //  Emitting that would render " – Linked tasks" on all three surfaces.
  it("omits the subject entirely when the create carries no usable title", () => {
    const [, createLink] = mixedLinks({ category: "R", title: "", linkedTaskIds: [9] });
    expect(createLink.target).toBe("create");
    expect("subject" in createLink).toBe(false);
  });
});
