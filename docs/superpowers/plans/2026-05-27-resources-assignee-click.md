# Resources Assignee Click-to-Edit (0.14.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the assignee name clickable in the resources **planning** and **calendar** grids — matched names open the resource edit modal, unmatched calendar names open Add Resource prefilled — using the workload tab's existing hover-button style.

**Architecture:** Reuse the workload tab's name-button pattern. The planning grid row is already a `Resource`, so it calls the existing `onEditResource` prop directly. The calendar aggregates assignees by case-folded name, so it gains three props (`resources`, `onEditResource`, `onAddResource`), builds a `name → Resource` lookup with `useMemo`, and resolves each row to either edit (matched) or add-prefilled (unmatched via `splitName`).

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest + Testing Library. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-27-resources-assignee-click-design.md`
**Branch:** `feat/0.14.3-resources-assignee-click` (already created off `main`).

**Conventions:** immutable; no `any`; reuse the existing shared button class verbatim (do NOT invent new colors — that is the later D+E sub-project). Run `npx tsc --noEmit`, `npm run lint`, and the relevant `npx vitest run` after each task. Each task leaves the build green.

> **Heads-up for every implementer subagent:** this repo has a fact-forcing gate hook. Before your FIRST shell command, print 2 facts (the task you were given + what the command does). Before EVERY Write/Edit, print 4 facts (importers via Grep, public functions/props affected, data fields, the task instruction verbatim) AND run the importer Grep in the same turn. Then retry the same operation. Also: `src/app/sample-workspace.md` can be dirtied by test runs — `git restore` it before any commit if it shows up in `git status`.

---

## Task 1: Planning grid — clickable resource name

**Files:**
- Modify: `src/app/resources-panel.tsx` (the planning grid name cell, ~line 371)
- Test: `src/app/resources-panel.test.tsx`

The planning grid renders one row per `Resource` (`resources.map((r) => ...)`). The name cell is currently plain text: `<td className="px-2 py-1 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{resourceDisplayName(r)}</td>`. `onEditResource: (resource: Resource) => void` is already a prop of `ResourcesPanel` (no new prop needed).

- [ ] **Step 1: Write the failing test** — append to the `describe("ResourcesPanel", ...)` block in `src/app/resources-panel.test.tsx`:

```tsx
  test("planning view: clicking a resource name calls onEditResource", () => {
    const onEditResource = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} resources={resources} plan={plan} workdayHours={8}
      onEditResource={onEditResource} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEditResource).toHaveBeenCalledWith(resources[0]);
  });
```

