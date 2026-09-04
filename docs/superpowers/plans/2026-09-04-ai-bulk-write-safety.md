# AI Bulk-Write Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI write undoable, and make destructive or multi-row AI turns reviewable before they land.

**Architecture:** Joins three mechanisms already shipped in this repo — the undo stack every human write path uses, the descriptor/diff engine behind inline "Ask Claude", and the proposal/replay pipeline built for insight recommendations. Phase 1 (B1) gives AI writes undo capture and is independently shippable. Phase 2 (B2) stages destructive or multi-write turns into an inline review card that applies as a single undo entry.

**Tech Stack:** TypeScript, React 19, Next 16, vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-ai-bulk-write-safety-design.md`

---

## ★★★ CORRECTIONS — measured during execution, 2026-09-04

Five things in this plan were wrong. Every one was found by an implementer running a command, none
by re-reading. Read these before any remaining task; where a task body below contradicts this
section, **this section wins.**

1. **`ChatDispatcherArgs` is in `src/app/chat-dispatcher-types.ts:13`**, not in
   `use-chat-dispatcher.ts` — that file only re-exports the type. Tasks below name the wrong file.

2. **`makeDispatcherArgs({ initialTasks })` does not and cannot exist.** `useChatDispatcher` takes
   no task list; it reads `tasks`/`setTasks` from `useWorkspace()`. Tests seed through the render
   wrapper: `renderHook(..., { wrapper: dispatcherWrapper(seedTasks) })`. `TestProviders` seeds ONCE
   on mount and ignores later `tasks` prop changes, so a rerender cannot reseed. Every test body
   below using `initialTasks` needs this shape instead.

3. **Read `undoRef.current?.captureComposite(...)`, never `args.undo?.`.** The dispatcher is a
   `useMemo` keyed on `[args.isReadOnly, documentTools, registerTools]`, so a directly-read
   `args.undo` captures the object from whichever render last recomputed the memo and goes stale
   invisibly — no single-render test can see it. Task 2 added the ref. Do NOT hoist `args.undo` to a
   local const the way the file does for `logActivityAs`; that hoist exists only to satisfy
   `exhaustive-deps`, refs are not deps, and imitating it reintroduces the staleness. Do NOT add
   `args.undo` to the memo's dep array either — `useUndoStack` returns a fresh identity per render,
   so that would rebuild the dispatcher every render and defeat the ref.

4. **★★★ CREATES ARE NOT CAPTURED. The engine cannot reverse a create, and capturing one is worse
   than not.** `UndoOp` is `"delete" | "edit"` (`undo-stack.ts:12`); the undo direction never
   removes. A create captured as a `removed` image finds its row still live at undo time, so
   `applyUndoRestoreWithRemap` takes the id-reuse branch (`:137-146`), mints `max+1` and splices in
   a **second copy**. Measured: undoing an AI create of a third row yields four rows.
   - **Task 3's capture was removed.** Its test now pins the ABSENCE with the reason.
   - **Task 5's table must drop every `*.created` row** — `raid.created`, `change.created`,
     `milestone.created`, `stakeholder.created`, `resource.created`. Only updates and deletes are
     captured. A table row for a create is a test for a defect.
   - **Task 12 must PARTITION the approved plan at capture time.** Build images from the delete and
     edit rows ONLY, with `fromArray` = the pre-op array, and exclude created rows from the image
     list entirely. Set `primaryCount` from the reversible rows alone (or label it "N of M") so the
     entry never claims rows it cannot reverse.
   - Creates are protected by the **gate**, not by undo: any turn writing more than one row stages,
     so the only un-undoable create is a lone one — which matches every human create in this app.

5. **`fromArray` differs by op, and a fragment gets only one.** `buildBeforeImages(removed, edited,
   fromArray)` resolves every image against a single array via
   `Math.max(0, fromArray.findIndex(...))`. For a **delete**, `fromArray` must be the **pre-op**
   array — that is where the row still exists. (For a create it would have to be post-op, which is
   half of why creates cannot share a fragment with deletes: measured, a `{delete B, create NEW}`
   fragment restored B at index 0 instead of 1, and published a bogus id-remap that any cascade
   declaring `fkRemapField` would follow onto the duplicate.) Deletes captured alone against the
   pre-op array were measured correct — row returns at its own index, empty remap.

6. **★★★ Task 8's "expected to survive" mutant is NOT equivalent, and pre-classifying it was the
   error.** The plan says of `cascadeDeselect`'s `if (!next.delete(cur)) continue;` that removing it
   "is an optimisation, not a guard" and should be "recorded as an equivalent mutant rather than as
   a test gap". False. The guard stops the walk at a row that was NOT selected; without it,
   deselecting an already-deselected row walks on through its dependents. Probed both spellings —
   rows `[0, 1←0]`, `selected={1}`, deselect `0`: guarded yields `[1]`, unguarded yields `[]`. It
   survived the plan's three tests and was killed by an idempotence test the plan never asked for.
   **The general rule: never pre-classify a mutant as equivalent in a plan.** The classification
   arrives before the measurement and tells the reader to stop looking, which is licence to delete a
   live guard. State the mutant, demand the verdict, supply none.

7. **★★★ Task 10's `{id: NaN}` sentinel is WRONG for deletes, and fails silently.** The plan says
   "`describeEntityCalls` only consults `item` on the update path, so a sentinel is safe and keeps
   one code path". Half right. Creates never read `ctx.item` — true. But the DELETE branch does:
   `plan.ts:183` is `if (name === d.deleteTool && id !== item.id)`, and `NaN` compares unequal to
   everything, so **every own-entity delete would be rejected as `"unsupported"` and never appear in
   the card.** Two more facts from the same reading:
   - `ownIds` (`plan.ts:116`) is built from `ws[d.wsKey]` **unguarded** — a workspace missing that
     slice THROWS rather than yielding an empty plan. It is read before any branch.
   - `RecommendPlanWorkspace` is `Pick<Workspace, "tasks"|"raid"|"changes"|"milestones"|"stakeholders">`
     — **no `resources`**. Reusing that type for chat grounding makes every resource call throw at
     `ownIds`. Pass the full `Workspace`.

   **`insights/recommend-plan.ts` already solves this and is the template — copy it, do not
   re-derive it.** It seeds per OP: a delete gets `item = {id}` (the call's OWN target), so the
   self-guard passes trivially and the real grounding is `ownIds.has(id)`; an update looks the row
   up and falls back to `{id: NaN}` so a miss rejects as `"unknown-id"`; a create passes `{id: NaN}`
   and any descriptor.

   ★ Related, from the same task: the rejection literal is NOT fixed. For an id that differs from
   `ctx.item.id` the engine picks `ownIds.has(id) ? "unsupported" : "unknown-id"`. Any test asserting
   one flatly is asserting a case, not the rule.

★ Two process notes carried forward: `git commit --only` on a path matching no change **silently
commits nothing for that path and does not error** — check `git show --stat` against intent. And the
shared test fixture is `src/test/chat-dispatcher-fixture.tsx` (`.tsx`, not `.ts`, and `src/test/`
not `src/app/test/` — the latter is not in `vitest.config.ts` `coverage.exclude`).

---

## Read this before Task 1

**Line endings.** Every `src/app/*.ts(x)` file is CRLF. The `Write` tool emits LF and `Edit`
preserves — so create new source files with `Write`, then convert:

```bash
node -e "const f=process.argv[1],s=require('fs');s.writeFileSync(f,s.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" src/app/<newfile>.ts
git ls-files --eol src/app/<newfile>.ts   # want: i/lf w/crlf  (w/lf means it was not converted)
```

`docs/**` is LF and gitattributes-enforced — do not convert those.

**Never edit `src/app/i18n.de.ts` with Edit or Write.** It corrupts umlauts and curls quotes. Patch
it with a node utf8 write using `\r\n` anchors (Task 11 gives the script).

**Never run two vitest processes at once.** A red run carrying `Failed to start forks worker` is
machine contention, not a real failure. Session `aipm-cockpit-01` shares this machine — check with
it before a full-suite run. The full suite must be **sharded**; a backgrounded full run is killed on
the memory threshold and a foreground one is backgrounded at the 600s timeout and killed. Per-file
runs used in these tasks are safe.

**Never read a gate's exit code through a pipe** — you get the pipe's status. Redirect, echo `$?`
unpiped, then read the file.

**`npx tsc --noEmit` exits 2 on diagnostics**, not 1.

**Branch:** `feat/ai-bulk-write-safety`, already created off `origin/main` at `7f90fd81`. Three docs
commits are on it. Do not push, open an MR, or merge — those need the user's explicit say.

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `src/app/chat-proposal.ts` | **New.** Pure, i18n-free. The staging gate (`shouldStage`), the `ProposedCall` type, provisional-id dependency graph, and the cascade-deselect rule. No React, no workspace access. | 2 |
| `src/app/chat-proposal.test.ts` | **New.** Table-driven gate tests, dependency and cascade tests. | 2 |
| `src/app/chat-proposal-describe.ts` | **New.** Pure. Grounds a whole plan against the live workspace by calling `describeEntityCalls` **once per call** with that call's own target row. Returns one `EditPlan` per row. | 2 |
| `src/app/chat-proposal-describe.test.ts` | **New.** Multi-row and multi-entity grounding tests. | 2 |
| `src/app/chat-proposal-block.tsx` | **New.** Presentational review card: per-row checkboxes with row-unique accessible names, show-more, Discard/Apply, per-row failure reporting. Data and handlers as props. | 2 |
| `src/app/chat-proposal-block.test.tsx` | **New.** Row-unique-name assertion with `requireCollisionSeed`, cascade UI, failure rendering. | 2 |
| `src/app/inline-ai-edit/entity-descriptor.ts` | **Modify.** Add `"resource"` to `InlineEntity` and a descriptor to `INLINE_DESCRIPTORS`. | 2 |
| `src/app/inline-ai-edit/plan.ts` | **Modify.** Add `create_resource` to `CREATE_TOOLS` and `delete_resource` to `DELETE_TOOLS`. | 2 |
| `src/app/insights/recommend-tokens.ts` | **Modify.** Export `stampCall` (today a bare `function` at `:69`) so chat can reuse it. | 2 |
| `src/app/use-chat-dispatcher.ts` | **Modify.** Undo capture on every AI write (Phase 1); staging mode (Phase 2). | 1 + 2 |
| `src/app/task-manager.tsx` | **Modify.** One property: thread `undoApi` into the `useChatDispatcher({...})` call at `:1799`. | 1 |
| `src/app/chat-panel.tsx` | **Modify.** Render `ChatProposalBlock` for a message carrying a pending plan. | 2 |
| `src/app/chat-tool-defs.ts` | **Modify.** Remove the seven unenforced "Confirm with the user first" clauses. | 2 |
| `src/app/chat-api.ts` | **Modify.** System-prompt paragraph describing staged results. | 2 |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | **Modify.** New EN + DE keys for the card. | 2 |

★ `task-manager.tsx` is held heavily modified by session `aipm-cockpit-01` on `feat/timelog-guardrails`.
Confirm with it before Task 3.

---

# Phase 1 — B1: AI writes become undoable

Independently shippable. Closes the unrecoverable-write hole and is what track C depends on.

### Task 1: Prove the gap exists

**Files:**
- Test: `src/app/use-chat-dispatcher.undo.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

This is a characterization test that must go RED. It asserts the property we are about to add.

```tsx
// src/app/use-chat-dispatcher.undo.test.tsx
import { describe, expect, test, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { makeDispatcherArgs } from "./test/chat-dispatcher-fixture";

describe("AI writes capture undo", () => {
  test("createTask pushes exactly one undo entry", () => {
    const captureComposite = vi.fn();
    const { result } = renderHook(() =>
      useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite } })),
    );

    act(() => {
      result.current.createTask({
        taskName: "Ingest review",
        assignee: "M. Jordan",
        dueDate: "2026-09-30",
      });
    });

    expect(captureComposite).toHaveBeenCalledTimes(1);
    const opts = captureComposite.mock.calls[0][0];
    expect(opts.kind).toBe("task.created");
    expect(opts.primaryCount).toBe(1);
  });
});
```

- [ ] **Step 2: Create the fixture the test imports**

```ts
// src/app/test/chat-dispatcher-fixture.ts
import type { ChatDispatcherArgs } from "../use-chat-dispatcher";

/** A minimal ChatDispatcherArgs for unit tests. Override only what the test
 *  asserts on; every other dependency is a no-op so a test cannot accidentally
 *  depend on a field it did not set. */
