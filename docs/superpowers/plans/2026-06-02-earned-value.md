# Earned Value (SPI/CPI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add task-effort-based Earned Value (PV/EV/AC → SPI/CPI/SV/CV, hours + € overlay), surfaced on the dashboard burn band and in the Budget Report — purely derived, no new persisted state.

**Architecture:** New pure `evm.ts` (`computeEvm` + `projectBlendedInternalRate`). `dashboard.ts` computes `evm` into the model; the burn band shows SPI/CPI tiles. `budget-report-panel.tsx` gains a full EVM section (needs a `tasks` prop threaded from `workspace-section.tsx`). No entity/nav/migration. Informational-only (no RAG change in v1).

**Tech Stack:** Next.js 16, React, TypeScript, Vitest 4 (`npm run test:run`).

**Design source:** `docs/superpowers/specs/2026-06-02-earned-value-design.md`.

**Conventions:** commit via Bash here-doc `git commit -F - <<'EOF'` (NO `Co-Authored-By`); `i18n.de.ts` straight ASCII `"` only; never edit `eslint.config.mjs`.

---

## Pre-flight (once)

#1 (dashboard) and #2 (milestones) are both in local `main`. This feature branches cleanly off `main` — no stacking.

- [ ] Branch off main:
```bash
git checkout main && git pull --ff-only origin main 2>/dev/null; git checkout -b feat-earned-value
```
- [ ] Baseline green: `npm run test:run` (expect all pass).

---

## Task 1: `evm.ts` pure logic

**Files:** Create `src/app/evm.ts`, `src/app/evm.test.ts`.

Build via TDD; one commit is fine. Commit before reporting.

### Final `src/app/evm.ts`:
```typescript
// Pure Earned Value Management (EVM) logic. No React, no I/O — testable core.
import type { Role, Task } from "./types";

export type EvmMetrics = {
  pv: number; // hours
  ev: number; // hours
  ac: number; // hours
  spi: number | null; // null when pv === 0
  cpi: number | null; // null when ac === 0
  sv: number; // hours (ev - pv)
  cv: number; // hours (ev - ac)
  money: { pv: number; ev: number; ac: number; sv: number; cv: number } | null; // null when no rate
  coverage: { withEstimate: number; total: number };
};

const MIN_PER_HOUR = 60;

/** Arithmetic mean of role internal rates (EUR/h); 0 when there are no roles. */
export function projectBlendedInternalRate(roles: readonly Role[]): number {
  if (roles.length === 0) return 0;
  const sum = roles.reduce((acc, r) => acc + (r.internalRate ?? 0), 0);
  return sum / roles.length;
}

/** Task-effort EVM as of `todayISO`. A task participates iff originalEstimateMinutes > 0.
 *  PV = estimate of tasks due by today; EV = estimate of completed tasks; AC = time spent. */
export function computeEvm(
  tasks: readonly Task[],
  todayISO: string,
  opts: { blendedRate?: number } = {},
): EvmMetrics {
  let pvMin = 0;
  let evMin = 0;
  let acMin = 0;
  let withEstimate = 0;
  for (const t of tasks) {
    const est = t.originalEstimateMinutes ?? 0;
    if (est <= 0) continue;
    withEstimate++;
    if (t.dueDate && t.dueDate <= todayISO) pvMin += est;
    if (t.completedDate && t.completedDate <= todayISO) evMin += est;
    acMin += t.timeSpentMinutes ?? 0;
  }
  const pv = pvMin / MIN_PER_HOUR;
  const ev = evMin / MIN_PER_HOUR;
  const ac = acMin / MIN_PER_HOUR;
  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const sv = ev - pv;
  const cv = ev - ac;
  const rate = opts.blendedRate ?? 0;
  const money = rate > 0
    ? { pv: pv * rate, ev: ev * rate, ac: ac * rate, sv: sv * rate, cv: cv * rate }
    : null;
  return { pv, ev, ac, spi, cpi, sv, cv, money, coverage: { withEstimate, total: tasks.length } };
}
```

