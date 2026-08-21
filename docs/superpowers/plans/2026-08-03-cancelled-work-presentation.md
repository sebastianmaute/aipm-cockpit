# Cancelled Work Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three places where 0.213.0's cancelled-work semantics read wrong — Reports tiles that no longer sum, an all-cancelled project reading "0% complete", and a cancelled task showing the same green ✓ as a delivered one.

**Architecture:** Three narrow presentation changes plus one additive optional prop on the shared `Tile` primitive. No engine changes: `computeStats` already returns `cancelled` and `computeDashboardProgress` already returns `inScope`; both were added in 0.213.0. Nothing here alters stored or aggregated data.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest + @testing-library/react, Playwright + axe, Tailwind v4 with AIPM palette tokens.

---

## Read before starting

`AGENTS.md` in the repo root. These apply to every task:

- **Never read a gate's exit code through a pipe.** `cmd | tail` returns `tail`'s status, so a failing suite reads as green. Redirect, `echo "EXIT=$?"` unpiped, then read the file:
  ```bash
  npx vitest run <files> --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t.log
  npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
  ```
- `npm run lint` is bare `eslint` with no `--max-warnings` flag — it exits 0 with warnings present and does NOT reproduce the CI gate.
- An unused import or variable is **fatal** at `--max-warnings=0`.
- `--reporter=basic` does not exist in this vitest. Use `--reporter=dot`.
- vitest never typechecks. Run `npx tsc --noEmit` after editing **any** test.
- `i18n.ts` (EN) and `i18n.de.ts` (DE) key sets must be identical — tsc enforces it. **`i18n.de.ts` is CRLF and the Edit tool curls double quotes there.** None of this plan's DE strings contain umlauts, but patch via a node utf8 write anchored on `\r?\n` anyway and grep to verify — a `\n` anchor silently matches nothing while exiting 0.
- Interpolated i18n strings use 0-based positional placeholders (`{0}`, `{1}`).
- Palette: only sanctioned tokens. No gradients, no raw shadows; the guard scans comments too.

**A trap from the previous plan, do not repeat it:** a fixture helper written as
`({ id: 1, status: "To Do" } as Task & typeof over)` uses `over` only in the type
cast and never spreads it, so every override silently does nothing and tests pass
against broken code. Always spread: `({ ...defaults, ...over } as Task)`.

---

## File structure

**Modified**

| File | Change |
|---|---|
| `src/app/report-table.tsx` | `Tile` gains an optional `sub` slot |
| `src/app/report-table.test.tsx` | its test |
| `src/app/reports.tsx` | Total tile passes `sub` conditionally |
| `src/app/reports.test.tsx` | its test |
| `src/app/dashboard-panel.tsx` | completion tile gains the no-active-scope state |
| `src/app/dashboard-panel.test.tsx` | its tests |
| `src/app/task-row.tsx` | closed branch splits: delivered ✓ / cancelled ✕ |
| `src/app/task-row.test.tsx` | its tests |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | three new keys |

No new files. No engine changes.

---

## Task 1: `Tile` gains an optional `sub` slot

**Files:**
- Modify: `src/app/report-table.tsx:275-311`
- Test: `src/app/report-table.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/report-table.test.tsx`, matching the file's existing import style (read the top of the file first):

```tsx
describe("Tile sub slot", () => {
  it("renders the sub line under the value when given", () => {
    render(<Tile label="Total" value={10} sub="2 cancelled" />);
    expect(screen.getByText("2 cancelled")).toBeInTheDocument();
  });

  it("renders no sub line when omitted", () => {
    const { container } = render(<Tile label="Total" value={10} />);
    expect(container.textContent).not.toContain("cancelled");
    expect(container.querySelector("[data-tile-sub]")).toBeNull();
  });
});
```