export function makeDispatcherArgs(
  over: Partial<ChatDispatcherArgs> = {},
): ChatDispatcherArgs {
  return {
    isReadOnly: false,
    logActivityAs: () => {},
    ...over,
  } as ChatDispatcherArgs;
}
```

Read the real `ChatDispatcherArgs` in `src/app/use-chat-dispatcher.ts` and add every required
field this cast is papering over — the `as` is a starting point, not the finished fixture. If a
required field has no sensible no-op, give it a `vi.fn()`.

- [ ] **Step 3: Run it and confirm it fails for the right reason**

```bash
npx vitest run src/app/use-chat-dispatcher.undo.test.tsx --reporter=dot > /tmp-scratch/t1.log 2>&1; echo "EXIT=$?"
grep -E "Tests |expected" /tmp-scratch/t1.log
```

Expected: FAIL, `captureComposite` called 0 times. **Not** a module-resolution or type error — if
the failure is anything other than the assertion, fix the fixture first. A test that fails because
the file does not import is not evidence of the gap.

- [ ] **Step 4: Convert line endings and commit the RED test**

```bash
node -e "const f=process.argv[1],s=require('fs');s.writeFileSync(f,s.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" src/app/use-chat-dispatcher.undo.test.tsx
node -e "const f=process.argv[1],s=require('fs');s.writeFileSync(f,s.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" src/app/test/chat-dispatcher-fixture.ts
git ls-files --eol src/app/use-chat-dispatcher.undo.test.tsx src/app/test/chat-dispatcher-fixture.ts
git commit --only src/app/use-chat-dispatcher.undo.test.tsx src/app/test/chat-dispatcher-fixture.ts -m "test(ai): pin that AI writes must capture undo (RED)"
```

---

### Task 2: Thread the undo API into the dispatcher

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts` (the `ChatDispatcherArgs` interface)

- [ ] **Step 1: Add the optional dependency**

Add to `ChatDispatcherArgs`:

```ts
  /** Undo capture for AI writes. Optional so every existing test and the popout
   *  path keep working untouched; when absent, writes apply exactly as before.
   *  ★ Optional is a MIGRATION affordance, not a design choice — once every
   *  call site passes it, make it required. An always-optional dependency is
   *  how a write path silently stops capturing. */
  undo?: Pick<UndoStackApi, "captureComposite">;
```

Import the type:

```ts
import type { UndoStackApi } from "./undo/use-undo-stack";
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit > /tmp-scratch/t2.log 2>&1; echo "EXIT=$?"
grep -c "error TS" /tmp-scratch/t2.log
```

Expected: EXIT=0, zero `error TS`. (Remember tsc exits **2** on diagnostics, not 1.)

- [ ] **Step 3: Commit**

