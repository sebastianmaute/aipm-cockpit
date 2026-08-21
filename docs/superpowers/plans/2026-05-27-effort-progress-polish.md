# Effort Progress Bar + UI Polish (0.13.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an effort progress bar + field reflow to the task edit modal, move the task-pane row hover from assignee to id/name, and align two budget buttons with existing styles.

**Architecture:** A pure `effortProgress` helper in `duration.ts` drives a small, testable `EffortProgressBar` component (its own file) rendered in the task form. The rest are CSS-class/markup edits to existing components.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-27-effort-progress-polish-design.md`
**Branch:** `feat/0.13.1-effort-progress-polish` (already created off `main`).

**Conventions:** tooltips via `title={t(lang,"key")}`; inline SVG icons; i18n keys added to BOTH `i18n.ts` (EN) and `i18n.de.ts` (DE); immutable updates; no `any`. Run `npx tsc --noEmit`, `npm run lint`, relevant `npx vitest run` after each task.

---

## File Structure

**New files:**
- `src/app/effort-progress-bar.tsx` — `EffortProgressBar` presentational component.
- `src/app/effort-progress-bar.test.tsx` — component tests.

**Modified:**
- `src/app/duration.ts` — add pure `effortProgress` helper.
- `src/app/duration.test.ts` — unit tests for `effortProgress`.
- `src/app/task-form-modal.tsx` — render the bar + reflow Group/estimate/spent.
- `src/app/task-row.tsx` — move hover to id/name; revert assignee to plain.
- `src/app/budget-panel.tsx` — Add-bucket restyle; close/remove hover.
- `src/app/i18n.ts`, `src/app/i18n.de.ts` — new keys.
- `src/app/version.ts`, `CHANGELOG.md`, `docs/CODEMAPS/*` — release.

---

## Task 1: `effortProgress` helper

**Files:** Modify `src/app/duration.ts`; Test `src/app/duration.test.ts`.

- [ ] **Step 1: Add failing tests** (append to `src/app/duration.test.ts`; add `effortProgress` to the existing `import { … } from "./duration"`)

```ts
describe("effortProgress", () => {
  test("no estimate (undefined or 0) → hasEstimate false, pct 0, not over", () => {
    expect(effortProgress(undefined, 120)).toEqual({ hasEstimate: false, pct: 0, over: false });
    expect(effortProgress(0, 120)).toEqual({ hasEstimate: false, pct: 0, over: false });
  });
  test("partial: spent below estimate", () => {
    expect(effortProgress(480, 120)).toEqual({ hasEstimate: true, pct: 0.25, over: false });
  });
  test("spent unset with estimate set → pct 0", () => {
    expect(effortProgress(480, undefined)).toEqual({ hasEstimate: true, pct: 0, over: false });
  });
  test("exactly equal → pct 1, not over", () => {
    expect(effortProgress(480, 480)).toEqual({ hasEstimate: true, pct: 1, over: false });
  });
  test("overrun → pct > 1, over true", () => {
    const r = effortProgress(480, 600);
    expect(r.hasEstimate).toBe(true);
    expect(r.over).toBe(true);
    expect(r.pct).toBeCloseTo(1.25, 5);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run src/app/duration.test.ts` → FAIL (`effortProgress` not exported).

- [ ] **Step 3: Implement** (append to `src/app/duration.ts`)

```ts
export interface EffortProgress {
  hasEstimate: boolean;
  pct: number;
  over: boolean;
}

/** Time-spent consumption of an estimate (both in minutes). pct is unclamped. */
export function effortProgress(estimateMin?: number, spentMin?: number): EffortProgress {
  const estimate = estimateMin ?? 0;
  const spent = spentMin ?? 0;
  if (estimate <= 0) return { hasEstimate: false, pct: 0, over: false };
  const pct = spent / estimate;
  return { hasEstimate: true, pct, over: pct > 1 };
}
```

- [ ] **Step 4: Run, confirm PASS** — `npx vitest run src/app/duration.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/app/duration.ts src/app/duration.test.ts
git commit -m "feat(tasks): effortProgress helper (spent vs estimate ratio)"
```

---

## Task 2: `EffortProgressBar` component + i18n

**Files:** Create `src/app/effort-progress-bar.tsx`, `src/app/effort-progress-bar.test.tsx`; Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: i18n keys** — add to BOTH dictionaries (German translated):
  - `i18n.ts`: `taskEffortProgressLabel: "Time spent vs. original estimate",` and `taskEffortNoEstimate: "No estimate set",`
  - `i18n.de.ts`: `taskEffortProgressLabel: "Aufgewandte Zeit gegenüber ursprünglicher Schätzung",` and `taskEffortNoEstimate: "Keine Schätzung gesetzt",`

- [ ] **Step 2: Write the component** (`src/app/effort-progress-bar.tsx`)

```tsx
"use client";

import { type Lang, t } from "./i18n";
import { effortProgress, formatDuration } from "./duration";

