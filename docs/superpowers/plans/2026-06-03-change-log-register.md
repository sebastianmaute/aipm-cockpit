# Change-Control Log (Register) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-management change-control register ("Change Log") as a first-class RAID sibling: a new `ChangeItem` workspace entity with panel, edit modal, printable report, task + RAID cross-links, a computed dashboard Scope signal, and persistence across every backend.

**Architecture:** New `ChangeItem` entity mirroring the RAID log's file structure and the Milestones (0.44.0) new-entity precedent. Pure logic in `change-log.ts`; storage via the column-driven registry (schema v6→v7 additive migration); `change-panel.tsx` + `change-edit-modal.tsx` + `change-report-panel.tsx`; a `use-change-log.ts` CRUD hook; dashboard Scope signal; nav wiring through `AppView`/`TopTab`.

**Tech Stack:** Next.js 16 / React / TypeScript, Vitest 4 + React Testing Library, Tailwind v4, AIPM palette tokens only.

---

## Critical conventions (read before any task)

- **GIT SAFETY (every task):** ONLY `git add` / `git commit`. NEVER `checkout`, `switch`, `reset`, `stash`, `rebase`, `revert`, `clean`, `restore`, branch, merge, push. Read-only git otherwise. Stay on `feat-change-log`.
- **AIPM palette HARD constraint:** only the 9 brand tokens in `globals.css` (`AIPM-green`, `AIPM-dark-blue`, `AIPM-pink`, `AIPM-purple`, surface/line/muted). No raw hex, gradients, or shadows.
- **i18n parity:** every new key in BOTH `i18n.ts` (EN) and `i18n.de.ts` (DE); `tsc` enforces it. In `i18n.de.ts` use STRAIGHT ASCII quotes and ASCII transliterations (ae/oe/ue) — never curly quotes/umlauts. Grep the new lines after editing.
- **Commands:** `npx tsc --noEmit`; `npm run lint`; `npx vitest run <file>`; `npm run test:run` (full).
- **Commits:** Conventional Commits via the Bash tool: `git commit -F - <<'EOF' … EOF`.

## Canonical model (use verbatim everywhere)

`CHANGES_CSV_COLUMNS` (the column order, = `(keyof ChangeItem)[]`):
```
id, title, description, type, status, impact, impactDescription, scheduleImpactDays,
costImpact, requestedBy, raisedDate, decisionBy, decisionDate, resolutionNotes,
linkedTaskIds, linkedRaidIds, localModifiedAt
```
- **Pending** statuses = `Proposed`, `Under Review`. **Terminal** = `Rejected`, `Implemented`, `Deferred`. `Approved` = decided-but-active.
- `ChangeImpact` is an alias of `RaidSeverity` (`Low|Medium|High|Critical`); RAG via `severityRag`.

## File structure

| File | Responsibility | Status |
|---|---|---|
| `src/app/types.ts` | `ChangeItem`, `ChangeType`, `ChangeStatus`, `ChangeImpact`, `CHANGE_TYPES`, `CHANGE_STATUSES` | Modify |
| `src/app/change-log.ts` | Pure helpers (statuses, indices, compare, scope signal, top-changes) | Create |
| `src/app/sanitize.ts` | `sanitizeChangeItem` | Modify |
| `src/app/storage.ts` | `Workspace.changes`, v7 migration, CSV/MD/JSON round-trip | Modify |
| `src/app/turso-schema.ts` | `changes` ENTITY_SPECS entry + `SCHEMA_VERSION="7"` | Modify |
| `src/app/workspace-context.tsx` | `changes`/`setChanges` state | Modify |
| `src/app/use-change-log.ts` | CRUD hook + decisionDate auto-fill | Create |
| `src/app/change-edit-modal.tsx` | Draggable edit modal + task/RAID pickers | Create |
| `src/app/change-panel.tsx` | Sortable/filterable register table | Create |
| `src/app/change-report-panel.tsx` | Printable Change Report | Create |
| `src/app/dashboard.ts` | Computed Scope signal + changes summary | Modify |
| `src/app/dashboard-panel.tsx` | Changes subsection | Modify |
| `src/app/nav-config.ts`, `nav-icons.tsx`, `workspace-tab-context.tsx`, `workspace-section.tsx`, `task-manager.tsx` | Nav + mount + wiring | Modify |
| `src/app/task-row.tsx`, `tasks-section.tsx` | "N changes" badge | Modify |
| `src/app/i18n.ts`, `i18n.de.ts` | New keys | Modify |
| `version.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/frontend.md` | 0.50.0 "Sanderson" bump | Modify |

---

## Task 1: `ChangeItem` type + enums

**Files:** Modify `src/app/types.ts`; Test `src/app/change-types.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/app/change-types.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { CHANGE_STATUSES, CHANGE_TYPES } from "./types";

describe("change enums", () => {
  it("lists the 5 change types", () => {
    expect(CHANGE_TYPES).toEqual(["Scope", "Schedule", "Cost", "Quality", "Other"]);
  });
  it("lists the 6 statuses in lifecycle order", () => {
    expect(CHANGE_STATUSES).toEqual(["Proposed", "Under Review", "Approved", "Rejected", "Implemented", "Deferred"]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/app/change-types.test.ts` → FAIL (exports not found).

- [ ] **Step 3: Add to `src/app/types.ts`** (near the `RaidItem`/`Milestone` types; `RaidSeverity` is already defined in this file):

```ts
export const CHANGE_TYPES = ["Scope", "Schedule", "Cost", "Quality", "Other"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_STATUSES = [
  "Proposed", "Under Review", "Approved", "Rejected", "Implemented", "Deferred",
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** Impact rating reuses the RAID severity scale + its RAG palette. */
export type ChangeImpact = RaidSeverity;

export type ChangeItem = {
  id: number;
  title: string;
  description: string;
  type: ChangeType;
  status: ChangeStatus;
  impact?: ChangeImpact;
  impactDescription?: string;
  scheduleImpactDays?: number;
  costImpact?: number;
  requestedBy?: string;
  raisedDate: string;          // YYYY-MM-DD
  decisionBy?: string;
  decisionDate?: string;       // YYYY-MM-DD; auto-filled when status leaves the pending set
  resolutionNotes?: string;
  linkedTaskIds: number[];
  linkedRaidIds: number[];
  localModifiedAt?: string;
};
```

- [ ] **Step 4: Run** the test → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/types.ts src/app/change-types.test.ts
git commit -F - <<'EOF'
feat: ChangeItem type + change enums (change-control register)
EOF
```

---

## Task 2: `change-log.ts` — predicates, ids, impact RAG, counts, index

**Files:** Create `src/app/change-log.ts`, `src/app/change-log.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/app/change-log.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  buildChangeByTaskIndex, changeImpactRag, countByStatus, countByType,
  defaultChangeStatus, isPendingChange, isTerminalChangeStatus, nextChangeId,
} from "./change-log";
import type { ChangeItem } from "./types";

function ci(over: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id: 1, title: "t", description: "", type: "Scope", status: "Proposed",
    raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], ...over,
  };
}

describe("change-log predicates", () => {
  it("defaultChangeStatus is Proposed", () => expect(defaultChangeStatus()).toBe("Proposed"));
  it("pending = Proposed | Under Review", () => {
    expect(isPendingChange("Proposed")).toBe(true);
    expect(isPendingChange("Under Review")).toBe(true);
    expect(isPendingChange("Approved")).toBe(false);
  });
  it("terminal = Rejected | Implemented | Deferred", () => {
    expect(isTerminalChangeStatus("Rejected")).toBe(true);
    expect(isTerminalChangeStatus("Implemented")).toBe(true);
    expect(isTerminalChangeStatus("Deferred")).toBe(true);
    expect(isTerminalChangeStatus("Approved")).toBe(false);
    expect(isTerminalChangeStatus("Proposed")).toBe(false);
  });
});

