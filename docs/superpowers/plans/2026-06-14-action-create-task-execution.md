# Create-Task Execution CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Create task" CTA to Action-Center rows that opens the task editor pre-seeded from the signal (title + `From:` note), with RAID signals linking the new task back via `linkedTaskIds` on save.

**Architecture:** Surface-only — the `next-actions/` engine is untouched. A pure helper builds the task seed from a `SuggestedAction`; `ActionRow` renders the button; `task-manager.tsx` dispatches it into the existing task editor; `useTaskSubmit` performs the RAID FK link when a new task is saved. Propose-then-confirm (user edits + saves).

**Tech Stack:** TypeScript, React (Next.js fork), Vitest + React Testing Library, i18n EN+DE (parity enforced by tsc).

**Spec:** `docs/superpowers/specs/2026-06-14-action-create-task-execution-design.md`

---

## Grounding facts (verified)

- Task editor state: `useTaskForm()` (`task-form-context.tsx`) → `form/setForm/editingId/setEditingId/taskModalOpen/setTaskModalOpen`. `emptyForm()` returns a `TaskFormDraft` whose free-text field is **`notes`** (there is NO `description`). The `From:` note goes into `notes`.
- New tasks are minted in `useTaskSubmit.handleSubmit` (`use-task-submit.ts`) **`else` branch** (`editingId === null`): `const newTask = { id: nextId(tasks), ...payload, inquiriesSent: 0 }`. That is the only place a new task id exists → the RAID FK link hooks there.
- All "add task" entry points (`app-header.tsx`, `tasks-section.tsx`, `use-bulk-operations.ts`) call `handleCancelEdit()` before opening. Clearing the pending-link ref in `handleCancelEdit` + `openEditModal` + consuming it in the new-task branch fully closes any stale-ref mis-link.
- `ActionRow` defines a local `SOURCE_LABEL: Record<ActionSource, TranslationKey>` — extracted to a shared module in Task 1 so the pure seed helper can reuse it.
- **Gating:** `open-points` is a core always-on view (not in `feature-modules.ts` MODULES) — there is no "tasks module" to check. Gate the button on `!isPopout` (read-only popout has no editor) + `source !== "task-due"` (the task already exists).
- `SuggestedAction.cta` is a union; only `kind:"open"` carries `id`. RAID actions use `cta:{kind:"open",view:"raid",id:item.id}`.

## Conventions for every task
- Run one test file: `npx vitest run src/app/<file>.test.ts(x)`
- Typecheck (also enforces i18n EN/DE parity): `npx tsc --noEmit`
- DE strings here have NO umlauts (only an em-dash U+2014), but the Edit tool also curls double-quotes in `i18n.de.ts` — after editing it run `npx vitest run src/app/i18n-encoding.test.ts` and grep your lines; fix via a node utf8 write if mangled. EN/DE key sets must stay identical.
- Commit after each task with the message shown. No `Co-Authored-By` trailer.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `action-source-label.ts` | shared source→label map | **new** (extracted from action-row) |
| `action-task-seed.ts` | pure seed builder | **new** `buildTaskSeedFromAction` |
| `action-row.tsx` | row UI | import shared label map; add "Create task" button + `onCreateTask` prop |
| `actions-panel.tsx` | inbox list | thread `onCreateTask` to each row |
| `use-task-submit.ts` | task save | RAID FK link on new-task save; clear pending ref on cancel/edit |
| `task-manager.tsx` | surface wiring | `pendingLinkRaidIdRef`, dispatcher, pass `onCreateTask` (gated on `!isPopout`) |
| `i18n.ts` / `i18n.de.ts` | strings | `actionCreateTask`, `actionCreatedFromNote` |
| `version.ts` / `CHANGELOG.md` | release | 0.84.0 "Cherryh" |

---

### Task 1: Pure seed helper + shared source-label map

**Files:**
- Create: `src/app/action-source-label.ts`
- Create: `src/app/action-task-seed.ts`
- Modify: `src/app/action-row.tsx` (use the shared map)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/action-task-seed.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/app/action-task-seed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTaskSeedFromAction } from "./action-task-seed";
import type { SuggestedAction } from "./next-actions/types";

