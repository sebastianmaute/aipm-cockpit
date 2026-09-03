# AI Write Safety and Response Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop an AI `update_*` call from silently overwriting a concurrent human edit, and stop `list_tasks` from spending the context window on rich-text markup.

**Architecture:** A pure module derives a concurrency token by hashing each entity's existing byte-stable CSV projection minus a per-entity exclusion set. Reads hand the token out, writes require it back and refuse on mismatch or absence. Response cost is a separate, independent phase that adds a `{items, total, limit}` envelope and plain-texts rich fields on the `list_tasks` path only.

**Tech Stack:** TypeScript, React, vitest. No new dependencies.

**Branch:** `fix/turso-env-disclosure` — fold in, no new branch. No release, no version bump.

---

## Scope discovery — read this before starting

The approved spec assumed the token could be derived inside `runTool`. Three facts found while
planning change the size, and none of them invalidate the design:

1. **`ToolDispatcher` cannot reach five of the six entities in full.** It exposes
   `getTask(id): Task | null` (full) and `getResource(id): ResourceSummary | null` (summary), and
   **no getter at all** for RAID, Change, Milestone or Stakeholder. `listRaid()` and peers return
   `RaidSummary`/`ChangeSummary`/`MilestoneSummary`/`StakeholderSummary`, which omit exactly the rich
   fields an edit is most likely to touch. Deriving a token from a summary would be a false *permit*
   for every omitted field. Phase 1 therefore adds five full-entity getters first.
2. **The rows live in two different files.** `raidRef`, `changesRef`, `milestonesRef` and
   `stakeholdersRef` are in `src/app/use-register-tools.ts`; `resourcesRef` and `tasksRef` are in
   `src/app/use-chat-dispatcher.ts`. The getters split accordingly.
3. **`update_task` has two non-chat callers**, both flagged in the spec's risks and now located:
   `src/app/inline-ai-edit/entity-descriptor.ts` (inline AI edit) and the insights recommendation
   path (`src/app/insights/insight.ts`, `recommend-plan.ts`, `recommend.ts`). A required token breaks
   both. Task 8 handles them explicitly.

**Phase 2 is smaller than the spec implied and the plan says so.** The spec argued from "seven
rich-HTML fields feeding the same context window". On the *list* path that is overstated: four of the
five non-task list tools already project to summaries carrying no rich HTML at all. Only
`list_tasks` returns full `Task` rows, so `Task.description` and `Task.noteLog` are the whole
slimming target. The change is still worth making — `list_tasks` is the highest-volume read — but do
not expect a seven-field win, and do not repeat the seven-field claim in a commit message.

**The two phases are independently shippable.** Phase 2 does not depend on Phase 1. If Phase 1 runs
long, ship Phase 2 on its own.

---

## File structure

| File | Responsibility |
|---|---|
| `src/app/ai-entity-token.ts` | **Create.** Pure. Owns the exclusion sets, the per-entity projection, and `entityToken()`. No React, no DOM, no i18n. |
| `src/app/ai-entity-token.test.ts` | **Create.** Both directions per entity, plus the disjointness invariant. |
| `src/app/chat-tools.ts` | **Modify.** Five new `ToolDispatcher` members; token check in six `update_*` cases; `list_tasks` envelope. |
| `src/app/use-register-tools.ts` | **Modify.** Four full-entity getters over the existing refs. |
| `src/app/use-chat-dispatcher.ts` | **Modify.** One full-entity getter for Resource. |
| `src/app/chat-tool-defs.ts` | **Modify.** Add the required `expectedToken` input to six update schemas. |
| `src/app/inline-ai-edit/entity-descriptor.ts` | **Modify.** Thread a token through the inline-edit call. |
| `src/app/insights/recommend-plan.ts` | **Modify.** Attach a token when building a recommendation's tool call. |

★ `ai-entity-token.ts` is a `.ts` file and therefore **coverage-gated** (`vitest.config.ts` floors).
It is real logic, not UI glue, so it must NOT be added to `coverage.exclude` — its own tests carry it.

---

## Ground rules for every task

- **`src/app/*.ts(x)` are CRLF.** Use the **Edit** tool only. Never `Write` on an existing file
  (it re-lines to LF), never `sed -i`. New files are fine with `Write`.
- **Never read a gate's exit code through a pipe.** Redirect, echo `$?`, then grep the file.
- **Mutation-prove every guard.** Apply the mutant, assert it LANDED, run, read *which* cases fail,
  then revert by an inverse anchored Edit and prove `git diff --stat` is empty for that file.
  `git checkout -- <file>` is deny-blocked.