describe("change-log helpers", () => {
  it("nextChangeId is max+1 (1 when empty)", () => {
    expect(nextChangeId([])).toBe(1);
    expect(nextChangeId([ci({ id: 3 }), ci({ id: 7 })])).toBe(8);
  });
  it("changeImpactRag maps via severity", () => {
    expect(changeImpactRag("Critical")).toBe("R");
    expect(changeImpactRag("Medium")).toBe("A");
    expect(changeImpactRag("Low")).toBe("G");
    expect(changeImpactRag(undefined)).toBe("G");
  });
  it("countByType / countByStatus tally", () => {
    const items = [ci({ type: "Scope", status: "Proposed" }), ci({ id: 2, type: "Cost", status: "Approved" })];
    expect(countByType(items).Scope).toBe(1);
    expect(countByType(items).Cost).toBe(1);
    expect(countByStatus(items).Approved).toBe(1);
  });
  it("buildChangeByTaskIndex groups by linked task id", () => {
    const a = ci({ id: 1, linkedTaskIds: [10, 20] });
    const b = ci({ id: 2, linkedTaskIds: [20] });
    const idx = buildChangeByTaskIndex([a, b]);
    expect(idx.get(10)).toHaveLength(1);
    expect(idx.get(20)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run** → FAIL (import not found).

- [ ] **Step 3: Create `src/app/change-log.ts`**

```ts
// Pure helpers for the Change-control Log. No React, no DOM. Sibling to raid.ts.
import type { Health } from "./health";
import { severityRag } from "./raid";
import {
  CHANGE_STATUSES, CHANGE_TYPES,
  type ChangeImpact, type ChangeItem, type ChangeStatus, type ChangeType,
} from "./types";

const PENDING: ReadonlySet<ChangeStatus> = new Set(["Proposed", "Under Review"]);
const TERMINAL: ReadonlySet<ChangeStatus> = new Set(["Rejected", "Implemented", "Deferred"]);

export function defaultChangeStatus(): ChangeStatus {
  return "Proposed";
}
export function isPendingChange(status: ChangeStatus): boolean {
  return PENDING.has(status);
}
export function isTerminalChangeStatus(status: ChangeStatus): boolean {
  return TERMINAL.has(status);
}

/** Impact rating → RAG, reusing the RAID severity palette. */
export function changeImpactRag(impact: ChangeImpact | undefined): Health {
  return severityRag(impact);
}

/** Next id — monotonic, separate from task/raid ids. */
export function nextChangeId(items: readonly ChangeItem[]): number {
  let max = 0;
  for (const i of items) if (i.id > max) max = i.id;
  return max + 1;
}

export function countByType(items: readonly ChangeItem[]): Record<ChangeType, number> {
  const out = Object.fromEntries(CHANGE_TYPES.map((t) => [t, 0])) as Record<ChangeType, number>;
  for (const i of items) out[i.type] += 1;
  return out;
}

export function countByStatus(items: readonly ChangeItem[]): Record<ChangeStatus, number> {
  const out = Object.fromEntries(CHANGE_STATUSES.map((s) => [s, 0])) as Record<ChangeStatus, number>;
  for (const i of items) out[i.status] += 1;
  return out;
}

/** Reverse index: task id → change items that link it. */
export function buildChangeByTaskIndex(items: readonly ChangeItem[]): Map<number, ChangeItem[]> {
  const idx = new Map<number, ChangeItem[]>();
  for (const item of items) {
    for (const tid of item.linkedTaskIds) {
      const list = idx.get(tid);
      if (list) list.push(item);
      else idx.set(tid, [item]);
    }
  }
  return idx;
}
```

- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/change-log.ts src/app/change-log.test.ts
git commit -F - <<'EOF'
feat: change-log pure helpers (predicates, ids, impact RAG, counts, index)
EOF
```

---

## Task 3: `change-log.ts` — `compareChange` sort comparator

**Files:** Modify `src/app/change-log.ts`, `src/app/change-log.test.ts`.

- [ ] **Step 1: Append tests**

```ts
import { compareChange, type ChangeSortKey } from "./change-log";

describe("compareChange", () => {
  const a = ci({ id: 1, title: "alpha", type: "Scope", impact: "Low", status: "Proposed", requestedBy: "Ann", raisedDate: "2026-06-01", decisionDate: "2026-06-05" });
  const b = ci({ id: 2, title: "beta", type: "Cost", impact: "Critical", status: "Approved", requestedBy: "Bob", raisedDate: "2026-06-02" });
  const sorted = (key: ChangeSortKey, dir: "asc" | "desc") => [a, b].slice().sort((x, y) => compareChange(x, y, key, dir));
  it("sorts by impact rank ascending (Low < Critical)", () => {
    expect(sorted("impact", "asc").map((x) => x.id)).toEqual([1, 2]);
  });
  it("sorts by title descending", () => {
    expect(sorted("title", "desc").map((x) => x.id)).toEqual([2, 1]);
  });
  it("puts a missing decisionDate LAST regardless of direction", () => {
    expect(sorted("decisionDate", "asc").map((x) => x.id)).toEqual([1, 2]);
    expect(sorted("decisionDate", "desc").map((x) => x.id)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Append to `src/app/change-log.ts`** (mirrors `compareRaid` in `raid.ts`):

```ts
export type ChangeSortKey =
  | "id" | "type" | "title" | "impact" | "status" | "requestedBy" | "raisedDate" | "decisionDate";

const IMPACT_RANK: Record<ChangeImpact, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

function changeSortValue(item: ChangeItem, key: ChangeSortKey): string | number {
  switch (key) {
    case "id": return item.id;
    case "type": return CHANGE_TYPES.indexOf(item.type);
    case "title": return item.title.toLowerCase();
    case "impact": return item.impact ? IMPACT_RANK[item.impact] : 0;
    case "status": return CHANGE_STATUSES.indexOf(item.status);
    case "requestedBy": return (item.requestedBy ?? "").toLowerCase();
    case "raisedDate": return item.raisedDate ?? "";
    case "decisionDate": return item.decisionDate ?? "";
  }
}

/** Compare two change items by a column. Missing decisionDate always sorts LAST. */
export function compareChange(a: ChangeItem, b: ChangeItem, key: ChangeSortKey, dir: "asc" | "desc"): number {
  if (key === "decisionDate") {
    const av = a.decisionDate ?? "", bv = b.decisionDate ?? "";
    if (av === "" || bv === "") {
      if (av === bv) return 0;
      return av === "" ? 1 : -1;
    }
  }
  const av = changeSortValue(a, key), bv = changeSortValue(b, key);
  const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  return dir === "asc" ? cmp : -cmp;
}
```

- [ ] **Step 4: Run** → PASS. tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/change-log.ts src/app/change-log.test.ts
git commit -F - <<'EOF'
feat: change-log compareChange sort comparator
EOF
```

---

## Task 4: `change-log.ts` — `computeScopeStatus` + `selectTopChanges`

**Files:** Modify `src/app/change-log.ts`, `src/app/change-log.test.ts`.

- [ ] **Step 1: Append tests**

```ts
import { computeScopeStatus, SCOPE_PENDING_RED, selectTopChanges } from "./change-log";

describe("computeScopeStatus", () => {
  it("null when no pending changes", () => {
    expect(computeScopeStatus([ci({ status: "Approved" })])).toBeNull();
  });
  it("Amber with 1..4 pending", () => {
    expect(computeScopeStatus([ci({ status: "Proposed" })])).toBe("A");
  });
  it("Red at the threshold", () => {
    const pend = Array.from({ length: SCOPE_PENDING_RED }, (_, i) => ci({ id: i + 1, status: "Under Review" }));
    expect(computeScopeStatus(pend)).toBe("R");
  });
});

describe("selectTopChanges", () => {
  it("returns pending only, highest impact first, capped", () => {
    const items = [
      ci({ id: 1, status: "Proposed", impact: "Low" }),
      ci({ id: 2, status: "Under Review", impact: "Critical" }),
      ci({ id: 3, status: "Approved", impact: "Critical" }), // not pending -> excluded
    ];
    const top = selectTopChanges(items, 5);
    expect(top.map((c) => c.id)).toEqual([2, 1]);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Append to `src/app/change-log.ts`**

```ts
/** Pending-change backlog at/above this count drives the dashboard Scope RAG to Red. */
export const SCOPE_PENDING_RED = 5;

/** Computed Scope RAG from the pending-change backlog. null when none pending. */
export function computeScopeStatus(
  changes: readonly ChangeItem[],
  redThreshold: number = SCOPE_PENDING_RED,
): Health | null {
  const pending = changes.filter((c) => isPendingChange(c.status)).length;
  if (pending === 0) return null;
  if (pending >= redThreshold) return "R";
  return "A";
}

/** Pending changes, highest impact first (tie-break most-recently-raised, then id), capped. */
export function selectTopChanges(changes: readonly ChangeItem[], limit: number): ChangeItem[] {
  return changes
    .filter((c) => isPendingChange(c.status))
    .map((c) => ({ c, rank: c.impact ? IMPACT_RANK[c.impact] : 0 }))
    .sort((a, b) => b.rank - a.rank || b.c.raisedDate.localeCompare(a.c.raisedDate) || a.c.id - b.c.id)
    .slice(0, limit)
    .map((x) => x.c);
}
```

- [ ] **Step 4: Run** → PASS. tsc clean. `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/change-log.ts src/app/change-log.test.ts
git commit -F - <<'EOF'
feat: change-log computeScopeStatus + selectTopChanges
EOF
```

---

## Task 5: `sanitizeChangeItem`

**Files:** Modify `src/app/sanitize.ts`, Test `src/app/sanitize-change.test.ts`.

**Context:** `sanitize.ts` already exports helpers `isPlainObject`, `toNumber`, `sanitizeText`, `sanitizeIsoDate`, `sanitizeIdList`, and constants `TEXTAREA_MAX`, `BUDGET_NAME_MAX`. Reuse them (read the top of the file to confirm names). The enums import from `./types`.

- [ ] **Step 1: Write the failing test** — `src/app/sanitize-change.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { sanitizeChangeItem } from "./sanitize";

describe("sanitizeChangeItem", () => {
  it("returns null without a positive id or a title", () => {
    expect(sanitizeChangeItem({ title: "x" })).toBeNull();
    expect(sanitizeChangeItem({ id: 1 })).toBeNull();
  });
  it("accepts a minimal valid item with enum + array defaults", () => {
    const c = sanitizeChangeItem({ id: 2, title: "Add scope", raisedDate: "2026-06-01" });
    expect(c).toMatchObject({ id: 2, title: "Add scope", type: "Other", status: "Proposed", linkedTaskIds: [], linkedRaidIds: [] });
  });
  it("falls back to Other/Proposed for invalid enums and clamps numbers", () => {
    const c = sanitizeChangeItem({ id: 3, title: "t", type: "Bogus", status: "Nope", scheduleImpactDays: -4, costImpact: "12.5" });
    expect(c?.type).toBe("Other");
    expect(c?.status).toBe("Proposed");
    expect(c?.scheduleImpactDays).toBeUndefined(); // negative -> dropped
    expect(c?.costImpact).toBe(12.5);
  });
  it("keeps valid impact + decision fields + id arrays", () => {
    const c = sanitizeChangeItem({ id: 4, title: "t", impact: "High", status: "Approved", decisionBy: "Bob", decisionDate: "2026-06-09", linkedTaskIds: [1, "2", -3, 0], linkedRaidIds: [5] });
    expect(c?.impact).toBe("High");
    expect(c?.decisionDate).toBe("2026-06-09");
    expect(c?.linkedTaskIds).toEqual([1, 2]);
    expect(c?.linkedRaidIds).toEqual([5]);
  });
});
```

- [ ] **Step 2: Run** → FAIL (export not found).

- [ ] **Step 3: Add to `src/app/sanitize.ts`** (place near `sanitizeMilestone`; add the enum + `ChangeImpact` imports to the existing `./types` import — `CHANGE_TYPES`, `CHANGE_STATUSES`, `ChangeItem`, `ChangeType`, `ChangeStatus`). `RaidSeverity`/impact validity reuses a literal set):

```ts
const CHANGE_TYPE_SET = new Set<string>(CHANGE_TYPES);
const CHANGE_STATUS_SET = new Set<string>(CHANGE_STATUSES);
const CHANGE_IMPACT_SET = new Set<string>(["Low", "Medium", "High", "Critical"]);

/** Accept only well-formed change items from untrusted JSON. id>0 + title required. */
export function sanitizeChangeItem(input: unknown): ChangeItem | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const title = sanitizeText(o.title, BUDGET_NAME_MAX);
  if (!title) return null;

  const type = (typeof o.type === "string" && CHANGE_TYPE_SET.has(o.type)) ? (o.type as ChangeType) : "Other";
  const status = (typeof o.status === "string" && CHANGE_STATUS_SET.has(o.status)) ? (o.status as ChangeStatus) : "Proposed";

  const item: ChangeItem = {
    id: Math.floor(id),
    title,
    description: sanitizeText(o.description, TEXTAREA_MAX),
    type,
    status,
    raisedDate: sanitizeIsoDate(o.raisedDate) ?? "",
    linkedTaskIds: sanitizeIdList(o.linkedTaskIds),
    linkedRaidIds: sanitizeIdList(o.linkedRaidIds),
  };
  if (typeof o.impact === "string" && CHANGE_IMPACT_SET.has(o.impact)) item.impact = o.impact as ChangeItem["impact"];
  const impactDesc = sanitizeText(o.impactDescription, TEXTAREA_MAX); if (impactDesc) item.impactDescription = impactDesc;
  const days = toNumber(o.scheduleImpactDays); if (Number.isFinite(days) && days >= 0) item.scheduleImpactDays = days;
  const cost = toNumber(o.costImpact); if (Number.isFinite(cost) && cost >= 0) item.costImpact = cost;
  const reqBy = sanitizeText(o.requestedBy, BUDGET_NAME_MAX); if (reqBy) item.requestedBy = reqBy;
  const decBy = sanitizeText(o.decisionBy, BUDGET_NAME_MAX); if (decBy) item.decisionBy = decBy;
  const decDate = sanitizeIsoDate(o.decisionDate); if (decDate) item.decisionDate = decDate;
  const notes = sanitizeText(o.resolutionNotes, TEXTAREA_MAX); if (notes) item.resolutionNotes = notes;
  const lma = sanitizeText(o.localModifiedAt, TEXTAREA_MAX); if (lma) item.localModifiedAt = lma;
  return item;
}
```

> NOTE: confirm the exact helper names by reading `sanitize.ts` (`sanitizeText`, `sanitizeIsoDate`, `sanitizeIdList`, `toNumber`, `isPlainObject`, `TEXTAREA_MAX`, `BUDGET_NAME_MAX` all exist per Task 5 context). If `sanitizeIdList` is not exported (it's currently module-private), EXPORT it (add `export`) — `buildChangeFromObj` in Task 7 also needs it. Report if you export it.

- [ ] **Step 4: Run** → PASS. tsc + lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/sanitize.ts src/app/sanitize-change.test.ts
git commit -F - <<'EOF'
feat: sanitizeChangeItem (enum fallback, number clamp, id arrays)
EOF
```

---

## Task 6: Workspace.changes + emptyWorkspace + v7 migration

**Files:** Modify `src/app/storage.ts`; Test `src/app/storage-change-migration.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/app/storage-change-migration.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { emptyWorkspace, migrateWorkspaceV7 } from "./storage";

describe("changes workspace field + v7 migration", () => {
  it("emptyWorkspace seeds changes: []", () => {
    expect(emptyWorkspace().changes).toEqual([]);
  });
  it("migrateWorkspaceV7 seeds changes on an older workspace", () => {
    const ws = { ...emptyWorkspace(), changes: undefined } as ReturnType<typeof emptyWorkspace>;
    const migrated = migrateWorkspaceV7(ws);
    expect(migrated.changes).toEqual([]);
  });
  it("migrateWorkspaceV7 preserves existing changes", () => {
    const ws = { ...emptyWorkspace(), changes: [{ id: 1, title: "x", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [] }] } as ReturnType<typeof emptyWorkspace>;
    expect(migrateWorkspaceV7(ws).changes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Edit `src/app/storage.ts`:**
  - Add `import type { ChangeItem } from "./types";` (merge with the existing types import).
  - Add to the `Workspace` type (after `milestones?`): `/** Change-control register. Optional for back-compat; load paths default to []. */ changes?: ChangeItem[];`
  - Change `const SCHEMA_VERSION = 6;` → `7`.
  - In `emptyWorkspace()`, add `changes: [],` to the returned object.
  - Add the v7 migration after `migrateWorkspaceV6`:

```ts
/**
 * v7 migration: ensures the change-control register exists. Runs after v6.
 * Idempotent — reuses arrays/values unchanged.
 */
export function migrateWorkspaceV7(ws: Workspace): Workspace {
  const base = migrateWorkspaceV6(ws);
  const changes = Array.isArray(base.changes) ? base.changes : [];
  if (changes === base.changes) return base;
  return { ...base, changes };
}
```

  - **Replace every call to `migrateWorkspaceV6(...)` with `migrateWorkspaceV7(...)`** in this file (the load paths: JSON, CSV, Markdown, IDB — there are ~5 call sites at the lines found by grepping `migrateWorkspaceV6(`). The Turso path imports the migration from turso-schema; that's handled in Task 9. Grep `migrateWorkspaceV6` after editing — only the function *definition* and `migrateWorkspaceV7`'s internal call should remain.)

- [ ] **Step 4: Run** the new test + the existing storage suite: `npx vitest run src/app/storage-change-migration.test.ts src/app/storage.test.ts` → PASS. tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/storage.ts src/app/storage-change-migration.test.ts
git commit -F - <<'EOF'
feat: Workspace.changes + schema v7 additive migration
EOF
```

---

## Task 7: Changes JSON round-trip (columns + encoders + decoders)

**Files:** Modify `src/app/storage.ts`; Test `src/app/storage-change-roundtrip.test.ts`.

**Context:** `storage.ts` has `parseLinkedTaskIds` (pipe-split → number[]) and a `jsonToWorkspace`/`workspaceToJson` path that already serializes `milestones`. The JSON path serializes the whole `Workspace` object, so `changes` round-trips through JSON automatically once it's on the `Workspace` and `emptyWorkspace`/migration default it — BUT the load path must sanitize untrusted `changes`. Confirm how milestones are sanitized on JSON load (search for `sanitizeMilestone` usage in `jsonToWorkspace`) and mirror it for `changes` via `sanitizeChangeItem`.

- [ ] **Step 1: Write the failing test** — `src/app/storage-change-roundtrip.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { jsonToWorkspace, workspaceToJson, emptyWorkspace, CHANGES_CSV_COLUMNS, changeFieldToString, buildChangeFromObj } from "./storage";
import type { ChangeItem } from "./types";

const change: ChangeItem = {
  id: 1, title: "Widen scope", description: "add module", type: "Scope", status: "Approved",
  impact: "High", impactDescription: "2 sprints", scheduleImpactDays: 10, costImpact: 5000,
  requestedBy: "Ann", raisedDate: "2026-06-01", decisionBy: "Bob", decisionDate: "2026-06-09",
  resolutionNotes: "ok", linkedTaskIds: [3, 4], linkedRaidIds: [7], localModifiedAt: "2026-06-09T10:00:00.000Z",
};

describe("changes JSON round-trip", () => {
  it("survives workspaceToJson -> jsonToWorkspace (sanitized)", () => {
    const ws = { ...emptyWorkspace(), changes: [change] };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.changes).toHaveLength(1);
    expect(back.changes?.[0]).toMatchObject({ id: 1, type: "Scope", status: "Approved", impact: "High", linkedTaskIds: [3, 4], linkedRaidIds: [7] });
  });
  it("drops malformed change rows on load", () => {
    const json = JSON.stringify({ ...emptyWorkspace(), changes: [{ title: "no id" }, change] });
    expect(jsonToWorkspace(json).changes).toHaveLength(1);
  });
});

describe("change CSV column encode/decode", () => {
  it("CHANGES_CSV_COLUMNS lists the canonical order", () => {
    expect(CHANGES_CSV_COLUMNS).toEqual([
      "id","title","description","type","status","impact","impactDescription","scheduleImpactDays",
      "costImpact","requestedBy","raisedDate","decisionBy","decisionDate","resolutionNotes",
      "linkedTaskIds","linkedRaidIds","localModifiedAt",
    ]);
  });
  it("changeFieldToString encodes id-lists pipe-joined; buildChangeFromObj round-trips", () => {
    const obj: Record<string, string> = {};
    for (const c of CHANGES_CSV_COLUMNS) obj[c] = changeFieldToString(change, c);
    expect(obj.linkedTaskIds).toBe("3|4");
    expect(obj.linkedRaidIds).toBe("7");
    const back = buildChangeFromObj(obj);
    expect(back).toMatchObject({ id: 1, title: "Widen scope", type: "Scope", status: "Approved", linkedTaskIds: [3, 4], linkedRaidIds: [7] });
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Add to `src/app/storage.ts`** (near the milestones helpers ~line 726):

```ts
export const CHANGES_CSV_COLUMNS: Array<keyof ChangeItem> = [
  "id", "title", "description", "type", "status", "impact", "impactDescription", "scheduleImpactDays",
  "costImpact", "requestedBy", "raisedDate", "decisionBy", "decisionDate", "resolutionNotes",
  "linkedTaskIds", "linkedRaidIds", "localModifiedAt",
];

export function changeFieldToString(c: ChangeItem, col: keyof ChangeItem): string {
  if (col === "linkedTaskIds") return Array.isArray(c.linkedTaskIds) ? c.linkedTaskIds.join("|") : "";
  if (col === "linkedRaidIds") return Array.isArray(c.linkedRaidIds) ? c.linkedRaidIds.join("|") : "";
  const v = c[col];
  return v === undefined || v === null ? "" : String(v);
}

export function buildChangeFromObj(obj: Record<string, string>): ChangeItem | null {
  return sanitizeChangeItem({
    ...obj,
    id: obj.id ? Number(obj.id) : undefined,
    scheduleImpactDays: obj.scheduleImpactDays ? Number(obj.scheduleImpactDays) : undefined,
    costImpact: obj.costImpact ? Number(obj.costImpact) : undefined,
    linkedTaskIds: parseLinkedTaskIds(obj.linkedTaskIds),
    linkedRaidIds: parseLinkedTaskIds(obj.linkedRaidIds),
  });
}
```

  - Add `import { sanitizeChangeItem } from "./sanitize";` if `storage.ts` doesn't already import from `./sanitize` (it does import several sanitizers — merge).
  - In `jsonToWorkspace` (where milestones are sanitized on load), add the parallel line: `changes: Array.isArray(raw.changes) ? raw.changes.map(sanitizeChangeItem).filter((c): c is ChangeItem => c !== null) : []` — match the exact shape the milestones line uses (it may funnel through `migrateWorkspaceV7` afterward; ensure the sanitized `changes` is set before/within the returned workspace). Read the milestones handling and mirror it precisely.

- [ ] **Step 4: Run** → PASS. tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/storage.ts src/app/storage-change-roundtrip.test.ts
git commit -F - <<'EOF'
feat: changes JSON round-trip + CSV column encoder/decoder
EOF
```

---

## Task 8: Changes CSV + Markdown round-trip

**Files:** Modify `src/app/storage.ts`; Test `src/app/storage-change-csvmd.test.ts`.

**Context:** `storage.ts` builds CSV via per-entity blocks (search for `MILESTONES_CSV_COLUMNS.join(",")` ~line 782 — the milestones CSV section) and Markdown via per-entity tables (search for the milestones MD block ~line 1593-1623). The CSV/MD writers and readers handle milestones as a precedent; add a `changes` block to BOTH the writer and the reader, mirroring milestones exactly.

- [ ] **Step 1: Write the failing test** — `src/app/storage-change-csvmd.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { workspaceToCsv, csvToWorkspace, workspaceToMarkdown, markdownToWorkspace, emptyWorkspace } from "./storage";
import type { ChangeItem } from "./types";

const change: ChangeItem = {
  id: 1, title: "Widen scope", description: "add module", type: "Scope", status: "Approved",
  impact: "High", raisedDate: "2026-06-01", linkedTaskIds: [3], linkedRaidIds: [7],
};

describe("changes CSV round-trip", () => {
  it("survives CSV write/read", () => {
    const ws = { ...emptyWorkspace(), changes: [change] };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.changes?.[0]).toMatchObject({ id: 1, type: "Scope", status: "Approved", linkedTaskIds: [3], linkedRaidIds: [7] });
  });
});

describe("changes Markdown round-trip", () => {
  it("survives Markdown write/read", () => {
    const ws = { ...emptyWorkspace(), changes: [change] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.changes?.[0]).toMatchObject({ id: 1, title: "Widen scope", linkedRaidIds: [7] });
  });
});
```

> NOTE: confirm the exact export names of the CSV/MD entry points (`workspaceToCsv`/`csvToWorkspace`/`workspaceToMarkdown`/`markdownToWorkspace` — they may be named differently, e.g. `toCsv`/`fromCsv`). Read `storage.ts` exports and adjust the test imports to the real names BEFORE implementing.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — add a `changes` section to the CSV writer/reader and the Markdown writer/reader, mirroring the milestones blocks:
  - **CSV writer:** mirror the `MILESTONES_CSV_COLUMNS` block using `CHANGES_CSV_COLUMNS` + `changeFieldToString` (a `# changes` section header like milestones uses, if the format has per-entity headers).
  - **CSV reader:** mirror milestones' column-mapped parse, routing rows through `buildChangeFromObj`. Map the `linkedRaidIds` header like `linkedTaskIds`.
  - **Markdown writer:** mirror the milestones MD-table block with `CHANGES_CSV_COLUMNS`/`changeFieldToString`.
  - **Markdown reader:** mirror milestones' header-normalized parse (`linkedraidids`/`linkedraid` → `linkedRaidIds`, `linkedtaskids`/`linkedtasks` → `linkedTaskIds`), routing through `buildChangeFromObj`.
  Follow the EXACT structural pattern of the milestones blocks at the line ranges noted in Context.

- [ ] **Step 4: Run** → PASS. Also run the full storage suite `npx vitest run src/app/storage.test.ts` → green. tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/storage.ts src/app/storage-change-csvmd.test.ts
git commit -F - <<'EOF'
feat: changes CSV + Markdown round-trip
EOF
```

---

## Task 9: Turso relational round-trip (`changes` table)

**Files:** Modify `src/app/turso-schema.ts`; Test `src/app/turso-schema.test.ts` (extend).

**Context:** `turso-schema.ts` has `ENTITY_SPECS` (the milestones entry at ~line 58), `SCHEMA_VERSION = "6"`, and imports the column sets + encoders from `storage.ts`. The migration applied in `rowsToWorkspace` is `migrateWorkspaceV6` — bump to `migrateWorkspaceV7`.

- [ ] **Step 1: Add a failing test** to `src/app/turso-schema.test.ts`

```ts
import { TABLE_NAMES, SCHEMA_DDL } from "./turso-schema";

describe("changes turso table", () => {
  it("registers a 'changes' table", () => {
    expect(TABLE_NAMES).toContain("changes");
  });
  it("emits CREATE TABLE for changes", () => {
    expect(SCHEMA_DDL.some((d) => /CREATE TABLE IF NOT EXISTS changes \(/.test(d))).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/app/turso-schema.test.ts` → FAIL.

- [ ] **Step 3: Edit `src/app/turso-schema.ts`:**
  - Extend the `storage.ts` import with `CHANGES_CSV_COLUMNS, changeFieldToString, buildChangeFromObj`.
  - Add `ChangeItem` to the `./types` import.
  - Add the spec to `ENTITY_SPECS` (after milestones):

```ts
  spec<ChangeItem>({ table: "changes", wsKey: "changes", columns: CHANGES_CSV_COLUMNS, get: (w) => w.changes ?? [], toRow: changeFieldToString as unknown as (e: ChangeItem, col: string) => string, fromObj: buildChangeFromObj }),
```

  - Change `const SCHEMA_VERSION = "6";` → `"7"`.
  - In `rowsToWorkspace`, change `return migrateWorkspaceV6(ws);` → `return migrateWorkspaceV7(ws);` and update the import (`migrateWorkspaceV6` → `migrateWorkspaceV7` from `./storage`).

- [ ] **Step 4: Run** `npx vitest run src/app/turso-schema.test.ts src/app/turso-backend.test.ts` → PASS. tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/turso-schema.ts src/app/turso-schema.test.ts
git commit -F - <<'EOF'
feat: Turso 'changes' table (relational round-trip) + schema v7
EOF
```

---

## Task 10: WorkspaceContext `changes` state

**Files:** Modify `src/app/workspace-context.tsx`; Test `src/app/workspace-context.test.tsx` (extend).

- [ ] **Step 1: Add a failing test** asserting the context exposes `changes` (default `[]`) and `setChanges`. Mirror the existing assertions for `raid`/`milestones` in that test (read it first; copy the pattern). Example assertion:

```ts
it("provides changes state defaulting to []", () => {
  // within the existing test harness that reads useWorkspace()
  expect(result.current.changes).toEqual([]);
  expect(typeof result.current.setChanges).toBe("function");
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Edit `src/app/workspace-context.tsx`:** add `changes: ChangeItem[]; setChanges: Dispatch<SetStateAction<ChangeItem[]>>;` to the context type, `const [changes, setChanges] = useState<ChangeItem[]>([]);`, and include `changes, setChanges` in the provider value. Mirror exactly how `raid`/`setRaid` is declared. Import `ChangeItem` from `./types`.

- [ ] **Step 4: Run** `npx vitest run src/app/workspace-context.test.tsx` → PASS. tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-context.tsx src/app/workspace-context.test.tsx
git commit -F - <<'EOF'
feat: WorkspaceContext changes state
EOF
```

---

## Task 11: `use-change-log.ts` CRUD hook

**Files:** Create `src/app/use-change-log.ts`, `src/app/use-change-log.test.tsx`.

**Context:** Mirrors `use-resource-planner.ts`'s RAID handlers (`handleSaveRaidItem`/`handleDeleteRaidItem` + the `applyStatus` closedDate auto-fill). This hook is standalone (reads `changes`/`setChanges` from `useWorkspace`). `today` is the ISO string from the caller.

- [ ] **Step 1: Write the failing test** — `src/app/use-change-log.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { applyChangeStatus } from "./use-change-log";
import type { ChangeItem } from "./types";

function ci(over: Partial<ChangeItem> = {}): ChangeItem {
  return { id: 1, title: "t", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], ...over };
}

describe("applyChangeStatus", () => {
  it("auto-fills decisionDate when leaving the pending set", () => {
    const next = applyChangeStatus(ci({ status: "Proposed" }), "Approved", "2026-06-09");
    expect(next.status).toBe("Approved");
    expect(next.decisionDate).toBe("2026-06-09");
  });
  it("keeps an existing decisionDate rather than overwriting", () => {
    const next = applyChangeStatus(ci({ status: "Approved", decisionDate: "2026-06-05" }), "Implemented", "2026-06-09");
    expect(next.decisionDate).toBe("2026-06-05");
  });
  it("clears decisionDate when returning to a pending status", () => {
    const next = applyChangeStatus(ci({ status: "Approved", decisionDate: "2026-06-05" }), "Under Review", "2026-06-09");
    expect(next.decisionDate).toBeUndefined();
  });
});
```

(Plus a hook test for save/delete if the harness allows — see Step 3 note. The pure `applyChangeStatus` is the critical unit; if mounting the hook requires a WorkspaceProvider wrapper, mirror the resource-planner test's wrapper. If that's heavy, the `applyChangeStatus` tests above are the required minimum and the save/delete paths are covered via the panel test in Task 13.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Create `src/app/use-change-log.ts`**

```ts
"use client";
import { useCallback, useState } from "react";
import { useWorkspace } from "./workspace-context";
import { isPendingChange } from "./change-log";
import type { ChangeItem, ChangeStatus } from "./types";

/** Status transition: auto-fill decisionDate the first time the item leaves the
 *  pending set; clear it if it returns to pending. Pure + exported for testing. */
export function applyChangeStatus(item: ChangeItem, status: ChangeStatus, today: string): ChangeItem {
  if (isPendingChange(status)) {
    const { decisionDate: _drop, ...rest } = item;
    return { ...rest, status };
  }
  return { ...item, status, decisionDate: item.decisionDate ?? today };
}

export interface UseChangeLogArgs {
  today: string;
  logActivity?: (summary: string) => void;
}

export function useChangeLog(args: UseChangeLogArgs) {
  const { changes, setChanges } = useWorkspace();
  const [draft, setDraft] = useState<ChangeItem | null>(null);
  const [isNew, setIsNew] = useState(false);

  const openNew = useCallback(() => {
    setDraft(null); // panel constructs the new draft; or set a blank draft here
    setIsNew(true);
  }, []);
  const openEdit = useCallback((item: ChangeItem) => { setDraft(item); setIsNew(false); }, []);
  const closeEditor = useCallback(() => { setDraft(null); setIsNew(false); }, []);

  const handleSave = useCallback((item: ChangeItem) => {
    const stamp = new Date().toISOString();
    const withStamp: ChangeItem = { ...item, localModifiedAt: stamp };
    setChanges((prev) => {
      const idx = prev.findIndex((c) => c.id === item.id);
      return idx < 0 ? [...prev, withStamp] : prev.map((c) => (c.id === item.id ? withStamp : c));
    });
    args.logActivity?.(`Change #${item.id} "${item.title}" saved`);
    closeEditor();
  }, [setChanges, args, closeEditor]);

  const handleDelete = useCallback((id: number) => {
    setChanges((prev) => prev.filter((c) => c.id !== id));
    args.logActivity?.(`Change #${id} deleted`);
    closeEditor();
  }, [setChanges, args, closeEditor]);

  return { changes, draft, isNew, openNew, openEdit, closeEditor, handleSave, handleDelete };
}
```

> Adapt to the real `useWorkspace()` shape + the resource-planner `logActivity` signature (read both). If the panel owns its own draft state (as `raid-panel.tsx` does), the hook can expose only `{ changes, handleSave, handleDelete }` and the panel keeps draft/isNew locally — match the RAID division of responsibilities. Keep `applyChangeStatus` exported and pure regardless.

- [ ] **Step 4: Run** → PASS. tsc + lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-change-log.ts src/app/use-change-log.test.tsx
git commit -F - <<'EOF'
feat: useChangeLog CRUD hook + applyChangeStatus decision-date auto-fill
EOF
```

---

## Task 12: `change-edit-modal.tsx`

**Files:** Create `src/app/change-edit-modal.tsx`, `src/app/change-edit-modal.test.tsx`.

**Context:** Mirror the `RaidEditModal` inlined in `raid-panel.tsx` (lines ~694–1290): a `role="dialog" aria-modal="true"` overlay, sticky `ModalHeader` (or its inline equivalent), the compact footer (Delete left, Cancel/Save right), and the two autocomplete pickers (task picker over `tasks`; here a SECOND picker over `raid` items for `linkedRaidIds`, reusing the same chip+dropdown pattern the RAID modal uses for `causedByRaidIds`). Build it as a SEPARATE component file (cleaner than RAID's inline modal). Use `use-draggable.ts` + shared `ModalHeader` (`modal-header.tsx`) like the other edit modals (resource/absence/shift). Palette tokens only.

**Props:**
```ts
export interface ChangeEditModalProps {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  draft: ChangeItem;
  isNew: boolean;
  onChange: (next: ChangeItem) => void;
  onApplyStatus: (status: ChangeStatus) => void; // uses applyChangeStatus upstream
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}
```

- [ ] **Step 1: Write the failing test** — `src/app/change-edit-modal.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ChangeEditModal } from "./change-edit-modal";
import type { ChangeItem } from "./types";

const draft: ChangeItem = { id: 1, title: "Widen scope", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [] };
const base = {
  lang: "en-US" as const, tasks: [], raid: [], draft, isNew: false,
  onChange: vi.fn(), onApplyStatus: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(),
};

describe("ChangeEditModal", () => {
  it("renders the title field, a type select, and a status select", () => {
    const { getByDisplayValue, getByLabelText } = render(<ChangeEditModal {...base} />);
    expect(getByDisplayValue("Widen scope")).toBeTruthy();
    expect(getByLabelText(/type/i)).toBeTruthy();
    expect(getByLabelText(/status/i)).toBeTruthy();
  });
  it("calls onApplyStatus when the status changes", () => {
    const onApplyStatus = vi.fn();
    const { getByLabelText } = render(<ChangeEditModal {...base} onApplyStatus={onApplyStatus} />);
    const sel = getByLabelText(/status/i) as HTMLSelectElement;
    sel.value = "Approved";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onApplyStatus).toHaveBeenCalledWith("Approved");
  });
  it("calls onSave / onCancel from the footer buttons", () => {
    const onSave = vi.fn(), onCancel = vi.fn();
    const { getByRole } = render(<ChangeEditModal {...base} onSave={onSave} onCancel={onCancel} />);
    getByRole("button", { name: /save/i }).click();
    getByRole("button", { name: /cancel/i }).click();
    expect(onSave).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `change-edit-modal.tsx` mirroring `RaidEditModal`'s structure with the `ChangeItem` fields: title (input), description (textarea), type/status/impact (selects driven by `CHANGE_TYPES`/`CHANGE_STATUSES`/impact set, each with an `aria-label` and an associated `<label>`), impactDescription (textarea), scheduleImpactDays + costImpact (number inputs), requestedBy/decisionBy (inputs), raisedDate (date input), decisionDate (read-only display when set), resolutionNotes (textarea), a **task picker** (`linkedTaskIds`, copy RAID's task-picker chip+dropdown), and a **RAID picker** (`linkedRaidIds`, copy RAID's cause-picker chip+dropdown but listing `raid` items by id+title). Footer: Delete (left, `disabled={isNew}`, confirm-before-delete), Cancel + Save (right). The status `<select>` calls `onApplyStatus(e.target.value)`; all other fields call `onChange({ ...draft, field })`. Validate title non-empty before enabling Save (mirror RAID's error alert).

- [ ] **Step 4: Run** → PASS. tsc + lint clean. Palette-only (grep for hex/shadow/gradient → none).

- [ ] **Step 5: Commit**

```bash
git add src/app/change-edit-modal.tsx src/app/change-edit-modal.test.tsx
git commit -F - <<'EOF'
feat: ChangeEditModal (fields + task/RAID link pickers)
EOF
```

---

## Task 13: `change-panel.tsx`

**Files:** Create `src/app/change-panel.tsx`, `src/app/change-panel.test.tsx`.

**Context:** Mirror `raid-panel.tsx` (memo-wrapped): `VIEW_PANE_*` chrome, a toolbar with the add button BEFORE the search input, native filter `<select>`s (by type, by status) pinned to `h-[30px]`, a `<table>` using `TABLE_HEAD_CLASS` + `useColumnResize` + a local `sort` state driven by `compareChange`/`ChangeSortKey`. Columns: id · type · title · impact (RAG dot via `changeImpactRag` + `RagBadge` or the RAID dot pattern) · status · requestedBy · raised. Row click opens the `ChangeEditModal` (panel owns `draft`/`isNew` like RAID does, OR consumes the `useChangeLog` openEdit/openNew — match RAID: the panel owns draft state and calls `onSave`/`onDelete` props). Conditional mount.

**Props (mirror RaidPanelProps, change-flavored):**
```ts
export type ChangePanelProps = {
  lang: Lang;
  tasks: Task[];
  raid: RaidItem[];
  changes: ChangeItem[];
  today: string;
  onSave: (item: ChangeItem) => void;
  onDelete: (id: number) => void;
};
```

- [ ] **Step 1: Write the failing test** — `src/app/change-panel.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { ChangePanel } from "./change-panel";
import type { ChangeItem } from "./types";

function ci(over: Partial<ChangeItem>): ChangeItem {
  return { id: 1, title: "t", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], ...over };
}
const base = {
  lang: "en-US" as const, tasks: [], raid: [],
  changes: [ci({ id: 1, title: "Alpha scope", type: "Scope", status: "Proposed" }), ci({ id: 2, title: "Beta cost", type: "Cost", status: "Approved" })],
  today: "2026-06-10", onSave: vi.fn(), onDelete: vi.fn(),
};

describe("ChangePanel", () => {
  it("renders a row per change", () => {
    const { getByText } = render(<ChangePanel {...base} />);
    expect(getByText("Alpha scope")).toBeTruthy();
    expect(getByText("Beta cost")).toBeTruthy();
  });
  it("has an add button", () => {
    const { getByRole } = render(<ChangePanel {...base} />);
    expect(getByRole("button", { name: /add/i })).toBeTruthy();
  });
  it("opens the editor when a row is clicked", () => {
    const { getByText, getByDisplayValue } = render(<ChangePanel {...base} />);
    getByText("Alpha scope").click();
    expect(getByDisplayValue("Alpha scope")).toBeTruthy(); // modal opened with the row's title
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `change-panel.tsx` mirroring `raid-panel.tsx`'s table + toolbar + memo wrapper, using `ChangeEditModal` for editing, `compareChange` for sorting, `changeImpactRag` for the impact dot, and `nextChangeId(changes)` when constructing a new draft (default `status: defaultChangeStatus()`, `type: "Other"`, `raisedDate: today`, empty link arrays). Filter selects narrow by type + status; search narrows by title/description/requestedBy.

- [ ] **Step 4: Run** → PASS. tsc + lint clean. Palette-only.

- [ ] **Step 5: Commit**

```bash
git add src/app/change-panel.tsx src/app/change-panel.test.tsx
git commit -F - <<'EOF'
feat: ChangePanel (sortable/filterable register table + editor)
EOF
```

---

## Task 14: `change-report-panel.tsx`

**Files:** Create `src/app/change-report-panel.tsx`, `src/app/change-report-panel.test.tsx`.

**Context:** Mirror `raid-report-panel.tsx`: a `ReportCard` (from `report-table.tsx`) with summary `Tile`s (Total · Pending · Approved · Implemented · Rejected) and By-X tables (By Type, By Status, By Impact, By Requestor, Top Pending) built with `useSortableFilter` + `SortHeaderButton` + `TableFilter`. Reachable as a sub-view + popout.

**Props:** `{ lang: Lang; items: readonly ChangeItem[]; today: string; embedded?: boolean }`.

- [ ] **Step 1: Write the failing test** — `src/app/change-report-panel.test.tsx`

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ChangeReportPanel } from "./change-report-panel";
import type { ChangeItem } from "./types";

function ci(over: Partial<ChangeItem>): ChangeItem {
  return { id: 1, title: "t", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], ...over };
}
const items = [ci({ id: 1, status: "Proposed", type: "Scope" }), ci({ id: 2, status: "Approved", type: "Cost" }), ci({ id: 3, status: "Implemented", type: "Scope" })];

describe("ChangeReportPanel", () => {
  it("renders summary tiles incl. a Total and a Pending count", () => {
    const { getByText, getAllByText } = render(<ChangeReportPanel lang="en-US" items={items} today="2026-06-10" />);
    expect(getByText(/total/i)).toBeTruthy();
    expect(getAllByText(/pending/i).length).toBeGreaterThan(0);
  });
  it("renders a By Type breakdown", () => {
    const { getByText } = render(<ChangeReportPanel lang="en-US" items={items} today="2026-06-10" />);
    expect(getByText(/by type/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** mirroring `raid-report-panel.tsx`'s ReportCard + tiles + By-X tables, using `countByType`/`countByStatus`/`selectTopChanges`/`changeImpactRag` and the shared report kit.

- [ ] **Step 4: Run** → PASS. tsc + lint clean. Palette-only.

- [ ] **Step 5: Commit**

```bash
git add src/app/change-report-panel.tsx src/app/change-report-panel.test.tsx
git commit -F - <<'EOF'
feat: ChangeReportPanel (printable change report)
EOF
```

---

## Task 15: Dashboard Scope signal + changes summary

**Files:** Modify `src/app/dashboard.ts`; Test `src/app/dashboard.test.ts` (extend).

**Context:** `dashboard.ts` currently has `scope: { effective: status.scopeOverride ?? null }` (no computed). `DashboardInput` lacks `changes`. The overall RAG already worst-of's the sub-statuses.

- [ ] **Step 1: Add failing tests** to `src/app/dashboard.test.ts` (mirror an existing `computeDashboard` test's input builder; add `changes: [...]` to it):

```ts
describe("dashboard scope signal from changes", () => {
  function changeItem(over) { return { id: 1, title: "c", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], ...over }; }
  it("Amber scope when 1..4 pending changes", () => {
    const model = computeDashboard({ ...baseInput, changes: [changeItem({})] });
    expect(model.scope.computed).toBe("A");
    expect(model.scope.effective).toBe("A");
  });
  it("Red scope at >=5 pending", () => {
    const changes = Array.from({ length: 5 }, (_, i) => changeItem({ id: i + 1 }));
    expect(computeDashboard({ ...baseInput, changes }).scope.computed).toBe("R");
  });
  it("manual scopeOverride wins", () => {
    const model = computeDashboard({ ...baseInput, changes: [changeItem({})], status: { scopeOverride: "G" } });
    expect(model.scope.effective).toBe("G");
    expect(model.scope.overridden).toBe(true);
  });
  it("changes summary counts pending/approved/implemented", () => {
    const changes = [changeItem({ id: 1, status: "Proposed" }), changeItem({ id: 2, status: "Approved" }), changeItem({ id: 3, status: "Implemented" })];
    const m = computeDashboard({ ...baseInput, changes });
    expect(m.changes).toMatchObject({ pending: 1, approved: 1, implemented: 1, total: 3 });
  });
});
```

> Adapt `baseInput` to the existing test's input object (it must now include `changes: []` by default — update the shared builder so other tests still pass).

- [ ] **Step 2: Run** → FAIL (tsc error: `changes` missing from `DashboardInput`, and `scope.computed` undefined).

- [ ] **Step 3: Edit `src/app/dashboard.ts`:**
  - Import: `import { computeScopeStatus, countByStatus, isPendingChange, selectTopChanges, SCOPE_PENDING_RED } from "./change-log";` and `import type { ChangeItem } from "./types";`.
  - Add `changes: readonly ChangeItem[];` to `DashboardInput`.
  - Add a constant near `EVM_INDEX_*`: (re-export the threshold or use the imported `SCOPE_PENDING_RED`).
  - Add to `DashboardModel`: `scope: { computed: SubStatus; effective: SubStatus; overridden: boolean };` (replace the old `scope: { effective }`), and `changes: { pending: number; approved: number; implemented: number; total: number };` plus `topChanges: ChangeItem[];`.
  - In `computeDashboard`, compute:
```ts
  const scopeComputed = computeScopeStatus(input.changes, SCOPE_PENDING_RED);
  const changeCounts = countByStatus(input.changes);
  const changesSummary = {
    pending: input.changes.filter((c) => isPendingChange(c.status)).length,
    approved: changeCounts.Approved,
    implemented: changeCounts.Implemented,
    total: input.changes.length,
  };
```
  and in the returned model:
```ts
    scope: { computed: scopeComputed, effective: status.scopeOverride ?? scopeComputed, overridden: !!status.scopeOverride },
    changes: changesSummary,
    topChanges: selectTopChanges(input.changes, opts.topRaid ?? DASHBOARD_DEFAULTS.topRaid),
```
  - (The `overall` worst-of already includes `scope`? Check: `computeGroupHealth` drives overallComputed from tasks; scope is a separate sub-status. If overall should fold scope, confirm the existing behavior — if overall currently does NOT fold scope, leave that unchanged to avoid scope-creep; the spec only requires the Scope sub-RAG to be computed. Do NOT change the overall formula unless a test requires it.)

- [ ] **Step 4: Run** `npx vitest run src/app/dashboard.test.ts` → PASS (all, incl. pre-existing). tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts
git commit -F - <<'EOF'
feat: dashboard computed Scope RAG from pending changes + changes summary
EOF
```

---

## Task 16: Dashboard panel Changes subsection

**Files:** Modify `src/app/dashboard-panel.tsx`; Test `src/app/dashboard-panel.test.tsx` (extend).

**Context:** `dashboard-panel.tsx` renders subsections (RAID top items, milestones). The model now exposes `model.changes` + `model.topChanges`. `DashboardPanel` already receives the workspace + an `onOpen*` style callback for navigation (check how RAID/milestone rows navigate — e.g. `onOpenRaid`/`onJumpTo`). Add a `Changes` subsection: a pending count line + a short top-pending list (each row clickable to open the change, mirroring the RAID-row click). If the panel needs a new `onOpenChange` callback, thread it from `task-manager` (Task 17).

- [ ] **Step 1: Add a failing test** asserting the dashboard panel renders the Changes section heading + the pending count when given a model/workspace with pending changes. Mirror the existing milestone/RAID subsection test in `dashboard-panel.test.tsx`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** the Changes subsection (heading via `t(lang, "dashboardChangesHeading")`, the pending count via `model.changes.pending`, and the top-pending list from `model.topChanges`, each row showing id · title · impact dot · status). Use the shared section styling the other subsections use. Palette-only.

- [ ] **Step 4: Run** → PASS. tsc + lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -F - <<'EOF'
feat: dashboard Changes subsection (pending count + top pending)
EOF
```

---

## Task 17: Nav + workspace wiring

**Files:** Modify `nav-config.ts`, `nav-config.test.ts`, `nav-icons.tsx`, `workspace-tab-context.tsx`, `workspace-section.tsx`, `task-manager.tsx`.

- [ ] **Step 1: Add failing nav test** to `src/app/nav-config.test.ts`

```ts
describe("changes nav", () => {
  it("includes changes + change-report (changes in Registers group)", () => {
    expect(allNavViews()).toContain("changes");
    expect(allNavViews()).toContain("change-report");
  });
  it("maps the label keys", () => {
    expect(navLabelKey("changes")).toBe("navChanges");
    expect(navLabelKey("change-report")).toBe("changeReportTitle");
  });
  it("change-report is a child of changes", () => {
    expect(subTabsFor("changes").map((c) => c.view)).toContain("change-report");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Edits:**
  - `nav-config.ts`: add `| "changes" | "change-report"` to `AppView`; add `{ view: "changes", children: [{ view: "change-report" }] }` to the Registers group items (after the `raid` item); add `changes: "navChanges"` and `"change-report": "changeReportTitle"` to `LABEL_KEYS`.
  - `nav-icons.tsx`: add `ICON_PATHS.changes` (a doc-with-swap glyph, e.g. `"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13l-2 2 2 2M16 17l2-2-2-2"`) and `"change-report"` (reuse the report glyph string used by `raid-report`/`reports`).
  - `workspace-tab-context.tsx`: add `"changes"` + `"change-report"` to `TopTab`.
  - `workspace-section.tsx`: dynamic-import `ChangePanel` + `ChangeReportPanel` (`ssr:false`); mount `ChangePanel` when `activeTab === "changes"` (props: `lang, tasks, raid, changes, today, onSave={handleSaveChange}, onDelete={handleDeleteChange}`) and `ChangeReportPanel` when `activeTab === "change-report"` (`lang, items={changes}, today`). Add `changes` + the two change handlers to the WorkspaceSection props type. Mirror the RAID + RAID-report mount blocks.
  - `task-manager.tsx`: instantiate `useChangeLog({ today: todayISO(), logActivity })`; create `handleSaveChange`/`handleDeleteChange` (guarded via the existing `guardEdit` wrapper like RAID handlers); pass `changes` into `computeDashboard` (add `changes` to the dashboard input); pass `changes` + handlers into `workspaceProps`. Read how RAID handlers/`guardEdit`/`computeDashboard` input are wired and mirror exactly.

- [ ] **Step 4: Run** `npx vitest run src/app/nav-config.test.ts src/app/workspace-section.test.tsx`, then `npx tsc --noEmit` (adding to AppView forces `ICON_PATHS`/`LABEL_KEYS`/`TopTab` coverage — fix any surfaced), then `npm run lint`. All green.

- [ ] **Step 5: Commit**

```bash
git add src/app/nav-config.ts src/app/nav-config.test.ts src/app/nav-icons.tsx src/app/workspace-tab-context.tsx src/app/workspace-section.tsx src/app/task-manager.tsx
git commit -F - <<'EOF'
feat: wire Change Log + Change Report into nav, mounts, and task-manager
EOF
```

---

## Task 18: Task-row "N changes" badge

**Files:** Modify `src/app/task-manager.tsx`, `src/app/tasks-section.tsx`, `src/app/task-row.tsx`; Test `src/app/task-row.test.tsx` (extend).

**Context:** RAID does this via `buildRaidByTaskIndex` → `raidByTask` (memo in task-manager) → passed to `TasksSection` → per-row `raidRefs` prop → `task-row.tsx` renders a badge. Mirror it with `buildChangeByTaskIndex` → `changeByTask` → per-row `changeRefs: ChangeItem[] | undefined`.

- [ ] **Step 1: Add a failing test** to `src/app/task-row.test.tsx`: when `changeRefs` has items, a "N changes" badge renders; when empty/undefined, it does not. Mirror the existing RAID-badge test in that file.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement:**
  - `task-manager.tsx`: `const changeByTask = useMemo(() => buildChangeByTaskIndex(changes), [changes]);` and pass it to `TasksSection` (mirror `raidByTask`).
  - `tasks-section.tsx`: accept `changeByTask: Map<number, ChangeItem[]>`; per row, pass `changeRefs={changeByTask.get(task.id)}`.
  - `task-row.tsx`: add `changeRefs?: ChangeItem[]` to props; render a read-only badge `{changeRefs?.length ? <span...>{t(lang,"taskRowChangesBadge", changeRefs.length)}</span> : null}` next to the RAID badge. Display-only (no click). Palette tokens (`AIPM-purple`/muted as the RAID badge uses).

- [ ] **Step 4: Run** `npx vitest run src/app/task-row.test.tsx` → PASS. tsc + lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager.tsx src/app/tasks-section.tsx src/app/task-row.tsx src/app/task-row.test.tsx
git commit -F - <<'EOF'
feat: task-row "N changes" badge (change-by-task index)
EOF
```

---

## Task 19: i18n keys (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1:** Add these keys to `src/app/i18n.ts` (EN). (Status/type labels are the same words as the enum values, but go through i18n for DE.)

```
navChanges: "Changes",
changeReportTitle: "Change Report",
changesAdd: "Add change",
changeStatusProposed: "Proposed",
changeStatusUnderReview: "Under Review",
changeStatusApproved: "Approved",
changeStatusRejected: "Rejected",
changeStatusImplemented: "Implemented",
changeStatusDeferred: "Deferred",
changeTypeScope: "Scope",
changeTypeSchedule: "Schedule",
changeTypeCost: "Cost",
changeTypeQuality: "Quality",
changeTypeOther: "Other",
changeFieldTitle: "Title",
changeFieldDescription: "Description",
changeFieldType: "Type",
changeFieldStatus: "Status",
changeFieldImpact: "Impact",
changeFieldImpactDescription: "Impact description",
changeFieldScheduleImpact: "Schedule impact (days)",
changeFieldCostImpact: "Cost impact",
changeFieldRequestedBy: "Requested by",
changeFieldRaisedDate: "Raised",
changeFieldDecisionBy: "Decided by",
changeFieldDecisionDate: "Decision date",
changeFieldResolution: "Resolution / rationale",
changeFieldLinkedTasks: "Linked tasks",
changeFieldLinkedRaid: "Linked RAID items",
changeFilterSearch: "Search changes...",
changeReportTotal: "Total",
changeReportPending: "Pending",
changeReportApproved: "Approved",
changeReportImplemented: "Implemented",
changeReportRejected: "Rejected",
changeReportByType: "By Type",
changeReportByStatus: "By Status",
changeReportByImpact: "By Impact",
changeReportByRequestor: "By Requestor",
changeReportTopPending: "Top Pending",
dashboardChangesHeading: "Changes",
dashboardChangesPending: "{0} pending",
taskRowChangesBadge: "{0} changes",
versionHighlightChangeLog: "Change-control log - a RAID-sibling register for tracking change requests",
```

- [ ] **Step 2:** Add the SAME keys to `src/app/i18n.de.ts` with German values, STRAIGHT ASCII quotes + ASCII transliteration (examples — translate all):

```
navChanges: "Aenderungen",
changeReportTitle: "Aenderungsbericht",
changesAdd: "Aenderung hinzufuegen",
changeStatusProposed: "Vorgeschlagen",
changeStatusUnderReview: "In Pruefung",
changeStatusApproved: "Genehmigt",
changeStatusRejected: "Abgelehnt",
changeStatusImplemented: "Umgesetzt",
changeStatusDeferred: "Zurueckgestellt",
changeTypeScope: "Umfang",
changeTypeSchedule: "Zeitplan",
changeTypeCost: "Kosten",
changeTypeQuality: "Qualitaet",
changeTypeOther: "Sonstiges",
... (translate the remaining field/report/dashboard keys; e.g. changeFieldTitle: "Titel", changeReportPending: "Ausstehend", dashboardChangesHeading: "Aenderungen", dashboardChangesPending: "{0} ausstehend", taskRowChangesBadge: "{0} Aenderungen", versionHighlightChangeLog: "Aenderungs-Log - ein RAID-Schwesterregister fuer Aenderungsantraege")
```

  (Provide a complete German value for EVERY key added in Step 1 — tsc enforces parity.)

- [ ] **Step 3:** Grep `src/app/i18n.de.ts` new lines for curly quotes `[“”‘’]` → none. `npx tsc --noEmit` → clean (parity). `npm run lint` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: i18n keys for the Change Log + Change Report (EN/DE)
EOF
```

---

## Task 20: Version bump 0.50.0 "Sanderson" + docs

**Files:** Modify `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/frontend.md`, `docs/CODEMAPS/data.md`.

- [ ] **Step 1: `src/app/version.ts`** — prepend the release-notes comment block above the latest entry:

```ts
// 0.50.0 "Sanderson" adds a change-control Log: a RAID-sibling register of change
// requests. Each ChangeItem carries a type (Scope/Schedule/Cost/Quality/Other), a
// 6-state workflow (Proposed/Under Review/Approved/Rejected/Implemented/Deferred),
// an impact rating (reusing the RAID severity scale) with optional schedule-day and
// cost figures, requestor/approver + auto-filled decision date, and links to both
// tasks and RAID items. A sortable/filterable panel + draggable edit modal, a
// printable Change Report, and a Changes nav entry (Registers group) join the
// register; the new Workspace.changes entity round-trips through every backend
// (schema v7 additive migration). The dashboard gains its first computed Scope
// signal (Amber with any pending change, Red at a backlog threshold; manual
// override still wins) plus a Changes subsection. New modules: change-log.ts,
// change-panel.tsx, change-edit-modal.tsx, change-report-panel.tsx, use-change-log.ts.
```
  Set `APP_VERSION = "0.50.0"`, `APP_BUILD_DATE = "2026-06-03"; // 0.50.0 change-control log`, `APP_MILESTONE = "Sanderson"`. Append `"versionHighlightChangeLog"` as the last `APP_HIGHLIGHT_KEYS` entry.

- [ ] **Step 2: `package.json`** — `"version": "0.50.0"`.

- [ ] **Step 3: `CHANGELOG.md`** — prepend a `0.50.0 "Sanderson" — 2026-06-03` entry (match the file's heading style) summarizing the change-control log.

- [ ] **Step 4: `README.md`** — bump the version line to `0.50.0 "Sanderson"`; add a feature-table row "Change Log (change-control register)".

- [ ] **Step 5: `docs/CODEMAPS/frontend.md` + `data.md`** — update the version stamp; add Key-components rows for `change-log.ts`, `change-panel.tsx`, `change-edit-modal.tsx`, `change-report-panel.tsx`, `use-change-log.ts`; note the new `changes` AppView/entity and schema v7 in `data.md`.

- [ ] **Step 6: Full verification:** `npm run test:run` (report totals — all pass), `npx tsc --noEmit` clean, `npm run lint` clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts package.json CHANGELOG.md README.md docs/CODEMAPS/frontend.md docs/CODEMAPS/data.md
git commit -F - <<'EOF'
chore: release 0.50.0 "Sanderson" — change-control log register
EOF
```

---

## Self-review (plan vs spec)

**Spec coverage:** data model → T1; pure logic → T2-4; storage entity + v7 migration + all backends → T6-9; sanitize → T5; panel → T13; edit modal + task/RAID pickers → T12; CRUD hook + decisionDate auto-fill → T11; report → T14; dashboard Scope signal + summary → T15-16; nav + wiring → T17; task-row badge → T18; i18n → T19; version → T20. All spec sections map to a task.

**Placeholder scan:** Core/logic/storage/sanitize/dashboard/hook tasks carry full code + full tests. The three large UI tasks (12-14) and the wiring tasks (16-18) reference exact existing files to mirror with named props/fields + full test code — adaptation against real symbols the implementer must read, not vague work. No "TBD"/"handle errors"/"similar to" placeholders.

**Type consistency:** `ChangeItem`/`ChangeType`/`ChangeStatus`/`ChangeImpact` (T1) used consistently; `CHANGES_CSV_COLUMNS` identical in T7/T9; `compareChange`/`ChangeSortKey` (T3) used in T13; `computeScopeStatus`/`SCOPE_PENDING_RED`/`selectTopChanges` (T4) used in T15; `sanitizeChangeItem` (T5) used by `buildChangeFromObj` (T7); `applyChangeStatus` (T11) used by the modal's status handler (T12/T17); `buildChangeByTaskIndex` (T2) used in T18; `migrateWorkspaceV7` (T6) used in T9. i18n keys referenced by UI tasks are all defined in T19 (which precedes none of them at runtime — but note the ORDERING caveat below).

**Execution ordering caveat:** the UI tasks (12-14, 16-18) reference i18n keys defined in Task 19. Because `TranslationKey` is a strict union, those tasks will not typecheck until the keys exist. **The executor must run Task 19 (i18n) BEFORE Tasks 12-14 and 16-18** (it has no code deps of its own). Recommended order: 1-11, then 19, then 12-18, then 20. (Same pattern as the trends feature.)