function raidAction(): SuggestedAction {
  return {
    id: "raid:12:severity", source: "raid",
    title: { key: "actionRaidTitle", params: [12, "DB outage"] },
    why: { key: "actionRaidWhyNoOwner", params: ["High"] },
    score: 30, tier: "now",
    cta: { kind: "open", view: "raid", id: 12 },
  };
}

describe("buildTaskSeedFromAction", () => {
  it("uses the translated action title as the task name", () => {
    const seed = buildTaskSeedFromAction(raidAction(), "en-US");
    expect(seed.taskName).toBe("RAID #12: DB outage");
  });
  it("prepends a From: note with the translated source label and why", () => {
    const seed = buildTaskSeedFromAction(raidAction(), "en-US");
    expect(seed.notes).toBe("From: RAID — Severity High — no owner assigned\n\n");
  });
});
```
(The exact EN strings for `actionRaidTitle` / `actionRaidWhyNoOwner` / `actionSourceRaid` already exist; if the assertion text differs from the real translations, read `i18n.ts` and match the assertion to the real output — do NOT change the translations.)

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/action-task-seed.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3a: Extract the source-label map** — create `src/app/action-source-label.ts`:

```ts
import type { TranslationKey } from "./i18n";
import type { ActionSource } from "./next-actions/types";

/** Source → short i18n label, shared by ActionRow (the chip) and the task-seed
 *  builder (the "From:" note). */
export const ACTION_SOURCE_LABEL: Record<ActionSource, TranslationKey> = {
  "task-due": "actionSourceTask",
  raid: "actionSourceRaid",
  "change-pending": "actionSourceChange",
  milestone: "actionSourceMilestone",
  budget: "actionSourceBudget",
  "stakeholder-comms": "actionSourceComms",
  schedule: "actionSourceSchedule",
  workload: "actionSourceWorkload",
};
```

In `src/app/action-row.tsx`, delete the local `SOURCE_LABEL` const and import the shared map, updating the one reference (`SOURCE_LABEL[action.source]` → `ACTION_SOURCE_LABEL[action.source]`):

```ts
import { ACTION_SOURCE_LABEL } from "./action-source-label";
```

- [ ] **Step 3b: Create the seed helper** — create `src/app/action-task-seed.ts`:

```ts
// src/app/action-task-seed.ts
// Pure builder: turns a SuggestedAction into the prefill for a new task
// (taskName + a "From:" provenance note). No React, no side effects.
import { t, type Lang } from "./i18n";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import type { SuggestedAction } from "./next-actions/types";

export function buildTaskSeedFromAction(
  action: SuggestedAction,
  lang: Lang,
): { taskName: string; notes: string } {
  const taskName = t(lang, action.title.key, ...(action.title.params ?? []));
  const sourceLabel = t(lang, ACTION_SOURCE_LABEL[action.source]);
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
  const notes = t(lang, "actionCreatedFromNote", sourceLabel, why) + "\n\n";
  return { taskName, notes };
}
```

- [ ] **Step 3c: Add the note i18n key** — `src/app/i18n.ts`:

```ts
  actionCreatedFromNote: "From: {0} — {1}",
```
`src/app/i18n.de.ts` (em-dash U+2014; no umlauts):
```ts
  actionCreatedFromNote: "Aus: {0} — {1}",
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/action-task-seed.test.ts src/app/action-row.test.tsx src/app/i18n-encoding.test.ts && npx tsc --noEmit`
Expected: PASS; ActionRow still green after the label-map swap.

- [ ] **Step 5: Commit**

```bash
git add src/app/action-source-label.ts src/app/action-task-seed.ts src/app/action-task-seed.test.ts src/app/action-row.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: pure task-seed builder + shared action source-label map"
```

---

### Task 2: "Create task" button in ActionRow

**Files:**
- Modify: `src/app/action-row.tsx`
- Modify: `src/app/actions-panel.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/action-row.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `src/app/action-row.test.tsx`:

```ts
it("renders Create task for a non-task-due action and calls onCreateTask without opening", () => {
  const onOpen = vi.fn();
  const onCreateTask = vi.fn();
  const action = {
    id: "raid:1:severity", source: "raid",
    title: { key: "actionRaidTitle", params: [1, "X"] },
    why: { key: "actionRaidWhyNoOwner", params: ["High"] },
    score: 30, tier: "now", cta: { kind: "open", view: "raid", id: 1 },
  } as never;
  render(<ActionRow lang="en-US" action={action} onOpen={onOpen} onCreateTask={onCreateTask} />);
  const btn = screen.getByRole("button", { name: /create task/i });
  fireEvent.click(btn);
  expect(onCreateTask).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled(); // stopPropagation
});

it("hides Create task for a task-due action", () => {
  const action = {
    id: "task-due:1:overdue", source: "task-due",
    title: { key: "actionTaskTitle", params: ["X"] },
    why: { key: "actionTaskWhyOverdue", params: [2] },
    score: 40, tier: "now", cta: { kind: "open", view: "open-points", id: 1 },
  } as never;
  render(<ActionRow lang="en-US" action={action} onOpen={() => {}} onCreateTask={() => {}} />);
  expect(screen.queryByRole("button", { name: /create task/i })).toBeNull();
});

it("hides Create task when onCreateTask is not provided", () => {
  const action = {
    id: "raid:1:severity", source: "raid",
    title: { key: "actionRaidTitle", params: [1, "X"] },
    why: { key: "actionRaidWhyNoOwner", params: ["High"] },
    score: 30, tier: "now", cta: { kind: "open", view: "raid", id: 1 },
  } as never;
  render(<ActionRow lang="en-US" action={action} onOpen={() => {}} />);
  expect(screen.queryByRole("button", { name: /create task/i })).toBeNull();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/action-row.test.tsx`
Expected: FAIL — no `onCreateTask` prop / no button.

- [ ] **Step 3: Implement** — in `src/app/action-row.tsx`:

Add to `ActionRowProps`:
```ts
  onCreateTask?: (action: SuggestedAction) => void;
```
Destructure it in the component signature: `({ lang, action, onOpen, onSnooze, onCreateTask })`.

Inside the right-hand controls `<div className="flex shrink-0 items-center gap-1">`, immediately after the `Open` button, add:
```tsx
        {onCreateTask && action.source !== "task-due" && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCreateTask(action); }}
            className="rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
          >
            {t(lang, "actionCreateTask")}
          </button>
        )}
```

In `src/app/actions-panel.tsx`: add `onCreateTask?: (action: SuggestedAction) => void;` to `ActionsPanelProps`, destructure it, and pass it through on the `<ActionRow ... />` (both the monitor list and the now/soon list render the same row — add `onCreateTask={onCreateTask}` to each `<ActionRow>`).

- [ ] **Step 3b: Add the button i18n key** — `src/app/i18n.ts`:
```ts
  actionCreateTask: "Create task",
```
`src/app/i18n.de.ts` (no umlaut):
```ts
  actionCreateTask: "Aufgabe erstellen",
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/action-row.test.tsx src/app/actions-panel.test.tsx src/app/i18n-encoding.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/action-row.tsx src/app/actions-panel.tsx src/app/action-row.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: Create task button on action rows"
```

---

### Task 3: RAID back-link on task save (`use-task-submit.ts`)

