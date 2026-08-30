# Destructive-Save Arming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every removal route for a slice that counts toward the save-time data-loss guards arms the one-shot `allowDestructiveSave` bypass, so a deliberate deletion is not refused by the guard the counting armed.

**Architecture:** Seventeen handlers each gain ONE line at a site that already exists — every one of them already computes a change signal for activity logging. No shared helper, no new abstraction. A new `destructive-save-arming.test.ts` holds the registry and a completeness check driven from the IMPORTED `TOOL_DEFS`; per-route behavioural blocks live in each hook's existing test file, mirroring the `delete_document` arming suite already in `use-chat-dispatcher.test.tsx`.

**Tech Stack:** TypeScript, React 19, vitest, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-29-destructive-save-arming-design.md`

**Branch:** `fix/destructive-save-arming`, at `dd4f46f1`, off `main` at `3961777b` (0.263.2 "Okorafor").

---

## Standing constraints — read before Task 1

These are not advice. Each has cost a build or a false report in this repo.

1. **Every `src/app/*.ts(x)` is CRLF.** Never use the Write tool on one — it re-lines the file to LF invisibly to `git diff`. Use Edit. A node patch anchor must match `\r\n`, never `\n`.
2. **`docs/open-followups.md` and `CHANGELOG.md` are LF.** Do not "fix" their endings.
3. **Never read a gate's exit code through a pipe.** `npm run test:run | tail` reports `tail`'s status. Redirect, check unpiped, then read the file:
   ```bash
   npm run test:run > "$SCRATCH/suite.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/suite.log"
   ```
4. **Logs go in the session scratchpad, never `/tmp`** — `/tmp` is shared across sessions and a peer's log has overwritten one before.
5. **Never run two vitest processes at once.** A vitest red carrying `Failed to start forks worker` is machine contention, not a test failure — retry, do not debug.
6. **`npx tsc --noEmit` exits 2 on diagnostics, not 1.**
7. **`npm run lint` exits 1 from gitignored leftovers** (`.worktrees/`, `.demo-tmp/`) — use `npx eslint src` while iterating. `--max-warnings=0`, so `react-hooks/exhaustive-deps` is FATAL. This matters directly: see the three dep idioms below.
8. **`git checkout -- <file>` is DENY-BLOCKED.** Revert a mutation with an inverse anchored Edit, then prove `git diff --stat` is empty.
9. **Do not `--amend`.** Shared worktree; use new commits and `git commit --only <paths>`.
10. **Push, MR and merge are Task 13 ONLY, and Task 13 is gated on the user saying "release".**

Set the scratchpad once per session:
```bash
SCRATCH="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad"
```

---

## The three dep-access idioms — pick by the `useCallback` deps array

This is the single most important thing to get right, and it is decided per file, not per preference. `react-hooks/exhaustive-deps` is fatal, so reaching a value the callback does not depend on is a build failure, and reaching a stale one silently is worse.

| Idiom | When | Form |
|---|---|---|
| **A — `args.`** | The handler's `useCallback` deps array ALREADY contains `args` | `args.allowDestructiveSave?.()` |
| **B — ref** | The deps array does NOT contain `args`, and the file already mirrors other callbacks through refs (`captureRef`, `logActivityRef`) | add `allowDestructiveRef` beside them; call `allowDestructiveRef.current?.()` |
| **C — plain** | Not inside a `useCallback` at all (a plain function in a component body) | `allowDestructiveSave?.()` from props |

Assignment, already determined by reading each file:

| File | Handlers | Idiom |
|---|---|---|
| `use-chat-dispatcher.ts` | `deleteTask`, `deleteAllTasks`, `deleteResource` | A (`args.`, inside the `useMemo` dispatcher) |
| `use-register-tools.ts` | `deleteRaid`, `deleteChange`, `deleteMilestone`, `deleteStakeholder` | A (destructured from `deps`) |
| `use-resource-planner.ts` | `handleDeleteRaidItem`, `handleDeleteAbsence`, `handleDeleteShift` | **B** — deps are `[raid, setRaid]` etc., no `args` |
| `use-resource-directory.ts` | `handleDeleteResource`, `handleBulkDeleteResources` | **B** — mirrors `captureCompositeRef` |
| `use-reference-data.ts` | `handleDeleteRole` | **B** — mirrors `captureCompositeRef` |
| `use-stakeholders.ts` | `handleDeleteStakeholder` | A — deps are `[stakeholders, setStakeholders, args]` |
| `use-change-log.ts` | `handleDeleteChange` | A — deps are `[changes, setChanges, args]` |
| `use-calendar-events.ts` | `handleDeleteCalendarEvent` | A — deps include `args` |
| `milestones-panel.tsx` | `del` | C — plain function in the component body |

**Verify the idiom by reading the deps array before editing, every time.** If a deps array has changed since this plan was written, the idiom changes with it.

---

## Ownership tree — who supplies the dep

`task-manager.tsx` already holds `allowDestructiveSave` (it passes it to `useChatDispatcher` today).

```
task-manager.tsx
├── useChatDispatcher      ← already receives it
│   ├── useDocumentTools   ← already receives it
│   └── useRegisterTools   ← Task 3 adds it here
├── useResourcePlanner     ← Task 4 adds it here
│   ├── useResourceDirectory   ← Task 5, relayed BY the planner
│   ├── useReferenceData       ← Task 6, relayed BY the planner
│   └── useCalendarEvents      ← Task 9, relayed BY the planner
├── useStakeholders        ← Task 7
└── useChangeLog           ← Task 8
workspace-section.tsx      ← already holds it; Task 10 forwards to MilestonesPanel
```

★ `use-resource-planner.ts` is a RELAY for three sub-hooks. Task 4 adds the dep to the planner; Tasks 5, 6 and 9 forward it onward from inside the planner. Doing 5/6/9 before 4 will not compile.

---

## File structure

**Create:**
- `src/app/destructive-save-arming.test.ts` — the registry, the completeness check over the imported `TOOL_DEFS`, the anti-vacuity assertion, and the guard-level block tying arming to the verdict.

**Modify (source):** `use-chat-dispatcher.ts`, `use-register-tools.ts`, `use-resource-planner.ts`, `use-resource-directory.ts`, `use-reference-data.ts`, `use-stakeholders.ts`, `use-change-log.ts`, `use-calendar-events.ts`, `milestones-panel.tsx`, `workspace-section.tsx`, `task-manager.tsx`.

**Modify (tests):** `use-chat-dispatcher.test.tsx`, `use-resource-planner.test.tsx`, `use-stakeholders.test.tsx`, `use-change-log.test.tsx`, `use-calendar-events.test.tsx`, `milestones-panel.test.tsx`.

**No new test file per hook.** `use-register-tools`, `use-resource-directory` and `use-reference-data` have none, and get none — each is constructed by a hook that DOES have a test file, and is reached through its owner's returned API.

---

## The arming suite template

Every behavioural task below writes the SAME five blocks, adapted to its route. The template is the existing `describe("useChatDispatcher — delete_document arms the destructive-save bypass")` in `use-chat-dispatcher.test.tsx` — read it before writing the first one.

1. **arms once per removal, and not before** — plus a positive observable proving the delete really ran, so arming is not being counted on a no-op path.
2. **does NOT arm when nothing was removed** — plus a positive control at the end proving the id that DOES exist arms. This is the block the unconditional-arming mutant must kill.
3. **does NOT arm for a refusal** (read-only, where the route has one).
4. **does not throw when no bypass is supplied** — the prop is optional at every one of these sites.
5. **the call site hands it over** — a source scan, because every behavioural block supplies the prop itself and is therefore blind to the prop being dropped at the construction site.

★★ Blocks 1 and 2 MUST stay separate `it()` blocks. Vitest aborts a test at its first hard assertion, so folding them together would leave the leak assertion unexecuted under the delete-the-arming mutant — proved by nothing while the revert reports green. Block 2 combining a negative with a trailing positive CONTROL is correct and is what the template does: the mutant is killed by the first assertion, and the control only proves the fixture is not vacuous.

---

### Task 1: The gate — registry, completeness, anti-vacuity

**Files:**
- Create: `src/app/destructive-save-arming.test.ts`

- [ ] **Step 1: Confirm the composition trap is still real**

```bash
grep -cE 'name: "(delete|clear)_' src/app/chat-tool-defs.ts     # 7 — source literals in THIS file only
grep -c delete_document src/app/chat-tool-defs.ts                # 0 — it is NOT declared here
grep -n DOCUMENT_TOOL_DEFS src/app/chat-tool-defs.ts             # the import and the spread
```

Expected: `7`, then `0`, then two lines (an import and a `...DOCUMENT_TOOL_DEFS,` spread). This is why the test must IMPORT the array rather than scan the file: a source scan misses `delete_document`, which is the exact route whose missing arming was §285's third instance.

- [ ] **Step 2: Write the gate**

Create `src/app/destructive-save-arming.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "./chat-tool-defs";
import { evaluateSaveGuard } from "./save-guard";

/**
 * The SECOND save-guard invariant (docs/open-followups.md §285).
 *
 * `workspace-slice-policy.test.ts` gates WHICH slices count toward the
 * save-time data-loss guards. This file gates the dependent invariant it does
 * not touch: every removal route for a counted slice must arm the one-shot
 * `allowDestructiveSave` bypass, so a user's own deliberate deletion is not
 * refused by the guard the counting armed.
 *
 * ★★★ SCOPE, AND ITS BOUND — read this before trusting a green run.
 * The completeness check below is COMPLETE for the AI surface and NOT
 * complete for the UI surface, because completeness needs a declaration to
 * enumerate from and only the AI surface has one (`TOOL_DEFS`). There is no
 * declaration of "routes that remove records"; a source scan for a setter
 * called with a `filter` cannot tell a delete from an edit. So an eighteenth
 * UI delete handler added tomorrow fails NOTHING here. That asymmetry is
 * filed, not fixed — see the register entry this file's commit names.
 *
 * ★★ The behavioural proof for each route lives in that route's own test
 * file, next to the harness that can render it. This file holds the
 * enumeration and the guard-level tie only.
 */