### `src/app/evm.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { computeEvm, projectBlendedInternalRate } from "./evm";
import type { Role, Task } from "./types";

function task(o: Partial<Task> = {}): Task {
  return {
    id: 1, taskName: "T", assignee: "A", assigneeEmail: "a@x.io",
    dueDate: "2026-06-10", lastUpdateDate: "2026-06-01", priority: "Medium",
    blockers: "", notes: "", ...o,
  };
}
function role(internalRate: number, id = 1): Role {
  return { id, disciplineId: 1, gradeId: 1, internalRate, externalRate: internalRate * 2 };
}
const today = "2026-06-15";

describe("projectBlendedInternalRate", () => {
  it("averages role internal rates", () => {
    expect(projectBlendedInternalRate([role(100, 1), role(60, 2)])).toBe(80);
  });
  it("is 0 when there are no roles", () => {
    expect(projectBlendedInternalRate([])).toBe(0);
  });
});

describe("computeEvm — worked example", () => {
  const tasks = [
    task({ id: 1, originalEstimateMinutes: 2400, dueDate: "2026-06-01", completedDate: "2026-05-30", timeSpentMinutes: 2700 }),
    task({ id: 2, originalEstimateMinutes: 1440, dueDate: "2026-06-10", completedDate: "2026-06-12", timeSpentMinutes: 1200 }),
    task({ id: 3, originalEstimateMinutes: 960, dueDate: "2026-06-12", timeSpentMinutes: 600 }),
    task({ id: 4, originalEstimateMinutes: 2400, dueDate: "2026-06-30", timeSpentMinutes: 0 }),
  ];
  it("computes PV/EV/AC in hours", () => {
    const e = computeEvm(tasks, today);
    expect(e.pv).toBe(80); // T1+T2+T3 due by today
    expect(e.ev).toBe(64); // T1+T2 completed
    expect(e.ac).toBe(75); // all time spent (45+20+10+0)
  });
  it("derives SPI/CPI/SV/CV", () => {
    const e = computeEvm(tasks, today);
    expect(e.spi).toBe(0.8);
    expect(e.cpi).toBeCloseTo(0.8533, 4);
    expect(e.sv).toBe(-16);
    expect(e.cv).toBe(-11);
  });
  it("money overlay scales absolutes by the rate; ratios unchanged", () => {
    const e = computeEvm(tasks, today, { blendedRate: 80 });
    expect(e.money).toEqual({ pv: 6400, ev: 5120, ac: 6000, sv: -1280, cv: -880 });
    expect(e.spi).toBe(0.8); // unchanged
  });
  it("reports coverage", () => {
    expect(computeEvm(tasks, today).coverage).toEqual({ withEstimate: 4, total: 4 });
  });
});