**Files:**
- Modify: `src/app/use-task-submit.ts`
- Test: `src/app/use-task-submit.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/app/use-task-submit.test.ts` (reuse the file's existing harness for rendering the hook + a fake submit event; if it lacks one, drive `handleSubmit` with `{ preventDefault(){} } as React.FormEvent<HTMLFormElement>`). The new behavior to pin:

```ts
// Pseudocode shape — adapt to the file's existing setup/util:
it("links a newly created task into the pending RAID item", () => {
  const pendingLinkRaidIdRef = { current: 7 as number | null };
  const raid = [{ id: 7, category: "R", title: "x", status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01" }];
  let nextRaid = raid;
  const setRaid = (fn: (p: typeof raid) => typeof raid) => { nextRaid = typeof fn === "function" ? fn(nextRaid) : fn; };
  // ...render useTaskSubmit with editingId=null, a valid form (taskName set, dueDate valid),
  //    tasks=[], tasksRef={current:[]}, raid, setRaid, pendingLinkRaidIdRef, and the other required args...
  // call handleSubmit(fakeEvent)
  // assert: the created task id is appended to raid item 7's linkedTaskIds,
  //         and pendingLinkRaidIdRef.current is reset to null.
  expect(nextRaid[0].linkedTaskIds).toHaveLength(1);
  expect(pendingLinkRaidIdRef.current).toBeNull();
});

it("does not link when the pending RAID item no longer exists", () => {
  const pendingLinkRaidIdRef = { current: 99 as number | null };
  // raid has no id 99 → setRaid returns prev unchanged; ref cleared; task still created
});

it("clears the pending ref on cancel", () => {
  const pendingLinkRaidIdRef = { current: 5 as number | null };
  // call handleCancelEdit() → pendingLinkRaidIdRef.current === null
});
```
(Match the existing test file's argument-construction helper. The third test asserts cancel clears the ref; the deleted-item test asserts no throw and ref cleared.)

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/use-task-submit.test.ts`
Expected: FAIL — `useTaskSubmit` has no `raid`/`setRaid`/`pendingLinkRaidIdRef` args.

- [ ] **Step 3: Implement** — in `src/app/use-task-submit.ts`:

Add imports/types — extend `UseTaskSubmitArgs`:
```ts
  raid: readonly RaidItem[];
  setRaid: React.Dispatch<React.SetStateAction<readonly RaidItem[]>>;
  pendingLinkRaidIdRef: React.MutableRefObject<number | null>;
```
(`import { type Task, type RaidItem } from "./types";`)

Destructure `raid, setRaid, pendingLinkRaidIdRef` in the hook body.

In the `else` branch (new task), right after `logActivity("task.created", newId, taskName);`, insert:
```ts
        const linkRaidId = pendingLinkRaidIdRef.current;
        pendingLinkRaidIdRef.current = null;
        if (linkRaidId != null) {
          setRaid((prev) =>
            prev.some((r) => r.id === linkRaidId)
              ? prev.map((r) =>
                  r.id === linkRaidId
                    ? {
                        ...r,
                        linkedTaskIds: r.linkedTaskIds.includes(newId)
                          ? r.linkedTaskIds
                          : [...r.linkedTaskIds, newId],
                      }
                    : r,
                )
              : prev,
          );
        }
```
Add `setRaid` and `pendingLinkRaidIdRef` to the `handleSubmit` `useCallback` dependency array (`raid` is not read in the link path — `setRaid`'s functional update sees the latest — so only add what you reference: `setRaid`, `pendingLinkRaidIdRef`).

In `handleCancelEdit`, add as the first line of the callback body:
```ts
    pendingLinkRaidIdRef.current = null;
```
In `openEditModal`, add as the first line of the callback body:
```ts
    pendingLinkRaidIdRef.current = null;
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/use-task-submit.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-task-submit.ts src/app/use-task-submit.test.ts
git commit -m "feat: link a created task back into its source RAID item"
```

---

### Task 4: Wire the dispatcher in `task-manager.tsx`

**Files:**
- Modify: `src/app/task-manager.tsx`
- Test: covered by Tasks 1–3 unit tests + tsc + existing task-manager render tests

- [ ] **Step 1: Implement**

Add imports (near the other next-actions imports ~line 108):
```ts
import { buildTaskSeedFromAction } from "./action-task-seed";
import { emptyForm } from "./task-form-context";
```
(`useRef` is already imported; `SuggestedAction` type is already imported.)

Create the pending-link ref (near the other refs, before the `useTaskSubmit({...})` call ~line 907):
```ts
  const pendingLinkRaidIdRef = useRef<number | null>(null);
```

Pass the three new args into the existing `useTaskSubmit({ ... })` call (raid + setRaid are already in scope from the WorkspaceProvider destructure):
```ts
    raid,
    setRaid,
    pendingLinkRaidIdRef,
```

Add the dispatcher (after `handleCancelEdit`/`openEditModal` are available from the `useTaskSubmit` return, and `lang`/`setForm`/`setTaskModalOpen` are in scope):
```ts
  const handleCreateTaskFromAction = useCallback(
    (action: SuggestedAction) => {
      handleCancelEdit(); // reset editor (clears editingId, form, and the pending ref)
      const seed = buildTaskSeedFromAction(action, lang);
      setForm(() => ({ ...emptyForm(), taskName: seed.taskName, notes: seed.notes }));
      pendingLinkRaidIdRef.current =
        action.source === "raid" && action.cta.kind === "open"
          ? Number(action.cta.id)
          : null;
      setTaskModalOpen(true);
    },
    [handleCancelEdit, lang, setForm, setTaskModalOpen],
  );
```

Pass `onCreateTask` to the `ActionsPanel` render site (find where `ActionsPanel` is rendered with `onOpen`/`onSnooze`; add the prop gated on `!isPopout`):
```tsx
        onCreateTask={isPopout ? undefined : handleCreateTaskFromAction}
```

- [ ] **Step 2: Typecheck + run existing tests**

Run: `npx tsc --noEmit && npx vitest run src/app/actions-panel.test.tsx src/app/use-task-submit.test.ts`
Expected: PASS, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "feat: dispatch Create task into the seeded editor + RAID link"
```

---

### Task 5: Release — 0.84.0 "Cherryh"

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Full suite green first**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all PASS (lint `--max-warnings=0`). If anything fails, STOP — do not mask.

- [ ] **Step 2: Bump `src/app/version.ts`**
- `APP_VERSION = "0.84.0"`
- `APP_BUILD_DATE = "2026-06-14"` (update trailing comment to mention create-task CTA)
- `APP_MILESTONE = "Cherryh"` (new minor line; update the codename JSDoc from 0.83.x "Robinson" to 0.84.x "Cherryh" — C.J. Cherryh)
- Append to `APP_HIGHLIGHT_KEYS` (before `] as const;`):
```ts
  "versionHighlightCreateTask",
```

- [ ] **Step 3: Highlight strings** — `src/app/i18n.ts`:
```ts
  versionHighlightCreateTask: "Turn an Action Center item into a follow-up task in one click — pre-filled from the signal, with RAID items linked back automatically.",
```
`src/app/i18n.de.ts` (real umlaut: Aufgabe none; "verknüpft" has ü; em-dash U+2014):
```ts
  versionHighlightCreateTask: "Aus einem Action-Center-Eintrag mit einem Klick eine Folgeaufgabe erstellen — vorausgefüllt aus dem Signal, RAID-Einträge werden automatisch verknüpft.",
```
Verify DE umlaut (verknüpft → ü `c3 bc`): grep + `npx vitest run src/app/i18n-encoding.test.ts`. Fix via node utf8 write if mangled.

- [ ] **Step 4: CHANGELOG.md** — add a `## [0.84.0] - 2026-06-14 "Cherryh"` entry at the top of the version list (match neighbor format), summarizing: Action Center "Create task" CTA — opens the editor pre-seeded (title + `From:` note) from any signal except task-due; RAID signals link the new task back via `linkedTaskIds`; propose-then-confirm (user edits + saves).

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts`
Expected: PASS.
```bash
git add src/app/version.ts CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts
git commit -m "chore: release create-task CTA (version, changelog, highlight)"
```

---

## Final verification (before finishing the branch)

```bash
npx vitest run         # full unit/integration suite
npx tsc --noEmit       # types + i18n EN/DE parity
npm run lint           # eslint, 0 warnings
npm run build          # next build
```
Then use **superpowers:finishing-a-development-branch**. e2e (incl. 12-view axe gate) runs in CI — the new "Create task" `<button>` must be keyboard-reachable + labelled.

---

## Self-Review

**Spec coverage:**
- Create-task button on rows, gated (task-due/popout) → Tasks 2, 4. ✓ (module gate is vacuous — open-points is core; documented.)
- Open editor pre-seeded (title + From-note in `notes`) → Tasks 1 (seed), 4 (dispatch). ✓
- RAID `linkedTaskIds` link on save, guarded (deleted source, edit-not-create) → Task 3. ✓
- Engine/ActionInput/schema untouched → confirmed (surface-only; no engine task). ✓
- Two i18n keys (`actionCreateTask`, `actionCreatedFromNote`) → Tasks 1, 2. ✓
- Pure `buildTaskSeedFromAction` for testability → Task 1. ✓
- Release → Task 5. ✓

**Type consistency:** `buildTaskSeedFromAction(action, lang) → {taskName, notes}`, `ACTION_SOURCE_LABEL`, `onCreateTask?: (action: SuggestedAction) => void`, `pendingLinkRaidIdRef: MutableRefObject<number|null>` — names used identically across Tasks 1–4. The seed writes to `notes` (the real form field), not `description`.

**Placeholders:** none — Task 3's test is marked as adapt-to-existing-harness (the only non-verbatim test) because the use-task-submit test file's hook-render setup must be reused; the asserted behavior is fully specified.
