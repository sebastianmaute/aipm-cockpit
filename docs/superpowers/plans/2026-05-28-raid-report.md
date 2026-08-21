# RAID Report (0.18.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a steering-committee RAID report opened in a popout window from the RAID panel, with a Summary | Full Detail drill-down toggle.

**Architecture:** New `raid-report.ts` (pure compute → `RaidReport`) + new `raid-report.tsx` (React popout component). Compute follows the `resource-report.ts` shape (returns tile counts + grouped rows + topOpen + fullDetail). Presentation follows the `resources-report.tsx` shape (Tiles + Sections + Tables). Drill-down is a `SegmentedControl` at the top of the page that swaps the body between Summary (tiles + 6 group tables) and Full Detail (a read-only sortable per-item table). Popout plumbing adds `"raid-report"` to `POPOUT_TABS`, a Report button to the RAID panel toolbar, and a dispatch case in `workspace-section.tsx`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-raid-report-design.md`
**Reference:** `src/app/resource-report.ts` + `src/app/resources-report.tsx` (the structural model).
**Branch:** `feat/0.18.0-raid-report` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. **Fact-forcing gate.** Before FIRST shell command print 2 facts. Before EVERY Edit/Write, in the SAME message print 4 facts — (a) importers (Grep the symbol name in same turn), (b) symbols affected, (c) data fields (RaidItem field names + types where the compute reads them), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry.
> 2. **win32** — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.
> 4. **0.16.1 table chrome** is canonical: sticky `bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground` thead, `px-3 py-2 font-medium` th, `divide-y divide-line` tbody.

---

## Task 1: `raid-report.ts` compute + tests (TDD)

**Files:**
- Create: `src/app/raid-report.ts`
- Create: `src/app/raid-report.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/raid-report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UNASSIGNED_OWNER, computeRaidReport } from "./raid-report";
import type { RaidItem } from "./types";

const TODAY = "2026-05-28";

function item(p: Partial<RaidItem>): RaidItem {
  return {
    id: 1,
    category: "R",
    title: "t",
    status: "Open",
    raisedDate: TODAY,
    linkedTaskIds: [],
    causedByRaidIds: [],
    ...p,
  } as RaidItem;
}