describe("computeEvm — edge cases", () => {
  it("SPI null when nothing is due yet; CPI null when no time spent", () => {
    const e = computeEvm([task({ originalEstimateMinutes: 600, dueDate: "2026-12-01", timeSpentMinutes: 0 })], today);
    expect(e.pv).toBe(0);
    expect(e.spi).toBeNull();
    expect(e.cpi).toBeNull();
    expect(e.money).toBeNull(); // no rate given
  });
  it("excludes tasks without an estimate from PV/EV/AC and coverage", () => {
    const e = computeEvm([
      task({ id: 1, dueDate: "2026-06-01", completedDate: "2026-06-01", timeSpentMinutes: 600 }), // no estimate
      task({ id: 2, originalEstimateMinutes: 600, dueDate: "2026-06-01", completedDate: "2026-06-01", timeSpentMinutes: 600 }),
    ], today);
    expect(e.ac).toBe(10); // only task 2's 600min counts
    expect(e.coverage).toEqual({ withEstimate: 1, total: 2 });
  });
  it("a completed future-due task earns EV but is not in PV (ahead of schedule)", () => {
    const e = computeEvm([task({ originalEstimateMinutes: 600, dueDate: "2026-12-01", completedDate: "2026-06-01", timeSpentMinutes: 300 })], today);
    expect(e.pv).toBe(0);
    expect(e.ev).toBe(10);
    expect(e.spi).toBeNull(); // pv 0
    expect(e.cpi).toBe(2);    // ev 10 / ac 5
  });
  it("empty workspace → zeros and nulls", () => {
    expect(computeEvm([], today)).toEqual({ pv: 0, ev: 0, ac: 0, spi: null, cpi: null, sv: 0, cv: 0, money: null, coverage: { withEstimate: 0, total: 0 } });
  });
});
```

### Steps:
1. Write `evm.test.ts`. Run `npm run test:run -- evm` → FAIL (no module).
2. Create `evm.ts`. Run `npm run test:run -- evm` → PASS. `npx tsc --noEmit; echo "tsc exit: $?"` → 0.
3. Commit:
```bash
git add src/app/evm.ts src/app/evm.test.ts
git commit -F - <<'EOF'
feat: evm.ts pure logic (computeEvm + projectBlendedInternalRate)
EOF
```

**Before you begin:** confirm the `Task` factory's required fields match `types.ts` (id, taskName, assignee, assigneeEmail, dueDate, lastUpdateDate, priority, blockers, notes) and `Role` fields (id, disciplineId, gradeId, internalRate, externalRate). If different, fix the factory (not the prod types). Report Status, test count, tsc, and HEAD + parent SHAs.

---

## Task 2: Dashboard integration

**Files:** Modify `src/app/dashboard.ts`, `src/app/dashboard.test.ts`.

- [ ] **Step 1: Failing test.** In `dashboard.test.ts`, add inside `describe("computeDashboard", ...)`:
```typescript
it("computes EVM from task estimates (independent of budgets)", () => {
  const tasks = [
    task({ id: 1, originalEstimateMinutes: 2400, dueDate: "2026-05-01", completedDate: "2026-04-30", timeSpentMinutes: 2700 }),
    task({ id: 2, originalEstimateMinutes: 1200, dueDate: "2026-12-01" }),
  ];
  const m = computeDashboard(baseInput({ tasks })); // baseInput today is 2026-06-02, budgets [], roles []
  expect(m.evm.pv).toBe(40);  // only task 1 due by today
  expect(m.evm.ev).toBe(40);  // task 1 completed
  expect(m.evm.ac).toBe(45);  // 2700/60
  expect(m.evm.coverage).toEqual({ withEstimate: 2, total: 2 });
  expect(m.evm.money).toBeNull(); // roles [] → rate 0
});
```
(Confirm `baseInput`'s `today` is `2026-06-02`; adjust dates if not. The `task()` factory already exists in this file.)

- [ ] **Step 2: Run — expect FAIL.** `npm run test:run -- dashboard`

- [ ] **Step 3: Implement.** In `dashboard.ts`:
- Add imports: `import { computeEvm, projectBlendedInternalRate, type EvmMetrics } from "./evm";`
- `DashboardModel` — add `evm: EvmMetrics;` (place near `burn`).
- In `computeDashboard`, after the `burn` computation, add:
```typescript
  const evm = computeEvm(input.tasks, today, { blendedRate: projectBlendedInternalRate(input.roles) });
```
- Add `evm,` to the returned model object.

- [ ] **Step 4: Run — expect PASS + tsc.** `npm run test:run -- dashboard` ; `npx tsc --noEmit; echo "tsc exit: $?"`. NOTE: `dashboard-panel.tsx` reads `model` — adding a field doesn't break it. Existing dashboard tests still pass (the new model field is additive).

- [ ] **Step 5: Commit.**
```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts
git commit -F - <<'EOF'
feat: add task-effort EVM to the dashboard model
EOF
```

---

## Task 3: i18n keys (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: EN keys** — add to `enUS` in `i18n.ts`:
```typescript
  evmTitle: "Earned value",
  evmPv: "Planned (PV)",
  evmEv: "Earned (EV)",
  evmAc: "Actual (AC)",
  evmSpi: "SPI",
  evmCpi: "CPI",
  evmSv: "Schedule var. (SV)",
  evmCv: "Cost var. (CV)",
  evmNoEstimates: "No task estimates yet.",
  evmCoverage: "{0} of {1} tasks have estimates",
