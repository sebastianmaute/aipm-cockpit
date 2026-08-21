# Action Center Slice 3 — New Signal Providers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a `task-attention` provider surfacing unassigned / stale / blocked / dependency-blocked tasks as ranked Action Center signals.

**Architecture:** One pure provider (`next-actions/providers/task-attention.ts`, no moduleId, mirrors `taskDueProvider`) reading `input.tasks` + `input.today`; a new `ActionSource` member with its two exhaustive maps; 5 i18n keys; registered in `ALL_PROVIDERS`. Engine-only — no layout/CTA/task-manager change. Branch `feat-action-center-slice3` off `feat-action-center-slice2`.

**Tech Stack:** Forked Next.js 16 / React 19 / TS / Vitest. `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`), `npm run test:run`.

**Spec:** `docs/superpowers/specs/2026-06-29-action-center-slice3-providers-design.md`

---

## File Structure
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — 5 keys.
- **Modify** `src/app/next-actions/types.ts` — add `"task-attention"` to `ActionSource`.
- **Modify** `src/app/action-source-label.ts` + `src/app/action-source-icon.tsx` — new source entry.
- **Create** `src/app/next-actions/providers/task-attention.ts` + `.test.ts`.
- **Modify** `src/app/next-actions/index.ts` — register provider.

---

## Task 1: i18n — 5 keys (EN + DE)

**Files:** `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: EN keys**

In `src/app/i18n.ts`, find `actionSourceCommittee: "Steering committee",` and add immediately after it:
```ts
  actionSourceAttention: "Attention",
  actionTaskWhyUnassigned: "No owner assigned",
  actionTaskWhyStale: "No update in {0} days",
  actionTaskWhyBlocked: "Blocked: {0}",
  actionTaskWhyDepBlocked: "Waiting on {0}",
```

- [ ] **Step 2: DE keys via node utf8 write (NOT the Edit tool)**

Anchor (verified): `  actionSourceCommittee: "Lenkungsausschuss",`. Run from repo root:
```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  actionSourceCommittee: \"Lenkungsausschuss\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
const add =
  "  actionSourceAttention: \"Handlungsbedarf\",\r\n" +
  "  actionTaskWhyUnassigned: \"Kein Verantwortlicher zugewiesen\",\r\n" +
  "  actionTaskWhyStale: \"Seit {0} Tagen keine Aktualisierung\",\r\n" +
  "  actionTaskWhyBlocked: \"Blockiert: {0}\",\r\n" +
  "  actionTaskWhyDepBlocked: \"Wartet auf {0}\",\r\n";
s = s.replace(anchor, anchor + add);
fs.writeFileSync(p, s, "utf8");
console.log("DE keys added");
'
```
Expected: `DE keys added`. If `ANCHOR NOT FOUND`, STOP and report.

- [ ] **Step 3: Verify + commit**

`npm run test:run -- src/app/i18n-encoding` → PASS. `npx tsc --noEmit` → clean (EN/DE parity).
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): add task-attention source + why keys (EN/DE)"
```
No push, no attribution trailers.

---

## Task 2: ActionSource `task-attention` + maps

**Files:** `src/app/next-actions/types.ts`, `src/app/action-source-label.ts`, `src/app/action-source-icon.tsx`

- [ ] **Step 1: Extend the union**

In `src/app/next-actions/types.ts`, the `ActionSource` union currently ends `| "schedule" | "workload" | "committee";`. Add `| "task-attention"`:
```ts
export type ActionSource =
  | "task-due" | "raid" | "change-pending" | "milestone" | "budget" | "stakeholder-comms"
  | "schedule" | "workload" | "committee" | "task-attention";
```

- [ ] **Step 2: Run tsc to surface the exhaustive maps that now error**

`npx tsc --noEmit`
Expected: errors in `action-source-label.ts` and `action-source-icon.tsx` (missing `"task-attention"` key). If any OTHER file errors with a missing `"task-attention"` Record key, it's another exhaustive source-map — extend it the same way and note it in your report. (None expected beyond these two.)