/** Every AI tool that removes records, and where its arming is proved. */
const ARMED_AI_ROUTES: Record<string, string> = {
  delete_task: "use-chat-dispatcher.test.tsx",
  delete_all_tasks: "use-chat-dispatcher.test.tsx",
  delete_resource: "use-chat-dispatcher.test.tsx",
  delete_raid_item: "use-chat-dispatcher.test.tsx",
  delete_change: "use-chat-dispatcher.test.tsx",
  delete_milestone: "use-chat-dispatcher.test.tsx",
  delete_stakeholder: "use-chat-dispatcher.test.tsx",
  delete_document: "use-chat-dispatcher.test.tsx",
};

function removalToolNames(): string[] {
  return TOOL_DEFS
    .map((d) => (d as { name?: unknown }).name)
    .filter((n): n is string => typeof n === "string")
    .filter((n) => n.startsWith("delete_") || n.startsWith("clear_"));
}

describe("destructive-save arming — the counted-slice removal invariant", () => {
  it("enumerates a non-empty tool set (anti-vacuity)", () => {
    // A check that reads zero tools passes everything. `TOOL_DEFS` is
    // COMPOSED — it spreads DOCUMENT_TOOL_DEFS — so a future refactor that
    // breaks the spread would empty this list silently.
    const names = removalToolNames();
    expect(names.length, "no delete_/clear_ tools found — the enumeration is broken, not clean").toBeGreaterThan(0);
    expect(names.length).toBeGreaterThanOrEqual(Object.keys(ARMED_AI_ROUTES).length);
  });

  it("reaches delete_document, which is declared in a SPREAD module", () => {
    // The regression guard for the composition trap: a source scan of
    // chat-tool-defs.ts finds 7 and misses this one.
    expect(removalToolNames()).toContain("delete_document");
  });

  it("has a recorded arming decision for every AI removal tool", () => {
    const undecided = removalToolNames().filter((n) => !(n in ARMED_AI_ROUTES));
    expect(
      undecided,
      `New AI removal tool(s) with no arming decision: ${undecided.join(", ")}. ` +
        "Arm the handler where it already reports it changed something, add a behavioural " +
        "suite in that route's test file, and record it in ARMED_AI_ROUTES.",
    ).toEqual([]);
  });

  it("arming is what the guard actually consults", () => {
    // Ties every `allowDestructiveSave` spy assertion elsewhere to an outcome.
    // Without this block they prove only that a callback fired.
    const wipe = { prevCollections: 3, prevRecords: 40, curCollections: 0, curRecords: 0 };
    expect(evaluateSaveGuard({ ...wipe, allowDestructive: false }).refuse).toBe(true);
    expect(evaluateSaveGuard({ ...wipe, allowDestructive: true }).refuse).toBe(false);
  });
});
```

- [ ] **Step 3: Run it — it must be GREEN**

```bash
npx vitest run src/app/destructive-save-arming.test.ts --reporter=dot > "$SCRATCH/t1.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t1.log"
```

Expected: EXIT=0, 4 passed. This task is scaffolding, not the red step — the RED steps are the behavioural blocks in Tasks 2 onward. If `has a recorded arming decision` fails here, a delete tool exists that this plan's census missed: stop and add it to the census rather than to the registry.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: EXIT=0 (it exits **2** on diagnostics, not 1).

- [ ] **Step 5: Commit**

```bash
git add src/app/destructive-save-arming.test.ts
git commit --only src/app/destructive-save-arming.test.ts -m "test(storage): enumerate the AI removal routes that must arm the save bypass"
```

---

### Task 2: Arm the three chat-dispatcher handlers

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts` (`deleteTask`, `deleteAllTasks`, `deleteResource`)
- Test: `src/app/use-chat-dispatcher.test.tsx`

No plumbing: `ChatDispatcherArgs` already declares `allowDestructiveSave?: () => void` and `renderDispatcher` already accepts a spy as its 6th parameter.

- [ ] **Step 1: Confirm the routes are unarmed**

```bash
sed -n '/deleteAllTasks: () => {/,/^      },/p' src/app/use-chat-dispatcher.ts | wc -l                        # control: 18, non-zero
sed -n '/deleteAllTasks: () => {/,/^      },/p' src/app/use-chat-dispatcher.ts | grep -c allowDestructiveSave  # 0
```
The control line is not optional: a `sed` range address fails OPEN, so a moved anchor degrades the second command to a guaranteed 0 with no diagnostic.

- [ ] **Step 2: Write the failing suite**

Append to `src/app/use-chat-dispatcher.test.tsx`, after the existing `delete_document` arming describe:

```tsx
describe("useChatDispatcher — the register delete tools arm the destructive-save bypass", () => {
  function renderWithBypass(isReadOnly = false) {
    const allowDestructiveSave = vi.fn();
    const { result } = renderDispatcher(
      seedTasks(), isReadOnly, "open-points", undefined, undefined, allowDestructiveSave,
    );
    return { result, allowDestructiveSave };
  }

  it("deleteTask arms once for a task that exists", () => {
    const { result, allowDestructiveSave } = renderWithBypass();
    const victim = result.current.listTasks()[0]!;
    act(() => { result.current.deleteTask(victim.id); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
    // Positive observable: the delete really ran.
    expect(result.current.listTasks().some((t) => t.id === victim.id)).toBe(false);
  });

  it("deleteTask does NOT arm for an id that does not exist", () => {
    const { result, allowDestructiveSave } = renderWithBypass();
    const before = result.current.listTasks().length;
    act(() => { result.current.deleteTask(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    expect(result.current.listTasks()).toHaveLength(before);
    // POSITIVE CONTROL: the id that DOES exist arms, so the fixture is not vacuous.
    act(() => { result.current.deleteTask(result.current.listTasks()[0]!.id); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("deleteAllTasks arms once when it emptied a non-empty register", () => {
    const { result, allowDestructiveSave } = renderWithBypass();
    act(() => { result.current.deleteAllTasks(); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
    expect(result.current.listTasks()).toEqual([]);
  });

  it("deleteAllTasks does NOT arm when the register was already empty", () => {
    const { result, allowDestructiveSave } = renderWithBypass();
    act(() => { result.current.deleteAllTasks(); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
    // A second clear removes nothing: arming again would leave a one-shot up
    // with no save to spend it.
    act(() => { result.current.deleteAllTasks(); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("deleteResource arms only when a resource was removed", () => {
    const { result, allowDestructiveSave } = renderWithBypass();
    act(() => { result.current.deleteResource(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });

  it("does not throw when no bypass is supplied", () => {
    const { result } = renderDispatcher();
    expect(() => {
      act(() => { result.current.deleteAllTasks(); });
    }).not.toThrow();
  });

  it("does NOT arm for a delete refused in a read-only popout", () => {
    const { result, allowDestructiveSave } = renderWithBypass(true);
    expect(() => result.current.deleteAllTasks()).toThrow();
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it — it must be RED**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx -t "register delete tools arm" --reporter=dot > "$SCRATCH/t2.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t2.log"
```
Expected: EXIT=1, with the arms-once blocks failing on `expected "spy" to be called 1 times, but got 0 times`. The does-NOT-arm blocks pass already (nothing arms at all yet) — that is correct and expected; they are guarding the fix, not the defect.

- [ ] **Step 4: Arm `deleteTask`**

In `src/app/use-chat-dispatcher.ts`, in `deleteTask`, immediately AFTER the `args.logActivityAs?.("ai", "task.deleted", …)` line and BEFORE `return true;`:

```ts
        // ★★ Arm the one-shot destructive-save bypass ONLY on a real removal.
        //    Tasks count toward the save-time guards, and several delete_task
        //    calls in one assistant turn land in a single save debounce window
        //    — five removals leaving at most a tenth is a mass deletion by
        //    Layer B's arithmetic, and this IS the deliberate action the
        //    bypass exists for. Arming on a no-op would leak the one-shot
        //    until some later accidental wipe spent it (documents-panel.tsx
        //    carries the same reasoning at its own arming site).
        args.allowDestructiveSave?.();
```

The `if (!doomed) return false;` guard above it is the change signal — nothing further is needed.

- [ ] **Step 5: Arm `deleteAllTasks`**

In the same file, change the tail of `deleteAllTasks` from:

```ts
        if (count > 0) args.logActivityAs?.("ai", "bulk.delete", count);
        return count;
```

to:

```ts
        if (count > 0) {
          args.logActivityAs?.("ai", "bulk.delete", count);
          // Clearing every task is the archetypal case the bypass exists for.
          // Gated on `count > 0` for the same reason the activity row is:
          // deleting nothing is not a delete, and arming for it leaks a
          // one-shot that no save will spend.
          args.allowDestructiveSave?.();
        }
        return count;
```

- [ ] **Step 6: Arm `deleteResource`**

In `deleteResource`, after the `args.logActivityAs?.("ai", "resource.deleted", …)` line and before `return true;`:

```ts
        args.allowDestructiveSave?.();
```

- [ ] **Step 7: Run the suite — GREEN**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx --reporter=dot > "$SCRATCH/t2b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t2b.log"
```
Expected: EXIT=0, the whole file green. If a PRE-EXISTING test in this file now fails, it encoded the unarmed behaviour — fix the test, and say so in the commit message rather than weakening the assertion.

- [ ] **Step 8: Typecheck and lint**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.tsx --max-warnings=0; echo "LINT=$?"
```
Expected: both 0.

- [ ] **Step 9: Commit**

```bash
git add src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.tsx
git commit --only src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.tsx -m "fix(ai): arm the destructive-save bypass on the three dispatcher delete routes"
```

---

### Task 3: Arm the four register tools

**Files:**
- Modify: `src/app/use-register-tools.ts` (`RegisterToolsDeps`, `deleteRaid`, `deleteChange`, `deleteMilestone`, `deleteStakeholder`)
- Modify: `src/app/use-chat-dispatcher.ts` (the `useRegisterTools({ … })` call site)
- Test: `src/app/use-chat-dispatcher.test.tsx`

- [ ] **Step 1: Confirm unarmed**

```bash
grep -c allowDestructiveSave src/app/use-register-tools.ts   # 0
```

- [ ] **Step 2: Write the failing blocks**

Append inside the describe added in Task 2:

```tsx
  it("deleteRaid arms only when an item was removed", () => {
    const { result, allowDestructiveSave } = renderWithBypass();
    act(() => { result.current.deleteRaid(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    let id!: number;
    act(() => {
      id = result.current.createRaid({ category: "Risk", title: "R1" }).id;
    });
    act(() => { result.current.deleteRaid(id); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("deleteMilestone arms only when a milestone was removed", () => {
    const { result, allowDestructiveSave } = renderWithBypass();
    act(() => { result.current.deleteMilestone(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });

  it("deleteChange arms only when a change was removed", () => {
    const { result, allowDestructiveSave } = renderWithBypass();
    act(() => { result.current.deleteChange(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });

  it("deleteStakeholder arms only when a stakeholder was removed", () => {
    const { result, allowDestructiveSave } = renderWithBypass();
    act(() => { result.current.deleteStakeholder(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });
```

★ `createRaid`'s exact argument shape must be READ from `use-register-tools.ts` before writing this block — if it differs, use the shape the file declares. The block's purpose is the arming assertion, not the create.

- [ ] **Step 3: Run — RED on `deleteRaid`**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx -t "deleteRaid arms" --reporter=dot > "$SCRATCH/t3.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t3.log"
```
Expected: EXIT=1 on the arms-once assertion.

- [ ] **Step 4: Add the dep**

In `src/app/use-register-tools.ts`, add to `RegisterToolsDeps` after `logActivityAs`:

```ts
  /** Arms the one-shot destructive-save bypass. Optional: the dispatcher
   *  renders in contexts (tests, popouts) that supply none. */
  allowDestructiveSave?: () => void;
```

and add it to the destructure:

```ts
  const { isReadOnly, logActivityAs, clockRef, settingsRef, allowDestructiveSave } = deps;
```

- [ ] **Step 5: Arm the four handlers**

In each of `deleteRaid`, `deleteChange`, `deleteMilestone`, `deleteStakeholder`, insert one line after the `logActivityAs?.(…)` call and before `return true;`:

```ts
        allowDestructiveSave?.();
```

Each already returns early (`if (!doomed) return false;`, or `if (!milestonesRef.current.some(…)) return false;`) so the line is unreachable on a no-op.

Add this comment ONCE, above `deleteRaid`:

```ts
      // ★★ These four registers count toward the save-time data-loss guards,
      //    so a delete that empties one — or several deletes inside one save
      //    debounce window — is refused unless the bypass is armed. Armed
      //    AFTER the early return, so a miss never arms (open-followups §285).
```

- [ ] **Step 6: Forward it at the call site**

In `src/app/use-chat-dispatcher.ts`, in the `useRegisterTools({ … })` call, add:

```ts
    allowDestructiveSave: args.allowDestructiveSave,
```

- [ ] **Step 7: Run — GREEN**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx --reporter=dot > "$SCRATCH/t3b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t3b.log"
npx tsc --noEmit; echo "TSC=$?"
```
Expected: EXIT=0, TSC=0.

- [ ] **Step 8: Commit**

