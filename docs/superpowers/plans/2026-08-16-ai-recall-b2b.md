# AI Recall B2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chat model a cheap always-on signal that project history exists and is searchable, make the audit log record AI-made entity changes, and let the user switch both recall features off.

**Architecture:** A new optional `actor` field on `ActivityEntry` distinguishes user / AI / integration writes. The AI dispatcher's 20 entity writers start logging with `actor: "ai"` using the EXISTING kinds. A pure `summarizeRecentActivity` engine turns the log into four counts and a timestamp; a render layer turns that into one sentence in the prompt's **volatile** suffix. Two `AiConfig` booleans gate the tool and the sentence independently.

**Tech Stack:** TypeScript, React 19, Next.js 16, vitest, fast-check (not needed here), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-16-ai-recall-b2b-design.md`

**Branch:** `feat/ai-recall-b2b` (already exists, holds the spec commit).

---

## Before you start — read these

- `AGENTS.md` sections: "Hard constraints", "New persisted `Workspace` field → SIX write paths", and the **Activity log** bullet under Architecture pointers.
- The predecessor spec `docs/superpowers/specs/2026-08-16-ai-recall-b2a-design.md`, especially "★★★ `activityLog` must NOT go on `getSnapshot()`".

**Gate commands you will use.** Never read a gate's exit code through a pipe — you get the pipe's status:

```bash
npx vitest run src/app/<file>.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

`npm run lint` is bare `eslint` with no `--max-warnings`, so it exits 0 with warnings present. It does **not** reproduce the CI gate. Use the `npx eslint` form above.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/app/chat-tool-summaries.ts` | The 8 pure `to*Summary` entity→summary projections | **Create** (extracted) |
| `src/app/chat-tools.ts` | `ToolDispatcher` contract + `runTool` | Modify (shrink, then add one field) |
| `src/app/activity-log.ts` | `ActivityActor`, `actor` field, append + sanitize | Modify |
| `src/app/use-activity-log.ts` | `logActivityAs` / `logActivityChangesAs` | Modify |
| `src/app/activity-log-context.tsx` | context type | Modify |
| `src/app/use-jira-sync.ts` | stamp `"integration"` | Modify |
| `src/app/use-calendar-integrations.ts` | stamp `"integration"` | Modify |
| `src/app/use-document-tools.ts` | stamp `"ai"` | Modify |
| `src/app/use-chat-dispatcher.ts` | log 20 entity writers as `"ai"`; build `activitySummary` | Modify |
| `src/app/view-ai-scope.ts` | rewrite the now-false `activity.reading` prose | Modify |
| `src/app/history-search.ts` | `summarizeRecentActivity` engine | Modify |
| `src/app/activity-prompt.ts` | `buildActivityRecapBlock` render | Modify |
| `src/app/chat-api.ts` | recap block in volatile suffix; `CACHED_TOOLS` variants | Modify |
| `src/app/settings-types.ts` | two `AiConfig` fields + sanitizer | Modify |
| `src/app/settings-sections/ai-section.tsx` | two toggle rows | Modify |
| `src/app/activity-log-panel.tsx` | actor column + actor filter | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | new EN/DE keys | Modify |

---

## Task 0: Extract the summary mappers out of `chat-tools.ts`

`chat-tools.ts` is at **797 lines against the 800 cap**, and `scripts/check-file-sizes.mjs` counts `readFileSync().split("\n").length` — `wc -l` **plus one**. So 797 is the gate's own number and the budget is three lines. Task 8 adds a field with a comment. This extraction is an ordering constraint, not a cleanup.

**Files:**
- Create: `src/app/chat-tool-summaries.ts`
- Modify: `src/app/chat-tools.ts`
- Modify: `src/app/use-chat-dispatcher.ts` (import path only)

- [ ] **Step 1: Measure the starting size**

```bash
node -e "console.log(require('fs').readFileSync('src/app/chat-tools.ts','utf8').split('\n').length)"
```

Expected: `797`

- [ ] **Step 2: Create the new module**

Create `src/app/chat-tool-summaries.ts`. Move these EIGHT functions verbatim out of `chat-tools.ts` (they currently sit between `toRaidSummary` and `runTool`):

`toRaidSummary`, `toChangeSummary`, `toMilestoneSummary`, `toStakeholderSummary`, `toResourceSummary`, `toKnowledgeSummary`, `toCalendarEventSummary`, `toBudgetBucketSummary`.

Head the file:

```ts
// PURE entity → tool-summary projections, extracted from chat-tools.ts.
//
// ★ Extracted for the file-size ratchet: chat-tools.ts sat at 797 of the 800
//   cap (the gate counts `wc -l` + 1, so that WAS the gate's number) and the
//   B2b slice needed to add a `getSnapshot()` field. These eight functions are
//   the most cohesive unit in the file — no dispatcher access, no i18n, no
//   state, one input each.
//
// ★ They stay re-exported from chat-tools.ts so no existing import breaks.
```

The type imports these need (`RaidItem`, `ChangeItem`, `Milestone`, `Stakeholder`, `Resource`, `KnowledgeItem`, `CalendarEvent`, `BudgetBucket`) come from `./types`; the summary types (`RaidSummary`, `ChangeSummary`, `MilestoneSummary`, `StakeholderSummary`, `ResourceSummary`, `KnowledgeSummary`, `CalendarEventSummary`, `BudgetBucketSummary`, `CALENDAR_SUMMARY_KEYS`) stay in `chat-tools.ts` and are imported from there.

- [ ] **Step 3: Re-export from `chat-tools.ts`**

Replace the removed function bodies with a single re-export line so no consumer changes:

```ts
export {
  toRaidSummary,
  toChangeSummary,
  toMilestoneSummary,
  toStakeholderSummary,
  toResourceSummary,
  toKnowledgeSummary,
  toCalendarEventSummary,
  toBudgetBucketSummary,
} from "./chat-tool-summaries";
```

★ `runTool` calls several of these — add a matching `import { ... } from "./chat-tool-summaries";` at the top of `chat-tools.ts` for the ones it uses. A re-export does **not** put the names in the module's own scope.

- [ ] **Step 4: Verify the size dropped and nothing broke**

```bash
node -e "console.log(require('fs').readFileSync('src/app/chat-tools.ts','utf8').split('\n').length)"
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/chat-tools.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: size well under 700; `EXIT=0` for both.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-tool-summaries.ts src/app/chat-tools.ts
git commit -m "refactor(chat): extract the eight tool-summary projections