- **Never `git add -A` or `git add .`** — `not-in-use.env.local.bak` is untracked, unignored, and
  holds live credentials. `sample-workspace-huge.json` is modified by another writer. Commit with
  `git commit --only <paths>`.
- Commit messages end with `Claude-Session: https://[session link removed]`.

---

# PHASE 1 — Write safety

## Task 1: The token module

**Files:**
- Create: `src/app/ai-entity-token.ts`
- Test: `src/app/ai-entity-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/ai-entity-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { entityToken, TOKEN_EXCLUDED, type TokenEntity } from "./ai-entity-token";
import type { Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Ship it",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "<p>original</p>",
    ...overrides,
  } as Task;
}

describe("entityToken", () => {
  it("is stable for an unchanged entity", () => {
    expect(entityToken("task", task())).toBe(entityToken("task", task()));
  });

  it("changes when a COVERED field changes", () => {
    // The positive direction. Without it a constant would pass every other case.
    expect(entityToken("task", task({ description: "<p>edited</p>" })))
      .not.toBe(entityToken("task", task()));
    expect(entityToken("task", task({ status: "Done" })))
      .not.toBe(entityToken("task", task()));
  });

  it("does NOT change when an EXCLUDED field changes", () => {
    // The negative direction, and the reason the exclusion set exists: a Jira
    // sync stamp or a note append must not refuse an unrelated edit.
    for (const field of TOKEN_EXCLUDED.task) {
      const mutated = task({ [field]: "2031-01-01" } as Partial<Task>);
      expect(entityToken("task", mutated)).toBe(entityToken("task", task()));
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/ai-entity-token.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Error" /tmp/t.log
```

Expected: FAIL — `Failed to resolve import "./ai-entity-token"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/ai-entity-token.ts`:

```ts
// src/app/ai-entity-token.ts
// Optimistic-concurrency tokens for the AI write path. Pure: no React, no DOM,
// no i18n.
//
// ★★★ THE TOKEN IS DERIVED, NOT STAMPED, AND THAT IS THE WHOLE POINT. The
// obvious alternative is `Task.localModifiedAt` ("used for sync conflict
// detection"), and it was rejected: a stamp is only as good as the set of
// writers that set it, and a write path that forgets to stamp leaves the field
// UNCHANGED after a human edit. The guard then compares two identical values,
// concludes nothing moved, and permits the very overwrite it exists to stop —
// a false PERMIT, the dangerous direction. Measured 2026-09-03 at 68 stamp
// sites across 27 non-test files against 45 `setTasks(` call sites across 17,
// for tasks alone, one of six AI-updatable entities. Deriving from the
// entity's own content makes any change by any writer visible by construction,
// including write paths added years from now.
//
// ★★ IT RIDES THE BYTE-STABLE CSV SERIALIZERS ON PURPOSE. `golden-workspace.test`
// pins their exact output, so a silent change to what they emit fails CI. That
// is the property this module borrows; do not reimplement the projection.
import {
  CSV_COLUMNS, fieldToString,
  RAID_CSV_COLUMNS, raidFieldToString,
  MILESTONES_CSV_COLUMNS, milestoneFieldToString,
  CHANGES_CSV_COLUMNS, changeFieldToString,
  STAKEHOLDERS_CSV_COLUMNS, stakeholderFieldToString,
  RESOURCES_CSV_COLUMNS, resourceFieldToString,
} from "./csv-codecs-core";

export type TokenEntity =
  | "task" | "raid" | "milestone" | "change" | "stakeholder" | "resource";

/** Columns deliberately OUTSIDE the token, per entity.
 *
 *  ★★★ A FIELD MAY BE EXCLUDED ONLY IF NO AI TOOL CAN WRITE IT. Excluding a
 *  writable field reintroduces a false permit for exactly that field — two
 *  writers could both change it with neither detected. This is not a
 *  convention to remember: `ai-entity-token.test.ts` asserts the exclusion set
 *  is disjoint from the AI-writable field set, so adding a tool that writes an
 *  excluded field turns that test red.
 *
 *  Each entry is bookkeeping that moves without anyone editing the substance
 *  the model is acting on:
 *    localModifiedAt  self-referential — including it makes this the stamp
 *                     approach the header rejects
 *    lastSyncedAt     Jira sync bookkeeping
 *    outlookEventId   calendar write-back bookkeeping
 *    inquiriesSent    a counter bumped by sending a status inquiry
 *    noteLog          a dated append; adding a note does not invalidate an
 *                     edit to other fields */
export const TOKEN_EXCLUDED: Readonly<Record<TokenEntity, readonly string[]>> = {
  task: ["localModifiedAt", "lastSyncedAt", "outlookEventId", "inquiriesSent", "noteLog"],
  raid: ["localModifiedAt", "outlookEventId", "noteLog"],
  milestone: ["localModifiedAt", "outlookEventId"],
  change: ["localModifiedAt", "outlookEventId", "noteLog"],
  stakeholder: ["localModifiedAt"],
  resource: ["localModifiedAt"],
};

type Projector = {
  columns: readonly string[];
  render: (entity: never, column: never) => string;
};

const PROJECTORS: Readonly<Record<TokenEntity, Projector>> = {
  task: { columns: CSV_COLUMNS as readonly string[], render: fieldToString as Projector["render"] },
  raid: { columns: RAID_CSV_COLUMNS as readonly string[], render: raidFieldToString as Projector["render"] },
  milestone: { columns: MILESTONES_CSV_COLUMNS as readonly string[], render: milestoneFieldToString as Projector["render"] },
  change: { columns: CHANGES_CSV_COLUMNS as readonly string[], render: changeFieldToString as Projector["render"] },
  stakeholder: { columns: STAKEHOLDERS_CSV_COLUMNS as readonly string[], render: stakeholderFieldToString as Projector["render"] },
  resource: { columns: RESOURCES_CSV_COLUMNS as readonly string[], render: resourceFieldToString as Projector["render"] },
};

/** Two independent FNV-1a passes over the same bytes, emitted as one string.
 *
 *  ★★ NOT CRYPTOGRAPHIC, AND IT DOES NOT NEED TO BE — this detects concurrent
 *  edits, it does not resist an attacker; both versions of the record come from
 *  the same trusted store. It IS sync, which `crypto.subtle` is not, and the
 *  token has to be produced inside a synchronous tool dispatch.
 *  ★★ TWO passes with different offsets rather than one: a single 32-bit hash
 *  collides often enough to matter across a long session, and a collision here
 *  is a false PERMIT. Two passes make the effective width 64 bits. */
function hash(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The concurrency token for one entity. Equal tokens mean no covered field
 *  changed; different tokens mean at least one did. */
export function entityToken(kind: TokenEntity, entity: object): string {
  const { columns, render } = PROJECTORS[kind];
  const excluded = new Set(TOKEN_EXCLUDED[kind]);
  const parts: string[] = [];
  for (const column of columns) {
    if (excluded.has(column)) continue;
    // The column name rides along so a value moving BETWEEN columns cannot
    // leave the concatenation unchanged.
    parts.push(column + " " + (render as (e: object, c: string) => string)(entity, column));
  }
  return hash(parts.join(""));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/ai-entity-token.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t.log
```

Expected: EXIT=0, all three passing.

- [ ] **Step 5: Verify every entity projects without throwing**

Some `*FieldToString` take `keyof T`, others take `string`. Confirm all six run:

```bash
npx vite-node -e 'import {entityToken} from "./src/app/ai-entity-token"; for (const k of ["task","raid","milestone","change","stakeholder","resource"]) console.log(k, entityToken(k as never, {id:1} as never));'
```

Expected: six lines, each a 16-character hex token, no throw.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/ai-entity-token.ts src/app/ai-entity-token.test.ts -m "feat(ai): derive concurrency tokens from the byte-stable CSV projection"
```

---

## Task 2: Pin the exclusion-set invariant

**Files:**
- Modify: `src/app/ai-entity-token.test.ts`

This is the guard that keeps the exclusion set honest. It must exist before any tool uses the token.

- [ ] **Step 1: Write the failing test**

Append to `src/app/ai-entity-token.test.ts`:

```ts
import { CHAT_TOOL_DEFS } from "./chat-tool-defs";

describe("the exclusion set is disjoint from what the AI can write", () => {
  // ★★★ EXCLUDING A WRITABLE FIELD REINTRODUCES A FALSE PERMIT for exactly that
  //   field: two writers could both change it with neither detected. This test
  //   is the only thing standing between that rule and good intentions.
  const UPDATE_TOOLS: Record<string, keyof typeof TOKEN_EXCLUDED> = {
    update_task: "task",
    update_raid_item: "raid",
    update_milestone: "milestone",
    update_change: "change",
    update_stakeholder: "stakeholder",
    update_resource: "resource",
  };

  it("names every update tool that exists, so a new one cannot slip past", () => {
    // Anti-vacuity: without this, deleting a row from UPDATE_TOOLS above would
    // silently shrink the check to nothing and still pass.
    const defined = CHAT_TOOL_DEFS.map((d) => d.name).filter((n) => n.startsWith("update_"));
    const covered = Object.keys(UPDATE_TOOLS).concat(["update_settings"]).sort();
    expect(defined.slice().sort()).toEqual(covered);
  });

  it.each(Object.entries(UPDATE_TOOLS))("%s writes no excluded field", (toolName, kind) => {
    const def = CHAT_TOOL_DEFS.find((d) => d.name === toolName);
    expect(def, `${toolName} must exist`).toBeDefined();
    const writable = Object.keys(
      (def!.input_schema as { properties?: Record<string, unknown> }).properties ?? {},
    );
    const overlap = writable.filter((f) => TOKEN_EXCLUDED[kind].includes(f));
    expect(overlap).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/ai-entity-token.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |×|AssertionError" /tmp/t.log
```

Expected: it may FAIL on the export name or on a real overlap. If `CHAT_TOOL_DEFS` is exported
under another name, read it and use the real one:

```bash
grep -nE "^export const [A-Z_]+" src/app/chat-tool-defs.ts
```

If it fails on a genuine overlap, **do not widen the test** — remove that field from
`TOKEN_EXCLUDED`, because the AI can write it and it must be covered.

- [ ] **Step 3: Make it pass, then commit**

```bash
git commit --only src/app/ai-entity-token.test.ts src/app/ai-entity-token.ts -m "test(ai): pin the token exclusion set disjoint from AI-writable fields"
```

---

## Task 3: Full-entity getters for the four register entities

**Files:**
- Modify: `src/app/chat-tools.ts` (the `ToolDispatcher` type)
- Modify: `src/app/use-register-tools.ts`

- [ ] **Step 1: Add the members to `ToolDispatcher`**

In `src/app/chat-tools.ts`, immediately after the `listRaid(): RaidSummary[];` line, add:

```ts
  /** FULL rows, for the concurrency token only.
   *
   *  ★★★ THE SUMMARY GETTERS CANNOT SUBSTITUTE. `RaidSummary` and its peers
   *  omit exactly the rich fields an edit is most likely to touch
   *  (`description`, `mitigation`, …), so a token derived from a summary would
   *  be a false PERMIT for every omitted field. These return the stored row. */
  getRaidRow(id: number): RaidItem | null;
  getChangeRow(id: number): ChangeItem | null;
  getMilestoneRow(id: number): Milestone | null;
  getStakeholderRow(id: number): Stakeholder | null;
```

Add the type imports to the existing `import type { ... } from "./types";` line in that file:
`RaidItem`, `ChangeItem`, `Milestone`, `Stakeholder`.

- [ ] **Step 2: Implement them in `use-register-tools.ts`**

The four refs already exist (`raidRef`, `changesRef`, `milestonesRef`, `stakeholdersRef`,
declared around lines 99-102). Add to the returned object, beside the existing `listRaid`:

```ts
    getRaidRow: (id: number) => raidRef.current.find((r) => r.id === id) ?? null,
    getChangeRow: (id: number) => changesRef.current.find((c) => c.id === id) ?? null,
    getMilestoneRow: (id: number) => milestonesRef.current.find((m) => m.id === id) ?? null,
    getStakeholderRow: (id: number) => stakeholdersRef.current.find((s) => s.id === id) ?? null,
```

- [ ] **Step 3: Typecheck**

`.next/dev/types/routes.d.ts` is currently torn, so a bare `tsc` reports 25 unrelated errors. Use:

```bash
cat > tsconfig.verify.json <<'EOF'
{
  "extends": "./tsconfig.json",
  "include": ["*.d.ts", "vitest.setup.ts", "src/**/*.ts", "src/**/*.tsx", "e2e/**/*.ts"],
  "exclude": ["node_modules", "scripts", ".next", "next-env.d.ts"]
}
EOF
npx tsc --noEmit -p tsconfig.verify.json > /tmp/tsc.log 2>&1; echo "TSC_EXIT=$?"; head -10 /tmp/tsc.log
rm -f tsconfig.verify.json
```

Expected: TSC_EXIT=0. A non-zero exit here names every other place `ToolDispatcher` is constructed —
fix each by adding the four getters.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/chat-tools.ts src/app/use-register-tools.ts -m "feat(ai): expose full register rows to the tool layer"
```

---

## Task 4: Full-entity getter for Resource

**Files:**
- Modify: `src/app/chat-tools.ts`
- Modify: `src/app/use-chat-dispatcher.ts`

- [ ] **Step 1: Add the member**

In `ToolDispatcher`, beside `getResource(id: number): ResourceSummary | null;`:

```ts
  /** The FULL stored resource. `getResource` above returns a SUMMARY and is
   *  the model-facing read; this one exists only to derive the token. */
  getResourceRow(id: number): Resource | null;
```

Add `Resource` to the `import type { ... } from "./types";` line.

- [ ] **Step 2: Implement it**

In `src/app/use-chat-dispatcher.ts`, beside the existing `getTask` (around line 247):

```ts
      getResourceRow: (id) => resourcesRef.current.find((r) => r.id === id) ?? null,
```

- [ ] **Step 3: Typecheck with the same temporary config as Task 3, Step 3. Expected TSC_EXIT=0.**

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/chat-tools.ts src/app/use-chat-dispatcher.ts -m "feat(ai): expose the full resource row to the tool layer"
```

---

## Task 5: Enforce the token on `update_task`

Do ONE entity end-to-end first. Tasks 6 and 7 repeat the shape once it is proven.

**Files:**
- Modify: `src/app/chat-tools.ts`
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/chat-tools.test.ts` (check the existing `makeDispatcher`-style helper in that
file and reuse it; the block below assumes a helper returning a mutable in-memory dispatcher):

```ts
describe("update_task concurrency token", () => {
  it("refuses a stale write AND leaves the entity untouched", async () => {
    // ★★ Asserting only that it threw would pass against a tool that refused
    //    and wrote anyway. The second assertion is the load-bearing one.
    const d = makeDispatcher([task({ id: 1, taskName: "original" })]);
    const stale = entityToken("task", d.getTask(1)!);
    d.updateTask(1, { taskName: "human edit" });      // concurrent human write
    await expect(
      runTool(d, "update_task", { id: 1, expectedToken: stale, taskName: "ai edit" }),
    ).rejects.toThrow(/changed since/i);
    expect(d.getTask(1)!.taskName).toBe("human edit");
  });

  it("refuses when no token is supplied", async () => {
    const d = makeDispatcher([task({ id: 1 })]);
    await expect(
      runTool(d, "update_task", { id: 1, taskName: "ai edit" }),
    ).rejects.toThrow(/expectedToken/i);
  });

  it("accepts a fresh write", async () => {
    // The control. Without it a tool hardcoded to refuse passes both blocks above.
    const d = makeDispatcher([task({ id: 1, taskName: "original" })]);
    const fresh = entityToken("task", d.getTask(1)!);
    await runTool(d, "update_task", { id: 1, expectedToken: fresh, taskName: "ai edit" });
    expect(d.getTask(1)!.taskName).toBe("ai edit");
  });
});
```

- [ ] **Step 2: Run to verify all three fail**

```bash
npx vitest run src/app/chat-tools.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Tests |×" /tmp/t.log
```

Expected: the two refusal tests fail (no error thrown); the control passes already.

- [ ] **Step 3: Implement**

In `src/app/chat-tools.ts`, add above `runTool`:

```ts
/** Re-derive the token for `current` and compare it with what the model sent.
 *  Throws on absence and on mismatch; returns nothing when the write may
 *  proceed.
 *
 *  ★★ ABSENCE IS REFUSED DELIBERATELY. If a missing token meant "skip the
 *  check", a model could bypass the guard entirely by omitting one field — the
 *  guard would then protect only the callers that already cooperate. */
function requireToken(
  kind: TokenEntity,
  current: object,
  input: Record<string, unknown>,
  label: string,
): void {
  const sent = input.expectedToken;
  if (typeof sent !== "string" || sent.length === 0) {
    throw new Error(
      `expectedToken is required for ${label}. Read the ${label} first and pass the token it returns.`,
    );
  }
  const now = entityToken(kind, current);
  if (sent !== now) {
    throw new Error(
      `${label} changed since you read it — re-read it and retry with the new expectedToken.`,
    );
  }
}
```

Import at the top of the file: `import { entityToken, type TokenEntity } from "./ai-entity-token";`

Replace the `update_task` case (currently at `chat-tools.ts:544`):

```ts
    case "update_task": {
      const id = Number(input.id);
      if (!Number.isFinite(id)) throw new Error("id must be a number");
      const current = d.getTask(id);
      if (!current) throw new Error(`task #${id} not found`);
      requireToken("task", current, input, `task #${id}`);
      const patch = buildPatch(input);
      const updated = d.updateTask(id, patch);
      if (!updated) throw new Error(`task #${id} not found`);
      return updated;
    }
```

- [ ] **Step 4: Run to verify all three pass**

```bash
npx vitest run src/app/chat-tools.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t.log
```

Expected: EXIT=0.

- [ ] **Step 5: Mutation-prove the guard**

Apply the mutant with the Edit tool — change `if (sent !== now)` to `if (false)`:

```bash
grep -c "if (false)" src/app/chat-tools.ts   # expect 1 — assert the mutant LANDED
npx vitest run src/app/chat-tools.test.ts > /tmp/m.log 2>&1; echo "MUTANT_EXIT=$?"; grep -E "Tests |×" /tmp/m.log
```

Expected: MUTANT_EXIT=1, and the failing case is "refuses a stale write". Read *which* case failed —
if the "no token" case fails instead, the mutant hit the wrong branch.

Revert by an inverse Edit (`if (false)` → `if (sent !== now)`), then:

```bash
grep -c "if (false)" src/app/chat-tools.ts   # expect 0
git diff --stat src/app/chat-tools.ts        # expect only the intended change
```

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/chat-tools.ts src/app/chat-tools.test.ts -m "fix(ai): refuse a stale or unauthenticated update_task"
```

---

## Task 6: Add `expectedToken` to the six tool schemas

**Files:**
- Modify: `src/app/chat-tool-defs.ts`

- [ ] **Step 1: Read the shape of one definition**

```bash
sed -n '243,275p' src/app/chat-tool-defs.ts
```

- [ ] **Step 2: Add the property to `update_task`, `update_raid_item`, `update_change`, `update_milestone`, `update_stakeholder`, `update_resource`**

For each, add to `input_schema.properties`:

```ts
        expectedToken: {
          type: "string",
          description:
            "REQUIRED. The token returned when you read this record. The write is refused if the record changed since then — re-read and retry with the new token.",
        },
```

and add `"expectedToken"` to that schema's `required` array.

★ Do **not** add it to `update_settings` — settings are not an entity with a token, and Task 2's
first test expects `update_settings` in the uncovered set.

- [ ] **Step 3: Verify the invariant test still passes**

```bash
npx vitest run src/app/ai-entity-token.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Tests |×" /tmp/t.log
```

Expected: EXIT=0. A failure here means `expectedToken` collided with an excluded field name — it
does not, but the test is what proves it.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/chat-tool-defs.ts -m "feat(ai): require expectedToken on every entity update tool"
```

---

## Task 7: Enforce the token on the other five update tools

**Files:**
- Modify: `src/app/chat-tools.ts`
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Apply the same three-line shape to each case**

For `update_raid_item` use `d.getRaidRow(id)` and kind `"raid"`; `update_change` →
`d.getChangeRow(id)` / `"change"`; `update_milestone` → `d.getMilestoneRow(id)` / `"milestone"`;
`update_stakeholder` → `d.getStakeholderRow(id)` / `"stakeholder"`; `update_resource` →
`d.getResourceRow(id)` / `"resource"`.

Each becomes, with the label adjusted:

```ts
      const current = d.getRaidRow(id);
      if (!current) throw new Error(`RAID item #${id} not found`);
      requireToken("raid", current, input, `RAID item #${id}`);
```

- [ ] **Step 2: Write one stale-write test per entity**

Here is the RAID one in full. Write the other four the same way — do not condense them into one
loop, because a loop shares a fixture and a fixture that stops reaching one entity silently stops
testing it:

```ts
describe("update_raid_item concurrency token", () => {
  it("refuses a stale write AND leaves the item untouched", async () => {
    const d = makeDispatcher();
    d.createRaid({ title: "original", category: "Risk" });
    const stale = entityToken("raid", d.getRaidRow(1)!);
    d.updateRaid(1, { title: "human edit" });
    await expect(
      runTool(d, "update_raid_item", { id: 1, expectedToken: stale, title: "ai edit" }),
    ).rejects.toThrow(/changed since/i);
    expect(d.getRaidRow(1)!.title).toBe("human edit");
  });

  it("refuses when no token is supplied", async () => {
    const d = makeDispatcher();
    d.createRaid({ title: "original", category: "Risk" });
    await expect(
      runTool(d, "update_raid_item", { id: 1, title: "ai edit" }),
    ).rejects.toThrow(/expectedToken/i);
  });

  it("accepts a fresh write", async () => {
    const d = makeDispatcher();
    d.createRaid({ title: "original", category: "Risk" });
    const fresh = entityToken("raid", d.getRaidRow(1)!);
    await runTool(d, "update_raid_item", { id: 1, expectedToken: fresh, title: "ai edit" });
    expect(d.getRaidRow(1)!.title).toBe("ai edit");
  });
});
```

The remaining four substitute exactly these five things and nothing else:

| Tool | Getter | Kind | Create call | Field mutated |
|---|---|---|---|---|
| `update_change` | `getChangeRow` | `"change"` | `d.createChange({ title: "original" })` | `title` |
| `update_milestone` | `getMilestoneRow` | `"milestone"` | `d.createMilestone({ name: "original", date: "2030-01-01" })` | `name` |
| `update_stakeholder` | `getStakeholderRow` | `"stakeholder"` | `d.createStakeholder({ name: "original" })` | `name` |
| `update_resource` | `getResourceRow` | `"resource"` | `d.createResource({ name: "original" })` | `name` |

★ If a `create*` call above rejects for a missing required field, read that entity's `*Input` type
in `chat-tools.ts` and add what it demands — the sanitizers enforce required fields, so the fixture
must satisfy them. Each of the fifteen tests must assert **both** the rejection and that the entity
is unchanged.

- [ ] **Step 3: Run**

```bash
npx vitest run src/app/chat-tools.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t.log
```

Expected: EXIT=0.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/chat-tools.ts src/app/chat-tools.test.ts -m "fix(ai): refuse stale updates on RAID, changes, milestones, stakeholders and resources"
```

---

## Task 8: The two callers with no human in the loop

**Files:**
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts`
- Modify: `src/app/insights/recommend-plan.ts`

★★★ This task is why the slice is not done at Task 7. Both callers construct `update_*` calls
programmatically and will now be **refused**, silently turning off inline AI edit and insight
recommendations. Neither has a human to re-read and retry.

- [ ] **Step 1: Establish the blast radius**

```bash
grep -rn "update_task\|update_raid_item\|update_change\|update_milestone\|update_stakeholder\|update_resource\|updateTool" \
  src/app/inline-ai-edit/ src/app/insights/ src/app/use-ai-orchestration.ts src/app/action-ai.ts \
  src/app/ai-project-proposal.ts src/app/alloc-plan/ | grep -v "\.test\."
```

★★ `use-ai-orchestration.ts` is in that list because the spec named its **scheduled-job runner** as
a no-human-in-the-loop caller. A planning-time grep of the two directories above did NOT surface it,
which means either it reaches the tools by a name this pattern misses or it does not call them at
all. **Establish which before writing code** — if it does call them, it needs the same treatment as
the other two and this task grows by one file; if it does not, say so explicitly in the commit
message so the spec's risk is visibly discharged rather than silently dropped.

Read every hit before editing. Record in the commit message which call sites you changed.

- [ ] **Step 2: Write the failing test**

For each caller, add a test asserting that a generated tool call carries a non-empty
`expectedToken`, and that it equals `entityToken(kind, entity)` for the entity the call targets.
Equality — not merely presence — because a caller that attaches a constant would pass a presence
check and be refused at runtime.

- [ ] **Step 3: Attach the token at construction**

Both callers already hold the entity they are about to edit, so the token is derived locally:

```ts
import { entityToken } from "../ai-entity-token";
// …where the tool call is built:
expectedToken: entityToken("task", task),
```

- [ ] **Step 4: Run both suites and the whole AI surface**

```bash
npx vitest run src/app/inline-ai-edit src/app/insights src/app/chat-tools.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |×" /tmp/t.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/inline-ai-edit/entity-descriptor.ts src/app/insights/recommend-plan.ts -m "fix(ai): carry a concurrency token through the two non-chat write paths"
```

---

## Task 9: Phase 1 gates

- [ ] **Step 1: Full typecheck** (temporary config from Task 3, Step 3). Expected TSC_EXIT=0.

- [ ] **Step 2: Lint the touched files**

```bash
npx eslint --max-warnings=0 src/app/ai-entity-token.ts src/app/ai-entity-token.test.ts src/app/chat-tools.ts src/app/chat-tools.test.ts src/app/chat-tool-defs.ts src/app/use-register-tools.ts src/app/use-chat-dispatcher.ts; echo "ESLINT_EXIT=$?"
```

Expected: ESLINT_EXIT=0.

- [ ] **Step 3: Size ratchet**

```bash
npm run size:check > /tmp/size.log 2>&1; echo "SIZE_EXIT=$?"; tail -3 /tmp/size.log
```

Expected: SIZE_EXIT=0. `chat-tools.ts` was 790 lines and grows by roughly 40 — if the ratchet
fails, split the six update cases into `chat-tools-updates.ts` rather than raising the baseline.

- [ ] **Step 4: Coverage**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "COV_EXIT=$?"; grep -E "ERROR|threshold" /tmp/cov.log | head
```

Expected: COV_EXIT=0. `ai-entity-token.ts` is coverage-gated and must NOT be added to
`coverage.exclude` — it is logic, not UI glue.

- [ ] **Step 5: Shuffled run** (the only local reproduction of the `unit-tests-shuffled` gate)

```bash
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "SHUFFLE_EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuf.log
```

Expected: SHUFFLE_EXIT=0.

---

# PHASE 2 — Response cost

Independent of Phase 1. Ship separately if Phase 1 runs long.

## Task 10: `list_tasks` envelope and slimming

**Files:**
- Modify: `src/app/chat-tools.ts`
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Measure the BEFORE size**

```bash
npx vite-node -e 'import {readFileSync} from "fs"; const ws=JSON.parse(readFileSync("sample-workspace-small.json","utf8")); console.log("tasks:", ws.tasks.length, "bytes:", JSON.stringify(ws.tasks).length);'
```

Record the number. It goes in the commit message beside the AFTER number.

- [ ] **Step 2: Write the failing test**

```ts
describe("list_tasks response shape", () => {
  it("reports a total that matches the rows returned", async () => {
    const d = makeDispatcher([task({ id: 1 }), task({ id: 2 })]);
    const out = await runTool(d, "list_tasks", {}) as { items: unknown[]; total: number };
    expect(out.total).toBe(2);
    expect(out.items).toHaveLength(2);
  });

  it("plain-texts the rich description but keeps its text", async () => {
    const d = makeDispatcher([task({ id: 1, description: "<p>hello <b>world</b></p>" })]);
    const out = await runTool(d, "list_tasks", {}) as { items: Array<{ description: string }> };
    expect(out.items[0].description).toContain("hello world");
    expect(out.items[0].description).not.toContain("<b>");
  });

  it("keeps full markup on the single-entity read", async () => {
    // The control, and a real guarantee: an assistant about to EDIT a
    // description needs the markup it is editing.
    const d = makeDispatcher([task({ id: 1, description: "<p>hello</p>" })]);
    const out = await runTool(d, "get_task", { id: 1 }) as { description: string };
    expect(out.description).toBe("<p>hello</p>");
  });
});
```

- [ ] **Step 3: Run to verify the first two fail**

```bash
npx vitest run src/app/chat-tools.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Tests |×" /tmp/t.log
```

- [ ] **Step 4: Implement**

Replace the `list_tasks` case (currently `chat-tools.ts:508`):

```ts
    case "list_tasks": {
      const all = d.listTasks();
      const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : undefined;
      const items = (limit ? all.slice(0, limit) : all).map((t) => ({
        ...t,
        // ★★ The LIST path only. `get_task` keeps full markup — an assistant
        // about to edit a description needs the markup it is editing, and the
        // volume that justifies this change is all on the list side.
        description: htmlToPlainText(t.description ?? ""),
      }));
      // `total` is the UNSLICED count, so "how many tasks exist?" is answerable
      // from one call even when a limit was applied.
      return { items, total: all.length, ...(limit === undefined ? {} : { limit }) };
    }
```

Import `htmlToPlainText` from `./html-to-text` (pure regex, DOM-free — safe in this module).

- [ ] **Step 5: Add `limit` to the `list_tasks` schema in `chat-tool-defs.ts`**

```ts
        limit: {
          type: "number",
          description: "Optional. Return at most this many tasks. `total` always reports the full count.",
        },
```

Do **not** add it to `required` — omitting it must keep today's return-everything behaviour so no
existing prompt breaks.

- [ ] **Step 6: Run, then measure the AFTER size**

```bash
npx vitest run src/app/chat-tools.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t.log
```

Then re-run the Step 1 measurement against the slimmed projection and record both numbers.

- [ ] **Step 7: Mutation-prove the slimming**

Change `htmlToPlainText(t.description ?? "")` to `t.description ?? ""`, assert the mutant landed,
run, confirm the "plain-texts the rich description" case fails, revert by inverse Edit, prove
`git diff --stat` clean.

- [ ] **Step 8: Commit, with both byte counts in the message**

```bash
git commit --only src/app/chat-tools.ts src/app/chat-tools.test.ts src/app/chat-tool-defs.ts -m "perf(ai): give list_tasks a total, an optional limit and plain-text descriptions"
```

---

## Task 11: Phase 2 gates

- [ ] Typecheck (temporary config), lint the three touched files, `npm run size:check`,
      `npm run test:shuffle`. All expected to exit 0, each checked unpiped.

- [ ] **Update the docs that describe the tool contract**

```bash
grep -rn "list_tasks\|update_task" docs/AGENTS/ai-assistant.md
```

Any line describing the old return shape or the absent token is now false. Correct it in the same
commit that changes the behaviour — `docs:symbols:check` cannot see a stale CLAIM, only a stale
name.

---

## Not in this plan

An MCP server (`§346` — architecture decision first), time-entry guardrails (`§347`),
meeting↔task activity (`§348`), any change to `create_*` or to `resolveEntitySave` (a different
question: create-vs-update intent, already solved), and multiple target versions.
