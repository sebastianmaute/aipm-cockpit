# Inline "Ask Claude" per-item edit — SP2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend SP1's inline natural-language edit popover (tasks) to RAID / change / milestone / stakeholder rows, via one generic engine driven by a per-entity descriptor, with tasks refactored onto it.

**Architecture:** A pure `entity-descriptor.ts` captures each entity's writable diff-fields + apply-preview guards (required-non-empty, date, int-range, enums — RAID status is category-effective). `describeEntityCalls` (generalized from the task-only `describeToolCalls`) builds the preview `EditPlan` from that descriptor; `useInlineEntityEdit` (generalized from `use-inline-ai-edit`) runs the same idle→thinking→preview→apply state machine over any entity. Task-bound wrappers (`describeToolCalls`, `useInlineAiEdit`) preserve SP1's public API so its tests stay green. `workspace-section` owns four glue-hook instances (thin-pane pattern) and threads `onAiEdit`/`aiEditEnabled` into each panel, rendering the shared popover itself.

**Tech Stack:** TypeScript, React 19, vitest, fast-check. No new deps; NO new AI tools, Workspace fields, or backend write paths.

**Verify per task:** tests `npm run test:run -- <file>` · typecheck `npx tsc --noEmit` (i18n EN/DE parity) · lint `npm run lint` (max-warnings=0). Final: `npm run size:check`, `npm run dup:check`, axe RAID+Milestones.