describe("computeRaidReport", () => {
  it("returns empty result for empty input", () => {
    const r = computeRaidReport([], TODAY);
    expect(r.tiles).toEqual({ openR: 0, openA: 0, openI: 0, openD: 0 });
    expect(r.bySeverity).toEqual([]);
    expect(r.byStatus).toEqual([]);
    expect(r.byOwner).toEqual([]);
    expect(r.byCategory).toHaveLength(4);
    expect(r.byCategory.every((row) => row.open === 0 && row.closed === 0 && row.overdue === 0)).toBe(true);
    expect(r.byAging.every((row) => row.open === 0)).toBe(true);
    expect(r.topOpen).toEqual([]);
    expect(r.fullDetail).toEqual([]);
  });

  it("tile counts respect 'open' per category", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Open" }),
      item({ id: 2, category: "R", status: "Closed" }),
      item({ id: 3, category: "R", status: "Mitigated" }),
      item({ id: 4, category: "A", status: "Pending" }),
      item({ id: 5, category: "A", status: "Validated" }),
      item({ id: 6, category: "I", status: "Open" }),
      item({ id: 7, category: "I", status: "Resolved" }),
      item({ id: 8, category: "D", status: "In Progress" }),
      item({ id: 9, category: "D", status: "Delivered" }),
    ], TODAY);
    expect(r.tiles).toEqual({ openR: 1, openA: 1, openI: 1, openD: 1 });
  });

  it("By Severity counts each cell in the L/M/H/C × R/A/I/D matrix", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", severity: "Critical" }),
      item({ id: 2, category: "R", severity: "Critical" }),
      item({ id: 3, category: "I", severity: "High" }),
      item({ id: 4, category: "D", severity: "Medium" }),
      item({ id: 5, category: "A", severity: "Low" }),
    ], TODAY);
    const find = (sev: string) => r.bySeverity.find((row) => row.severity === sev)!;
    expect(find("Critical")).toEqual({ severity: "Critical", risks: 2, assumptions: 0, issues: 0, dependencies: 0, total: 2 });
    expect(find("High")).toEqual({ severity: "High", risks: 0, assumptions: 0, issues: 1, dependencies: 0, total: 1 });
    expect(find("Medium")).toEqual({ severity: "Medium", risks: 0, assumptions: 0, issues: 0, dependencies: 1, total: 1 });
    expect(find("Low")).toEqual({ severity: "Low", risks: 0, assumptions: 1, issues: 0, dependencies: 0, total: 1 });
  });

  it("By Severity omits Unrated row when every item has a severity", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", severity: "Critical" }),
    ], TODAY);
    expect(r.bySeverity.find((row) => row.severity === "Unrated")).toBeUndefined();
  });

  it("By Severity includes Unrated row when any item lacks severity", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "I", status: "Open" /* no severity */ }),
      item({ id: 2, category: "R", severity: "High" }),
    ], TODAY);
    const unrated = r.bySeverity.find((row) => row.severity === "Unrated");
    expect(unrated).toEqual({ severity: "Unrated", risks: 0, assumptions: 0, issues: 1, dependencies: 0, total: 1 });
  });

  it("By Status counts only open items", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Open" }),
      item({ id: 2, category: "R", status: "Closed" }),
      item({ id: 3, category: "I", status: "In Progress" }),
    ], TODAY);
    const open = r.byStatus.find((row) => row.status === "Open")!;
    expect(open.count).toBe(1);
    expect(r.byStatus.find((row) => row.status === "Closed")).toBeUndefined();
  });

  it("By Status sorted by count desc", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Open" }),
      item({ id: 2, category: "I", status: "In Progress" }),
      item({ id: 3, category: "I", status: "In Progress" }),
      item({ id: 4, category: "D", status: "Blocked" }),
    ], TODAY);
    expect(r.byStatus.map((row) => row.status)).toEqual(["In Progress", "Open", "Blocked"]);
  });

  it("By Owner: empty / whitespace owner normalized to sentinel", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", owner: "" }),
      item({ id: 2, category: "I", owner: "   " }),
      item({ id: 3, category: "A", owner: "Alex" }),
    ], TODAY);
    const sentinel = r.byOwner.find((row) => row.owner === UNASSIGNED_OWNER)!;
    expect(sentinel.total).toBe(2);
    expect(r.byOwner.find((row) => row.owner === "Alex")?.total).toBe(1);
  });

  it("By Owner sort: total desc, then owner asc", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", owner: "Bea" }),
      item({ id: 2, category: "I", owner: "Bea" }),
      item({ id: 3, category: "A", owner: "Alex" }),
      item({ id: 4, category: "D", owner: "Carl" }),
    ], TODAY);
    expect(r.byOwner.map((row) => row.owner)).toEqual(["Bea", "Alex", "Carl"]);
  });

  it("By Category: open/closed/overdue counts", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Open", targetDate: "2026-05-20" }),
      item({ id: 2, category: "R", status: "Open", targetDate: "2026-06-30" }),
      item({ id: 3, category: "R", status: "Closed" }),
      item({ id: 4, category: "I", status: "Open" }),
    ], TODAY);
    const rRow = r.byCategory.find((row) => row.category === "R")!;
    expect(rRow).toEqual({ category: "R", open: 2, closed: 1, overdue: 1 });
    const iRow = r.byCategory.find((row) => row.category === "I")!;
    expect(iRow.open).toBe(1);
    expect(iRow.overdue).toBe(0);
  });

  it("By Aging buckets at the boundaries", () => {
    const at = (n: number) => item({
      id: n,
      category: "R",
      status: "Open",
      raisedDate: addDays(TODAY, -n),
    });
    const r = computeRaidReport([at(0), at(30), at(31), at(60), at(61), at(90), at(91)], TODAY);
    const get = (b: "le30" | "31_60" | "61_90" | "gt90") => r.byAging.find((row) => row.bucket === b)!.open;
    expect(get("le30")).toBe(2);
    expect(get("31_60")).toBe(2);
    expect(get("61_90")).toBe(2);
    expect(get("gt90")).toBe(1);
  });

  it("Top 10 sorted by severity rank desc, age desc, id asc; cap = 10", () => {
    const items: RaidItem[] = [];
    for (let i = 1; i <= 12; i++) {
      items.push(item({ id: i, category: "I", severity: "Low", status: "Open" }));
    }
    items.push(item({ id: 100, category: "R", severity: "Critical", status: "Open" }));
    items.push(item({ id: 101, category: "R", severity: "High", status: "Open" }));
    const r = computeRaidReport(items, TODAY);
    expect(r.topOpen).toHaveLength(10);
    expect(r.topOpen[0]?.id).toBe(100);
    expect(r.topOpen[1]?.id).toBe(101);
  });

  it("Full Detail sorted by category (R, A, I, D) then id asc", () => {
    const r = computeRaidReport([
      item({ id: 3, category: "I" }),
      item({ id: 1, category: "R" }),
      item({ id: 2, category: "A" }),
      item({ id: 4, category: "D" }),
      item({ id: 5, category: "R" }),
    ], TODAY);
    expect(r.fullDetail.map((row) => row.id)).toEqual([1, 5, 2, 3, 4]);
  });
});

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Confirm tests fail**

`npx vitest run raid-report` → Expected: FAIL with "Cannot find module './raid-report'".

- [ ] **Step 3: Implement the compute**

Create `src/app/raid-report.ts`:

```ts
// src/app/raid-report.ts
//
// Pure compute for the RAID Report popout. Mirrors the resource-report.ts
// shape: input = items + today; output = tiles + group rows + topOpen +
// fullDetail. Presentation layer maps the UNASSIGNED_OWNER sentinel to the
// i18n string.

import {
  RAID_CATEGORIES,
  RAID_SEVERITIES,
  type RaidCategory,
  type RaidItem,
  type RaidSeverity,
  type RaidStatus,
} from "./types";

export const UNASSIGNED_OWNER = "__unassigned__";

const TERMINAL_STATUSES_BY_CATEGORY: Record<RaidCategory, ReadonlySet<RaidStatus>> = {
  R: new Set(["Closed", "Mitigated", "Realized"]),
  A: new Set(["Validated", "Invalidated"]),
  I: new Set(["Resolved", "Closed"]),
  D: new Set(["Delivered", "Closed"]),
};

const SEVERITY_RANK: Record<RaidSeverity | "Unrated", number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
  Unrated: 0,
};

export type RaidTiles = {
  openR: number;
  openA: number;
  openI: number;
  openD: number;
};

export type RaidSeverityRow = {
  severity: RaidSeverity | "Unrated";
  risks: number;
  assumptions: number;
  issues: number;
  dependencies: number;
  total: number;
};

export type RaidStatusRow = {
  status: RaidStatus;
  count: number;
};

export type RaidOwnerRow = {
  owner: string;
  openR: number;
  openA: number;
  openI: number;
  openD: number;
  total: number;
};

export type RaidCategoryRow = {
  category: RaidCategory;
  open: number;
  closed: number;
  overdue: number;
};

export type RaidAgingRow = {
  bucket: "le30" | "31_60" | "61_90" | "gt90";
  open: number;
};

export type RaidTopRow = {
  id: number;
  category: RaidCategory;
  title: string;
  severity?: RaidSeverity;
  owner: string;
  ageDays: number;
  status: RaidStatus;
  targetDate?: string;
  overdue: boolean;
};

export type RaidDetailRow = {
  id: number;
  category: RaidCategory;
  title: string;
  severity?: RaidSeverity;
  status: RaidStatus;
  owner: string;
  raisedDate: string;
  targetDate?: string;
  closedDate?: string;
  ageDays: number;
  linkedTaskCount: number;
  overdue: boolean;
};

export type RaidReport = {
  tiles: RaidTiles;
  bySeverity: RaidSeverityRow[];
  byStatus: RaidStatusRow[];
  byOwner: RaidOwnerRow[];
  byCategory: RaidCategoryRow[];
  byAging: RaidAgingRow[];
  topOpen: RaidTopRow[];
  fullDetail: RaidDetailRow[];
};

function isOpen(it: RaidItem): boolean {
  return !TERMINAL_STATUSES_BY_CATEGORY[it.category].has(it.status);
}

function normalizeOwner(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  return t === "" ? UNASSIGNED_OWNER : t;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00Z").getTime();
  const b = new Date(toIso + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((b - a) / (24 * 60 * 60 * 1000)));
}

function categoryRank(c: RaidCategory): number {
  return RAID_CATEGORIES.indexOf(c);
}

export function computeRaidReport(
  items: readonly RaidItem[],
  today: string,
): RaidReport {
  const tiles: RaidTiles = { openR: 0, openA: 0, openI: 0, openD: 0 };
  const sevMap = new Map<RaidSeverity | "Unrated", RaidSeverityRow>();
  const statusCount = new Map<RaidStatus, number>();
  const ownerMap = new Map<string, RaidOwnerRow>();
  const catMap = new Map<RaidCategory, RaidCategoryRow>();
  for (const c of RAID_CATEGORIES) {
    catMap.set(c, { category: c, open: 0, closed: 0, overdue: 0 });
  }
  const aging: RaidAgingRow[] = [
    { bucket: "le30", open: 0 },
    { bucket: "31_60", open: 0 },
    { bucket: "61_90", open: 0 },
    { bucket: "gt90", open: 0 },
  ];
  const topCandidates: RaidTopRow[] = [];
  const fullDetail: RaidDetailRow[] = [];

  let anyUnrated = false;

  for (const it of items) {
    const open = isOpen(it);
    const overdue = open && !!it.targetDate && it.targetDate < today;
    const ageDays = daysBetween(it.raisedDate, today);
    const owner = normalizeOwner(it.owner);

    if (open) {
      if (it.category === "R") tiles.openR++;
      else if (it.category === "A") tiles.openA++;
      else if (it.category === "I") tiles.openI++;
      else if (it.category === "D") tiles.openD++;
    }
    const cRow = catMap.get(it.category)!;
    if (open) cRow.open++;
    else cRow.closed++;
    if (overdue) cRow.overdue++;

    const sevKey: RaidSeverity | "Unrated" = it.severity ?? "Unrated";
    if (!it.severity) anyUnrated = true;
    let sevRow = sevMap.get(sevKey);
    if (!sevRow) {
      sevRow = { severity: sevKey, risks: 0, assumptions: 0, issues: 0, dependencies: 0, total: 0 };
      sevMap.set(sevKey, sevRow);
    }
    if (it.category === "R") sevRow.risks++;
    else if (it.category === "A") sevRow.assumptions++;
    else if (it.category === "I") sevRow.issues++;
    else if (it.category === "D") sevRow.dependencies++;
    sevRow.total++;

    if (open) {
      statusCount.set(it.status, (statusCount.get(it.status) ?? 0) + 1);
    }

    if (open) {
      let oRow = ownerMap.get(owner);
      if (!oRow) {
        oRow = { owner, openR: 0, openA: 0, openI: 0, openD: 0, total: 0 };
        ownerMap.set(owner, oRow);
      }
      if (it.category === "R") oRow.openR++;
      else if (it.category === "A") oRow.openA++;
      else if (it.category === "I") oRow.openI++;
      else if (it.category === "D") oRow.openD++;
      oRow.total++;
    }

    if (open) {
      const b: RaidAgingRow["bucket"] =
        ageDays <= 30 ? "le30" :
        ageDays <= 60 ? "31_60" :
        ageDays <= 90 ? "61_90" : "gt90";
      aging.find((row) => row.bucket === b)!.open++;
    }

    if (open) {
      topCandidates.push({
        id: it.id,
        category: it.category,
        title: it.title,
        severity: it.severity,
        owner,
        ageDays,
        status: it.status,
        targetDate: it.targetDate,
        overdue,
      });
    }

    fullDetail.push({
      id: it.id,
      category: it.category,
      title: it.title,
      severity: it.severity,
      status: it.status,
      owner,
      raisedDate: it.raisedDate,
      targetDate: it.targetDate,
      closedDate: it.closedDate,
      ageDays,
      linkedTaskCount: it.linkedTaskIds.length,
      overdue,
    });
  }

  const bySeverity: RaidSeverityRow[] = [];
  for (const sev of RAID_SEVERITIES) {
    const row = sevMap.get(sev);
    if (row) bySeverity.push(row);
  }
  if (anyUnrated) {
    const row = sevMap.get("Unrated");
    if (row) bySeverity.push(row);
  }

  const byStatus: RaidStatusRow[] = Array.from(statusCount.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));

  const byOwner: RaidOwnerRow[] = Array.from(ownerMap.values())
    .sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner));

  const byCategory: RaidCategoryRow[] = RAID_CATEGORIES.map((c) => catMap.get(c)!);

  const topOpen = topCandidates
    .sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity ?? "Unrated"];
      const sb = SEVERITY_RANK[b.severity ?? "Unrated"];
      if (sa !== sb) return sb - sa;
      if (a.ageDays !== b.ageDays) return b.ageDays - a.ageDays;
      return a.id - b.id;
    })
    .slice(0, 10);

  fullDetail.sort((a, b) => {
    const c = categoryRank(a.category) - categoryRank(b.category);
    return c !== 0 ? c : a.id - b.id;
  });

  return { tiles, bySeverity, byStatus, byOwner, byCategory, byAging: aging, topOpen, fullDetail };
}
```