Rationale: switching to the Planning view unmounts the Directory table, so `getByRole("button", { name: "Alex Example" })` resolves uniquely to the planning name button. The per-period utilization inputs have aria-labels like `"Utilization for Alex Example in 2026-02"`, which do not match the exact accessible name `"Alex Example"`.

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/app/resources-panel.test.tsx -t "clicking a resource name"`. Expected: FAIL — `getByRole("button", { name: "Alex Example" })` finds nothing (the name is plain text, not a button) in the planning view.

- [ ] **Step 3: Implement** — in `src/app/resources-panel.tsx`, find the planning grid's per-resource name cell (inside `const rowsJsx = resources.map((r) => { ... return ( <tr key={r.id}> ...`):

Replace:
```tsx
                      <td className="px-2 py-1 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{resourceDisplayName(r)}</td>
```
With:
```tsx
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          onClick={() => onEditResource(r)}
                          title={resourceDisplayName(r)}
                          className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-dark-blue dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
                        >
                          {resourceDisplayName(r)}
                        </button>
                      </td>
```

Leave the rollup table's name cells (the `showRollup` block, ~line 453) as plain text — the rollup is a read-only secondary table and is out of scope.

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/app/resources-panel.test.tsx`. Expected: PASS (the new test plus all existing ResourcesPanel tests stay green).

- [ ] **Step 5: Verify gates** — `npx tsc --noEmit` (0 errors); `npm run lint` (0 errors).

- [ ] **Step 6: Commit**
```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx
git commit -m "feat(resources): clickable resource name in the planning grid (opens edit modal)"
```

---

## Task 2: Calendar — clickable assignee name (edit matched, add unmatched)

**Files:**
- Modify: `src/app/resource-calendar.tsx` (Props + name cell, ~line 187–195)
- Modify: `src/app/resources-panel.tsx` (forward 3 props into `<ResourceCalendar>`, ~line 499)
- Test: `src/app/resource-calendar.test.tsx` (NEW file — no calendar test exists yet)

The calendar renders rows from its `rows: readonly CalendarAssignee[]` prop (`CalendarAssignee = { key: string; display: string; email: string }`), keyed by case-folded name. It does NOT currently receive `resources`, `onEditResource`, or `onAddResource`.

- [ ] **Step 1: Write the failing test** — create `src/app/resource-calendar.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourceCalendar } from "./resource-calendar";
import type { Resource } from "./types";

const Sample: Resource = { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} };

const baseProps = {
  lang: "en-US" as const,
  absences: [] as never[],
  today: "2026-05-27",
  holidaySet: new Set<string>(),
  onAddAbsence: () => {},
  onEditAbsence: () => {},
  onEditResource: () => {},
  onAddResource: () => {},
};

describe("ResourceCalendar assignee click", () => {
  test("matched name opens the edit modal with that resource", () => {
    const onEditResource = vi.fn();
    render(
      <ResourceCalendar
        {...baseProps}
        rows={[{ key: "Alex Example", display: "Alex Example", email: "" }]}
        resources={[Sample]}
        onEditResource={onEditResource}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEditResource).toHaveBeenCalledWith(Sample);
  });

  test("unmatched name opens Add Resource prefilled from the display name", () => {
    const onAddResource = vi.fn();
    render(
      <ResourceCalendar
        {...baseProps}
        rows={[{ key: "tom external", display: "Tom External", email: "tom@x.io" }]}
        resources={[]}
        onAddResource={onAddResource}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tom External" }));
    expect(onAddResource).toHaveBeenCalledWith({ firstName: "Tom", lastName: "External", email: "tom@x.io" });
  });
});
```

Rationale: the name button's accessible name is exactly the display string (`"Alex Example"`). The per-day cell buttons have accessible names like `"Alex Example — 2026-05-27"` (the tooltip text), which do NOT match the exact name `"Alex Example"`, so the query resolves uniquely to the name button.

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/app/resource-calendar.test.tsx`. Expected: FAIL — TypeScript/runtime error or no matching button, because `resources`/`onEditResource`/`onAddResource` are not yet props and the name is plain text.

- [ ] **Step 3: Add the imports + props** — in `src/app/resource-calendar.tsx`:

`useMemo` is already imported (`import { memo, useMemo } from "react";`) — confirm and leave it. The current type import line is:
```tsx
import type { Absence, AbsenceType } from "./types";
```
Replace with:
```tsx
import type { Absence, AbsenceType, Resource } from "./types";
import { resourceDisplayName, splitName } from "./resource-foundation";
```

Extend the `Props` interface (add three members):
```tsx
interface Props {
  lang: Lang;
  rows: readonly CalendarAssignee[];
  absences: readonly Absence[];
  today: string;
  holidaySet: ReadonlySet<string>;
  onAddAbsence: (seed?: Partial<Absence>) => void;
  onEditAbsence: (absence: Absence) => void;
  resources: readonly Resource[];
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed: Partial<Resource>) => void;
}
```

Add the three params to the `ResourceCalendarInner({ ... })` destructure (alongside `onAddAbsence`, `onEditAbsence`): `resources`, `onEditResource`, `onAddResource`.

- [ ] **Step 4: Build the lookup + clickable name cell** — inside `ResourceCalendarInner`, after the existing `absencesByKey` `useMemo`, add:
```tsx
  // Case-folded display-name → Resource, matching how CalendarAssignee.key is
  // built upstream (assignee.trim().toLowerCase()). Last-wins on name collision.
  const resourceByKey = useMemo<Map<string, Resource>>(() => {
    const m = new Map<string, Resource>();
    for (const r of resources) m.set(resourceDisplayName(r).trim().toLowerCase(), r);
    return m;
  }, [resources]);
```

Then replace the row-label cell (currently):
```tsx
                  <td
                    className="sticky left-0 z-10 border-b border-r border-zinc-200 bg-white px-3 py-2 font-medium text-AIPM-dark-grey dark:border-zinc-800 dark:bg-zinc-950 dark:text-AIPM-light-grey"
                    style={{
                      minWidth: ASSIGNEE_COL_PX,
                      width: ASSIGNEE_COL_PX,
                    }}
                  >
                    {row.display}
                  </td>
```
With:
```tsx
                  <td
                    className="sticky left-0 z-10 border-b border-r border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950"
                    style={{
                      minWidth: ASSIGNEE_COL_PX,
                      width: ASSIGNEE_COL_PX,
                    }}
                  >
                    {(() => {
                      const res = resourceByKey.get(row.key);
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            res
                              ? onEditResource(res)
                              : onAddResource({ ...splitName(row.display), email: row.email || undefined })
                          }
                          title={row.display}
                          className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-dark-blue dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
                        >
                          {row.display}
                        </button>
                      );
                    })()}
                  </td>
```
(The td padding drops from `px-3 py-2` to `px-2 py-1` so the inner button's own padding keeps the cell visually aligned with the directory; the now-redundant `font-medium`/text-color classes move onto the button.)

- [ ] **Step 5: Run the calendar test to verify it passes** — `npx vitest run src/app/resource-calendar.test.tsx`. Expected: PASS (both tests).

- [ ] **Step 6: Wire the props from the panel** — in `src/app/resources-panel.tsx`, the calendar is rendered in the `view === "calendar"` block. Replace:
```tsx
      {view === "calendar" && (
        <ResourceCalendar
          lang={lang}
          rows={rows}
          absences={absences}
          today={today}
          holidaySet={holidaySet}
          onAddAbsence={onAddAbsence}
          onEditAbsence={onEditAbsence}
        />
      )}