interface EffortProgressBarProps {
  lang: Lang;
  estimateMin?: number;
  spentMin?: number;
}

/** Display-only bar: time spent consumption of the original estimate. */
export function EffortProgressBar({ lang, estimateMin, spentMin }: EffortProgressBarProps) {
  const { hasEstimate, pct, over } = effortProgress(estimateMin, spentMin);
  const fillPct = Math.min(pct, 1) * 100;
  const labelPct = Math.round(pct * 100);
  return (
    <div className="sm:col-span-2">
      <div
        role="progressbar"
        aria-label={t(lang, "taskEffortProgressLabel")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={hasEstimate ? Math.min(labelPct, 100) : 0}
        className={`h-2.5 w-full overflow-hidden rounded-full ${
          hasEstimate ? "bg-zinc-200 dark:bg-zinc-800" : "bg-zinc-100 opacity-60 dark:bg-zinc-800/50"
        }`}
      >
        {hasEstimate && (
          <div
            className={`h-full rounded-full transition-all ${over ? "bg-AIPM-pink" : "bg-AIPM-dark-blue"}`}
            style={{ width: `${fillPct}%` }}
          />
        )}
      </div>
      <p className={`mt-1 text-xs ${over ? "text-AIPM-pink" : "text-AIPM-medium-grey"}`}>
        {hasEstimate
          ? `${formatDuration(spentMin ?? 0) || "0m"} / ${formatDuration(estimateMin ?? 0)} · ${labelPct}%`
          : t(lang, "taskEffortNoEstimate")}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Write the component tests** (`src/app/effort-progress-bar.test.tsx`)

```tsx
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { EffortProgressBar } from "./effort-progress-bar";

describe("EffortProgressBar", () => {
  test("no estimate → disabled state with hint, aria-valuenow 0", () => {
    render(<EffortProgressBar lang="en-US" estimateMin={undefined} spentMin={120} />);
    expect(screen.getByText(/no estimate set/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
  test("partial → percent label and aria-valuenow", () => {
    render(<EffortProgressBar lang="en-US" estimateMin={480} spentMin={120} />); // 25%
    expect(screen.getByText(/· 25%/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });
  test("overrun → shows >100% label, aria-valuenow capped at 100", () => {
    render(<EffortProgressBar lang="en-US" estimateMin={480} spentMin={600} />); // 125%
    expect(screen.getByText(/· 125%/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});
```

- [ ] **Step 4: Run** — `npx vitest run src/app/effort-progress-bar.test.tsx` (PASS), `npx tsc --noEmit` (0).

- [ ] **Step 5: Commit**

```bash
git add src/app/effort-progress-bar.tsx src/app/effort-progress-bar.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(tasks): EffortProgressBar component (over-budget aware) + i18n"
```

---

## Task 3: Integrate bar + reflow the task form

**Files:** Modify `src/app/task-form-modal.tsx`.

Current field order (around lines 301–350): `Last Update Date` (301–310), `EffortField` Original estimate (312–320), `EffortField` Time spent (322–330), `Group` (332–341), `Labels` (343–350).

- [ ] **Step 1: Import the bar** — add `import { EffortProgressBar } from "./effort-progress-bar";` near the other imports.

- [ ] **Step 2: Move the `Group` field up** — cut the entire `<Field label={t(lang, "group")}> … </Field>` block (the `ComboInput`, lines ~332–341) and paste it IMMEDIATELY AFTER the `Last Update Date` `<Field>` block (after line ~310) and BEFORE the first `EffortField`.

- [ ] **Step 3: Add the bar after the two EffortFields** — immediately after the second `EffortField` (Time spent, ends ~line 330) insert:

```tsx
          <EffortProgressBar
            lang={lang}
            estimateMin={form.originalEstimateMinutes}
            spentMin={form.timeSpentMinutes}
          />
```

Resulting order: `Last Update Date | Group`, `Original estimate | Time spent`, `EffortProgressBar (col-span-2)`, `Labels …`.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint` (clean); `npx vitest run src/app/task-form` (existing tests pass). Manually: editing a task with estimate "1w" + spent "3d" shows a partially-filled blue bar; spent "2w" shows a full red bar at "200%"; no estimate shows the greyed hint.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-form-modal.tsx
git commit -m "feat(tasks): effort progress bar + group/estimate/spent reflow in task form"
```

---

## Task 4: Move task-row hover to id + name; revert assignee

**Files:** Modify `src/app/task-row.tsx`.

The directory-assignee highlight hover string is:
`rounded-md border border-transparent px-2 py-0.5 hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800`.

- [ ] **Step 1: ID button** (the `#id` edit button, ~line 185) — change its className from
`cursor-pointer rounded font-mono text-zinc-500 hover:text-AIPM-dark-blue hover:underline`
to:
`cursor-pointer rounded-md border border-transparent px-2 py-0.5 font-mono text-zinc-500 hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800`
(keep `onClick`, `title`, `aria-label`, and the `#{task.id}` content).

- [ ] **Step 2: Task-name button** (~line 218) — change its className from
`cursor-pointer text-left font-medium hover:text-AIPM-dark-blue hover:underline`
to:
`cursor-pointer rounded-md border border-transparent px-2 py-0.5 text-left font-medium hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800`
(keep `onClick`, `title`, and `{task.taskName}` content).

- [ ] **Step 3: Revert assignee cell** (~lines 238–246) — replace the conditional highlight `<span>` with plain text:

```tsx
      {!hiddenCols.has("assignee") && (
        <Td title={`${t(lang, "assignee")}: ${task.assignee || "—"}`}>
          {task.assignee || "—"}
        </Td>
      )}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint`; `npx vitest run src/app/task-row` (existing tests pass — assignee text still rendered; if a test queried the assignee highlight `<span>` specifically, update it to the plain text while keeping the behavioral assertion).

- [ ] **Step 5: Commit**

```bash
git add src/app/task-row.tsx
git commit -m "feat(ui): task row highlight hover on id+name; plain assignee cell"
```

---

## Task 5: Budget buttons (Add-bucket restyle + close/remove hover)

**Files:** Modify `src/app/budget-panel.tsx`.

- [ ] **Step 1: Add-bucket button** (~lines 129–135) — change its markup to match the task-pane Add-task button and prefix the label with `+ `:

```tsx
        <button
          type="button"
          onClick={addBucket}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
        >
          + {t(lang, "budgetAddBucket")}
        </button>
```

- [ ] **Step 2: Close/reopen button** (~lines 280–288) — change its className from
`text-xs text-zinc-500 hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey`
to:
`rounded-md border border-transparent px-2 py-0.5 text-xs text-zinc-500 hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800`
(keep `onClick` and the `budgetClose`/`budgetReopen` label).

- [ ] **Step 3: Remove button** (~lines 289–296) — change its className from
`text-xs text-zinc-500 hover:text-AIPM-pink dark:hover:text-AIPM-pink`
to:
`rounded-md border border-transparent px-2 py-0.5 text-xs text-zinc-500 hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800`
(keep `onClick={() => removeBucket(bucket.id)}`, the `title`, and the label; the `window.confirm` guard stays in `removeBucket`).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint`; `npx vitest run src/app/budget-panel` (existing tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/app/budget-panel.tsx
git commit -m "feat(budget): Add-bucket matches Add-task; close/remove use assignee hover"
```

---

## Task 6: Release 0.13.1

**Files:** Modify `src/app/version.ts`, `CHANGELOG.md`, `docs/CODEMAPS/data.md`, `docs/CODEMAPS/frontend.md`.

- [ ] **Step 1: Version** — in `version.ts` set `APP_VERSION = "0.13.1"`, build date `2026-05-27` (keep the "Bradbury" codename — patch release). Read the file first: if its pattern requires one highlight key per release, add `versionHighlightEffortBar` to `APP_HIGHLIGHT_KEYS` and define it in both i18n dicts; otherwise leave `APP_HIGHLIGHT_KEYS` unchanged for a patch.

- [ ] **Step 2: CHANGELOG** — add a `## [0.13.1] — 2026-05-27` section: effort progress bar in the task editor (over-budget aware) + form reflow (group beside last-update; estimate/spent paired); task-row hover moved to id/name (assignee plain); budget Add-bucket restyled to match Add-task; budget close/remove buttons use the assignee hover.

- [ ] **Step 3: Codemaps** — `data.md`: note `effortProgress` added to `duration.ts`. `frontend.md`: add `effort-progress-bar.tsx` (`EffortProgressBar`).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint`; `npm run test:coverage` (green, ≥70%).

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts CHANGELOG.md docs/CODEMAPS
git commit -m "docs(release): 0.13.1 — effort progress bar + UI polish"
```

---

## Final review

Dispatch a final code reviewer over `git diff main...HEAD`; confirm gates (lint, tsc, test:coverage) green; then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:** Item 1 (bar) → T1+T2+T3; item 2 (reflow) → T3; item 3 (hover move) → T4; item 4 (Add-bucket) → T5; item 5 (close/remove hover) → T5; i18n → T2; release → T6. All covered.

**Placeholder scan:** All code blocks concrete. T6 Step 1 conditionally instructs the implementer to confirm whether `version.ts` requires a per-release highlight key (read the file) rather than guessing — flagged, not vague.

**Type consistency:** `effortProgress(estimateMin?, spentMin?): EffortProgress` defined in T1 and consumed in T2's `EffortProgressBar`; `formatDuration` (existing) used in T2; `EffortProgressBar` prop names (`lang`, `estimateMin`, `spentMin`) consistent between T2 (definition) and T3 (usage with `form.originalEstimateMinutes`/`form.timeSpentMinutes`).
