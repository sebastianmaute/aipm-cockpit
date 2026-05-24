# Resource Planning Polish Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two deferred Planning-grid items — per-cell absence-override editing and a read-only non-canonical (week↔month) rollup view — and fix the 2 pre-existing `tsc` errors so the type-check is fully green.

**Architecture:** Both UI items are additive to the existing Planning view in `resources-panel.tsx` and reuse handlers/engine already shipped (`onSetAbsenceOverride` from Phase 3; `displayCapacityHours`/`absenceWorkdays`/`generatePeriods` from Phase 3). The rollup is a separate read-only table toggled below the editable grid — the editable grid and the canonical-granularity control are left untouched. The `tsc` fixes are test-file-only.

**Tech Stack:** TypeScript, React 19, Next.js 16, Vitest (jsdom) + Testing Library. Spec: `docs/superpowers/specs/2026-05-23-resource-utilization-design.md`. Branch: `feat/resource-utilization`.

**Baseline note:** Task 1 *eliminates* the 2 pre-existing `tsc` errors; after Task 1, `npx tsc --noEmit` should be fully clean (0 errors). `use-holiday-set.test.ts` is an occasional full-run flake — re-run alone if it's the sole failure.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `src/app/settings-menu.test.tsx` | Fix self-referential `makeProps` type | Modify |
| `src/app/use-due-alerts.test.ts` | Fix stale `storageConfig` shape | Modify |
| `src/app/resources-panel.tsx` | Per-cell absence override + read-only rollup table | Modify |
| `src/app/resources-panel.test.tsx` | Tests for both UI additions | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New keys | Modify |

**Commands:** single file `npx vitest run src/app/<file>.test.tsx`; full `npm run test:run`; types `npx tsc --noEmit`.

---

## Task 1: Fix the 2 pre-existing `tsc` errors

**Files:** Modify `src/app/settings-menu.test.tsx`, `src/app/use-due-alerts.test.ts`.

- [ ] **Step 1: Confirm the failures.** `npx tsc --noEmit` → shows exactly:
  - `settings-menu.test.tsx(18,20): error TS2502: 'overrides' is referenced directly or indirectly in its own type annotation.`
  - `use-due-alerts.test.ts(28,22): error TS2353: ... 'backend' does not exist in type 'StorageConfig'.`

- [ ] **Step 2: Fix `settings-menu.test.tsx`.** The `makeProps` parameter type `Partial<ReturnType<typeof makeProps>>` is self-referential. Type it against the component's real props instead. Replace the function signature line:
```tsx
function makeProps(overrides: Partial<ReturnType<typeof makeProps>> = {}) {
```
with:
```tsx
function makeProps(overrides: Partial<React.ComponentProps<typeof SettingsMenu>> = {}): React.ComponentProps<typeof SettingsMenu> {
```
(`React` and `SettingsMenu` are already imported at the top of the file.)

