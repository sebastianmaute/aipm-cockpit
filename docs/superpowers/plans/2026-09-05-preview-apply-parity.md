# Preview/apply parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make the AI edit preview disclose every field a chat write tool can change, and make that property enforced by a test rather than maintained by hand.

**Architecture:** relationship/FK fields get a NEW descriptor member and a NEW `EditPlan.links` array — deliberately NOT `diffFields`, whose contract is scalar-only and whose members are written back by the inline editor. Scalar gaps (`emails`, `lastUpdateDate`) join `diffFields` normally. An enumeration test compares declared tool inputs against the union of both plus a reasoned exclusion set.

**Tech Stack:** TypeScript, React, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-preview-apply-parity-design.md`

---

## Before you start — five landmines specific to this work

1. **NEVER put a link field in `diffFields`.** `use-inline-entity-edit.ts` does
   `patch[diff.field] = coerce(d, diff.field, diff.raw ?? diff.after)` over
   `plan.updates`. A link diff there writes the TITLE STRING into
   `linkedTaskIds`; `sanitizeIdList` then splits that string on `[.;]`, finds no
   integers, and stores `[]` — **wiping every link**. That is why links live in
   a separate `EditPlan.links` array: the rebuild loop iterates `updates`, so
   the exclusion is structural rather than a flag someone can forget.
2. **`npx tsc --noEmit` exits 2 on diagnostics, not 1.**
3. **Never read a gate's exit code through a pipe.** Redirect, `echo "EXIT=$?"`
   unpiped, then grep the file.
4. **`src/app/i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it.**
   Patch it with a `.mjs` script using `\r\n` anchors and real umlauts. The
   `i18n-encoding` test bans `ue`/`ae`/`oe` substitutions. EN/DE key parity is
   tsc-enforced, so a missing DE key fails typecheck — loud, which is fine.