- [ ] **Step 4: Confirm tests pass**

`npx vitest run raid-report` → Expected: 13 PASS.

- [ ] **Step 5: Gates**

`npx tsc --noEmit` (0) ; `npm run lint` (0). Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/raid-report.ts src/app/raid-report.test.ts
git commit -m "feat(raid-report): pure compute (tiles + 6 group rows + topOpen + fullDetail)"
```

---

## Task 2: `raid-report.tsx` shell — tiles + SegmentedControl + empty state

**Files:** Create `src/app/raid-report.tsx`.

- [ ] **Step 1: Create the component shell**

```tsx
"use client";

import { useMemo, useState } from "react";
import { SegmentedControl } from "./segmented-control";
import { type Lang, t } from "./i18n";
import {
  UNASSIGNED_OWNER,
  computeRaidReport,
  type RaidReport,
} from "./raid-report";
import type { RaidItem } from "./types";

interface Props {
  lang: Lang;
  items: readonly RaidItem[];
  today: string;
}

type View = "summary" | "full";

export function RaidReportPanel({ lang, items, today }: Props) {
  const rep: RaidReport = useMemo(() => computeRaidReport(items, today), [items, today]);
  const [view, setView] = useState<View>("summary");

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
        {t(lang, "raidReportEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-foreground">{t(lang, "raidReportTitle")}</h2>
        <SegmentedControl<View>
          value={view}
          ariaLabel={t(lang, "raidReportTitle")}
          options={[
            { value: "summary", label: t(lang, "raidReportSummary") },
            { value: "full", label: t(lang, "raidReportFullDetail") },
          ]}
          onChange={(v) => setView(v)}
        />
      </div>

      {view === "summary" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={t(lang, "raidReportOpenRisks")} value={String(rep.tiles.openR)} />
            <Tile label={t(lang, "raidReportOpenAssumptions")} value={String(rep.tiles.openA)} />
            <Tile label={t(lang, "raidReportOpenIssues")} value={String(rep.tiles.openI)} />
            <Tile label={t(lang, "raidReportOpenDependencies")} value={String(rep.tiles.openD)} />
          </div>
        </>
      )}

      {view === "full" && (
        <FullDetail lang={lang} rows={rep.fullDetail} />
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{title}</h3>
      {children}
    </div>
  );
}

// Filled in by Task 9.
function FullDetail({ lang, rows }: { lang: Lang; rows: RaidReport["fullDetail"] }) {
  void lang; void rows;
  return null;
}

function ownerCell(lang: Lang, owner: string) {
  if (owner === UNASSIGNED_OWNER) {
    return <span className="italic text-muted-foreground">{t(lang, "raidReportUnassigned")}</span>;
  }
  return owner;
}

export { Section, ownerCell };
```

- [ ] **Step 2: Type-check + lint**

`npx tsc --noEmit` (0) ; `npm run lint` (0). Restore `sample-workspace.md` if dirty. The `t(lang, "raidReportEmpty")` etc. calls reference i18n keys added in Task 11 — TypeScript may flag them as missing keys. If so, accept this temporarily and proceed; Task 11 adds the keys. If TypeScript treats the i18n keys as a string-literal union (strict), insert temporary placeholders via `(t as unknown as (l: Lang, k: string) => string)(lang, "raidReportEmpty")` for this commit only and revert in Task 11. Otherwise leave as is.

(Reality-check: the i18n key set is typed via the `enUS` object in `i18n.ts`. Adding the keys in Task 11 closes the type; the cleanest order is to do Task 11 immediately after Task 1, before this shell. The implementer can choose — note this in the task report.)

- [ ] **Step 3: Commit**

```bash
git add src/app/raid-report.tsx
git commit -m "feat(raid-report): popout shell — tiles + Summary/Full Detail toggle + empty state"
```

---

## Task 3: By Severity table

**Files:** Modify `src/app/raid-report.tsx`.

- [ ] **Step 1: Insert the table inside the Summary view, after the tiles grid**

Inside the `view === "summary" && (...)` block, AFTER the closing `</div>` of the tile grid, insert:

```tsx
<Section title={t(lang, "raidReportBySeverity")}>
  <div className="overflow-x-auto rounded-md border border-line">
    <table className="min-w-full text-left text-sm">
      <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">{t(lang, "raidReportBySeverity")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryRisk")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryAssumption")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryIssue")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryDependency")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColTotal")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rep.bySeverity.map((row) => (
          <tr key={row.severity}>
            <td className="px-3 py-2 font-medium text-foreground">
              {row.severity === "Unrated" ? (
                <span className="italic text-muted-foreground">{t(lang, "raidReportSeverityUnrated")}</span>
              ) : (
                row.severity
              )}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{row.risks}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.assumptions}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.issues}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.dependencies}</td>
            <td className="px-3 py-2 text-right tabular-nums font-medium">{row.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</Section>
```

The i18n keys `raidCategoryRisk` / `raidCategoryAssumption` / `raidCategoryIssue` / `raidCategoryDependency` should already exist (used by `raid-panel.tsx`). Confirm via Grep before placing them; if any are absent, use the literal strings "Risks" / "Assumptions" / "Issues" / "Dependencies" inline AND add the keys to Task 11's list.

- [ ] **Step 2: Gates + commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/raid-report.tsx
git commit -m "feat(raid-report): By Severity table"
```

---

## Task 4: By Status table

**Files:** Modify `src/app/raid-report.tsx`.

- [ ] **Step 1: Insert after By Severity**

```tsx
<Section title={t(lang, "raidReportByStatus")}>
  <div className="overflow-x-auto rounded-md border border-line">
    <table className="min-w-full text-left text-sm">
      <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">{t(lang, "raidReportByStatus")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColOpen")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rep.byStatus.map((row) => (
          <tr key={row.status}>
            <td className="px-3 py-2 font-medium text-foreground">{row.status}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</Section>
```

- [ ] **Step 2: Gates + commit**

```bash
git add src/app/raid-report.tsx
git commit -m "feat(raid-report): By Status table"
```

---

## Task 5: By Owner table

**Files:** Modify `src/app/raid-report.tsx`.

- [ ] **Step 1: Insert after By Status**

```tsx
<Section title={t(lang, "raidReportByOwner")}>
  <div className="overflow-x-auto rounded-md border border-line">
    <table className="min-w-full text-left text-sm">
      <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">{t(lang, "raidReportByOwner")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryRisk")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryAssumption")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryIssue")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryDependency")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColTotal")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rep.byOwner.map((row) => (
          <tr key={row.owner}>
            <td className="px-3 py-2 font-medium text-foreground">{ownerCell(lang, row.owner)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.openR}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.openA}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.openI}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.openD}</td>
            <td className="px-3 py-2 text-right tabular-nums font-medium">{row.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</Section>
```

- [ ] **Step 2: Gates + commit**

```bash
git add src/app/raid-report.tsx
git commit -m "feat(raid-report): By Owner table"
```

---

## Task 6: Top 10 Open mini-table

**Files:** Modify `src/app/raid-report.tsx`.

- [ ] **Step 1: Insert after By Owner**

```tsx
<Section title={t(lang, "raidReportTopOpen")}>
  <div className="overflow-x-auto rounded-md border border-line">
    <table className="min-w-full text-left text-sm">
      <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">{t(lang, "id")}</th>
          <th className="px-3 py-2 font-medium">{t(lang, "raidCategory")}</th>
          <th className="px-3 py-2 font-medium">{t(lang, "raidTitle")}</th>
          <th className="px-3 py-2 font-medium">{t(lang, "raidSeverity")}</th>
          <th className="px-3 py-2 font-medium">{t(lang, "raidOwner")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColAge")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rep.topOpen.map((row) => (
          <tr key={row.id}>
            <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.id}</td>
            <td className="px-3 py-2">{row.category}</td>
            <td className="px-3 py-2 text-foreground">
              <span className="block max-w-[40ch] truncate" title={row.title}>{row.title}</span>
            </td>
            <td className="px-3 py-2 text-muted-foreground">{row.severity ?? ""}</td>
            <td className="px-3 py-2">{ownerCell(lang, row.owner)}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${row.overdue ? "text-AIPM-pink font-medium" : "text-muted-foreground"}`}>
              {row.ageDays}d
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</Section>
```

Confirm `id`, `raidCategory`, `raidTitle`, `raidSeverity`, `raidOwner` exist via Grep; if absent, use literal strings AND add the keys to Task 11's list.

- [ ] **Step 2: Gates + commit**

```bash
git add src/app/raid-report.tsx
git commit -m "feat(raid-report): Top 10 Open mini-table"
```

---

## Task 7: By Category table

**Files:** Modify `src/app/raid-report.tsx`.

- [ ] **Step 1: Insert after Top 10 Open**

```tsx
<Section title={t(lang, "raidReportByCategory")}>
  <div className="overflow-x-auto rounded-md border border-line">
    <table className="min-w-full text-left text-sm">
      <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">{t(lang, "raidReportByCategory")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColOpen")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColClosed")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColOverdue")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rep.byCategory.map((row) => (
          <tr key={row.category}>
            <td className="px-3 py-2 font-medium text-foreground">{row.category}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.open}</td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.closed}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${row.overdue > 0 ? "text-AIPM-pink font-medium" : "text-muted-foreground"}`}>{row.overdue}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</Section>
```

