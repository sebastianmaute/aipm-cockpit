# Sample Budget Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single empty "Bucket 1" in `sample-workspace.md` with five buckets that exercise detailed/blended planning, per-bucket rate overrides, fixed-price, and closed-with-successor spillover.

**Architecture:** Author the five buckets as `BudgetBucket` objects and serialize the Budgets table rows with the app's OWN markdown encoder (`workspaceToMarkdown`, via a throwaway generator test) so the `;`/`~`/`|` allocation codec is escaped correctly; splice ONLY the Budgets data rows into the file. A permanent round-trip test guards the result.

**Tech Stack:** TypeScript, Vitest. (Seed-data + test only — no app code changes, no version bump.)

**Reference spec:** `docs/superpowers/specs/2026-06-02-sample-budget-data-design.md`

**Conventions:** NO `Co-Authored-By` trailer; do not skip hooks. The dev server may overwrite `sample-workspace.md` — only edit it while the dev server is stopped, and stage it deliberately.

---

### Task 1: Seed five budget buckets into `sample-workspace.md` (generated + verified)

**Files:**
- Modify: `sample-workspace.md` (the `# Budgets` data rows only)
- Test (create, permanent): `src/app/sample-workspace-budget.test.ts`
- Test (create, THROWAWAY generator — delete before committing): `src/app/gen-sample-budgets.test.ts`

The five buckets (exact objects — `BudgetBucket[]`):
```ts
const SAMPLE_BUDGETS = [
  { id: 1, name: "Identity Platform – T&M", poNumber: "4400125303", type: "tm" as const, currency: "EUR" as const, startDate: "2026-04-01", endDate: "2026-07-31", status: "open" as const, order: 0, planningMode: "detailed" as const,
    allocations: [
      { roleId: 1, resourceIds: [1], budgetHours: { "2026-04": 120, "2026-05": 120, "2026-06": 80, "2026-07": 60 }, actualHours: { "2026-04": 118, "2026-05": 130, "2026-06": 44 } },
      { roleId: 3, resourceIds: [3], budgetHours: { "2026-04": 60, "2026-05": 80, "2026-06": 70, "2026-07": 40 }, actualHours: { "2026-04": 55, "2026-05": 78 } },
      { roleId: 4, resourceIds: [4], budgetHours: { "2026-04": 40, "2026-05": 40, "2026-06": 40, "2026-07": 30 }, actualHours: { "2026-04": 42, "2026-05": 38 } },
    ] },
  { id: 2, name: "Advisory Retainer (blended)", poNumber: "4400141354", type: "tm" as const, currency: "EUR" as const, startDate: "2026-04-01", endDate: "2026-07-31", status: "open" as const, order: 1, planningMode: "blended" as const, allocations: [],
    disciplineAllocations: [
      { disciplineId: 3, resourceIds: [5], budgetHours: { "2026-04": 80, "2026-05": 80, "2026-06": 60 }, actualHours: { "2026-04": 75, "2026-05": 82 } },
      { disciplineId: 1, resourceIds: [2], budgetHours: { "2026-04": 40, "2026-05": 40 }, actualHours: { "2026-04": 38, "2026-05": 36 } },
    ] },
  { id: 3, name: "Capped SOW (rate override)", poNumber: "4400087177", type: "tm" as const, currency: "EUR" as const, startDate: "2026-04-01", endDate: "2026-07-31", status: "open" as const, order: 2, planningMode: "detailed" as const, rateOverrideInternal: 90, rateOverrideExternal: 200,
    allocations: [
      { roleId: 2, resourceIds: [2], budgetHours: { "2026-04": 50, "2026-05": 50, "2026-06": 50 }, actualHours: { "2026-04": 48, "2026-05": 52 } },
    ] },
  { id: 4, name: "Data Migration (fixed price)", poNumber: "4400098499", type: "fixed" as const, currency: "EUR" as const, fixedPriceAmount: 80000, startDate: "2026-04-01", endDate: "2026-07-31", status: "open" as const, order: 3, planningMode: "detailed" as const,
    allocations: [
      { roleId: 1, resourceIds: [1], budgetHours: { "2026-04": 60, "2026-05": 60 }, actualHours: { "2026-04": 62, "2026-05": 58 } },
      { roleId: 5, resourceIds: [5], budgetHours: { "2026-04": 40 }, actualHours: { "2026-04": 40 } },
    ] },
  { id: 5, name: "Discovery Phase (closed)", poNumber: "4400053230", type: "tm" as const, currency: "EUR" as const, startDate: "2026-04-01", endDate: "2026-04-30", status: "closed" as const, closedDate: "2026-04-30", successorId: 1, order: 4, planningMode: "detailed" as const,
    allocations: [
      { roleId: 3, resourceIds: [3], budgetHours: { "2026-04": 50 }, actualHours: { "2026-04": 30 } },
    ] },
];
```