```
With:
```tsx
      {view === "calendar" && (
        <ResourceCalendar
          lang={lang}
          rows={rows}
          absences={absences}
          today={today}
          holidaySet={holidaySet}
          onAddAbsence={onAddAbsence}
          onEditAbsence={onEditAbsence}
          resources={resources}
          onEditResource={onEditResource}
          onAddResource={onAddResource}
        />
      )}
```
(`resources`, `onEditResource`, `onAddResource` are already destructured props of `ResourcesPanelInner` — no new panel props or upstream wiring needed.)

- [ ] **Step 7: Verify gates** — `npx tsc --noEmit` (0 errors); `npm run lint` (0 errors); `npx vitest run src/app/resource-calendar src/app/resources-panel` (all pass — the calendar tests plus the existing panel tests).

- [ ] **Step 8: Commit**
```bash
git add src/app/resource-calendar.tsx src/app/resource-calendar.test.tsx src/app/resources-panel.tsx
git commit -m "feat(resources): clickable assignee name in the calendar (edit matched, add-prefilled unmatched)"
```

---

## Task 3: Release 0.14.3

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `docs/CODEMAPS/frontend.md`.

- [ ] **Step 1: version.ts** — set `export const APP_VERSION = "0.14.3";` (keep `APP_BUILD_DATE = "2026-05-27"; // Atwood milestone`). Do NOT add an entry to `APP_HIGHLIGHT_KEYS` — this is a patch (consistent with 0.13.1 / 0.14.1 / 0.14.2, which added none). Add a one-line top-of-file comment above the existing `// 0.14.0 ...` block, e.g.:
```ts
// 0.14.3 makes the assignee name clickable in the resources calendar and
// planning grids: a matched name opens the resource edit modal; an unmatched
// calendar name opens Add Resource prefilled — reusing the workload tab's
// hover-button style.
```

- [ ] **Step 2: CHANGELOG** — read `CHANGELOG.md` to match its exact heading/section style, then add a new entry directly above the `[0.14.2]` entry:
```markdown
## [0.14.3] — 2026-05-27

### Added
- Resources **calendar** and **planning** grids: click an assignee name to open the resource edit modal (same hover style as the directory/workload tabs). In the calendar, clicking a name that isn't yet a resource opens **Add Resource** prefilled with that name.
```
(If the existing entries do not use `### Added` subheadings, match whatever format `[0.14.2]` uses instead.)

- [ ] **Step 3: Codemap** — in `docs/CODEMAPS/frontend.md`, find the `resource-calendar.tsx` and/or `resources-panel.tsx` entries and note that the calendar/planning assignee name is clickable (matched → `onEditResource`; unmatched calendar → `onAddResource` prefilled via `splitName`). Keep it to one concise line per file, matching the file's existing style.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npm run test:coverage` (green, ≥70% lines). Then `git status`; if `src/app/sample-workspace.md` is dirty, `git restore src/app/sample-workspace.md`.

- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts CHANGELOG.md docs/CODEMAPS/frontend.md
git commit -m "docs(release): 0.14.3 — resources calendar/planning assignee click-to-edit"
```

---

## Final review

Dispatch a final code reviewer over `git diff main...HEAD`. Instruct the reviewer to read `src/app/version.ts` and `CHANGELOG.md` DIRECTLY (not infer version from the diff +/- direction) and to confirm: APP_VERSION is `0.14.3`; a real `[0.14.3]` CHANGELOG entry exists; only the shared workload button class was reused (no new color tokens, no `zinc`/`shadow` added beyond that existing class); planning + calendar both wired. Confirm gates green (lint 0, tsc 0, coverage ≥70%). Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- Shared hover style (workload button verbatim) → used in Task 1 Step 3 and Task 2 Step 4.
- Planning grid name → edit → Task 1.
- Calendar matched name → edit; unmatched → Add Resource prefilled (`splitName`, `email || undefined`) → Task 2 (Steps 3–4) + tests (Step 1).
- Calendar gains `resources` / `onEditResource` / `onAddResource`; case-folded `useMemo` lookup keyed by `resourceDisplayName(r).trim().toLowerCase()` → Task 2 Steps 3–4.
- Wiring from the panel (already-in-scope props) → Task 2 Step 6.
- Release 0.14.3, no highlight key, CHANGELOG + codemap → Task 3.
All spec requirements map to a task.

**Placeholder scan:** No TBD/TODO; every code step shows full code; test code is concrete. Task 3 Step 2 notes the one conditional ("match whatever format `[0.14.2]` uses") which is a real source-confirmation, not a placeholder.

**Type consistency:** `Props` adds `resources: readonly Resource[]`, `onEditResource: (resource: Resource) => void`, `onAddResource: (seed: Partial<Resource>) => void` (Task 2 Step 3) — exactly the names/types forwarded by the panel (Task 2 Step 6) and exercised by the tests (Task 2 Step 1). `splitName` returns `{ firstName, lastName }`, so the unmatched seed is `{ firstName, lastName, email }` — matching the test's expected `onAddResource` argument and the workload tab's existing seed shape.