**Key facts pinned from the codebase (do not re-derive):**
- The dispatcher (`use-chat-dispatcher.ts`) update tools for raid/change/milestone/stakeholder do `sanitizeX({ ...existing, ...patch, id })` — they do NOT use an explicit per-field `cleanPatch` (only `update_task` does). So the writable set = the fields each `sanitizeX` keeps, and **out-of-enum values are COERCED, not ignored** (invalid RAID `category`→"R", RAID `status`→the category's first status, `severity`→dropped; change `type`→"Other", `status`→"Proposed", `impact`→dropped; stakeholder `category`→"Other", `influence`/`interest`→"Medium"; milestone/stakeholder empty required name→whole sanitize returns null→the dispatcher throws "invalid … update"). The preview must REJECT any value the sanitizer would coerce/drop (else Apply silently diverges from the diff).
- RAID status validity depends on category (`RISK_STATUSES`/`ASSUMPTION_STATUSES`/`ISSUE_STATUSES`/`DEPENDENCY_STATUSES` for R/A/I/D). The effective category = a VALID patched `category` else the existing item's.
- Relational id-list fields (`linkedTaskIds`, `causedByRaidIds`, `stakeholderIds`, `linkedRaidIds`) and FK fields (`ownerResourceId`, `resourceId`) are EXCLUDED from diff-fields (same as SP1 excluding `resourceId`/`startDate` for tasks). The model can still set links by proposing a `create_*` related item.
- `update_task` keeps SP1's explicit `cleanPatch` behavior (out-of-enum status/priority left unchanged) — its guards match "reject".

---

## Task 1: entity descriptor (pure)

**Files:**
- Create: `src/app/inline-ai-edit/entity-descriptor.ts`
- Create: `src/app/inline-ai-edit/entity-descriptor.test.ts`

- [ ] **Step 1: Write the failing test** `src/app/inline-ai-edit/entity-descriptor.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { INLINE_DESCRIPTORS, validSetFor, type InlineEntity } from "./entity-descriptor";
import type { RaidItem } from "../types";

describe("INLINE_DESCRIPTORS", () => {
  const entities: InlineEntity[] = ["task", "raid", "change", "milestone", "stakeholder"];

  it("has a descriptor per entity with matching update/delete tools", () => {
    expect(INLINE_DESCRIPTORS.task.updateTool).toBe("update_task");
    expect(INLINE_DESCRIPTORS.raid.deleteTool).toBe("delete_raid_item");
    expect(INLINE_DESCRIPTORS.change.updateTool).toBe("update_change");
    expect(INLINE_DESCRIPTORS.milestone.wsKey).toBe("milestones");
    expect(INLINE_DESCRIPTORS.stakeholder.titleOf({ name: "Ann" } as never)).toBe("Ann");
    for (const e of entities) expect(INLINE_DESCRIPTORS[e].entity).toBe(e);
  });

  it("excludes relational id-list + FK fields from diffFields", () => {
    for (const e of entities) {
      const f = INLINE_DESCRIPTORS[e].diffFields;
      for (const banned of ["linkedTaskIds", "causedByRaidIds", "stakeholderIds", "linkedRaidIds", "ownerResourceId", "resourceId", "raci"]) {
        expect(f).not.toContain(banned);
      }
    }
  });

  it("RAID status valid-set follows the item's category", () => {
    const risk = validSetFor("raid", "status", { category: "R" } as RaidItem);
    const issue = validSetFor("raid", "status", { category: "I" } as RaidItem);
    expect(risk.has("Open")).toBe(true);           // Risk: Open/Mitigated/Realized/Closed
    expect(risk.has("Resolved")).toBe(false);      // Resolved is Issue-only
    expect(issue.has("Resolved")).toBe(true);
    expect(issue.has("Mitigated")).toBe(false);
  });

  it("marks required-non-empty, date, int-range, enum, array fields", () => {
    expect(INLINE_DESCRIPTORS.milestone.requiredNonEmpty.has("name")).toBe(true);
    expect(INLINE_DESCRIPTORS.milestone.dateFields.has("date")).toBe(true);
    expect(INLINE_DESCRIPTORS.raid.intRangeFields.probability).toEqual([1, 5]);
    expect(INLINE_DESCRIPTORS.change.intRangeFields.scheduleImpactDays[0]).toBe(0);
    expect(INLINE_DESCRIPTORS.task.arrayFields.has("labels")).toBe(true);
    expect(INLINE_DESCRIPTORS.stakeholder.enumFields).toContain("influence");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm run test:run -- entity-descriptor` → FAIL ("Cannot find module ./entity-descriptor").

- [ ] **Step 3: Write** `src/app/inline-ai-edit/entity-descriptor.ts`

```ts
// src/app/inline-ai-edit/entity-descriptor.ts
//
// Pure, i18n-free. Per-entity configuration for the inline "Ask Claude" editor:
// which fields an update tool can write, and the apply-preview guards that keep
// a previewed diff from diverging from what the dispatcher's sanitizeX would
// actually persist (invalid enum/date/range values are COERCED or DROPPED by the
// sanitizers, so we must reject them in the preview instead of showing a diff
// Apply won't make). See docs plan for the pinned sanitizer behavior.
import {
  PRIORITIES, TASK_STATUSES,
  RAID_CATEGORIES, RAID_SEVERITIES,
  RISK_STATUSES, ASSUMPTION_STATUSES, ISSUE_STATUSES, DEPENDENCY_STATUSES,
  CHANGE_TYPES, CHANGE_STATUSES,
  STAKEHOLDER_CATEGORIES, INFLUENCE_INTEREST_LEVELS,
  type RaidCategory,
} from "../types";
import { type Workspace } from "../workspace";

export type InlineEntity = "task" | "raid" | "change" | "milestone" | "stakeholder";

// Change impact reuses RAID severities plus "Critical" (matches CHANGE_IMPACT_SET
// in sanitize-records.ts). No named const exists, so define it here.
const CHANGE_IMPACT_LEVELS = ["Low", "Medium", "High", "Critical"] as const;

/** A field whose valid value-set may depend on the (patched) item — used for
 *  RAID status, which is category-scoped. Returns the set of strings the
 *  sanitizer would keep verbatim. */
export type EnumResolver = (patchedItem: Record<string, unknown>) => ReadonlySet<string>;

export interface EntityDescriptor {
  entity: InlineEntity;
  updateTool: string;
  deleteTool: string;
  createTool: string;
  wsKey: keyof Workspace;
  /** Exactly the fields the dispatcher's update tool can persist (scalar/enum/
   *  date/number only — relational id-lists + FKs excluded). */
  diffFields: string[];
  /** Required fields whose value must stay non-empty (sanitizer returns null →
   *  dispatcher throws otherwise). */
  requiredNonEmpty: ReadonlySet<string>;
  /** Fields validated as YYYY-MM-DD when non-empty (invalid → sanitizer drops/blanks). */
  dateFields: ReadonlySet<string>;
  /** Integer-range fields [min, max]; use Infinity for an open upper bound. */
  intRangeFields: Record<string, [number, number]>;
  /** Enum fields → the valid-set resolver (constant for most; category-scoped for RAID status). */
  enumFields: Record<string, EnumResolver>;
  /** Fields sent to Apply as a comma-split string[] (task labels). */
  arrayFields: ReadonlySet<string>;
  /** Fields coerced to Number on Apply. */
  numberFields: ReadonlySet<string>;
  titleOf: (item: Record<string, unknown>) => string;
}

const constSet = (values: readonly string[]): EnumResolver => {
  const set = new Set<string>(values);
  return () => set;
};

// RAID status set for the patched item's effective category.
function raidStatusSet(cat: RaidCategory): ReadonlySet<string> {
  switch (cat) {
    case "A": return new Set(ASSUMPTION_STATUSES);
    case "I": return new Set(ISSUE_STATUSES);
    case "D": return new Set(DEPENDENCY_STATUSES);
    default:  return new Set(RISK_STATUSES);
  }
}
const raidStatusResolver: EnumResolver = (item) => {
  const raw = item.category;
  const cat: RaidCategory = typeof raw === "string" && (RAID_CATEGORIES as string[]).includes(raw)
    ? (raw as RaidCategory) : "R";
  return raidStatusSet(cat);
};

export const INLINE_DESCRIPTORS: Record<InlineEntity, EntityDescriptor> = {
  task: {
    entity: "task", updateTool: "update_task", deleteTool: "delete_task", createTool: "create_task", wsKey: "tasks",
    diffFields: ["taskName", "assignee", "assigneeEmail", "dueDate", "status", "priority", "notes", "blockers", "group", "labels"],
    requiredNonEmpty: new Set(["taskName"]),
    dateFields: new Set(["dueDate"]),
    intRangeFields: {},
    enumFields: { status: constSet(TASK_STATUSES), priority: constSet(PRIORITIES) },
    arrayFields: new Set(["labels"]),
    numberFields: new Set(),
    titleOf: (i) => String(i.taskName ?? ""),
  },
  raid: {
    entity: "raid", updateTool: "update_raid_item", deleteTool: "delete_raid_item", createTool: "create_raid_item", wsKey: "raid",
    diffFields: ["category", "title", "status", "description", "mitigation", "owner", "ownerEmail", "severity", "probability", "impact", "raisedDate", "targetDate", "closedDate"],
    requiredNonEmpty: new Set(["title"]),
    dateFields: new Set(["raisedDate", "targetDate", "closedDate"]),
    intRangeFields: { probability: [1, 5], impact: [1, 5] },
    enumFields: { category: constSet(RAID_CATEGORIES), severity: constSet(RAID_SEVERITIES), status: raidStatusResolver },
    arrayFields: new Set(),
    numberFields: new Set(["probability", "impact"]),
    titleOf: (i) => String(i.title ?? ""),
  },
  change: {
    entity: "change", updateTool: "update_change", deleteTool: "delete_change", createTool: "create_change", wsKey: "changes",
    diffFields: ["title", "description", "type", "status", "impact", "impactDescription", "scheduleImpactDays", "costImpact", "requestedBy", "raisedDate", "decisionBy", "decisionDate", "resolutionNotes"],
    requiredNonEmpty: new Set(["title"]),
    dateFields: new Set(["raisedDate", "decisionDate"]),
    intRangeFields: { scheduleImpactDays: [0, Infinity], costImpact: [0, Infinity] },
    enumFields: { type: constSet(CHANGE_TYPES), status: constSet(CHANGE_STATUSES), impact: constSet(CHANGE_IMPACT_LEVELS) },
    arrayFields: new Set(),
    numberFields: new Set(["scheduleImpactDays", "costImpact"]),
    titleOf: (i) => String(i.title ?? ""),
  },
  milestone: {
    entity: "milestone", updateTool: "update_milestone", deleteTool: "delete_milestone", createTool: "create_milestone", wsKey: "milestones",
    diffFields: ["name", "date", "description", "achievedDate"],
    requiredNonEmpty: new Set(["name", "date"]),
    dateFields: new Set(["date", "achievedDate"]),
    intRangeFields: {},
    enumFields: {},
    arrayFields: new Set(),
    numberFields: new Set(),
    titleOf: (i) => String(i.name ?? ""),
  },
  stakeholder: {
    entity: "stakeholder", updateTool: "update_stakeholder", deleteTool: "delete_stakeholder", createTool: "create_stakeholder", wsKey: "stakeholders",
    diffFields: ["name", "organization", "title", "email", "category", "influence", "interest", "notes"],
    requiredNonEmpty: new Set(["name"]),
    dateFields: new Set(),
    intRangeFields: {},
    enumFields: { category: constSet(STAKEHOLDER_CATEGORIES), influence: constSet(INFLUENCE_INTEREST_LEVELS), interest: constSet(INFLUENCE_INTEREST_LEVELS) },
    arrayFields: new Set(),
    numberFields: new Set(),
    titleOf: (i) => String(i.name ?? ""),
  },
};

/** The valid value-set for an enum field given the (patched) item. Returns an
 *  empty set for a non-enum field. */
export function validSetFor(entity: InlineEntity, field: string, patchedItem: Record<string, unknown>): ReadonlySet<string> {
  const resolver = INLINE_DESCRIPTORS[entity].enumFields[field];
  return resolver ? resolver(patchedItem) : new Set<string>();
}
```

- [ ] **Step 4: Run test to verify it passes** — `npm run test:run -- entity-descriptor` → PASS. `npx tsc --noEmit` → 0. `npm run lint` → 0.

- [ ] **Step 5: Commit**
```bash
git add src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/entity-descriptor.test.ts
git commit -m "feat(inline-ai-edit): per-entity descriptor for SP2 generalization"
```

---

## Task 2: descriptor drift guard (diffFields ⊆ dispatcher-writable)

A field listed in `diffFields` that the dispatcher's `sanitizeX` silently drops would show an undroppable diff. This guard round-trips each field through the real sanitizer to prove it survives.

**Files:**
- Create: `src/app/inline-ai-edit/descriptor-drift.test.ts`

- [ ] **Step 1: Write the test** `src/app/inline-ai-edit/descriptor-drift.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { sanitizeRaidItem, sanitizeChangeItem, sanitizeMilestone, sanitizeStakeholder } from "../sanitize";

// One valid full item per entity + a valid replacement value per diff field.
// Each field is set on a valid base, run through the sanitizer, and must survive
// with the replacement value (proving the sanitizer keeps it — no silent drop).
const RAID_BASE = { id: 1, category: "R", title: "T", status: "Open", raisedDate: "2026-01-01" };
const RAID_VALUES: Record<string, unknown> = {
  category: "I", title: "New", status: "Resolved", description: "d", mitigation: "m",
  owner: "Ann", ownerEmail: "a@b.co", severity: "High", probability: 3, impact: 4,
  raisedDate: "2026-02-02", targetDate: "2026-03-03", closedDate: "2026-04-04",
};
const CHANGE_BASE = { id: 1, title: "T", type: "Other", status: "Proposed", raisedDate: "2026-01-01" };
const CHANGE_VALUES: Record<string, unknown> = {
  title: "New", description: "d", type: "Scope", status: "Approved", impact: "High",
  impactDescription: "id", scheduleImpactDays: 5, costImpact: 100, requestedBy: "Ann",
  raisedDate: "2026-02-02", decisionBy: "Bob", decisionDate: "2026-03-03", resolutionNotes: "r",
};
const MILE_BASE = { id: 1, name: "M", date: "2026-01-01" };
const MILE_VALUES: Record<string, unknown> = { name: "New", date: "2026-02-02", description: "d", achievedDate: "2026-03-03" };
const STK_BASE = { id: 1, name: "S", category: "Other", influence: "Medium", interest: "Medium", raci: {} };
const STK_VALUES: Record<string, unknown> = {
  name: "New", organization: "Org", title: "CTO", email: "a@b.co",
  category: "Sponsor", influence: "High", interest: "Low", notes: "n",
};

const CASES = [
  { entity: "raid" as const, base: RAID_BASE, values: RAID_VALUES, sanitize: sanitizeRaidItem },
  { entity: "change" as const, base: CHANGE_BASE, values: CHANGE_VALUES, sanitize: sanitizeChangeItem },
  { entity: "milestone" as const, base: MILE_BASE, values: MILE_VALUES, sanitize: sanitizeMilestone },
  { entity: "stakeholder" as const, base: STK_BASE, values: STK_VALUES, sanitize: sanitizeStakeholder },
];

describe("descriptor diffFields are dispatcher-writable", () => {
  for (const { entity, base, values, sanitize } of CASES) {
    for (const field of INLINE_DESCRIPTORS[entity].diffFields) {
      it(`${entity}.${field} survives sanitize`, () => {
        expect(field in values).toBe(true); // test data must cover every diff field
        const out = sanitize({ ...base, [field]: values[field] }) as Record<string, unknown> | null;
        expect(out).not.toBeNull();
        expect(String(out![field])).toBe(String(values[field]));
      });
    }
  }
});
```
(Note: the `category` value for RAID uses "I" so the base `status: "Open"` stays valid for Issue — Issue statuses include "Open". The per-field cases set ONE field at a time on the valid base, so category="I" + status="Open" is coherent.)

- [ ] **Step 2: Run** — `npm run test:run -- descriptor-drift` → PASS (if a field is dropped, that case FAILS, exposing a bad diffField). `npx tsc --noEmit` → 0.

- [ ] **Step 3: Commit**
```bash
git add src/app/inline-ai-edit/descriptor-drift.test.ts
git commit -m "test(inline-ai-edit): guard diffFields against dispatcher silent-drop"
```

---

## Task 3: generalize plan.ts → describeEntityCalls

**Files:**
- Modify: `src/app/inline-ai-edit/plan.ts`
- Modify: `src/app/inline-ai-edit/plan.test.ts` (add entity cases; keep task cases green)
- Test: `src/app/inline-ai-edit/plan.property.test.ts` (retarget the generic fn via the wrapper — no change needed if it imports `describeToolCalls`)

- [ ] **Step 1: Write failing tests** — append to `src/app/inline-ai-edit/plan.test.ts`:

```ts
import { describeEntityCalls } from "./plan";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import type { Workspace } from "../workspace";

function wsWith(part: Partial<Workspace>): Workspace {
  return { tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], ...part } as unknown as Workspace;
}

describe("describeEntityCalls — raid", () => {
  const raidItem = { id: 7, category: "R", title: "Old", status: "Open" };
  const ws = wsWith({ raid: [raidItem] as never });
  const d = INLINE_DESCRIPTORS.raid;

  it("previews a valid field diff on the target item", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, title: "New" } }],
      { descriptor: d, item: raidItem, ws },
    );
    expect(plan.updates).toEqual([{ field: "title", before: "Old", after: "New" }]);
  });

  it("rejects a status invalid for the item's category", () => {
    // "Resolved" is Issue-only; item is category R (Risk) → coerced by sanitizer → reject.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, status: "Resolved" } }],
      { descriptor: d, item: raidItem, ws },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
  });

  it("accepts a status valid for a co-changed category", () => {
    // Same call sets category=I AND status=Resolved → effective category I → valid.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, category: "I", status: "Resolved" } }],
      { descriptor: d, item: raidItem, ws },
    );
    expect(plan.updates.map((u) => u.field).sort()).toEqual(["category", "status"]);
    expect(plan.rejected).toHaveLength(0);
  });

  it("rejects an out-of-range probability", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 7, probability: 9 } }],
      { descriptor: d, item: raidItem, ws },
    );
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
  });

  it("rejects update targeting a different id", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 99, title: "X" } }],
      { descriptor: d, item: raidItem, ws },
    );
    expect(plan.rejected[0]).toMatchObject({ reason: "unknown-id" });
  });

  it("allows a cross-entity create + the own delete", () => {
    const plan = describeEntityCalls(
      [
        { type: "tool_use", name: "create_task", input: { taskName: "follow up" } },
        { type: "tool_use", name: "delete_raid_item", input: { id: 7 } },
      ],
      { descriptor: d, item: raidItem, ws },
    );
    expect(plan.creates).toHaveLength(1);
    expect(plan.deletes).toHaveLength(1);
  });
});

describe("describeEntityCalls — milestone required field", () => {
  const m = { id: 3, name: "Kickoff", date: "2026-01-01" };
  const ws = wsWith({ milestones: [m] as never });
  it("rejects blanking a required name", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_milestone", input: { id: 3, name: "" } }],
      { descriptor: INLINE_DESCRIPTORS.milestone, item: m, ws },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
  });
  it("rejects an invalid date", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_milestone", input: { id: 3, date: "next friday" } }],
      { descriptor: INLINE_DESCRIPTORS.milestone, item: m, ws },
    );
    expect(plan.rejected[0]).toMatchObject({ reason: "bad-input" });
  });
});
```

- [ ] **Step 2: Run** — `npm run test:run -- inline-ai-edit/plan.test` → FAIL ("describeEntityCalls is not a function").

- [ ] **Step 3: Rewrite** `src/app/inline-ai-edit/plan.ts` to the generic core + task wrapper:

```ts
// src/app/inline-ai-edit/plan.ts
//
// Pure, i18n-free. Translate model tool-use blocks into a previewable EditPlan
// for the inline "Ask Claude" editor, for any entity. No React, no i18n, no
// side effects.
import { type Task } from "../types";
import { type Workspace } from "../workspace";
import { INLINE_DESCRIPTORS, validSetFor, type EntityDescriptor } from "./entity-descriptor";

export type ToolUseLike = { type: string; id?: string; name?: string; input?: unknown };

export interface FieldDiff { field: string; before: string; after: string }
export interface NewItem { entity: string; title: string; toolName: string; input: Record<string, unknown> }
export interface Deletion { entity: string; label: string; toolName: string; id: number }
export interface Rejected { toolName: string; reason: "unknown-id" | "bad-input" | "unsupported"; detail: string }
export interface EditPlan { updates: FieldDiff[]; creates: NewItem[]; deletes: Deletion[]; rejected: Rejected[] }

// Any create_*/delete_* tool → its entity + workspace list key. Shared across
// entities (an inline edit on any row may create/delete related items).
const CREATE_TOOLS: Record<string, string> = {
  create_raid_item: "raid", create_change: "change",
  create_milestone: "milestone", create_stakeholder: "stakeholder", create_task: "task",
};
const DELETE_TOOLS: Record<string, { entity: string; wsKey: keyof Workspace }> = {
  delete_task: { entity: "task", wsKey: "tasks" },
  delete_raid_item: { entity: "raid", wsKey: "raid" },
  delete_change: { entity: "change", wsKey: "changes" },
  delete_milestone: { entity: "milestone", wsKey: "milestones" },
  delete_stakeholder: { entity: "stakeholder", wsKey: "stakeholders" },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
function titleOf(entity: string, input: Record<string, unknown>): string {
  return str(input.title ?? input.taskName ?? input.name ?? input.description ?? entity);
}

interface EntityItem { id: number; [k: string]: unknown }

/** Build the plan for one entity. `ctx.item` is the row the popover opened on;
 *  `ctx.ws` the live workspace (id grounding + delete labels); `ctx.descriptor`
 *  drives which fields are diffable + how a value is validated so a previewed
 *  diff never diverges from what the sanitizer would persist. */
export function describeEntityCalls(
  blocks: readonly ToolUseLike[],
  ctx: { descriptor: EntityDescriptor; item: EntityItem; ws: Workspace },
): EditPlan {
  const { descriptor: d, item, ws } = ctx;
  const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [] };
  const ownIds = new Set((ws[d.wsKey] as ReadonlyArray<{ id: number }>).map((r) => r.id));

  for (const b of blocks) {
    if (b.type !== "tool_use" || typeof b.name !== "string") continue;
    const name = b.name;
    const input = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;

    if (name === d.updateTool) {
      const id = Number(input.id);
      if (id !== item.id) {
        plan.rejected.push({ toolName: name, reason: ownIds.has(id) ? "unsupported" : "unknown-id", detail: str(input.id) });
        continue;
      }
      // Effective patched item (for category-scoped enums like RAID status):
      // overlay every present, VALID-typed field so status validates against a
      // co-changed category. Invalid values are still rejected per-field below.
      const patched: Record<string, unknown> = { ...item, ...input };
      for (const f of d.diffFields) {
        if (!(f in input)) continue;
        const before = str(item[f]);
        const after = str(input[f]);
        if (before === after) continue;
        const bad = (detail: string) => plan.rejected.push({ toolName: name, reason: "bad-input", detail });
        if (d.requiredNonEmpty.has(f) && after === "") { bad(`${f}=empty`); continue; }
        if (d.dateFields.has(f) && after !== "" && !DATE_RE.test(after)) { bad(`${f}=${after}`); continue; }
        const range = d.intRangeFields[f];
        if (range) {
          const n = Number(after);
          if (!Number.isInteger(n) || n < range[0] || n > range[1]) { bad(`${f}=${after}`); continue; }
        }
        if (f in d.enumFields && !validSetFor(d.entity, f, patched).has(after)) { bad(`${f}=${after}`); continue; }
        plan.updates.push({ field: f, before, after });
      }
      continue;
    }

    if (name in CREATE_TOOLS) {
      const entity = CREATE_TOOLS[name];
      plan.creates.push({ entity, title: titleOf(entity, input), toolName: name, input });
      continue;
    }

    if (name in DELETE_TOOLS) {
      const { entity, wsKey } = DELETE_TOOLS[name];
      const id = Number(input.id);
      // The row's OWN entity may only delete the row it was opened on; other
      // entities' deletes are allowed (cross-entity cleanup).
      if (name === d.deleteTool && id !== item.id) {
        plan.rejected.push({ toolName: name, reason: "unsupported", detail: str(input.id) });
        continue;
      }
      const rows = ws[wsKey] as ReadonlyArray<{ id: number; title?: string; taskName?: string; name?: string }>;
      const found = Array.isArray(rows) ? rows.find((r) => r.id === id) : undefined;
      if (!found) { plan.rejected.push({ toolName: name, reason: "unknown-id", detail: str(input.id) }); continue; }
      plan.deletes.push({ entity, label: str(found.title ?? found.taskName ?? found.name ?? id), toolName: name, id });
      continue;
    }
  }
  return plan;
}

/** Task-bound wrapper preserving SP1's signature (its tests import this). */
export function describeToolCalls(blocks: readonly ToolUseLike[], ctx: { task: Task; ws: Workspace }): EditPlan {
  return describeEntityCalls(blocks, { descriptor: INLINE_DESCRIPTORS.task, item: ctx.task as unknown as EntityItem, ws: ctx.ws });
}

/** True when the plan would write nothing (used to disable Apply / show a note). */
export function isEmptyPlan(p: EditPlan): boolean {
  return p.updates.length === 0 && p.creates.length === 0 && p.deletes.length === 0;
}
```

- [ ] **Step 4: Run** — `npm run test:run -- inline-ai-edit/plan` → PASS (existing task tests + new entity tests + property test via the wrapper). `npx tsc --noEmit` → 0. `npm run lint` → 0.

- [ ] **Step 5: Commit**
```bash
git add src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts
git commit -m "feat(inline-ai-edit): generic describeEntityCalls + task wrapper"
```

---

## Task 4: generalize the call + popover

**Files:**
- Modify: `src/app/inline-ai-edit-call.ts` (task → generic entity/item/label)
- Modify: `src/app/inline-ai-edit-call.test.ts`
- Modify: `src/app/inline-ai-edit-popover.tsx` (`task` prop → `itemTitle` + `entityLabel`)
- Modify: `src/app/inline-ai-edit-popover.test.tsx`

- [ ] **Step 1: Read the current files** (`inline-ai-edit-call.ts`, `inline-ai-edit-popover.tsx`) to see the exact prompt-building + prop usage.

- [ ] **Step 2: Update the popover** — in `inline-ai-edit-popover.tsx`, replace the `task: Task` prop with `itemTitle: string; entityLabel: string;`, drop the `import { type Task }`, change the header to render `entityLabel` and the subline (line ~46) from `{task.taskName}` to `{itemTitle}`. Keep all a11y (autofocus ref, aria-labels, stable cancel).

```tsx
// props interface:
export interface InlineAiEditPopoverProps {
  lang: Lang;
  itemTitle: string;
  entityLabel: string;
  phase: InlinePhase;
  plan: EditPlan | null;
  clarifyText: string;
  errorText: string;
  onSubmit: (instruction: string) => void | Promise<void>;
  onApply: () => void | Promise<void>;
  onCancel: () => void;
}
// subline:
<p className="mb-3 truncate text-xs text-muted-foreground">{itemTitle}</p>
```
Update `inline-ai-edit-popover.test.tsx`: pass `itemTitle="…"` + `entityLabel="…"` instead of `task={…}`; assert both render.

- [ ] **Step 3: Update the call** — in `inline-ai-edit-call.ts`, change the argument from `task: Task` to `entity: InlineEntity; item: Record<string, unknown>; itemLabel: string;`. In the user/prompt string, replace the task-specific phrasing with `You are editing this ${entity}: ${itemLabel}.` and serialize `item` (the same way SP1 serialized the task — reuse its JSON/field dump). Keep the security invariants verbatim (never log/echo apiKey or body; thrown errors carry only status digits or "parse"). Update `inline-ai-edit-call.test.ts` accordingly.

- [ ] **Step 4: Run** — `npm run test:run -- inline-ai-edit-call inline-ai-edit-popover` → PASS. `npx tsc --noEmit` → 0. `npm run lint` → 0.

- [ ] **Step 5: Commit**
```bash
git add src/app/inline-ai-edit-call.ts src/app/inline-ai-edit-call.test.ts src/app/inline-ai-edit-popover.tsx src/app/inline-ai-edit-popover.test.tsx
git commit -m "feat(inline-ai-edit): generalize call + popover over entity"
```

---

## Task 5: generalize the state machine hook

**Files:**
- Create: `src/app/use-inline-entity-edit.ts` (generalized from `use-inline-ai-edit.ts`)
- Modify: `src/app/use-inline-ai-edit.ts` → thin task wrapper re-exporting the SP1 API
- Modify/Create: `src/app/use-inline-entity-edit.test.tsx` (move + extend the SP1 hook test; keep a task case + add a raid case)

- [ ] **Step 1: Create** `src/app/use-inline-entity-edit.ts` — the SP1 hook generalized. Signature takes a `descriptor` + generic `item`:

```ts
"use client";
import { useCallback, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { type Workspace } from "./workspace";
import { type ToolDispatcher, runTool } from "./chat-tools";
import { type AiConfig, isAiEnabled } from "./settings-types";
import { type OperatingGuide } from "./operating-guide";
import { type ActivityKind } from "./activity-log";
import { callInlineEdit } from "./inline-ai-edit-call";
import { describeEntityCalls, isEmptyPlan, type EditPlan } from "./inline-ai-edit/plan";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./inline-ai-edit/entity-descriptor";

export type InlinePhase = "idle" | "thinking" | "preview" | "clarify" | "applying" | "error";
type EntityItem = { id: number; [k: string]: unknown };

export interface InlineEntityEditDeps {
  entity: InlineEntity;
  dispatcher: ToolDispatcher;
  ai: AiConfig;
  apiKey: string;
  isPopout: boolean;
  lang: Lang;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  ws: Workspace;
  guides: readonly OperatingGuide[];
  recordUsage?: (u: { input_tokens: number; output_tokens: number }) => void;
  /** Extra per-entity enable clause (task: !jiraKey). */
  gate?: (item: EntityItem) => boolean;
}

export interface InlineEntityEditApi {
  activeItem: EntityItem | null;
  phase: InlinePhase;
  plan: EditPlan | null;
  clarifyText: string;
  errorText: string;
  aiEditEnabled: (item: EntityItem) => boolean;
  openFor: (item: EntityItem) => void;
  submit: (instruction: string) => Promise<void>;
  apply: () => Promise<void>;
  cancel: () => void;
}

export function useInlineEntityEdit(deps: InlineEntityEditDeps): InlineEntityEditApi {
  const d = INLINE_DESCRIPTORS[deps.entity];
  const [activeItem, setActiveItem] = useState<EntityItem | null>(null);
  const [phase, setPhase] = useState<InlinePhase>("idle");
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [clarifyText, setClarifyText] = useState("");
  const [errorText, setErrorText] = useState("");
  const reqIdRef = useRef(0);

  const aiEditEnabled = (item: EntityItem): boolean =>
    isAiEnabled(deps.ai) && !deps.isPopout && !!deps.apiKey.trim() && (deps.gate?.(item) ?? true);

  const openFor = (item: EntityItem) => {
    if (!aiEditEnabled(item)) return;
    reqIdRef.current++;
    setActiveItem(item); setPhase("idle"); setPlan(null); setClarifyText(""); setErrorText("");
  };

  const cancel = useCallback(() => {
    reqIdRef.current++;
    setActiveItem(null); setPhase("idle"); setPlan(null); setClarifyText(""); setErrorText("");
  }, []);

  const submit = async (instruction: string) => {
    if (!activeItem || !instruction.trim() || phase === "thinking" || phase === "applying") return;
    const reqId = ++reqIdRef.current;
    const target = activeItem;
    setPhase("thinking"); setErrorText(""); setClarifyText("");
    try {
      const { blocks, text, usage } = await callInlineEdit({
        apiKey: deps.apiKey, model: deps.ai.model, lang: deps.lang,
        entity: deps.entity, item: target, itemLabel: d.titleOf(target),
        instruction, snapshot: deps.dispatcher.getSnapshot(),
        guides: deps.guides, groundInGuides: deps.ai.groundInGuides,
      });
      if (reqId !== reqIdRef.current) return;
      deps.recordUsage?.(usage);
      const next = describeEntityCalls(blocks, { descriptor: d, item: target, ws: deps.ws });
      if (isEmptyPlan(next)) { setClarifyText(text || t(deps.lang, "inlineAiEditNoChanges")); setPhase("clarify"); return; }
      setPlan(next); setPhase("preview");
    } catch {
      if (reqId !== reqIdRef.current) return;
      setErrorText(t(deps.lang, "inlineAiEditError")); setPhase("error");
    }
  };

  const apply = async () => {
    if (!activeItem || !plan || isEmptyPlan(plan) || phase !== "preview") return;
    setPhase("applying");
    let applied = 0;
    try {
      if (plan.updates.length > 0) {
        const patch: Record<string, unknown> = { id: activeItem.id };
        for (const diff of plan.updates) patch[diff.field] = coerce(d, diff.field, diff.after);
        await runTool(deps.dispatcher, d.updateTool, patch);
        applied++;
      }
      for (const c of plan.creates) { await runTool(deps.dispatcher, c.toolName, c.input); applied++; }
      for (const del of plan.deletes) { await runTool(deps.dispatcher, del.toolName, { id: del.id }); applied++; }
      deps.logActivity?.("ai.inlineEdit", activeItem.id, d.titleOf(activeItem));
      deps.showToast("info", t(deps.lang, "inlineAiEditApplied", d.titleOf(activeItem)));
      cancel();
    } catch {
      if (applied > 0) {
        deps.logActivity?.("ai.inlineEdit", activeItem.id, d.titleOf(activeItem));
        deps.showToast("error", t(deps.lang, "inlineAiEditPartial"));
        cancel();
      } else {
        setErrorText(t(deps.lang, "inlineAiEditApplyFailed")); setPhase("error");
      }
    }
  };

  return { activeItem, phase, plan, clarifyText, errorText, aiEditEnabled, openFor, submit, apply, cancel };
}

function coerce(d: { arrayFields: ReadonlySet<string>; numberFields: ReadonlySet<string> }, field: string, value: string): unknown {
  if (d.arrayFields.has(field)) return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (d.numberFields.has(field)) return Number(value);
  return value;
}
```

- [ ] **Step 2: Rewrite** `src/app/use-inline-ai-edit.ts` as a thin task wrapper keeping SP1's exact exported API (`InlineAiEditDeps`, `InlineAiEditApi` with `activeTask`, `useInlineAiEdit`):

```ts
"use client";
import { type Task } from "./types";
import { useInlineEntityEdit, type InlineEntityEditDeps, type InlinePhase } from "./use-inline-entity-edit";
import { type EditPlan } from "./inline-ai-edit/plan";

export type { InlinePhase };

// A type alias (NOT `interface … extends … {}`) — an empty extending interface
// trips @typescript-eslint/no-empty-object-type under max-warnings=0.
export type InlineAiEditDeps = Omit<InlineEntityEditDeps, "entity" | "gate">;

export interface InlineAiEditApi {
  activeTask: Task | null;
  phase: InlinePhase;
  plan: EditPlan | null;
  clarifyText: string;
  errorText: string;
  aiEditEnabled: (task: Task) => boolean;
  openFor: (task: Task) => void;
  submit: (instruction: string) => Promise<void>;
  apply: () => Promise<void>;
  cancel: () => void;
}

export function useInlineAiEdit(deps: InlineAiEditDeps): InlineAiEditApi {
  const api = useInlineEntityEdit({
    ...deps,
    entity: "task",
    gate: (item) => !(item as Task).jiraKey,
  });
  return {
    activeTask: api.activeItem as Task | null,
    phase: api.phase, plan: api.plan, clarifyText: api.clarifyText, errorText: api.errorText,
    aiEditEnabled: api.aiEditEnabled as (task: Task) => boolean,
    openFor: api.openFor as (task: Task) => void,
    submit: api.submit, apply: api.apply, cancel: api.cancel,
  };
}
```
(The `!jiraKey` gate moves here — it was hardcoded in SP1's `aiEditEnabled`. The generic hook keeps only the AI/popout/key clause.)

- [ ] **Step 3: Move + extend the hook test** — rename `use-inline-ai-edit.test.tsx` cases to import from `use-inline-entity-edit` where they test the generic machine, keeping at least: a task case (via `useInlineAiEdit`, `activeTask`, jiraKey-gated), a raid case (via `useInlineEntityEdit({entity:"raid",…})`), the stale-response discard, and the partial-apply honesty. Use the existing SP1 test's dispatcher mock; add a raid item + `updateRaid` mock. Assert:
  - task: `useInlineAiEdit` still exposes `activeTask`; `aiEditEnabled` false for a `jiraKey` task.
  - raid: `submit` → `preview`; `apply` calls `runTool(dispatcher,"update_raid_item",{id,…})`.
  - stale: a second `openFor` before a slow `submit` resolves discards the first plan.
  - partial: a create that throws after an update committed → `inlineAiEditPartial` toast + closes.

- [ ] **Step 4: Run** — `npm run test:run -- use-inline-ai-edit use-inline-entity-edit` → PASS. `npx tsc --noEmit` → 0. `npm run lint` → 0.

- [ ] **Step 5: Commit**
```bash
git add src/app/use-inline-entity-edit.ts src/app/use-inline-ai-edit.ts src/app/use-inline-entity-edit.test.tsx
git rm --cached src/app/use-inline-ai-edit.test.tsx 2>/dev/null || true
git commit -m "feat(inline-ai-edit): generic useInlineEntityEdit + task wrapper"
```

---

## Task 6: generic glue hook

**Files:**
- Create: `src/app/use-entity-inline-ai-edit.tsx` (coverage-excluded UI glue)
- Modify: `vitest.config.ts` (add the new glue file to `coverage.exclude` — mirrors `use-tasks-inline-ai-edit.tsx`)

- [ ] **Step 1: Create** `src/app/use-entity-inline-ai-edit.tsx`:

```tsx
"use client";
// Generic glue for the inline "Ask Claude" editor on a thin entity pane. Wraps
// useInlineEntityEdit with the section's adapters (toast, AI-usage naming,
// effective key) and owns the popover element. Pure render glue — no logic worth
// unit-testing (the hook + popover have their own tests); coverage-excluded.
import { type ReactNode } from "react";
import { type Lang } from "./i18n";
import { type Settings, aiKeyIfEnabled } from "./settings-types";
import { type ToolDispatcher } from "./chat-tools";
import { type ActivityKind } from "./activity-log";
import { useWorkspace } from "./workspace-context";
import { useToastContext } from "./toast-context";
import { useAiUsageContext } from "./ai-usage-context";
import { useInlineEntityEdit } from "./use-inline-entity-edit";
import { InlineAiEditPopover } from "./inline-ai-edit-popover";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./inline-ai-edit/entity-descriptor";
import { t } from "./i18n";

type Item = { id: number; [k: string]: unknown };

export interface EntityInlineAiEditDeps {
  dispatcher: ToolDispatcher;
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export interface EntityInlineAiEdit {
  onAiEdit: (item: Item) => void;
  aiEditEnabled: (item: Item) => boolean;
  popover: ReactNode;
}

const ENTITY_LABEL_KEY: Record<InlineEntity, string> = {
  task: "inlineAiEditEntityTask",
  raid: "inlineAiEditEntityRaid",
  change: "inlineAiEditEntityChange",
  milestone: "inlineAiEditEntityMilestone",
  stakeholder: "inlineAiEditEntityStakeholder",
};

export function useEntityInlineAiEdit(entity: InlineEntity, deps: EntityInlineAiEditDeps): EntityInlineAiEdit {
  const showToast = useToastContext();
  const { record } = useAiUsageContext();
  const ws = useWorkspace();
  const edit = useInlineEntityEdit({
    entity,
    dispatcher: deps.dispatcher,
    ai: deps.settings.ai,
    apiKey: aiKeyIfEnabled(deps.settings.ai),
    isPopout: deps.isPopout,
    lang: deps.lang,
    logActivity: deps.logActivity,
    showToast,
    ws,
    guides: [],
    recordUsage: (u) => record({ input: u.input_tokens, output: u.output_tokens }),
  });
  const { openFor: onAiEdit, aiEditEnabled } = edit;
  const popover = edit.activeItem ? (
    <InlineAiEditPopover
      lang={deps.lang}
      itemTitle={INLINE_DESCRIPTORS[entity].titleOf(edit.activeItem)}
      entityLabel={t(deps.lang, ENTITY_LABEL_KEY[entity])}
      phase={edit.phase}
      plan={edit.plan}
      clarifyText={edit.clarifyText}
      errorText={edit.errorText}
      onSubmit={edit.submit}
      onApply={edit.apply}
      onCancel={edit.cancel}
    />
  ) : null;
  return { onAiEdit, aiEditEnabled, popover };
}
```

- [ ] **Step 2:** In `vitest.config.ts`, add `"src/app/use-entity-inline-ai-edit.tsx"` to the `coverage.exclude` array (find the line listing `use-tasks-inline-ai-edit.tsx` and add the new file beside it).

- [ ] **Step 3: Run** — `npx tsc --noEmit` → 0; `npm run lint` → 0. (No unit test — coverage-excluded glue; behavior covered by the hook + popover tests.)

- [ ] **Step 4: Commit**
```bash
git add src/app/use-entity-inline-ai-edit.tsx vitest.config.ts
git commit -m "feat(inline-ai-edit): generic pane glue hook (coverage-excluded)"
```

---

## Task 7: i18n entity labels

**Files:**
- Modify: `src/app/i18n.ts` · `src/app/i18n.de.ts`

- [ ] **Step 1:** In `i18n.ts`, near the other `inlineAiEdit*` keys, add:
```ts
  inlineAiEditEntityTask: "task",
  inlineAiEditEntityRaid: "RAID item",
  inlineAiEditEntityChange: "change request",
  inlineAiEditEntityMilestone: "milestone",
  inlineAiEditEntityStakeholder: "stakeholder",
```

- [ ] **Step 2:** In `i18n.de.ts` add the German parity keys (node utf8 write per the CRLF/umlaut rule — match `\r\n`; these strings are umlaut-free but use node per the rule):
```
  inlineAiEditEntityTask: "Aufgabe",
  inlineAiEditEntityRaid: "RAID-Eintrag",
  inlineAiEditEntityChange: "Anderungsantrag",
  inlineAiEditEntityMilestone: "Meilenstein",
  inlineAiEditEntityStakeholder: "Stakeholder",
```
**★★ "Anderungsantrag" MUST be "Änderungsantrag"** — write the real umlaut via the node utf8 write (`Änderungsantrag`), never the ASCII "Ae"/"A" sub (the `i18n-encoding` test bans ASCII substitutes). Use a node script:
```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');s=s.replace('  inlineAiEditNoChanges:', '  inlineAiEditEntityTask: \"Aufgabe\",\r\n  inlineAiEditEntityRaid: \"RAID-Eintrag\",\r\n  inlineAiEditEntityChange: \"Änderungsantrag\",\r\n  inlineAiEditEntityMilestone: \"Meilenstein\",\r\n  inlineAiEditEntityStakeholder: \"Stakeholder\",\r\n  inlineAiEditNoChanges:');fs.writeFileSync(p,s);"
```
(Anchor on an EXISTING `inlineAiEdit*` key line — verify the anchor exists first with `grep -n inlineAiEditNoChanges src/app/i18n.de.ts`; if the key name differs, anchor on whichever `inlineAiEdit*` key is present. Confirm CRLF with `file src/app/i18n.de.ts`.)

- [ ] **Step 3: Run** — `grep -n "inlineAiEditEntity" src/app/i18n.ts src/app/i18n.de.ts` (10 hits, umlaut intact in DE); `npx tsc --noEmit` → 0 (EN/DE parity enforced); `npm run test:run -- i18n-encoding` → PASS.

- [ ] **Step 4: Commit**
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(inline-ai-edit): entity labels for SP2 popover (EN+DE)"
```

---

## Task 8: wire RAID panel

**Files:**
- Modify: `src/app/workspace-section.tsx` (call the glue for raid; thread `onAiEdit`/`aiEditEnabled` into `RaidPanel`; render `{popover}`)
- Modify: `src/app/workspace-section-types.ts` NO change (props stay internal to section) — but `RaidPanel` gains two props on ITS interface
- Modify: `src/app/raid-panel.tsx` (accept + forward the two props to `RaidTable`)
- Modify: `src/app/raid-panel-rows.tsx` (render the ✨ button per row)
- Modify: `src/app/raid-panel.test.tsx` or `raid-panel-rows` test if one asserts the row action set

- [ ] **Step 1: Read** `raid-panel.tsx` (find the `RaidTable` render + its prop list) and `raid-panel-rows.tsx` (find the per-row edit `<button onClick={() => openEdit(item)}>` at line ~174).

- [ ] **Step 2:** In `workspace-section.tsx`, near the top of the component body (with the other hooks; unconditional), add:
```tsx
import { useEntityInlineAiEdit } from "./use-entity-inline-ai-edit";
// … inside the component, before the return:
const raidInlineAi = useEntityInlineAiEdit("raid", { dispatcher, settings, isPopout, lang, logActivity });
```
(`settings` is already in section scope — it's used for `isAiEnabled` at line 3 of the imports; if `settings` is not destructured, add it to the props destructure. Verify with `grep -n "settings" src/app/workspace-section.tsx`.)

At the `<RaidPanel …>` render (line ~355) add:
```tsx
onAiEdit={raidInlineAi.onAiEdit}
aiEditEnabled={raidInlineAi.aiEditEnabled}
```
and immediately after the `<RaidPanel/>` element, render `{raidInlineAi.popover}`.

- [ ] **Step 3:** In `raid-panel.tsx`, add to its props interface:
```tsx
onAiEdit?: (item: RaidItem) => void;
aiEditEnabled?: (item: RaidItem) => boolean;
```
Destructure them and forward to `<RaidTable … onAiEdit={onAiEdit} aiEditEnabled={aiEditEnabled} />`.

- [ ] **Step 4:** In `raid-panel-rows.tsx`, add to `RaidTable`'s props:
```tsx
onAiEdit?: (item: RaidItem) => void;
aiEditEnabled?: (item: RaidItem) => boolean;
```
Beside the existing edit button (line ~174), add the ✨ button, gated on `aiEditEnabled?.(item)`:
```tsx
{onAiEdit && aiEditEnabled?.(item) && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onAiEdit(item); }}
    className={`${ICON_BTN_CLASS}`}   // reuse the row's existing icon-button class
    aria-label={`${t(lang, "inlineAiEdit")} – ${item.title}`}
    title={`${t(lang, "inlineAiEdit")} – ${item.title}`}
  >
    <SparkleIcon />  {/* reuse the same ✨ icon component the task row uses */}
  </button>
)}
```
Use the SAME ✨ icon + icon-button styling the task row uses (find it in `task-row.tsx` — import/copy the icon component; if it's inline, extract a small shared `SparkleIcon`). Row-unique aria-label via `item.title` (RAID is axe-scanned).

- [ ] **Step 5: Run** — `npm run test:run -- raid-panel` → PASS (add/adjust a test asserting the ✨ button renders with a row-unique label when `aiEditEnabled` returns true, and is absent when it returns false). `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 6:** axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"` → pass (labeled ✨ button; note the live seed may have AI disabled → button absent, which still passes; the label correctness is unit-asserted).
- [ ] **Step 7: Commit**
```bash
git add src/app/workspace-section.tsx src/app/raid-panel.tsx src/app/raid-panel-rows.tsx src/app/raid-panel.test.tsx
git commit -m "feat(inline-ai-edit): inline Ask-Claude on RAID rows"
```

