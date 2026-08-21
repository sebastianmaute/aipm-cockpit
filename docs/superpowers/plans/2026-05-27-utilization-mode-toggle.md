# Percent/Hours Utilization-Mode Toggle (0.14.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global percent/hours toggle to the resources planning header (next to month/week) that sets the mode for all resources and converts entered utilization values between units.

**Architecture:** A pure `convertUtilization` helper (in `resource-capacity.ts`) does the math; a `handleSetAllUtilizationMode` bulk handler (in `use-resource-planner.ts`, given `workdayHours`/`holidaySet`) applies mode+conversion to all resources in one update; the panel renders a `SegmentedControl` wired through `onSetAllUtilizationMode`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest + Testing Library. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-27-utilization-mode-toggle-design.md`
**Branch:** `feat/0.14.1-utilization-mode-toggle` (already created off `main`).

**Conventions:** i18n keys in BOTH `i18n.ts` + `i18n.de.ts`; immutable; no `any`; run `npx tsc --noEmit`, `npm run lint`, relevant `npx vitest run` after each task. Each task must leave the build green.

---

## Task 1: `convertUtilization` helper

**Files:** Modify `src/app/resource-capacity.ts`; Test `src/app/resource-capacity.test.ts`.

First confirm `Period` is exported from `resource-capacity.ts` (if not, export it) and that `workdaysInRange` is exported (it is).

- [ ] **Step 1: Failing tests** (append to `resource-capacity.test.ts`; add `convertUtilization` to the existing `./resource-capacity` import)

```ts
describe("convertUtilization", () => {
  const noHolidays = new Set<string>();
  // May 2026 has 21 weekdays → 21*8 = 168 possible hours at 8h/day.
  const monthPeriods = generatePeriods("2026-05-01", "2026-05-31", "month");
  const mKey = monthPeriods[0].key;

  test("same mode returns the input unchanged", () => {
    const u = { [mKey]: 100 };
    expect(convertUtilization(u, "percent", "percent", monthPeriods, 8, noHolidays)).toBe(u);
  });
  test("percent → hours uses gross possible working hours", () => {
    const out = convertUtilization({ [mKey]: 100 }, "percent", "hours", monthPeriods, 8, noHolidays);
    expect(out[mKey]).toBe(168);           // 100% of 168h
    const half = convertUtilization({ [mKey]: 50 }, "percent", "hours", monthPeriods, 8, noHolidays);
    expect(half[mKey]).toBe(84);           // 50% of 168h
  });
  test("hours → percent divides by possible hours", () => {
    const out = convertUtilization({ [mKey]: 84 }, "hours", "percent", monthPeriods, 8, noHolidays);
    expect(out[mKey]).toBe(50);
  });
  test("round-trips within rounding", () => {
    const h = convertUtilization({ [mKey]: 80 }, "percent", "hours", monthPeriods, 8, noHolidays);
    const p = convertUtilization(h, "hours", "percent", monthPeriods, 8, noHolidays);
    expect(p[mKey]).toBe(80);
  });
  test("zero-capacity period → 0 for hours→percent", () => {
    // any range whose workdaysInRange is 0 makes possible 0; assert the guard returns 0.
    const weekend = generatePeriods("2026-05-02", "2026-05-03", "week"); // Sat–Sun slice → 0 workdays
    const wKey = weekend[0].key;
    const out = convertUtilization({ [wKey]: 40 }, "hours", "percent", weekend, 8, noHolidays);
    expect(out[wKey]).toBe(0);
  });
  test("key with no matching period is left unchanged", () => {
    const out = convertUtilization({ "1999-01": 73 }, "percent", "hours", monthPeriods, 8, noHolidays);
    expect(out["1999-01"]).toBe(73);
  });
});
```
(If the zero-workday assertion is awkward with real ISO-week ranges, adapt it to any range whose `workdaysInRange` is 0 — the point is `possible === 0 → 0`. Keep it meaningful.)

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/app/resource-capacity.test.ts -t convertUtilization` (function missing).

- [ ] **Step 3: Implement** (append to `resource-capacity.ts`)