```bash
git add src/app/use-register-tools.ts src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.tsx
git commit --only src/app/use-register-tools.ts src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.tsx -m "fix(ai): arm the destructive-save bypass on the four register delete tools"
```

---

### Task 4: `use-resource-planner.ts` — three handlers, ref idiom

**Files:**
- Modify: `src/app/use-resource-planner.ts`
- Modify: `src/app/task-manager.tsx` (the `useResourcePlanner({ … })` call)
- Test: `src/app/use-resource-planner.test.tsx`

★ This task also makes the dep AVAILABLE to Tasks 5, 6 and 9, which are relayed from inside this file. Do not reorder.

- [ ] **Step 1: Read the deps arrays to confirm idiom B**

```bash
grep -n "\[raid, setRaid\]\|\[absences, setAbsences\]\|\[shifts, setShifts\]" src/app/use-resource-planner.ts
grep -n "captureRef = useRef\|logActivityRef = useRef" src/app/use-resource-planner.ts
```
Expected: the three deps arrays contain no `args`, and `captureRef`/`logActivityRef` exist — so the new value must ride a ref too, or `exhaustive-deps` (fatal) rejects the edit.

- [ ] **Step 2: Write the failing blocks**

Append to `src/app/use-resource-planner.test.tsx`. Use the file's OWN existing render helper — read it first and match its signature; the code below assumes it returns `{ result }` and accepts an args object.

```tsx
describe("useResourcePlanner — deletes arm the destructive-save bypass", () => {
  it("handleDeleteRaidItem arms once for an item that exists", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderPlanner({ allowDestructiveSave });
    const id = result.current.raid[0]!.id;
    act(() => { result.current.handleDeleteRaidItem(id); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("handleDeleteRaidItem does NOT arm for an id that does not exist", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderPlanner({ allowDestructiveSave });
    act(() => { result.current.handleDeleteRaidItem(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    // POSITIVE CONTROL
    act(() => { result.current.handleDeleteRaidItem(result.current.raid[0]!.id); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("handleDeleteAbsence does NOT arm for an id that does not exist", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderPlanner({ allowDestructiveSave });
    act(() => { result.current.handleDeleteAbsence(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });

  it("handleDeleteShift does NOT arm for an id that does not exist", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderPlanner({ allowDestructiveSave });
    act(() => { result.current.handleDeleteShift(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });

  it("does not throw when no bypass is supplied", () => {
    const { result } = renderPlanner({});
    expect(() => {
      act(() => { result.current.handleDeleteRaidItem(result.current.raid[0]!.id); });
    }).not.toThrow();
  });
});
```

If the file's helper does not seed RAID, absences or shifts, seed them in the helper call — an assertion against an empty fixture proves nothing, and `handleDeleteRaidItem` on an empty register would pass the arms-once block for the wrong reason.

- [ ] **Step 3: Run — RED on the arms-once block**

```bash
npx vitest run src/app/use-resource-planner.test.tsx -t "arm the destructive-save" --reporter=dot > "$SCRATCH/t4.log" 2>&1; echo "EXIT=$?"; tail -25 "$SCRATCH/t4.log"
```
Expected: EXIT=1.

- [ ] **Step 4: Add the dep and its ref**

In `src/app/use-resource-planner.ts`, add to the hook's args interface (beside `capture` / `logActivity`):

```ts
  /** Arms the one-shot destructive-save bypass. Optional — popouts and tests
   *  supply none. */
  allowDestructiveSave?: () => void;
```

Beside the existing `captureRef` / `logActivityRef` declarations:

```ts
  // ★★ A REF, not `args.` — these delete callbacks do not list `args` in their
  //    deps arrays, and `react-hooks/exhaustive-deps` is FATAL here. Mirrors
  //    `captureRef` immediately above for exactly that reason.
  const allowDestructiveRef = useRef(args.allowDestructiveSave);
  useEffect(() => { allowDestructiveRef.current = args.allowDestructiveSave; }, [args.allowDestructiveSave]);
```

- [ ] **Step 5: Arm the three handlers**

In `handleDeleteRaidItem`, inside the existing `if (removed) { … }` block that already logs, after the `logActivityRef.current(…)` line:

```ts
        allowDestructiveRef.current?.();
```

Do the same inside the `if (removed) { … }` block of `handleDeleteAbsence` and of `handleDeleteShift`.

★ Put it INSIDE the existing `if (removed)` block — not after it. `removed` is the change signal, and the setter above runs unconditionally.

- [ ] **Step 6: Pass it from `task-manager.tsx`**

In the `useResourcePlanner({ … })` call, add:

```ts
    allowDestructiveSave,
```

- [ ] **Step 7: Run — GREEN, then typecheck and lint**

```bash
npx vitest run src/app/use-resource-planner.test.tsx --reporter=dot > "$SCRATCH/t4b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t4b.log"
npx tsc --noEmit; echo "TSC=$?"
npx eslint src/app/use-resource-planner.ts src/app/task-manager.tsx --max-warnings=0; echo "LINT=$?"
```
Expected: all 0. A lint failure naming `exhaustive-deps` means the ref was bypassed — go back to Step 4.

- [ ] **Step 8: Commit**

```bash
git add src/app/use-resource-planner.ts src/app/task-manager.tsx src/app/use-resource-planner.test.tsx
git commit --only src/app/use-resource-planner.ts src/app/task-manager.tsx src/app/use-resource-planner.test.tsx -m "fix(resources): arm the destructive-save bypass on the planner's three delete paths"
```

---

### Task 5: `use-resource-directory.ts` — two handlers, ref idiom

**Files:**
- Modify: `src/app/use-resource-directory.ts`
- Modify: `src/app/use-resource-planner.ts` (the `useResourceDirectory({ … })` relay)
- Test: `src/app/use-resource-planner.test.tsx` (reached through the planner — this hook has no test file and gets none)

- [ ] **Step 1: Write the failing blocks**

Append to `src/app/use-resource-planner.test.tsx`:

```tsx
describe("useResourceDirectory — deletes arm the destructive-save bypass", () => {
  it("handleBulkDeleteResources arms once when it removed at least one", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderPlanner({ allowDestructiveSave });
    const ids = result.current.resources.slice(0, 2).map((r) => r.id);
    act(() => { result.current.handleBulkDeleteResources(ids); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("handleBulkDeleteResources does NOT arm when the id list matched nothing", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderPlanner({ allowDestructiveSave });
    act(() => { result.current.handleBulkDeleteResources([999_998, 999_999]); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    // POSITIVE CONTROL
    act(() => { result.current.handleBulkDeleteResources([result.current.resources[0]!.id]); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("handleDeleteResource does NOT arm for an id that does not exist", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderPlanner({ allowDestructiveSave });
    act(() => { result.current.handleDeleteResource(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — RED**

```bash
npx vitest run src/app/use-resource-planner.test.tsx -t "useResourceDirectory" --reporter=dot > "$SCRATCH/t5.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t5.log"
```
Expected: EXIT=1 on the arms-once block.

- [ ] **Step 3: Add the dep and ref**

In `src/app/use-resource-directory.ts`, add `allowDestructiveSave?: () => void;` to its args interface with the same docstring as Task 4, and beside `captureCompositeRef`:

```ts
  const allowDestructiveRef = useRef(args.allowDestructiveSave);
  useEffect(() => { allowDestructiveRef.current = args.allowDestructiveSave; }, [args.allowDestructiveSave]);
```

- [ ] **Step 4: Arm both handlers**

In `handleDeleteResource`, inside the existing `if (removed) { … }` block, after the composite capture:

```ts
        allowDestructiveRef.current?.();
```

In `handleBulkDeleteResources`, inside the existing `if (removed.length > 0) { … }` block:

```ts
          allowDestructiveRef.current?.();