- [ ] **Step 3: Label map**

In `src/app/action-source-label.ts`, add to the `ACTION_SOURCE_LABEL` record (after `committee`):
```ts
  "task-attention": "actionSourceAttention",
```

- [ ] **Step 4: Icon map (bell glyph)**

In `src/app/action-source-icon.tsx`, add to `ACTION_SOURCE_ICON` (after `committee`):
```tsx
  // task-attention: bell
  "task-attention": (
    <svg aria-hidden viewBox="0 0 16 16" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5c0 3-1.5 4-1.5 4h10s-1.5-1-1.5-4A3.5 3.5 0 0 0 8 2.5z" strokeLinejoin="round" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" strokeLinecap="round" />
    </svg>
  ),
```

- [ ] **Step 5: Verify + commit**

`npx tsc --noEmit && npm run lint` → clean.
```bash
git add src/app/next-actions/types.ts src/app/action-source-label.ts src/app/action-source-icon.tsx
git commit -m "feat(next-actions): add task-attention ActionSource + label/icon"
```

---

## Task 3: `task-attention` provider + tests + registration

**Files:** Create `src/app/next-actions/providers/task-attention.ts` + `src/app/next-actions/providers/task-attention.test.ts`; modify `src/app/next-actions/index.ts`.

- [ ] **Step 1: Write the failing test**

First INSPECT an existing provider test (e.g. `src/app/next-actions/providers/task-due.test.ts` or `raid.test.ts`) to copy its `ActionInput` construction helper — `ActionInput` has many required fields (raid, changes, milestones, stakeholders, commsReminders, dashboard, features, today, projectName, now, reminderLeadDays, dueSoonWorkdays, raidReviewIntervalDays, dismissed, …). Reuse that scaffold; only `tasks` + `today` matter here. Build tasks with the `Task` shape (required fields incl. `assignee`, `assigneeEmail`, `dueDate`, `lastUpdateDate`, `priority`, `status`, `blockers`, `notes`).