```ts
/**
 * Convert a utilization map between percent and hours, per period.
 * `possible` = gross working hours (workdays × workdayHours, holidays excluded);
 * absence is intentionally NOT subtracted (hours-mode subtracts it in its own
 * capacity formula, so a net factor would double-count and not round-trip).
 * Keys without a matching period are left unchanged. Same-mode returns input.
 */
export function convertUtilization(
  util: Record<string, number>,
  fromMode: "percent" | "hours",
  toMode: "percent" | "hours",
  periods: readonly Period[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
): Record<string, number> {
  if (fromMode === toMode) return util;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(util)) {
    const period = periods.find((p) => p.key === key);
    if (!period) {
      out[key] = value;
      continue;
    }
    const possible = workdaysInRange(period.start, period.end, holidaySet) * workdayHours;
    out[key] =
      toMode === "hours"
        ? Math.round((value / 100) * possible)
        : possible > 0
          ? Math.round((value / possible) * 100)
          : 0;
  }
  return out;
}
```

- [ ] **Step 4: Run → PASS**; `npx tsc --noEmit` (0); `npm run lint`.

- [ ] **Step 5: Commit**
```bash
git add src/app/resource-capacity.ts src/app/resource-capacity.test.ts
git commit -m "feat(resources): convertUtilization helper (percent <-> hours per period)"
```

---

## Task 2: i18n keys

**Files:** `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1:** Add to BOTH dicts (same keys; near the other `resources*` keys):
  - `i18n.ts`: `resourcesUtilModePercent: "Percent",` `resourcesUtilModeHours: "Hours",` `resourcesUtilModeHint: "Switch all resources between percent and hours; entered values are converted.",`
  - `i18n.de.ts`: `resourcesUtilModePercent: "Prozent",` `resourcesUtilModeHours: "Stunden",` `resourcesUtilModeHint: "Alle Ressourcen zwischen Prozent und Stunden umschalten; eingegebene Werte werden umgerechnet.",`

- [ ] **Step 2:** `npx tsc --noEmit` (0 — catches key mismatch); `npm run lint`.
- [ ] **Step 3: Commit**
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(resources): keys for the percent/hours utilization toggle"
```

---

## Task 3: Bulk handler + end-to-end wiring + the toggle

Do this as ONE task so the build stays green (the new prop spans planner → task-manager → workspace-section → panel).

**Files:** `src/app/use-resource-planner.ts`, `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`, `src/app/resources-panel.tsx`, plus tests in `src/app/use-resource-planner.test.tsx` and `src/app/resources-panel.test.tsx`.

- [ ] **Step 1: Planner args + handler** (`use-resource-planner.ts`)
  - Add to `UseResourcePlannerArgs`: `workdayHours: number;` and `holidaySet: ReadonlySet<string>;`. Destructure them from `args`.
  - Ensure `plan` is destructured from `useWorkspace()` (add it if absent). Add imports: `generatePeriods, convertUtilization` from `./resource-capacity` (merge with any existing import).
  - Add the handler (near `handleSetUtilizationMode`):
```tsx
  const handleSetAllUtilizationMode = useCallback(
    (mode: "percent" | "hours") => {
      if (resources.every((r) => r.utilizationMode === mode)) return;
      const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) =>
          r.utilizationMode === mode
            ? r
            : {
                ...r,
                utilizationMode: mode,
                utilization: convertUtilization(r.utilization, r.utilizationMode, mode, periods, workdayHours, holidaySet),
                localModifiedAt: stamp,
              },
        ),
      );
    },
    [resources, plan, workdayHours, holidaySet, setResources],
  );
```
  - Add `handleSetAllUtilizationMode` to the hook's returned object (next to `handleSetUtilizationMode`).