```
- [ ] **Step 2: DE keys** — add the SAME keys to `i18n.de.ts` (straight ASCII `"`; real umlauts to match the file):
```typescript
  evmTitle: "Earned Value",
  evmPv: "Plan (PV)",
  evmEv: "Ertrag (EV)",
  evmAc: "Ist (AC)",
  evmSpi: "SPI",
  evmCpi: "CPI",
  evmSv: "Terminabw. (SV)",
  evmCv: "Kostenabw. (CV)",
  evmNoEstimates: "Noch keine Aufwandsschätzungen.",
  evmCoverage: "{0} von {1} Aufgaben haben Schätzungen",
```
- [ ] **Step 3: Verify.** `npx tsc --noEmit; echo "tsc exit: $?"` (0 — proves EN/DE parity). PowerShell curly-quote spot-check on the new DE lines is unnecessary beyond tsc (a curled delimiter fails tsc); just confirm the added DE lines use straight `"`.
- [ ] **Step 4: Commit.**
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: EVM i18n keys (EN + DE)
EOF
```

---

## Task 4: Dashboard burn-band EVM tiles

**Files:** Modify `src/app/dashboard-panel.tsx`.

READ the current budget-burn `Section` in `dashboard-panel.tsx` first (it renders `model.burn` tiles or a "no budget" note).

- [ ] **Step 1.** Inside the budget-burn `<Section title={t(lang, "dashboardBudgetBurn")}>`, AFTER the existing burn block (the `model.burn ? (...) : (...)`), append an EVM block:
```tsx
{model.evm.coverage.withEstimate > 0 ? (
  <div className="mt-2 flex flex-wrap gap-2">
    <Tile label={t(lang, "evmSpi")} value={model.evm.spi != null ? model.evm.spi.toFixed(2) : "—"} />
    <Tile label={t(lang, "evmCpi")} value={model.evm.cpi != null ? model.evm.cpi.toFixed(2) : "—"} />
  </div>
) : (
  <p className="mt-2 text-sm text-muted-foreground">{t(lang, "evmNoEstimates")}</p>
)}
```
(`Tile` is already imported. SPI/CPI on the dashboard at-a-glance; the full PV/EV/AC/SV/CV table lives in the Budget Report — Task 5.)

- [ ] **Step 2: Verify.** The dashboard-panel smoke test renders an empty workspace → `model.evm.coverage.withEstimate === 0` → shows the "no estimates" note (no crash). Run `npm run test:run -- dashboard-panel` ; `npx tsc --noEmit; echo "tsc exit: $?"` ; `npm run lint`.

- [ ] **Step 3: Commit.**
```bash
git add src/app/dashboard-panel.tsx
git commit -F - <<'EOF'
feat: SPI/CPI tiles on the dashboard burn band
EOF
```

---

## Task 5: Budget Report EVM section + tasks prop wiring

**Files:** Modify `src/app/budget-report-panel.tsx`, `src/app/workspace-section.tsx`.

READ `budget-report-panel.tsx` first — note its `Props`, its `money(...)` and `pct(...)` formatters, the `Section`/`Tile` usage, and the project-rollup section. Note it does NOT currently receive `tasks` or `today`.

- [ ] **Step 1: Add props + compute EVM.** In `budget-report-panel.tsx`:
- Add to `Props`: `tasks: Task[];` and `today: string;` (import `Task` from `./types` if needed).
- Add imports: `import { computeEvm, projectBlendedInternalRate } from "./evm";`
- Compute (near the existing `report` useMemo):
```typescript
  const evm = useMemo(
    () => computeEvm(tasks, today, { blendedRate: projectBlendedInternalRate(roles) }),
    [tasks, today, roles],
  );
