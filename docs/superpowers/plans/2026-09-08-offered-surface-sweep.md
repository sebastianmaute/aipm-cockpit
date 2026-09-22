# Offered-Surface Sweep Implementation Plan

> **Landing note, 2026-09-11 — execution split.** The fixes this detector found shipped in
> 0.297.0 "Gentle" (MR !460) on a rebased branch. The detector, its axis module and its register
> rows landed separately via `docs/superpowers/specs/2026-09-11-offered-surface-sweep-landing-design.md`,
> re-measured against main. Everything below is the dated record of the branch as executed and is not
> rewritten: branch SHAs cited below never reached main, and figures below are the branch's, not main's.

> **Ledger note, 2026-09-12 — every `UNSWEPT_BY_DESIGN` passage below is now stale.** As of this date
> `UNSWEPT_BY_DESIGN.task` is `["jiraKey"]` and `UNSWEPT_BY_DESIGN.calendarEvent` is `[]`. The twelve
> names this document describes as unswept by design became genuinely SWEPT on branch
> `feat/sweep-typed-probes`: `34488c85` re-measured the recorded axis (`AXIS_FIELDS`,
> `src/test/inline-sweep-fixtures.ts`) against the seeds that branch widened, which put eleven `task`
> columns and `calendarEvent.exceptions` on it, and `dbd90a43` then removed those twelve from the
> ledger, whose strict `toEqual` had gone red over the record that had stopped being true. Read a
> removal from that list as a coverage GAIN, not a write-off. The body below is preserved as written
> on 2026-09-08 and is not rewritten.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI write path a detector that can see what the existing parity sweep structurally cannot — an undeclared field landing on either the create or the update path, and a declared field silently failing to land — closing `docs/open-followups.md` §439 and §436.

**Architecture:** One shared axis module (`src/test/offered-surface-axis.ts`) derives, from a runtime import of `TOOL_DEFS`, the two halves of every entity's persisted surface: what the tool schema DECLARES and what it does not. One new test file drives both halves through the real dispatcher on both the create and the update path. Relation A asserts an undeclared field never lands on the model's value; Relation B asserts a declared field does land, or is visibly refused.

**Tech Stack:** TypeScript, vitest 4.1.8, @testing-library/react `renderHook` + `act`, the existing `chat-dispatcher-fixture` and `inline-sweep-fixtures` harnesses.

---

## Read before starting

**The spec** is `docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md` (commit `dbc74e01`). Read it in full. It carries the measured axis table, the reason the axis is `TOOL_DEFS` and not the descriptor, and the resolution of an ambiguity in Relation B's create arm that changes the assertion shape.

**Branch:** `feat/offered-surface-sweep`, at `dbc74e01`, cut off `origin/main` = `754e8129`. No release, no version bump anywhere in this plan.

**This branch is expected to end RED, and that is the point.** The detector's finding count is unknown until it runs. Tasks 1–6 build it, Task 7 runs it, Task 8 mutation-proves it, Task 9 updates the register, Task 10 reports and **stops**. Do not fix a single finding. Do not push. Do not open an MR.

### Environment rules that will bite

- **`src/app/**` and `src/test/**` are CRLF.** Use the Edit tool. Never `sed -i` — under Git Bash it re-lines the whole file to LF and `core.autocrlf=true` hides that from `git diff`. Verify with `git ls-files --eol <file>`; `i/lf w/crlf` is healthy.
- **`docs/**` is LF-only.** The Write tool re-lines to LF, which is correct there and wrong for sources.
- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status. Always:
  ```bash
  npx vitest run --maxWorkers=1 <paths> > "$SCRATCH/run.log" 2>&1; echo "EXIT=$?"
  grep -E "Test Files|Tests " "$SCRATCH/run.log"
  ```
  where `SCRATCH` is this session's scratchpad directory.
- **Never run two vitest processes at once.**
- **Never stage `sample-workspace-huge.json`** (foreign, already modified) or **`not-in-use.env.local.bak`** (untracked; holds live Turso credentials — never open, read, print or stage it). **Never `git add -A` or `git add .`.** Every commit below names its files explicitly and uses `git commit --only <paths>`.
- **`git checkout -- <file>` is deny-blocked** in this worktree, **`git stash` must never be run in it**, and **never `--amend`** (shared worktree).
- Every commit ends with the session trailer.
- **`npx tsc --noEmit` exits 2 on diagnostics**, not 1. `next build` does not typecheck test files and vitest never typechecks, so run tsc after every task that touches a `.ts` file.
- **`npm run lint` is `--max-warnings=0`** — an unused import is fatal. Use `npx eslint src` (a bare `npm run lint` picks up gitignored `.worktrees/` leftovers and exits 1 for unrelated reasons).
- **`size:check` LIMIT is 1600 and the ratchet counts `split("\n").length`, i.e. `wc -l` PLUS ONE.** Budget every file from:
  ```bash
  node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"
  ```
  `plan.write-path-sweep.test.ts` is 713 lines and **must not be extended** — that is why this slice adds a new file rather than an arm to it.

---

## File structure

| File | Responsibility |
|---|---|
| **Create** `src/test/offered-surface-axis.ts` | The axis. Owns `PERSISTED_COLUMNS`, `declaredProperties`, `undeclaredColumns`, `CREATE_BASE`, `AXIS_BASELINE`, `validProbeFor`. No assertions, no React — a pure module both detectors import. |
| **Create** `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts` | The three anti-vacuity floors, Relation A (create + update), Relation B (create + update), and the `sendInvitations` guard. |
| **Modify** `src/app/inline-ai-edit/plan.create-path-guards.test.ts` | Import `CREATE_BASE` instead of spelling seven `valid` literals. Correct its header's false claim about `createTool`. |
| **Modify** `src/app/inline-ai-edit/plan.model-writable-surface.test.ts` | Import `PERSISTED_COLUMNS` from the shared module instead of building it locally. Cross-reference the new detector. |
| **Modify** `docs/open-followups.md` | Close §436 and §439, correct §439's `createTool` claim, cross-reference from §437, mint §440 for the create-card disclosure gap. |

Why a separate axis module rather than putting this in `inline-sweep-fixtures.ts`: that file is 712 lines and is the *seed* fixture — it owns rows and probes for the update sweep. The axis owns schema-derived sets and has no seeds. Different responsibility, and folding them would push a 712-line file toward the ratchet.

---

## Task 1: The axis module and its three floors

**Files:**
- Create: `src/test/offered-surface-axis.ts`
- Create: `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts` (CRLF — use the Write tool then verify with `git ls-files --eol`, and if it reports `w/lf` re-create it with the Edit tool from a stub):

```ts
// src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
//
// ★★★ THE DETECTOR THE SWEEP COULD NOT BE, IN BOTH DIRECTIONS.
// `plan.write-path-sweep.test.ts` drives `update_*` tools only and derives its
// field axis from `[...diffFields, ...rawTypeGuards, ...linkFields]` unioned
// with the seed row's keys — every term downstream of the guard tables under
// test. So it could not have found §438 (seven create sites with no guard), and
// §436 measured that narrowing an allowlist row leaves its per-entity violation
// counts BYTE-IDENTICAL to a clean run.
//
// This file takes its axis from `TOOL_DEFS` instead — what the model is
// actually offered — and states one property in two halves:
//
//   Relation A  an UNDECLARED field must never land on the model's value,
//               on create or on update.
//   Relation B  a DECLARED field must land, or be visibly refused.
//
// Together: OFFERED ⟺ WRITABLE.
import { describe, expect, it } from "vitest";

import {
  AXIS_BASELINE,
  declaredProperties,
  ENTITIES,
  PERSISTED_COLUMNS,
  undeclaredColumns,
} from "../../test/offered-surface-axis";

describe("the offered-surface axis", () => {
  // ★★★ FLOOR 1 — the axis has not silently collapsed. Every assertion in both
  //  relations iterates an axis, and an EMPTY axis satisfies all of them. A
  //  schema refactor that renamed a field bag would empty one entity's declared
  //  set and turn that entity's whole Relation B green while proving nothing.
  //  Tied to a RECORDED baseline rather than to `> 0`, because `> 0` cannot see
  //  an axis that shrank from eleven to one.
  it.each(ENTITIES)("%s: the axis is the size it was measured at", (entity) => {
    expect({
      declared: declaredProperties(entity, "create").length,
      undeclared: undeclaredColumns(entity).length,
    }).toEqual(AXIS_BASELINE[entity]);
  });

  // ★★★ FLOOR 3 — THE ONLY ONE THAT CAN SEE A FIELD FALL OUT OF BOTH SETS.
  //  Floor 1 pins each set's SIZE and a compensating change moves neither: drop
  //  a column from `declaredProperties` and add one to `undeclaredColumns` and
  //  both counts hold. This asserts the two sets are jointly EXHAUSTIVE over the
  //  persisted columns, so a field that stopped being reachable by either
  //  relation is red rather than invisible.
  //
  //  ★★ `id` is subtracted on purpose and on BOTH sides: `create_*` mints it and
  //   `update_*` addresses by it, so it is never a written field. Subtracting it
  //   here rather than inside the two helpers keeps the helpers' own outputs
  //   honest about what the schema says.
  it.each(ENTITIES)("%s: declared and undeclared jointly cover every persisted column", (entity) => {
    const union = [...declaredProperties(entity, "create"), ...undeclaredColumns(entity)].sort();
    const columns = PERSISTED_COLUMNS[entity].filter((f) => f !== "id").sort();
    expect(union).toEqual(columns);
  });

  // ★ Non-vacuity for floor 3 itself: an empty minuend makes the equality above
  //  hold trivially. Nine is the smallest persisted column list (milestone, at
  //  9 including `id`), so a floor of 8 post-`id` is the honest one.
  it.each(ENTITIES)("%s: the union check has something to check", (entity) => {
    expect(PERSISTED_COLUMNS[entity].length).toBeGreaterThan(8);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts > "$SCRATCH/t1.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Cannot find" "$SCRATCH/t1.log"
```
Expected: EXIT=1, with `Cannot find module '../../test/offered-surface-axis'`.