Create `src/app/next-actions/providers/task-attention.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { taskAttentionProvider } from "./task-attention";
import type { ActionInput } from "../types";
import type { Task } from "../../types";

// Minimal active task; override per case.
function mkTask(over: Partial<Task>): Task {
  return {
    id: 1, taskName: "T", assignee: "Alice", assigneeEmail: "a@x.io",
    dueDate: "2026-07-01", lastUpdateDate: "2026-06-28", priority: "Medium",
    status: "In Progress", blockers: "", notes: "",
    ...over,
  } as Task;
}

// Build a minimal ActionInput. MIRROR the scaffold used by task-due.test.ts /
// the other provider tests (copy their helper) — only tasks + today are read here.
function mkInput(tasks: Task[], today = "2026-06-28"): ActionInput {
  return {
    tasks, raid: [], changes: [], milestones: [], stakeholders: [],
    commsReminders: [], dashboard: {} as never, features: [],
    today, projectName: "P", now: new Date("2026-06-28T00:00:00Z"),
    reminderLeadDays: 3, dueSoonWorkdays: 3, raidReviewIntervalDays: 30,
    dismissed: new Set<string>(),
  } as ActionInput;
}

const ids = (tasks: Task[], today?: string) =>
  taskAttentionProvider.provide(mkInput(tasks, today)).map((a) => a.id);

describe("taskAttentionProvider", () => {
  it("flags an unassigned active task (blank assignee + no resourceId)", () => {
    expect(ids([mkTask({ assignee: "  ", resourceId: undefined })]))
      .toContain("task-attention:1:unassigned");
  });
  it("does not flag unassigned when an assignee or resourceId is present", () => {
    expect(ids([mkTask({ assignee: "Alice" })])).not.toContain("task-attention:1:unassigned");
    expect(ids([mkTask({ assignee: "", resourceId: 7 })])).not.toContain("task-attention:1:unassigned");
  });
  it("ignores finished tasks entirely", () => {
    expect(ids([mkTask({ assignee: "", status: "Done", completedDate: "2026-06-01" })])).toHaveLength(0);
    expect(ids([mkTask({ assignee: "", status: "Cancelled" })])).toHaveLength(0);
  });
  it("flags a stale task (no update in >=14 days) with the day count", () => {
    const out = taskAttentionProvider.provide(mkInput([mkTask({ lastUpdateDate: "2026-06-01" })], "2026-06-28"));
    const stale = out.find((a) => a.id === "task-attention:1:stale");
    expect(stale).toBeTruthy();
    expect(stale!.why.params?.[0]).toBe(27);
  });
  it("does not flag a recently-updated task", () => {
    expect(ids([mkTask({ lastUpdateDate: "2026-06-25" })], "2026-06-28"))
      .not.toContain("task-attention:1:stale");
  });
  it("does not crash on an unparseable lastUpdateDate", () => {
    expect(() => ids([mkTask({ lastUpdateDate: "not-a-date" })])).not.toThrow();
    expect(ids([mkTask({ lastUpdateDate: "not-a-date" })])).not.toContain("task-attention:1:stale");
  });
  it("flags a blocked task", () => {
    expect(ids([mkTask({ blockers: "waiting on legal" })])).toContain("task-attention:1:blocked");
  });
  it("flags a dependency-blocked task when the predecessor is not Done", () => {
    const pred = mkTask({ id: 2, taskName: "Predecessor", status: "In Progress" });
    const dependent = mkTask({ id: 1, dependencies: [{ taskId: 2, type: "FS" }] });
    const out = taskAttentionProvider.provide(mkInput([pred, dependent]));
    const dep = out.find((a) => a.id === "task-attention:1:dep");
    expect(dep).toBeTruthy();
    expect(dep!.why.params?.[0]).toBe("Predecessor");
  });
  it("does not flag dependency-blocked when the predecessor is Done", () => {
    const pred = mkTask({ id: 2, status: "Done", completedDate: "2026-06-01" });
    const dependent = mkTask({ id: 1, dependencies: [{ taskId: 2, type: "FS" }] });
    expect(ids([pred, dependent])).not.toContain("task-attention:1:dep");
  });
  it("emits multiple actions for one task, same cta entity (grouping-friendly)", () => {
    const out = taskAttentionProvider.provide(mkInput([mkTask({ assignee: "", blockers: "x" })]));
    const mine = out.filter((a) => a.cta.kind === "open" && a.cta.view === "open-points" && a.cta.id === 1);
    expect(mine.length).toBeGreaterThanOrEqual(2);
  });
});
```
If the `ActionInput` cast above (`as ActionInput` / `dashboard: {} as never`) fails tsc because the real test scaffold differs, replace `mkInput` with the exact helper the sibling provider tests use. Run `npx tsc --noEmit` on the test too.

- [ ] **Step 2: Run → FAIL**

`npm run test:run -- src/app/next-actions/providers/task-attention.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the provider**

Create `src/app/next-actions/providers/task-attention.ts`:
```ts
// src/app/next-actions/providers/task-attention.ts
import { isTaskFinished } from "../../task-status";
import { scoreAction, bandTier, stalenessScore, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";
import type { Task } from "../../types";

const W = ACTION_WEIGHTS;
const STALE_DAYS = 14;

/** Whole-day gap between two YYYY-MM-DD dates; NaN if either is unparseable. */
function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO);
  const b = Date.parse(bISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.floor((b - a) / 86_400_000);
}

/** Surfaces active tasks that cannot progress: no owner, gone stale, explicitly
 *  blocked, or waiting on an unfinished predecessor. Pure; core (no moduleId). */