5. **Run ONE vitest process at a time.** `Failed to start forks worker` means
   contention, not a broken suite.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/inline-ai-edit/plan.ts` | modify | `LinkDiff` type, `EditPlan.links`, `isEmptyPlan`, link-diff emission |
| `src/app/inline-ai-edit/entity-descriptor.ts` | modify | `linkFields`, `requiredNonEmptyGroups`, the ten new field entries |
| `src/app/inline-ai-edit/link-titles.ts` | **create** | id→title resolution, dangling marker. Pure, i18n-free |
| `src/app/inline-ai-edit/field-labels.ts` | **create** | `${entity}.${field}` → i18n key map + raw-name fallback |
| `src/app/sanitize-records.ts` | modify | export the milestone id rule so the preview can call it |
| `src/app/chat-proposal-block.tsx` | modify | render links + rejections |
| `src/app/insights/recommendation-review-modal.tsx` | modify | name rejected fields |
| `src/app/insights/recommend-plan.ts` | modify | merge `links` at its three merge sites |
| `src/app/inline-ai-edit/tool-input-coverage.test.ts` | **create** | the enumeration gate |
| `src/app/inline-ai-edit/plan.write-path.test.ts` | **create** | differential against the REAL write path |
| `src/app/inline-ai-edit/plan.sanitizer-parity.test.ts` | modify | remove the false "safe direction" swallow |
| `src/app/i18n.ts` / `i18n.de.ts` | modify | label strings for gaps only |
| `docs/open-followups.md`, `docs/AGENTS/ai-assistant.md` | modify | close §384, file four, record the invariant |

---

### Task 1: `EditPlan.links` — the structural exclusion

**Files:**
- Modify: `src/app/inline-ai-edit/plan.ts`
- Modify: `src/app/insights/recommend-plan.ts`
- Test: `src/app/inline-ai-edit/plan.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/inline-ai-edit/plan.test.ts`:

```ts
describe("EditPlan.links", () => {
  it("counts a links-only plan as non-empty", () => {
    // A plan that ONLY changes relationships must still render. Treating it as
    // empty would hide the most destructive write class behind a blank card.
    const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [], links: [
      { field: "linkedTaskIds", before: "Draft brief", after: "Ship" },
    ] };
    expect(isEmptyPlan(plan)).toBe(false);
  });

  it("is empty only when every bucket is empty", () => {
    expect(isEmptyPlan({ updates: [], creates: [], deletes: [], rejected: [], links: [] })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run src/app/inline-ai-edit/plan.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"
```

Expected: FAIL — `links` is not a property of `EditPlan`. (tsc will also object; vitest itself does not typecheck.)

- [ ] **Step 3: Add the type and the emptiness rule**

In `src/app/inline-ai-edit/plan.ts`, beside `FieldDiff`:

```ts
/** A relationship or FK change, rendered from RESOLVED TITLES rather than ids.
 *
 *  ★★★ THIS IS NOT A `FieldDiff` AND MUST NEVER BE PUT IN `plan.updates`.
 *   `use-inline-entity-edit.ts` rebuilds its write patch from `updates` with
 *   `patch[diff.field] = coerce(d, diff.field, diff.raw ?? diff.after)`. A link
 *   diff there would write the TITLE STRING into `linkedTaskIds`, and
 *   `sanitizeIdList` splits a string on `[.;]`, finds no integers and stores
 *   `[]` — wiping every link the row had. The separate array is what makes that
 *   unreachable by construction; a marker flag on `FieldDiff` would not, because
 *   the rebuild loop would still have to remember to check it. */
export interface LinkDiff { field: string; before: string; after: string }
```

Extend the interface and the predicate:

```ts
export interface EditPlan { updates: FieldDiff[]; creates: NewItem[]; deletes: Deletion[]; rejected: Rejected[]; links: LinkDiff[] }

export function isEmptyPlan(p: EditPlan): boolean {
  return p.updates.length === 0 && p.creates.length === 0 && p.deletes.length === 0 && p.links.length === 0;
}
```

In `describeEntityCalls`, initialise the new bucket:

```ts
const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [], links: [] };
```

- [ ] **Step 4: Fix every other construction site**

```
grep -rn "rejected: \[\]" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Each literal that builds an `EditPlan` needs `links: []`. In
`src/app/insights/recommend-plan.ts` add the merge at all THREE sites that
already do `merged.rejected.push(...p.rejected)`:

```ts
      merged.links.push(...p.links);
```

- [ ] **Step 5: Typecheck and test**

```
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/inline-ai-edit/plan.test.ts src/app/insights/recommend-plan.test.ts > /tmp/t1b.log 2>&1; echo "EXIT=$?"
```

Expected: tsc EXIT=0, vitest EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts src/app/insights/recommend-plan.ts
git commit -m "feat(inline-ai-edit): add EditPlan.links, structurally excluded from the rebuild path"
```

---

### Task 2: Export the milestone id rule

**Files:**
- Modify: `src/app/sanitize-records.ts`
- Test: `src/app/sanitize-records.test.ts`

The preview must call the writer's own rule (the descriptor's "DELEGATE, NEVER
RESTATE" doctrine). Milestone's rule is currently inline and differs from
`sanitizeIdList` in TWO ways: no dedupe, and array-only (no delimited-string
parsing).

- [ ] **Step 1: Write the failing test**

```ts
import { sanitizeMilestoneTaskIds } from "./sanitize-records";

describe("sanitizeMilestoneTaskIds", () => {
  it("keeps positive integers in order and does NOT dedupe", () => {
    expect(sanitizeMilestoneTaskIds([3, 1, 3])).toEqual([3, 1, 3]);
  });

  it("yields [] for a delimited string, unlike sanitizeIdList", () => {
    // The asymmetry is deliberate to PRESERVE, not to fix here: this pins it so
    // the preview can mirror it exactly. Filed separately in open-followups.
    expect(sanitizeMilestoneTaskIds("1;2")).toEqual([]);
  });

  it("drops zero, negatives and non-numbers", () => {
    expect(sanitizeMilestoneTaskIds([0, -1, "x", 2])).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run src/app/sanitize-records.test.ts -t "sanitizeMilestoneTaskIds" > /tmp/t2.log 2>&1; echo "EXIT=$?"
```

Expected: FAIL — no such export.

- [ ] **Step 3: Extract, do not reimplement**

In `src/app/sanitize-records.ts`, lift the existing inline expression out of
`sanitizeMilestone` verbatim:

```ts
/** The milestone's OWN linked-task rule. ★★ It is deliberately NOT
 *  `sanitizeIdList`: it accepts an array only (a delimited string yields `[]`,
 *  where raid/change parse one) and it does NOT dedupe. Exported so the preview
 *  can call the real rule instead of approximating it with the raid/change one,
 *  which would show links a milestone write drops. */
export function sanitizeMilestoneTaskIds(v: unknown): number[] {
  return Array.isArray(v) ? v.map((n) => toNumber(n)).filter((n) => Number.isFinite(n) && n > 0) : [];
}
```

Then call it from `sanitizeMilestone`:

```ts
    linkedTaskIds: sanitizeMilestoneTaskIds(o.linkedTaskIds),
```

- [ ] **Step 4: Verify it is a pure extraction**

```
npx vitest run src/app/sanitize-records.test.ts src/app/workspace.test.ts > /tmp/t2b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t2b.log
```

Expected: EXIT=0, no previously-passing test changed.

- [ ] **Step 5: Commit**

```bash
git add src/app/sanitize-records.ts src/app/sanitize-records.test.ts
git commit -m "refactor(sanitize): export the milestone linked-task rule for the preview to call"
```

---

### Task 3: `linkFields` on the descriptor

**Files:**
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts`
- Test: `src/app/inline-ai-edit/entity-descriptor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { INLINE_DESCRIPTORS } from "./entity-descriptor";

describe("linkFields", () => {
  it("names a real workspace array for every link field", () => {
    // A wrong wsKey resolves nothing and every title renders as unknown, which
    // reads like data loss on the card. The ws fixture proves the key exists.
    const ws = emptyWorkspace();
    let checked = 0;
    for (const d of Object.values(INLINE_DESCRIPTORS)) {
      for (const [field, link] of Object.entries(d.linkFields)) {
        expect(Array.isArray(ws[link.wsKey]), `${d.entity}.${field} -> ${String(link.wsKey)}`).toBe(true);
        checked += 1;
      }
    }
    // Guards against an empty map registering zero assertions and reporting green.
    expect(checked).toBe(8);
  });

  it("declares no link field that is also a diffField", () => {
    // The two sets must stay disjoint: a field in BOTH would be written back by
    // the inline editor as a title string. See the LinkDiff docstring.
    for (const d of Object.values(INLINE_DESCRIPTORS)) {
      for (const field of Object.keys(d.linkFields)) {
        expect(d.diffFields, `${d.entity}.${field}`).not.toContain(field);
      }
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run src/app/inline-ai-edit/entity-descriptor.test.ts -t "linkFields" > /tmp/t3.log 2>&1; echo "EXIT=$?"
```

Expected: FAIL — `linkFields` does not exist.

- [ ] **Step 3: Add the member**

In `EntityDescriptor`:

```ts
/** Relationship and FK inputs the update tool accepts, which `diffFields`
 *  deliberately excludes (its contract is scalar/enum/date/number only).
 *
 *  ★★★ SUPPLYING ONE REPLACES THE STORED LIST — every dispatcher merges by
 *   object spread, so `linkedTaskIds: [7]` drops the other links. Nothing
 *   reconstructs them: there is no reciprocal field on the referenced row, the
 *   derived index is computed FROM this array, and the activity-log entry
 *   carries no field diff. The undo stack's before-image is the only surviving
 *   copy and it is session-scoped. Disclosure before approval is the whole
 *   mitigation.
 *
 *  `sanitize` must be the WRITER'S OWN function, never a copy of its rule —
 *  raid and change use `sanitizeIdList` (parses a delimited string, dedupes),
 *  milestone uses `sanitizeMilestoneTaskIds` (array-only, no dedupe). */
linkFields: Record<string, LinkField>;
```

Above the interface:

★★★ AS BUILT (commit `1759901d`) — `titleOf` takes the WORKSPACE too, and the
plan's original single-argument version was a defect, not a simplification.
`Role` (`types.ts`) has NO `name` field: its label is discipline + grade,
resolved against two OTHER workspace arrays via `roleLabel`. A single-argument
accessor returns `""` for every role, and a blank title on this card is
indistinguishable from the link having been dropped — the exact symptom this
slice exists to prevent. The same widening already exists at `version-diff.ts`
for the identical reason, and it costs consumers nothing: a renderer must
already hold `ws` to resolve `ws[wsKey]`.

```ts
export interface LinkField {
  /** The workspace array holding the referenced rows. */
  readonly wsKey: keyof Workspace;
  /** `"list"` for an id array, `"id"` for a single FK (`resource.roleId`). */
  readonly kind: "list" | "id";
  /** The referenced row's display name. Takes `ws` because some labels are
   *  derived from OTHER workspace arrays (`roleLabel`), not stored on the row. */
  readonly titleOf: (row: Record<string, unknown>, ws: Workspace) => string;
  /** The APPLY path's own id rule for this field. */
  readonly sanitize: (v: unknown) => number[];
}
```

Add the entries — `raid`:

```ts
    linkFields: {
      linkedTaskIds: { wsKey: "tasks", kind: "list", titleOf: (r) => str(r.taskName), sanitize: sanitizeIdList },
      causedByRaidIds: { wsKey: "raid", kind: "list", titleOf: (r) => str(r.title), sanitize: sanitizeIdList },
      stakeholderIds: { wsKey: "stakeholders", kind: "list", titleOf: (r) => str(r.name), sanitize: sanitizeIdList },
    },
```

`change`:

```ts
    linkFields: {
      linkedTaskIds: { wsKey: "tasks", kind: "list", titleOf: (r) => str(r.taskName), sanitize: sanitizeIdList },
      linkedRaidIds: { wsKey: "raid", kind: "list", titleOf: (r) => str(r.title), sanitize: sanitizeIdList },
      stakeholderIds: { wsKey: "stakeholders", kind: "list", titleOf: (r) => str(r.name), sanitize: sanitizeIdList },
    },
```

`milestone`:

```ts
    linkFields: {
      linkedTaskIds: { wsKey: "tasks", kind: "list", titleOf: (r) => str(r.taskName), sanitize: sanitizeMilestoneTaskIds },
    },
```

`resource`:

```ts
    linkFields: {
      roleId: { wsKey: "roles", kind: "id", titleOf: (r, ws) => roleLabel(r, ws.disciplines, ws.grades), sanitize: (v) => { const n = toNumber(v); return Number.isFinite(n) && n > 0 ? [n] : []; } },
    },
```

★★ TWO CORRECTIONS FROM THE AS-BUILT COMMIT, both found by grepping rather than
by trusting the transcription above:

- `titleOf` is `roleLabel`, not `str(r.name)` — see the `LinkField` note above.
- `sanitize` uses **`toNumber`**, the writer's own coercion (`sanitizeResource`
  uses it), not `Number`. They disagree on exactly the shape a model is most
  likely to emit: `Number([5])` is `5`, so the preview would show a resolved
  link, while `toNumber([5])` is `NaN` and the writer stores a null FK. Writing
  `Number` here restates the rule instead of calling it, which is the one thing
  this member's own docstring forbids.

`task` and `stakeholder` get `linkFields: {}`.

- [ ] **Step 4: Run the test**

```
npx vitest run src/app/inline-ai-edit/entity-descriptor.test.ts > /tmp/t3b.log 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both EXIT=0. If `checked` is not 8, the count in the test is the
truth to re-derive — 3 raid + 3 change + 1 milestone + 1 resource.

- [ ] **Step 5: Commit**

```bash
git add src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/entity-descriptor.test.ts
git commit -m "feat(inline-ai-edit): declare the relationship and FK inputs the preview was blind to"
```

---

### Task 4: id→title resolution

**Files:**
- Create: `src/app/inline-ai-edit/link-titles.ts`
- Test: `src/app/inline-ai-edit/link-titles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { resolveLinkTitles, UNKNOWN_ID_MARKER } from "./link-titles";

const WS = { tasks: [{ id: 1, taskName: "Draft brief" }, { id: 2, taskName: "Ship" }] } as unknown as Workspace;
const LINK = { wsKey: "tasks" as const, kind: "list" as const, titleOf: (r: Record<string, unknown>) => String(r.taskName), sanitize: (v: unknown) => (Array.isArray(v) ? v.map(Number) : []) };

describe("resolveLinkTitles", () => {
  it("renders titles in the order given", () => {
    expect(resolveLinkTitles([2, 1], LINK, WS)).toBe("Ship, Draft brief");
  });

  it("marks an id with no row rather than dropping it", () => {
    // Dropping would launder a real problem: these paths store dangling ids and
    // nothing prunes them. A silent omission would read as "this link is gone".
    expect(resolveLinkTitles([1, 99], LINK, WS)).toBe(`Draft brief, ${UNKNOWN_ID_MARKER}99`);
  });

  it("renders an empty list as the empty string, so the card shows an em-dash", () => {
    expect(resolveLinkTitles([], LINK, WS)).toBe("");
  });

  it("falls back to the id when the row has a blank title", () => {
    const ws = { tasks: [{ id: 1, taskName: "   " }] } as unknown as Workspace;
    expect(resolveLinkTitles([1], LINK, ws)).toBe(`${UNKNOWN_ID_MARKER}1`);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run src/app/inline-ai-edit/link-titles.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { Workspace } from "../workspace";
import type { LinkField } from "./entity-descriptor";

/** Prefix for an id whose row does not exist, or whose title is blank. */
export const UNKNOWN_ID_MARKER = "#";

/** Resolve an id list to a readable, comma-joined title list.
 *
 *  ★★ A dangling id is MARKED, never dropped. `sanitizeIdList` keeps any
 *   positive integer and nothing prunes against the live rows, so dangling ids
 *   genuinely exist in stored data. Omitting one would make a preview that is
 *   missing a link look identical to a preview of a link being removed.
 *
 *  ★ Linear `.find` per id, matching `liveRowTitle`. That is O(rows x ids); the
 *   lists here are short and the alternative — a memoised map on
 *   `WorkspaceProvider` — re-renders every direct consumer on any workspace
 *   change, which is a documented landmine. Measure before changing this. */
export function resolveLinkTitles(ids: readonly number[], link: LinkField, ws: Workspace): string {
  const rows = ws[link.wsKey] as unknown;
  const list = Array.isArray(rows) ? (rows as ReadonlyArray<Record<string, unknown>>) : [];
  return ids
    .map((id) => {
      const row = list.find((r) => Number(r.id) === id);
      const title = row ? link.titleOf(row) : "";
      return typeof title === "string" && title.trim() !== "" ? title : `${UNKNOWN_ID_MARKER}${id}`;
    })
    .join(", ");
}
```

- [ ] **Step 4: Run the test**

```
npx vitest run src/app/inline-ai-edit/link-titles.test.ts > /tmp/t4b.log 2>&1; echo "EXIT=$?"
```

Expected: EXIT=0, 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/inline-ai-edit/link-titles.ts src/app/inline-ai-edit/link-titles.test.ts
git commit -m "feat(inline-ai-edit): resolve link ids to titles, marking dangling ids"
```

---

### Task 4b: Gate the success toast on work actually done

**Files:**
- Modify: `src/app/use-inline-entity-edit.ts`
- Test: `src/app/use-inline-entity-edit.test.tsx`

★★★ ADDED AFTER THE TASK-1 REVIEW, AND IT MUST LAND BEFORE TASK 5. Measured,
not reasoned: `apply()` computes `let applied = 0`, runs three branches that can
all be skipped, then calls `showToast("info", …inlineAiEditApplied…)`
UNCONDITIONALLY — `applied` is read only inside the `catch`. Today that is
unreachable, because `isEmptyPlan` already counts `links` and nothing populates
`links`. **Task 5 is what arms it:** a links-only plan clears the `isEmptyPlan`
guard, falls through all three branches with `applied === 0`, and reports
success for a write that never happened.

This is worth fixing on its own terms rather than as part of Task 5 — the gate
protects every future bucket added to `EditPlan`, not just this one.

- [ ] **Step 1: Write the failing test**

```tsx
it("does not claim success when no branch wrote anything", async () => {
  // A plan can be non-empty (isEmptyPlan counts every bucket) while every
  // APPLY branch skips it. Reporting "applied" there is a false success.
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const toasts: Array<{ kind: string; msg: string }> = [];
  await applyPlanWith(recordingDispatcher(calls), {
    updates: [], creates: [], deletes: [], rejected: [],
    links: [{ field: "linkedTaskIds", before: "Draft brief", after: "Ship", rawIds: [2] }],
  }, { onToast: (kind, msg) => toasts.push({ kind, msg }) });
  expect(calls).toHaveLength(0);
  expect(toasts.filter((t) => t.kind === "info")).toHaveLength(0);
});
```

★ `applyPlanWith` / `recordingDispatcher` are the harness this file already
uses, or the one Task 6 needs. If they do not exist yet, build them HERE and
Task 6 reuses them. Read the existing test file first and follow its harness
style rather than inventing a second one.

- [ ] **Step 2: Run it and watch it fail** — expected: an `info` toast fires with
  zero dispatcher calls.

- [ ] **Step 3: Gate the toast**

```ts
      if (applied > 0) {
        deps.showToast("info", t(deps.lang, "inlineAiEditApplied", d.titleOf(activeItem)));
      }
      cancel();
```

★ Keep `cancel()` OUTSIDE the guard — closing the popover is correct either
way; only the success CLAIM is conditional.

- [ ] **Step 4: Green, then typecheck**

```
npx vitest run src/app/use-inline-entity-edit.test.tsx > <scratchpad>/t4b.log 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/use-inline-entity-edit.ts src/app/use-inline-entity-edit.test.tsx \
  -m "fix(inline-ai-edit): do not report success when no apply branch ran"
```

---

### Task 5: Emit link diffs — and apply them

**Files:**
- Modify: `src/app/inline-ai-edit/plan.ts`
- Modify: `src/app/use-inline-entity-edit.ts`
- Test: `src/app/inline-ai-edit/plan.test.ts`
- Test: `src/app/use-inline-entity-edit.test.tsx`

★★★ SCOPE CHANGED AFTER THE TASK-1 REVIEW — the emission and the apply MUST
land in one commit. The measured reason: the inline popover is sent the FULL
`update_*` tool schemas (only the two recall tools are filtered out), so the
model really can answer "link this risk to task 12" with
`update_raid_item({id, linkedTaskIds:[12]})`. Today `diffFields` excludes link
fields, so that input is silently dropped — invisible and unapplied, which is at
least consistent. Emitting without applying converts a silent drop into a blank
preview plus a false "applied" toast, which is strictly worse.

★★ The inline path already disagrees with ITSELF here, and that is why "apply"
is the chosen direction: `plan.creates` forwards raw tool input verbatim to
`runTool`, so an inline `create_raid_item({title, linkedTaskIds:[…]})` writes
those links TODAY, un-previewed. Updates dropping them was the anomaly. (The
create-side DISCLOSURE gap is real and is filed in Task 14 — it is not fixed
here.)

- [ ] **Step 1: Write the failing test**

```ts
describe("link fields", () => {
  const ws = {
    tasks: [{ id: 1, taskName: "Draft brief" }, { id: 2, taskName: "Ship" }, { id: 3, taskName: "Review" }],
    raid: [{ id: 10, title: "Vendor risk", linkedTaskIds: [1, 3] }],
    stakeholders: [], changes: [], milestones: [], resources: [], roles: [],
  } as unknown as Workspace;

  it("shows a replaced link list as before -> after", () => {
    // The write REPLACES: supplying [2] drops tasks 1 and 3. The card must show
    // the removal, because nothing can reconstruct the dropped links afterwards.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 10, linkedTaskIds: [2] } }],
      { descriptor: INLINE_DESCRIPTORS.raid, item: ws.raid[0], ws },
    );
    expect(plan.links).toEqual([{ field: "linkedTaskIds", before: "Draft brief, Review", after: "Ship", rawIds: [2] }]);
    expect(plan.updates).toEqual([]);
  });

  it("emits nothing when the resolved lists match", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 10, linkedTaskIds: [1, 3] } }],
      { descriptor: INLINE_DESCRIPTORS.raid, item: ws.raid[0], ws },
    );
    expect(plan.links).toEqual([]);
  });

  it("uses the milestone's OWN id rule, which drops a delimited string", () => {
    // raid/change would parse "1;2" into two links; a milestone stores []. The
    // preview must show what THIS writer does, not what the sibling does.
    const mws = { tasks: ws.tasks, milestones: [{ id: 5, name: "GA", linkedTaskIds: [1] }] } as unknown as Workspace;
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_milestone", input: { id: 5, linkedTaskIds: "1;2" } }],
      { descriptor: INLINE_DESCRIPTORS.milestone, item: mws.milestones[0], ws: mws },
    );
    expect(plan.links).toEqual([{ field: "linkedTaskIds", before: "Draft brief", after: "", rawIds: [] }]);
  });

  it("carries the sanitized ids the writer will store, not the titles", () => {
    // ★★★ THE WHOLE POINT OF `rawIds`. The card renders titles; the rebuild
    //  path applies THIS array. If the two ever came from different
    //  computations the preview would stop being a promise about the write.
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_raid_item", input: { id: 10, linkedTaskIds: [2, 3] } }],
      { descriptor: INLINE_DESCRIPTORS.raid, item: ws.raid[0], ws },
    );
    expect(plan.links[0].rawIds).toEqual([2, 3]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run src/app/inline-ai-edit/plan.test.ts -t "link fields" > /tmp/t5.log 2>&1; echo "EXIT=$?"
```

Expected: FAIL — `plan.links` is `[]`.

- [ ] **Step 3: Emit them**

In `describeEntityCalls`, immediately AFTER the `for (const f of d.diffFields)`
loop and BEFORE the induced-enum-reset pass:

```ts
      // Relationship and FK inputs. Deliberately a SEPARATE bucket from
      // `updates` — see the `LinkDiff` docstring for the wipe this prevents.
      for (const [f, link] of Object.entries(d.linkFields)) {
        if (!(f in input)) continue;
        // ONE sanitize per side, reused for both the rendered title and the
        // applied value — so the card cannot promise something the patch does
        // not carry. `link.sanitize` is the WRITER'S own rule for this field.
        const beforeIds = link.sanitize(item[f]);
        const afterIds = link.sanitize(input[f]);
        const before = resolveLinkTitles(beforeIds, link, ws);
        const after = resolveLinkTitles(afterIds, link, ws);
        if (before === after) continue;
        plan.links.push({ field: f, before, after, rawIds: afterIds });
      }
```

Import at the top of the file:

```ts
import { resolveLinkTitles } from "./link-titles";
```

- [ ] **Step 3b: Apply them — the half that makes the preview a promise**

Write the failing test FIRST, in `src/app/use-inline-entity-edit.test.tsx`:

```tsx
it("writes the sanitized link ids the preview showed", async () => {
  // The card said "Draft brief, Review -> Ship". The patch must carry [2].
  // Asserting on the DISPATCHER input, never on the plan: the plan being right
  // is what the other tests cover; this one covers the handoff.
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  await applyPlanWith(recordingDispatcher(calls), {
    updates: [], creates: [], deletes: [], rejected: [],
    links: [{ field: "linkedTaskIds", before: "Draft brief, Review", after: "Ship", rawIds: [2] }],
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].input.linkedTaskIds).toEqual([2]);
});
```

Then, in `use-inline-entity-edit.ts`, extend the patch build. ★★★ Apply
`rawIds` and NEVER `after`: `after` is a rendered title string, and that is the
exact value whose arrival in `sanitizeIdList` wipes the row.

```ts
      for (const l of plan.links) {
        patch[l.field] = l.rawIds;
      }
```

★ Place it so a links-only plan still reaches the dispatcher — the existing
`if (plan.updates.length > 0)` branch must no longer be the only thing that can
build and send a patch. Read the branch structure and restructure the condition
to "there is anything to write", rather than nesting the link loop inside a
guard that a links-only plan fails. Getting this wrong reproduces the exact
false-success Task 4b just fixed, and the Task 4b test is what will catch you.

- [ ] **Step 4: Run the tests**

```
npx vitest run src/app/inline-ai-edit/plan.test.ts src/app/use-inline-entity-edit.test.tsx > <scratchpad>/t5b.log 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both EXIT=0, and the Task 4b "does not claim success" test still green.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts \
  src/app/use-inline-entity-edit.ts src/app/use-inline-entity-edit.test.tsx \
  -m "feat(inline-ai-edit): preview relationship changes, and apply them"
```

---

### Task 6: Pin the rebuild path against the wipe

**Files:**
- Test: `src/app/use-inline-entity-edit.test.tsx`

This task adds NO production code. It pins the invariant that makes Task 5 safe.

- [ ] **Step 1: Write the test**

★★★ THIS TEST WAS REWRITTEN AFTER THE TASK-1 REVIEW. It originally asserted
that `linkedTaskIds` NEVER reaches the patch. That was correct while links were
unapplied; once Task 5 applies them it is exactly backwards, and a test written
to the old wording would have to be deleted — which is how a guard gets lost.
The invariant was never "no link field in the patch". It is: **a link field's
value in the patch is the sanitized ID ARRAY, never the rendered TITLE STRING.**

```ts
it("writes link ids, never the rendered title string", async () => {
  // ★★★ THE REGRESSION THIS EXISTS FOR: a LinkDiff landing in `plan.updates`.
  //  The rebuild loop would then write `diff.raw ?? diff.after` — the TITLE
  //  STRING — into `linkedTaskIds`. `sanitizeIdList` splits a string on [.;],
  //  finds no integers, and stores [] — wiping every link on the row.
  //  Assert on the patch the dispatcher RECEIVES, not on the plan: the plan
  //  being right is exactly what this is guarding against assuming.
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  await applyPlanWith(recordingDispatcher(calls), {
    updates: [{ field: "title", before: "a", after: "b", raw: "b" }],
    creates: [], deletes: [], rejected: [],
    links: [{ field: "linkedTaskIds", before: "Draft brief", after: "Ship", rawIds: [2] }],
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].input.linkedTaskIds).toEqual([2]);
  expect(typeof calls[0].input.linkedTaskIds).not.toBe("string");
  expect(calls[0].input.title).toBe("b");
});
```

- [ ] **Step 2: Run it**

```
npx vitest run src/app/use-inline-entity-edit.test.tsx -t "writes link ids" > <scratchpad>/t6.log 2>&1; echo "EXIT=$?"
```

Expected: PASS immediately — Task 5 applies `rawIds`, and the rebuild loop reads
`updates` only, so nothing can route a title string into the patch. This is a
characterization pin, not a red-green cycle.

- [ ] **Step 3: Prove the test can fail**

Temporarily move the link diff into `updates` in the test fixture only — this
simulates the exact defect, since a `LinkDiff` is assignable to `FieldDiff`:

```ts
    updates: [{ field: "title", before: "a", after: "b", raw: "b" },
              { field: "linkedTaskIds", before: "Draft brief", after: "Ship" }],
    links: [],
```

Re-run. Expected: FAIL — `input.linkedTaskIds` is now the string `"Ship"`, so
both the `toEqual([2])` and the `not.toBe("string")` assertions go red. That
second assertion is the one that names the defect; keep it even though the
first would catch this fixture, because a future `raw` on the diff would satisfy
`toEqual` shapes while still being a string.

**Revert the fixture immediately** and re-run to green — a mutant left in the
tree is worse than no test. The revert must be an inverse anchored edit
(`git checkout -- <file>` is DENY-BLOCKED in this repo); assert the anchor is
unique in BOTH directions, and finish on `git diff --stat` showing only the
intended file.

- [ ] **Step 4: Commit**

```bash
git add src/app/use-inline-entity-edit.test.tsx
git commit -m "test(inline-ai-edit): pin that link diffs never reach the rebuilt write patch"
```

---

### Task 7: The resource name pair (§384)

**Files:**
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts`
- Modify: `src/app/inline-ai-edit/plan.ts`
- Test: `src/app/inline-ai-edit/plan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("previews a mononym rename as the surname being cleared, not rejected", () => {
  // §384. The writer's gate is JOINT (`!firstName && !lastName`), so with a
  // first name present the row is accepted and the surname is stored as "".
  // The two REPLAYING consumers resend the original call, so a preview that
  // calls this rejected is a lie that precedes silent data loss.
  const ws = { resources: [{ id: 4, firstName: "Cher", lastName: "Bono" }] } as unknown as Workspace;
  const plan = describeEntityCalls(
    [{ type: "tool_use", name: "update_resource", input: { id: 4, name: "Cher" } }],
    { descriptor: INLINE_DESCRIPTORS.resource, item: ws.resources[0], ws },
  );
  expect(plan.rejected).toEqual([]);
  expect(plan.updates).toEqual([{ field: "lastName", before: "Bono", after: "", raw: "" }]);
});

it("still rejects emptying BOTH halves of the name", () => {
  // The joint rule is "at least one non-empty" — the writer returns null and the
  // dispatcher throws, so rejecting here is truthful.
  const ws = { resources: [{ id: 4, firstName: "Cher", lastName: "Bono" }] } as unknown as Workspace;
  const plan = describeEntityCalls(
    [{ type: "tool_use", name: "update_resource", input: { id: 4, firstName: "", lastName: "" } }],
    { descriptor: INLINE_DESCRIPTORS.resource, item: ws.resources[0], ws },
  );
  expect(plan.updates).toEqual([]);
  expect(plan.rejected.map((r) => r.detail)).toContain("firstName+lastName=empty");
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run src/app/inline-ai-edit/plan.test.ts -t "mononym" > /tmp/t7.log 2>&1; echo "EXIT=$?"
```

Expected: FAIL — the first case currently rejects `lastName=empty`.

- [ ] **Step 3: Add the joint rule to the descriptor**

In `EntityDescriptor`:

```ts
/** Groups of fields the WRITER requires only JOINTLY — at least one member
 *  non-empty. `sanitizeResource`'s gate is `if (!firstName && !lastName) return
 *  null`, a whole-row OR evaluated after the merge, where `requiredNonEmpty` is
 *  a per-field partition. Judging a member alone is §384: the preview called a
 *  mononym rename's `lastName` rejected while the write accepted the row and
 *  stored "". A member of a group is EXEMPT from `requiredNonEmpty`. */
requiredNonEmptyGroups: ReadonlyArray<ReadonlySet<string>>;
```

For `resource`, drop the two fields from the per-field set and declare the group:

```ts
    requiredNonEmpty: new Set<string>([]),
    requiredNonEmptyGroups: [new Set(["firstName", "lastName"])],
```

Every other descriptor gets `requiredNonEmptyGroups: []`.

- [ ] **Step 4: Apply the rule in the loop**

In `describeEntityCalls`, replace the `requiredNonEmpty` guard with:

```ts
        if (d.requiredNonEmpty.has(f) && after === "") { bad(`${f}=empty`); continue; }
        const group = d.requiredNonEmptyGroups.find((g) => g.has(f));
        if (group && after === "") {
          // Emptying this member is legal while some OTHER member stays
          // non-empty — which is what the writer checks, on the MERGED row.
          const members = [...group];
          const survives = members.some((m) => {
            const val = m === f ? after : (m in input ? str(input[m]) : str(item[m]));
            return val.trim() !== "";
          });
          if (!survives) { bad(`${members.join("+")}=empty`); continue; }
        }
```

- [ ] **Step 5: Run the tests**

```
npx vitest run src/app/inline-ai-edit/ > /tmp/t7b.log 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts
git commit -m "fix(inline-ai-edit): preview a mononym rename as the clearing it is (384)"
```

---

### Task 8: `resource.emails` (§383) and `task.lastUpdateDate`

**Files:**
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts`
- Test: `src/app/inline-ai-edit/plan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("previews the extra email list as the sanitizer would store it", () => {
  // §383's exclusion rationale — "deduping and capping would break the
  // guarantee" — predates `fieldSanitizers`. Calling the real sanitizer makes
  // the preview truthful instead of absent.
  const ws = { resources: [{ id: 4, firstName: "A", lastName: "B", email: "a@x.com", emails: ["b@x.com"] }] } as unknown as Workspace;
  const plan = describeEntityCalls(
    [{ type: "tool_use", name: "update_resource", input: { id: 4, emails: ["b@x.com", "b@x.com", "a@x.com"] } }],
    { descriptor: INLINE_DESCRIPTORS.resource, item: ws.resources[0], ws },
  );
  // Deduped, and the primary address is dropped from the extras.
  expect(plan.updates).toEqual([]);
});

it("previews an explicit lastUpdateDate change", () => {
  // Never stamped implicitly by any writer, so it is signal rather than noise.
  const ws = { tasks: [{ id: 1, taskName: "T", dueDate: "2026-01-01", lastUpdateDate: "2026-01-01" }] } as unknown as Workspace;
  const plan = describeEntityCalls(
    [{ type: "tool_use", name: "update_task", input: { id: 1, lastUpdateDate: "2026-02-02" } }],
    { descriptor: INLINE_DESCRIPTORS.task, item: ws.tasks[0], ws },
  );
  expect(plan.updates).toEqual([{ field: "lastUpdateDate", before: "2026-01-01", after: "2026-02-02", raw: "2026-02-02" }]);
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run src/app/inline-ai-edit/plan.test.ts -t "email list|lastUpdateDate" > /tmp/t8.log 2>&1; echo "EXIT=$?"
```

Expected: FAIL — neither field is in `diffFields`.

- [ ] **Step 3: Add both**

`resource`: append `"emails"` to `diffFields`, and add to `fieldSanitizers`:

```ts
      emails: (v) => sanitizeEmailList(v, "").join(", "),
```

★ The second argument is the primary address to exclude. Pass the item's own
`email` at the call site is NOT possible from a per-field sanitizer, so the
descriptor entry uses `""` and the dedupe-against-primary is left to apply — a
KNOWN narrowing, recorded in the follow-up filed in Task 13 rather than papered
over.

`task`: append `"lastUpdateDate"` to `diffFields` and to `dateFields`.

- [ ] **Step 4: Run the tests**

```
npx vitest run src/app/inline-ai-edit/ > /tmp/t8b.log 2>&1; echo "EXIT=$?"
```

Expected: EXIT=0. The parity differential now covers both fields automatically.

- [ ] **Step 5: Commit**

```bash
git add src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/plan.test.ts
git commit -m "feat(inline-ai-edit): preview the extra email list and an explicit lastUpdateDate"
```

---

### Task 9: Render links and rejections

**Files:**
- Modify: `src/app/chat-proposal-block.tsx`
- Modify: `src/app/insights/recommendation-review-modal.tsx`
- Modify: `src/app/inline-ai-edit-popover.tsx`
- Test: `src/app/chat-proposal-block.test.tsx`
- Test: `src/app/inline-ai-edit-popover.test.tsx`

★★★ THREE SURFACES, NOT TWO — corrected after the Task-1 review measured them.
All three render `updates`/`creates`/`deletes` and nothing else
(`inline-ai-edit-popover.tsx`, `chat-proposal-block.tsx`,
`insights/recommendation-review-modal.tsx`). Miss one and that consumer shows a
blank change list for a link write. The popover is the one the original plan
omitted, and after Task 5 it is the surface that APPLIES links — so a missing
renderer there is a silent destructive write, not merely an under-disclosure.

★★ `rejected` is NOT uniformly unrendered, and an earlier revision of this plan
said it was: `recommendation-review-modal.tsx` already renders it as a bare
COUNT. It is `chat-proposal-block.tsx` that renders it nowhere. So this task
ADDS a renderer on the chat card and UPGRADES a count to a field list on the
modal — two different changes, not one pattern applied twice.

- [ ] **Step 1: Write the failing test**

```ts
it("renders a link change and a rejected field", () => {
  // Before this, `plan.rejected` had NO renderer on this surface — the only
  // occurrence of the word in the file was a comment. A user approving a plan
  // was never told which fields would not land.
  render(<ChatProposalBlock {...baseProps} rows={[{
    ...baseRow,
    plan: {
      updates: [], creates: [], deletes: [],
      links: [{ field: "linkedTaskIds", before: "Draft brief, Review", after: "Ship", rawIds: [2] }],
      rejected: [{ toolName: "update_raid_item", reason: "bad-input", detail: "targetDate=nope" }],
    },
  }]} />);
  expect(screen.getByText(/Draft brief, Review/)).toBeInTheDocument();
  expect(screen.getByText(/Ship/)).toBeInTheDocument();
  expect(screen.getByText(/targetDate=nope/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run src/app/chat-proposal-block.test.tsx -t "renders a link change" > /tmp/t9.log 2>&1; echo "EXIT=$?"
```

Expected: FAIL — neither is rendered.

- [ ] **Step 3: Render them**

In `PlanDetail`, after the `plan.updates` map. ★ The field name is rendered RAW
here, matching what `plan.updates` already does — Task 10 replaces both with
`fieldLabel(...)` in one pass. Do not reach forward for it: `fieldLabel` does
not exist yet at this task, and neither does the `entity` binding it needs.

```tsx
      {plan.links.map((l, i) => (
        <li key={`l${i}-${l.field}`}>
          <span className="font-medium text-foreground">{l.field}</span>:{" "}
          {l.before || "—"} → {l.after || "—"}
        </li>
      ))}
      {plan.rejected.map((r, i) => (
        <li key={`r${i}`} className="text-ui-pink-strong">
          {t(lang, "inlineAiEditRejected", r.detail)}
        </li>
      ))}
```

In `recommendation-review-modal.tsx`, replace the bare count with the field
list, keeping the count string as the fallback when no detail is available:

```tsx
        {plan.rejected.length > 0 && (
          <p className="mb-3 text-xs text-muted-foreground">
            {t(lang, "insightRecommendationSkippedFields", plan.rejected.map((r) => r.detail).join(", "))}
          </p>
        )}
```

Also add the LINK list to that modal — the count upgrade above covers
`rejected` only, and this consumer replays the original input, so it really does
write these links:

```tsx
        {plan.links.map((l, i) => (
          <li key={`l${i}-${l.field}`}>
            <span className="font-medium text-foreground">{l.field}</span>:{" "}
            {l.before || "—"} → {l.after || "—"}
          </li>
        ))}
```

And in `inline-ai-edit-popover.tsx`, beside its existing updates list — same
markup, same raw field name (Task 10 relabels all three surfaces in one pass):

```tsx
        {plan.links.map((l, i) => (
          <li key={`l${i}-${l.field}`}>
            <span className="font-medium text-foreground">{l.field}</span>:{" "}
            {l.before || "—"} → {l.after || "—"}
          </li>
        ))}
```

★ Read each file's existing list markup first and MATCH it — the three surfaces
do not share a component, and their `<li>` styling differs. Do not introduce a
shared primitive here; that is a bigger change than this task, and the repo's
rule is to use an existing primitive or ASK, never to hand-roll a fourth
variant.

- [ ] **Step 4: Add the two i18n keys**

`src/app/i18n.ts`:

```ts
  inlineAiEditRejected: "Not applied: {0}",
  insightRecommendationSkippedFields: "Skipped: {0}",
```

`src/app/i18n.de.ts` — patch with a `.mjs` script, NOT the Edit tool:

```js
  inlineAiEditRejected: "Nicht übernommen: {0}",
  insightRecommendationSkippedFields: "Übersprungen: {0}",
```

- [ ] **Step 5: Verify the DE file survived**

```
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log('BARE_LF',(s.match(/(?<!\r)\n/g)||[]).length,'ESCAPES',(s.match(/\\\\u[0-9a-fA-F]{4}/g)||[]).length,'REPLACEMENT',(s.match(/�/g)||[]).length)"
git ls-files --eol src/app/i18n.de.ts
```

Expected: `BARE_LF 0 ESCAPES 0 REPLACEMENT 0` and `i/lf w/crlf`.

- [ ] **Step 6: Run and commit**

```
npx vitest run src/app/chat-proposal-block.test.tsx src/app/i18n.test.ts > /tmp/t9b.log 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

```bash
git add src/app/chat-proposal-block.tsx src/app/insights/recommendation-review-modal.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/chat-proposal-block.test.tsx
git commit -m "feat(chat): render link changes and rejected fields on the approval card"
```

---

### Task 10: Readable field labels

**Files:**
- Create: `src/app/inline-ai-edit/field-labels.ts`
- Test: `src/app/inline-ai-edit/field-labels.test.ts`
- Modify: `src/app/chat-proposal-block.tsx`, `src/app/inline-ai-edit-popover.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import { fieldLabel, FIELD_LABEL_KEY } from "./field-labels";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";

describe("fieldLabel", () => {
  it("covers every previewable field of every entity", () => {
    // A missing entry is not a crash — it falls back to the raw property name —
    // so only an enumeration catches it. 58 diffFields + 8 links + emails +
    // lastUpdateDate; re-derive rather than trusting this number if it fails.
    let checked = 0;
    for (const d of Object.values(INLINE_DESCRIPTORS)) {
      for (const f of [...d.diffFields, ...Object.keys(d.linkFields)]) {
        expect(FIELD_LABEL_KEY[`${d.entity}.${f}`], `${d.entity}.${f}`).toBeDefined();
        checked += 1;
      }
    }
    expect(checked).toBe(68);
  });

  it("falls back to the raw field name, never to blank", () => {
    // A blank label on an approval card is strictly worse than a property name.
    expect(fieldLabel("en-US", "task", "somethingNew")).toBe("somethingNew");
  });

  it("translates a known field", () => {
    expect(fieldLabel("en-US", "task", "taskName")).toBe("Task name");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run src/app/inline-ai-edit/field-labels.test.ts > /tmp/t10.log 2>&1; echo "EXIT=$?"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { t, type Lang } from "../i18n";
import type { I18nKey } from "../i18n";

/** `${entity}.${field}` → the i18n key naming that field to a user.
 *
 *  ★★ ENTITY-QUALIFIED because the same field name means different things:
 *   `impact` is a 1-5 scale on a RAID item and free text on a change; `title`
 *   is a job title on a resource and a summary on a change.
 *
 *  ★ Most entries REUSE a key the forms already ship in EN and DE. Only the
 *   genuinely new names were minted — a label map is not a reason to duplicate
 *   130 strings that already exist. */
export const FIELD_LABEL_KEY: Record<string, I18nKey> = {
  // task (10 diffFields + lastUpdateDate + 0 links)
  "task.taskName": "taskName", "task.assignee": "assignee", "task.assigneeEmail": "assigneeEmail",
  "task.dueDate": "dueDate", "task.status": "status", "task.priority": "priority",
  "task.description": "description", "task.blockers": "blockers", "task.group": "group",
  "task.labels": "labels", "task.lastUpdateDate": "lastUpdateDate",
  // raid (13 diffFields + 3 links)
  "raid.category": "category", "raid.title": "title", "raid.status": "status",
  "raid.description": "description", "raid.mitigation": "mitigation", "raid.owner": "owner",
  "raid.ownerEmail": "ownerEmail", "raid.severity": "severity", "raid.probability": "probability",
  "raid.impact": "impact", "raid.raisedDate": "raisedDate", "raid.targetDate": "targetDate",
  "raid.closedDate": "closedDate",
  "raid.linkedTaskIds": "linkedTasks", "raid.causedByRaidIds": "causedByRaid",
  "raid.stakeholderIds": "stakeholders",
  // change (13 diffFields + 3 links)
  "change.title": "title", "change.description": "description", "change.type": "type",
  "change.status": "status", "change.impact": "impact",
  "change.impactDescription": "impactDescription",
  "change.scheduleImpactDays": "scheduleImpactDays", "change.costImpact": "costImpact",
  "change.requestedBy": "requestedBy", "change.raisedDate": "raisedDate",
  "change.decisionBy": "decisionBy", "change.decisionDate": "decisionDate",
  "change.resolutionNotes": "resolutionNotes",
  "change.linkedTaskIds": "linkedTasks", "change.linkedRaidIds": "linkedRaid",
  "change.stakeholderIds": "stakeholders",
  // milestone (4 diffFields + 1 link)
  "milestone.name": "name", "milestone.date": "date", "milestone.description": "description",
  "milestone.achievedDate": "achievedDate", "milestone.linkedTaskIds": "linkedTasks",
  // stakeholder (8 diffFields, no links)
  "stakeholder.name": "name", "stakeholder.organization": "organization",
  "stakeholder.title": "title", "stakeholder.email": "email",
  "stakeholder.category": "category", "stakeholder.influence": "influence",
  "stakeholder.interest": "interest", "stakeholder.notes": "notes",
  // resource (10 diffFields + emails + 1 link)
  "resource.firstName": "firstName", "resource.lastName": "lastName",
  "resource.title": "title", "resource.email": "email", "resource.emails": "additionalEmails",
  "resource.department": "department", "resource.company": "company",
  "resource.location": "location", "resource.businessPhone": "businessPhone",
  "resource.isExternal": "externalResource", "resource.notes": "notes",
  "resource.roleId": "role",
};
```

★ That is 68 entries: 58 existing `diffFields` + `task.lastUpdateDate` +
`resource.emails` + the 8 link fields. Most right-hand keys ALREADY EXIST in
`i18n.ts` — verify each before minting:

```
for k in taskName assignee dueDate status priority labels category title severity \
         probability impact owner mitigation name email notes organization influence \
         interest department company location firstName lastName type; do \
  printf "%s=%s\n" "$k" "$(grep -c "^  $k:" src/app/i18n.ts)"; done
```

Any key printing `0` must be minted in BOTH `i18n.ts` and `i18n.de.ts`. The
likely gaps are the ones this slice invents: `linkedTasks`, `causedByRaid`,
`linkedRaid`, `stakeholders`, `additionalEmails`, `role`, `externalResource`,
`lastUpdateDate`. Reuse anything that already exists rather than minting a
near-duplicate.

/** The user-facing name of a previewable field, falling back to the raw
 *  property name — never to blank. */
export function fieldLabel(lang: Lang, entity: string, field: string): string {
  const key = FIELD_LABEL_KEY[`${entity}.${field}`];
  return key ? t(lang, key) : field;
}
```

★ Work through the failures the enumeration test reports: for each missing pair,
`grep -n "^  <fieldname>:" src/app/i18n.ts` first. If a key exists, reuse it. If
not, mint one in BOTH `i18n.ts` and `i18n.de.ts` (the latter via a `.mjs`
script), then re-run.

- [ ] **Step 4: Thread the entity through the renderers**

`PlanDetail` needs the entity to qualify the key. `ProposalCardRow` already
carries the tool name; resolve it with the existing `TOOL_ENTITY` map rather
than adding a prop:

```tsx
  const entity = TOOL_ENTITY[row.call.name] ?? "task";
```

Replace `{d.field}` with `{fieldLabel(lang, entity, d.field)}` in BOTH
`chat-proposal-block.tsx` and `inline-ai-edit-popover.tsx`.

- [ ] **Step 5: Run and commit**

```
npx vitest run src/app/inline-ai-edit/ src/app/chat-proposal-block.test.tsx src/app/i18n.test.ts > /tmp/t10b.log 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

```bash
git add src/app/inline-ai-edit/field-labels.ts src/app/inline-ai-edit/field-labels.test.ts src/app/chat-proposal-block.tsx src/app/inline-ai-edit-popover.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(inline-ai-edit): show readable field names on the approval card"
```

---

### Task 11: The enumeration gate

**Files:**
- Create: `src/app/inline-ai-edit/tool-input-coverage.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { TOOL_DEFS } from "../chat-tool-defs";

/** Inputs a write tool accepts that the preview deliberately does NOT show.
 *  Every entry needs a REASON, and the reason has to be about the FIELD, not
 *  about the effort of showing it. */
const DECLARED_EXCLUSIONS: Record<string, string> = {
  // Every update tool carries these two from the shared spreads: `id` names the
  // row rather than changing it, and `expectedToken` is the concurrency token.
  "update_task.id": "the row's identity, not a change to it",
  "update_task.expectedToken": "concurrency token, not user data",
  "update_raid_item.id": "the row's identity, not a change to it",
  "update_raid_item.expectedToken": "concurrency token, not user data",
  "update_change.id": "the row's identity, not a change to it",
  "update_change.expectedToken": "concurrency token, not user data",
  "update_milestone.id": "the row's identity, not a change to it",
  "update_milestone.expectedToken": "concurrency token, not user data",
  "update_stakeholder.id": "the row's identity, not a change to it",
  "update_stakeholder.expectedToken": "concurrency token, not user data",
  "update_resource.id": "the row's identity, not a change to it",
  "update_resource.expectedToken": "concurrency token, not user data",
  // The one real exclusion: a write ALIAS, not a stored field. It is projected
  // onto firstName/lastName before the diff loop runs, so both halves ARE shown.
  "update_resource.name": "a write ALIAS projected onto firstName/lastName before diffing",
};

describe("every declared write-tool input is previewable or excluded with a reason", () => {
  it("has no undeclared input", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const def of TOOL_DEFS) {
      if (!def.name.startsWith("update_")) continue;
      const entity = Object.values(INLINE_DESCRIPTORS).find((d) => d.updateTool === def.name);
      if (!entity) continue;
      const shown = new Set([...entity.diffFields, ...Object.keys(entity.linkFields)]);
      for (const field of Object.keys(def.input_schema.properties)) {
        checked += 1;
        if (shown.has(field)) continue;
        if (DECLARED_EXCLUSIONS[`${def.name}.${field}`]) continue;
        missing.push(`${def.name}.${field}`);
      }
    }
    // ★ Vacuity guard: a scan that resolves nothing passes everything. This is
    // the repo's recurring gate failure, so assert the corpus is non-empty.
    expect(checked).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });

  it("declares no exclusion for a field that is actually shown", () => {
    // A stale exclusion is how the set rots into a rubber stamp.
    for (const key of Object.keys(DECLARED_EXCLUSIONS)) {
      const [tool, field] = key.split(".");
      const entity = Object.values(INLINE_DESCRIPTORS).find((d) => d.updateTool === tool);
      if (!entity) continue;
      const shown = new Set([...entity.diffFields, ...Object.keys(entity.linkFields)]);
      expect(shown.has(field), `${key} is shown; drop the exclusion`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and fill the exclusion set**

```
npx vitest run src/app/inline-ai-edit/tool-input-coverage.test.ts > /tmp/t11.log 2>&1; echo "EXIT=$?"
grep -A 20 "missing" /tmp/t11.log
```

Every name it reports is either a field to add to `diffFields`/`linkFields`, or
an exclusion with a written reason. **Do not add an exclusion to make the test
pass** — that defeats the only thing it checks.

- [ ] **Step 3: Prove the gate bites**

Temporarily delete `"lastUpdateDate"` from task's `diffFields`. Re-run.
Expected: FAIL naming `update_task.lastUpdateDate`. Restore it, re-run to green,
and confirm `git diff --stat` shows only the intended files.

- [ ] **Step 4: Commit**

```bash
git add src/app/inline-ai-edit/tool-input-coverage.test.ts
git commit -m "test(inline-ai-edit): fail when a write-tool input is neither previewable nor excluded"
```

---

### Task 12: Correct the parity differential

**Files:**
- Modify: `src/app/inline-ai-edit/plan.sanitizer-parity.test.ts`

- [ ] **Step 1: Remove the false assumption**

The sweep currently does:

```js
if (preview.rejected) {
  out.previewOnlyRejects += 1;
  continue;                            // "the safe direction — nothing is written"
}
```

That comment is true for the REBUILDING consumer and false for both REPLAYING
consumers, which resend the original call and never consult the preview.
Replace it with:

```js
if (preview.rejected) {
  // ★★★ NOT A SAFE DIRECTION. The two replaying consumers — applyProposal and
  //  confirmInsightRecommendation — resend the original ProposedCall.input, so
  //  a field this preview calls rejected is still written. §384 is exactly this
  //  shape: a mononym rename previewed `lastName` rejected and the write stored
  //  "". Anything landing here is a divergence unless the field is a member of
  //  a requiredNonEmptyGroup, where the joint rule is the writer's own.
  out.previewOnlyRejects += 1;
  if (!inRequiredGroup(entity, field)) {
    out.mismatches.push(`${entity}.${field} @ ${label}: preview REJECTS, apply STORES ${JSON.stringify(stored)}`);
  }
  continue;
}
```

- [ ] **Step 2: Run and triage**

```
npx vitest run src/app/inline-ai-edit/plan.sanitizer-parity.test.ts > /tmp/t12.log 2>&1; echo "EXIT=$?"
grep -c "preview REJECTS, apply STORES" /tmp/t12.log
```

Every reported pair is a real divergence. Fix it in the descriptor if it is one
of this slice's fields; otherwise file it and add it to an enumerated,
reason-carrying exception list in the test — the same discipline `APPLY_ONLY_REJECTS`
already uses.

- [ ] **Step 3: Update the header comment**

The file's own docstring states its exclusions. Add the three limits this work
established, as limits rather than as fixed items:

```js
// ★★★ WHAT THIS SWEEP STILL CANNOT SEE, measured 2026-09-05:
//  (1) it compares preview against the SANITIZER, never against a REPLAY, so a
//      dispatcher-level derivation (updateResource re-deriving splitName) is
//      invisible here — `plan.write-path.test.ts` covers that;
//  (2) it overrides exactly ONE key per probe, so a JOINT guard
//      (`!firstName && !lastName`) is never exercised jointly;
//  (3) it never sets `input.name`, so no write ALIAS is exercised.
```

- [ ] **Step 4: Commit**

```bash
git add src/app/inline-ai-edit/plan.sanitizer-parity.test.ts
git commit -m "test(inline-ai-edit): stop swallowing the preview-rejects-apply-stores direction"
```

---

### Task 13: The write-path differential

**Files:**
- Create: `src/app/inline-ai-edit/plan.write-path.test.ts`

- [ ] **Step 1: Write the test**

```ts
/** Preview against the REAL write path — `runTool` through the dispatcher —
 *  rather than against the sanitizer.
 *
 *  ★★ Deliberately NOT the whole ~450-pair sweep: that needs a workspace fixture
 *   per probe and would be slow and brittle. The class this must catch is
 *   enumerable — the aliases, the joint guards and the relationship arrays. */
const CASES = [
  { name: "mononym rename clears the surname", tool: "update_resource",
    row: { id: 4, firstName: "Cher", lastName: "Bono" }, input: { id: 4, name: "Cher" },
    expectStored: { firstName: "Cher", lastName: "" } },
  { name: "a link list REPLACES", tool: "update_raid_item",
    row: { id: 10, title: "R", linkedTaskIds: [1, 2, 3] }, input: { id: 10, linkedTaskIds: [2] },
    expectStored: { linkedTaskIds: [2] } },
];

describe.each(CASES)("$name", (c) => {
  it("previews exactly what the dispatcher stores", async () => {
    const { plan, stored } = await previewAndWrite(c);
    for (const [field, value] of Object.entries(c.expectStored)) {
      expect(stored[field]).toEqual(value);
      const shown = [...plan.updates, ...plan.links].some((d) => d.field === field);
      const unchanged = JSON.stringify((c.row as Record<string, unknown>)[field]) === JSON.stringify(value);
      // Either the preview disclosed the change, or there was no change.
      expect(shown || unchanged, `${field} changed with no preview line`).toBe(true);
    }
    // And nothing the preview claimed was rejected may appear in the stored row.
    for (const r of plan.rejected) {
      expect(r.detail).not.toMatch(/^lastName=/);
    }
  });
});
```

- [ ] **Step 2: Run, then prove it bites**

```
npx vitest run src/app/inline-ai-edit/plan.write-path.test.ts > /tmp/t13.log 2>&1; echo "EXIT=$?"
```

Expected: PASS after Tasks 5 and 7. Then revert Task 7's joint rule in the
descriptor only (restore `requiredNonEmpty: new Set(["firstName","lastName"])`)
and re-run: expected FAIL on `lastName changed with no preview line`. Restore
and re-run to green; confirm with `git diff --stat`.

- [ ] **Step 3: Commit**

```bash
git add src/app/inline-ai-edit/plan.write-path.test.ts
git commit -m "test(inline-ai-edit): differential against the real write path for aliases, joint guards and links"
```

---

### Task 14: Register and docs

**Files:**
- Modify: `docs/open-followups.md`
- Modify: `docs/AGENTS/ai-assistant.md`

- [ ] **Step 1: Re-derive the next free entry number**

```
git fetch origin
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```

★★ A concurrent branch holds 386-388. Take the max on `origin/main` at THIS
moment and mint above it — never a number quoted in a plan or a message,
including this one.

- [ ] **Step 2: Close §384 and re-open §383**

§384's heading gains `— CLOSED`, with a Status line naming the commit and the
test. §383 is folded in by Task 8: mark it CLOSED too, and record that its
exclusion rationale predated `fieldSanitizers`.

★ Closure takes at least four edit points and recent ones took six: the heading,
the TOC row (which encodes the number twice — the `§NNN` label AND the anchor
slug), any cross-reference in another entry, and any prose in `src/` comments.
GitHub anchor slugs DROP colons rather than hyphenating them.

- [ ] **Step 3: File the four new entries**

1. `update_task` accepts an undeclared `notes` input that `buildPatch` resolves
   into `description`; the preview models no alias, so such a call previews an
   empty plan and overwrites the stored description.
2. `update_resource`'s tool description tells the MODEL that `roleId` "assigns
   the resource's discipline + grade + rates". It sets one FK; those values live
   on `Role` and resolve at read time, and `chat-tools.ts` says the opposite in
   its own doc comment.
3. `sanitizeMilestoneTaskIds` accepts only an array where `sanitizeIdList` also
   parses a delimited string, so `linkedTaskIds: "1;2"` links two tasks on a
   raid or change and yields `[]` on a milestone. It also does not dedupe, which
   inflates the digest's `linkedTasks: N`.
4. The `emails` preview cannot dedupe against the row's own primary address,
   because a `fieldSanitizers` entry receives only the field's value (Task 8).
5. **The inline CREATE path writes link fields with no preview at all.**
   `plan.creates` forwards raw tool input verbatim to `runTool`, and the inline
   scope block explicitly invites `create_raid_item` / `create_task`, so an
   inline create carrying `linkedTaskIds` writes those links today and the card
   shows only the new row's title. This slice fixes the UPDATE path (Task 5);
   the create path is the same disclosure gap seen from the other side and is
   deliberately NOT fixed here. ★ Note it is not the same SEVERITY: a create
   cannot drop existing links, because there is no prior row to replace.
6. **`chat-proposal-describe.ts`'s `emptyPlan()` has three call sites and only
   two are safe forever.** The `pendingOn` create→update remap and the id-less
   delete are correctly empty (no before-image; a rejected call writes nothing).
   The third was `set_task_dependencies`, fixed by Task 15 — file this as the
   record of WHY the branch is not uniformly safe, so the next reader does not
   conclude from two examples that a hardcoded empty plan is always right.

7. **`str` is now defined twice** — privately in `inline-ai-edit/plan.ts` and
   again in `entity-descriptor.ts`, because `plan.ts` imports the descriptor so
   importing it back would close a cycle. Copied verbatim rather than
   approximated, but two functions with one name and no shared source is a
   drift risk a reviewer will flag. The fix is a shared leaf module; it was out
   of scope for the task that hit it.

★★ Numbers 5, 6 and 7 came out of the Task-1 cold review and the investigations
it triggered, not out of the original spec. All are measured; cite the
measurement in the entry, not this plan.

★★★ AND THE GENERAL LESSON, which applies to every task still unstarted: the
plan's transcribed-from-memory code blocks were **3-for-4 wrong** on Task 3's
entry details, and one of those would have shipped a blank title for every role
— the exact "reads as data loss" symptom this slice exists to remove. Treat
every remaining code block here as UNVERIFIED until grepped against the real
code. Where they disagree, the code wins and the disagreement is a finding.

- [ ] **Step 4: Record the invariant**

In `docs/AGENTS/ai-assistant.md`, in the inline-edit section:

```markdown
★★★ **PREVIEW/APPLY PARITY.** For every field a chat write tool can affect, the
preview must show either the value the writer will store, or a rejection the
writer will honour AND the user can see. Two asymmetries make this hard and both
have shipped defects: the preview judges fields ONE AT A TIME while a writer's
gate can be JOINT over the merged row (§384), and a write ALIAS (`name` →
`splitName`) rewrites fields that are not in `diffFields` at all (§372). Which
consumer loses data depends on the DIRECTION of the divergence — the rebuilding
inline editor for a wrong value, the two REPLAYING consumers for a wrongly
rejected one. `tool-input-coverage.test.ts` fails when a declared input is
neither previewable nor excluded with a reason.
```

- [ ] **Step 5: Run the doc gates**

```
npm run followups:status:check > /tmp/t14a.log 2>&1; echo "EXIT=$?"
npm run docs:claims:check > /tmp/t14b.log 2>&1; echo "EXIT=$?"
npm run docs:symbols:check > /tmp/t14c.log 2>&1; echo "EXIT=$?"
```

Expected: all EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md docs/AGENTS/ai-assistant.md
git commit -m "docs: close 383/384, file four, record the preview/apply parity invariant"
```

---

### Task 15: `set_task_dependencies` — the blank card

**Files:**
- Modify: `src/app/chat-proposal-describe.ts`
- Test: `src/app/chat-proposal-describe.test.ts`

★★★ ADDED BY DECISION AFTER THE TASK-1 REVIEW. This is NOT a `links` problem and
no amount of `EditPlan.links` work reaches it — the tool has no descriptor at
all, so it can never be a `TOOL_ENTITY` key.

Measured: `TOOL_ENTITY` is built by looping `INLINE_DESCRIPTORS` and collecting
each descriptor's `createTool`/`updateTool`/`deleteTool`. `set_task_dependencies`
is none of those, so `TOOL_ENTITY[call.name]` is `undefined` and the row takes
the `entity === undefined || op === undefined` branch, which pushes
`plan: emptyPlan()`. `PlanDetail` then renders `null`, and `proposalRowTitle`
falls through to `return call.name` — so the approval card shows the literal
string `set_task_dependencies` and nothing else.

What it writes: a REPLACE over a task's whole dependency graph. The dispatcher
computes a `removed` set (the prior dependencies not present in the new list)
and surfaces it ONLY in the tool result — i.e. to the model, in the transcript,
AFTER the write. Two guards exist and neither is disclosure: the tool throws on
a non-array `dependencies`, and the dispatcher refuses a wholly-destructive
write (nothing applied, something rejected, prior non-empty). So a PARTIALLY
destructive replace is both permitted and undisclosed.

- [ ] **Step 1: Write the failing test**

```ts
it("names the task and the dropped dependencies for set_task_dependencies", () => {
  // The card used to render the bare tool name for a REPLACE over the whole
  // dependency graph. Predecessors 1 and 3 are stored; the call supplies 3
  // only, so 1 is dropped and the user must see that BEFORE approving.
  const ws = {
    tasks: [
      { id: 7, taskName: "Ship", dependencies: [{ taskId: 1, type: "FS" }, { taskId: 3, type: "FS" }] },
      { id: 1, taskName: "Draft brief" },
      { id: 3, taskName: "Review" },
    ],
  } as unknown as Workspace;
  const rows = describeProposal(
    [{ type: "tool_use", name: "set_task_dependencies", input: { taskId: 7, dependencies: [{ taskId: 3, type: "FS" }] } }],
    ws,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].plan.links).toEqual([
    { field: "dependencies", before: "Draft brief, Review", after: "Review", rawIds: [3] },
  ]);
});
```

★ `describeProposal`'s real signature is what the file exports — read it and
adapt the call, do not assume this shape. Keep the ASSERTION.

- [ ] **Step 2: Run it and watch it fail** — expected: `plan.links` is `[]`
  (the row takes the empty-plan branch).

- [ ] **Step 3: Give that one tool a describer**

In `chat-proposal-describe.ts`, BEFORE the `entity === undefined` fallback, add
a narrow special case. Do NOT invent a descriptor entry for it — the tool has no
create/update/delete triple and forcing one into `INLINE_DESCRIPTORS` would
change what every other consumer of that map sees.

```ts
  if (call.name === "set_task_dependencies") {
    rows.push({ call, stamped, plan: describeDependencyReplace(call.input, ws), mintedId });
    continue;
  }
```

Write `describeDependencyReplace` in the same file, next to `emptyPlan`. It
resolves the target task, maps prior and supplied `dependencies[].taskId` to
task names, and returns `{ ...emptyPlan(), links: [...] }` when they differ.
★ Resolve titles with the SAME helper Task 4 created (`resolveLinkTitles`) so an
unknown id renders with the same marker as everywhere else — a second
id→title spelling is how two surfaces start disagreeing about what "unknown"
looks like.

★★ `rawIds` here is informational: this row is REPLAYED (the chat card re-sends
the original input), so nothing reads it back. Populate it anyway for shape
consistency, and do NOT wire it into any apply path.

- [ ] **Step 4: Green, typecheck, and check the trio pin**

`chat-proposal-describe.test.ts` has an existing test pinning that
`delete_all_tasks`, `send_inquiry` and `set_task_dependencies` all take the
empty-plan branch. That test is now WRONG for one of its three members. Update
it to pin the remaining TWO and assert the third is described — do not delete
it.

```
npx vitest run src/app/chat-proposal-describe.test.ts > <scratchpad>/t15.log 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/chat-proposal-describe.ts src/app/chat-proposal-describe.test.ts \
  -m "feat(chat): describe the set_task_dependencies replace instead of a blank card"
```

---

## Final verification

```
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/final.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/final.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```

★ `test:shuffle` matters more than usual here: this plan adds five test files,
and it is the only local reproduction of the blocking `unit-tests-shuffled` job.
Run the two sequentially — never two vitest processes at once.

## Eye-verify (owed, cannot be automated)

`PORT=3100 npm run dev`, never port 3000. Ask the assistant to change a RAID
item's linked tasks and confirm the card names the tasks being REMOVED, not just
the one being added. jsdom has no layout, so no unit test can check that the
line is readable.
