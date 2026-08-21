# RAID Table-Header Sorting (0.14.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click RAID column headers to sort (asc → desc → off); off returns to the existing default order.

**Architecture:** A pure `compareRaid` comparator in `raid.ts` (tested); `raid-panel.tsx` holds `{ key, dir } | null` sort state and applies the comparator to the filtered rows, falling back to the existing default sort when off.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest + Testing Library. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-27-raid-table-sorting-design.md`
**Branch:** `feat/0.14.2-raid-sorting` (already created off `main`).

**Conventions:** immutable; no `any`; no color/style changes (deferred to the D+E design-system sub-project). Run `npx tsc --noEmit`, `npm run lint`, relevant `npx vitest run` after each task. Each task leaves the build green.

---

## Task 1: `compareRaid` comparator + tests

**Files:** Modify `src/app/raid.ts`; Test `src/app/raid.test.ts`.

First READ `raid.ts` to confirm it imports `RaidItem`, `RaidSeverity`, `RAID_CATEGORIES` from `./types` (add to the import if missing) and to match its style.

- [ ] **Step 1: Failing tests** (append to `src/app/raid.test.ts`; add `compareRaid` + `type RaidSortKey` to the existing `./raid` import)

```ts
import type { RaidItem } from "./types";

function ri(over: Partial<RaidItem>): RaidItem {
  return { id: 1, category: "R", title: "t", status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01", ...over };
}

describe("compareRaid", () => {
  const sortBy = (items: RaidItem[], key: import("./raid").RaidSortKey, dir: "asc" | "desc" = "asc") =>
    [...items].sort((a, b) => compareRaid(a, b, key, dir));

  test("severity by rank Low<Medium<High<Critical (missing lowest)", () => {
    const items = [ri({ id: 1, severity: "Critical" }), ri({ id: 2, severity: "Low" }), ri({ id: 3, severity: undefined }), ri({ id: 4, severity: "High" })];
    expect(sortBy(items, "severity", "asc").map((i) => i.id)).toEqual([3, 2, 4, 1]); // missing, Low, High, Critical
    expect(sortBy(items, "severity", "desc").map((i) => i.id)).toEqual([1, 4, 2, 3]);
  });
  test("category follows R→A→I→D", () => {
    const items = [ri({ id: 1, category: "D" }), ri({ id: 2, category: "R" }), ri({ id: 3, category: "I" }), ri({ id: 4, category: "A" })];
    expect(sortBy(items, "category", "asc").map((i) => i.category)).toEqual(["R", "A", "I", "D"]);
  });
  test("id numeric, owner case-insensitive", () => {
    expect(sortBy([ri({ id: 10 }), ri({ id: 2 })], "id").map((i) => i.id)).toEqual([2, 10]);
    expect(sortBy([ri({ id: 1, owner: "bob" }), ri({ id: 2, owner: "Alice" })], "owner").map((i) => i.id)).toEqual([2, 1]);
  });
  test("missing targetDate sorts LAST in both directions", () => {
    const items = [ri({ id: 1, targetDate: undefined }), ri({ id: 2, targetDate: "2026-03-01" }), ri({ id: 3, targetDate: "2026-01-01" })];
    expect(sortBy(items, "targetDate", "asc").map((i) => i.id)).toEqual([3, 2, 1]);  // dated asc, then missing
    expect(sortBy(items, "targetDate", "desc").map((i) => i.id)).toEqual([2, 3, 1]); // dated desc, then missing
  });
});
```
(Confirm the minimal `RaidItem` fixture fields against the real type — add any other REQUIRED fields. `RAID_CATEGORIES` is `["R","A","I","D"]`.)

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/app/raid.test.ts -t compareRaid`.

- [ ] **Step 3: Implement** (append to `src/app/raid.ts`)

```ts
export type RaidSortKey = "id" | "category" | "title" | "severity" | "status" | "owner" | "targetDate";

const SEVERITY_RANK: Record<RaidSeverity, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

function raidSortValue(item: RaidItem, key: RaidSortKey): string | number {
  switch (key) {
    case "id": return item.id;
    case "category": return RAID_CATEGORIES.indexOf(item.category);
    case "severity": return item.severity ? SEVERITY_RANK[item.severity] : 0;
    case "status": return item.status.toLowerCase();
    case "title": return item.title.toLowerCase();
    case "owner": return (item.owner ?? "").toLowerCase();
    case "targetDate": return item.targetDate ?? "";
  }
}

/**
 * Compare two RAID items by a column. Missing `targetDate` always sorts LAST,
 * regardless of direction; other missing values use their natural low/empty order.
 */
export function compareRaid(
  a: RaidItem,
  b: RaidItem,
  key: RaidSortKey,
  dir: "asc" | "desc",
): number {
  if (key === "targetDate") {
    const av = a.targetDate ?? "";
    const bv = b.targetDate ?? "";
    if (av === "" || bv === "") {
      if (av === bv) return 0;
      return av === "" ? 1 : -1; // missing always after
    }
  }
  const av = raidSortValue(a, key);
  const bv = raidSortValue(b, key);
  const cmp =
    typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  return dir === "asc" ? cmp : -cmp;
}
```
(Ensure `RaidSeverity`, `RaidItem`, `RAID_CATEGORIES` are imported in `raid.ts`.)

- [ ] **Step 4: Run → PASS**; `npx tsc --noEmit` (0); `npm run lint`.

- [ ] **Step 5: Commit**
```bash
git add src/app/raid.ts src/app/raid.test.ts
git commit -m "feat(raid): compareRaid column comparator (severity rank, R-A-I-D, missing-date-last)"
```

---

## Task 2: Sortable headers in the panel + apply + component test

**Files:** Modify `src/app/raid-panel.tsx`; Test `src/app/raid-panel.test.tsx`.

READ `raid-panel.tsx`: the `<thead>` (~line 410–421) and the default sort `filtered.slice().sort(...)` (~line 207). Note the variable names for the filtered list and the final visible list.

- [ ] **Step 1: Sort state + toggle** — add (with the panel's other hooks):
```tsx
  const [sort, setSort] = useState<{ key: RaidSortKey; dir: "asc" | "desc" } | null>(null);
  const toggleSort = (key: RaidSortKey) =>
    setSort((s) =>
      s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null,
    );
```
Import `compareRaid` + `type RaidSortKey` from `./raid`.

- [ ] **Step 2: Apply the sort** — where the visible rows are computed from `filtered.slice().sort(<default>)`, branch: when `sort` is set, sort by the comparator; else keep the default:
```tsx
  const ordered = sort
    ? [...filtered].sort((a, b) => compareRaid(a, b, sort.key, sort.dir))
    : filtered.slice().sort(/* existing default comparator, unchanged */);
```
Use `ordered` wherever the rendered rows currently come from. Keep the existing default comparator EXACTLY as-is in the `else` branch (do NOT change default behavior). If `filtered`/the sorted list is memoized, keep `ordered` consistent (same `useMemo`, add `sort` to deps) — match the file's pattern.

- [ ] **Step 3: Clickable headers** — turn the 7 scalar `<th>` (`#`→id, Category, Title, Severity, Status, Owner, Target Date) into sort buttons; leave Linked Tasks + Caused By as plain `<th>`. Pattern per header:
```tsx
              <th className="px-3 py-2" aria-sort={sort?.key === "id" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggleSort("id")} className="inline-flex items-center gap-1 hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey">
                  #{sort?.key === "id" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
              </th>
```
Map: `#`→`"id"`, `raidCategory`→`"category"`, `raidTitle`→`"title"`, `raidSeverity`→`"severity"`, `raidStatus`→`"status"`, `raidOwner`→`"owner"`, `raidTargetDate`→`"targetDate"`. Keep each header's existing label `{t(lang, "...")}` (for `#` keep the literal `#`). Do NOT change the header row's existing classes/colors.

- [ ] **Step 4: Component test** (`src/app/raid-panel.test.tsx`) — READ the file to match its render harness. Add a test: render the panel with a few RAID items of differing severity; click the Severity header → rows ordered Low→Critical (asc); click again → Critical→Low (desc); click a third time → back to the default order. Assert a non-sortable header (e.g. Linked Tasks) has no button. Use `getByRole("button", { name: /severity/i })` and read row order via the rendered `#id` cells (match how existing raid tests read rows).

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (0); `npm run lint`; `npx vitest run src/app/raid-panel src/app/raid` (pass; existing raid tests stay green).

- [ ] **Step 6: Commit**
```bash
git add src/app/raid-panel.tsx src/app/raid-panel.test.tsx
git commit -m "feat(raid): sortable column headers (asc/desc/off) in the RAID table"
```

---

## Task 3: Release 0.14.2

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `docs/CODEMAPS/frontend.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION = "0.14.2"`, build date `2026-05-27`, keep "Atwood". Patch → do NOT add a highlight key (consistent with 0.13.1/0.14.1 patches); confirm by reading the file.
- [ ] **Step 2: CHANGELOG** — add `## [0.14.2] — 2026-05-27`: RAID table columns are now sortable by clicking the header (asc → desc → off; off restores the default order); Severity sorts by rank, missing target dates sort last.
- [ ] **Step 3: Codemap** — `docs/CODEMAPS/frontend.md`: note RAID header sorting (`compareRaid` in `raid.ts`).
- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint`; `npm run test:coverage` (green, ≥70%). Before committing, `git status` + `git restore` any stray `sample-workspace.md`.
- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts CHANGELOG.md docs/CODEMAPS/frontend.md
git commit -m "docs(release): 0.14.2 — RAID table-header sorting"
```

---

## Final review
Dispatch a final code reviewer over `git diff main...HEAD`; confirm gates green; then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)
**Spec coverage:** comparator (severity rank, R→A→I→D, missing-date-last, case-insensitive) → T1; sortable headers + asc/desc/off + apply-vs-default + non-sortable list columns → T2; release → T3. All covered.
**Placeholder scan:** Code concrete. T2 flags real-source confirmations (the exact `filtered`/visible variable names + the existing default comparator to preserve; the raid-panel test harness; the row-order read in tests) — explicit, not vague.
**Type consistency:** `compareRaid(a, b, key: RaidSortKey, dir)` defined in T1, consumed in T2's `[...filtered].sort((a,b)=>compareRaid(...))`; `RaidSortKey` exported from `raid.ts` and used for the panel's `sort` state + `toggleSort`.
