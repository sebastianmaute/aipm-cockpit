# Planning / Budget UX + Data Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Feature branch off `main` (e.g. `feat/planning-budget-batch`). `npx tsc --noEmit` + `npm run test:run` after each task. NOT a release until the user says "release".

**Goal:** Five planning/budget improvements — mode-aware `%`/`h` suffix on the planning utilization box, left-aligned date-column headers in planning + budget, an opt-in per-project "budget hours follow plan" live mirror, and a bucket-name search box.

**Architecture:** Slices 1/2/3/5 are UI-local (two panel files + i18n). Slice 4 adds an optional `ResourcePlan.budgetFollowsPlan` boolean threaded through the existing plan serialization surfaces (sanitize + CSV/MD/Turso), plus a toolbar toggle and a read-only "mirror planned hours" budget cell. Byte-stable strategy: CSV/MD emit the 5th plan cell **only when true**, so golden fixtures (sample has it absent) stay untouched.

**Tech Stack:** Next.js (forked) / React / TypeScript, vitest, i18n EN+DE (tsc parity-enforced), Playwright axe gate.

**Spec:** `docs/superpowers/specs/2026-07-10-planning-budget-batch-design.md`.

---

## Data layer facts (verified, use verbatim)

- `ResourcePlan` (`types.ts:502`) has four **required** fields: `startDate`, `endDate`, `granularity`, `currency`. No optional field exists yet.
- `sanitizePlan` (`sanitize-entities.ts:405`) is the single decode chokepoint for JSON/CSV/MD/Turso.
- CSV plan = positional line, encoder `csv-codecs-core.ts:617` `planToCsvLine`, decoder `csv-codecs-decode.ts:293` `parsePlanLine`.
- MD plan = positional line, encoder `markdown-codecs-core.ts:563` `planToMarkdown`, decoder `markdown-codecs-decode.ts:240` `parsePlanMarkdown`.
- Turso: `turso-schema.ts:71` `PLAN_COLUMNS` (drives DDL for single + tenant), single INSERT `turso-schema.ts:238`, tenant INSERT `turso-tenant-schema.ts:112`, decode via `sanitizePlan` at `turso-schema.ts:119-120`.
- JSON/IDB are whole-object pass-through; JSON decode routes through `sanitizePlan` (`workspace.ts:442`), IDB read is raw (native boolean round-trips).
- **String-vs-boolean gap:** JSON/IDB deliver real `boolean`; CSV/MD/Turso deliver strings — `sanitizePlan` guard MUST accept `true` OR `"true"`.
- Planned-hours engine: `allocationPlannedHours(alloc, period, canonicalPeriods, resources, workdayHours, holidaySet, granularity, absences)` (`budget-report.ts:18-40`); bucket periods via `bucketActivePeriods(bucket, plan)` (`budget-report.ts:11-15`).
- Plan setter thread for the toggle mirrors `onSetPlanWindow`: `use-resource-planner.ts:911/969` → `task-manager.tsx:600/1802` (wrapped `guardEdit`) → `workspace-section-types.ts:150` → `workspace-section.tsx:138/508`.

---

## Task 1: `ResourcePlan.budgetFollowsPlan` type + `sanitizePlan`

**Files:**
- Modify: `src/app/types.ts:502-506`
- Modify: `src/app/sanitize-entities.ts:405-417`
- Test: `src/app/sanitize.test.ts:152-167`

- [ ] **Step 1: Write the failing tests** — append to the `sanitizePlan` describe block in `sanitize.test.ts` (after line 167):

```ts
  it("keeps budgetFollowsPlan when true (boolean)", () => {
    const p = sanitizePlan({ startDate: "2026-01-01", endDate: "2026-06-30", granularity: "month", currency: "EUR", budgetFollowsPlan: true }, "2026-01-01");
    expect(p.budgetFollowsPlan).toBe(true);
  });
  it('coerces the string "true" from CSV/MD/Turso to boolean true', () => {
    const p = sanitizePlan({ startDate: "2026-01-01", endDate: "2026-06-30", granularity: "month", currency: "EUR", budgetFollowsPlan: "true" }, "2026-01-01");
    expect(p.budgetFollowsPlan).toBe(true);
  });
  it("omits budgetFollowsPlan when absent or falsy (no false key)", () => {
    const p = sanitizePlan({ startDate: "2026-01-01", endDate: "2026-06-30", granularity: "month", currency: "EUR" }, "2026-01-01");
    expect("budgetFollowsPlan" in p).toBe(false);
    const p2 = sanitizePlan({ startDate: "2026-01-01", endDate: "2026-06-30", granularity: "month", currency: "EUR", budgetFollowsPlan: "nope" }, "2026-01-01");
    expect("budgetFollowsPlan" in p2).toBe(false);
  });
```