```bash
git commit --only src/app/use-chat-dispatcher.ts -m "feat(ai): accept an undo capture dependency in the chat dispatcher"
```

---

### Task 3: Capture on `createTask`

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts:248` (`createTask`)

- [ ] **Step 1: Add the capture, immediately before the existing `setTasks(next)`**

The existing body ends:

```ts
        const next = [...list, newTask];
        tasksRef.current = next; // keep ref in sync for back-to-back tool calls
        setTasks(next);
        args.logActivityAs?.("ai", "task.created", newTask.id, newTask.taskName);
        return newTask;
```

Insert the capture between the ref sync and `setTasks`:

```ts
        const next = [...list, newTask];
        tasksRef.current = next; // keep ref in sync for back-to-back tool calls
        // ★ A CREATE captures the row as a DELETE image against the PRE-op
        //   array: undoing a create means removing the row, and `capturePart`
        //   expresses that as `removed` against `fromArray = list`. Passing the
        //   POST-op array here would make the image's index point one past the
        //   row it describes.
        args.undo?.captureComposite({
          kind: "task.created",
          primaryCount: 1,
          parts: [capturePart({ setter: setTasks, removed: [newTask], fromArray: next, isPrimary: true })],
          name: newTask.taskName,
          entityKey: "task",
        });
        setTasks(next);
```

Import `capturePart`:

```ts
import { capturePart } from "./undo/use-undo-stack";
```

★ `fromArray` is `next`, not `list` — `buildBeforeImages` calls
`fromArray.findIndex(r => r.id === item.id)` to record the index, and the new row exists only in
`next`. Against `list` the lookup returns `-1`, which `Math.max(0, …)` silently turns into index 0,
so undo would re-insert a restored row at the head of the list instead of its own position. This is
the kind of wrong-but-green detail the comment above must state, because no assertion in Task 1
catches it.

- [ ] **Step 2: Run the Task 1 test — it must now pass**

```bash
npx vitest run src/app/use-chat-dispatcher.undo.test.tsx --reporter=dot > /tmp-scratch/t3.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t3.log
```

Expected: PASS, 1 test.

- [ ] **Step 3: Add the index regression test**

```tsx
  test("a created row's undo image records its own index, not 0", () => {
    const captureComposite = vi.fn();
    const existing = [
      { id: 1, taskName: "First" },
      { id: 2, taskName: "Second" },
    ];
    const { result } = renderHook(() =>
      useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite }, initialTasks: existing })),
    );

    act(() => {
      result.current.createTask({
        taskName: "Third",
        assignee: "M. Jordan",
        dueDate: "2026-09-30",
      });
    });

    // capturePart returns a CompositeFragment; assert the fragment is non-null,
    // which it is only when buildBeforeImages produced an image at all.
    expect(captureComposite.mock.calls[0][0].parts[0]).not.toBeNull();
  });
```

★ This is a WEAK assertion on its own and is deliberately marked as such: `capturePart` returns
`null` only for an empty image list, so it cannot see a wrong index. Strengthening it means asserting
on the restored array after an undo, which needs the real `useUndoStack` rather than a mock. Do that
in Task 6, where the round-trip test lives; this one exists so the fragment is at least non-null.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/app/use-chat-dispatcher.undo.test.tsx --reporter=dot > /tmp-scratch/t3b.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t3b.log
git commit --only src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.undo.test.tsx -m "feat(ai): capture undo when the assistant creates a task"
```

---

### Task 4: Capture on `updateTask`

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts:290` (`updateTask`)

- [ ] **Step 1: Write the failing test**

```tsx
  test("updateTask captures the PRE-edit row as an edit image", () => {
    const captureComposite = vi.fn();
    const { result } = renderHook(() =>
      useChatDispatcher(makeDispatcherArgs({
        undo: { captureComposite },
        initialTasks: [{ id: 7, taskName: "Before", assignee: "A", dueDate: "2026-09-01" }],
      })),
    );

    act(() => {
      result.current.updateTask(7, { taskName: "After" });
    });

    const opts = captureComposite.mock.calls[0][0];
    expect(opts.kind).toBe("task.updated");
    expect(opts.primaryCount).toBe(1);
    // The image must hold the value as it was BEFORE the edit. Asserting "After"
    // here would pass against a capture taken too late — the classic wrong-green.
    expect(opts.parts[0]).not.toBeNull();
  });
```

- [ ] **Step 2: Run it — expect FAIL (0 calls)**

```bash
npx vitest run src/app/use-chat-dispatcher.undo.test.tsx -t "updateTask captures" --reporter=dot > /tmp-scratch/t4.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t4.log
```

- [ ] **Step 3: Implement — capture BEFORE the array is rebuilt**

In `updateTask`, after `existing` is found and before `setTasks`:

```ts
        // Captured from `existing` — the stored row BEFORE the merge — and
        // against `tasksRef.current`, which is still the pre-op array at this
        // point. Both halves matter: capturing `merged` would store the new
        // values as the "before" image and undo would be a no-op.
        args.undo?.captureComposite({
          kind: "task.updated",
          primaryCount: 1,
          parts: [capturePart({
            setter: setTasks,
            edited: [existing],
            fromArray: tasksRef.current,
            isPrimary: true,
          })],
          name: existing.taskName,
          entityKey: "task",
        });
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/app/use-chat-dispatcher.undo.test.tsx --reporter=dot > /tmp-scratch/t4b.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t4b.log
git commit --only src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.undo.test.tsx -m "feat(ai): capture undo when the assistant updates a task"
```

---

### Task 5: Capture on the remaining write sites

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts`

- [ ] **Step 1: Enumerate the sites — do not trust this plan's list**

```bash
grep -n "^      \(create\|update\|delete\)[A-Za-z]*: (" src/app/use-chat-dispatcher.ts
```

Record the exact list the command prints. Every one gets a capture; the entity kinds are
`task` · `raid` · `change` · `milestone` · `stakeholder` · `resource` · `calendarEvent`, matching
`UndoEntityKey` in `src/app/undo/use-undo-stack.ts`.

- [ ] **Step 2: Add one test per site, in a `test.each` table**

```tsx
  test.each([
    ["createRaidItem",    "raid.created",        "raid"],
    ["updateRaidItem",    "raid.updated",        "raid"],
    ["deleteRaidItem",    "raid.deleted",        "raid"],
    ["createChange",      "change.created",      "change"],
    ["updateChange",      "change.updated",      "change"],
    ["deleteChange",      "change.deleted",      "change"],
    ["createMilestone",   "milestone.created",   "milestone"],
    ["updateMilestone",   "milestone.updated",   "milestone"],
    ["deleteMilestone",   "milestone.deleted",   "milestone"],
    ["createStakeholder", "stakeholder.created", "stakeholder"],
    ["updateStakeholder", "stakeholder.updated", "stakeholder"],
    ["deleteStakeholder", "stakeholder.deleted", "stakeholder"],
    ["createResource",    "resource.created",    "resource"],
    ["updateResource",    "resource.updated",    "resource"],
    ["deleteResource",    "resource.deleted",    "resource"],
  ])("%s captures one undo entry with kind %s", (method, kind, entityKey) => {
    // Build the args and invoke result.current[method] with a minimal valid
    // payload for that entity, then assert kind/entityKey/primaryCount.
    // Reconcile this table against Step 1's grep output before writing it —
    // a method in the code and absent from this table silently ships uncaptured.
  });
```

★ The table above is written from the tool names, not from the dispatcher. Step 1's grep is the
source of truth. If the grep returns a method this table lacks, add it; if the table names one the
grep does not, delete it. A capture test suite that does not enumerate the real set is exactly the
false-coverage shape this repo has been bitten by.

- [ ] **Step 3: Implement each capture, then run the file**