- [ ] **Step 1: Write the permanent verification test `src/app/sample-workspace-budget.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markdownToWorkspace } from "./storage";
import { computeBudgetReport } from "./budget-report";

const md = readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace.md"), "utf8");
const ws = markdownToWorkspace(md);

describe("sample-workspace budgets", () => {
  test("parses five buckets", () => {
    expect(ws.budgets?.map((b) => b.id).sort()).toEqual([1, 2, 3, 4, 5]);
  });
  test("bucket 1 is detailed with three role allocations and real hours", () => {
    const b = ws.budgets!.find((x) => x.id === 1)!;
    expect(b.planningMode ?? "detailed").toBe("detailed");
    expect(b.allocations).toHaveLength(3);
    const r1 = b.allocations.find((a) => a.roleId === 1)!;
    expect(r1.budgetHours["2026-04"]).toBe(120);
    expect(r1.actualHours["2026-05"]).toBe(130);
  });
  test("bucket 2 is blended with two discipline allocations", () => {
    const b = ws.budgets!.find((x) => x.id === 2)!;
    expect(b.planningMode).toBe("blended");
    expect(b.disciplineAllocations).toHaveLength(2);
    expect(b.disciplineAllocations!.find((a) => a.disciplineId === 3)!.budgetHours["2026-04"]).toBe(80);
  });
  test("bucket 3 carries per-bucket rate overrides", () => {
    const b = ws.budgets!.find((x) => x.id === 3)!;
    expect(b.rateOverrideInternal).toBe(90);
    expect(b.rateOverrideExternal).toBe(200);
  });
  test("bucket 4 is fixed-price", () => {
    const b = ws.budgets!.find((x) => x.id === 4)!;
    expect(b.type).toBe("fixed");
    expect(b.fixedPriceAmount).toBe(80000);
  });
  test("bucket 5 is closed with a successor", () => {
    const b = ws.budgets!.find((x) => x.id === 5)!;
    expect(b.status).toBe("closed");
    expect(b.successorId).toBe(1);
  });
  test("computeBudgetReport yields non-zero project rollup", () => {
    const rep = computeBudgetReport(ws.budgets!, ws.plan, ws.roles, ws.resources, 8, new Set<string>(), ws.absences);
    expect(rep.project.budgetHours).toBeGreaterThan(0);
    expect(rep.project.actualHours).toBeGreaterThan(0);
    expect(rep.project.revenue).toBeGreaterThan(0);
    expect(rep.project.cost).toBeGreaterThan(0);
  });
});
```
(Confirm `markdownToWorkspace` returns a `Workspace` whose `.plan`, `.roles`, `.resources`, `.absences`, `.budgets` are populated — it does; mirror the arg order of `computeBudgetReport` from existing budget-report tests: `(buckets, plan, roles, resources, workdayHours, holidaySet, absences)`.)

- [ ] **Step 2: Run the verification test — expect FAIL**

Run: `npx vitest run src/app/sample-workspace-budget.test.ts`
Expected: FAIL — the current file has one bucket (`Bucket 1`), so "parses five buckets" and the others fail.

- [ ] **Step 3: Write the throwaway generator `src/app/gen-sample-budgets.test.ts`**