- [ ] **Step 2: Run — verify FAIL**

Run: `npm run test:run -- sanitize.test.ts`
Expected: FAIL (`budgetFollowsPlan` unknown / not present).

- [ ] **Step 3: Add the type field** — `types.ts`, inside `ResourcePlan` (after `currency: string;`):

```ts
  /** When true, budget-hours cells for allocations WITH assigned resources
   *  mirror planned capacity (read-only). Absent ⇒ false (manual entry). */
  budgetFollowsPlan?: boolean;
```

- [ ] **Step 4: Wire `sanitizePlan`** — in `sanitize-entities.ts:405`, after the `currency` line add:

```ts
  const budgetFollowsPlan = raw.budgetFollowsPlan === true || raw.budgetFollowsPlan === "true";
```

Then spread it into BOTH return objects **only when true** (keeps the plan object byte-identical to today when off). Replace the two returns:

```ts
  if (!startDate || !endDate) {
    return { startDate: fallback.startDate, endDate: fallback.endDate, granularity, currency, ...(budgetFollowsPlan ? { budgetFollowsPlan: true } : {}) };
  }
  const [s, e] = endDate < startDate ? [endDate, startDate] : [startDate, endDate];
  return { startDate: s, endDate: e, granularity, currency, ...(budgetFollowsPlan ? { budgetFollowsPlan: true } : {}) };
```

- [ ] **Step 5: Run — verify PASS**

Run: `npm run test:run -- sanitize.test.ts` → PASS. Then `npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/types.ts src/app/sanitize-entities.ts src/app/sanitize.test.ts
git commit -m "feat(budget): add ResourcePlan.budgetFollowsPlan field + sanitize"
```

---

## Task 2: CSV + Markdown codecs (byte-stable conditional 5th cell)

**Files:**
- Modify: `src/app/csv-codecs-core.ts:617` (`planToCsvLine`)
- Modify: `src/app/csv-codecs-decode.ts:293` (`parsePlanLine`)
- Modify: `src/app/markdown-codecs-core.ts:563` (`planToMarkdown`)
- Modify: `src/app/markdown-codecs-decode.ts:240` (`parsePlanMarkdown`)
- Create: `src/app/plan-codec.test.ts`

- [ ] **Step 1: Write the failing test** — new file `src/app/plan-codec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { workspaceToCsv } from "./csv-codecs";
import { csvToWorkspace } from "./csv-codecs";
import { workspaceToMarkdown } from "./markdown-codecs";
import { markdownToWorkspace } from "./markdown-codecs";
import { emptyWorkspace } from "./workspace";

function wsWith(budgetFollowsPlan: boolean) {
  const ws = emptyWorkspace("2026-01-01");
  return { ...ws, plan: { ...ws.plan, startDate: "2026-01-01", endDate: "2026-06-30", granularity: "month" as const, currency: "EUR", ...(budgetFollowsPlan ? { budgetFollowsPlan: true } : {}) } };
}

describe("plan codec round-trip: budgetFollowsPlan", () => {
  it("CSV: true survives round-trip and emits a 5th plan cell", () => {
    const csv = workspaceToCsv(wsWith(true));
    expect(csv).toMatch(/2026-01-01,2026-06-30,month,EUR,true/);
    expect(csvToWorkspace(csv).plan.budgetFollowsPlan).toBe(true);
  });
  it("CSV: false/absent emits the legacy 4-cell line (byte-stable)", () => {
    const csv = workspaceToCsv(wsWith(false));
    expect(csv).toMatch(/2026-01-01,2026-06-30,month,EUR(\r?\n|$)/);
    expect("budgetFollowsPlan" in csvToWorkspace(csv).plan).toBe(false);
  });
  it("Markdown: true survives round-trip", () => {
    const md = workspaceToMarkdown(wsWith(true));
    expect(markdownToWorkspace(md).plan.budgetFollowsPlan).toBe(true);
  });
  it("Markdown: false emits legacy 4-cell line", () => {
    const md = workspaceToMarkdown(wsWith(false));
    expect("budgetFollowsPlan" in markdownToWorkspace(md).plan).toBe(false);
  });
});
```