- [ ] **Step 3: Write the axis module**

Create `src/test/offered-surface-axis.ts` (CRLF):

```ts
// src/test/offered-surface-axis.ts
//
// ★★★ THE AXIS IS WHAT THE MODEL IS OFFERED, AND THAT IS THE WHOLE POINT.
// Every existing detector on this path derives its field set from something the
// guard tables control — `sweptFields` unions `diffFields`, `rawTypeGuards` and
// `linkFields`; `plan.model-writable-surface.test.ts` subtracts `AXIS_FIELDS`,
// same lineage. A field in none of them is unreachable by construction, which
// is how §438's nine undisclosed writes sat under a green sweep.
//
// `TOOL_DEFS` has no part in guarding. Measured 2026-09-08: an axis built from
// it rediscovers §438's entire field set cold — `stakeholder.resourceId`,
// `stakeholder.raci`, `resource.birthday`, `resource.utilization`,
// `resource.utilizationMode`, `resource.absenceOverride`, `resource.active`,
// `calendarEvent.exceptions` are all undeclared by any schema. That is the
// argument for this axis, and it is worth more than the reasoning above it.
//
// ★★★ READ `TOOL_DEFS` AT RUNTIME. NEVER REGEX-SCRAPE `chat-tool-defs.ts`.
// The spec's sizing probe used a regex and is explicitly not what ships, for a
// reason `ai-entity-token.test.ts` already records: `TOOL_DEFS` SPREADS
// `DOCUMENT_TOOL_DEFS` from a second file, so a grep over one source sees a
// strict subset of the real tool list and reports a smaller surface than the
// model is sent.
import { TOOL_DEFS } from "../app/chat-tool-defs";
import {
  ABSENCES_CSV_COLUMNS,
  CHANGES_CSV_COLUMNS,
  CSV_COLUMNS,
  EVENTS_CSV_COLUMNS,
  MILESTONES_CSV_COLUMNS,
  RAID_CSV_COLUMNS,
  RESOURCES_CSV_COLUMNS,
  STAKEHOLDERS_CSV_COLUMNS,
} from "../app/csv-codecs-core";
import { INLINE_DESCRIPTORS, type InlineEntity } from "../app/inline-ai-edit/entity-descriptor";

export const ENTITIES = Object.keys(INLINE_DESCRIPTORS) as InlineEntity[];

/** The persisted surface, from the CSV column lists.
 *
 *  ★★ THE RIGHT SOURCE, AND NOT BY CONVENIENCE. `ai-entity-token.ts`'s
 *  `ProjectedRows` (`Assert<Projected<T, typeof COLUMNS>>`) already makes tsc
 *  prove each array covers its entity type — so a field added to `types.ts` and
 *  persisted CANNOT fail to appear here, and this axis then forces a decision
 *  about it. A hand-written list would go stale in silence.
 *
 *  ★ Lifted out of `plan.model-writable-surface.test.ts`, which now imports it
 *  back. Two detectors reasoning about "the persisted surface" from two private
 *  copies is how they come to disagree about what was covered. */
export const PERSISTED_COLUMNS: Record<InlineEntity, readonly string[]> = {
  task: CSV_COLUMNS,
  raid: RAID_CSV_COLUMNS,
  change: CHANGES_CSV_COLUMNS,
  milestone: MILESTONES_CSV_COLUMNS,
  stakeholder: STAKEHOLDERS_CSV_COLUMNS,
  resource: RESOURCES_CSV_COLUMNS,
  absence: ABSENCES_CSV_COLUMNS,
  calendarEvent: EVENTS_CSV_COLUMNS,
};

type SchemaProperty = { type?: string; enum?: readonly string[]; description?: string };

function toolDef(name: string) {
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`offered-surface axis: no TOOL_DEFS entry named "${name}"`);
  return def;
}

/** Every property the named tool ADVERTISES, minus the two addressing fields.
 *
 *  ★★ `id` and `expectedToken` are subtracted because neither is a WRITTEN
 *  field: `create_*` mints the id and `update_*` addresses by it, and
 *  `expectedToken` is concurrency plumbing stripped by `patchWithoutId` before
 *  the patch reaches any writer. Leaving them in would put two fields on
 *  Relation B's axis that can never "land", producing two permanent findings
 *  per entity that are not defects.
 *
 *  ★ Measured 2026-09-08: create and update share ONE field bag per entity for
 *  all eight — `create_raid_item` declares `properties: raidFields` and
 *  `update_raid_item` declares `{ id, ...expectedTokenField, ...raidFields }`.
 *  So the two ops return the same set today. The `op` parameter exists so that
 *  a future divergence is expressible rather than silently averaged. */
export function declaredProperties(entity: InlineEntity, op: "create" | "update"): readonly string[] {
  const name = op === "create" ? INLINE_DESCRIPTORS[entity].createTool : INLINE_DESCRIPTORS[entity].updateTool;
  const props = (toolDef(name).input_schema as { properties?: Record<string, SchemaProperty> }).properties ?? {};
  return Object.keys(props)
    .filter((f) => f !== "id" && f !== "expectedToken")
    .sort();
}

/** The raw schema entry for one declared property, for probe derivation. */
export function schemaProperty(entity: InlineEntity, op: "create" | "update", field: string): SchemaProperty {
  const name = op === "create" ? INLINE_DESCRIPTORS[entity].createTool : INLINE_DESCRIPTORS[entity].updateTool;
  const props = (toolDef(name).input_schema as { properties?: Record<string, SchemaProperty> }).properties ?? {};
  const prop = props[field];
  if (!prop) throw new Error(`offered-surface axis: ${name} declares no property "${field}"`);
  return prop;
}

/** Persisted columns the model is offered by NO tool schema.
 *
 *  ★★★ THIS IS RELATION A'S AXIS, AND IT IS NOT AN EXEMPTION LIST. Everything
 *  here SHOULD be unwritable; the relation asserts it. `localModifiedAt` sits in
 *  all eight of these sets and `outlookEventId` in five — both are legitimately
 *  written by the writer, and neither is ever written to the MODEL'S value,
 *  which is why the relation asserts on the probe value and needs no exemption
 *  for them. */
export function undeclaredColumns(entity: InlineEntity): readonly string[] {
  const declared = declaredProperties(entity, "create");
  return PERSISTED_COLUMNS[entity].filter((f) => f !== "id" && !declared.includes(f)).sort();
}

/** The axis sizes measured on `origin/main` = 754e8129, 2026-09-08.
 *
 *  ★★ A RECORDED BASELINE, NOT A TARGET. A change here is legitimate whenever a
 *  schema or a CSV column list changes — but it must be a DECISION. The floor
 *  that reads this exists because every relation below iterates an axis, and an
 *  axis that silently collapsed makes them all pass. */
export const AXIS_BASELINE: Record<InlineEntity, { declared: number; undeclared: number }> = {
  task: { declared: 11, undeclared: 17 },
  raid: { declared: 16, undeclared: 6 },
  change: { declared: 16, undeclared: 4 },
  milestone: { declared: 5, undeclared: 3 },
  stakeholder: { declared: 8, undeclared: 4 },
  resource: { declared: 13, undeclared: 6 },
  absence: { declared: 7, undeclared: 2 },
  calendarEvent: { declared: 9, undeclared: 3 },
};

```

★ Note the import list above deliberately does NOT re-export `TOKEN_EXCLUDED`. Relation A asserts on
the probe VALUE, so it never needs to subtract the writer-stamped set the way the update sweep's
relation 3 does — and `npm run lint` is `--max-warnings=0`, so an unused re-export imported by the
test file would be fatal rather than untidy. If `TOKEN_EXCLUDED` ends up unused in the axis module
itself, drop its import too.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts > "$SCRATCH/t1b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t1b.log"
```
Expected: EXIT=0, `Tests  24 passed (24)` — three `it.each` blocks over eight entities.

If floor 1 fails, **do not edit `AXIS_BASELINE` to match.** Read the failure: it prints the measured pair against the recorded one. Establish why the schema moved, then change the baseline as a deliberate edit with the reason in the commit message.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
```
Expected: both EXIT=0. `tsc` exits **2** on diagnostics, not 1.

- [ ] **Step 6: Verify line endings and size**

```bash
git ls-files --eol src/test/offered-surface-axis.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
node -e "console.log(require('fs').readFileSync('src/test/offered-surface-axis.ts','utf8').split('\n').length)"
```
Expected: both files report `i/lf w/crlf` once staged (before staging, `w/crlf` with `i/` blank is fine for a new file — re-check after the commit). The ratchet count must be well under 1600.

- [ ] **Step 7: Commit**