chat-tools.ts sat at 797 of the 800-line cap, and check-file-sizes.mjs counts
wc -l plus one, so that was the gate's own number and the budget was three
lines. The B2b slice needs to add a getSnapshot() field. The eight to*Summary
functions are the file's most cohesive unit: no dispatcher access, no i18n, no
state, one input each. Re-exported from chat-tools.ts so no import changes."
```

---

## Task 1: `ActivityActor` type and the `actor` field

**Files:**
- Modify: `src/app/activity-log.ts`
- Test: `src/app/activity-log.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/activity-log.test.ts`:

```ts
describe("sanitizeActivityEntry — actor", () => {
  const base = { id: "d-1-1", timestamp: "2026-08-16T10:00:00.000Z", kind: "task.created", args: [1, "x"] };

  it("round-trips a known actor", () => {
    const out = sanitizeActivityEntry({ ...base, actor: "ai" });
    expect(out?.actor).toBe("ai");
  });

  // ★ The forward-compat rule: the log is SHARED workspace data and autosave
  //   writes loaded state straight back, so an older client that dropped an
  //   actor a newer release wrote would strip it from the shared project.
  it("KEEPS an unknown-but-string actor", () => {
    const out = sanitizeActivityEntry({ ...base, actor: "reviewer" });
    expect((out as { actor?: string } | null)?.actor).toBe("reviewer");
  });

  it("strips a non-string actor but keeps the entry", () => {
    const out = sanitizeActivityEntry({ ...base, actor: { evil: true } });
    expect(out).not.toBeNull();
    expect(out?.actor).toBeUndefined();
    expect(out?.kind).toBe("task.created");
  });

  // ★★ Absence is NOT "user". Pre-field entries have a genuinely unknown
  //    actor; defaulting them would assert the AI's past writes were the
  //    user's, in the one record the model is told to trust.
  it("leaves an absent actor absent, never defaulting it to user", () => {
    const out = sanitizeActivityEntry(base);
    expect(out?.actor).toBeUndefined();
  });

  it("strips a malformed actor while ALSO stripping malformed changes", () => {
    const out = sanitizeActivityEntry({ ...base, actor: 7, changes: "nope" });
    expect(out).not.toBeNull();
    expect(out?.actor).toBeUndefined();
    expect(out?.changes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/activity-log.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL. The two "keeps" tests may already PASS — see Step 3 for why that is correct and expected. The two strip tests MUST fail.

- [ ] **Step 3: Implement**

In `src/app/activity-log.ts`, above `ActivityEntry`:

```ts
/** Who caused an entry.
 *
 *  ★★★ There is deliberately no "system" member. No writer could produce one
 *  today, and a value nothing emits is a value nothing tests — the same
 *  objection that makes a decorative field worse than no field.
 *
 *  ★★ The TS type is a closed union while `sanitizeActivityEntry` admits ANY
 *  string, exactly as `kind: ActivityKind` already does. Any lookup keyed on
 *  actor therefore needs an own-property guard, never a bare index. */
export type ActivityActor = "user" | "ai" | "integration";
```

On `ActivityEntry`, after `args`:

```ts
  /** Who caused this entry. ABSENT on every entry written before the B2b
   *  release, and absence is NOT "user" — those entries have a genuinely
   *  unknown actor. Never default it at read time. */
  actor?: ActivityActor;
```

**★★ `sanitizeActivityEntry` already PRESERVES an unknown actor with no change at all** — it returns an untouched entry by reference and a repaired one by spread, never from a known-field list, and its own comment says a field a newer release adds must survive an older client's round trip. Only the *strip* branch is new. Rewrite the tail of `sanitizeActivityEntry`:

```ts
export function sanitizeActivityEntry(v: unknown): ActivityEntry | null {
  if (!v || typeof v !== "object") return null;
  const e = v as {
    id?: unknown; timestamp?: unknown; kind?: unknown; args?: unknown;
    changes?: unknown; actor?: unknown;
  };
  if (typeof e.id !== "string" || e.id.length === 0) return null;
  if (typeof e.timestamp !== "string") return null;
  if (typeof e.kind !== "string") return null;
  if (!Array.isArray(e.args)) return null;

  // ★ A non-string actor is CORRUPTION, not forward-compat, and is stripped
  //   while the entry is kept — the same trade `changes` already makes: the
  //   audit record is real, only that one attribute is not. A string actor
  //   this release does not know is KEPT (see the type's own note).
  const actorBad = e.actor !== undefined && typeof e.actor !== "string";

  if (e.changes === undefined && !actorBad) return v as ActivityEntry;

  const repaired: Record<string, unknown> = { ...(v as object) };
  if (actorBad) delete repaired.actor;
  if (e.changes !== undefined) {
    const changes = sanitizeChanges(e.changes);
    if (changes) repaired.changes = changes;
    else delete repaired.changes;
  }
  return repaired as unknown as ActivityEntry;
}
```

★ Note the early return now guards on BOTH conditions. Leaving it as `if (e.changes === undefined) return v` would return a hostile actor untouched whenever `changes` happened to be absent — which is the common case, so the bug would be invisible in most fixtures.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/app/activity-log.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 5: Commit**

```bash
git add src/app/activity-log.ts src/app/activity-log.test.ts
git commit -m "feat(activity): add an optional actor to ActivityEntry

user | ai | integration. Absence is deliberately NOT user: entries written
before this release have a genuinely unknown actor, and coercing them would
assert that the AI's past document writes were the user's.

The sanitizer already preserved unknown fields (it returns by reference or by
spread, never from a field list), so keeping an unknown-but-string actor is
free and matches the existing unknown-kind rule. Only the strip-a-non-string
branch is new, and its early return had to widen: guarding on changes alone
would pass a hostile actor through whenever changes was absent, which is the
common case."
```

---

## Task 2: Actor-aware append and hook variants

**Files:**
- Modify: `src/app/activity-log.ts`
- Modify: `src/app/use-activity-log.ts`
- Modify: `src/app/activity-log-context.tsx`
- Test: `src/app/activity-log.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("appendActivityEntry stamps the actor and omits the key when absent", () => {
  const withActor = appendActivityEntry([], "task.created", [1, "x"], undefined, "ai");
  expect(withActor[0].actor).toBe("ai");

  const without = appendActivityEntry([], "task.created", [1, "x"]);
  expect("actor" in without[0]).toBe(false);
});
```

★ `"actor" in entry` rather than `toBeUndefined()`: the key must be **omitted**, not present-and-undefined, so entries without an actor stay byte-identical through `JSON.stringify` on all six storage paths.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/activity-log.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — `appendActivityEntry` takes 4 arguments.

- [ ] **Step 3: Implement the append change**

In `src/app/activity-log.ts`:

```ts
export function appendActivityEntry(
  current: readonly ActivityEntry[],
  kind: ActivityKind,
  args: (string | number)[],
  changes?: readonly FieldChange[],
  actor?: ActivityActor,
): ActivityEntry[] {
  const entry: ActivityEntry = {
    id: `${getDeviceId()}-${getSessionNonce()}-${++counter}`,
    timestamp: new Date().toISOString(),
    kind,
    args,
    ...(changes && changes.length > 0 ? { changes } : {}),
    ...(actor ? { actor } : {}),
  };
  const next = [...current, entry];
  return next.length > ACTIVITY_MAX_ENTRIES
    ? next.slice(-ACTIVITY_MAX_ENTRIES)
    : next;
}
```

`appendActivity` gains a matching optional leading-free form — it cannot take a trailing actor because it ends in a rest parameter, so it stays as-is and callers wanting an actor use `appendActivityEntry`.

- [ ] **Step 4: Add the hook variants**

In `src/app/use-activity-log.ts`, extend the return type and body:

```ts
  /** ★★ ACTOR LEADS, and this is a settled precedent rather than a style
   *  choice: `logActivity` ends in a rest parameter, so nothing can follow it.
   *  That is the same constraint that forced `logActivityChanges` to exist as
   *  its own function instead of an options argument. Keeping the plain
   *  variants unchanged leaves ~150 existing call sites untouched. */
  logActivityAs: (
    actor: ActivityActor,
    kind: ActivityKind,
    ...args: (string | number)[]
  ) => void;
  logActivityChangesAs: (
    actor: ActivityActor,
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
```

```ts
  const logActivityAs = useCallback(
    (actor: ActivityActor, kind: ActivityKind, ...args: (string | number)[]) => {
      setActivityLog((prev) => appendActivityEntry(prev, kind, args, undefined, actor));
    },
    [setActivityLog],
  );

  const logActivityChangesAs = useCallback(
    (
      actor: ActivityActor,
      kind: ActivityKind,
      changes: readonly FieldChange[],
      ...args: (string | number)[]
    ) => {
      setActivityLog((prev) => appendActivityEntry(prev, kind, args, changes, actor));
    },
    [setActivityLog],
  );
```

Return all four from the hook. ★ Functional setters throughout — two appends in one tick must both survive, and each must produce a NEW array because the save effect's dirty check is reference equality.

- [ ] **Step 5: Add the context type**

In `src/app/activity-log-context.tsx`, beside the existing `LogActivityFn`:

```ts
export type LogActivityAsFn = (
  actor: ActivityActor,
  kind: ActivityKind,
  ...args: (string | number)[]
) => void;
```

Leave `ActivityLogContext` itself on `LogActivityFn`. Its two consumers (`gantt-view.tsx`, `knowledge-links-field-gated.tsx`) are user actions and must keep defaulting to `"user"`.

- [ ] **Step 6: Verify**

```bash
npx vitest run src/app/activity-log.test.ts src/app/use-activity-log.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `EXIT=0` for all three.

- [ ] **Step 7: Commit**

```bash
git add src/app/activity-log.ts src/app/activity-log.test.ts src/app/use-activity-log.ts src/app/activity-log-context.tsx
git commit -m "feat(activity): actor-aware append and logActivityAs variants

The actor LEADS rather than trails because logActivity ends in a rest
parameter — the same constraint that already forced logActivityChanges to be
its own function rather than an options argument. The plain variants keep
their signatures, so ~150 existing call sites are untouched and default to
user. The actor key is omitted when absent so entries stay byte-identical
through JSON.stringify on all six storage paths."
```

---

## Task 3: Stamp the integration writers

**Files:**
- Modify: `src/app/use-jira-sync.ts` (1 call site)
- Modify: `src/app/use-calendar-integrations.ts` (4 call sites)

- [ ] **Step 1: Widen both hooks' deps type**

Both files declare `logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;` in their args interface. Add beside it:

```ts
  logActivityAs: (
    actor: ActivityActor,
    kind: ActivityKind,
    ...args: (string | number)[]
  ) => void;
```

Import `ActivityActor` from `./activity-log` in both.

- [ ] **Step 2: Switch the five call sites**

`src/app/use-jira-sync.ts` — the `jira.sync` call:

```ts
args.logActivityAs("integration", "jira.sync", added + pulled, pushed, conflictItems.length);
```

`src/app/use-calendar-integrations.ts` — all four `onBackgroundApply` handlers:

```ts
onBackgroundApply: (n) => logActivityAs("integration", "calendar.autoPulled", n, t(lang, "calendarSyncEntityTask")),
onBackgroundApply: (n) => logActivityAs("integration", "calendar.autoPulled", n, t(lang, "calendarSyncEntityRaid")),
onBackgroundApply: (n) => logActivityAs("integration", "calendar.autoPulled", n, t(lang, "calendarSyncEntityChange")),
onBackgroundApply: (n) => logActivityAs("integration", "calendar.autoPulled", n, t(lang, "calendarSyncEntityAbsence")),
```

- [ ] **Step 3: Thread the new dep from `task-manager.tsx`**

`task-manager.tsx` destructures `useActivityLog()` around line 209. Add `logActivityAs` there and pass it into both hooks' deps objects wherever `logActivity` is already passed.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/use-jira-sync.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-jira-sync.ts src/app/use-calendar-integrations.ts src/app/task-manager.tsx
git commit -m "feat(activity): stamp integration writes with actor integration

Five call sites: the Jira sync summary row and the four calendar background
auto-pull handlers. These already self-identified in their KIND; the actor
makes them uniform with the AI writes landing next, so a consumer filtering on
actor never has to special-case a kind."
```

---

## Task 4: Log the AI's entity writes

This is the behaviour change the slice exists for. The audit log currently records **nothing** for AI-made entity changes: `use-chat-dispatcher.ts` has one `logActivity` reference (threading it into `useDocumentTools`) and its 20 entity writers call it nowhere.

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts`
- Modify: `src/app/use-document-tools.ts`
- Test: `src/app/use-chat-dispatcher.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("AI entity writes reach the activity log", () => {
  it("logs task.created with actor ai", () => {
    const logActivityAs = vi.fn();
    const { dispatcher } = renderDispatcher({ logActivityAs });
    const created = dispatcher.createTask({ taskName: "Cutover", assignee: "Ada", dueDate: "2026-09-01" });
    expect(logActivityAs).toHaveBeenCalledWith("ai", "task.created", created.id, "Cutover");
  });

  it("logs task.deleted with actor ai", () => {
    const logActivityAs = vi.fn();
    const { dispatcher } = renderDispatcher({ logActivityAs, tasks: [taskFixture({ id: 4, taskName: "Old" })] });
    dispatcher.deleteTask(4);
    expect(logActivityAs).toHaveBeenCalledWith("ai", "task.deleted", 4, "Old");
  });

  // ★★ A bulk op logs ONE summarising row, not N. ACTIVITY_MAX_ENTRIES is 500,
  //    so N rows from one chat turn can age out a week of user history.
  //    jira.sync already models the summarising shape.
  it("logs delete-all as a single bulk.edit row, not one row per task", () => {
    const logActivityAs = vi.fn();
    const { dispatcher } = renderDispatcher({
      logActivityAs,
      tasks: [taskFixture({ id: 1 }), taskFixture({ id: 2 }), taskFixture({ id: 3 })],
    });
    dispatcher.deleteAllTasks();
    expect(logActivityAs).toHaveBeenCalledTimes(1);
    expect(logActivityAs).toHaveBeenCalledWith("ai", "bulk.edit", 3);
  });

  it("does not log when the write is rejected", () => {
    const logActivityAs = vi.fn();
    const { dispatcher } = renderDispatcher({ logActivityAs, tasks: [] });
    expect(dispatcher.updateTask(999, { taskName: "ghost" })).toBeNull();
    expect(logActivityAs).not.toHaveBeenCalled();
  });
});
```

★ The last test is the one that matters most and is the easiest to omit: a writer that logs before its `return null` guard records changes that never happened.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/use-chat-dispatcher.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — `logActivityAs` never called.

- [ ] **Step 3: Add the dep**

In `src/app/chat-dispatcher-types.ts`, beside the existing threaded `logActivity`:

```ts
  /** ★★★ THREADED from task-manager's useActivityLog(), never minted here — a
   *  second useActivityLog() call is an independent state instance, so its
   *  rows would be written to a different array and lost. Same rule as
   *  `logActivity` directly above. */
  logActivityAs?: (
    actor: ActivityActor,
    kind: ActivityKind,
    ...args: (string | number)[]
  ) => void;
```

Thread it from `task-manager.tsx` into the dispatcher args.

- [ ] **Step 4: Log from each writer**

Add one call at the **end** of each writer's success path, after the state setter and before the `return`. Never before a `return null` guard.

Worked example — `createTask` (the final lines of the existing body):

```ts
        const next = [...list, newTask];
        tasksRef.current = next; // keep ref in sync for back-to-back tool calls
        setTasks(next);
        args.logActivityAs?.("ai", "task.created", newTask.id, newTask.taskName);
        return newTask;
```

Worked example — an update writer, after the setter:

```ts
        args.logActivityAs?.("ai", "task.updated", updated.id, updated.taskName);
        return updated;
```

Worked example — a delete writer, after the setter:

```ts
        args.logActivityAs?.("ai", "task.deleted", existing.id, existing.taskName);
        return true;
```

**The 20 writers and the kind + args each takes.** Kinds all exist already — this slice adds no `ActivityKind` member and no i18n key. The arg contracts are fixed by the EN strings:

| Writer | Kind | Args |
|---|---|---|
| `createTask` / `updateTask` / `deleteTask` | `task.created` / `task.updated` / `task.deleted` | `(id, taskName)` |
| `deleteAllTasks` | `bulk.edit` | `(count)` |
| `createRaid` / `updateRaid` / `deleteRaid` | `raid.created` / `raid.updated` / `raid.deleted` | `(id, category, title)` |
| `createChange` / `updateChange` / `deleteChange` | `change.created` / `change.updated` / `change.deleted` | `(id, title)` |
| `createMilestone` / `updateMilestone` / `deleteMilestone` | `milestone.created` / `milestone.updated` / `milestone.deleted` | `(id, name)` |
| `createStakeholder` / `updateStakeholder` / `deleteStakeholder` | `stakeholder.created` / `stakeholder.updated` / `stakeholder.deleted` | `(id, name)` |
| `createResource` / `updateResource` / `deleteResource` | `resource.created` / `resource.updated` / `resource.deleted` | `(id, fullName)` |
| `updateSettings` | `settings.updated` | none |

★ `raid.*` takes THREE args (`id`, `category`, `title`) — the EN string is `"RAID #{0} updated ({1}): {2}"`. Passing two produces a literal `{2}` in the model's own history feed.

★ `resource.*` args are the full name: `` `${firstName} ${lastName}`.trim() ``, mirroring the existing user-side call site in `task-manager.tsx`.

Re-derive the writer list rather than trusting this table:

```bash
grep -nE "^      (create|update|delete)[A-Z][a-zA-Z]*: \(" src/app/use-chat-dispatcher.ts
```

Expected: 20 lines.

- [ ] **Step 5: Stamp the document tools**

In `src/app/use-document-tools.ts`, the three `logActivity?.("ai.documentWrite", …)` calls become `logActivityAs?.("ai", "ai.documentWrite", …)`. Widen the hook's parameter to accept the new function. ★ Redundant with the kind, and correct anyway: a consumer filtering on actor must not special-case one kind.

- [ ] **Step 6: Verify**

```bash
npx vitest run src/app/use-chat-dispatcher.test.ts src/app/use-document-tools.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 7: Commit**

```bash
git add src/app/use-chat-dispatcher.ts src/app/use-document-tools.ts src/app/chat-dispatcher-types.ts src/app/task-manager.tsx src/app/use-chat-dispatcher.test.ts
git commit -m "feat(activity): record AI entity writes in the audit log

The log was blind to them: use-chat-dispatcher.ts had exactly one logActivity
reference, threading it into useDocumentTools, so all 20 entity writers logged
nothing. An AI reassigning forty tasks left no trace while a user reassigning
one left a row with a field diff.

They reuse the EXISTING kinds with actor ai rather than a parallel ai.* kind
set — a task updated by the assistant is the same event as one updated by a
person, and only the actor differs. Zero new kinds, zero new i18n keys.

deleteAllTasks logs ONE summarising bulk.edit row rather than N: the log caps
at 500 entries, so a bulk turn could otherwise age out a week of user history.
Every call sits after the state setter and after the reject guards, so a
rejected write records nothing."
```

---

## Task 5: Correct the now-false view-scope prose

**Files:**
- Modify: `src/app/view-ai-scope.ts`
- Test: `src/app/view-ai-scope.test.ts`

`activity.reading` currently tells the model the log records changes made in the app and by its integrations — "**not your own tool calls**". Task 4 made that false.

- [ ] **Step 1: Run the existing test to see it go red**

```bash
npx vitest run src/app/view-ai-scope.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL if the test pins the phrase; if it passes, the phrase is unpinned and Step 2 adds the pin.

- [ ] **Step 2: Rewrite the prose**

```ts
    reading:
      "search_history reads this log. It records changes made in the app, by its integrations, and by you — each entry says which. It keeps only the most recent entries, so an empty result can mean the events aged out rather than that nothing happened.",
```

- [ ] **Step 3: Pin it**

```ts
it("tells the model the activity log includes its OWN writes", () => {
  const reading = VIEW_AI_SCOPE.activity.reading;
  expect(reading).toContain("and by you");
  // ★ The pre-B2b prose claimed the opposite and was true until the dispatcher
  //   started logging. Pin the negation so it cannot silently return.
  expect(reading).not.toContain("not your own tool calls");
});
```

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/app/view-ai-scope.test.ts --reporter=dot; echo "EXIT=$?"
git add src/app/view-ai-scope.ts src/app/view-ai-scope.test.ts
git commit -m "fix(ai): the activity log now includes the model's own writes

The view-scope prose told the model the log records changes 'not your own tool
calls'. True until the dispatcher started logging; false now. Pinned in both
directions so the old claim cannot return silently."
```

---

## Task 6: The `summarizeRecentActivity` engine

**Files:**
- Modify: `src/app/history-search.ts`
- Test: `src/app/history-search.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("summarizeRecentActivity", () => {
  const at = (iso: string, actor?: string): ActivityEntry =>
    ({ id: `e-${iso}`, timestamp: iso, kind: "task.updated", args: [1, "x"],
       ...(actor ? { actor } : {}) }) as ActivityEntry;

  it("returns null for an empty window rather than a zeroed summary", () => {
    expect(summarizeRecentActivity([], "2026-08-16", "UTC")).toBeNull();
    expect(summarizeRecentActivity([at("2026-01-01T10:00:00.000Z")], "2026-08-16", "UTC")).toBeNull();
  });

  it("tallies by actor, bucketing an absent actor as unknown", () => {
    const out = summarizeRecentActivity(
      [at("2026-08-16T10:00:00.000Z", "user"), at("2026-08-15T10:00:00.000Z", "ai"),
       at("2026-08-14T10:00:00.000Z", "integration"), at("2026-08-13T10:00:00.000Z")],
      "2026-08-16", "UTC",
    );
    expect(out).toEqual({
      total: 4,
      byActor: { user: 1, ai: 1, integration: 1, unknown: 1 },
      latestAt: "2026-08-16T10:00:00.000Z",
    });
  });

  it("buckets an UNKNOWN-BUT-STRING actor as unknown, never crashing", () => {
    const out = summarizeRecentActivity([at("2026-08-16T10:00:00.000Z", "reviewer")], "2026-08-16", "UTC");
    expect(out?.byActor.unknown).toBe(1);
  });

  // ★★★ THE ZONE TEST. A UTC-only fixture CANNOT fail this — the entry sits on
  //    the boundary and its inclusion flips with the project zone.
  it("classifies the window bound in the PROJECT zone, not UTC", () => {
    const boundary = [at("2026-08-09T23:30:00.000Z", "user")];
    // Berlin (UTC+2): local day is 2026-08-10, the window's first day → IN.
    expect(summarizeRecentActivity(boundary, "2026-08-16", "Europe/Berlin")?.total).toBe(1);
    // New York (UTC-4): local day is 2026-08-09, one day before → OUT.
    expect(summarizeRecentActivity(boundary, "2026-08-16", "America/New_York")).toBeNull();
  });

  it("excludes an unparseable timestamp instead of inflating the total", () => {
    const out = summarizeRecentActivity(
      [at("2026-08-16T10:00:00.000Z", "user"), at("whenever", "user")], "2026-08-16", "UTC",
    );
    expect(out?.total).toBe(1);
  });

  it("reports latestAt as the RAW UTC stamp, not an offset form", () => {
    const out = summarizeRecentActivity([at("2026-08-16T10:00:00.000Z", "user")], "2026-08-16", "Europe/Berlin");
    expect(out?.latestAt).toBe("2026-08-16T10:00:00.000Z");
  });

  it("returns null for an unparseable today rather than throwing", () => {
    expect(summarizeRecentActivity([at("2026-08-16T10:00:00.000Z")], "not-a-date", "UTC")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/history-search.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — `summarizeRecentActivity is not a function`.

- [ ] **Step 3: Implement**

Append to `src/app/history-search.ts`:

```ts
export const RECAP_WINDOW_DAYS = 7;

export interface ActivitySummary {
  total: number;
  byActor: { user: number; ai: number; integration: number; unknown: number };
  /** The newest matching entry's RAW UTC timestamp. ★ Never the offset-bearing
   *  form — the renderer converts. Comparing offset strings across a DST
   *  transition orders them wrongly, which is the trap `searchHistory`
   *  documents at length. */
  latestAt: string;
}

/**
 * Counts activity in the trailing `days`-day window ending on `today`,
 * inclusive of today, split by actor.
 *
 * ★ NO CLOCK. `today` and `tz` are parameters, matching `searchHistory` — so
 *   this is immune to the calendar-rollover class that detonates date-dependent
 *   tests on the morning the fixture date arrives (open-followups §149).
 *
 * ★ Returns null rather than a zeroed summary when nothing matched, so the
 *   caller omits the prompt block entirely and a quiet project costs nothing.
 */
export function summarizeRecentActivity(
  entries: readonly ActivityEntry[],
  today: string,
  tz: string,
  days: number = RECAP_WINDOW_DAYS,
): ActivitySummary | null {
  // ★ `days - 1`: the window INCLUDES today, so 7 days is today plus 6 prior.
  const start = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const since = start.toISOString().slice(0, 10);

  const byActor = { user: 0, ai: 0, integration: 0, unknown: 0 };
  let total = 0;
  let latestAt = "";

  for (const entry of entries) {
    // ★★ The entry's day IN THE PROJECT ZONE, not UTC's. In Berlin an edit at
    //    00:30 local is stamped 22:30Z the previous day; filing it under UTC's
    //    day disagrees with both the Activity panel and the `Today is …` date
    //    the model is given.
    const day = dayInZone(entry.timestamp, tz);
    if (day === null || day < since || day > today) continue;
    total += 1;
    // ★ Own-property guard, never a bare index: the sanitizer KEEPS an
    //   unknown-but-string actor, so `actor: "toString"` reaches here and a
    //   bare `byActor[actor]` would resolve a Function.prototype method.
    const actor = entry.actor;
    if (actor !== undefined && Object.prototype.hasOwnProperty.call(byActor, actor)) {
      byActor[actor as keyof typeof byActor] += 1;
    } else {
      byActor.unknown += 1;
    }
    if (entry.timestamp > latestAt) latestAt = entry.timestamp;
  }

  return total === 0 ? null : { total, byActor, latestAt };
}
```

★ `latestAt` compares raw UTC stamps lexicographically, which is only valid because every stored timestamp is `toISOString()` shape — the same assumption `mergeActivityLogs` already makes.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/app/history-search.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 5: Mutation-check the zone test**

Temporarily change `dayInZone(entry.timestamp, tz)` to `entry.timestamp.slice(0, 10)` and re-run. The zone test MUST go red. Revert the mutation before committing.

```bash
npx vitest run src/app/history-search.test.ts --reporter=dot; echo "EXIT=$?"
git diff --stat src/app/history-search.ts   # must be empty after reverting
```

★ Sweep for the live mutant before you commit — a report is a claim about the work, not about the tree.

- [ ] **Step 6: Commit**

```bash
git add src/app/history-search.ts src/app/history-search.test.ts
git commit -m "feat(history): add the summarizeRecentActivity engine

Counts a trailing 7-day window by actor, with today and the timezone as
parameters so the function reads no clock — immune to the calendar-rollover
class in open-followups #149. Day bounds go through dayInZone, so the window
matches the project's days rather than UTC's; a UTC-only fixture cannot tell
the two apart, so the boundary test asserts opposite outcomes for Berlin and
New York on one instant.

Returns null rather than a zeroed summary so a quiet project omits the prompt
block entirely. The actor tally uses an own-property guard: the sanitizer keeps
an unknown-but-string actor, so actor: 'toString' reaches this loop."
```

---

## Task 7: The recap renderer

**Files:**
- Modify: `src/app/activity-prompt.ts`
- Test: `src/app/activity-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("buildActivityRecapBlock", () => {
  const s = (over: Partial<ActivitySummary["byActor"]>, total: number, latestAt = "2026-08-16T09:12:00.000Z"): ActivitySummary =>
    ({ total, byActor: { user: 0, ai: 0, integration: 0, unknown: 0, ...over }, latestAt });

  it("returns an empty string for a null summary", () => {
    expect(buildActivityRecapBlock(null, "UTC")).toBe("");
  });

  it("omits the breakdown when only one bucket is non-zero", () => {
    const out = buildActivityRecapBlock(s({ user: 14 }, 14), "UTC");
    expect(out).toContain("14 changes in the last 7 days");
    expect(out).not.toContain("by the user");
    expect(out).toContain("search_history");
  });

  it("names each non-zero bucket when more than one is present", () => {
    const out = buildActivityRecapBlock(s({ user: 9, ai: 5 }, 14), "UTC");
    expect(out).toContain("9 by the user");
    expect(out).toContain("5 by the AI assistant");
    expect(out).not.toContain("integration");
  });

  it("renders the unknown bucket only when non-zero", () => {
    expect(buildActivityRecapBlock(s({ user: 2, unknown: 3 }, 5), "UTC")).toContain("3 of unknown origin");
    expect(buildActivityRecapBlock(s({ user: 2, ai: 3 }, 5), "UTC")).not.toContain("unknown origin");
  });

  it("renders latestAt in the PROJECT zone", () => {
    const out = buildActivityRecapBlock(s({ user: 1 }, 1, "2026-08-16T23:30:00.000Z"), "Europe/Berlin");
    expect(out).toContain("2026-08-17");
  });
});
```

★ The last test is the one a UTC-only fixture cannot fail: the instant lands on a different date in Berlin.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/activity-prompt.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — `buildActivityRecapBlock is not a function`.

- [ ] **Step 3: Implement**

Append to `src/app/activity-prompt.ts`:

```ts
/** Bucket → the English noun phrase the model reads. ★ Plain literals, NOT
 *  i18n keys: unlike `renderActivityEntry` this line has no UI counterpart to
 *  stay in step with, so routing it through `t` would add dictionary entries
 *  that exist only to be read by a machine. */
const ACTOR_PHRASE: Record<keyof ActivitySummary["byActor"], string> = {
  user: "by the user",
  ai: "by the AI assistant",
  integration: "by an integration",
  unknown: "of unknown origin",
};

/**
 * One sentence telling the model that history exists and is searchable.
 *
 * ★★ A COUNT, not a recap. It sits in the prompt's VOLATILE suffix and is paid
 *    on every turn of every conversation, so it buys tool discoverability at
 *    roughly twenty tokens rather than paying for content the model may not
 *    need — `search_history` fetches the content when it does.
 *
 * ★ The actor split is load-bearing, not decoration: it is what stops the
 *   model reading its OWN edits back as new user information and acting on
 *   them twice.
 */
export function buildActivityRecapBlock(
  summary: ActivitySummary | null,
  tz: string,
): string {
  if (!summary) return "";

  const parts = (Object.keys(ACTOR_PHRASE) as Array<keyof typeof ACTOR_PHRASE>)
    .filter((k) => summary.byActor[k] > 0)
    .map((k) => `${summary.byActor[k]} ${ACTOR_PHRASE[k]}`);

  // ★ One non-zero bucket means the breakdown would restate the total.
  const breakdown = parts.length > 1 ? `${parts.join(", ")}; ` : "";
  const latestDay = dayInZone(summary.latestAt, tz) ?? summary.latestAt;

  return [
    `Recent project activity: ${summary.total} changes in the last ${RECAP_WINDOW_DAYS} days`,
    `(${breakdown}latest ${latestDay}).`,
    "Use search_history to read them.",
  ].join(" ");
}
```

Import `ActivitySummary` and `RECAP_WINDOW_DAYS` from `./history-search`, and `dayInZone` from `./timezone`.

★★ `history-search.ts` already imports from `activity-prompt.ts`. Importing the **type** back is fine (types are erased), but `RECAP_WINDOW_DAYS` is a **value** and creates a runtime cycle. If the bundler or a test complains, move `RECAP_WINDOW_DAYS` and `ActivitySummary` into `activity-log.ts` — which both already import — and re-export from `history-search.ts`. Verify with the tsc + vitest runs in Step 4 before assuming either way.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/app/activity-prompt.test.ts src/app/history-search.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 5: Commit**

```bash
git add src/app/activity-prompt.ts src/app/activity-prompt.test.ts
git commit -m "feat(ai): render the ambient activity recap sentence

A COUNT, not a recap of content: it rides the prompt's volatile suffix and is
paid on every turn of every conversation, so it buys tool discoverability
cheaply and search_history fetches detail when the model wants it.

Plain English literals rather than i18n keys — unlike renderActivityEntry this
line has no UI counterpart to stay in step with. The breakdown is omitted when
only one bucket is non-zero, since it would restate the total, and latestAt is
rendered in the project zone so it agrees with the Today date the model is
given."
```

---

## Task 8: Snapshot field and prompt wiring

**Files:**
- Modify: `src/app/chat-tools.ts` (the `getSnapshot()` contract)
- Modify: `src/app/use-chat-dispatcher.ts` (compute it)
- Modify: `src/app/chat-api.ts` (render it into the volatile suffix)
- Test: `src/app/chat-api.test.ts`, `src/app/chat-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// ★★★ THE PLACEMENT TEST. Asserting the text appears "somewhere in the prompt"
//    PASSES with the block in the CACHED prefix — which is the defect, since
//    activity changes every turn and would invalidate the cache on every
//    message. Assert the BLOCK INDEX.
it("puts the activity recap in the VOLATILE block, never the cached prefix", () => {
  const blocks = buildSystemPrompt("en-US", snapshotFixture({
    activitySummary: { total: 3, byActor: { user: 3, ai: 0, integration: 0, unknown: 0 },
                       latestAt: "2026-08-16T09:00:00.000Z" },
  }), [], false);
  expect(blocks[0].text).not.toContain("Recent project activity");
  expect(blocks[1].text).toContain("Recent project activity");
  expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
});

it("omits the recap entirely when there is no summary", () => {
  const blocks = buildSystemPrompt("en-US", snapshotFixture({ activitySummary: undefined }), [], false);
  expect(blocks[1].text).not.toContain("Recent project activity");
});
```

And in `chat-tools.test.ts`, extend the existing snapshot guard:

```ts
it("keeps the raw activityLog OFF the snapshot but allows the bounded summary", () => {
  const snap = dispatcherFixture().getSnapshot();
  expect("activityLog" in snap).toBe(false);
  // ★ Bounded: four numbers and a timestamp. get_app_state returns the
  //   snapshot VERBATIM, which is exactly why getActivityLog() is a method.
  expect(Object.keys(snap.activitySummary?.byActor ?? {})).toHaveLength(4);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/chat-api.test.ts src/app/chat-tools.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL.

- [ ] **Step 3: Add the snapshot field**

In `src/app/chat-tools.ts`, inside the `getSnapshot()` return type after `viewDigest`:

```ts
    /** Bounded counts for the ambient recap — four numbers and a timestamp.
     *  ★★★ NOT the log. `get_app_state` returns the snapshot VERBATIM, which
     *  is precisely why `getActivityLog()` is a separate method. This is safe
     *  here for the same reason `insights` and `viewDigest` are: bounded and
     *  small. Absent when the recap toggle is off or the window is empty. */
    activitySummary?: ActivitySummary;
```

- [ ] **Step 4: Compute it in the dispatcher**

In `src/app/use-chat-dispatcher.ts`'s `getSnapshot`, which already holds `activityLogRef` and the timezone:

```ts
        // ★ Skipped entirely — not merely hidden — when the toggle is off, so
        //   the scan costs nothing for a user who does not want the feature.
        activitySummary:
          settingsRef.current.ai.activityRecap !== false
            ? summarizeRecentActivity(
                activityLogRef.current,
                todayRef.current,
                getTimezoneValue(),
              ) ?? undefined
            : undefined,
```

★ `?? undefined` because the engine returns `null` for an empty window while the snapshot field is optional; a literal `null` would defeat the `!summary` guard's intent at the render site and read as "computed, and the answer is nothing" rather than "absent".

Use whatever the file already calls to resolve the zone for `getTimezone()` — the same value, so the recap's day and the model's `Today is …` cannot disagree.

- [ ] **Step 5: Wire the block**

In `src/app/chat-api.ts`, beside the existing `insightsBlock`:

```ts
  // Activity changes on EVERY turn, so this block MUST stay in the uncached
  // suffix — in the cached prefix it would invalidate the prompt cache on
  // every message, which costs far more than the ~20 tokens it saves.
  const activityBlock = buildActivityRecapBlock(snapshot.activitySummary ?? null, snapshot.timezone);
```

and add `activityBlock` to the `volatileText` array after `insightsBlock`.

★ If `snapshot` carries no timezone field, add one alongside `activitySummary` rather than reaching for a clock in `chat-api.ts` — that file must stay pure with respect to time.

- [ ] **Step 6: Verify**

```bash
npx vitest run src/app/chat-api.test.ts src/app/chat-tools.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/chat-tools.ts','utf8').split('\n').length)"
```

Expected: `EXIT=0`; size still comfortably under 800 thanks to Task 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/chat-tools.ts src/app/use-chat-dispatcher.ts src/app/chat-api.ts src/app/chat-api.test.ts src/app/chat-tools.test.ts
git commit -m "feat(ai): put the bounded activity summary on the snapshot

Four numbers and a timestamp — bounded, so returning it verbatim from
get_app_state is harmless, which is the same reason insights and viewDigest are
allowed there. The raw log stays off the snapshot behind getActivityLog().

The block lands in the VOLATILE suffix. The test asserts the block INDEX rather
than that the text appears somewhere: a whole-prompt match passes with the
block in the cached prefix, which is the defect, since activity changes every
turn and would invalidate the cache on every message."
```

---

## Task 9: The two `AiConfig` toggles

**Files:**
- Modify: `src/app/settings-types.ts`
- Test: `src/app/settings-types.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("AiConfig recall toggles", () => {
  it("defaults BOTH to ON when absent", () => {
    const ai = sanitizeAiConfig({ apiKey: "", model: "claude-sonnet-5", consentAccepted: false, groundInGuides: false });
    // ★ ON by absence: search_history shipped ON in 0.241.0, so defaulting off
    //   would silently remove a live capability on upgrade.
    expect(ai.historySearch).not.toBe(false);
    expect(ai.activityRecap).not.toBe(false);
  });

  it("round-trips an explicit false", () => {
    const ai = sanitizeAiConfig({ apiKey: "", model: "claude-sonnet-5", consentAccepted: false,
                                  groundInGuides: false, historySearch: false, activityRecap: false });
    expect(ai.historySearch).toBe(false);
    expect(ai.activityRecap).toBe(false);
  });

  it("coerces a non-boolean to the ON default rather than storing garbage", () => {
    const ai = sanitizeAiConfig({ apiKey: "", model: "claude-sonnet-5", consentAccepted: false,
                                  groundInGuides: false, historySearch: "no" });
    expect(ai.historySearch).not.toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/settings-types.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/app/settings-types.ts`, on `AiConfig` after `suggestAllNextActionThresholds`:

```ts
  historySearch?: boolean; // The search_history tool. Default ON (undefined = on) — it shipped ON in 0.241.0.
  activityRecap?: boolean; // The ambient activity recap sentence. Default ON (undefined = on).
```

In `sanitizeAiConfig`, mirroring how `actionSuggestions` is handled:

```ts
    historySearch: raw.historySearch === false ? false : undefined,
    activityRecap: raw.activityRecap === false ? false : undefined,
```

★ `=== false` rather than `Boolean(...)`: only an explicit `false` turns the feature off, so any other stored value (a string, a number, a stale `null`) reads as ON — which is the default the user expects and the one that cannot silently disable a shipped capability.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/app/settings-types.test.ts --reporter=dot; echo "EXIT=$?"
git add src/app/settings-types.ts src/app/settings-types.test.ts
git commit -m "feat(settings): add historySearch and activityRecap toggles

Both default ON by absence, matching actionSuggestions: search_history shipped
ON in 0.241.0, so defaulting off would silently remove a live capability on
upgrade. Only an explicit false disables, so a stale or malformed stored value
reads as ON rather than quietly turning a feature off."
```

---

## Task 10: Gate the tool out of the list

**Files:**
- Modify: `src/app/chat-api.ts`
- Test: `src/app/chat-api.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("tool list gating", () => {
  it("includes search_history by default", () => {
    expect(toolsFor(undefined).map((t) => t.name)).toContain("search_history");
  });

  it("removes search_history when the toggle is off", () => {
    // ★ REMOVED, not refused: a refused tool still costs its schema on every
    //   turn, which is most of what the toggle is for.
    expect(toolsFor(false).map((t) => t.name)).not.toContain("search_history");
  });

  // ★★ The cache breakpoint rides the LAST element. Removing a tool must not
  //    leave the marker on an element that is no longer last, or the tools
  //    segment stops caching.
  it("keeps the cache breakpoint on the last element of BOTH variants", () => {
    for (const variant of [toolsFor(undefined), toolsFor(false)]) {
      expect(variant[variant.length - 1].cache_control).toEqual({ type: "ephemeral" });
      expect(variant.slice(0, -1).every((t) => t.cache_control === undefined)).toBe(true);
    }
  });

  // ★ Referential stability: the arrays are module-level, not rebuilt per call.
  it("returns a STABLE reference for the same setting", () => {
    expect(toolsFor(undefined)).toBe(toolsFor(true));
    expect(toolsFor(false)).toBe(toolsFor(false));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/chat-api.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL — `toolsFor is not a function`.

- [ ] **Step 3: Implement**

Replace the existing `CACHED_TOOLS` constant in `src/app/chat-api.ts`:

```ts
/** Mark the LAST element as the cache breakpoint — a tools-block breakpoint is
 *  expressed by marking the final element, and the segment then covers
 *  everything up to and including it. */
function withCacheBreakpoint(defs: typeof TOOL_DEFS) {
  return defs.map((def, i) =>
    i === defs.length - 1
      ? { ...def, cache_control: { type: "ephemeral" as const } }
      : def,
  );
}

export const CACHED_TOOLS = withCacheBreakpoint(TOOL_DEFS);

const CACHED_TOOLS_NO_HISTORY = withCacheBreakpoint(
  TOOL_DEFS.filter((d) => d.name !== "search_history"),
);

/**
 * The tool list for this user's settings.
 *
 * ★★ TWO FROZEN MODULE-LEVEL VARIANTS, never a filter at the call site. The
 *    list is passed to every request, so rebuilding it per call would destroy
 *    referential stability for no benefit — the setting is constant for the
 *    whole conversation.
 *
 * ★ The breakpoint is RECOMPUTED per variant rather than assumed. Today
 *   `search_history` is not last (`update_settings` is, of 39 tools), so
 *   removing it happens not to move the marker — but a tool appended after it
 *   later would make that assumption silently wrong, and a lost breakpoint is
 *   invisible except as a bill.
 */
export function toolsFor(historySearch: boolean | undefined) {
  return historySearch === false ? CACHED_TOOLS_NO_HISTORY : CACHED_TOOLS;
}
```

`callClaude` gains a `historySearch: boolean | undefined` parameter and passes `tools: toolsFor(historySearch)`. Thread the setting from `chat-panel.tsx`'s call site.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/app/chat-api.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/chat-api.ts src/app/chat-api.test.ts src/app/chat-panel.tsx
git commit -m "feat(ai): gate search_history out of the tool list

Removed rather than refused — a refused tool still costs its schema on every
turn, which is most of what the toggle is for.

Two frozen module-level variants rather than a per-call filter, so referential
stability survives; the setting is constant for a whole conversation. The cache
breakpoint is recomputed per variant rather than assumed: search_history is not
currently last, so removing it happens not to move the marker, but a tool added
after it later would make that assumption silently wrong and a lost breakpoint
is invisible except as a bill."
```

---

## Task 11: Settings UI and i18n

**Files:**
- Modify: `src/app/settings-sections/ai-section.tsx`
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, beside `settingsAiActionSuggestions`:

```ts
  settingsAiHistorySearch: "Let the assistant search project history",
  settingsAiHistorySearchHelp:
    "Adds a tool the assistant can call to read the activity log. Costs nothing until it is used.",
  settingsAiActivityRecap: "Tell the assistant how much changed recently",
  settingsAiActivityRecapHelp:
    "Adds one line to every message with a count of the last 7 days' changes, so the assistant knows history exists.",
```

- [ ] **Step 2: Add the DE keys**

★★★ **`i18n.de.ts` is CRLF and the Edit tool corrupts it** — it mangles umlauts and curls double quotes, and it does so even on umlaut-free strings. Patch via a throwaway node script using explicit `"utf8"`, then verify.

```js
// scratch-de-patch.mjs — delete after use
import { readFileSync, writeFileSync } from "node:fs";
const p = "src/app/i18n.de.ts";
const src = readFileSync(p, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";
const anchor = "  settingsAiActionSuggestions:";
const additions = [
  '  settingsAiHistorySearch: "Assistent darf den Projektverlauf durchsuchen",',
  '  settingsAiHistorySearchHelp:',
  '    "Stellt dem Assistenten ein Werkzeug bereit, mit dem er das Aktivitätsprotokoll liest. Verursacht erst bei Nutzung Kosten.",',
  '  settingsAiActivityRecap: "Assistent über den Umfang der letzten Änderungen informieren",',
  '  settingsAiActivityRecapHelp:',
  '    "Fügt jeder Nachricht eine Zeile mit der Anzahl der Änderungen der letzten 7 Tage hinzu, damit der Assistent weiß, dass ein Verlauf existiert.",',
].join(eol);
if (!src.includes(anchor)) throw new Error("anchor not found — check the EOL and the key name");
writeFileSync(p, src.replace(anchor, additions + eol + anchor), "utf8");
```

Run and verify:

```bash
node scratch-de-patch.mjs && rm scratch-de-patch.mjs
grep -c "Aktivitätsprotokoll\|Änderungen\|weiß" src/app/i18n.de.ts   # must be >= 3
grep -c '[“”]' src/app/i18n.de.ts                                     # must be 0
npx tsc --noEmit; echo "EXIT=$?"
```

`tsc` enforces EN/DE key parity, so a missing key is a typecheck error, not a runtime surprise. The `i18n-encoding` test bans ASCII substitutes (`fuer`, `druecken`) — real umlauts only.

- [ ] **Step 3: Add the two rows**

In `src/app/settings-sections/ai-section.tsx`, directly after the `actionSuggestions` block, mirroring it exactly:

```tsx
        {/* search_history tool (B2a). Default ON (undefined = on). */}
        <label className="mt-3 flex items-center gap-2">
          <Checkbox
            aria-label={t(lang, "settingsAiHistorySearch")}
            checked={settings.ai.historySearch !== false}
            onChange={() =>
              onChange({
                ...settings,
                ai: { ...settings.ai, historySearch: settings.ai.historySearch === false },
              })
            }
          />
          <span className="text-xs text-foreground">{t(lang, "settingsAiHistorySearch")}</span>
        </label>
        <FieldHint className="mt-1">{t(lang, "settingsAiHistorySearchHelp")}</FieldHint>

        {/* Ambient activity recap (B2b). Default ON (undefined = on). */}
        <label className="mt-3 flex items-center gap-2">
          <Checkbox
            aria-label={t(lang, "settingsAiActivityRecap")}
            checked={settings.ai.activityRecap !== false}
            onChange={() =>
              onChange({
                ...settings,
                ai: { ...settings.ai, activityRecap: settings.ai.activityRecap === false },
              })
            }
          />
          <span className="text-xs text-foreground">{t(lang, "settingsAiActivityRecap")}</span>
        </label>
        <FieldHint className="mt-1">{t(lang, "settingsAiActivityRecapHelp")}</FieldHint>
```

★ The `aria-label` and the visible `<span>` carry the SAME string, so WCAG 2.5.3 (label-in-name) holds by construction. The axe gate cannot see a 2.5.3 violation — the rule exists but is tagged `experimental` and axe's default `tagExclude` drops it — so matching them at write time is the only protection.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/settings-view.test.ts src/app/i18n-encoding.test.ts --reporter=dot; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
git add src/app/settings-sections/ai-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(settings): surface the two AI recall toggles

Mirrors the actionSuggestions row exactly, including the shared Checkbox
primitive. The aria-label and the visible span carry the same string, so
WCAG 2.5.3 holds by construction — the axe gate cannot see a 2.5.3 violation
because the rule is tagged experimental and axe's default tagExclude drops it,
so matching them at write time is the only protection."
```

---

## Task 12: The Activity panel actor column and filter

**Files:**
- Modify: `src/app/activity-log-panel.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/activity-log-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
it("renders the actor for each entry and a dash when it is absent", () => {
  render(<ActivityLogPanel lang="en-US" onClear={() => {}} entries={[
    entryFixture({ id: "a", actor: "ai" }),
    entryFixture({ id: "b" }),
  ]} />);
  expect(screen.getByText("AI assistant")).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
});

it("filters rows by actor", async () => {
  render(<ActivityLogPanel lang="en-US" onClear={() => {}} entries={[
    entryFixture({ id: "a", actor: "ai", args: [1, "AiTask"] }),
    entryFixture({ id: "b", actor: "user", args: [2, "UserTask"] }),
  ]} />);
  await userEvent.click(screen.getByRole("radio", { name: "AI assistant" }));
  expect(screen.queryByText(/UserTask/)).not.toBeInTheDocument();
  expect(screen.getByText(/AiTask/)).toBeInTheDocument();
});

// ★ An unknown-but-string actor must not crash the panel: a throw here is not
//   a blank table, it is the full-screen ErrorBoundary page on every visit.
it("renders an unknown-but-string actor without crashing", () => {
  render(<ActivityLogPanel lang="en-US" onClear={() => {}} entries={[
    entryFixture({ id: "a", actor: "toString" as never }),
  ]} />);
  expect(screen.getByText("—")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/activity-log-panel.test.tsx --reporter=dot; echo "EXIT=$?"
```

Expected: FAIL.

- [ ] **Step 3: Add the EN keys**

```ts
  activityHeaderActor: "By",
  activityActorUser: "User",
  activityActorAi: "AI assistant",
  activityActorIntegration: "Integration",
  activityActorFilterHint: "Show only entries caused by this actor",
```

DE, via the same node-write recipe as Task 11 Step 2:
`activityHeaderActor: "Von"`, `activityActorUser: "Benutzer"`, `activityActorAi: "KI-Assistent"`, `activityActorIntegration: "Integration"`, `activityActorFilterHint: "Nur Einträge dieses Verursachers anzeigen"`.

- [ ] **Step 4: Implement the column**

Widths (`ACTIVITY_LOG_COL_WIDTHS`) gain `actor: 110`, which also extends `ActivityLogCol` since it is `keyof typeof`.

Add the header as a **plain `<th>` with no sort button**:

```tsx
                <th
                  className="relative px-3 py-2 font-medium text-xs uppercase tracking-wide"
                  style={{ width: colWidths.actor, minWidth: colWidths.actor }}
                >
                  {t(lang, "activityHeaderActor")}
                  <ColumnResizeHandle col="actor" onMouseDown={startResize} />
                </th>
```

★★ Deliberately NOT sortable. The three existing headers are raw `<th>`s with hand-rolled sort buttons and **no `aria-sort`** — a known gap. A fourth sort button deepens that debt; a plain cell does not. Folding this table into `SortResizeTh` is a separate follow-up, out of scope here.

The cell, placed after the `kind` cell:

```tsx
                  <td className="whitespace-nowrap px-3 py-2 text-[11px] text-muted-foreground">
                    {actorLabel}
                  </td>
```

And in the `enriched` memo, computed with an own-property guard:

```ts
// ★★ Own-property guard, never a bare index: sanitizeActivityEntry KEEPS an
//    unknown-but-string actor, so `actor: "toString"` reaches here and a bare
//    lookup resolves a Function.prototype method — which React then throws on,
//    giving the full-screen ErrorBoundary page on every Activity visit until
//    the project data is repaired.
const ACTOR_KEYS = {
  user: "activityActorUser",
  ai: "activityActorAi",
  integration: "activityActorIntegration",
} as const;

const actorKey =
  typeof entry.actor === "string" &&
  Object.prototype.hasOwnProperty.call(ACTOR_KEYS, entry.actor)
    ? ACTOR_KEYS[entry.actor as keyof typeof ACTOR_KEYS]
    : null;
const actorLabel = actorKey ? t(lang, actorKey) : "—";
```

- [ ] **Step 5: Implement the filter**

Beside the existing `groupFilter`, using the same shared primitive:

```tsx
type ActorFilter = "all" | "user" | "ai" | "integration";
const [actorFilter, setActorFilter] = useState<ActorFilter>("all");
```

```tsx
        <SegmentedControl<ActorFilter>
          value={actorFilter}
          ariaLabel={t(lang, "activityHeaderActor")}
          title={t(lang, "activityActorFilterHint")}
          options={[
            { value: "all", label: t(lang, "activityFilterAll") },
            { value: "user", label: t(lang, "activityActorUser") },
            { value: "ai", label: t(lang, "activityActorAi") },
            { value: "integration", label: t(lang, "activityActorIntegration") },
          ]}
          onChange={setActorFilter}
        />
```

In the filter memo, beside the `groupFilter` clause:

```ts
    if (actorFilter !== "all") {
      result = result.filter((row) => row.entry.actor === actorFilter);
    }
```

Add `actorFilter` to that memo's dependency array.

★★ ONE toolbar control, never a per-row one. Per-row controls in a list need row-unique accessible names, and **no axe rule can catch a collision** — measured against axe-core 4.12.1, of its 105 rules the 69 carrying one of the four tags `e2e/a11y.spec.ts` requests include none that flags two controls sharing a name. §111 and §126 are open for exactly this.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/app/activity-log-panel.test.tsx --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
git add src/app/activity-log-panel.tsx src/app/activity-log-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(activity): show and filter by actor in the Activity panel

A plain non-sortable cell plus ONE toolbar SegmentedControl. Not sortable
because the three existing headers are raw th elements with hand-rolled sort
buttons and no aria-sort; a fourth would deepen that debt. One toolbar filter
rather than per-row controls because per-row controls need row-unique
accessible names and no axe rule can see a collision.

The label lookup uses an own-property guard: the sanitizer keeps an
unknown-but-string actor, so actor: 'toString' reaches the renderer and a bare
index resolves a Function.prototype method — which React throws on, giving the
full-screen ErrorBoundary page on every Activity visit."
```

---

## Task 13: Full gates, docs, release

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `package.json`, `package-lock.json`, `docs/CODEMAPS/*.md`
- Modify: `AGENTS.md` (Activity log bullet)

- [ ] **Step 1: Run every gate**

Never pipe — you get the pipe's exit code, not the command's:

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

★ `test:shuffle` is the ONLY local reproduction of the blocking `unit-tests-shuffled` job, and this slice adds tests — run it.

★ `chat-tool-summaries.ts` is a NEW coverage-gated `.ts` file. If `test:coverage` fails on it, that is real: either cover it or note that its functions are exercised through `chat-tools.test.ts`.

- [ ] **Step 2: Regenerate goldens only if the sample changed**

```bash
npx vitest run src/app/golden-workspace.test.ts --reporter=dot; echo "EXIT=$?"
```

If it fails: this slice does not change the sample workspace, so a failure means an unintended format change. **Investigate — do not regenerate to mask it.**

- [ ] **Step 3: Update `AGENTS.md`**

In the **Activity log** bullet, add:

```
  ★★ Entries carry an optional `actor` (`user` | `ai` | `integration`), and ABSENCE IS NOT `"user"` —
  pre-B2b entries have a genuinely unknown actor. It rides all six write paths free because every one
  serialises the entry as JSON wholesale (CSV is one `config,<json>` cell, MD a fenced json block), so
  the six-write-paths landmine above is about a new SLICE, not a new FIELD on a blob entry.
  ★★ `sanitizeActivityEntry` KEEPS an unknown-but-string actor for the same forward-compat reason it
  keeps an unknown kind, so every actor lookup needs an own-property guard, never a bare index.
  ★★★ The AI dispatcher's 20 entity writers NOW LOG (`actor: "ai"`, existing kinds). They logged
  nothing before B2b — the audit trail was blind to every AI-made change. Bulk writers log ONE
  summarising row: the log caps at `ACTIVITY_MAX_ENTRIES` (500), so N rows from one chat turn can age
  out a week of user history. ★ `completion-trend.ts` COUNTS `task.created`/`task.deleted`, so
  AI-created tasks now move that trend — intended, but it is a change to an existing derived metric.
```

- [ ] **Step 4: Bump the version in all ten places**

Only two are gated; the rest drift silently. Pick the next minor and a fresh milestone codename.

- `src/app/version.ts` — `APP_VERSION`, `APP_BUILD_DATE`, `APP_MILESTONE`, and append the new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS`
- `CHANGELOG.md` — a new section
- `package.json` — `version`
- `package-lock.json` — **two** occurrences (root `version` and `packages[""]`)
- `README.md` — the shields badge: version **and** codename
- `docs/CODEMAPS/*.md` — the generated header on **all five**

★ `version.ts` is CRLF. Add the matching EN/DE `versionHighlight*` strings.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(release): <version> \"<Codename>\""
```

- [ ] **Step 6: Hand back**

Report gate results with their exit codes and stop. Do **not** push, open an MR, or merge — those need an explicit instruction.

---

## Self-review

**Spec coverage.** Every spec section maps to a task: `ActivityEntry.actor` → Tasks 1–2; logging AI entity writes → Task 4; the nudge engine → Task 6; the renderer → Task 7; transport → Task 8; the two toggles → Tasks 9–10; settings UI → Task 11; the panel → Task 12; the `chat-tools.ts` prerequisite → Task 0; the `view-ai-scope.ts` correction → Task 5.

**One spec claim corrected here.** The spec says the sanitizer is "the only load-boundary work" for keeping an unknown actor. It is not — `sanitizeActivityEntry` already returns entries by reference or by spread, never from a field list, and its own comment states that a field a newer release adds must survive an older client's round trip. Keeping is free; only the strip branch is new. Task 1 says so and its test for the keep case may pass before the implementation, which is expected rather than a broken test.

**One risk the spec did not carry.** `completion-trend.ts` counts `task.created` and `task.deleted` entries. Task 4 therefore moves an existing derived metric — arguably a correction, since AI-created tasks are real tasks, but it is a visible behaviour change and Task 13 records it in `AGENTS.md`.

**Type consistency.** `ActivityActor`, `ActivitySummary`, `RECAP_WINDOW_DAYS`, `summarizeRecentActivity`, `buildActivityRecapBlock`, `logActivityAs`, `logActivityChangesAs`, `toolsFor` are each defined once and used with the same signature throughout. The one import-direction hazard — `activity-prompt.ts` importing the value `RECAP_WINDOW_DAYS` back from `history-search.ts`, which already imports from it — is flagged at Task 7 Step 3 with the fallback spelled out.