> If `emptyWorkspace`'s exact name/signature differs, use the helper the other codec tests use to build a minimal workspace (check `golden-workspace.test.ts` imports); keep the plan shape identical.

- [ ] **Step 2: Run — verify FAIL**

Run: `npm run test:run -- plan-codec.test.ts`
Expected: FAIL (4-cell line only; no `,true`).

- [ ] **Step 3: CSV encoder** — `csv-codecs-core.ts:617`, replace `planToCsvLine` body:

```ts
export function planToCsvLine(p: ResourcePlan): string {
  const cells = [p.startDate, p.endDate, p.granularity, p.currency];
  if (p.budgetFollowsPlan) cells.push("true");
  return [CSV_SECTION_PLAN, cells.map(csvEscape).join(",")].join("\r\n");
}
```

- [ ] **Step 4: CSV decoder** — `csv-codecs-decode.ts:293`, add `cells[4]` to the `sanitizePlan` arg:

```ts
  return sanitizePlan({ startDate: cells[0], endDate: cells[1], granularity: cells[2], currency: cells[3], budgetFollowsPlan: cells[4] }, today);
```

- [ ] **Step 5: MD encoder** — `markdown-codecs-core.ts:563`, replace `planToMarkdown` body:

```ts
function planToMarkdown(p: ResourcePlan): string {
  const cells = [p.startDate, p.endDate, p.granularity, p.currency];
  if (p.budgetFollowsPlan) cells.push("true");
  return `## Plan\n\n${cells.join(",")}\n`;
}
```

- [ ] **Step 6: MD decoder** — `markdown-codecs-decode.ts:240`, add `cells[4]`:

```ts
    return sanitizePlan({ startDate: cells[0], endDate: cells[1], granularity: cells[2], currency: cells[3], budgetFollowsPlan: cells[4] }, today);
```

- [ ] **Step 7: Run — verify PASS + golden unchanged**

Run: `npm run test:run -- plan-codec.test.ts` → PASS.
Run: `npm run test:run -- golden-workspace.test.ts` → PASS (sample plan has no 5th cell ⇒ bytes unchanged; if this FAILS, a codec is emitting the cell unconditionally — fix the `if (p.budgetFollowsPlan)` guard, do NOT regenerate fixtures).
Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/csv-codecs-core.ts src/app/csv-codecs-decode.ts src/app/markdown-codecs-core.ts src/app/markdown-codecs-decode.ts src/app/plan-codec.test.ts
git commit -m "feat(budget): round-trip budgetFollowsPlan through CSV + Markdown codecs"
```

---

## Task 3: Turso persistence (single + tenant)

**Files:**
- Modify: `src/app/turso-schema.ts:71` (`PLAN_COLUMNS`), `:238` (single INSERT), and confirm the plan SELECT/decode at `:119-120`
- Modify: `src/app/turso-tenant-schema.ts:112` (tenant INSERT)
- Test: `src/app/turso-schema.test.ts` and `src/app/turso-tenant-schema.test.ts`

- [ ] **Step 1: Write the failing tests** — in `turso-schema.test.ts`, extend the plan round-trip test (find the block asserting `plan.startDate`/`plan.currency`) to also cover the new field. Add:

```ts
  it("persists budgetFollowsPlan through single-tenant INSERT + decode", () => {
    const ws = /* existing helper */ makeWorkspaceWithPlan({ budgetFollowsPlan: true });
    const decoded = roundTripThroughTurso(ws); // use whatever the file's existing round-trip helper is
    expect(decoded.plan.budgetFollowsPlan).toBe(true);
  });
```

Mirror the same assertion in `turso-tenant-schema.test.ts` using that file's existing tenant round-trip helper. If no reusable helper exists, assert on the generated statements instead: `expect(buildSingleTenantStatements(ws).some(s => /INSERT INTO plan/.test(s.sql) && s.args.includes("true"))).toBe(true)` — match the file's actual statement-builder export name.

- [ ] **Step 2: Run — verify FAIL**

Run: `npm run test:run -- turso-schema.test.ts turso-tenant-schema.test.ts`
Expected: FAIL (field dropped).

- [ ] **Step 3: Add the column** — `turso-schema.ts:71`:

```ts
export const PLAN_COLUMNS = ["startDate", "endDate", "granularity", "currency", "budgetFollowsPlan"] as const;
```