```bash
git add src/test/offered-surface-axis.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
git commit --only src/test/offered-surface-axis.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts -m "$(cat <<'EOF'
test(ai): the offered-surface axis, read from TOOL_DEFS at runtime

Every existing detector on the AI write path derives its field axis from
registries the guard tables control, so a field in none of them is unreachable
by construction -- which is how 438's nine undisclosed writes sat under a green
sweep.

This axis comes from TOOL_DEFS instead: what the model is actually offered. It
rediscovers 438's whole field set cold, which is the argument for it.

Read at runtime, never regex-scraped: TOOL_DEFS spreads DOCUMENT_TOOL_DEFS from
a second file, so a grep over one source reports a smaller surface than the
model is sent.

Three floors ship with it. Floor 1 pins each axis size against a recorded
baseline, because an axis that silently collapsed makes every relation built on
it pass. Floor 3 asserts declared and undeclared are jointly exhaustive over the
persisted columns -- the only one of the three that can see a field fall out of
BOTH sets, which floor 1 cannot, since a compensating change moves neither
count.
EOF
)"
```

---

## Task 2: Lift the create base payloads into the shared module

**Files:**
- Modify: `src/test/offered-surface-axis.ts`
- Modify: `src/app/inline-ai-edit/plan.create-path-guards.test.ts`

- [ ] **Step 1: Add `CREATE_BASE` and its floor to the axis module**

Append to `src/test/offered-surface-axis.ts` (Edit tool — the file is CRLF):

```ts
/** The minimum payload each `create_*` tool accepts, per entity.
 *
 *  ★★★ A CREATE THAT RETURNS NULL LEAVES NO ROW, AND EVERY REFUSAL ASSERTION
 *  OVER A MISSING ROW PASSES FOR THE WRONG REASON. That is why these are pinned
 *  by `create_*` schema `required` arrays below rather than trusted.
 *
 *  ★★ Seven of these were the `valid` member of each `CreateCase` in
 *  `plan.create-path-guards.test.ts` and now live here, with that file
 *  importing them back. Two detectors holding private ideas of "a valid create"
 *  is how they come to disagree about what was covered.
 *
 *  ★ `calendarEvent` carries a `recurrence` on purpose: `sanitizeCalendarEvent`
 *  stores `exceptions` only when a recurrence is present, so without it a probe
 *  aimed at `exceptions` cannot land and the assertion passes whatever the
 *  guard does. That reasoning is why this bag is not simply the `required`
 *  fields. */
export const CREATE_BASE: Record<InlineEntity, Record<string, unknown>> = {
  task: { taskName: "A task", assignee: "Ada Lovelace", dueDate: "2026-06-01" },
  raid: { title: "A risk" },
  change: { title: "A change" },
  milestone: { name: "A milestone", date: "2026-06-01" },
  stakeholder: { name: "Ada Lovelace" },
  resource: { firstName: "Grace", lastName: "Hopper" },
  absence: { assignee: "Ada Lovelace", startDate: "2026-06-01", endDate: "2026-06-02" },
  calendarEvent: {
    title: "Weekly sync",
    startDate: "2026-06-01",
    startTime: "09:00",
    durationMinutes: 30,
    recurrence: { freq: "weekly", interval: 1 },
  },
};

/** Every field the `create_*` schema marks `required`, for the floor that pins
 *  `CREATE_BASE` against it. */
export function requiredForCreate(entity: InlineEntity): readonly string[] {
  const schema = toolDef(INLINE_DESCRIPTORS[entity].createTool).input_schema as { required?: readonly string[] };
  return [...(schema.required ?? [])].sort();
}
```

- [ ] **Step 2: Add the floor test**

Append to the `describe("the offered-surface axis", ...)` block in `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`, and extend its import list with `CREATE_BASE` and `requiredForCreate`:

```ts
  // ★★★ A CREATE BASE MISSING A REQUIRED FIELD IS A SILENT VACUITY ENGINE. The
  //  tool throws, no row is stored, and every "the probe did not land"
  //  assertion in Relation A passes because there is nothing to have landed in.
  //  Pinned against the schema's OWN `required` array so a newly-required field
  //  turns this red rather than quietly hollowing out an entity's whole arm.
  it.each(ENTITIES)("%s: the create base satisfies every schema-required field", (entity) => {
    const missing = requiredForCreate(entity).filter((f) => !(f in CREATE_BASE[entity]));
    expect(missing, `${entity}: create base omits required ${missing.join(", ")}`).toEqual([]);
  });

  // ★ The base must also be made of DECLARED fields only — a base carrying an
  //  undeclared key would put Relation A's own probe value into every create,
  //  which is the shape it exists to detect.
  it.each(ENTITIES)("%s: the create base names only declared fields", (entity) => {
    const declared = declaredProperties(entity, "create");
    const stray = Object.keys(CREATE_BASE[entity]).filter((f) => !declared.includes(f));
    expect(stray, `${entity}: create base carries undeclared ${stray.join(", ")}`).toEqual([]);
  });
```

- [ ] **Step 3: Run to verify both pass**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts > "$SCRATCH/t2.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t2.log"
```
Expected: EXIT=0, `Tests  40 passed (40)` — five blocks over eight entities.

If "the create base names only declared fields" fails for `calendarEvent` on `recurrence`, that is a real answer, not a nuisance: check whether `recurrence` is in `calendarEventFields`. Measured 2026-09-08 it is (`title startDate startTime durationMinutes location notes attendeeResourceIds sendInvitations recurrence`), so this should pass.

- [ ] **Step 4: Repoint `plan.create-path-guards.test.ts` at the shared base**

In `src/app/inline-ai-edit/plan.create-path-guards.test.ts`, add `CREATE_BASE` to the imports and replace each of the seven `valid:` literals with the shared reference. For example, the raid row becomes:

```ts
  {
    entity: "raid",
    tool: "create_raid_item",
    wsKey: "raid",
    valid: CREATE_BASE.raid,
    field: "knowledgeLinks",
    probe: KNOWLEDGE_LINKS,
    expected: undefined,
    because: "knowledgeLinks is in no tool schema, and the sanitizer rebuilds the field from the merged blob",
  },
```

Do the same for `change` (`CREATE_BASE.change`), `milestone` (`CREATE_BASE.milestone`), `stakeholder` (`CREATE_BASE.stakeholder`), `resource` (`CREATE_BASE.resource`), `absence` (`CREATE_BASE.absence`) and `calendarEvent` (`CREATE_BASE.calendarEvent`).

Keep the `calendarEvent` row's comment about `recurrence` in place but repoint it — it now explains a decision made in the shared module:

```ts
    // `sanitizeCalendarEvent` stores exceptions only when a recurrence is
    // present, so without it the probe cannot land and the assertion would pass
    // whatever the guard did. That is why `CREATE_BASE.calendarEvent` carries a
    // recurrence rather than being the bare `required` set — see its docstring.
    valid: CREATE_BASE.calendarEvent,
```

- [ ] **Step 5: Correct that file's header claim about `createTool`**

Its header currently reads *"its plumbing reads `INLINE_DESCRIPTORS[entity].updateTool` and there is no create relation to read"*. The first half is true; "no create relation to read" is the same false claim §439 carries. Replace that clause:

```ts
// ★★★ THE CREATE PATH IS NOT THE UPDATE PATH, and for one release it was the
// half of the write surface nothing watched. `plan.write-path-sweep.test.ts`
// drives `update_*` tools ONLY — its plumbing hardcodes
// `INLINE_DESCRIPTORS[entity].updateTool` — so every guard added at a merge
// site was, until §438, a guard on editing alone. A field the model was refused
// when EDITING was accepted when CREATING, silently, on six of the seven create
// tools.
//
// ★★ `createTool` WAS THERE THE WHOLE TIME, and saying otherwise overstates the
// work. It is a declared member of `InlineEntityDescriptor` and all eight
// entities carry one (`grep -c 'createTool: "create_' entity-descriptor.ts` →
// 8); `chat-proposal-describe.ts` indexes `toolEntity[d.createTool]` off it.
// `sweepPlumbing` simply declines to read it. The same wrong sentence sat in
// §439 and is corrected there too.
```

Also update its closing paragraph, which says a real create relation "is still owed; see §438" — that is now this slice:

```ts
// ★★ THIS IS A PIN, NOT A SWEEP. It asserts one refused field per entity rather
// than enumerating an axis, so it cannot replace a mechanical sweep and must not
// be read as create-path parity coverage. The axis-driven create relation it
// was waiting for is `plan.offered-surface-sweep.test.ts` (§439); what this file
// buys on top is that the seven guards cannot be quietly removed from the create
// sites again.
```

- [ ] **Step 6: Run both files, typecheck, lint**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/app/inline-ai-edit/plan.create-path-guards.test.ts > "$SCRATCH/t2b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t2b.log"
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
```
Expected: vitest EXIT=0 with both files passing and `plan.create-path-guards.test.ts`'s own test count unchanged from before this task; tsc and eslint EXIT=0.

**Record the create-path-guards test count before and after.** If it moved, the lift changed behaviour and that is a defect in the lift, not a win.

- [ ] **Step 7: Commit**

```bash
git add src/test/offered-surface-axis.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/app/inline-ai-edit/plan.create-path-guards.test.ts
git commit --only src/test/offered-surface-axis.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/app/inline-ai-edit/plan.create-path-guards.test.ts -m "$(cat <<'EOF'
test(ai): one shared create base, pinned against each schema's required array

The seven valid-create payloads were private to plan.create-path-guards.test.ts.
The new sweep needs the same eight (task included, which that file has no case
for), and two detectors holding private ideas of "a valid create" is how they
come to disagree about what was covered.

A create that returns null leaves no row, and every refusal assertion over a
missing row passes for the wrong reason -- so the base is pinned against the
create schema's own required array, and against the declared property set, so a
newly-required field goes red instead of quietly hollowing out an entity's arm.

Also corrects that file's header: it said there is no create relation to read,
which is the same false claim 439 carries. createTool is declared on the
descriptor and all eight entities carry one; sweepPlumbing simply hardcodes
updateTool.
EOF
)"
```