---

## Task 9: wire change panel

**Files:**
- Modify: `src/app/workspace-section.tsx` · `src/app/change-panel.tsx` · `src/app/change-panel.test.tsx`

- [ ] **Step 1: Read** `change-panel.tsx` — the row edit button is at line ~544 (`onClick={() => openEdit(item)}`). `openEdit` is defined at line ~292.

- [ ] **Step 2:** In `workspace-section.tsx`, add:
```tsx
const changeInlineAi = useEntityInlineAiEdit("change", { dispatcher, settings, isPopout, lang, logActivity });
```
At `<ChangePanel …>` (line ~517) add `onAiEdit={changeInlineAi.onAiEdit}` + `aiEditEnabled={changeInlineAi.aiEditEnabled}`; render `{changeInlineAi.popover}` after it.

- [ ] **Step 3:** In `change-panel.tsx`, add the two optional props to the panel's interface + destructure. Beside the row edit button (line ~544), add the ✨ button gated on `aiEditEnabled?.(item)`, `stopPropagation`, row-unique label `${t(lang,"inlineAiEdit")} – ${item.title}`, same ✨ icon.

- [ ] **Step 4: Run** — `npm run test:run -- change-panel` → PASS (assert ✨ renders/absent per `aiEditEnabled`). `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 5: Commit**
```bash
git add src/app/workspace-section.tsx src/app/change-panel.tsx src/app/change-panel.test.tsx
git commit -m "feat(inline-ai-edit): inline Ask-Claude on change rows"
```

---

## Task 10: wire milestone panel

**Files:**
- Modify: `src/app/workspace-section.tsx` · `src/app/milestones-panel.tsx` · `src/app/milestones-panel.test.tsx`

- [ ] **Step 1: Read** `milestones-panel.tsx` — rows open the editor via `setEditing(m)`. Find the per-row edit control.

- [ ] **Step 2:** In `workspace-section.tsx`, add:
```tsx
const milestoneInlineAi = useEntityInlineAiEdit("milestone", { dispatcher, settings, isPopout, lang, logActivity });
```
At `<MilestonesPanel …>` add `onAiEdit`/`aiEditEnabled`; render `{milestoneInlineAi.popover}` after it.

- [ ] **Step 3:** In `milestones-panel.tsx`, add the two optional props + destructure. Beside the row edit trigger, add the ✨ button gated on `aiEditEnabled?.(m)`, `stopPropagation`, row-unique label `${t(lang,"inlineAiEdit")} – ${m.name}` (Milestones is axe-scanned), same ✨ icon.

- [ ] **Step 4: Run** — `npm run test:run -- milestones-panel` → PASS (assert ✨). `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 5:** axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Milestones"` → pass.
- [ ] **Step 6: Commit**
```bash
git add src/app/workspace-section.tsx src/app/milestones-panel.tsx src/app/milestones-panel.test.tsx
git commit -m "feat(inline-ai-edit): inline Ask-Claude on milestone rows"
```