- [ ] **Step 4: Single-tenant INSERT** — `turso-schema.ts:238`, append the value (TEXT column; empty string when off):

```ts
  out.push(insertStmt("plan", ["id", ...PLAN_COLUMNS], ["1", p.startDate, p.endDate, p.granularity, p.currency, p.budgetFollowsPlan ? "true" : ""]));
```

- [ ] **Step 5: Tenant INSERT** — `turso-tenant-schema.ts:112`, append the value:

```ts
  out.push(tenantInsert("plan", PLAN_COLUMNS, [p.startDate, p.endDate, p.granularity, p.currency, p.budgetFollowsPlan ? "true" : ""], projectId));
```

- [ ] **Step 6: Confirm decode** — read `turso-schema.ts:115-125`. Ensure the plan-row SELECT/mapping includes the new column so `sanitizePlan` receives `budgetFollowsPlan: "true"`. If the read builds `planRow` from a fixed key list, add `budgetFollowsPlan` there; if it maps all `PLAN_COLUMNS`, it's already covered. `sanitizePlan` (Task 1) coerces `"true"`.

- [ ] **Step 7: Run — verify PASS**

Run: `npm run test:run -- turso-schema.test.ts turso-tenant-schema.test.ts` → PASS.
Run: `npm run test:run` (full) → PASS. If a **sample** Turso/sqlite test fails on the new column, regenerate sample artifacts: `npx vite-node scripts/generate-sample-workspace.ts`, then re-run; commit any regenerated `sample-workspace-*.sqlite3` in this task. If nothing fails, do NOT regenerate (the sample plan is off ⇒ column stores `""`, and `turso-migrate` self-heals existing DBs).
Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/turso-schema.ts src/app/turso-tenant-schema.ts src/app/turso-schema.test.ts src/app/turso-tenant-schema.test.ts
git commit -m "feat(budget): persist budgetFollowsPlan in Turso single + tenant schemas"
```

---

## Task 4: Slice 1 — `%`/`h` suffix on the planning utilization box

**Files:**
- Modify: `src/app/resources-panel.tsx:562-570` (utilization `<input>`)
- Test: `src/app/resources-panel.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `resources-panel.test.tsx` (planning view; use the file's existing render helper + props, which already stub `onSetPlanWindow` etc.):

```ts
  test("planning: utilization box shows % suffix in percent mode", () => {
    // render with resources whose utilizationMode === "percent" (the default seed)
    render(/* existing planning render with a resource + one period */);
    expect(screen.getByText("%")).toBeInTheDocument();
  });
  test("planning: utilization box shows h suffix in hours mode", () => {
    // render with resources whose utilizationMode === "hours"
    render(/* same but utilizationMode: "hours" */);
    expect(screen.getByText("h")).toBeInTheDocument();
  });
```

> Reuse the exact render setup from a nearby planning test in the file (e.g. the `onSetPlanWindow` test at line ~76). Seed one resource with a period so the utilization input renders.

- [ ] **Step 2: Run — verify FAIL**

Run: `npm run test:run -- resources-panel.test.tsx`
Expected: FAIL (`%`/`h` not present).

- [ ] **Step 3: Implement** — wrap the utilization `<input>` (currently ~line 563-570) in an inline flex with a trailing suffix span. The suffix is decorative (`aria-hidden`) — the input keeps its row-unique `aria-label`:

```tsx
<span className="inline-flex items-center gap-0.5">
  <input
    /* ...existing input props unchanged (aria-label, type, value, step, onChange, className w-16 ... text-right tabular-nums) ... */
  />
  <span aria-hidden="true" className="text-xs text-muted-foreground">
    {r.utilizationMode === "percent" ? "%" : "h"}
  </span>
</span>
```

Leave the absence-override input (next block) unchanged.

- [ ] **Step 4: Run — verify PASS**

Run: `npm run test:run -- resources-panel.test.tsx` → PASS. `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx
git commit -m "feat(planning): show %/h suffix next to the utilization input"
```

---

## Task 5: Slices 2 + 3 — left-align date-column headers

**Files:**
- Modify: `src/app/resources-panel.tsx:482-490` (planning period `<th>`)
- Modify: `src/app/budget-panel.tsx:439-448` (budget bucket period `<th>`)
- Test: `src/app/resources-panel.test.tsx`, `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Write the failing tests** — planning (`resources-panel.test.tsx`):

```ts
  test("planning: period date header is not right-aligned", () => {
    render(/* planning view with a period whose key is e.g. "2026-01" */);
    const th = screen.getByRole("columnheader", { name: /2026-01/ });
    expect(th.className).not.toMatch(/text-right/);
  });
```

Budget (`budget-panel.test.tsx`), mirror with a bucket that has a period column:

```ts
  test("budget: bucket period date header is not right-aligned", () => {
    render(/* budget view with a bucket + a period column */);
    const th = screen.getByRole("columnheader", { name: /\d{4}-\d{2}/ });
    expect(th.className).not.toMatch(/text-right/);
  });
```

> Use each file's existing render helper. If `getByRole("columnheader", {name})` is awkward (period keys may not be an accessible name), fall back to `container.querySelector` on the `<th>` containing the period text and assert its `className`.

- [ ] **Step 2: Run — verify FAIL**

Run: `npm run test:run -- resources-panel.test.tsx budget-panel.test.tsx`
Expected: FAIL (headers still `text-right`).

- [ ] **Step 3: Implement — planning** — `resources-panel.tsx:485`, remove `text-right` from the period `<th>` className (keep `relative px-3 py-2 font-medium tabular-nums`). The numeric cell inputs (util/cost) keep `text-right`.

- [ ] **Step 4: Implement — budget** — `budget-panel.tsx:442`, change `relative px-1 py-1 text-right` → `relative px-1 py-1`. Numeric budget/actual cells keep `text-right`.

- [ ] **Step 5: Run — verify PASS**

Run: `npm run test:run -- resources-panel.test.tsx budget-panel.test.tsx` → PASS.
Run: `npm run test:run -- table-head-sweep.test.ts` → PASS (the sweep guards `TABLE_HEAD_CLASS` usage, not data-cell alignment; confirm no regression).
`npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/resources-panel.tsx src/app/budget-panel.tsx src/app/resources-panel.test.tsx src/app/budget-panel.test.tsx
git commit -m "feat(planning,budget): left-align date-column headers"
```

---

## Task 6: Slice 5 — bucket-name search box

**Files:**
- Modify: `src/app/budget-panel.tsx` (state ~199, toolbar ~340, render ~343)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Add i18n key** — `i18n.ts`, add near the other `budget*` keys:

```ts
  budgetBucketFilter: "Filter buckets",
```

`i18n.de.ts` — add via node utf8 write (CRLF `\r\n` anchors, real umlauts), matching the DE `budget*` block:

```
  budgetBucketFilter: "Buckets filtern",
```

- [ ] **Step 2: Write the failing test** — `budget-panel.test.tsx`:

```ts
  test("budget: bucket-name search filters buckets", () => {
    render(/* budget view with two buckets named "Alpha" and "Beta" */);
    const box = screen.getByLabelText(/filter buckets/i); // TableFilter's accessible name
    fireEvent.change(box, { target: { value: "alph" } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Run — verify FAIL**

Run: `npm run test:run -- budget-panel.test.tsx`
Expected: FAIL (no bucket filter box).

- [ ] **Step 4: Implement** — in `BudgetPanel`:
  1. Add state beside `roleFilter` (~line 199): `const [bucketFilter, setBucketFilter] = useState("");`
  2. Add a second `TableFilter` in the toolbar beside the role filter (~line 340), with a **distinct** label so the two filter boxes aren't duplicate accessible names:

```tsx
<TableFilter value={bucketFilter} onChange={setBucketFilter} placeholderKey="budgetBucketFilter" lang={lang} />
```

  3. Before `report.buckets.map(...)` (~line 343), filter by name:

```tsx
const q = bucketFilter.trim().toLowerCase();
const visibleBuckets = q ? report.buckets.filter((b) => b.name.toLowerCase().includes(q)) : report.buckets;
```

  and map `visibleBuckets` instead of `report.buckets`.

> Match the exact `TableFilter` prop names used at the existing role-filter call site (line ~340) — copy that call and swap `value`/`onChange`/`placeholderKey`.

- [ ] **Step 5: Run — verify PASS**

Run: `npm run test:run -- budget-panel.test.tsx` → PASS. `npx tsc --noEmit` → exit 0 (i18n EN/DE parity enforced here).

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-panel.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/budget-panel.test.tsx
git commit -m "feat(budget): add bucket-name search box beside the role filter"
```

---

## Task 7: Slice 4a — plan-setter thread + toolbar toggle (persist path)

**Files:**
- Modify: `src/app/use-resource-planner.ts` (~918-923 add handler, ~970 return)
- Modify: `src/app/task-manager.tsx` (~600 destructure, ~1802 wire)
- Modify: `src/app/workspace-section-types.ts:150` (prop)
- Modify: `src/app/workspace-section.tsx` (~138 destructure, ~652 pass)
- Modify: `src/app/budget-panel.tsx` (props + toolbar toggle)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/use-resource-planner.test.tsx`, `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Write the failing hook test** — `use-resource-planner.test.tsx`, near the existing plan-window test (line ~1020):

```ts
  it("handleSetBudgetFollowsPlan updates the plan", () => {
    const { result } = renderPlanner(); // use the file's existing setup helper
    act(() => { result.current.planner.handleSetBudgetFollowsPlan(true); });
    expect(result.current.workspace.plan.budgetFollowsPlan).toBe(true);
    act(() => { result.current.planner.handleSetBudgetFollowsPlan(false); });
    expect(result.current.workspace.plan.budgetFollowsPlan).toBe(false);
  });
```

> Match the file's existing accessor for the workspace plan (see the `handleSetPlanWindow` test at line 1020 for how it reads the updated plan).

- [ ] **Step 2: Run — verify FAIL**

Run: `npm run test:run -- use-resource-planner.test.tsx` → FAIL (`handleSetBudgetFollowsPlan` undefined).

- [ ] **Step 3: Add the handler** — `use-resource-planner.ts`, after `handleSetPlanGranularity` (line ~923), mirroring it:

```ts
  const handleSetBudgetFollowsPlan = useCallback(
    (v: boolean) => {
      setPlan((prev) => ({ ...prev, budgetFollowsPlan: v }));
    },
    [setPlan],
  );
```

Add `handleSetBudgetFollowsPlan,` to the returned object (~line 970).

- [ ] **Step 4: Thread through task-manager** — `task-manager.tsx`: add `handleSetBudgetFollowsPlan,` to the destructure at ~line 600, and wire into the WorkspaceSection props object at ~line 1802:

```ts
    onSetBudgetFollowsPlan: guardEdit(handleSetBudgetFollowsPlan),
```

- [ ] **Step 5: Declare the prop** — `workspace-section-types.ts`, after line 150:

```ts
  onSetBudgetFollowsPlan: (v: boolean) => void;
```

Update the two prop-shape test fixtures that will now fail tsc: `workspace-section.characterization.test.tsx:92` and `workspace-section.test.tsx:84` — add `onSetBudgetFollowsPlan: vi.fn(),` beside their `onSetPlanWindow` entries.

- [ ] **Step 6: Pass to BudgetPanel** — `workspace-section.tsx`: destructure `onSetBudgetFollowsPlan` (~line 138) and pass it to `<BudgetPanel ... onSetBudgetFollowsPlan={onSetBudgetFollowsPlan} />` (~line 652-668).

- [ ] **Step 7: BudgetPanel prop + toolbar toggle** — `budget-panel.tsx`:
  1. Add to `BudgetPanelProps` (line ~124): `onSetBudgetFollowsPlan?: (v: boolean) => void;`
  2. Add i18n keys `budgetFollowsPlan` + `budgetFollowsPlanHint` (EN `i18n.ts`, DE `i18n.de.ts` via node utf8 write — real umlaut in "Kapazität"):

```ts
  // EN
  budgetFollowsPlan: "Budget hours follow plan",
  budgetFollowsPlanHint: "When on, budget hours for lines with assigned resources mirror planned capacity and become read-only.",
```
```
  // DE
  budgetFollowsPlan: "Budgetstunden folgen Planung",
  budgetFollowsPlanHint: "Wenn aktiv, spiegeln die Budgetstunden von Zeilen mit zugewiesenen Ressourcen die geplante Kapazität wider und sind schreibgeschützt.",
```
  3. Render a labeled checkbox toggle in the toolbar row (~line 297-326), gated `!isPopout`, `print:hidden`, reading `plan.budgetFollowsPlan ?? false`:

```tsx
{!isPopout && onSetBudgetFollowsPlan ? (
  <label className={`flex items-center gap-1.5 text-sm print:hidden`}>
    <input
      type="checkbox"
      checked={plan.budgetFollowsPlan ?? false}
      onChange={(e) => onSetBudgetFollowsPlan(e.target.checked)}
      className={`${FOCUS_RING} ${TRANSITION}`}
    />
    <span>{t(lang, "budgetFollowsPlan")}</span>
    <InfoTooltip text={t(lang, "budgetFollowsPlanHint")} />
  </label>
) : null}
```

  (A checkbox has an implicit label via the wrapping `<label>` text — axe-safe. If the file already uses `SegmentedControl` for on/off elsewhere, prefer that for visual consistency; the checkbox is the minimal safe default.)

- [ ] **Step 8: Write the toggle UI test** — `budget-panel.test.tsx`:

```ts
  test("budget: toggling 'budget hours follow plan' calls the setter", () => {
    const onSetBudgetFollowsPlan = vi.fn();
    render(/* budget view with onSetBudgetFollowsPlan + isPopout omitted */);
    fireEvent.click(screen.getByRole("checkbox", { name: /budget hours follow plan/i }));
    expect(onSetBudgetFollowsPlan).toHaveBeenCalledWith(true);
  });
```

- [ ] **Step 9: Run — verify PASS**

Run: `npm run test:run -- use-resource-planner.test.tsx budget-panel.test.tsx workspace-section.test.tsx` → PASS.
`npx tsc --noEmit` → exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/app/use-resource-planner.ts src/app/task-manager.tsx src/app/workspace-section-types.ts src/app/workspace-section.tsx src/app/budget-panel.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/use-resource-planner.test.tsx src/app/budget-panel.test.tsx src/app/workspace-section.characterization.test.tsx src/app/workspace-section.test.tsx
git commit -m "feat(budget): add 'budget hours follow plan' toggle + plan-setter thread"
```

---

## Task 8: Slice 4b — read-only mirror budget cell

**Files:**
- Modify: `src/app/budget-panel.tsx` (`HoursCell`/`HoursTd` ~51-122; per-allocation planned lookup; role + discipline rows)
- Test: `src/app/budget-panel.test.tsx` (or `budget-panel-edit.test.tsx`)

Behavior: when `plan.budgetFollowsPlan` is ON **and** the allocation has ≥1 assigned resource, the **budget** input shows the live planned hours, read-only. Otherwise (toggle off, or no assigned resources) it stays editable. The **actual** input is always editable.

- [ ] **Step 1: Write the failing tests** — `budget-panel.test.tsx`:

```ts
  test("budget: mirror ON — resourced line's budget input is read-only and shows planned hours", () => {
    // plan.budgetFollowsPlan = true; a bucket with one allocation whose resourceIds = [<a resource with capacity>]
    render(/* ... */);
    const budgetInput = screen.getByLabelText(/^budget-/); // first budget cell
    expect(budgetInput).toHaveAttribute("readonly");
    // planned value (> 0) is shown, not an empty/typed value
    expect((budgetInput as HTMLInputElement).value).not.toBe("");
  });
  test("budget: mirror ON — role line with NO assigned resource stays editable", () => {
    // plan.budgetFollowsPlan = true; allocation.resourceIds = []
    render(/* ... */);
    const budgetInput = screen.getByLabelText(/^budget-/);
    expect(budgetInput).not.toHaveAttribute("readonly");
  });
  test("budget: mirror OFF — budget input editable (unchanged)", () => {
    // plan.budgetFollowsPlan absent/false
    render(/* ... */);
    expect(screen.getByLabelText(/^budget-/)).not.toHaveAttribute("readonly");
  });
```

- [ ] **Step 2: Run — verify FAIL**

Run: `npm run test:run -- budget-panel.test.tsx` → FAIL.

- [ ] **Step 3: Extend `HoursCell`** — `budget-panel.tsx:51-93`, add `readOnly?: boolean` to the props. When `readOnly`, the budget input gets `readOnly` + no write:

```tsx
        <input
          aria-label={`budget-${ariaPrefix}`}
          type="number"
          value={budget ?? ""}
          readOnly={readOnly}
          onChange={readOnly ? undefined : (e) => onBudget(Number(e.target.value) || 0)}
          className={`w-16 rounded border border-line ${readOnly ? "bg-surface-muted text-muted-foreground" : "bg-surface"} px-1 py-0.5 text-right tabular-nums ${FOCUS_RING} ${TRANSITION}`}
        />
```

Thread `readOnly` through `HoursTd` (`:98-122`) to `HoursCell`.

- [ ] **Step 4: Per-allocation planned lookup** — in `BudgetPanel`, build a helper that returns the planned hours for a given allocation + period, reusing `allocationPlannedHours`. For each rendered bucket the periods are `bucketActivePeriods(br, plan)` (already computed for the columns). Compute per allocation:

```ts
// canonicalPeriods = the bucket's active periods (same list used for the columns)
const plannedFor = (alloc: { resourceIds: readonly number[] }, period: Period, periods: readonly Period[]) =>
  allocationPlannedHours(alloc, period, periods, resources, workdayHours, holidaySet, plan.granularity, absences);
```

> Match how `computeBucketReport` already calls `allocationPlannedHours` (budget-report.ts ~140/158) — pass the **same** `canonicalPeriods` it uses, so keys/proration line up with the report's planned figure. Memoize per bucket if needed; hoist `plan.granularity` / `plan.budgetFollowsPlan` to scalar locals before any `useMemo` dep array (exhaustive-deps rejects `obj.member`).

- [ ] **Step 5: Wire role rows** — where role-row `HoursTd`s are rendered, compute `mirror = (plan.budgetFollowsPlan ?? false) && alloc.resourceIds.length > 0`. When `mirror`, pass `readOnly` and set the cell's `budget` value to `plannedFor(alloc, period, periods)`; else pass the typed `budgetHours[period.key]` as today.

- [ ] **Step 6: Wire discipline (blended) rows** — the discipline rows (`setDisciplineCell`, ~223-251) aggregate their allocations. For a discipline row under mirror, `readOnly` when ANY underlying allocation has resources; the displayed planned value = sum of `plannedFor(alloc, period, periods)` over that discipline's allocations. Mirror the grouping the file already uses to compute the discipline row's budget/actual (reuse the same allocation grouping — do not re-derive it).

- [ ] **Step 7: Run — verify PASS**

Run: `npm run test:run -- budget-panel.test.tsx budget-panel-edit.test.tsx` → PASS. `npx tsc --noEmit` → exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/budget-panel.tsx src/app/budget-panel.test.tsx
git commit -m "feat(budget): mirror planned hours into read-only budget cells when 'follow plan' is on"
```

---

## Task 9: Full gates + release notes

**Files:**
- Modify: `CHANGELOG.md`, `src/app/version.ts` (minor bump)
- Verify only: no source changes expected.

- [ ] **Step 1: Full gate sweep**

```bash
npx tsc --noEmit
npm run test:run
npm run build
npm run size:check
npm run dup:check
```

All must pass. If `size:check` flags `budget-panel.tsx` or `resources-panel.tsx` crossing the ratchet, extract the new toolbar toggle (Task 7) or suffix (Task 4) into a small presentational helper file and re-run — do NOT `--update` the baseline to mask real growth unless the growth is legitimate and small (then `node scripts/check-file-sizes.mjs --update` is sanctioned).

- [ ] **Step 2: a11y gate** (budget + resources views are axe-scanned)

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Budget"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources"
```

Both green. (Toggle checkbox has a wrapping-label name; two budget filter boxes have distinct labels; suffix is `aria-hidden`; read-only input keeps its `aria-label`.)

- [ ] **Step 3: Version + changelog** — bump `src/app/version.ts` `APP_VERSION` (next minor) + `APP_MILESTONE`; add a `CHANGELOG.md` entry summarizing the five slices. No new `versionHighlight*` key required unless the user wants a highlight card (these are UX refinements). Follow the release bullet in AGENTS.md.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md src/app/version.ts
git commit -m "chore(release): planning/budget UX + budget-follows-plan batch"
```

- [ ] **Step 5: STOP.** Do not push/MR/merge. Report completion + gate results and await the user's explicit "release".

---

## Self-review notes

- **Spec coverage:** slice 1 → T4; slice 2 → T5; slice 3 → T5; slice 4 → T1-3 (persist) + T7 (toggle/thread) + T8 (mirror cell); slice 5 → T6. All five covered.
- **Byte-stability:** T2 emits the 5th CSV/MD cell only when true ⇒ golden fixtures unchanged (verified in T2 step 7). Turso column is unconditional but not byte-pinned by the golden test (T3 step 7 handles sample sqlite only if a test demands).
- **String/boolean gap:** handled once in `sanitizePlan` (`true || "true"`), covered by T1 tests.
- **Type consistency:** field name `budgetFollowsPlan` and handler `handleSetBudgetFollowsPlan` / prop `onSetBudgetFollowsPlan` used identically across T1-T8.
- **Purity/lint:** T8 step 4 flags the exhaustive-deps `obj.member` hoist; suffix is decorative `aria-hidden`.