export const taskAttentionProvider: ActionProvider = {
  provide(input: ActionInput): SuggestedAction[] {
    const cl = input.clarityBonus ?? W.clarityBonus;
    const sc = input.semiClarityBonus ?? W.semiClarityBonus;
    const byId = new Map<number, Task>(input.tasks.map((t) => [t.id, t]));
    const out: SuggestedAction[] = [];
    for (const task of input.tasks) {
      if (isTaskFinished(task)) continue;
      const base = {
        source: "task-attention" as const,
        title: { key: "actionTaskTitle" as const, params: [task.taskName] },
        cta: { kind: "open" as const, view: "open-points" as const, id: task.id },
      };
      if (task.assignee.trim() === "" && task.resourceId == null) {
        const score = scoreAction({ risk: W.riskHigh, clarity: cl });
        out.push({ ...base, id: `task-attention:${task.id}:unassigned`,
          why: { key: "actionTaskWhyUnassigned" }, score, tier: bandTier(score) });
      }
      const days = daysBetween(task.lastUpdateDate, input.today);
      if (Number.isFinite(days) && days >= STALE_DAYS) {
        const score = scoreAction({ staleness: stalenessScore(days), semiClarity: sc });
        out.push({ ...base, id: `task-attention:${task.id}:stale`,
          why: { key: "actionTaskWhyStale", params: [days] }, score, tier: bandTier(score) });
      }
      if (task.blockers.trim() !== "") {
        const score = scoreAction({ risk: W.riskHigh, clarity: cl });
        out.push({ ...base, id: `task-attention:${task.id}:blocked`,
          why: { key: "actionTaskWhyBlocked", params: [task.blockers.trim()] }, score, tier: bandTier(score) });
      }
      const dep = (task.dependencies ?? []).find((d) => {
        const pred = byId.get(d.taskId);
        return pred != null && !isTaskFinished(pred);
      });
      if (dep) {
        const pred = byId.get(dep.taskId)!;
        const score = scoreAction({ impact: W.impactBlocksMilestone, clarity: cl });
        out.push({ ...base, id: `task-attention:${task.id}:dep`,
          why: { key: "actionTaskWhyDepBlocked", params: [pred.taskName] }, score, tier: bandTier(score) });
      }
    }
    return out;
  },
};
```

- [ ] **Step 4: Register in `index.ts`**

In `src/app/next-actions/index.ts`, add the import next to the other providers:
```ts
import { taskAttentionProvider } from "./providers/task-attention";
```
and append it to the `ALL_PROVIDERS` array (after `committeeInfoProvider`):
```ts
  committeeInfoProvider,
  taskAttentionProvider,
];
```

- [ ] **Step 5: Run → PASS**

`npm run test:run -- src/app/next-actions/providers/task-attention.test.ts` → PASS.

- [ ] **Step 6: Typecheck + lint + commit**

`npx tsc --noEmit && npm run lint` → clean.
```bash
git add src/app/next-actions/providers/task-attention.ts src/app/next-actions/providers/task-attention.test.ts src/app/next-actions/index.ts
git commit -m "feat(next-actions): task-attention provider (unassigned/stale/blocked/dep-blocked)"
```

---

## Task 4: Full-suite verification

- [ ] **Step 1: Full suite** — `npm run test:run` → all green. If the engine `index.test.ts` (or a snapshot of provider count) asserts the provider list/count, update it to include `taskAttentionProvider` (legit new provider).
- [ ] **Step 2: Typecheck + lint (final)** — `npx tsc --noEmit && npm run lint` → clean.
- [ ] **Step 3: Footprint** — `git diff --stat feat-action-center-slice2..HEAD` → only: i18n.ts, i18n.de.ts, types.ts (next-actions), action-source-label.ts, action-source-icon.tsx, providers/task-attention.ts(+test), next-actions/index.ts. No other files, no console.log.

---

## Out of scope / notes
- Always-on (no settings toggle — deferred). Noise bounded by slice-1 grouping + tier cap + monitor-collapse.
- Jira-synced tasks not special-cased (staleness by `lastUpdateDate`).
- No new CTAs (inline "Assign owner" on these rows is slice 4).
- No release/push/MR — only on the explicit "release" trigger.