This uses the app's real encoder to produce correctly-escaped Budgets rows and splices them into `sample-workspace.md`, replacing the existing `# Budgets` section body up to (not including) `## Plan`.

```ts
import { test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspaceToMarkdown, emptyWorkspace } from "./storage";

const SAMPLE_BUDGETS = [ /* paste the BudgetBucket[] from this task verbatim */ ];

test("GENERATOR: rewrite sample-workspace.md Budgets section", () => {
  // 1) Emit a minimal workspace's markdown with ONLY these budgets, using the
  //    app's real encoder (correct pipe-escaping for allocation period-maps).
  const genMd = workspaceToMarkdown({ ...emptyWorkspace(), budgets: SAMPLE_BUDGETS as never });
  // 2) Extract the "# Budgets" section block from genMd: from the "# Budgets"
  //    line up to the next line that starts with "#" (a new top-level section)
  //    or the "## Plan" subsection — whichever comes first.
  const genLines = genMd.split("\n");
  const gStart = genLines.findIndex((l) => l.trim() === "# Budgets");
  let gEnd = genLines.length;
  for (let i = gStart + 1; i < genLines.length; i++) {
    if (/^#/.test(genLines[i])) { gEnd = i; break; }
  }
  const budgetsBlock = genLines.slice(gStart, gEnd).join("\n").replace(/\s+$/, "") + "\n";

  // 3) Splice into the real file: replace from its "# Budgets" line up to the
  //    line before "## Plan".
  const file = readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace.md"), "utf8");
  const lines = file.split("\n");
  const fStart = lines.findIndex((l) => l.trim() === "# Budgets");
  const fPlan = lines.findIndex((l, i) => i > fStart && l.trim().startsWith("## Plan"));
  if (fStart < 0 || fPlan < 0) throw new Error("could not locate Budgets/Plan markers");
  const before = lines.slice(0, fStart).join("\n");
  const after = lines.slice(fPlan).join("\n");
  writeFileSync(
    join(import.meta.dirname, "..", "..", "sample-workspace.md"),
    `${before}${budgetsBlock}\n${after}`,
    "utf8",
  );
});
```

- [ ] **Step 4: Run the generator (rewrites the file), then DELETE it**

Ensure the dev server is stopped (so it can't overwrite the file). Run:
`npx vitest run src/app/gen-sample-budgets.test.ts`
Then delete the throwaway: PowerShell `Remove-Item src/app/gen-sample-budgets.test.ts`.
Inspect `sample-workspace.md`: the `# Budgets` table now has five data rows; the `# Budgets`/header/separator lines and the `## Plan` section are intact; no other section changed (`git diff --stat sample-workspace.md` should show only that file).

- [ ] **Step 5: Run the verification test — expect PASS**

Run: `npx vitest run src/app/sample-workspace-budget.test.ts`
Expected: PASS (all 7 assertions). If a bucket field didn't round-trip, inspect the generated rows and the codec; do NOT hand-edit the allocation cells — re-run the generator.

- [ ] **Step 6: Full gate + commit**

Confirm the throwaway generator is deleted (it must NOT be committed or run in CI — it rewrites a tracked file). Then:
`npx vitest run && npx tsc --noEmit && npx eslint .` — all green.
```bash
git add sample-workspace.md src/app/sample-workspace-budget.test.ts
git commit -m "chore: seed sample-workspace budgets for planning modes, overrides, fixed-price, spillover"
```

---

## Final verification (after the task)

- [ ] `git status` shows no stray `gen-sample-budgets.test.ts`; `git diff --cached --stat` lists only `sample-workspace.md` + `sample-workspace-budget.test.ts`.
- [ ] `npx vitest run` green (incl. the existing `storage-budget-md` round-trip and the new sample test); `tsc`/`eslint` clean.
- [ ] App smoke (optional, dev server): Budget panel shows 5 buckets (detailed tables, blended discipline table, override, fixed-price CCI, closed/spillover); Reports → Budget Report renders non-zero per-bucket figures.