---

## Task 3: Relation A — undeclared fields must not land

**Files:**
- Modify: `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`

- [ ] **Step 1: Add the replay helpers**

Extend the imports at the top of `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { dispatcherWrapperWith, makeDispatcherArgs } from "../../test/chat-dispatcher-fixture";
import { rejectedFields, same, snapshot, SWEEP, type SweepEntity, type WsKey } from "../../test/inline-sweep-fixtures";
import {
  AXIS_BASELINE,
  CREATE_BASE,
  declaredProperties,
  ENTITIES,
  PERSISTED_COLUMNS,
  requiredForCreate,
  schemaProperty,
  undeclaredColumns,
} from "../../test/offered-surface-axis";
import { entityToken } from "../ai-entity-token";
import { TOKEN_ROW_SOURCE } from "../chat-proposal-apply";
import { runTool } from "../chat-tools";
import { resetMintState } from "../id-mint-session";
import { useChatDispatcher } from "../use-chat-dispatcher";
import { useWorkspace } from "../workspace-context";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./entity-descriptor";
import { describeEntityCalls, type EditPlan, previewNormalizerFor } from "./plan";
```

Add below the axis describe block:

```ts
type Row = Record<string, unknown>;

const SEED_BY_ENTITY = new Map<InlineEntity, SweepEntity>(SWEEP.map((s) => [s.entity, s]));

function seedFor(entity: InlineEntity): SweepEntity {
  const s = SEED_BY_ENTITY.get(entity);
  if (!s) throw new Error(`no SWEEP fixture for "${entity}" — the relations below cannot run`);
  return s;
}

/** The seeded row as the fixture literal declares it — the right source for
 *  CHOOSING a probe, because a probe needs only the field's TYPE and the type
 *  survives the sanitizer. Never the right source for JUDGING a write: every
 *  comparison below reads `before` out of `updateWith`, which is the provider's
 *  own post-write row. Judging against this literal would compare the stored row
 *  to something the provider never held. */
function snapshotSeedRow(s: SweepEntity): Row | undefined {
  const wsKey = INLINE_DESCRIPTORS[s.entity].wsKey as WsKey;
  const rows = (s.seed as Record<string, ReadonlyArray<Row>>)[wsKey];
  return rows?.find((r) => r.id === s.id);
}

/** The `TokenEntity` kind for an entity's update tool, for `entityToken`. */
function kindOf(entity: InlineEntity) {
  const tool = INLINE_DESCRIPTORS[entity].updateTool;
  const source = TOKEN_ROW_SOURCE[tool];
  if (!source) throw new Error(`no TOKEN_ROW_SOURCE entry for "${tool}"`);
  return source.kind;
}

/** Drive one `create_*` call and return the row it produced, or undefined.
 *
 *  ★★ `resetMintState()` runs in `beforeEach`, not here: the minter is
 *  module-scoped and resetting mid-file would let two creates in one test mint
 *  the same id. */
async function createWith(
  entity: InlineEntity,
  extra: Record<string, unknown>,
): Promise<{ row: Row | undefined; plan: EditPlan; threw?: string }> {
  const { result } = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith({}) },
  );
  const tool = INLINE_DESCRIPTORS[entity].createTool;
  const input = { ...CREATE_BASE[entity], ...extra };
  const wsBefore = snapshot(result.current.ws);

  const plan = describeEntityCalls([{ type: "tool_use", name: tool, input }], {
    descriptor: INLINE_DESCRIPTORS[entity],
    item: undefined,
    ws: wsBefore,
  });

  // ★★★ A THROW IS AN OUTCOME, NOT AN ERROR. Several writers refuse a bad value
  //  loudly rather than dropping it, and letting the exception escape would
  //  crash the whole entity's arm at its first strict field and never reach the
  //  rest of the axis. Captured so the relations can tell "refused loudly" from
  //  "accepted silently".
  let threw: string | undefined;
  await act(async () => {
    try {
      await runTool(result.current.d, tool, input);
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
  });

  const wsKey = INLINE_DESCRIPTORS[entity].wsKey as WsKey;
  const rows = snapshot(result.current.ws)[wsKey] as ReadonlyArray<Row> | undefined;
  return { row: rows?.[0], plan, threw };
}

/** Drive one `update_*` call against the shared seed and return before/after. */
async function updateWith(
  entity: InlineEntity,
  field: string,
  probe: unknown,
): Promise<{ before: Row; stored: Row; plan: EditPlan; threw?: string }> {
  const s = seedFor(entity);
  const { result } = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith(s.seed) },
  );
  const tool = INLINE_DESCRIPTORS[entity].updateTool;
  const wsKey = INLINE_DESCRIPTORS[entity].wsKey as WsKey;

  const wsBefore = snapshot(result.current.ws);
  const before = (wsBefore[wsKey] as ReadonlyArray<Row> | undefined)?.find((r) => r.id === s.id);
  if (!before) throw new Error(`fixture did not seed ${wsKey} #${s.id}`);

  const input: Record<string, unknown> = { id: s.id, [field]: probe };
  const plan = describeEntityCalls([{ type: "tool_use", name: tool, input }], {
    descriptor: INLINE_DESCRIPTORS[entity],
    item: before,
    ws: wsBefore,
  });

  // ★★ `expectedToken` stamped from the STORED row, exactly as
  //  `chat-proposal-apply.ts` does it. Without it `requireToken` refuses every
  //  call, each read-back compares a row against itself, and the whole relation
  //  reports perfect agreement having written nothing.
  let threw: string | undefined;
  await act(async () => {
    try {
      await runTool(result.current.d, tool, { ...input, expectedToken: entityToken(kindOf(entity), before) });
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
  });

  const stored = (snapshot(result.current.ws)[wsKey] as ReadonlyArray<Row> | undefined)?.find((r) => r.id === s.id);
  if (!stored) throw new Error(`${wsKey} #${s.id} vanished during the replay`);
  return { before, stored, plan, threw };
}

/** A value that differs from anything a writer would produce for this field, so
 *  "did the model's value land" is answerable.
 *
 *  ★★★ RELATION A ASSERTS ON THIS VALUE, NEVER ON THE FIELD'S PRESENCE, AND
 *  THAT IS THE PROPERTY THAT KEEPS IT FREE OF AN EXEMPTION LIST.
 *  `localModifiedAt` is on all eight undeclared axes and `outlookEventId` on
 *  five; both are legitimately written by the writer on every call, and neither
 *  is EVER written to the model's value. A presence-based assertion would need
 *  all of them exempted, and an exemption list is exactly how §437's ratchet
 *  came to hide a live undisclosed write. */
 *  ★★★ DERIVED FROM THE SEEDED VALUE'S TYPE, NOT A FIXED STRING. A guard
 *  written `typeof v === "number"` refuses a string for the RIGHT reason, so a
 *  string-only probe cannot tell a working guard from a type mismatch and would
 *  report a clean run over a field it never actually reached. Where the seed
 *  carries no value the string is the honest fallback — there is nothing to
 *  derive from — and the relation reports that case at the gate rather than
 *  swallowing it. */
const TRESPASS_STRING = "TRESPASS-offered-surface-sweep";

function trespassProbeFor(current: unknown): unknown {
  if (typeof current === "boolean") return !current;
  if (typeof current === "number") return current + 1000;
  if (Array.isArray(current)) return [{ trespass: "offered-surface-sweep" }];
  return TRESPASS_STRING;
}
```

- [ ] **Step 2: Add Relation A**

```ts
beforeEach(() => {
  // The id minter is module-scoped. Resetting keeps this file order-independent
  // under `npm run test:shuffle`, which runs the whole suite at a pinned seed.
  resetMintState();
});