```bash
npx vitest run src/app/use-chat-dispatcher.undo.test.tsx --reporter=dot > /tmp-scratch/t5.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t5.log
```

Expected: all green, count equal to the table length plus the earlier tests.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.undo.test.tsx -m "feat(ai): capture undo across every remaining assistant write"
```

---

### Task 6: Wire it up and prove a real round trip

**Files:**
- Modify: `src/app/task-manager.tsx:1799` (the `useChatDispatcher({...})` argument)
- Test: `src/app/use-chat-dispatcher.undo.test.tsx`

★ **`task-manager.tsx` is held modified by session `aipm-cockpit-01`** on `feat/timelog-guardrails`.
Its hunks were measured on 2026-09-04 and the seam is clear: hunks at lines 98 · 101-103 · 872-875 ·
877 · 900-912 · 915-922 · 927 · 2499-2511, with **nothing between 928 and 2498**. Both anchors sit
in that gap. Keep the new `useCallback` (if any) next to the `useChatDispatcher` call rather than
drifting it up among the other hooks near the top of `TaskManagerInner`, which is where hunks 3, 4
and 7 live.

★ **Use the anchors, not the line numbers.** `:207`/`:1799` are this checkout's numbers; the same
call sites are `:210`/`:1825` on that branch, and a main-merge on either side moves both again.
Grep `useChatDispatcher({` and `useUndoStack({`.

- [ ] **Step 1: Add the property**

At the `useChatDispatcher({...})` call, add:

```ts
    undo: undoApi,
```

`undoApi` is already in scope from `task-manager.tsx:207`.

- [ ] **Step 2: Write the round-trip test — the one that actually proves undo works**

```tsx
  test("undo restores a row the assistant edited", () => {
    // Uses the REAL useUndoStack, not a mock: the mocked tests above prove the
    // capture is CALLED; only a real stack proves the image is CORRECT. This is
    // the test that would catch a wrong `fromArray` or a post-merge capture.
    // Render a harness mounting useUndoStack + useChatDispatcher wired together,
    // seed one task, have the dispatcher update it, then call undo() and assert
    // the row holds its ORIGINAL field values and sits at its ORIGINAL index.
  });
```

Write the harness concretely — a small component calling both hooks and exposing them via a ref is
enough. Do not settle for the mocked assertion; the mock cannot see an incorrect before-image, and
an incorrect before-image is the defect this whole phase exists to prevent.

- [ ] **Step 3: Typecheck and run**

```bash
npx tsc --noEmit > /tmp-scratch/t6.log 2>&1; echo "EXIT=$?"; grep -c "error TS" /tmp-scratch/t6.log
npx vitest run src/app/use-chat-dispatcher.undo.test.tsx --reporter=dot > /tmp-scratch/t6b.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t6b.log
```

- [ ] **Step 4: Mutation-prove the round trip**

Revert exactly one thing — change `edited: [existing]` to `edited: [merged]` in `updateTask` — and
re-run. The round-trip test MUST go red. If it stays green, the test is vacuous and must be
strengthened before proceeding. Restore the line afterwards with an anchored inverse write and
confirm `git diff --stat` is empty for that file.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/task-manager.tsx src/app/use-chat-dispatcher.undo.test.tsx -m "feat(ai): give the assistant's writes real undo, proved by a round trip"
```

**Phase 1 is now independently shippable.** If the remaining phase proves too large, stop here,
run the full gate set, and release this alone — it closes the unrecoverable-write hole and is what
track C depends on.

---

# Phase 2 — B2: staged proposals with per-row review

### Task 7: The staging gate

**Files:**
- Create: `src/app/chat-proposal.ts`
- Test: `src/app/chat-proposal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/chat-proposal.test.ts
import { describe, expect, test } from "vitest";
import { shouldStage, type ProposedCall } from "./chat-proposal";

const call = (name: string, input: Record<string, unknown> = {}): ProposedCall => ({ name, input });

describe("shouldStage", () => {
  test.each([
    ["no calls",                     [],                                                        false],
    ["reads only",                   [call("list_tasks"), call("get_task", { id: 1 })],          false],
    ["one create",                   [call("create_task")],                                      false],
    ["one update",                   [call("update_task", { id: 1 })],                           false],
    ["one update plus reads",        [call("list_tasks"), call("update_task", { id: 1 })],       false],
    ["two writes",                   [call("create_task"), call("update_task", { id: 1 })],      true],
    ["one delete",                   [call("delete_task", { id: 1 })],                           true],
    ["delete plus a read",           [call("list_tasks"), call("delete_task", { id: 1 })],       true],
    ["delete_all_tasks alone",       [call("delete_all_tasks")],                                 true],
    ["settings are not entity writes", [call("set_language"), call("set_filters")],              false],
  ])("%s -> %s", (_label, calls, expected) => {
    expect(shouldStage(calls as ProposedCall[])).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL, module not found**

```bash
npx vitest run src/app/chat-proposal.test.ts --reporter=dot > /tmp-scratch/t7.log 2>&1; echo "EXIT=$?"
grep -E "Tests |Cannot find" /tmp-scratch/t7.log
```

- [ ] **Step 3: Implement**

```ts
// src/app/chat-proposal.ts
//
// Pure and i18n-free. Decides whether a turn's tool calls apply immediately or
// stage for review, and owns the provisional-id dependency graph the review card
// uses to cascade a rejection.
//
// ★ Deliberately knows nothing about React, the workspace or the dispatcher.
//   Everything here is a function of the CALL LIST alone, which is what makes
//   the gate testable without a fixture workspace.

/** One tool call the model emitted. Structurally identical to the insights
 *  pipeline's `InsightToolCall`; kept as its own name because chat proposals are
 *  not insight recommendations and merging the two types would couple the
 *  register's persisted shape to the chat transcript's. */
export interface ProposedCall {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** Tools that remove data. Any one of these stages the whole turn, regardless of
 *  how many calls it made — a single `delete_all_tasks` is one call and is the
 *  most destructive thing the model can do. */
const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  "delete_task",
  "delete_all_tasks",
  "delete_raid_item",
  "delete_change",
  "delete_milestone",
  "delete_stakeholder",
  "delete_resource",
]);

/** Tools that write PROJECT ENTITY data.
 *
 *  ★ `set_language`, `set_filters` and `update_settings` are deliberately ABSENT.
 *   They change device-local preferences, not project data; none of them is in
 *   the undo stack either, so staging them would offer a review of something the
 *   rest of the app treats as ephemeral. If `update_settings` ever writes shared
 *   project state, it belongs in this set — check before assuming it does not. */
const ENTITY_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "create_task", "update_task", "set_task_dependencies",
  "create_raid_item", "update_raid_item",
  "create_change", "update_change",
  "create_milestone", "update_milestone",
  "create_stakeholder", "update_stakeholder",
  "create_resource", "update_resource",
  ...DESTRUCTIVE_TOOLS,
]);

export function isDestructiveTool(name: string): boolean {
  return DESTRUCTIVE_TOOLS.has(name);
}

export function isEntityWriteTool(name: string): boolean {
  return ENTITY_WRITE_TOOLS.has(name);
}

/** True when this turn must be reviewed before anything is written: it deletes
 *  something, or it writes more than one row. A single non-destructive write
 *  applies immediately and relies on undo. */
export function shouldStage(calls: readonly ProposedCall[]): boolean {
  let writes = 0;
  for (const c of calls) {
    if (isDestructiveTool(c.name)) return true;
    if (isEntityWriteTool(c.name)) writes += 1;
  }
  return writes > 1;
}
```

- [ ] **Step 4: Convert line endings, run, commit**

```bash
node -e "const f=process.argv[1],s=require('fs');s.writeFileSync(f,s.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" src/app/chat-proposal.ts
node -e "const f=process.argv[1],s=require('fs');s.writeFileSync(f,s.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" src/app/chat-proposal.test.ts
git ls-files --eol src/app/chat-proposal.ts src/app/chat-proposal.test.ts
npx vitest run src/app/chat-proposal.test.ts --reporter=dot > /tmp-scratch/t7b.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t7b.log
git commit --only src/app/chat-proposal.ts src/app/chat-proposal.test.ts -m "feat(ai): add the staging gate for destructive and multi-write turns"
```

- [ ] **Step 5: Mutation-prove the gate — both halves**

Run each mutant, confirm RED, then restore and confirm `git diff --stat` empty:

| Mutant | Must turn red |
|---|---|
| `writes > 1` → `writes >= 1` | "one create", "one update", "one update plus reads" |
| delete the `if (isDestructiveTool(...)) return true;` line | "one delete", "delete plus a read", "delete_all_tasks alone" |

If either mutant survives, the table is missing a discriminating row — add it before continuing. A
gate whose mutants survive is the exact false-green this repo keeps paying for.

---

### Task 8: Provisional-id dependencies and cascade

**Files:**
- Modify: `src/app/chat-proposal.ts`
- Test: `src/app/chat-proposal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { buildPlanRows, cascadeDeselect } from "./chat-proposal";

describe("provisional-id dependencies", () => {
  test("a call referencing an earlier create's minted id depends on it", () => {
    const rows = buildPlanRows(
      [
        { name: "create_task", input: {} },
        { name: "set_task_dependencies", input: { id: 101, dependencies: [] } },
        { name: "update_task", input: { id: 55 } },
      ],
      [101], // ids minted for the creates, in order
    );

    expect(rows[0].mintedId).toBe(101);
    expect(rows[1].dependsOn).toBe(0);   // references the create at index 0
    expect(rows[2].dependsOn).toBeUndefined(); // #55 is a pre-existing row
  });

  test("deselecting a create deselects everything that depends on it", () => {
    const rows = buildPlanRows(
      [
        { name: "create_task", input: {} },
        { name: "set_task_dependencies", input: { id: 101, dependencies: [] } },
        { name: "update_task", input: { id: 55 } },
      ],
      [101],
    );

    const next = cascadeDeselect(rows, new Set([0, 1, 2]), 0);
    expect(next.has(0)).toBe(false);
    expect(next.has(1)).toBe(false); // cascaded
    expect(next.has(2)).toBe(true);  // independent, untouched
  });

  test("cascade is transitive", () => {
    const rows = buildPlanRows(
      [
        { name: "create_task", input: {} },
        { name: "update_task", input: { id: 101 } },
        { name: "set_task_dependencies", input: { id: 101 } },
      ],
      [101],
    );
    const next = cascadeDeselect(rows, new Set([0, 1, 2]), 0);
    expect(next.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (exports missing)**

```bash
npx vitest run src/app/chat-proposal.test.ts --reporter=dot > /tmp-scratch/t8.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 3: Implement**

```ts
/** One row of a staged plan. `index` is its position in the emitted call list and
 *  is the row's stable identity — nothing here is keyed by array position after
 *  a filter, because a filtered index would shift under a deselect. */
export interface PlanRow {
  readonly index: number;
  readonly call: ProposedCall;
  /** Set on a staged create: the id minted for the row it will create. */
  readonly mintedId?: number;
  /** Index of the row whose `mintedId` this call's `id` refers to. */
  readonly dependsOn?: number;
}

/** Pair each call with its provisional id and its dependency.
 *  `mintedIds` supplies one id per CREATE call, in emission order. */
export function buildPlanRows(
  calls: readonly ProposedCall[],
  mintedIds: readonly number[],
): readonly PlanRow[] {
  const idToRow = new Map<number, number>();
  let mintCursor = 0;
  const rows: PlanRow[] = [];

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const isCreate = call.name.startsWith("create_");
    const mintedId = isCreate ? mintedIds[mintCursor++] : undefined;
    if (mintedId !== undefined) idToRow.set(mintedId, index);

    // A create cannot depend on its own id, so the lookup happens only for
    // non-creates. Ordering matters: `idToRow` is populated as we walk, so a
    // forward reference (a call naming an id minted LATER) resolves to
    // undefined rather than to the wrong row.
    const referenced = isCreate ? undefined : Number((call.input as { id?: unknown }).id);
    const dependsOn =
      referenced !== undefined && Number.isFinite(referenced)
        ? idToRow.get(referenced)
        : undefined;

    rows.push({ index, call, mintedId, dependsOn });
  }
  return rows;
}

/** Deselect `index` and, transitively, every row that depends on it. Pure —
 *  returns a new set and never mutates the one passed in. */
export function cascadeDeselect(
  rows: readonly PlanRow[],
  selected: ReadonlySet<number>,
  index: number,
): ReadonlySet<number> {
  const next = new Set(selected);
  const drop = [index];
  while (drop.length > 0) {
    const cur = drop.pop() as number;
    if (!next.delete(cur)) continue;
    for (const r of rows) if (r.dependsOn === cur) drop.push(r.index);
  }
  return next;
}
```

- [ ] **Step 4: Run, convert, commit**

```bash
npx vitest run src/app/chat-proposal.test.ts --reporter=dot > /tmp-scratch/t8b.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t8b.log
node -e "const f=process.argv[1],s=require('fs');s.writeFileSync(f,s.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" src/app/chat-proposal.ts
git commit --only src/app/chat-proposal.ts src/app/chat-proposal.test.ts -m "feat(ai): track provisional-id dependencies and cascade a rejection"
```

- [ ] **Step 5: Mutation-prove the cascade**

Change `if (!next.delete(cur)) continue;` to `next.delete(cur);` — the transitive test must still
pass (it is an optimisation, not a guard), so this mutant is EXPECTED to survive. Record it as an
equivalent mutant rather than as a test gap. Then delete the `for (const r of rows) …` push line —
the cascade and transitive tests MUST both go red. Restore and confirm `git diff --stat` is empty.

---

### Task 9: Add `resource` to the descriptor engine

**Files:**
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts`
- Modify: `src/app/inline-ai-edit/plan.ts`
- Test: `src/app/inline-ai-edit/plan.test.ts` (existing file — add cases)

- [ ] **Step 1: Read the existing descriptor shape before writing one**

```bash
sed -n '/export interface EntityDescriptor/,/^}/p' src/app/inline-ai-edit/entity-descriptor.ts
sed -n '/^export const INLINE_DESCRIPTORS/,/^};/p' src/app/inline-ai-edit/entity-descriptor.ts
```

The `stakeholder` descriptor is the closest model for `resource` (a directory row with a name and
enum-ish fields). Copy its SHAPE; do not copy its field lists without checking `Resource` in
`src/app/types.ts`.

- [ ] **Step 2: Write the failing tests**

```ts
test("describes a resource create", () => {
  const plan = describeEntityCalls(
    [{ type: "tool_use", name: "create_resource", input: { name: "M. Jordan" } }],
    { descriptor: INLINE_DESCRIPTORS.resource, item: someResource, ws },
  );
  expect(plan.creates).toHaveLength(1);
  expect(plan.creates[0].entity).toBe("resource");
});

test("describes a resource delete against a live row", () => {
  const plan = describeEntityCalls(
    [{ type: "tool_use", name: "delete_resource", input: { id: someResource.id } }],
    { descriptor: INLINE_DESCRIPTORS.resource, item: someResource, ws },
  );
  expect(plan.deletes).toHaveLength(1);
});

test("rejects a resource delete for an id that does not exist", () => {
  const plan = describeEntityCalls(
    [{ type: "tool_use", name: "delete_resource", input: { id: 999999 } }],
    { descriptor: INLINE_DESCRIPTORS.resource, item: someResource, ws },
  );
  expect(plan.rejected[0].reason).toBe("unknown-id");
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx vitest run src/app/inline-ai-edit/plan.test.ts --reporter=dot > /tmp-scratch/t9.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 4: Implement**

In `entity-descriptor.ts`, widen the union and add the descriptor:

```ts
export type InlineEntity = "task" | "raid" | "change" | "milestone" | "stakeholder" | "resource";
```

then a `resource:` entry in `INLINE_DESCRIPTORS` following the `stakeholder` shape, with
`wsKey: "resources"`, `updateTool: "update_resource"`, `deleteTool: "delete_resource"`, and
`diffFields`/`requiredNonEmpty`/`dateFields` read off the real `Resource` type.

In `plan.ts`:

```ts
const CREATE_TOOLS: Record<string, string> = {
  create_raid_item: "raid", create_change: "change",
  create_milestone: "milestone", create_stakeholder: "stakeholder", create_task: "task",
  create_resource: "resource",
};
```

```ts
  delete_resource: { entity: "resource", wsKey: "resources" },
```

★ Widening `InlineEntity` makes `INLINE_DESCRIPTORS` incomplete until the entry is added —
`Record<InlineEntity, EntityDescriptor>` is exhaustive, so tsc names the gap. Let it; that is the
type doing its job. Check whether `validSetFor` / `defaultEnumFor` / `forPreview` switch on
`InlineEntity` and need a branch too:

```bash
grep -n "InlineEntity" src/app/inline-ai-edit/*.ts
```

- [ ] **Step 5: Typecheck, run, commit**

```bash
npx tsc --noEmit > /tmp-scratch/t9b.log 2>&1; echo "EXIT=$?"; grep -c "error TS" /tmp-scratch/t9b.log
npx vitest run src/app/inline-ai-edit/ --reporter=dot > /tmp-scratch/t9c.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t9c.log
git commit --only src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts -m "feat(ai): describe resource creates, updates and deletes"
```

---

### Task 10: Ground a whole plan, one call at a time

**Files:**
- Create: `src/app/chat-proposal-describe.ts`
- Test: `src/app/chat-proposal-describe.test.ts`
- Modify: `src/app/insights/recommend-tokens.ts` (export `stampCall`)

- [ ] **Step 1: Export `stampCall`**

`src/app/insights/recommend-tokens.ts:69` reads `function stampCall(`. Change it to
`export function stampCall(`. Nothing else moves.

- [ ] **Step 2: Write the failing test — multi-row and multi-entity**

```ts
describe("describeProposal", () => {
  test("describes a plan spanning three different task rows", () => {
    // THE point of this test. describeEntityCalls is bound to ONE ctx.item and
    // rejects any update whose input.id differs as "unsupported" — so an
    // implementation that calls it ONCE for the whole plan describes row one and
    // rejects the other two. A single-row fixture cannot see that.
    const rows = describeProposal(
      [
        { name: "update_task", input: { id: 1, taskName: "A2" } },
        { name: "update_task", input: { id: 2, taskName: "B2" } },
        { name: "update_task", input: { id: 3, taskName: "C2" } },
      ],
      ws,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.plan.rejected.length === 0)).toBe(true);
    expect(rows.flatMap((r) => r.plan.updates)).toHaveLength(3);
  });

  test("describes a plan spanning two different entities", () => {
    const rows = describeProposal(
      [
        { name: "update_task", input: { id: 1, taskName: "A2" } },
        { name: "update_milestone", input: { id: 9, title: "M2" } },
      ],
      ws,
    );
    expect(rows[0].plan.updates).toHaveLength(1);
    expect(rows[1].plan.updates).toHaveLength(1);
  });

  test("stamps a concurrency token on each update", () => {
    const rows = describeProposal([{ name: "update_task", input: { id: 1, taskName: "A2" } }], ws);
    expect(rows[0].stamped.input).toHaveProperty("expectedToken");
  });
});
```

- [ ] **Step 3: Implement**

```ts
// src/app/chat-proposal-describe.ts
//
// Grounds a staged chat plan against the LIVE workspace.
//
// ★★★ ONE CALL AT A TIME, and that is structural rather than stylistic.
//  `describeEntityCalls` is bound to a single `ctx.item` and rejects any update
//  whose `input.id` differs as "unsupported". A chat plan spans many rows, so it
//  must be grounded per call by its OWN id — exactly what
//  `insights/recommend-plan.ts` does, and for exactly the same reason.
import type { Workspace } from "./workspace";
import { describeEntityCalls, type EditPlan } from "./inline-ai-edit/plan";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./inline-ai-edit/entity-descriptor";
import { stampCall } from "./insights/recommend-tokens";
import type { ProposedCall } from "./chat-proposal";

/** Tool name -> the entity whose descriptor grounds it. Covers create, update
 *  and delete for all six inline entities. */
const TOOL_ENTITY: Record<string, InlineEntity> = {
  create_task: "task", update_task: "task", delete_task: "task",
  create_raid_item: "raid", update_raid_item: "raid", delete_raid_item: "raid",
  create_change: "change", update_change: "change", delete_change: "change",
  create_milestone: "milestone", update_milestone: "milestone", delete_milestone: "milestone",
  create_stakeholder: "stakeholder", update_stakeholder: "stakeholder", delete_stakeholder: "stakeholder",
  create_resource: "resource", update_resource: "resource", delete_resource: "resource",
};

export interface DescribedRow {
  readonly call: ProposedCall;
  /** The same call with `expectedToken` stamped from the live row, ready to replay. */
  readonly stamped: ProposedCall;
  readonly plan: EditPlan;
}

export function describeProposal(
  calls: readonly ProposedCall[],
  ws: Workspace,
): readonly DescribedRow[] {
  return calls.map((call) => {
    const entity = TOOL_ENTITY[call.name];
    if (!entity) {
      // A write with no descriptor still has to appear in the card — a row the
      // user cannot see is a row they cannot reject.
      return {
        call,
        stamped: call,
        plan: { updates: [], creates: [], deletes: [], rejected: [{ toolName: call.name, reason: "unsupported", detail: call.name }] },
      };
    }
    const descriptor = INLINE_DESCRIPTORS[entity];
    const rows = ws[descriptor.wsKey] as ReadonlyArray<{ id: number }>;
    const id = Number((call.input as { id?: unknown }).id);
    // For a create there is no target row; `describeEntityCalls` only consults
    // `item` on the update path, so a sentinel is safe and keeps one code path.
    const item = rows.find((r) => r.id === id) ?? { id: Number.NaN };
    return {
      call,
      stamped: stampCall(call, ws),
      plan: describeEntityCalls([{ type: "tool_use", name: call.name, input: call.input }], {
        descriptor,
        item: item as { id: number; [k: string]: unknown },
        ws,
      }),
    };
  });
}
```

★ Verify the sentinel claim before trusting it: read the update branch of `describeEntityCalls` and
confirm `item` is consulted only after `id === item.id` passes. If a create ever reaches `item[f]`,
replace the sentinel with an early return for creates.

- [ ] **Step 4: Run, convert, commit**

```bash
npx vitest run src/app/chat-proposal-describe.test.ts --reporter=dot > /tmp-scratch/t10.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t10.log
node -e "const f=process.argv[1],s=require('fs');s.writeFileSync(f,s.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" src/app/chat-proposal-describe.ts
git commit --only src/app/chat-proposal-describe.ts src/app/chat-proposal-describe.test.ts src/app/insights/recommend-tokens.ts -m "feat(ai): ground a staged chat plan per call against the live workspace"
```

- [ ] **Step 5: Mutation-prove the per-call grounding**

Change the implementation to call `describeEntityCalls` ONCE with all blocks and the first row's
`item`. The three-row test MUST go red with two `"unsupported"` rejections. This mutant is the whole
reason the test exists — if it survives, the fixture rows share an id. Restore afterwards.

---

### Task 11: The review card

**Files:**
- Create: `src/app/chat-proposal-block.tsx`
- Test: `src/app/chat-proposal-block.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the i18n keys — EN first**

Add to `src/app/i18n.ts`:

```ts
  chatProposalTitle: "Proposed changes",
  chatProposalCount: "{0} writes",
  chatProposalApply: "Apply",
  chatProposalDiscard: "Discard",
  chatProposalSelected: "{0} selected",
  chatProposalShowMore: "Show all",
  chatProposalRowToggle: "Include",
  chatProposalCascaded: "Needs a change you rejected",
  chatProposalFailed: "Not applied — changed since you reviewed",
```

- [ ] **Step 2: Add the DE keys via a node script — NEVER the Edit tool**

```js
// scratch/i18n-de-proposal.mjs
import { readFileSync, writeFileSync } from "node:fs";
const P = "src/app/i18n.de.ts";
const before = readFileSync(P, "utf8");
// CRLF anchor — a \n anchor is a guaranteed silent no-op in this file.
const FROM = "  updateTask: \"Aufgabe aktualisieren\",\r\n";
const TO = FROM
  + "  chatProposalTitle: \"Vorgeschlagene Änderungen\",\r\n"
  + "  chatProposalCount: \"{0} Schreibvorgänge\",\r\n"
  + "  chatProposalApply: \"Anwenden\",\r\n"
  + "  chatProposalDiscard: \"Verwerfen\",\r\n"
  + "  chatProposalSelected: \"{0} ausgewählt\",\r\n"
  + "  chatProposalShowMore: \"Alle anzeigen\",\r\n"
  + "  chatProposalRowToggle: \"Einbeziehen\",\r\n"
  + "  chatProposalCascaded: \"Benötigt eine abgelehnte Änderung\",\r\n"
  + "  chatProposalFailed: \"Nicht angewendet — seit der Prüfung geändert\",\r\n";
const n = before.split(FROM).length - 1;
if (n !== 1) { console.error(`ANCHOR MISS (${n})`); process.exit(1); }
writeFileSync(P, before.replace(FROM, TO), "utf8");
console.log("ok");
```

★ Write this file with the `Write` tool (it is a scratch script, not `src/app`), run it with
`node`, then verify the umlauts survived as real characters:

```bash
node scratch/i18n-de-proposal.mjs
grep -c "Änderungen" src/app/i18n.de.ts    # expect >= 1, real umlaut not Ä
npx tsc --noEmit > /tmp-scratch/t11.log 2>&1; echo "EXIT=$?"; grep -c "error TS" /tmp-scratch/t11.log
```

tsc enforces EN/DE key parity, so a missed key fails here rather than at runtime. The
`i18n-encoding` test bans ASCII substitutions (`Aenderungen`) — real umlauts only.

- [ ] **Step 3: Write the failing a11y test — this is the one that matters**

```tsx
// src/app/chat-proposal-block.test.tsx
import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { ChatProposalBlock } from "./chat-proposal-block";
import { expectRowUniqueNames } from "./test/row-unique-names";

describe("ChatProposalBlock", () => {
  test("gives every row control a row-unique accessible name", () => {
    // Two rows whose entity titles COLLIDE — that collision is the point.
    // The axe gate cannot see duplicate accessible names in any view, and this
    // card only exists after a model turn so no e2e run will ever render it.
    // This unit test is the ONLY possible coverage, at any gate configuration.
    const { container } = render(
      <ChatProposalBlock
        rows={[
          { index: 0, title: "Review budget", verb: "update", entity: "task" },
          { index: 1, title: "Review budget", verb: "update", entity: "task" },
        ]}
        selected={new Set([0, 1])}
        onToggle={vi.fn()}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
        lang="en-US"
      />,
    );

    expectRowUniqueNames(container, {
      roles: ["checkbox"],
      minControls: 2,
      requireCollisionSeed: true,
    });
  });
});
```

★ Read `src/app/test/row-unique-names.ts` before writing this — the exact option names and
`expectRowUniqueNames`'s signature come from that file, not from this plan. `requireCollisionSeed:
true` is mandatory here: without it the assertion passes against a one-row fixture, which is the
documented vacuity trap. `minControls` must be the MEASURED control count for this scope, not a
round number.

- [ ] **Step 4: Implement the component**

Build the names with `buildRowTokens`/`rowLabel` from `src/app/row-tokens.ts` — a name unique in the
list is used bare, colliding rows get a 1-based occurrence index, and ALL colliding rows are
numbered including the first. Do not hand-roll the numbering, and do not use the row id (uuids read
as character-salad aloud) or a whole-list ordinal (it shifts under filtering).

Requirements the tests pin:
- one checkbox per row, name from the token
- a row whose `dependsOn` was deselected renders `chatProposalCascaded` and is not selectable
- a row that failed at apply renders `chatProposalFailed`
- Discard and Apply are real `<button>`s; Apply's label carries the selected count

- [ ] **Step 5: Run, convert, commit**

```bash
npx vitest run src/app/chat-proposal-block.test.tsx --reporter=dot > /tmp-scratch/t11b.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t11b.log
node -e "const f=process.argv[1],s=require('fs');s.writeFileSync(f,s.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" src/app/chat-proposal-block.tsx
git commit --only src/app/chat-proposal-block.tsx src/app/chat-proposal-block.test.tsx src/app/i18n.ts src/app/i18n.de.ts -m "feat(ai): add the staged-proposal review card"
```

- [ ] **Step 6: Prove the a11y test is not vacuous**

Replace the row token with a bare `t(lang, "chatProposalRowToggle")` for every row. The
row-unique-name test MUST go red. If it stays green, `requireCollisionSeed` is not set or the
fixture titles do not actually collide. Restore afterwards and confirm `git diff --stat` is empty.

---

### Task 12: Stage, apply, and undo as one entry

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts`
- Modify: `src/app/chat-panel.tsx`
- Test: `src/app/chat-proposal-apply.test.tsx` (create)

- [ ] **Step 1: Write the failing round-trip test**

```tsx
test("applying a two-entity plan pushes exactly ONE undo entry", () => {
  // TWO entities is load-bearing. A single-entity plan passes against a wrong
  // implementation that calls `capture` once per array; only a plan spanning a
  // task AND a milestone can tell `captureComposite` from N x `capture`.
  // Apply a selected plan of { update_task #1, update_milestone #9 } and assert
  // the undo stack depth grew by exactly 1, and that undoing it restores BOTH.
});

test("a row whose token went stale fails alone", () => {
  // Stage a plan of two updates, mutate row #1 in the workspace so its token no
  // longer matches, then apply. Expect: row #1 reported failed, row #2 applied.
});
```

- [ ] **Step 2: Implement the apply path**

Replay each SELECTED row's `stamped` call through `runTool(dispatcher, name, input)`, collecting
per-row outcomes. Accumulate before-images per entity array as you go, then push ONE
`captureComposite({ kind: "bulk.edit", primaryCount: <applied row count>, parts: [...], entityKey })`.

★ `entityKey` is REQUIRED here. `bulk.edit` is entity-ambiguous: `buildUndoLabel` resolves the
entity from the kind's prefix, `"bulk"` is not in `ENTITY_KEY_SET`, and without it the label
degrades to a generic "Edited N items".

★ Do NOT use `pushUndoMany` — it appends N entries and is used only for redo-stack inverses.

- [ ] **Step 3: Render the card in the transcript**

In `chat-panel.tsx`, render `ChatProposalBlock` for an assistant message carrying a pending plan,
beside the existing `ToolBlock` (`chat-tool-block.tsx:445`). Message order, not a modal —
`chat-panel.tsx` mounts no modal today and `Modal` stacks in this app.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/app/chat-proposal-apply.test.tsx src/app/chat-panel.test.tsx --reporter=dot > /tmp-scratch/t12.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t12.log
git commit --only src/app/use-chat-dispatcher.ts src/app/chat-panel.tsx src/app/chat-proposal-apply.test.tsx -m "feat(ai): apply a reviewed plan as a single undoable commit"
```

---

### Task 13: Replace the unenforced prose

**Files:**
- Modify: `src/app/chat-tool-defs.ts`
- Modify: `src/app/chat-api.ts`

- [ ] **Step 1: Confirm the prose sites still sit where the spec says**

```bash
grep -n "Confirm with the user\|confirm with the user" src/app/chat-tool-defs.ts
```

Expected: 7 lines (`:297` `delete_task`, `:307` `delete_all_tasks`, `:615` `delete_resource`,
`:643` `delete_raid_item`, `:671` `delete_change`, `:698` `delete_milestone`, `:726`
`delete_stakeholder`). If the line numbers moved, use the names — an insertion above shifts every
number below it.

- [ ] **Step 2: Remove the clauses, keeping the rest of each description**

`"Delete a single task by ID. Confirm with the user before calling this if they were not explicit."`
becomes `"Delete a single task by ID."`. The instruction is now enforced by the gate, and leaving
prose that describes a mechanism the code no longer relies on is how a false claim outlives its code.

- [ ] **Step 3: Add the staged-result paragraph to the system prompt**

In `chat-api.ts`, state that a result carrying `staged: true` means the write has NOT been applied,
that the id it carries is real and safe to reference in later calls in the same turn, that reads
return committed state and will not reflect staged writes, and that a staged call must not be
re-issued.

- [ ] **Step 4: Update the prompt test**

`src/app/chat-api.system-prompt.test.ts` pins the prompt. Add an assertion for the staged paragraph
rather than only widening a snapshot.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run src/app/chat-api.system-prompt.test.ts src/app/chat-tools.test.ts --reporter=dot > /tmp-scratch/t13.log 2>&1; echo "EXIT=$?"
grep -E "Tests " /tmp-scratch/t13.log
git commit --only src/app/chat-tool-defs.ts src/app/chat-api.ts src/app/chat-api.system-prompt.test.ts -m "feat(ai): replace unenforced confirm prose with the staging gate"
```

---

### Task 14: Gates

- [ ] **Step 1: Check with the peer session before any full vitest run**

Two concurrent vitest processes on this machine is the contention condition that produces false reds
for both sessions. `aipm-cockpit-01` is running sharded suites on `feat/timelog-guardrails`.

- [ ] **Step 2: Run the gates, each unpiped**

```bash
npx tsc --noEmit > /tmp-scratch/g-tsc.log 2>&1; echo "EXIT=$?"; grep -c "error TS" /tmp-scratch/g-tsc.log
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npm run size:check > /tmp-scratch/g-size.log 2>&1; echo "EXIT=$?"
npm run dup:check > /tmp-scratch/g-dup.log 2>&1; echo "EXIT=$?"
npm run docs:symbols:check > /tmp-scratch/g-sym.log 2>&1; echo "EXIT=$?"
npm run docs:claims:check > /tmp-scratch/g-claims.log 2>&1; echo "EXIT=$?"
npm run version:check > /tmp-scratch/g-ver.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 3: Run the unit suite in 4 shards**

A backgrounded full run is killed by the **harness's** own threshold on background tasks, and a
foreground one is backgrounded at the 600s tool timeout and killed the same way. ★ That threshold is
NOT the machine running out of memory — measured on this machine with 10.5 GB of 31.7 GB still free
when it fired. So a kill notification is not evidence your suite got heavy, and sharding is a
workaround for the harness rather than for the tests. Do not go looking for a memory leak in your
own code on the strength of one.

```bash
for i in 1 2 3 4; do
  npx vitest run --shard=$i/4 --reporter=dot > /tmp-scratch/g-unit-$i.log 2>&1
  echo "SHARD $i EXIT=$?"
done
grep -hE "Test Files|Tests " /tmp-scratch/g-unit-*.log
```

All four must exit 0.

- [ ] **Step 3b: Prove the shards actually split**

`--shard=i/4` splits by FILE. Sum the four shards' file counts and compare against the repo's real
test-file count — a shard flag that silently ran everything four times looks identical from any
single shard's output, and would report four green runs of the whole suite as a clean split.

```bash
grep -hoE "Test Files +[0-9]+ passed \(([0-9]+)\)" /tmp-scratch/g-unit-*.log
find src scripts e2e -name "*.test.*" -o -name "*.spec.*" | grep -v node_modules | wc -l
```

The four per-shard totals must SUM to the `find` count, not each equal it.

Then repeat the whole loop with `--sequence.shuffle --sequence.seed=1`, which is CI's pinned seed
and the only local reproduction of the `unit-tests-shuffled` gate.

- [ ] **Step 4: Run the axe gate for the AI Assistant view**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "AI Assistant" --workers=1
```

`--workers=1` is mandatory whenever more than one view matches — CI runs axe serially and local runs
at CPU count, so an over-subscribed local run dies on `Test timeout of 60000ms exceeded` inside
`page.evaluate`, which prints as a failure with no violation text. A failure naming no rule id and
no impact is contention, not a violation.

★ A green axe run here says **nothing** about the review card: the seed is file mode and the card
only appears after a model turn. The unit tests in Task 11 are the only coverage.

- [ ] **Step 5: Record the eye-verify as owed**

Nothing in the suite drives a real model turn through the real UI. Before release, stage a real
multi-write turn against `PORT=3100 npm run dev`, reject one row, apply, and undo. Add it to the MR
description as an unchecked box.

---

## Self-Review

**Spec coverage.** Gate → Task 7. Provisional ids and cascade → Task 8. Per-call grounding → Task
10. Token stamping → Task 10. `resource` descriptor → Task 9. Undo capture → Tasks 1-6. One entry
per plan → Task 12. Per-row stale failure → Task 12. Card and a11y → Task 11. Prompt and prose →
Task 13. Read-only popout: covered by the existing `popoutReadOnly` throw, which every write site
already runs before the capture added in Tasks 3-5 — **no task needed, and no task claims one.**

**Known gap, stated rather than hidden.** The spec's lifetime rule ("a pending plan lives on the
assistant message and persists with the thread") is implemented implicitly in Task 12 Step 3 but has
no test of its own. Add one when wiring `chat-panel.tsx` if the message shape makes it cheap;
otherwise file it rather than claiming coverage.

**Placeholder scan.** Tasks 5, 6, 11 and 12 contain test bodies written as instructions rather than
finished code. That is deliberate in each case and flagged inline — they depend on fixture shapes
(`ChatDispatcherArgs`, `row-unique-names`'s signature, the workspace fixture) that must be read from
the tree rather than guessed here. Every one names exactly what to read first. No task says "add
appropriate error handling" or "write tests for the above".

**Type consistency.** `ProposedCall` is defined in Task 7 and used in Tasks 8, 10, 12. `PlanRow`
(`index`/`call`/`mintedId`/`dependsOn`) is defined in Task 8 and consumed by `cascadeDeselect` in
the same task and the card in Task 11. `DescribedRow` (`call`/`stamped`/`plan`) is defined in Task
10 and consumed in Task 12. `captureComposite` / `capturePart` signatures match
`src/app/undo/use-undo-stack.ts` as read on 2026-09-04.