- [ ] **Step 2: Gates + commit**

```bash
git add src/app/raid-report.tsx
git commit -m "feat(raid-report): By Category table"
```

---

## Task 8: By Aging table

**Files:** Modify `src/app/raid-report.tsx`.

- [ ] **Step 1: Add the bucket→label helper**

Next to the existing `Section` / `ownerCell` helpers, add:

```tsx
function agingLabel(lang: Lang, bucket: "le30" | "31_60" | "61_90" | "gt90"): string {
  switch (bucket) {
    case "le30": return t(lang, "raidReportAgingLE30");
    case "31_60": return t(lang, "raidReportAging31_60");
    case "61_90": return t(lang, "raidReportAging61_90");
    case "gt90": return t(lang, "raidReportAgingGT90");
  }
}
```

- [ ] **Step 2: Insert the table after By Category**

```tsx
<Section title={t(lang, "raidReportByAging")}>
  <div className="overflow-x-auto rounded-md border border-line">
    <table className="min-w-full text-left text-sm">
      <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">{t(lang, "raidReportByAging")}</th>
          <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColOpen")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rep.byAging.map((row) => (
          <tr key={row.bucket}>
            <td className="px-3 py-2 font-medium text-foreground">{agingLabel(lang, row.bucket)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.open}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</Section>
```

- [ ] **Step 3: Gates + commit**

```bash
git add src/app/raid-report.tsx
git commit -m "feat(raid-report): By Aging table"
```