The second case is the one that matters: it pins "absent unless asked for", which is what makes this change invisible to the ~20 existing call sites.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/report-table.test.tsx --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```

Expected: FAIL — `sub` is not a prop, so nothing renders and `getByText` throws.

- [ ] **Step 3: Add the prop**

`src/app/report-table.tsx` — add to the destructure and the type:

```tsx
export function Tile({
  label, value, rag, trend, bar, sub, onActivate, activateLabel, hint,
  danger = false, size = "xl", flat = false,
}: {
```

```tsx
  /** Small muted line under the value. For a qualifier the headline number needs
   *  to stay honest (e.g. "2 cancelled" under a Total that no longer equals
   *  open + completed) — NOT for a second metric, which wants its own tile. */
  sub?: React.ReactNode;
```

Render it inside `inner`, after the `bar` slot and before `trend`:

```tsx
      {bar ? <div className="mt-1.5">{bar}</div> : null}
      {sub ? (
        <p data-tile-sub className="mt-1 text-xs text-muted-foreground">{sub}</p>
      ) : null}
      {trend ? <div className="mt-1">{trend}</div> : null}
```

`text-muted-foreground` is the sanctioned muted token. The `data-tile-sub` attribute exists only so the absence test can assert on structure rather than on text that might coincidentally appear.

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/app/report-table.test.tsx --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/report-table.tsx src/app/report-table.test.tsx
git commit -m "feat(ui): Tile gains an optional sub slot for a headline qualifier"
```

---

## Task 2: Reports Total tile names the cancelled count

**Files:**
- Modify: `src/app/reports.tsx:281`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/reports.test.tsx`

- [ ] **Step 1: Add the i18n key**

`src/app/i18n.ts`, next to the other `reports*` keys (`reportsTotal` is at :1127, `reportsCancelled` at :1130):

```ts
  reportsCancelledCount: "{0} cancelled",
```

`src/app/i18n.de.ts` — same key, value `"{0} abgebrochen"`. No umlaut, but the file is CRLF and the Edit tool curls double quotes there. Patch with a node utf8 write anchored on `\r?\n`, then:

```bash
grep -c "reportsCancelledCount" src/app/i18n.de.ts
```

Expected: `1`.

- [ ] **Step 2: Write the failing test**

Append to `src/app/reports.test.tsx`, using whatever render helper and task factory the file already provides — **read the top of the file and use the real names**:

```tsx
it("names the cancelled count under Total when there is any", () => {
  renderReports({ tasks: [
    task({ id: 1, status: "To Do", dueDate: "2027-01-01" }),
    task({ id: 2, status: "Cancelled" }),
  ] });
  expect(screen.getByText(t("en-US", "reportsCancelledCount", "1"))).toBeInTheDocument();
});

it("shows no cancelled line when nothing is cancelled", () => {
  const { container } = renderReports({ tasks: [
    task({ id: 1, status: "To Do", dueDate: "2027-01-01" }),
  ] });
  expect(container.querySelector("[data-tile-sub]")).toBeNull();
});
```

The second test is the load-bearing one — it pins that an unaffected project renders exactly as before.

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run src/app/reports.test.tsx --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t2.log
```

- [ ] **Step 4: Pass the sub conditionally**

`src/app/reports.tsx:281` becomes:

```tsx
        <Tile
          label={t(lang, "reportsTotal")}
          value={stats.total}
          sub={stats.cancelled > 0 ? t(lang, "reportsCancelledCount", String(stats.cancelled)) : undefined}
          size="2xl"
          flat
        />
```

`Total` keeps meaning every task. Do NOT change its value to `total - cancelled` — that was considered and rejected, because it deletes the inventory count.

- [ ] **Step 5: Run the tests and the gates**

```bash
npx vitest run src/app/reports.test.tsx src/app/reports-stats.test.ts src/app/i18n-encoding.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t2.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

tsc is what catches an EN/DE key-set mismatch.

- [ ] **Step 6: Commit**

```bash
git add src/app/reports.tsx src/app/reports.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(reports): name the cancelled count under Total so the tiles reconcile"
```

---

## Task 3: The completion tile separates "abandoned" from "not started"

**Files:**
- Modify: `src/app/dashboard-panel.tsx:334-341`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/dashboard-panel.test.tsx`

- [ ] **Step 1: Add the i18n keys**

`src/app/i18n.ts`, next to `dashboardPercentComplete` (:2156) and `dashboardCompletedOf` (:2157):

```ts
  dashboardNoActiveScope: "No active scope",
  dashboardAllCancelled: "{0} tasks, all cancelled",
```

`src/app/i18n.de.ts` — `"Kein aktiver Umfang"` and `"{0} Aufgaben, alle abgebrochen"`. No umlauts; still patch via node and grep to verify both landed.

- [ ] **Step 2: Write the failing tests**

`renderDashboard()` in `dashboard-panel.test.tsx:79` hardcodes its task list, so it cannot express these fixtures. **Add a second local helper beside it** that takes tasks, copying `renderDashboard`'s existing prop list verbatim and changing only `tasks`. Read that helper in full before writing — do not guess its props.

```tsx
describe("DashboardPanel completion tile", () => {
  it("reads as no-active-scope when every task is cancelled", () => {
    renderDashboardWithTasks([
      { id: 1, title: "a", status: "Cancelled", health: "G", linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [] } as never,
      { id: 2, title: "b", status: "Cancelled", health: "G", linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [] } as never,
    ]);
    expect(screen.getByText(t("en-US", "dashboardNoActiveScope"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "dashboardAllCancelled", "2"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "dashboardPercentComplete", "0"))).toBeNull();
  });

  it("leaves an empty project on 0% complete", () => {
    renderDashboardWithTasks([]);
    expect(screen.getByText(t("en-US", "dashboardPercentComplete", "0"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "dashboardNoActiveScope"))).toBeNull();
  });
});
```

Both are required. The second pins the deliberate exclusion of `total === 0`; without it, a change that fires on any empty denominator would pass.

- [ ] **Step 3: Run them to verify they fail**

```bash
npx vitest run src/app/dashboard-panel.test.tsx --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t3.log
```

Expected: the first FAILS (no such text), the second PASSES already.

- [ ] **Step 4: Add the state**

`src/app/dashboard-panel.tsx` — above the `<Section title={t(lang, "dashboardProgress")} boxed>` block, hoist the condition to a scalar (a complex expression inside JSX is fine, but this reads once and is used four times):

```tsx
  const noActiveScope = model.progress.total > 0 && model.progress.inScope === 0;
```

Then the completion tile becomes:

```tsx
                <Tile
                  label={noActiveScope
                    ? t(lang, "dashboardNoActiveScope")
                    : t(lang, "dashboardPercentComplete", String(model.progress.percent))}
                  value={noActiveScope
                    ? t(lang, "dashboardAllCancelled", String(model.progress.total))
                    : t(lang, "dashboardCompletedOf", String(model.progress.completed), String(model.progress.inScope))}
                  onActivate={props.onNavigate ? () => props.onNavigate!("open-points") : undefined}
                  activateLabel={noActiveScope
                    ? `${t(lang, "dashboardNoActiveScope")} – ${t(lang, "dashboardOpenTasksView")}`
                    : `${t(lang, "dashboardPercentComplete", String(model.progress.percent))} – ${t(lang, "dashboardOpenTasksView")}`}
                />
```

`activateLabel` must track the label — it is the tile's accessible name, and leaving it saying "0% complete" while the visible label says "No active scope" is a WCAG 2.5.3 mismatch (visible text must be contained in the accessible name).

- [ ] **Step 5: Run and commit**

```bash
npx vitest run src/app/dashboard-panel.test.tsx src/app/dashboard.test.ts src/app/i18n-encoding.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t3.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(dashboard): an all-cancelled project reads as no active scope, not 0% complete"
```

---

## Task 4: A cancelled task's glyph differs by shape

**Files:**
- Modify: `src/app/task-row.tsx:408-412`
- Test: `src/app/task-row.test.tsx`

- [ ] **Step 1: Write the failing tests**

`renderRow` at `task-row.test.tsx:980` is scoped inside `describe("TaskRow inline cell editing")` and is not reachable from a new top-level block. **Read that helper and the module-level `rowWrapper` it calls, then write a local render in your own describe** following the same shape.

```tsx
describe("TaskRow closed glyph", () => {
  it("shows a cross, not a check, for a cancelled task", () => {
    const { container } = renderClosedRow(makeTask({ id: 1, status: "Cancelled" }));
    expect(container.textContent).toContain("✕");
    expect(container.textContent).not.toContain("✓");
  });

  it("still shows the check for a delivered task", () => {
    const { container } = renderClosedRow(
      makeTask({ id: 2, status: "Done", completedDate: "2026-05-20" }),
    );
    expect(container.textContent).toContain("✓");
    expect(container.textContent).not.toContain("✕");
  });
});
```

Each test asserts BOTH presence and absence. Asserting only "✕ is present" would pass if the code rendered both glyphs; asserting only "✓ is absent" would pass if it rendered nothing at all.

Use the file's real task factory. If it has none at module scope, build one and **spread the overrides** — see the trap noted at the top of this plan.

- [ ] **Step 2: Run them to verify the first fails**

```bash
npx vitest run src/app/task-row.test.tsx --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t4.log
```

Expected: "shows a cross" FAILS (a cancelled task currently renders ✓); "still shows the check" PASSES.

- [ ] **Step 3: Split the branch**

`src/app/task-row.tsx:408-412`. Both predicates are already imported at line 6 — do not add an import.

```tsx
          {isClosed && !task.healthOverride ? (
            isTaskDelivered(task) ? (
              <span role="img" title={label} aria-label={label} className="text-ui-green-strong">✓</span>
            ) : (
              // Closed but NOT delivered — cancelled. Differs from a delivered
              // row by GLYPH SHAPE, not colour: the Status column is hideable,
              // and a colour-only distinction is the WCAG 1.4.1 pattern this
              // repo already tracks two open follow-ups about.
              <span role="img" title={label} aria-label={label} className="text-muted-foreground">✕</span>
            )
          ) : (
            <RagDot level={health.color} size="md" label={label} />
          )}
```

`label` is unchanged in both arms — `formatHealthTooltip` already yields "cancelled" where a delivered task yields "Completed on {date}", so AT already distinguishes them. This adds the visual channel only.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/app/task-row.test.tsx src/app/tasks-section.test.tsx --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t4.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

```bash
git add src/app/task-row.tsx src/app/task-row.test.tsx
git commit -m "fix(tasks): a cancelled row shows a muted cross, not a green check"
```

---

## Task 5: Full gate run

**Files:** none — verification.

- [ ] **Step 1: Unit suite with coverage**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "COVERAGE_EXIT=$?" >> /tmp/cov.log
grep -E "COVERAGE_EXIT|Test Files|Tests " /tmp/cov.log | tail -5
```

Write the exit code INTO the log. A background task's reported exit code is the last command's, not the suite's — that trap reported a 20-failure axe run as a pass earlier in this line of work.

Coverage floors are blocking in CI and `test:run` does not enforce them.

- [ ] **Step 2: Lint, typecheck, ratchets**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
node scripts/check-file-sizes.mjs; echo "EXIT=$?"
node scripts/check-agents-symbols.mjs; echo "EXIT=$?"
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP_EXIT=$?"
```

- [ ] **Step 3: axe on a FRESH, WARM server**

Reports, Dashboard and Open Points are all in `A11Y_VIEWS` and all three change here.

```bash
PORT=3100 npm run dev > /tmp/dev.log 2>&1 &
until curl -sf -o /dev/null http://localhost:3100/; do sleep 2; done; echo "WARM"
PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium > /tmp/a11y.log 2>&1
echo "AXE_EXIT=$?"
grep -E "passed|failed" /tmp/a11y.log | tail -3
PORT=3100 npm run stop
```

Expected: 86 passed, `AXE_EXIT=0`. **Warm the server first.** A cold Turbopack compile exceeds the 60s per-test timeout and produces ~20 phantom failures that look exactly like real a11y regressions.

- [ ] **Step 4: Eye-verify what no gate can see**

1. Reports with cancelled tasks: the sub-line sits under Total and reads correctly at `sm` and below.
2. Reports with none cancelled: no sub-line, tiles identical to before.
3. A project with every task cancelled: the completion tile reads "No active scope".
4. A brand-new empty project: still 0%.
5. Open Points: a cancelled row shows a muted ✕, a done row a green ✓, and both are legible in a dark scheme.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "test: fixes from the full gate run"
```

---

## Release

These are user-visible changes, so the repo's rules require a version bump —
`src/app/version.ts`, `CHANGELOG.md`, a `versionHighlight*` key in EN and DE, plus
the five ungated locations (`package.json`, **two** `package-lock.json`
occurrences, the README badge's version AND codename, and the five
`docs/CODEMAPS/*.md` headers). Codenames are unique; grep `CHANGELOG.md` before
choosing.

**Not included as a task here.** Whether this ships as its own release or rides
along with other work is the user's call, and the version number depends on that
answer. Ask before bumping.