---

## Task 11: wire stakeholder panel

**Files:**
- Modify: `src/app/workspace-section.tsx` · `src/app/stakeholders-panel.tsx` · `src/app/stakeholders-panel.test.tsx`

- [ ] **Step 1: Read** `stakeholders-panel.tsx` — the row edit button is at line ~485/500 (`onClick={() => openEdit(item)}`, with a `stopPropagation` variant). `openEdit` at line ~224.

- [ ] **Step 2:** In `workspace-section.tsx`, add:
```tsx
const stakeholderInlineAi = useEntityInlineAiEdit("stakeholder", { dispatcher, settings, isPopout, lang, logActivity });
```
At `<StakeholdersPanel …>` (line ~550) add `onAiEdit`/`aiEditEnabled`; render `{stakeholderInlineAi.popover}` after it.

- [ ] **Step 3:** In `stakeholders-panel.tsx`, add the two optional props + destructure. Beside the row edit button, add the ✨ button gated on `aiEditEnabled?.(item)`, `stopPropagation`, row-unique label `${t(lang,"inlineAiEdit")} – ${item.name}`, same ✨ icon.

- [ ] **Step 4: Run** — `npm run test:run -- stakeholders-panel` → PASS (assert ✨). `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 5: Commit**
```bash
git add src/app/workspace-section.tsx src/app/stakeholders-panel.tsx src/app/stakeholders-panel.test.tsx
git commit -m "feat(inline-ai-edit): inline Ask-Claude on stakeholder rows"
```

---

## Final verification

- [ ] `npx tsc --noEmit` → 0 (EN/DE parity)
- [ ] `npm run lint` → 0 (max-warnings=0)
- [ ] `npm run test:run` → full green (SP1 task tests unchanged; new entity tests pass)
- [ ] `npm run size:check` → ok — RAID/change/milestone/stakeholder panels + workspace-section grew; if any file legitimately crossed 800 lines, `npm run size:check -- --update` and note the reason in the commit (mirrors TD-7). Record which files were baselined.
- [ ] `npm run dup:check` → within 2.4 (the four panel ✨ blocks are near-identical — if the gate trips, extract a tiny shared `InlineAiEditButton` presentational component taking `{item, onAiEdit, aiEditEnabled, label}` and use it in all four panels).
- [ ] axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID" -g "Milestones"` → pass.
- [ ] Grep sanity: `grep -rn "describeToolCalls\|useInlineAiEdit" src/app` still resolves (SP1 wrappers intact); `grep -rn "task: Task" src/app/inline-ai-edit-popover.tsx` → no hits (popover generalized).

Then follow **superpowers:finishing-a-development-branch**.