---

## Task 9: Full Detail view — read-only sortable table

**Files:** Modify `src/app/raid-report.tsx`.

- [ ] **Step 1: Replace the stub `FullDetail` with the real implementation**

Replace the existing stub (from Task 2) with:

```tsx
type DetailSortKey = "id" | "category" | "title" | "severity" | "status" | "owner" | "raisedDate" | "targetDate" | "ageDays" | "linkedTaskCount";
type DetailSortDir = "asc" | "desc" | "off";

function FullDetail({ lang, rows }: { lang: Lang; rows: RaidReport["fullDetail"] }) {
  const [sortKey, setSortKey] = useState<DetailSortKey>("category");
  const [sortDir, setSortDir] = useState<DetailSortDir>("asc");

  function clickHeader(k: DetailSortKey) {
    if (k !== sortKey) {
      setSortKey(k);
      setSortDir("asc");
      return;
    }
    setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? "off" : "asc"));
  }

  const sorted = useMemo(() => {
    if (sortDir === "off") return rows;
    const cmp = (a: RaidReport["fullDetail"][number], b: RaidReport["fullDetail"][number]): number => {
      const av = (a[sortKey] ?? "") as string | number;
      const bv = (b[sortKey] ?? "") as string | number;
      if (av === bv) return a.id - b.id;
      return av < bv ? -1 : 1;
    };
    const arr = rows.slice().sort(cmp);
    if (sortDir === "desc") arr.reverse();
    return arr;
  }, [rows, sortKey, sortDir]);

  function indicator(k: DetailSortKey) {
    if (sortKey !== k || sortDir === "off") return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <SortTh label={t(lang, "id")} k="id" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("id")} />
            <SortTh label={t(lang, "raidCategory")} k="category" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("category")} />
            <SortTh label={t(lang, "raidTitle")} k="title" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("title")} />
            <SortTh label={t(lang, "raidSeverity")} k="severity" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("severity")} />
            <SortTh label={t(lang, "raidStatus")} k="status" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("status")} />
            <SortTh label={t(lang, "raidOwner")} k="owner" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("owner")} />
            <SortTh label={t(lang, "raidReportColRaised")} k="raisedDate" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("raisedDate")} />
            <SortTh label={t(lang, "raidReportColTarget")} k="targetDate" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("targetDate")} />
            <SortTh label={t(lang, "raidReportColAge")} k="ageDays" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("ageDays")} />
            <SortTh label={t(lang, "raidReportColLinkedTasks")} k="linkedTaskCount" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("linkedTaskCount")} />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.id}</td>
              <td className="px-3 py-2">{r.category}</td>
              <td className="px-3 py-2 text-foreground">
                <span className="block max-w-[60ch] truncate" title={r.title}>{r.title}</span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{r.severity ?? ""}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.status}</td>
              <td className="px-3 py-2">{ownerCell(lang, r.owner)}</td>
              <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.raisedDate}</td>
              <td className={`px-3 py-2 tabular-nums ${r.overdue ? "text-AIPM-pink font-medium" : "text-muted-foreground"}`}>
                {r.targetDate ?? "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.ageDays}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.linkedTaskCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortTh({
  label, k, sortKey, dir, onClick, indicator,
}: {
  label: string;
  k: DetailSortKey;
  sortKey: DetailSortKey;
  dir: DetailSortDir;
  onClick: (k: DetailSortKey) => void;
  indicator: string;
}) {
  const active = sortKey === k && dir !== "off";
  return (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""} hover:text-foreground`}
      >
        {label}{indicator}
      </button>
    </th>
  );
}
```

- [ ] **Step 2: Gates + commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/raid-report.tsx
git commit -m "feat(raid-report): Full Detail read-only sortable table"
```

---

## Task 10: Popout plumbing — `POPOUT_TABS` + RAID panel button + workspace dispatch

**Files:**
- Modify `src/app/broadcast-sync.ts`
- Modify `src/app/raid-panel.tsx`
- Modify `src/app/workspace-section.tsx`

- [ ] **Step 1: Add `"raid-report"` to `POPOUT_TABS`**

In `src/app/broadcast-sync.ts` (~L101–111):
- Find:
```ts
export const POPOUT_TABS = [
  "chat",
  "reports",
  "gantt",
  "raid",
  "resources",
  "activity",
  "resource-report",
  "address-book",
  "budget",
] as const;
```
- Replace:
```ts
export const POPOUT_TABS = [
  "chat",
  "reports",
  "gantt",
  "raid",
  "resources",
  "activity",
  "resource-report",
  "raid-report",
  "address-book",
  "budget",
] as const;
```

- [ ] **Step 2: Add the `onOpenReport` prop + Report button to the RAID panel**

Read `src/app/raid-panel.tsx` to locate the existing RAID toolbar (around the Reset Column Widths button added in 0.17.0). Add to the `Props` interface:

```ts
onOpenReport?: () => void;
```

Add `onOpenReport` to the destructure of `Props`. In the toolbar JSX, immediately AFTER `<ResetColWidthsButton onClick={resetColWidths} lang={lang} />`, insert:

```tsx
{onOpenReport && (
  <button
    type="button"
    onClick={onOpenReport}
    aria-label={t(lang, "raidReportOpenReportHint")}
    title={t(lang, "raidReportOpenReportHint")}
    className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
  >
    {t(lang, "raidReportOpenReport")}
  </button>
)}
```

- [ ] **Step 3: Wire the prop + dispatch case in `workspace-section.tsx`**

Read `src/app/workspace-section.tsx` around L380–410 (the existing `resource-report` dispatch). Two edits:

a) Import the component near the top of the file. Follow the existing pattern — if other panels are loaded via `dynamic(() => import("./..."))` (as `RaidPanel` is at L29), use the same dynamic-import pattern; otherwise use a static `import { RaidReportPanel } from "./raid-report";`.

b) On the `<RaidPanel>` invocation (Grep `<RaidPanel`), add the new prop:

```tsx
onOpenReport={() => openPopoutWindow("raid-report", settings.popout.reuseWindow)}
```

c) Add the dispatch case right after the `resource-report` block:

```tsx
{activeTab === "raid-report" && (
  <div id="panel-raid-report" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-4">
    <RaidReportPanel lang={lang} items={raid} today={today} />
  </div>
)}
```

`raid` is already destructured from `useWorkspace()` at L128. If `today` is not yet in scope, copy the pattern the `resource-report` case uses (the Resources Report receives `today`; the same variable should be accessible here).

- [ ] **Step 4: Gates + commit**

```bash
npx tsc --noEmit
npm run lint
npx vitest run broadcast-sync workspace-section raid-panel
```
Expected: PASS, 0 errors. If `broadcast-sync.test.ts` enumerates `POPOUT_TABS` and counts the entries, update fixtures to match the new count. If `raid-panel.test.tsx` mocks props, add `onOpenReport` to the mock if needed.

```bash
git add src/app/broadcast-sync.ts src/app/raid-panel.tsx src/app/workspace-section.tsx
git add src/app/broadcast-sync.test.ts src/app/raid-panel.test.tsx src/app/workspace-section.test.tsx 2>/dev/null || true
git commit -m "feat(raid-report): popout wiring — POPOUT_TABS, RAID panel Report button, workspace dispatch"
```

---

## Task 11: i18n EN + DE

**Files:**
- Modify `src/app/i18n.ts`
- Modify `src/app/i18n.de.ts`

- [ ] **Step 1: Add EN entries**