```
- Add an EVM `Section` after the project-rollup section. Use the panel's existing `money(...)` for € and `Math.round(h)` + an "h" suffix for hours. A small inline helper keeps cells tidy:
```tsx
{(() => {
  const hm = (h: number, m: number | undefined) => `${Math.round(h)}h${m != null ? ` (${money(m)})` : ""}`;
  return (
    <Section title={t(lang, "evmTitle")}>
      {evm.coverage.withEstimate === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "evmNoEstimates")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={t(lang, "evmPv")} value={hm(evm.pv, evm.money?.pv)} />
            <Tile label={t(lang, "evmEv")} value={hm(evm.ev, evm.money?.ev)} />
            <Tile label={t(lang, "evmAc")} value={hm(evm.ac, evm.money?.ac)} />
            <Tile label={t(lang, "evmSpi")} value={evm.spi != null ? evm.spi.toFixed(2) : "—"} />
            <Tile label={t(lang, "evmCpi")} value={evm.cpi != null ? evm.cpi.toFixed(2) : "—"} />
            <Tile label={t(lang, "evmSv")} value={hm(evm.sv, evm.money?.sv)} />
            <Tile label={t(lang, "evmCv")} value={hm(evm.cv, evm.money?.cv)} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t(lang, "evmCoverage", String(evm.coverage.withEstimate), String(evm.coverage.total))}</p>
        </>
      )}
    </Section>
  );
})()}
```
(Adapt `money`'s exact name/signature to the real one in the file. If `Section`/`Tile` aren't already imported there, they are — the project rollup uses them.)

- [ ] **Step 2: Thread `tasks` + `today` from `workspace-section.tsx`.** Find the `<BudgetReportPanel ... />` mount and add `tasks={tasks}` and `today={today}` (both in scope in workspace-section). 

- [ ] **Step 3: Verify.** `npx tsc --noEmit; echo "tsc exit: $?"` (0) ; `npm run lint` (clean) ; `npm run test:run` (full suite — if a budget-report-panel test exists and now needs the `tasks`/`today` props, add them to its render call; report that).

- [ ] **Step 4: Commit.**
```bash
git add src/app/budget-report-panel.tsx src/app/workspace-section.tsx
git commit -F - <<'EOF'
feat: full EVM table (hours + EUR) in the Budget Report
EOF
```

---

## Task 6: Final verification

- [ ] `npm run test:run` — all pass.
- [ ] `npm run test:coverage` — gate (70%) holds; `evm.ts` well covered.
- [ ] `npx tsc --noEmit; echo "tsc exit: $?"` (0) ; `npm run lint` (clean).
- [ ] **Manual smoke** (optional): `npm run dev` — give a couple of tasks estimates + time spent + completion; the dashboard burn band shows SPI/CPI; the Budget Report shows the full EVM table (hours + €); with no estimates, both show the "no estimates" note.
- [ ] Restore dev churn if any: `git checkout -- sample-workspace.md`.

---

## Self-review (plan author)

**Spec coverage:** `evm.ts` (computeEvm + projectBlendedInternalRate, participation gate, null-guards, money overlay) → T1. Dashboard model + computeDashboard → T2. i18n → T3. Burn-band SPI/CPI tiles → T4. Budget Report full table + tasks/today wiring → T5. Verify → T6. No persistence/nav/entity (correct — none in spec).

**Deviations (intentional):** dashboard burn band shows SPI/CPI only (SV/CV + PV/EV/AC live in the Budget Report full table) — at-a-glance vs detail, per the spec's "(and SV/CV)" being parenthetical. RAG influence deferred (informational v1) — REMINDER to fold thresholds later is recorded in the spec's Out-of-scope section.

**Placeholder scan:** the only "adapt to the real name" spots are `money(...)`'s exact signature and confirming `Section`/`Tile`/`Task` imports in budget-report-panel — each names the exact sibling (the project-rollup section) to copy, guarded by tsc + the full suite.

**Type consistency:** `EvmMetrics` (pv/ev/ac/spi/cpi/sv/cv/money/coverage), `computeEvm(tasks, today, {blendedRate})`, `projectBlendedInternalRate(roles)`, and `DashboardModel.evm` are used identically across T1/T2/T4/T5.