describe.each(ENTITIES)("Relation A — %s: an undeclared field must not land", (entity) => {
  // ★★★ THE RELATION §438 NEEDED AND NOBODY HAD. Seven create sites spread raw
  //  model input while their update siblings were guarded, mutation-proved and
  //  watched by a green sweep — because every detector asked only about
  //  editing. This asks about both.
  it("create: the created row carries none of the model's undeclared values", async () => {
    const findings: string[] = [];
    let probed = 0;
    const seedRow = (snapshotSeedRow(seedFor(entity)) ?? {}) as Row;

    for (const field of undeclaredColumns(entity)) {
      // Typed from the SEEDED value where there is one, so a `typeof v ===
      // "number"` guard is actually reached rather than refusing a string for
      // the right reason and reading as clean.
      const probe = trespassProbeFor(seedRow[field]);
      probed += 1;
      const { row, threw } = await createWith(entity, { [field]: probe });
      // A loud refusal is agreement: the field did not land, and the writer said
      // so. Only a SILENT acceptance is a finding.
      if (threw !== undefined) continue;
      if (!row) {
        findings.push(`${entity}.${field}: the create stored no row at all — the base payload is not valid`);
        continue;
      }
      if (same(row[field], probe)) {
        findings.push(`${entity}.${field}: create stored the model's undeclared value ${JSON.stringify(probe)}`);
      }
    }

    expect(probed, `${entity}: Relation A ran over an empty undeclared axis`).toBe(
      AXIS_BASELINE[entity].undeclared,
    );
    expect(findings, `${findings.length} undeclared create writes`).toEqual([]);
  });

  it("update: an undeclared field does not move", async () => {
    const s = seedFor(entity);
    const findings: string[] = [];
    let probed = 0;

    const seedRow = (snapshotSeedRow(s) ?? {}) as Row;

    for (const field of undeclaredColumns(entity)) {
      const probe = trespassProbeFor(seedRow[field]);
      const { before, stored, threw } = await updateWith(entity, field, probe);
      probed += 1;
      if (threw !== undefined) continue;
      // ★★ The comparison is against the PROBE, not against "did the field
      //  change". `localModifiedAt` changes on every single replay — all eight
      //  writers stamp it unconditionally — so a movement test would fire on
      //  every entity and bury every real finding. Asserting the model's value
      //  did not land is sound for a writer-stamped field and for a guarded one
      //  alike.
      if (same(stored[field], probe)) {
        findings.push(
          `${entity}.${field}: update stored the model's undeclared value (was ${JSON.stringify(before[field])})`,
        );
      }
    }

    expect(probed, `${entity}: Relation A ran over an empty undeclared axis`).toBe(
      AXIS_BASELINE[entity].undeclared,
    );
    expect(findings, `${findings.length} undeclared update writes`).toEqual([]);
    // Non-vacuity: the seed must actually exist, or every read-back above
    // compared undefined against a string and agreed.
    expect(Object.keys(s.seed).length, `${entity}: the SWEEP fixture seeds nothing`).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run it — expect findings, and record them**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts > "$SCRATCH/t3.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t3.log"
grep -E "undeclared (create|update) writes|stored the model's" "$SCRATCH/t3.log"
```

Expected: **EXIT is unknown and either answer is informative.** EXIT=0 means Relation A found nothing, which would be a surprise worth double-checking against the non-vacuity floors. EXIT=1 with named fields is the discovery this slice exists for.

**Do not fix anything.** Copy the finding lines into the scratchpad as `$SCRATCH/relation-a-baseline.txt` — Task 8 compares mutant runs against them, and Task 10 reports them.

If a `probed` assertion fails, the axis collapsed for that entity; stop and diagnose before reading any finding list, because a partial axis makes the finding list a floor rather than a total.

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
```
Expected: both EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
git commit --only src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts -m "$(cat <<'EOF'
test(ai): Relation A -- an undeclared field must not land, on either path

Drives every persisted column the tool schemas do not declare through the real
dispatcher, on create and on update, and asserts the model's own value never
reaches the stored row.

The assertion is on the PROBE VALUE and never on the field's presence. That is
what keeps this free of an exemption list: localModifiedAt is on all eight
undeclared axes and outlookEventId on five, both legitimately written by the
writer on every call and neither ever written to the model's value. A
presence-based assertion would need every one of them exempted, and an exemption
list is how 437's ratchet came to hide a live undisclosed write.

A loud refusal counts as agreement -- the field did not land and the writer said
so. Only silent acceptance is a finding.

This test may be RED at baseline. That is the slice working, not failing.
EOF
)"
```

---

## Task 4: Relation B — the update arm, and the mail guard

**Files:**
- Modify: `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`

- [ ] **Step 1: Add the valid-probe derivation**

Append below `trespassProbeFor`:

```ts
/** A VALID value for a declared field, different from what is stored.
 *
 *  ★★★ RELATION B NEEDS A VALID PROBE WHERE RELATION A NEEDS AN INVALID ONE,
 *  AND CONFUSING THE TWO INVERTS THE RESULT. Relation A asks "can the model
 *  write something it was never offered", so any distinguishable value serves.
 *  Relation B asks "does the field the model WAS offered actually work", so a
 *  value the sanitizer legitimately rejects would report a lost capability
 *  where the guard is simply doing its job.
 *
 *  Resolution order, most specific first:
 *   1. the schema's own `enum` — pick a member the seed does not already hold;
 *   2. the SEED row's current value, mutated in kind (a date +1 day, a number
 *      +1, a boolean flipped, a string suffixed). This is what makes dates work
 *      without a format table: a valid date mutated by a day is still valid.
 *   3. the declared `type`, for a field the seed does not carry.
 *
 *  ★★ Step 2 is why there is no per-field override map here. A map of "this
 *  field wants a date, that one wants an email" is a maintenance surface that
 *  rots silently and, worse, is one rename away from becoming an exemption
 *  list. Deriving from a value the fixture already proved valid cannot rot in
 *  that direction. */
 *  ★ `op` is threaded rather than hardcoded to `"update"`. The two ops share one
 *  field bag per entity today, so it makes no difference — but a create-only
 *  property would make a hardcoded `"update"` lookup THROW inside the create
 *  arm, which reads as a broken harness rather than as the schema divergence it
 *  would be.
 */
function validProbeFor(
  entity: InlineEntity,
  op: "create" | "update",
  field: string,
  current: unknown,
): unknown {
  const prop = schemaProperty(entity, op, field);
  if (prop.enum && prop.enum.length > 0) {
    const other = prop.enum.find((v) => v !== current);
    return other ?? prop.enum[0];
  }
  if (typeof current === "boolean") return !current;
  if (typeof current === "number") return current + 1;
  if (typeof current === "string" && /^\d{4}-\d{2}-\d{2}$/.test(current)) {
    const d = new Date(`${current}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (typeof current === "string" && /^\d{2}:\d{2}$/.test(current)) {
    return current === "09:00" ? "10:00" : "09:00";
  }
  if (typeof current === "string" && current.length > 0) return `${current} probed`;
  if (Array.isArray(current)) return [...current, "probed"];
  if (prop.type === "number") return 7;
  if (prop.type === "boolean") return true;
  if (prop.type === "array") return ["probed"];
  return "probed";
}
```

- [ ] **Step 2: Add the mail guard, OUTSIDE any loop**

```ts
// ★★★ THE ONE PROBE IN THIS FILE WITH A REAL-WORLD SIDE EFFECT.
//  `calendarEvent.sendInvitations` is DECLARED — it is in `calendarEventFields`
//  — so Relation B drives it, and `CALENDAR_EVENT_FIELD_GUARDS` accepts it. A
//  strict `true` trips `shouldStage` in `chat-proposal.ts`, which in production
//  mails the attendees. Whether a unit-test replay can actually send that mail
//  has NEVER BEEN ESTABLISHED — it is UNKNOWN, not known-safe, and the
//  difference is not worth finding out by accident.
//
//  ★★★ `validProbeFor` DERIVES THE BOOLEAN BRANCH AS `!current`, SO THE SAFETY
//   IS CONTINGENT ON A SEED VALUE IN ANOTHER FILE. `seedGuardedCalendarEvent`
//   holds `sendInvitations: true`, making the probe `false`. Flip that seed —
//   a one-token edit made for reasons having nothing to do with mail — and the
//   same loop drives `true` through the real dispatcher. This turns that
//   contingency into an assertion.
//
//  ★★ SITED OUTSIDE THE RELATION LOOP DELIBERATELY. A guard inside it would run
//   only on the iterations that reached this field, i.e. exactly the runs that
//   did not need protecting.
//
//  ★ Do NOT make a red run here green by special-casing the field in
//   `validProbeFor`. That un-sweeps it, trading a loud question for a silent
//   hole. Settle the mail question instead.
it("no Relation B probe drives calendarEvent.sendInvitations true", () => {
  const declared = declaredProperties("calendarEvent", "update");
  expect(
    declared,
    "`sendInvitations` left the declared surface — either it is genuinely unwritable now, or the schema narrowed and this guard has gone vacuous",
  ).toContain("sendInvitations");
  const seed = seedFor("calendarEvent");
  const row = (seed.seed as Record<string, ReadonlyArray<Row>>).calendarEvents?.find((r) => r.id === seed.id);
  expect(row, "the calendarEvent fixture no longer seeds the row this guard reads").toBeDefined();
  expect(
    validProbeFor("calendarEvent", "update", "sendInvitations", row!.sendInvitations),
    "a Relation B probe would drive calendarEvent.sendInvitations TRUE through the real dispatcher — the one write in this file that leaves the building. If the seed just changed, that is why you are reading this.",
  ).not.toBe(true);
});
```

- [ ] **Step 3: Add Relation B's update arm**

```ts
describe.each(ENTITIES)("Relation B — %s: a declared field must land or be visibly refused", (entity) => {
  // ★★★ THE DETECTOR §436 ASKED FOR, IN ITS OWN WORDS: "something that asserts
  //  each allow-list still ADMITS the fields the tool schema advertises".
  //  §436 measured that narrowing `ABSENCE_FIELD_GUARDS.note` to `() => false`
  //  leaves `plan.write-path-sweep.test.ts` GREEN with per-entity violation
  //  counts byte-identical to a clean run, while the model loses the ability to
  //  write an absence note at all. The preview reads the same table object via
  //  `rawTypeGuards`, so both sides move together and the sweep certifies
  //  itself. This relation reads the SCHEMA, which that table cannot move.
  it("update: every declared field moves, or the card says why not", async () => {
    const findings: string[] = [];
    let landed = 0;
    let probed = 0;
    let dead = 0;
    const seedRow = (snapshotSeedRow(seedFor(entity)) ?? {}) as Row;

    for (const field of declaredProperties(entity, "update")) {
      const probe = validProbeFor(entity, "update", field, seedRow[field]);
      if (same(probe, seedRow[field])) {
        dead += 1;
        findings.push(`${entity}.${field}: the derived probe equals the stored value — it cannot move the field`);
        continue;
      }
      probed += 1;
      const { before, stored, plan, threw } = await updateWith(entity, field, probe);

      // A refusal the card DISCLOSES is agreement — the guard worked and the
      // user was told. A throw is the loud form of the same thing.
      //
      // ★★ `rejectedFields` IS REUSED FROM THE FIXTURES MODULE RATHER THAN
      //  RE-DERIVED, and that matters: a rejection detail is not always
      //  `${field}=${value}` — a joint `requiredNonEmptyGroups` refusal is
      //  spelled `${a}+${b}=empty`, so a naive `startsWith(field + "=")` misses
      //  it. A MISSED rejection does not read as "no outcome" here; it reads as
      //  a field that was offered and silently did nothing, which is a
      //  fabricated finding in the direction that wastes the most time.
      const refused = threw !== undefined || rejectedFields(plan).includes(field);
      if (refused) continue;

      if (same(before[field], stored[field])) {
        findings.push(
          `${entity}.${field}: declared and offered, but a valid ${JSON.stringify(probe)} changed nothing and the card said nothing`,
        );
        continue;
      }
      landed += 1;
    }

    // ★ EXACT, not a `>=` slack bound: `probed + dead` must account for every
    //  declared field. A slack bound cannot tell "the axis shrank" from "two
    //  probes came out dead", and those want opposite responses — the first is a
    //  schema change to investigate, the second a `validProbeFor` shape to fix.
    expect(probed + dead, `${entity}: Relation B did not reach every declared field`).toBe(
      AXIS_BASELINE[entity].declared,
    );
    // ★★★ FLOOR 2 — A POSITIVE OBSERVABLE PER ENTITY. Every branch above is
    //  satisfied by a replay that writes NOTHING: a missing `expectedToken`, a
    //  renamed tool, a wrapper that never mounts the provider each turn the
    //  whole entity green while proving nothing. This demands that some declared
    //  field, driven by some probe, actually moved.
    expect(landed, `${entity}: no declared field landed — the harness wrote nothing`).toBeGreaterThan(0);
    expect(findings, `${findings.length} declared fields that do not work`).toEqual([]);
  });
});
```

`snapshotSeedRow` already exists — Task 3 added it beside `seedFor`, because Relation A needs the
seeded value to type its own probe. Do not add a second copy.

- [ ] **Step 4: Run it and record**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts > "$SCRATCH/t4.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t4.log"
grep -E "declared fields that do not work|changed nothing|derived probe equals" "$SCRATCH/t4.log"
```

Expected: the mail guard passes. Relation B may be red; copy its finding lines to `$SCRATCH/relation-b-update-baseline.txt`.

A `derived probe equals the stored value` finding is a **probe defect, not a product defect** — fix `validProbeFor` for that shape and re-run. It is listed as a finding rather than thrown so one bad shape does not hide the rest of the entity's axis.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
git add src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
git commit --only src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts -m "$(cat <<'EOF'
test(ai): Relation B update arm -- a declared field must land or be refused

436's own prescribed detector, in its words: something that asserts each
allow-list still ADMITS the fields the tool schema advertises. 436 measured that
narrowing ABSENCE_FIELD_GUARDS.note to () => false leaves the existing sweep
green with byte-identical per-entity violation counts, because the preview reads
the same table object via rawTypeGuards and both sides move together. This
relation reads the schema, which that table cannot move.

The probe must be VALID here where Relation A's must be invalid: this asks
whether an offered field works, so a value the sanitizer legitimately rejects
would report a lost capability where the guard is doing its job. Derived from
the seed's own value mutated in kind, so dates and times work without a format
table that could rot into an exemption list.

Carries the sendInvitations guard, sited outside the loop: that field is
declared and boolean, a strict true trips shouldStage and mails the attendees in
production, and whether a unit-test replay can send that mail is UNKNOWN rather
than known-safe. The safety was contingent on a seed value in another file and
is now asserted.
EOF
)"
```

---

## Task 5: Relation B — the create arm

**Files:**
- Modify: `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`

- [ ] **Step 1: Add the create arm inside the existing Relation B describe block**

```ts
  // ★★★ THE CREATE ARM HAS NO REJECTION BRANCH, AND WRITING IT AS THOUGH IT DID
  //  IS THE TRAP THIS COMMENT EXISTS FOR. The create branch of
  //  `describeEntityCalls` pushes link diffs and a `plan.creates` entry and
  //  emits NO `rejected` entries whatever — `plan.rejected.push` appears five
  //  times in `plan.ts` and not one of them is in it. So there is nothing for a
  //  "or the card refused it" disjunct to fall through to, and this arm asserts
  //  LANDING ONLY.
  //
  //  ★★ THAT MAKES THE PROBE'S VALIDITY LOAD-BEARING in a way the update arm's
  //   is not. With no refusal channel, a guard correctly rejecting a bad value
  //   is indistinguishable from a lost capability. `validProbeFor` derives from
  //   the seed's own value for exactly this reason.
  //
  //  ★★★ THE COMPARISON GOES THROUGH `previewNormalizerFor`, NOT AGAINST THE
  //   RAW PROBE. That is the production resolution order (descriptor entry →
  //   numeric coercion → verbatim), the same one the card renders with. A raw
  //   comparison reports a violation on every CORRECT write of a normalised
  //   field, which on the first cut of the update sweep was 6 of 35 "findings"
  //   — the harness, not the product.
  it("create: every declared field lands on the created row", async () => {
    const findings: string[] = [];
    let landed = 0;
    let probed = 0;
    const s = seedFor(entity);
    const seedRow = (snapshotSeedRow(s) ?? {}) as Row;

    for (const field of declaredProperties(entity, "create")) {
      const probe = validProbeFor(entity, "create", field, seedRow[field]);
      probed += 1;
      const { row, threw } = await createWith(entity, { [field]: probe });
      if (threw !== undefined) {
        findings.push(`${entity}.${field}: create THREW on a valid ${JSON.stringify(probe)} — ${threw}`);
        continue;
      }
      if (!row) {
        findings.push(`${entity}.${field}: the create stored no row at all`);
        continue;
      }
      const normalize = previewNormalizerFor(INLINE_DESCRIPTORS[entity], field);
      const shown = normalize ? normalize(probe, row as Record<string, unknown>) : String(probe ?? "");
      const actual = normalize ? normalize(row[field], row as Record<string, unknown>) : String(row[field] ?? "");
      if (shown !== actual) {
        findings.push(
          `${entity}.${field}: create was offered the field and dropped it — sent ${JSON.stringify(shown)}, stored ${JSON.stringify(actual)}`,
        );
        continue;
      }
      landed += 1;
    }

    expect(probed, `${entity}: Relation B's create arm ran over an empty declared axis`).toBe(
      AXIS_BASELINE[entity].declared,
    );
    // Floor 2 again, for this arm. Every branch above is satisfied by a create
    // that stores nothing, and `!row` would then be the only signal — which the
    // `CREATE_BASE` floor in Task 2 already rules out for a different reason.
    expect(landed, `${entity}: no declared field landed on a created row`).toBeGreaterThan(0);
    expect(findings, `${findings.length} declared fields the create path drops`).toEqual([]);
  });
```

- [ ] **Step 2: Run and record**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts > "$SCRATCH/t5.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t5.log"
grep -E "declared fields the create path drops|dropped it|create THREW" "$SCRATCH/t5.log"
```

Copy findings to `$SCRATCH/relation-b-create-baseline.txt`.

A `create THREW` line on a field the schema declares is itself a finding worth reporting at the gate — the model is offered a field whose valid value the writer refuses loudly.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
git add src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
git commit --only src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts -m "$(cat <<'EOF'
test(ai): Relation B create arm -- landing only, no rejection branch

The create branch of describeEntityCalls emits no plan.rejected entries at all
(plan.rejected.push appears five times in plan.ts, none of them in it), so a
create card has no channel to disclose a refusal and this arm asserts landing
only.

Two consequences it carries. The probe must be valid for the field's declared
type or enum, because with no refusal channel a guard correctly rejecting a bad
value is indistinguishable from a lost capability. And the comparison goes
through previewNormalizerFor rather than against the raw probe -- the same
production resolution order the card renders with. A raw comparison reports a
violation on every correct write of a normalised field; on the update sweep's
first cut that shape was 6 of 35 findings, all harness rather than product.

That a create card cannot disclose a refusal at all is filed separately.
EOF
)"
```

---

## Task 6: Repoint the §437 ratchet at the shared axis

**Files:**
- Modify: `src/app/inline-ai-edit/plan.model-writable-surface.test.ts`

- [ ] **Step 1: Replace the local `PERSISTED_COLUMNS` with the import**

Delete the eight CSV column imports and the local `const PERSISTED_COLUMNS` declaration from `src/app/inline-ai-edit/plan.model-writable-surface.test.ts`, and import it instead:

```ts
import { PERSISTED_COLUMNS } from "../../test/offered-surface-axis";
```

Keep the docstring that sat above the local declaration, moved to a cross-reference note where the declaration was:

```ts
/** `PERSISTED_COLUMNS` now lives in `src/test/offered-surface-axis.ts`, shared
 *  with `plan.offered-surface-sweep.test.ts`. Its docstring there carries the
 *  reason the CSV column lists are the right source: `ai-entity-token.ts`'s
 *  `ProjectedRows` already makes tsc prove each array covers its entity type,
 *  so a persisted field cannot fail to appear and this file then forces a
 *  decision about it.
 *
 *  ★★ THE TWO DETECTORS ASK DIFFERENT QUESTIONS AND NEITHER REPLACES THE OTHER.
 *  This file is STATIC accounting at zero runtime cost — "is every persisted
 *  column accounted for by the sweep's axis?" — and it catches a new column
 *  arriving unswept before anyone writes a probe for it.
 *  `plan.offered-surface-sweep.test.ts` is BEHAVIOURAL — "does an undeclared
 *  field actually land, and does a declared one actually work?" — and it costs a
 *  dispatcher mount per field. Deleting either leaves a hole the other does not
 *  cover.
 *
 *  ★ `UNSWEPT_BY_DESIGN.task` stays long here because `update_task` uses a
 *  genuine whitelist (`buildPatch`), reasoning the schema axis does not
 *  reproduce — so this file's axis is deliberately NOT re-based on
 *  `declaredProperties`. */
```

- [ ] **Step 2: Run both detectors and confirm the ratchet's test count is unchanged**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.model-writable-surface.test.ts > "$SCRATCH/t6.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t6.log"
```
Expected: EXIT=0, `Tests  24 passed (24)` — unchanged from before the lift. A moved count means the lift changed behaviour.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
git add src/app/inline-ai-edit/plan.model-writable-surface.test.ts
git commit --only src/app/inline-ai-edit/plan.model-writable-surface.test.ts -m "$(cat <<'EOF'
test(ai): the 437 ratchet reads the shared PERSISTED_COLUMNS

One definition of "the persisted surface", imported by both detectors, rather
than two private copies that can come to disagree about what was covered.

Records why neither detector replaces the other: this one is static accounting
at zero runtime cost and catches a new column arriving unswept before anyone
writes a probe for it; the offered-surface sweep is behavioural and costs a
dispatcher mount per field. Its axis is deliberately NOT re-based on the schema
-- UNSWEPT_BY_DESIGN.task is long because update_task uses a genuine whitelist,
reasoning the schema axis does not reproduce.
EOF
)"
```

---

## Task 7: The baseline run

**Files:** none modified. This task produces measurements.

- [ ] **Step 1: Run the whole inline-ai-edit suite once, serially**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/ > "$SCRATCH/baseline.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/baseline.log"
```

- [ ] **Step 2: Extract the per-entity finding counts**

```bash
grep -cE "stored the model's undeclared value" "$SCRATCH/baseline.log"
grep -cE "changed nothing and the card said nothing" "$SCRATCH/baseline.log"
grep -cE "create was offered the field and dropped it" "$SCRATCH/baseline.log"
grep -E "^\s+(→|-) .*(offered-surface|undeclared|dropped it)" "$SCRATCH/baseline.log" | sort -u
```

- [ ] **Step 3: Write the baseline record**

Save to `$SCRATCH/offered-surface-baseline.md` a table of entity × relation × finding count, plus the full field names. Task 8 compares mutant runs against these numbers and Task 10 reports them.

**Record the RUNTIME TEST COUNT of `plan.offered-surface-sweep.test.ts` in that file**, from its own line in the vitest output. Task 8's mutant scorecards need it for the sum check.

- [ ] **Step 4: Run the shuffled suite once**

```bash
npm run test:shuffle > "$SCRATCH/shuffle.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/shuffle.log"
```

This is the only local reproduction of CI's `unit-tests-shuffled` job, and this slice adds a file that mints ids from a module-scoped minter — exactly the shape that breaks under reordering. Any *new* failure here that is not one of the recorded findings is an order dependence in the new file, and must be fixed before Task 8.

---

## Task 8: The six acceptance mutants

**Files:** each mutant temporarily edits one file and reverts it.

**The scorecard rule.** The detector is expected to be RED at baseline, and *a deliberately-red suite masks a mutant* — a pass/fail tally can be identical before and after. So every mutant below is recorded as a **per-case FINDING COUNT delta against Task 7's baseline**, not as a pass/fail tally alone. Where the tally is meaningful, record it as **`N failed / M passed` with the sum equal to the file's runtime test count** from Task 7 Step 3.

**Every mutant follows this shape:**

1. Apply with the Edit tool (CRLF files — never `sed -i`).
2. **Assert it landed:** `git diff --stat` must show exactly the expected file and roughly the expected insertion count, and `grep -c '<mutant anchor>' <file>` must be exactly 1. A mutant that did not land makes a surviving-mutant report a lie.
3. Run, redirect, `echo "EXIT=$?"` unpiped, grep the log.
4. Revert with an anchored inverse Edit, asserting uniqueness in **both** directions — the original text must match exactly once after reverting, and the mutant text zero times.
5. End on `git diff --stat` reporting **empty**.

`git checkout -- <file>` is deny-blocked; `git stash` must never be run here.

- [ ] **Mutant 1 — Relation A, denylist entity, create path**

In `src/app/use-register-tools.ts`, drop the guard from the stakeholder create site:

```
- const item = sanitizeStakeholder({ ...dropUnacceptedStakeholderFields(input), id, raci: {} });
+ const item = sanitizeStakeholder({ ...input, id, raci: {} });
```

Run: `npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`

Expected: Relation A's `stakeholder` **create** case gains findings against baseline (`resourceId`, `raci` are on its undeclared axis). Record the delta.

- [ ] **Mutant 2 — Relation A, denylist entity, update path**

In `src/app/use-chat-dispatcher.ts`, drop the guard from the resource update site:

```
- { ...existing, ...dropUnacceptedResourceFields(patch), ...(renamed ?? {}), id, localModifiedAt }
+ { ...existing, ...patch, ...(renamed ?? {}), id, localModifiedAt }
```

Expected: Relation A's `resource` **update** case gains findings (`birthday`, `utilization`, `utilizationMode`, `absenceOverride`, `active` are on its undeclared axis). Record the delta.

- [ ] **Mutant 3 — Relation A, allowlist entity, create path**

In `src/app/use-register-tools.ts`, drop the guard from the calendarEvent create site:

```
- const item = sanitizeCalendarEvent({ ...dropUnacceptedCalendarEventFields(input), id });
+ const item = sanitizeCalendarEvent({ ...input, id });
```

Expected: Relation A's `calendarEvent` **create** case gains a finding on `exceptions`. This is §438's own defect, reintroduced.

**★★★ Mutate the CALL SITE, never the guard table.** For `absence` and `calendarEvent` the preview reads the same table object through `rawTypeGuards`, so a table mutant moves both sides at once and the detector certifies itself. §436 is the measurement of exactly that.

- [ ] **Mutant 4 — Relation B, allowlist entity: §436's own reproduce**

In `src/app/sanitize-records.ts`, narrow one `ABSENCE_FIELD_GUARDS` row:

```
- note: (v) => typeof v === "string",
+ note: () => false,
```

**Run BOTH detectors in one invocation**, so the contrast is recorded rather than asserted:

```bash
npx vitest run --maxWorkers=1 \
  src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts \
  src/app/inline-ai-edit/plan.write-path-sweep.test.ts \
  > "$SCRATCH/m4.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/m4.log"
```

Expected, and this is the mutant the whole slice exists for:
- **new detector RED** — Relation B's `absence` update case gains a finding on `note`;
- **`plan.write-path-sweep.test.ts` byte-identical to its baseline**, per §436's measurement.

Record both halves. If the old sweep also moves, §436's measurement no longer holds and that is worth knowing before anything else in this task is trusted.

This is the one table mutant in the set, and it is legitimate precisely because Relation B does **not** read that table — it reads the schema.

- [ ] **Mutant 5 — Relation B, denylist entity**

In `src/app/sanitize-records.ts`, narrow one `RAID_FIELD_GUARDS` row that names a DECLARED field. Confirm the field is declared first:

```bash
node -e "const{TOOL_DEFS}=require('./src/app/chat-tool-defs');" 2>/dev/null || \
grep -n "raidFields" -A 40 src/app/chat-tool-defs.ts | grep -oE "^[0-9]+-  [a-zA-Z0-9_]+:" | head -20
```

Pick a declared string field and narrow its guard row to `() => false`.

★★ **CORRECTED 2026-09-08 after the run.** This step originally suggested `owner` or `mitigation`. NEITHER has a row in `RAID_FIELD_GUARDS` — reproduce with `grep -n "RAID_FIELD_GUARDS" -A 30 src/app/sanitize-records.ts`, whose rows are `knowledgeLinks`, `ownerResourceId`, `category`, `status`, `severity`, `probability`, `impact`, `raisedDate`, `targetDate` and `closedDate`. `severity` was used instead. The "whichever the grep confirms" hedge was doing real work and the two examples beside it were not — a reader who trusted the examples over the hedge would have narrowed a row that does not exist and read the resulting green as a surviving mutant.

Expected: Relation B's `raid` update case gains a finding on that field.

- [ ] **Mutant 6 — the axis itself**

In `src/test/offered-surface-axis.ts`, force one entity's declared set empty:

```
  export function declaredProperties(entity: InlineEntity, op: "create" | "update"): readonly string[] {
+   if (entity === "stakeholder") return [];
```

Expected: **floor 1 fires** (`stakeholder` declared 0 ≠ 8). Floor 3 does NOT fire, and cannot.

★★★ **CORRECTED 2026-09-08 — THE ORIGINAL ACCEPTANCE WAS FALSIFIED BY THE RUN.** It read: "**floor 1 fires** … **and floor 3 fires** (the union no longer covers the persisted columns). Both must go red. A mutant that moves only floor 1 means floor 3 is not doing the job it was written for." Floor 3 PASSED, and it is structurally incapable of firing on an axis collapse: `undeclaredColumns` is `PERSISTED_COLUMNS` MINUS `declaredProperties`, and floor 3 asserts `[...offered, ...undeclaredColumns] === columns`. Emptying the declared set moves all eight fields out of the first term of that union and into the second, so the equality holds BY CONSTRUCTION — the two terms are complements of one another over the same base. Floor 1 is the only floor that catches an axis collapse, which is exactly what floor 1's own docstring claims for itself ("the axis has not silently collapsed").

★★ **THE CODE NEEDS NO CHANGE — this is a correction to the ACCEPTANCE TEXT, not a defect finding.** Reading the original wording literally would send someone "fixing" floor 3 to make it catch a collapse, which would mean re-basing it off something other than `declaredProperties` and destroying the structural property that makes it need no re-baselining. Floor 1 and floor 3 answer different questions on purpose; only one of them answers this one.

**Mutating the fix without mutating the detector proves only half.** This is the mutant that proves the axis is load-bearing rather than decorative.

- [ ] **Final step: prove the tree is clean**

```bash
git diff --stat; echo "EXIT=$?"
git status --porcelain
```
Expected: `git diff --stat` empty. `git status --porcelain` shows **only** ` M sample-workspace-huge.json` and `?? not-in-use.env.local.bak`, both of which were dirty before this slice began and must never be staged.

---

## Task 9: Close §436 and §439, mint §440

**Files:**
- Modify: `docs/open-followups.md` (LF-only)

- [ ] **Step 1: Confirm the register max before minting**

```bash
git fetch origin --quiet
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```
Expected: `451`. A follow-up number is reserved only once it is on `origin/main`, and two branches have already minted the same one. This slice may use **440–449**; take **440**.

- [ ] **Step 2: Close §439**

Retitle the heading to `— CLOSED 2026-09-08`, update its index row to match, and add the resolution plus the correction the spec records:

```markdown
**Resolution:** CLOSED 2026-09-08 by `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`,
which drives every entity's `create_*` tool as well as its `update_*` one, on an axis taken from
`TOOL_DEFS` rather than from any registry the guard tables control.

★★★ **THIS ENTRY'S OWN TEXT WAS WRONG ABOUT `createTool`, AND THE ERROR OVERSTATED THE WORK.** It
said "`sweepPlumbing` reads `INLINE_DESCRIPTORS[entity].updateTool`; there is no `createTool` to
read." The first clause is true and the second is false: `createTool` is a declared member of
`InlineEntityDescriptor` and all eight entities carry one — `chat-proposal-describe.ts` indexes
`toolEntity[d.createTool]` off exactly that. `sweepPlumbing` simply hardcodes `updateTool`. A reader
who believed the entry budgeted for adding a descriptor member that had been there all along. The
same sentence sat in the header of `plan.create-path-guards.test.ts` and is corrected there too.
Reproduce: `grep -c 'createTool: "create_' src/app/inline-ai-edit/entity-descriptor.ts` → **8**.
```

- [ ] **Step 3: Close §436**

Retitle to `— CLOSED 2026-09-08`, update its index row, and add:

```markdown
**Resolution:** CLOSED 2026-09-08 by Relation B of
`src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`, which is this entry's own prescribed
detector — "something that asserts each allow-list still ADMITS the fields the tool schema
advertises". It reads `TOOL_DEFS`, which a guard-table edit cannot move, so the self-certification
this entry measured cannot arise.

★ The measurement stands and was re-run as acceptance mutant 4: narrowing `ABSENCE_FIELD_GUARDS.note`
to `() => false` turns the new detector RED on `absence.note` while
`plan.write-path-sweep.test.ts` stays byte-identical to its baseline. Both halves were run in ONE
invocation so the contrast is recorded rather than asserted.
```

- [ ] **Step 4: Cross-reference from §437**

Append to §437's body:

```markdown
★ The behavioural counterpart is `plan.offered-surface-sweep.test.ts` (§439/§436). It asks whether a
field ACTUALLY lands, where this entry's ratchet asks whether a column is ACCOUNTED FOR, and the two
are complementary rather than redundant — deleting either leaves a hole the other does not cover.
This entry's `UNSWEPT_BY_DESIGN.task` list is long because `update_task` uses a genuine whitelist
(`buildPatch`), reasoning the schema axis does not reproduce, so its axis is deliberately NOT
re-based on `declaredProperties`.
```

- [ ] **Step 5: Mint §440 for the create-card disclosure gap**

Add a new heading and index row:

```markdown
## 440. A create card discloses a title and links only, and has no channel to disclose a refusal — OPEN

**Status:** OPEN 2026-09-08 — measured while building §439's detector, not by looking for it.
Reproduce with `grep -n "plan.rejected.push" src/app/inline-ai-edit/plan.ts` (**5** hits, none of
them inside the `CREATE_TOOLS` branch) and `grep -n "plan.creates.push" src/app/inline-ai-edit/plan.ts`.

The create branch of `describeEntityCalls` pushes link diffs and a `plan.creates` entry carrying
`{ entity, title, toolName, input }`. It emits no `FieldDiff` and no `Rejected`. So a user approving
"Create RAID item: Payment timeout" is approving a row with a dozen fields set, and if the writer
silently drops one of them the card had no way to say so.

★★ TWO DEFECTS, ONE SURFACE, and they want deciding together: the card does not ENUMERATE what a
create will write, and it cannot DISCLOSE a refusal. §439's Relation B works around the second by
asserting landing only on its create arm — a narrower claim than its update arm makes, stated in the
test's own comment.

★ Deliberately NOT closed by §439. A literal preview⟺write relation for create would fire on nearly
every field for a single designed reason, and closing that with an exemption list is the shape that
hid §438 inside §437's ratchet. This is a product change with its own review surface.
```

- [ ] **Step 6: Run the two register gates**

```bash
npm run followups:index:check > "$SCRATCH/idx.log" 2>&1; echo "EXIT=$?"
npm run followups:status:check > "$SCRATCH/status.log" 2>&1; echo "EXIT=$?"
```
Expected: both EXIT=0.

**Exit 1 and exit 2 mean opposite things.** 1 is drift — write the missing row, fix the heading. **2 is the gate unable to scan at all** (markers missing or duplicated, either set empty, under the per-axis floor), and a scan that reads nothing passes everything. Never answer a 2 by editing entries.

- [ ] **Step 7: Confirm the register is still LF-only and commit**

```bash
node -e "console.log((require('fs').readFileSync('docs/open-followups.md','utf8').match(/\r/g)||[]).length)"
```
Expected: `0`.

```bash
git add docs/open-followups.md
git commit --only docs/open-followups.md -m "$(cat <<'EOF'
docs(followups): close 436 and 439, mint 440, correct 439's own text

439 is closed by the offered-surface sweep driving create_* as well as update_*
on a schema-derived axis. 436 is closed by that sweep's Relation B, which is the
entry's own prescribed detector -- something that asserts each allow-list still
admits the fields the tool schema advertises -- and which reads TOOL_DEFS, a
source a guard-table edit cannot move.

439's own text said there is no createTool to read. False: it is declared on
InlineEntityDescriptor and all eight entities carry one; sweepPlumbing simply
hardcodes updateTool. The error overstated the work, so it is corrected in the
same commit that closes the entry.

440 files what 439 deliberately does not close: a create card discloses a title
and links only and has no channel to disclose a refusal, so Relation B's create
arm asserts landing only. Closing that with an exemption list is the shape that
hid 438 inside 437's ratchet, so it wants a product decision instead.
EOF
)"
```

---

## Task 10: Report and STOP

**Files:** none. This task produces a report and ends the slice.

- [ ] **Step 1: Re-run the full unit suite once, serially**

```bash
npm run test:run > "$SCRATCH/final.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/final.log"
```

- [ ] **Step 2: Run the remaining gates that this slice can move**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
npm run size:check > "$SCRATCH/size.log" 2>&1; echo "EXIT=$?"
npm run docs:symbols:check > "$SCRATCH/symbols.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check > "$SCRATCH/claims.log" 2>&1; echo "EXIT=$?"
```

Expected: tsc, eslint, size, symbols and claims all EXIT=0. `npm run test:run` may be non-zero for exactly the recorded findings and nothing else — **verify that**, do not assume it.

- [ ] **Step 3: Report to the user and stop**

Report, in this order:

1. **Per-entity finding counts**, Relation A create / A update / B create / B update, with every field named.
2. **The mutant scorecard** — six rows, each a finding-count delta against the Task 7 baseline, with mutant 4 carrying both halves of its contrast.
3. **Which findings look like real undisclosed writes** versus which look like harness artefacts, with the reasoning for each. Do not present a judgement as a measurement.
4. **The branch state:** commits made, gates green, and whether `npm run test:run` is red and for exactly which assertions.

Then **STOP and ask for a go/cut decision.**

**Do not fix a single finding. Do not push. Do not open an MR.** The slice ends here by design: the finding count was unknown when it started, and turning an unbounded discovery into an unbounded fix without a decision is what this gate exists to prevent.

---

## Notes for whoever executes this

**On the branch ending red.** Tasks 3–5 each say the new test may fail at baseline. That is the detector reporting, not the plan going wrong. What would be wrong is making it green — by exempting a field, by narrowing a probe, or by weakening a floor. Each of those has a precedent in this repo where it hid a live defect, and the comments in the code say which.

**On `already-red-suite-masks-a-mutant`.** With the detector red at baseline, a mutant can leave the pass/fail tally completely unchanged while changing what was found. Compare per-case finding COUNTS. Two of six kills in an earlier round left the tally identical.

**On reverting mutants.** A shorter revert anchor has previously matched elsewhere, reported success, and left a live mutant in the tree. Assert uniqueness in both directions and end on an empty `git diff --stat`, every time. A file left dirty outside its brief scope is the tell.

**On the i18n files.** `src/app/i18n.ts` and `src/app/i18n.de.ts` are off limits — a peer session owns them. No task here needs a key. If a later phase does, hand the key plus EN and DE to that session rather than editing either file.