READ `src/app/i18n.ts`. Add the keys below near the other `raid*` entries (or in the file's existing sort order). Match indentation, quotes, and trailing-comma style of surrounding entries.

```ts
raidReportTitle: "RAID Report",
raidReportSummary: "Summary",
raidReportFullDetail: "Full Detail",
raidReportOpenRisks: "Open Risks",
raidReportOpenAssumptions: "Open Assumptions",
raidReportOpenIssues: "Open Issues",
raidReportOpenDependencies: "Open Dependencies",
raidReportBySeverity: "By Severity",
raidReportByStatus: "By Status",
raidReportByOwner: "By Owner",
raidReportTopOpen: "Top 10 Open",
raidReportByCategory: "By Category",
raidReportByAging: "By Aging",
raidReportColTotal: "Total",
raidReportColOpen: "Open",
raidReportColClosed: "Closed",
raidReportColOverdue: "Overdue",
raidReportColAge: "Age",
raidReportColRaised: "Raised",
raidReportColTarget: "Target",
raidReportColLinkedTasks: "Linked",
raidReportSeverityUnrated: "Unrated",
raidReportUnassigned: "Unassigned",
raidReportAgingLE30: "≤ 30 days",
raidReportAging31_60: "31–60 days",
raidReportAging61_90: "61–90 days",
raidReportAgingGT90: "> 90 days",
raidReportEmpty: "No RAID items yet. Add some in the RAID panel.",
raidReportOpenReport: "Open RAID Report",
raidReportOpenReportHint: "Open a steering-committee overview in a new window.",
versionHighlightRaidReport: "RAID Report: a steering-committee overview of open risks, issues, assumptions and dependencies — with a drill-down to the full item list.",
```

If any of `raidCategoryRisk` / `raidCategoryAssumption` / `raidCategoryIssue` / `raidCategoryDependency` / `raidCategory` / `raidTitle` / `raidSeverity` / `raidStatus` / `raidOwner` are missing (Tasks 3, 5, 6, 9 reference them), add them now:

```ts
raidCategory: "Category",
raidCategoryRisk: "Risks",
raidCategoryAssumption: "Assumptions",
raidCategoryIssue: "Issues",
raidCategoryDependency: "Dependencies",
raidTitle: "Title",
raidSeverity: "Severity",
raidStatus: "Status",
raidOwner: "Owner",
```

Grep first; only add the ones that don't exist.

- [ ] **Step 2: Add DE entries**

In `src/app/i18n.de.ts`:

```ts
raidReportTitle: "RAID-Report",
raidReportSummary: "Übersicht",
raidReportFullDetail: "Volldetail",
raidReportOpenRisks: "Offene Risiken",
raidReportOpenAssumptions: "Offene Annahmen",
raidReportOpenIssues: "Offene Issues",
raidReportOpenDependencies: "Offene Abhängigkeiten",
raidReportBySeverity: "Nach Schweregrad",
raidReportByStatus: "Nach Status",
raidReportByOwner: "Nach Owner",
raidReportTopOpen: "Top 10 offen",
raidReportByCategory: "Nach Kategorie",
raidReportByAging: "Nach Alter",
raidReportColTotal: "Gesamt",
raidReportColOpen: "Offen",
raidReportColClosed: "Geschlossen",
raidReportColOverdue: "Überfällig",
raidReportColAge: "Alter",
raidReportColRaised: "Erfasst",
raidReportColTarget: "Ziel",
raidReportColLinkedTasks: "Verlinkt",
raidReportSeverityUnrated: "Unbewertet",
raidReportUnassigned: "Nicht zugewiesen",
raidReportAgingLE30: "≤ 30 Tage",
raidReportAging31_60: "31–60 Tage",
raidReportAging61_90: "61–90 Tage",
raidReportAgingGT90: "> 90 Tage",
raidReportEmpty: "Noch keine RAID-Einträge. Über das RAID-Panel hinzufügen.",
raidReportOpenReport: "RAID-Report öffnen",
raidReportOpenReportHint: "Eine Steuerungskreis-Übersicht in einem neuen Fenster öffnen.",
versionHighlightRaidReport: "RAID-Report: Steuerungskreis-Übersicht über offene Risiken, Issues, Annahmen und Abhängigkeiten — mit Drill-Down zur vollständigen Item-Liste.",
```

If German equivalents of the `raidCategoryRisk` etc. keys are added on the EN side, add their DE counterparts: `raidCategory: "Kategorie"`, `raidCategoryRisk: "Risiken"`, `raidCategoryAssumption: "Annahmen"`, `raidCategoryIssue: "Issues"`, `raidCategoryDependency: "Abhängigkeiten"`, `raidTitle: "Titel"`, `raidSeverity: "Schweregrad"`, `raidStatus: "Status"`, `raidOwner: "Owner"`.

- [ ] **Step 3: Gates + commit**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(raid-report): i18n EN + DE (all report keys + highlight)"
```

---

## Task 12: Release 0.18.0

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — READ first. Set `APP_VERSION = "0.18.0"` (currently `"0.17.1"`). Keep `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`. Add a new top-of-file comment block ABOVE the existing `// 0.17.1 …` block:

```ts
// 0.18.0 adds the RAID Report — a steering-committee popout opened from the
// RAID panel showing tile counts per category plus six summary tables
// (severity, status, owner, top 10, category, aging) and a drill-down to a
// full read-only sortable item table.
```

Append `"versionHighlightRaidReport"` as the LAST entry of `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: CHANGELOG** — READ to match style; add a new `[0.18.0] — 2026-05-28 "Jemisin"` entry ABOVE the `[0.17.1]` entry:

```markdown
## [0.18.0] — 2026-05-28 "Jemisin"

### Added
- RAID Report: a steering-committee popout opened from the RAID panel's "Open RAID Report" button. Shows four headline tiles (open counts per RAID category) and six summary tables (By Severity, By Status, By Owner, Top 10 Open, By Category, By Aging). A Summary / Full Detail toggle at the top of the report drills down to a full read-only sortable item table.
- New version highlight: "RAID Report" (`versionHighlightRaidReport`) in both EN and DE.
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run test:coverage
```
Expected: tsc 0; lint 0; all suites pass; coverage ≥ 70%. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "docs(release): 0.18.0 Jemisin — RAID Report popout with drill-down"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Confirm:

1. **Scope:** only these files touched: `raid-report.ts`, `raid-report.test.ts`, `raid-report.tsx`, `raid-panel.tsx`, `broadcast-sync.ts`, `workspace-section.tsx`, `i18n.ts`, `i18n.de.ts`, `version.ts`, `CHANGELOG.md` (+ optionally `broadcast-sync.test.ts`, `raid-panel.test.tsx`, `workspace-section.test.tsx` if assertions had to update).
2. **Compute contract:** `raid-report.ts` exports `computeRaidReport(items, today): RaidReport`, `UNASSIGNED_OWNER` constant, and the documented row types. 13 unit tests pass.
3. **Presentation:** `raid-report.tsx` renders Tiles (4), the SegmentedControl, 6 summary tables in Summary view, the Full Detail sortable table in Full Detail view, and the empty state when items=[].
4. **Popout plumbing:** `POPOUT_TABS` includes `"raid-report"`; RAID panel has the new Report button when `onOpenReport` is passed; workspace-section dispatches `activeTab === "raid-report"` to `<RaidReportPanel>`.
5. **i18n:** every key referenced by `raid-report.tsx` exists in BOTH `i18n.ts` and `i18n.de.ts`; `versionHighlightRaidReport` is in both files.
6. **Release metadata:** `APP_VERSION === "0.18.0"`; `APP_BUILD_DATE` still `// Jemisin milestone`; `APP_HIGHLIGHT_KEYS` ends with `"versionHighlightRaidReport"`; CHANGELOG `[0.18.0]` entry non-empty.
7. **Gates:** `npx tsc --noEmit` 0; `npm run lint` 0; `npx vitest run` all tests pass (≥ 898 + 13 new = 911+); `npm run test:coverage` ≥ 70%.

After approval, use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- Compute + 13 unit tests → Task 1 ✓
- Tiles + SegmentedControl + empty state → Task 2 ✓
- 6 summary tables → Tasks 3–8 ✓
- Full Detail sortable read-only table → Task 9 ✓
- Popout plumbing → Task 10 ✓
- i18n EN + DE (all keys + highlight) → Task 11 ✓
- Release 0.18.0 + highlight + CHANGELOG → Task 12 ✓
- Non-goals (no editing in report; no filters; no PDF; no date scoping; no risk-matrix heatmap) → not implemented in any task ✓

**Placeholder scan:** No TBD/TODO. Tasks 3, 5, 6, 9 carry a Grep-first instruction for i18n keys that should already exist; Task 11 covers any missing ones explicitly.

**Type consistency:** `RaidReport` shape locked in Task 1; each summary-table task binds to its corresponding field (`rep.bySeverity`, `rep.byStatus`, etc.) with consistent property names. `ownerCell()` helper from Task 2 is reused in Tasks 5, 6, 9. The bucket enum (`"le30" | "31_60" | "61_90" | "gt90"`) matches the i18n key suffixes in Task 11.

**Ordering note:** Tasks 3–8 add tables to `raid-report.tsx` sequentially. Tasks 10 (popout plumbing) and 11 (i18n) depend on the component existing; Task 12 (release) depends on everything else. Subagent-driven runs sequentially → correct. Implementer may choose to do Task 11 immediately after Task 1 to close the i18n key type before Task 2's shell renders strings — note this as an acceptable variance.