- [ ] **Step 3: Fix `use-due-alerts.test.ts`.** Line ~28 has `storageConfig: { backend: "local" }`, which is not a valid `StorageConfig` (it's a discriminated union on `kind`). Replace with:
```ts
    storageConfig: { kind: "browser" },
```

- [ ] **Step 4: Verify.** `npx tsc --noEmit` → **0 errors** (fully clean). `npx vitest run src/app/settings-menu.test.tsx src/app/use-due-alerts.test.ts` → PASS (behavior unchanged; these were type-only issues Vitest's transpile ignored, so the tests already ran — confirm they still pass).

- [ ] **Step 5: Commit.**
```bash
git add src/app/settings-menu.test.tsx src/app/use-due-alerts.test.ts
git commit -m "fix(types): resolve 2 pre-existing tsc errors in test fixtures"
```

---

## Task 2: Per-cell absence-override editing in the Planning grid

In the editable Planning grid, each cell currently has one utilization `<input>`. Add a second small input for the per-period absence override (hours), whose placeholder shows the auto-derived absence hours (so empty = auto). Wires to the existing `onSetAbsenceOverride` (Phase 3).

**Files:** Modify `src/app/resources-panel.tsx`, `src/app/resources-panel.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: i18n** — add `resourcesAbsenceOverrideHint` to both dicts (en `"Absence h (auto if blank)"` / de `"Abwesenheit Std (auto wenn leer)"`). Used as the input's `title`; the per-cell control's accessible name is an inline `aria-label`.

- [ ] **Step 2: Failing test** — append to `resources-panel.test.tsx`:
```tsx
test("planning view: editing a cell's absence override calls onSetAbsenceOverride", () => {
  const onSetAbsenceOverride = vi.fn();
  const resources = [{ id: 1, name: "Sample", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
  const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
  render(<ResourcesPanel {...baseProps} lang="en-US" resources={resources} plan={plan} workdayHours={8}
    holidaySet={new Set()} onSetUtilization={() => {}} onSetUtilizationMode={() => {}}
    onSetAbsenceOverride={onSetAbsenceOverride} onSetPlanWindow={() => {}} onSetPlanGranularity={() => {}} />);
  fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
  fireEvent.change(screen.getByLabelText("Absence override for Sample in 2026-02"), { target: { value: "16" } });
  expect(onSetAbsenceOverride).toHaveBeenCalledWith(1, "2026-02", 16);
});

test("planning view: clearing an absence override passes null", () => {
  const onSetAbsenceOverride = vi.fn();
  const resources = [{ id: 1, name: "Sample", roleId: null, utilizationMode: "percent" as const, utilization: {}, absenceOverride: { "2026-02": 16 } }];
  const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
  render(<ResourcesPanel {...baseProps} lang="en-US" resources={resources} plan={plan} workdayHours={8}
    holidaySet={new Set()} onSetUtilization={() => {}} onSetUtilizationMode={() => {}}
    onSetAbsenceOverride={onSetAbsenceOverride} onSetPlanWindow={() => {}} onSetPlanGranularity={() => {}} />);
  fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
  fireEvent.change(screen.getByLabelText("Absence override for Sample in 2026-02"), { target: { value: "" } });
  expect(onSetAbsenceOverride).toHaveBeenCalledWith(1, "2026-02", null);
});
```

- [ ] **Step 3: Run → FAIL.** `npx vitest run src/app/resources-panel.test.tsx`.

- [ ] **Step 4: Implement.** In `resources-panel.tsx`, add `absenceWorkdays` to the import from `./resource-capacity`:
```ts
import { generatePeriods, displayCapacityHours, absencesForResource, absenceWorkdays } from "./resource-capacity";
```
In the planning grid's per-period `<td>` (the cell rendering the utilization `<input>`), keep the util input and add the absence-override input below it. Replace the cell:
```tsx
<td key={p.key} className="px-1 py-1 text-right">
  <input type="number" min={0} step={r.utilizationMode === "percent" ? 5 : 1}
    aria-label={`Utilization for ${r.name} in ${p.key}`}
    value={r.utilization[p.key] ?? ""}
    onChange={(e) => onSetUtilization(r.id, p.key, Number(e.target.value) || 0)}
    className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
</td>
```
with:
```tsx
<td key={p.key} className="px-1 py-1 text-right align-top">
  <input type="number" min={0} step={r.utilizationMode === "percent" ? 5 : 1}
    aria-label={`Utilization for ${r.name} in ${p.key}`}
    value={r.utilization[p.key] ?? ""}
    onChange={(e) => onSetUtilization(r.id, p.key, Number(e.target.value) || 0)}
    className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
  <input type="number" min={0} step={1}
    aria-label={`Absence override for ${r.name} in ${p.key}`}
    title={t(lang, "resourcesAbsenceOverrideHint")}
    value={r.absenceOverride?.[p.key] ?? ""}
    placeholder={String(absenceWorkdays(resAbs, p.start, p.end, holidaySet) * workdayHours)}
    onChange={(e) => onSetAbsenceOverride(r.id, p.key, e.target.value === "" ? null : Number(e.target.value))}
    className="mt-0.5 w-16 rounded border border-amber-200 px-1 py-0.5 text-right text-[10px] tabular-nums text-amber-700 dark:border-amber-900/50 dark:bg-zinc-900 dark:text-amber-400" />
</td>
```
(`resAbs` is already computed once per row in the IIFE — `const resAbs = absencesForResource(absences, r);`. `p.start`/`p.end` exist on each `Period`.)

- [ ] **Step 5: Run → PASS.** `npx vitest run src/app/resources-panel.test.tsx` + `npx tsc --noEmit` (0 errors after Task 1).

- [ ] **Step 6: Commit.**
```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): per-period absence-override editing in planning grid"
```

---

## Task 3: Read-only non-canonical rollup table

Below the editable grid, add a toggle that reveals a read-only table at the *other* granularity (the canonical-vs-rollup display from the spec). Reuses `displayCapacityHours` with differing canonical/display granularity. The editable grid and the canonical control are untouched.

**Files:** Modify `src/app/resources-panel.tsx`, `src/app/resources-panel.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: i18n** — add to both dicts: `resourcesRollupShow` (en `"Show rollup"` / de `"Rollup anzeigen"`) and `resourcesRollupHide` (en `"Hide rollup"` / de `"Rollup ausblenden"`).

- [ ] **Step 2: Failing test** — append to `resources-panel.test.tsx`:
```tsx
test("planning view: rollup toggle reveals the non-canonical read-only table", () => {
  const resources = [{ id: 1, name: "Sample", roleId: null, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } }];
  const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
  render(<ResourcesPanel {...baseProps} lang="en-US" resources={resources} plan={plan} workdayHours={8}
    holidaySet={new Set()} onSetUtilization={() => {}} onSetUtilizationMode={() => {}}
    onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} onSetPlanGranularity={() => {}} />);
  fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
  // canonical is month → rollup shows weeks; a Feb 2026 ISO week column appears after toggling
  fireEvent.click(screen.getByRole("button", { name: "Show rollup" }));
  expect(screen.getByText("2026-W07")).toBeInTheDocument(); // Mon 2026-02-09 week
});
```

- [ ] **Step 3: Run → FAIL.** `npx vitest run src/app/resources-panel.test.tsx`.

- [ ] **Step 4: Implement.** Add local rollup state alongside the other `useState`s at the top of `ResourcesPanelInner` (NOT inside the IIFE — rules of hooks): `const [showRollup, setShowRollup] = useState(false);`. Then inside the `view === "planning"` IIFE, after the editable grid's closing `</div>` and before the fragment closes, add:
```tsx
{(() => {
  const other: "week" | "month" = plan.granularity === "month" ? "week" : "month";
  const rollupPeriods = generatePeriods(plan.startDate, plan.endDate, other);
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setShowRollup((v) => !v)}
        className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey">
        {showRollup ? t(lang, "resourcesRollupHide") : t(lang, "resourcesRollupShow")}
      </button>
      {showRollup && (
        <div className="mt-2 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="text-left text-xs">
            <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-2 py-1.5 text-left">{t(lang, "assignee")}</th>
                {rollupPeriods.map((rp) => (
                  <th key={rp.key} className="px-2 py-1.5 text-right tabular-nums">{rp.key}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {resources.map((r) => {
                const resAbs2 = absencesForResource(absences, r);
                return (
                  <tr key={r.id}>
                    <td className="px-2 py-1 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{r.name}</td>
                    {rollupPeriods.map((rp) => (
                      <td key={rp.key} className="px-2 py-1 text-right tabular-nums text-AIPM-medium-grey">
                        {(displayCapacityHours(rp, periods, r, resAbs2, workdayHours, holidaySet, plan.granularity, other) / workdayHours).toFixed(1)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
})()}
```
Here `periods` (the canonical set generated at the top of the planning IIFE: `generatePeriods(plan.startDate, plan.endDate, plan.granularity)`) is passed as `displayCapacityHours`' `canonicalPeriods`, and `other`/`rollupPeriods` is the display granularity — exercising the rollup branches. Cells are read-only capacity in days.

- [ ] **Step 5: Run → PASS.** `npx vitest run src/app/resources-panel.test.tsx` + `npx tsc --noEmit` (0 errors) + `npm run test:run` (green).

- [ ] **Step 6: Commit.**
```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): read-only week/month rollup table in planning view"
```

---

## Final Verification

- [ ] `npm run test:run` — green (re-run `use-holiday-set.test.ts` alone if it's the sole failure).
- [ ] `npx tsc --noEmit` — **0 errors** (the 2 pre-existing ones are now fixed).
- [ ] Smoke (`npm run dev`): Resources → Planning. Each cell has a utilization input plus a small amber absence-override input (placeholder = auto absence hours); typing overrides the auto value, clearing reverts to auto. "Show rollup" reveals a read-only table at the other granularity (weeks when planning monthly) whose per-resource capacity reconciles with the editable grid's totals.

---

## Self-Review

**Coverage:** the 2 `tsc` errors are fixed at their exact sites (T1); per-cell absence-override editing wires to the existing `onSetAbsenceOverride` with auto-derived placeholder + null-on-clear (T2); the non-canonical read-only rollup table uses `displayCapacityHours` with `canonical=plan.granularity, display=other` — the previously-unexercised rollup branches now have a UI caller (T3). These are exactly the two "deferred polish" items the Phase-3/5 reviews flagged plus the standing tech-debt.

**Type consistency:** T2 reuses `onSetAbsenceOverride(resourceId, periodKey, hours|null)` exactly as defined in Phase 3; `absenceWorkdays(resAbs, start, end, holidaySet)` and `displayCapacityHours(...)` signatures match Phase 3. `showRollup` is component state declared with the other `useState`s (not inside the IIFE) to satisfy rules-of-hooks.

**Placeholder scan:** none — full code provided. Tests use deterministic values (Feb 2026; `2026-W07` = Mon 2026-02-09 week, which `generatePeriods("2026-02-01","2026-02-28","week")` produces).

**Scope (YAGNI):** the rollup is a separate read-only table (additive) rather than reworking the editable grid or the canonical-granularity control — lowest-risk way to deliver the spec's "read-only re-bucketed rollup." Cost columns are intentionally omitted from the rollup table (capacity only) to keep it lightweight; full cost lives in the editable grid and the report.