- [ ] **Step 2: task-manager wiring** (`task-manager.tsx`)
  - At the `useResourcePlanner({ ... })` call, add `workdayHours` and `holidaySet` (both already in scope there — confirm the exact variable names; they're passed to `<WorkspaceSection>` already).
  - Destructure `handleSetAllUtilizationMode` from the planner return (alongside `handleSetUtilizationMode`).
  - On `<WorkspaceSection …>`, add `onSetAllUtilizationMode={guardEdit(handleSetAllUtilizationMode)}`.

- [ ] **Step 3: workspace-section pass-through** (`workspace-section.tsx`)
  - Add to `WorkspaceSectionProps`: `onSetAllUtilizationMode: (mode: "percent" | "hours") => void;`
  - Destructure it and pass to the resources panel render: `onSetAllUtilizationMode={onSetAllUtilizationMode}` (alongside the existing `onSetUtilizationMode`).

- [ ] **Step 4: panel prop + toggle** (`resources-panel.tsx`)
  - Add to the panel props type: `onSetAllUtilizationMode: (mode: "percent" | "hours") => void;` and destructure it.
  - Render the toggle immediately AFTER the existing month/week `SegmentedControl` (~line 325), inside the same controls `<div>`:
```tsx
              <SegmentedControl<"percent" | "hours">
                value={
                  resources.length > 0 && resources.every((r) => r.utilizationMode === resources[0].utilizationMode)
                    ? resources[0].utilizationMode
                    : "percent"
                }
                ariaLabel={t(lang, "resourcesUtilModeHint")}
                title={t(lang, "resourcesUtilModeHint")}
                options={[
                  { value: "percent", label: t(lang, "resourcesUtilModePercent") },
                  { value: "hours", label: t(lang, "resourcesUtilModeHours") },
                ]}
                onChange={(mode) => onSetAllUtilizationMode(mode)}
              />
```
  (`resources` is already in scope in the panel.)

- [ ] **Step 5: Tests**
  - `use-resource-planner.test.tsx`: the hook is constructed in tests — add the new required args (`workdayHours`, `holidaySet`) to however the test builds the `useResourcePlanner` args. Add a test: two resources in `"percent"` with utilization → `handleSetAllUtilizationMode("hours")` sets both to `"hours"` and converts values; calling again with `"hours"` is a no-op (every mode already hours).
  - `resources-panel.test.tsx`: the panel render now needs the new required prop — add `onSetAllUtilizationMode` (a `vi.fn()`) to the test props/helper. Add a test: the percent/hours toggle is present in the planning view and clicking "Hours" calls `onSetAllUtilizationMode("hours")`. Match how existing tests query SegmentedControl options.

- [ ] **Step 6: Verify** — `npx tsc --noEmit` (0); `npm run lint`; `npx vitest run src/app/use-resource-planner src/app/resources-panel src/app/resource-capacity src/app/workspace-section src/app/task-manager` (all pass).

- [ ] **Step 7: Commit**
```bash
git add src/app/use-resource-planner.ts src/app/task-manager.tsx src/app/workspace-section.tsx src/app/resources-panel.tsx src/app/use-resource-planner.test.tsx src/app/resources-panel.test.tsx
git commit -m "feat(resources): global percent/hours toggle in planning header (converts values)"
```

---

## Task 4: Release 0.14.1

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `docs/CODEMAPS/{frontend,data}.md`.

- [ ] **Step 1: version.ts** — set `APP_VERSION = "0.14.1"`, build date `2026-05-27`, keep the "Atwood" codename (patch). READ the file: if it adds one highlight key per release, add `versionHighlightUtilToggle` to `APP_HIGHLIGHT_KEYS` + define in both i18n dicts; if patches don't add one, leave it. Report which.

- [ ] **Step 2: CHANGELOG** — add `## [0.14.1] — 2026-05-27`: a global percent/hours utilization toggle in the resources planning header (next to month/week) that switches all resources and converts entered values between units.

- [ ] **Step 3: Codemaps** — `data.md`: add `convertUtilization` to the `resource-capacity.ts` entry. `frontend.md`: note the planning header's percent/hours toggle + the `onSetAllUtilizationMode` wiring.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint`; `npm run test:coverage` (green, ≥70%). Before committing, `git status` + `git restore` any stray `sample-workspace.md`.

- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts CHANGELOG.md docs/CODEMAPS src/app/i18n.ts src/app/i18n.de.ts
git commit -m "docs(release): 0.14.1 — percent/hours utilization toggle"
```

---

## Final review
Dispatch a final code reviewer over `git diff main...HEAD`; confirm gates green; then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)
**Spec coverage:** `convertUtilization` → T1; i18n → T2; bulk handler + threading + toggle → T3; release → T4. All covered.
**Placeholder scan:** Code is concrete. T3 flags real-source confirmations (exact `workdayHours`/`holidaySet` var names at the task-manager planner call; whether `plan` is already destructured in the planner; the SegmentedControl option-query in the panel test) — explicit, not vague.
**Type consistency:** `convertUtilization(util, fromMode, toMode, periods, workdayHours, holidaySet)` defined in T1 and called in T3 with the same arg order/types; `handleSetAllUtilizationMode(mode: "percent"|"hours")` consistent from hook → task-manager → `onSetAllUtilizationMode` prop (workspace-section, panel) → SegmentedControl `onChange`.