```

★ Once per call, not once per removed row: the bypass is a one-shot consumed by the NEXT save, so N calls and 1 call have identical effect — and the test asserts `toHaveBeenCalledTimes(1)` for a two-id bulk delete.

- [ ] **Step 5: Relay it from the planner**

In `src/app/use-resource-planner.ts`, in the `useResourceDirectory({ … })` call, add:

```ts
    allowDestructiveSave: args.allowDestructiveSave,
```

- [ ] **Step 6: Run, typecheck, lint, commit**

```bash
npx vitest run src/app/use-resource-planner.test.tsx --reporter=dot > "$SCRATCH/t5b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t5b.log"
npx tsc --noEmit; echo "TSC=$?"
npx eslint src/app/use-resource-directory.ts src/app/use-resource-planner.ts --max-warnings=0; echo "LINT=$?"
git add src/app/use-resource-directory.ts src/app/use-resource-planner.ts src/app/use-resource-planner.test.tsx
git commit --only src/app/use-resource-directory.ts src/app/use-resource-planner.ts src/app/use-resource-planner.test.tsx -m "fix(resources): arm the destructive-save bypass on the resource delete and bulk delete"
```

---

### Task 6: `use-reference-data.ts` — `handleDeleteRole`, ref idiom

**Files:**
- Modify: `src/app/use-reference-data.ts`
- Modify: `src/app/use-resource-planner.ts` (the `useReferenceData({ … })` relay)
- Test: `src/app/use-resource-planner.test.tsx`

- [ ] **Step 1: Write the failing blocks**

```tsx
describe("useReferenceData — role delete arms the destructive-save bypass", () => {
  it("handleDeleteRole arms once for a role that exists", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderPlanner({ allowDestructiveSave });
    const id = result.current.roles[0]!.id;
    act(() => { result.current.handleDeleteRole(id); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("handleDeleteRole does NOT arm for an id that does not exist", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderPlanner({ allowDestructiveSave });
    act(() => { result.current.handleDeleteRole(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    // POSITIVE CONTROL
    act(() => { result.current.handleDeleteRole(result.current.roles[0]!.id); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });
});
```

If the planner's render helper exposes roles under another name, read the file and use that name. If it seeds no roles, seed one — the arms-once block is vacuous otherwise.

- [ ] **Step 2: Run — RED**

```bash
npx vitest run src/app/use-resource-planner.test.tsx -t "useReferenceData" --reporter=dot > "$SCRATCH/t6.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t6.log"
```

- [ ] **Step 3: Add the dep, ref, and arming**

Add `allowDestructiveSave?: () => void;` to the args interface, the `allowDestructiveRef` + `useEffect` pair beside `captureCompositeRef`, and inside `handleDeleteRole`'s existing `if (removed) { … }` block:

```ts
        allowDestructiveRef.current?.();
```

★ Roles are counted (`SLICE_POLICY` marks `roles` as user-authored reference data), and the delete cascades a `roleId → null` edit across resources — so this is a removal even though most of its work is an update.

- [ ] **Step 4: Relay from the planner**

In the `useReferenceData({ … })` call in `src/app/use-resource-planner.ts`:

```ts
    allowDestructiveSave: args.allowDestructiveSave,
```

- [ ] **Step 5: Run, typecheck, lint, commit**

```bash
npx vitest run src/app/use-resource-planner.test.tsx --reporter=dot > "$SCRATCH/t6b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t6b.log"
npx tsc --noEmit; echo "TSC=$?"
npx eslint src/app/use-reference-data.ts src/app/use-resource-planner.ts --max-warnings=0; echo "LINT=$?"
git add src/app/use-reference-data.ts src/app/use-resource-planner.ts src/app/use-resource-planner.test.tsx
git commit --only src/app/use-reference-data.ts src/app/use-resource-planner.ts src/app/use-resource-planner.test.tsx -m "fix(resources): arm the destructive-save bypass on the role delete"
```

---

### Task 7: `use-stakeholders.ts` — `args.` idiom

**Files:**
- Modify: `src/app/use-stakeholders.ts`
- Modify: `src/app/task-manager.tsx` (the `useStakeholders({ … })` call)
- Test: `src/app/use-stakeholders.test.tsx`

- [ ] **Step 1: Confirm idiom A**

```bash
grep -n "\[stakeholders, setStakeholders, args\]" src/app/use-stakeholders.ts
```
Expected: one line. `args` IS in the deps array, so `args.allowDestructiveSave?.()` is correct and no ref is needed.

- [ ] **Step 2: Write the failing blocks**

★ **This file has NO render helper.** Every test calls `renderHook` inline with the file's local
`Wrapper` component. Follow that pattern rather than inventing a helper — read an existing test in
the file first and copy its `renderHook(() => useStakeholders({ … }), { wrapper: Wrapper })` shape,
including whatever args that call already passes.

Append to `src/app/use-stakeholders.test.tsx`:

```tsx
describe("useStakeholders — delete arms the destructive-save bypass", () => {
  it("arms once for a stakeholder that exists", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderHook(
      () => useStakeholders({ allowDestructiveSave }),
      { wrapper: Wrapper },
    );
    const victim = result.current.stakeholders[0]!;
    act(() => { result.current.handleDeleteStakeholder(victim.id, victim.name); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("does NOT arm for an id that does not exist", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderHook(
      () => useStakeholders({ allowDestructiveSave }),
      { wrapper: Wrapper },
    );
    act(() => { result.current.handleDeleteStakeholder(999_999, "ghost"); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    // POSITIVE CONTROL
    const victim = result.current.stakeholders[0]!;
    act(() => { result.current.handleDeleteStakeholder(victim.id, victim.name); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("does not throw when no bypass is supplied", () => {
    const { result } = renderHook(() => useStakeholders({}), { wrapper: Wrapper });
    const victim = result.current.stakeholders[0]!;
    expect(() => {
      act(() => { result.current.handleDeleteStakeholder(victim.id, victim.name); });
    }).not.toThrow();
  });
});
```

★ `useStakeholders`' required args are whatever the existing `renderHook` calls in the file pass —
copy them into these three calls. If the hook requires a non-optional arg, the `useStakeholders({})`
call above will not typecheck; pass the same minimum the file's other tests do. The seeded
stakeholder rows come from `Wrapper`, so `result.current.stakeholders[0]` must be non-empty — if it
is, seed through `Wrapper` the way the file's other delete tests do.

- [ ] **Step 3: Run — RED**

```bash
npx vitest run src/app/use-stakeholders.test.tsx -t "arms the destructive-save" --reporter=dot > "$SCRATCH/t7.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t7.log"
```

- [ ] **Step 4: Add the dep and arm**

Add `allowDestructiveSave?: () => void;` to the hook's args interface. In `handleDeleteStakeholder`, change:

```ts
    if (doomed) args.capture?.({ setter: setStakeholders, kind: "stakeholder.deleted", removed: [doomed], fromArray: stakeholders, name });
```

to add a second statement in the same guard:

```ts
    if (doomed) {
      args.capture?.({ setter: setStakeholders, kind: "stakeholder.deleted", removed: [doomed], fromArray: stakeholders, name });
      // ★★ Stakeholders count toward the save-time data-loss guards. Armed
      //    inside the `doomed` guard so a miss never arms — the setter below
      //    runs either way (open-followups §285).
      args.allowDestructiveSave?.();
    }
```

- [ ] **Step 5: Pass it from `task-manager.tsx`**

In the `useStakeholders({ … })` call, add `allowDestructiveSave,`.

- [ ] **Step 6: Run, typecheck, lint, commit**

```bash
npx vitest run src/app/use-stakeholders.test.tsx --reporter=dot > "$SCRATCH/t7b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t7b.log"
npx tsc --noEmit; echo "TSC=$?"
npx eslint src/app/use-stakeholders.ts src/app/task-manager.tsx --max-warnings=0; echo "LINT=$?"
git add src/app/use-stakeholders.ts src/app/task-manager.tsx src/app/use-stakeholders.test.tsx
git commit --only src/app/use-stakeholders.ts src/app/task-manager.tsx src/app/use-stakeholders.test.tsx -m "fix(stakeholders): arm the destructive-save bypass on the stakeholder delete"
```

---

### Task 8: `use-change-log.ts` — `args.` idiom

**Files:**
- Modify: `src/app/use-change-log.ts`
- Modify: `src/app/task-manager.tsx` (the `useChangeLog({ … })` call)
- Test: `src/app/use-change-log.test.tsx`

- [ ] **Step 1: Confirm idiom A**

```bash
grep -n "\[changes, setChanges, args\]" src/app/use-change-log.ts
```
Expected: one line.

- [ ] **Step 2: Write the failing blocks**

★ **The file's only helper is `renderChangeLogWithRealUndo()`, and it takes no arguments.** Do not
call a `renderChangeLog({ … })` — it does not exist. Either extend that helper to accept an optional
overrides object, or follow the file's inline `renderHook(… , { wrapper: Wrapper })` pattern as the
other tests do. The blocks below assume the helper was extended to
`renderChangeLogWithRealUndo(overrides?: { allowDestructiveSave?: () => void })`, forwarding the
overrides into its `useChangeLog({ … })` call; make that edit first and keep its existing no-argument
callers working by defaulting the parameter.

Append to `src/app/use-change-log.test.tsx`:

```tsx
describe("useChangeLog — delete arms the destructive-save bypass", () => {
  it("arms once for a change that exists", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderChangeLogWithRealUndo({ allowDestructiveSave });
    const victim = result.current.changes[0]!;
    act(() => { result.current.handleDeleteChange(victim.id, victim.title); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("does NOT arm for an id that does not exist", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderChangeLogWithRealUndo({ allowDestructiveSave });
    act(() => { result.current.handleDeleteChange(999_999, "ghost"); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    // POSITIVE CONTROL
    const victim = result.current.changes[0]!;
    act(() => { result.current.handleDeleteChange(victim.id, victim.title); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("does not throw when no bypass is supplied", () => {
    const { result } = renderChangeLogWithRealUndo({});
    const victim = result.current.changes[0]!;
    expect(() => {
      act(() => { result.current.handleDeleteChange(victim.id, victim.title); });
    }).not.toThrow();
  });
});
```

- [ ] **Step 3: Run — RED**

```bash
npx vitest run src/app/use-change-log.test.tsx -t "arms the destructive-save" --reporter=dot > "$SCRATCH/t8.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t8.log"
```

- [ ] **Step 4: Add the dep and arm**

Add `allowDestructiveSave?: () => void;` to the args interface, then in `handleDeleteChange`:

```ts
    if (doomed) {
      args.capture?.({ setter: setChanges, kind: "change.deleted", removed: [doomed], fromArray: changes, name: title });
      args.allowDestructiveSave?.();
    }
```

- [ ] **Step 5: Pass it from `task-manager.tsx`**

In the `useChangeLog({ … })` call, add `allowDestructiveSave,`.

- [ ] **Step 6: Run, typecheck, lint, commit**

```bash
npx vitest run src/app/use-change-log.test.tsx --reporter=dot > "$SCRATCH/t8b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t8b.log"
npx tsc --noEmit; echo "TSC=$?"
npx eslint src/app/use-change-log.ts src/app/task-manager.tsx --max-warnings=0; echo "LINT=$?"
git add src/app/use-change-log.ts src/app/task-manager.tsx src/app/use-change-log.test.tsx
git commit --only src/app/use-change-log.ts src/app/task-manager.tsx src/app/use-change-log.test.tsx -m "fix(changes): arm the destructive-save bypass on the change delete"
```

---

### Task 9: `use-calendar-events.ts` — `args.` idiom

**Files:**
- Modify: `src/app/use-calendar-events.ts`
- Modify: `src/app/use-resource-planner.ts` (the `useCalendarEvents({ … })` relay)
- Test: `src/app/use-calendar-events.test.tsx`

- [ ] **Step 1: Confirm idiom A**

```bash
grep -n "setEventsForUndo, args\]" src/app/use-calendar-events.ts
```
Expected: one line — `args` is in the deps array.

- [ ] **Step 2: Write the failing blocks**

★ **`renderCalendarEvents()` currently takes NO arguments** — it is exactly
`renderHook(() => useCalendarEvents({ today: "2026-06-20" }), { wrapper: Wrapper })`. Extend it
first, keeping every existing no-argument caller working:

```tsx
function renderCalendarEvents(overrides: { allowDestructiveSave?: () => void } = {}) {
  return renderHook(
    () => useCalendarEvents({ today: "2026-06-20", ...overrides }),
    { wrapper: Wrapper },
  );
}
```

★ There are no seeded events, so both blocks must CREATE one first via
`handleSaveCalendarEvent({ ...base, id: N }, true)` — the file's other tests use exactly that, and
`base` is already defined there. Asserting against `calendarEvents![0]` without creating one reads
`undefined` and the block fails for the wrong reason.

Then append to `src/app/use-calendar-events.test.tsx`:

```tsx
describe("useCalendarEvents — delete arms the destructive-save bypass", () => {
  it("arms once for an event that exists", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderCalendarEvents({ allowDestructiveSave });
    act(() => { result.current.handleSaveCalendarEvent({ ...base, id: 7 }, true); });
    const id = result.current.calendarEvents![0]!.id;
    act(() => { result.current.handleDeleteCalendarEvent(id); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
    // Positive observable: the delete really ran.
    expect(result.current.calendarEvents ?? []).toHaveLength(0);
  });

  it("does NOT arm for an id that does not exist", () => {
    const allowDestructiveSave = vi.fn();
    const { result } = renderCalendarEvents({ allowDestructiveSave });
    act(() => { result.current.handleSaveCalendarEvent({ ...base, id: 7 }, true); });
    act(() => { result.current.handleDeleteCalendarEvent(999_999); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    // POSITIVE CONTROL
    act(() => { result.current.handleDeleteCalendarEvent(result.current.calendarEvents![0]!.id); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run — RED**

```bash
npx vitest run src/app/use-calendar-events.test.tsx -t "arms the destructive-save" --reporter=dot > "$SCRATCH/t9.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t9.log"
```

- [ ] **Step 4: Add the dep and arm**

Add `allowDestructiveSave?: () => void;` to the args interface. In `handleDeleteCalendarEvent`, change:

```ts
      if (doomed) args.logActivity?.("calendarEvent.deleted", id, doomed.title);
```

to:

```ts
      if (doomed) {
        args.logActivity?.("calendarEvent.deleted", id, doomed.title);
        args.allowDestructiveSave?.();
      }
```

- [ ] **Step 5: Relay from the planner**

In the `useCalendarEvents({ … })` call in `src/app/use-resource-planner.ts`, add:

```ts
    allowDestructiveSave: args.allowDestructiveSave,
```

- [ ] **Step 6: Run, typecheck, lint, commit**

```bash
npx vitest run src/app/use-calendar-events.test.tsx --reporter=dot > "$SCRATCH/t9b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t9b.log"
npx tsc --noEmit; echo "TSC=$?"
npx eslint src/app/use-calendar-events.ts src/app/use-resource-planner.ts --max-warnings=0; echo "LINT=$?"
git add src/app/use-calendar-events.ts src/app/use-resource-planner.ts src/app/use-calendar-events.test.tsx
git commit --only src/app/use-calendar-events.ts src/app/use-resource-planner.ts src/app/use-calendar-events.test.tsx -m "fix(calendar): arm the destructive-save bypass on the meeting delete"
```

---

### Task 10: `milestones-panel.tsx` — plain-function idiom, prop threaded through `workspace-section`

**Files:**
- Modify: `src/app/milestones-panel.tsx` (props + `del`)
- Modify: `src/app/workspace-section.tsx` (forward to `<MilestonesPanel>`)
- Test: `src/app/milestones-panel.test.tsx`

`workspace-section.tsx` already holds `allowDestructiveSave` — it passes it to other panels today. Only the forward to `MilestonesPanel` is missing.

- [ ] **Step 1: Confirm the source is already in scope**

```bash
grep -n "allowDestructiveSave" src/app/workspace-section.tsx
grep -n "allowDestructiveSave" src/app/workspace-section-types.ts
```
Expected: non-empty in both — the prop exists on the pane contract already.

- [ ] **Step 2: Write the failing blocks**

★ **The helper is `renderMilestones({ milestones, today })`** — it takes an options OBJECT with those
two keys only, seeds rows through a local `<Seed milestones={…} />`, renders
`<MilestonesPanel lang="en-US" today={today} holidaySet={new Set()} />`, and returns RTL's `render()`
result. There is no `renderPanel` and no `user` in what it returns. Extend it first:

```tsx
function renderMilestones({
  milestones = [],
  today = "2026-06-02",
  allowDestructiveSave,
}: {
  milestones?: readonly Milestone[];
  today?: string;
  allowDestructiveSave?: () => void;
} = {}) {
  return render(
    <>
      <Seed milestones={milestones} />
      <MilestonesPanel
        lang="en-US"
        today={today}
        holidaySet={new Set()}
        allowDestructiveSave={allowDestructiveSave}
      />
    </>,
    { wrapper },
  );
}
```

Then append to `src/app/milestones-panel.test.tsx`:

```tsx
describe("MilestonesPanel — delete arms the destructive-save bypass", () => {
  it("arms once for a milestone that exists", async () => {
    const user = userEvent.setup();
    const allowDestructiveSave = vi.fn();
    renderMilestones({ milestones: [milestone({ id: 1, name: "Kickoff" })], allowDestructiveSave });
    await user.click(screen.getByRole("button", { name: /delete.*kickoff/i }));
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Kickoff")).toBeNull();
  });

  it("does not throw when no bypass is supplied", async () => {
    const user = userEvent.setup();
    renderMilestones({ milestones: [milestone({ id: 1, name: "Kickoff" })] });
    await expect(
      user.click(screen.getByRole("button", { name: /delete.*kickoff/i })),
    ).resolves.not.toThrow();
  });
});
```

★★ **The `milestones` fixture MUST be non-empty.** The default is `[]`, and against an empty panel
there is no delete control at all — the arms-once block would fail on a missing element rather than
on the arming, which reads as a broken selector. Use the file's own milestone factory; if it has none
under the name `milestone`, read the file and use whatever it builds rows with.

★★ **Do not write a bare `/delete/i`.** This repo qualifies per-row control names with the row title
(`"Delete – <name>"`), so a bare match hits several controls and throws a strict-mode violation that
reads as a broken selector. Read the panel's real accessible name and match it including the row
title, as above. If the panel's delete sits behind a confirm dialog, click through it — check the
file's existing delete test before assuming a single click completes the deletion.

★ There is no does-NOT-arm block here: `del` is reached only from a row that exists, so the no-op branch is unreachable through the UI. The `if (doomed)` guard is still required in the source — it is what makes the arming honest if `del` is ever called programmatically — and it is covered by the mutation check in Task 11.

- [ ] **Step 3: Run — RED**

```bash
npx vitest run src/app/milestones-panel.test.tsx -t "arms the destructive-save" --reporter=dot > "$SCRATCH/t10.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t10.log"
```

- [ ] **Step 4: Add the prop and arm**

In `src/app/milestones-panel.tsx`, add to the props interface:

```ts
  /** Arms the one-shot destructive-save bypass. Optional: the panel renders in
   *  contexts (tests, popouts) that supply none. */
  allowDestructiveSave?: () => void;
```

destructure it in the component signature, and change `del`:

```ts
  function del(id: number) {
    const doomed = milestones.find((m) => m.id === id);
    if (doomed) {
      capture?.({ setter: setMilestones, kind: "milestone.deleted", removed: [doomed], fromArray: milestones, name: doomed.name });
      // ★★ Milestones count toward the save-time data-loss guards. Armed
      //    inside the `doomed` guard so a miss never arms (§285).
      allowDestructiveSave?.();
    }
    setMilestones((prev) => prev.filter((m) => m.id !== id));
    logActivity?.("milestone.deleted", id);
    setEditing(null);
  }
```

- [ ] **Step 5: Forward it in `workspace-section.tsx`**

On the `<MilestonesPanel … />` element, add:

```tsx
        allowDestructiveSave={allowDestructiveSave}
```

- [ ] **Step 6: Run, typecheck, lint, commit**

```bash
npx vitest run src/app/milestones-panel.test.tsx --reporter=dot > "$SCRATCH/t10b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t10b.log"
npx tsc --noEmit; echo "TSC=$?"
npx eslint src/app/milestones-panel.tsx src/app/workspace-section.tsx --max-warnings=0; echo "LINT=$?"
git add src/app/milestones-panel.tsx src/app/workspace-section.tsx src/app/milestones-panel.test.tsx
git commit --only src/app/milestones-panel.tsx src/app/workspace-section.tsx src/app/milestones-panel.test.tsx -m "fix(milestones): arm the destructive-save bypass on the milestone delete"
```

---

### Task 11: Mutation proof — name which mutant backs which block

An unqualified "mutation-proved" over the file is NOT an acceptable report. Each mutant below is applied to ONE site, run, reverted, and its result recorded.

★ `git checkout -- <file>` is deny-blocked. Revert each mutant with an inverse anchored Edit, then prove the tree is clean with `git diff --stat` before applying the next.

★★ An idle agent leaves a LIVE mutant. Revert before the next command, never at the end of a batch.

- [ ] **Step 1: M1 — delete the arming (kills the arms-once blocks)**

In `src/app/use-chat-dispatcher.ts`, remove the `args.allowDestructiveSave?.();` line from `deleteAllTasks` only.

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx -t "deleteAllTasks arms once" --reporter=dot > "$SCRATCH/m1.log" 2>&1; echo "M1_EXIT=$?"
```
Expected: **M1_EXIT=1**. Record: M1 backs `deleteAllTasks arms once when it emptied a non-empty register`.

Revert with an inverse Edit, then:
```bash
git diff --stat; echo "CLEAN_IF_EMPTY"
```

- [ ] **Step 2: M2 — make the arming unconditional (kills the leak blocks)**

In `src/app/use-chat-dispatcher.ts`, move `args.allowDestructiveSave?.();` in `deleteTask` to ABOVE the `if (!doomed) return false;` line.

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx -t "deleteTask does NOT arm" --reporter=dot > "$SCRATCH/m2.log" 2>&1; echo "M2_EXIT=$?"
```
Expected: **M2_EXIT=1**. Record: M2 backs `deleteTask does NOT arm for an id that does not exist`.

★★★ M2 is the mutant that matters most and the one a careless suite misses. M1 alone proves only that a callback fires; it says nothing about the leak, because under M1 the leak assertion still passes. Two mutants, two blocks, named separately.

Revert, prove clean.

- [ ] **Step 3: M3 — break the `TOOL_DEFS` enumeration (kills the anti-vacuity block)**

In `src/app/destructive-save-arming.test.ts`, change `removalToolNames`'s final filter to `.filter(() => false)`.

```bash
npx vitest run src/app/destructive-save-arming.test.ts --reporter=dot > "$SCRATCH/m3.log" 2>&1; echo "M3_EXIT=$?"
```
Expected: **M3_EXIT=1**, failing on `enumerates a non-empty tool set (anti-vacuity)`. Record: M3 backs the anti-vacuity block.

Revert, prove clean.

- [ ] **Step 4: M4 — drop the spread (kills the composition-trap block)**

In `src/app/destructive-save-arming.test.ts`, change the import to pull `TOOL_DEFS` and filter out anything named `delete_document`:
replace `.filter((n) => n.startsWith("delete_") || n.startsWith("clear_"));` with
`.filter((n) => (n.startsWith("delete_") || n.startsWith("clear_")) && n !== "delete_document");`

```bash
npx vitest run src/app/destructive-save-arming.test.ts --reporter=dot > "$SCRATCH/m4.log" 2>&1; echo "M4_EXIT=$?"
```
Expected: **M4_EXIT=1** on `reaches delete_document, which is declared in a SPREAD module`. Record: M4 backs the composition-trap block.

Revert, prove clean.

- [ ] **Step 5: Record the mutation table in the gate file**

Add to the docstring of `src/app/destructive-save-arming.test.ts`:

```
 * Mutation record, 2026-08-29 — which mutant backs which block:
 *   M1 delete the arming in deleteAllTasks      → "deleteAllTasks arms once…"
 *   M2 hoist the arming above the !doomed guard → "deleteTask does NOT arm…"
 *   M3 empty removalToolNames()                 → "enumerates a non-empty tool set"
 *   M4 filter out delete_document               → "reaches delete_document…"
 * The blocks NOT listed here are unproved by mutation and are stated as such.
```

- [ ] **Step 6: Full suite, clean tree, commit**

```bash
git diff --stat; echo "MUST_BE_EMPTY_EXCEPT_THE_DOCSTRING"
npm run test:run > "$SCRATCH/full.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/full.log"
git add src/app/destructive-save-arming.test.ts
git commit --only src/app/destructive-save-arming.test.ts -m "test(storage): record which mutant backs which arming assertion"
```

---

### Task 12: Register, CHANGELOG, version bump

**Files:**
- Modify: `docs/open-followups.md` (LF), `CHANGELOG.md` (LF), `src/app/version.ts` (CRLF)

- [ ] **Step 1: Read the current max register number ON `origin/main`**

```bash
git fetch origin --quiet
git show origin/main:docs/open-followups.md > "$SCRATCH/main-followups.md"
grep -oE "^## [0-9]+\." "$SCRATCH/main-followups.md" | grep -oE "[0-9]+" | sort -n | tail -1
```
A number is reserved only once it is on `origin/main` — two branches have already minted the same one. Use `max + 1` for the new entry. It was 288 when this plan was written; do not assume it still is.

- [ ] **Step 2: Close §285 — FOUR places, and a body line must never say CLOSED**

1. The `## 285.` heading — append ` — CLOSED <ISO date>`
2. The summary-table status cell for §285 — set to `**CLOSED** <ISO date>`
3. The summary-table anchor link — it encodes the heading text, so it MUST be regenerated to match the new heading or the link breaks silently
4. The `**Status:**` witness line in the body

Verify all four moved:
```bash
grep -n "^## 285\." docs/open-followups.md
grep -n "285-nothing-gates" docs/open-followups.md
```
The second must return the anchor with the new heading slug; a stale slug is the failure this four-place rule exists for.

- [ ] **Step 3: File the UI-completeness bound as a new entry**

Add a new `## <max+1>.` entry recording that the completeness check is complete for the AI surface only, that no declaration exists to enumerate UI removal routes from, and that an eighteenth UI delete handler fails nothing. Its `**Status:**` line must be an ISO date plus either a backticked command or the literal `never machine-verified`. Cite SYMBOLS, never `path:LINE` — `docs/open-followups.md` is in `doc-claims-check`'s scan set and that gate is a ratchet.

- [ ] **Step 4: CHANGELOG — tiers A and B only**

Add a `## [<new version>] - <date> "Okorafor"` entry with a `### Fixed` section describing, in user-facing language: deleting every task through the assistant, or bulk-deleting resources, could be silently refused by the data-loss guard so the deletion never persisted; and several assistant deletions in one turn could hit the same refusal.

★★★ Do NOT describe the nine UI single-delete handlers as a fixed user-facing bug. A single delete cannot trip a refusal on its own — `isMassDeletion` needs at least five records removed, and a single delete that empties the workspace leaves `prevCollections === 1`, which is forensic rather than refused. They are armed for consistency. Never put a session URL in `CHANGELOG.md`.

- [ ] **Step 5: Bump and propagate**

Edit `src/app/version.ts` (CRLF — use Edit, never Write): `APP_VERSION`, `APP_BUILD_DATE`, milestone comment. Then:

```bash
npm run version:sync; echo "EXIT=$?"
npm run version:check; echo "EXIT=$?"
```
Expected: both 0. `version:check` exits **1 on drift** and **2 when it cannot scan at all** — the two demand opposite responses.

- [ ] **Step 6: Run every blocking doc gate unpiped**

```bash
npm run docs:symbols:check; echo "SYMBOLS=$?"
npm run docs:claims:check; echo "CLAIMS=$?"
npm run followups:status:check; echo "STATUS=$?"
npm run size:check; echo "SIZE=$?"
npm run dup:check; echo "DUP=$?"
```
Expected: all 0. If `size:check` fails, read the real line count with
`node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"` — it counts `wc -l` plus 1, so budgeting from `wc -l` overstates headroom by exactly one line.

- [ ] **Step 7: Commit**

```bash
git add docs/open-followups.md CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS
git commit -m "docs: close 285, file the UI-completeness bound, release <new version>"
```

---

### Task 13: Release — GATED

**★★★ DO NOT START THIS TASK UNTIL THE USER SAYS "release".** This plan does not authorise push, MR or merge. Nothing in Tasks 1–12 touches a remote.

- [ ] **Step 1: Full local gate sweep** (skip only if the user says "no local gates")

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint src --max-warnings=0; echo "LINT=$?"
npm run test:run > "$SCRATCH/rel.log" 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " "$SCRATCH/rel.log"
npm run test:shuffle > "$SCRATCH/shuf.log" 2>&1; echo "SHUFFLE=$?"; grep -E "Test Files|Tests " "$SCRATCH/shuf.log"
```

- [ ] **Step 2: Push and open the MR**

```bash
git push -u origin fix/destructive-save-arming
glab mr create --fill --yes
```
Never put a `[session link removed]...` URL in the MR description.

- [ ] **Step 3: Poll the pipeline to completion**

Wait for every job. `dast-zap` is `manual` on an MR pipeline and non-blocking.

- [ ] **Step 4: Verify the green pipeline's SHA matches local HEAD**

```bash
git rev-parse HEAD
```
Compare against the SHA the pipeline ran. A mismatch means the green run does not describe this code.

- [ ] **Step 5: Merge — only on green, and never with auto-merge**

```bash
glab mr merge <IID> --auto-merge=false --remove-source-branch --yes
```
`glab` DEFAULTS `--auto-merge=true`, so omitting the flag is NOT opting out.

- [ ] **Step 6: Verify the merge introduced nothing**

```bash
git fetch origin --quiet && git checkout main && git merge --ff-only origin/main
git diff-tree --cc HEAD
```
Bare `--cc` must print only the SHA line. Do NOT add `--stat` — it does not respect `--cc`'s filtering and prints the full diffstat, which reads as though the merge introduced content.

---

## Non-goals — state these if asked to widen scope

- **The guards themselves.** No change to `evaluateSaveGuard`, `isMassDeletion`, its thresholds, L3 or Layer B.
- **§98, §241, §242.** Open BY DECISION as records, not because code is broken.
- **§286, §287, §288.** Slice 2 — the note-log policy extraction, the storage-handle capture-and-restore, the AI-seed allow-list.
- **A UI-surface completeness gate.** Filed in Task 12 Step 3, not built.
- **A shared "delete and arm" helper.** It would have to model seven change-signal shapes and three setter idioms, and would hide the one line that matters at each site.
- **`isWorkspaceEmpty`.** Untouched.
