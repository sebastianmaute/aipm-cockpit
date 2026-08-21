# Milestones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add milestones — zero-duration key dates with linked tasks — as a first-class entity, shown as Gantt diamonds (with linked-task edges + at-risk rings), managed in a dedicated Milestones view, and surfaced on the health dashboard (with Schedule-RAG influence).

**Architecture:** New persisted `Workspace.milestones[]` (budgets/RAID precedent, `linkedTaskIds` pipe-encoded like RAID). Pure logic in `milestones.ts` (status/partition/at-risk/schedule-contribution). UI: `milestones-panel.tsx` (list) + `milestone-edit-modal.tsx` (editor with task-picker), Gantt diamond rows + edges, and a dashboard Milestones subsection.

**Tech Stack:** Next.js 16, React, TypeScript, Vitest 4 (`npm test` watch / `npm run test:run` single / `npm run test:coverage`).

**Design source:** `docs/superpowers/specs/2026-06-02-milestones-design.md`.

**Conventions (repo memory):** commit via Bash here-doc `git commit -F - <<'EOF'` (NO `Co-Authored-By`); `i18n.de.ts` straight ASCII `"` only (grep `[“”]` after edits); never edit `eslint.config.mjs`; PowerShell `Remove-Item` not `rm -rf`.

---

## Pre-flight (once)

Feature #1 (the dashboard) is in open MR !25, not yet merged. This feature builds on it, so **stack on `feat-health-dashboard`**:

- [ ] Branch off the dashboard branch:
```bash
git checkout feat-health-dashboard && git pull --ff-only origin feat-health-dashboard 2>/dev/null; git checkout -b feat-milestones
```
(If MR !25 has merged to `main` by now, instead: `git checkout main && git pull --ff-only origin main && git checkout -b feat-milestones`.)

- [ ] Baseline green:
```bash
npm run test:run
```
Expected: all pass (≈1619+).

---

## Task 1: `Milestone` type + `Workspace.milestones` + sanitizer + defaults

**Files:** Modify `src/app/types.ts`, `src/app/sanitize.ts`, `src/app/storage.ts`; Test `src/app/storage-serialization.test.ts`.

- [ ] **Step 1: Failing test.** Append to `src/app/storage-serialization.test.ts`:
```typescript
describe("Milestone defaults + sanitize", () => {
  test("emptyWorkspace seeds an empty milestones array", () => {
    expect(emptyWorkspace().milestones).toEqual([]);
  });
  test("migrateWorkspaceV6 backfills a missing milestones to []", () => {
    const ws = { ...emptyWorkspace() };
    delete (ws as { milestones?: unknown }).milestones;
    expect(migrateWorkspaceV6(ws as typeof ws).milestones).toEqual([]);
  });
  test("sanitizeMilestone rejects junk and keeps valid fields", () => {
    expect(sanitizeMilestone(null)).toBeNull();
    expect(sanitizeMilestone({ id: 0, name: "x", date: "2026-01-01" })).toBeNull(); // id<=0
    expect(sanitizeMilestone({ id: 1, name: "", date: "2026-01-01" })).toBeNull();  // empty name
    expect(sanitizeMilestone({ id: 1, name: "Go-live", date: "" })).toBeNull();     // empty date
    expect(
      sanitizeMilestone({ id: 2, name: "Go-live", date: "2026-08-01", description: "d", achievedDate: "2026-07-30", linkedTaskIds: [3, "4", -1, "x"], localModifiedAt: "2026-06-02T00:00:00.000Z" }),
    ).toEqual({ id: 2, name: "Go-live", date: "2026-08-01", description: "d", achievedDate: "2026-07-30", linkedTaskIds: [3, 4], localModifiedAt: "2026-06-02T00:00:00.000Z" });
  });
});
```
Add `sanitizeMilestone` to the `./storage` (or `./sanitize`) import in the test file — see Step 4 for where it's exported from.

- [ ] **Step 2: Run — expect FAIL.** `npm run test:run -- storage-serialization`

- [ ] **Step 3: Add the `Milestone` type.** In `src/app/types.ts`, after `RaidItem` (near line 177):
```typescript
/** A zero-duration key date, distinct from a task. `achievedDate` is a manual
 *  sign-off (absent = pending). `linkedTaskIds` are the tasks that gate it —
 *  they drive the Gantt edges and the "at risk" signal. */
export type Milestone = {
  id: number;
  name: string;
  date: string;            // YYYY-MM-DD target
  description?: string;
  achievedDate?: string;   // YYYY-MM-DD manual sign-off
  linkedTaskIds: number[];
  localModifiedAt?: string;
};
```

- [ ] **Step 4: Add `sanitizeMilestone`.** In `src/app/sanitize.ts`, add (export it; reuse the file's `toNumber`/`sanitizeText` helpers — check their exact names and use them, else inline as below):
```typescript
import type { Milestone } from "./types";

/** Accept only well-formed milestones from untrusted JSON. id>0, name+date
 *  required; linkedTaskIds reduced to positive finite ints. */
export function sanitizeMilestone(input: unknown): Milestone | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const id = typeof o.id === "number" ? o.id : Number(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) return null;
  const date = typeof o.date === "string" ? o.date.trim() : "";
  if (!date) return null;
  const linkedTaskIds = Array.isArray(o.linkedTaskIds)
    ? o.linkedTaskIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const m: Milestone = { id: Math.floor(id), name, date, linkedTaskIds };
  const description = str(o.description); if (description) m.description = description;
  const achievedDate = str(o.achievedDate); if (achievedDate) m.achievedDate = achievedDate;
  const localModifiedAt = str(o.localModifiedAt); if (localModifiedAt) m.localModifiedAt = localModifiedAt;
  return m;
}
```
(If `sanitize.ts` cannot import `Milestone` without a cycle, define it in `storage.ts` instead and export from there; the test imports it from wherever it lives.)

- [ ] **Step 5: Wire into `storage.ts`.** Add `Milestone` to the `./types` import and `sanitizeMilestone` to the `./sanitize` import. Then:

`Workspace` type — after `status?`:
```typescript
  /** Project milestones (key dates). Optional for back-compat; load paths default to []. */
  milestones?: Milestone[];
```
`emptyWorkspace()` return — after `status: {},`:
```typescript
    milestones: [],
```
`migrateWorkspaceV6` — extend to default milestones. Replace its body with:
```typescript
export function migrateWorkspaceV6(ws: Workspace): Workspace {
  const base = migrateWorkspaceV5(ws);
  const budgets = Array.isArray(base.budgets) ? base.budgets : [];
  const fxRates = base.fxRates ?? null;
  const status = base.status && typeof base.status === "object" ? base.status : {};
  const milestones = Array.isArray(base.milestones) ? base.milestones : [];
  if (budgets === base.budgets && fxRates === base.fxRates && status === base.status && milestones === base.milestones) {
    return base;
  }
  return { ...base, budgets, fxRates, status, milestones };
}
```

- [ ] **Step 6: Run — expect PASS.** `npm run test:run -- storage-serialization` then `npx tsc --noEmit; echo "tsc exit: $?"` (expect 0).

- [ ] **Step 7: Commit.**
```bash
git add src/app/types.ts src/app/sanitize.ts src/app/storage.ts src/app/storage-serialization.test.ts
git commit -F - <<'EOF'
feat: add Milestone entity + sanitizer + workspace default

New Workspace.milestones[]; emptyWorkspace seeds []; migrateWorkspaceV6
backfills; sanitizeMilestone whitelists fields and reduces linkedTaskIds.
EOF
```

---

## Task 2: JSON round-trip

**Files:** Modify `src/app/storage.ts`; Test `src/app/storage-serialization.test.ts`.

- [ ] **Step 1: Failing test.**
```typescript
test("JSON round-trip preserves milestones", () => {
  const ws = {
    ...emptyWorkspace(),
    milestones: [{ id: 1, name: "Go-live", date: "2026-08-01", description: "launch", linkedTaskIds: [2, 3] }],
  };
  const back = jsonToWorkspace(workspaceToJson(ws));
  expect(back.milestones).toEqual(ws.milestones);
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm run test:run -- storage-serialization`

- [ ] **Step 3: Implement.** In `workspaceToJson`, add to the serialized object (after `status: ws.status ?? {},`):
```typescript
      milestones: ws.milestones ?? [],
```
In `jsonToWorkspace`, add to the `raw` object (after the `status:` line):
```typescript
      milestones: ((p.milestones as unknown[]) ?? []).map((m) => sanitizeMilestone(m)).filter((m): m is Milestone => m !== null),
```

- [ ] **Step 4: Run — expect PASS.** `npm run test:run -- storage-serialization`

- [ ] **Step 5: Commit.**
```bash
git add src/app/storage.ts src/app/storage-serialization.test.ts
git commit -F - <<'EOF'
feat: round-trip milestones through the JSON envelope
EOF
```

---

## Task 3: CSV round-trip

**Files:** Modify `src/app/storage.ts`; Test `src/app/storage-serialization.test.ts`.

Milestones encode like RAID: `linkedTaskIds` pipe-joined. Reuse the existing private `parseLinkedTaskIds` helper (already in storage.ts) and the multi-section CSV machinery.

- [ ] **Step 1: Failing test.**
```typescript
test("CSV round-trip preserves milestones (incl. linked ids + comma in description)", () => {
  const ws = {
    ...emptyWorkspace(),
    milestones: [{ id: 5, name: "Phase 1, sign-off", date: "2026-08-12", description: "gate, review", achievedDate: "2026-08-13", linkedTaskIds: [7, 9], localModifiedAt: "2026-06-02T00:00:00.000Z" }],
  };
  const back = csvToWorkspace(workspaceToCsv(ws));
  expect(back.milestones).toEqual(ws.milestones);
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm run test:run -- storage-serialization`

- [ ] **Step 3: Implement.**
(a) Columns + section marker, next to `RAID_CSV_COLUMNS` / the other `CSV_SECTION_*` consts:
```typescript
export const MILESTONES_CSV_COLUMNS: Array<keyof Milestone> = [
  "id", "name", "date", "description", "achievedDate", "linkedTaskIds", "localModifiedAt",
];
const CSV_SECTION_MILESTONES = "# MILESTONES";
```
(b) Encoder + decoder + section helpers (model on `raidFieldToString`/`buildRaidItemFromObj`; both EXPORTED for Turso reuse). Place near the RAID equivalents:
```typescript
export function milestoneFieldToString(m: Milestone, c: keyof Milestone): string {
  if (c === "linkedTaskIds") return Array.isArray(m.linkedTaskIds) ? m.linkedTaskIds.join("|") : "";
  return String(m[c] ?? "");
}

export function buildMilestoneFromObj(obj: Record<string, string>): Milestone | null {
  const id = Number(obj.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = obj.name?.trim() ?? "";
  if (!name) return null;
  const date = obj.date?.trim() ?? "";
  if (!date) return null;
  const m: Milestone = { id, name, date, linkedTaskIds: parseLinkedTaskIds(obj.linkedTaskIds) };
  if (obj.description) m.description = obj.description;
  if (obj.achievedDate) m.achievedDate = obj.achievedDate;
  if (obj.localModifiedAt) m.localModifiedAt = obj.localModifiedAt;
  return m;
}

function milestonesToCsv(milestones: readonly Milestone[]): string {
  return entityToCsv(milestones, MILESTONES_CSV_COLUMNS, milestoneFieldToString);
}
function csvToMilestones(text: string): Milestone[] {
  return csvToEntities(text, buildMilestoneFromObj);
}
```
IMPORTANT: `entityToCsv` / `csvToEntities` are placeholders for whatever the existing generic CSV row helpers are named — READ how `raidToCsv` / `csvToRaid` are implemented in storage.ts and mirror them EXACTLY (they wrap a header row + `fieldToString` per column, and parse via `parseCsv` + the `buildXFromObj`). Use the real helper names. If RAID uses bespoke `raidToCsv`/`csvToRaid` functions, write `milestonesToCsv`/`csvToMilestones` the same way.

(c) `workspaceToCsv` — before the final `parts.push("", planToCsvLine(ws.plan));`, add (after the status section push):
```typescript
  if ((ws.milestones ?? []).length > 0) {
    parts.push("", CSV_SECTION_MILESTONES, milestonesToCsv(ws.milestones ?? []));
  }
```
(d) `splitCsvSections` — add `"milestones"` to the `mode` union, a `milestonesLines: string[] = []`, the marker check `if (trimmed.startsWith(CSV_SECTION_MILESTONES)) { mode = "milestones"; continue; }`, the dispatch `else if (mode === "milestones") milestonesLines.push(line);`, and `milestonesText: milestonesLines.join("\r\n"),` in the return object + `milestonesText: string;` in its return type.
(e) `csvToWorkspace` — add (after `status:`):
```typescript
    milestones: s.milestonesText.trim() ? csvToMilestones(s.milestonesText) : [],
```

- [ ] **Step 4: Run — expect PASS + tsc.** `npm run test:run -- storage-serialization` ; `npx tsc --noEmit; echo "tsc exit: $?"`

- [ ] **Step 5: Commit.**
```bash
git add src/app/storage.ts src/app/storage-serialization.test.ts
git commit -F - <<'EOF'
feat: round-trip milestones through the CSV backend
EOF
```

---

## Task 4: Markdown round-trip

**Files:** Modify `src/app/storage.ts`; Test `src/app/storage-serialization.test.ts`.

Mirror the budgets/RAID Markdown handling. READ `raidToMarkdown` / `markdownToRaid` (or `budgetsToMarkdown`/`markdownToBudgets`) + `splitMarkdownSections` first, then add a `## Milestones` section the same way.

- [ ] **Step 1: Failing test.**
```typescript
test("Markdown round-trip preserves milestones", () => {
  const ws = {
    ...emptyWorkspace(),
    milestones: [{ id: 1, name: "Go-live", date: "2026-08-01", linkedTaskIds: [2] }],
  };
  const back = markdownToWorkspace(workspaceToMarkdown(ws));
  expect(back.milestones).toEqual(ws.milestones);
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm run test:run -- storage-serialization`

- [ ] **Step 3: Implement.** Add `milestonesToMarkdown(ws.milestones)` / `markdownToMilestones(...)` mirroring the RAID markdown table functions (same columns as `MILESTONES_CSV_COLUMNS`; `linkedTaskIds` pipe-joined in its cell). In `workspaceToMarkdown`, before the plan line, add `if ((ws.milestones ?? []).length > 0) out += "\n" + milestonesToMarkdown(ws.milestones ?? []);`. In `splitMarkdownSections`, capture a `## Milestones` section into `milestonesMd` (mirror `budgetsMd`). In `markdownToWorkspace`, add `milestones: s.milestonesMd.trim() ? markdownToMilestones(s.milestonesMd) : [],`.

- [ ] **Step 4: Run — expect PASS + tsc + full storage suite.** `npm run test:run -- storage` ; `npx tsc --noEmit; echo "tsc exit: $?"`

- [ ] **Step 5: Commit.**
```bash
git add src/app/storage.ts src/app/storage-serialization.test.ts
git commit -F - <<'EOF'
feat: round-trip milestones through the Markdown backend
EOF
```

---

## Task 5: Turso entity spec

**Files:** Modify `src/app/turso-schema.ts`; Test `src/app/turso-schema.test.ts`.

- [ ] **Step 1: Failing test.** Add to `src/app/turso-schema.test.ts` (reuse the existing `resultsFromStatements` round-trip helper — read the file):
```typescript
test("full round-trip restores milestones", () => {
  const ws = { ...emptyWorkspace(), milestones: [{ id: 1, name: "Go-live", date: "2026-08-01", linkedTaskIds: [2, 3] }] };
  const back = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)));
  expect(back.milestones).toEqual(ws.milestones);
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm run test:run -- turso-schema`

- [ ] **Step 3: Implement.** In `turso-schema.ts`, add `MILESTONES_CSV_COLUMNS`, `milestoneFieldToString`, `buildMilestoneFromObj` to the `./storage` import, and add to `ENTITY_SPECS` (after the budgets spec):
```typescript
  spec<Milestone>({ table: "milestones", wsKey: "milestones", columns: MILESTONES_CSV_COLUMNS, get: (w) => w.milestones ?? [], toRow: milestoneFieldToString as unknown as (e: Milestone, col: string) => string, fromObj: buildMilestoneFromObj }),
```
Add `Milestone` to the `./types` import.

- [ ] **Step 4: Run — expect PASS + tsc.** `npm run test:run -- turso-schema` ; `npx tsc --noEmit; echo "tsc exit: $?"`

- [ ] **Step 5: Commit.**
```bash
git add src/app/turso-schema.ts src/app/turso-schema.test.ts
git commit -F - <<'EOF'
feat: persist milestones to Turso (relational entity spec)
EOF
```

---

## Task 6: Context + load/save wiring + activity kinds

**Files:** Modify `src/app/workspace-context.tsx`, `src/app/use-storage-backend.ts`, `src/app/activity-log.ts`.

- [ ] **Step 1: Context.** In `workspace-context.tsx`: add `Milestone` to `./types` import; add to `WorkspaceValue` (after `status`/`setStatus`):
```typescript
  milestones: Milestone[];
  setMilestones: Dispatch<SetStateAction<Milestone[]>>;
```
Add state `const [milestones, setMilestones] = useState<Milestone[]>([]);` and add `milestones, setMilestones,` to the `value` object.

- [ ] **Step 2: Load/save.** In `use-storage-backend.ts`: add `milestones, setMilestones` to the `useWorkspace()` destructure; after `setStatus(workspace.status ?? {})` add `setMilestones(workspace.milestones ?? []);`; add `, milestones` to EVERY `save({...})`/`target.save({...})` payload (grep `.save(`); add `milestones` to the auto-save deps array (where `status` appears).

- [ ] **Step 3: Activity kinds.** In `activity-log.ts`, add to the `ActivityKind` union: `| "milestone.created" | "milestone.updated" | "milestone.deleted"`, and to `ACTIVITY_KIND_TO_KEY`: `"milestone.created": "activityMilestoneCreated", "milestone.updated": "activityMilestoneUpdated", "milestone.deleted": "activityMilestoneDeleted",`. (The i18n keys are added in Task 11; tsc will flag them missing until then — that's expected. To keep the build green between tasks, you MAY add the three i18n keys now as part of this task instead; either way they must exist before the suite is run.)

- [ ] **Step 4: Verify.** `npx tsc --noEmit; echo "tsc exit: $?"` (0 once i18n keys exist) ; `npm run test:run` (full suite green).

- [ ] **Step 5: Commit.**
```bash
git add src/app/workspace-context.tsx src/app/use-storage-backend.ts src/app/activity-log.ts
git commit -F - <<'EOF'
feat: wire milestones into context, load/save, and the activity log
EOF
```

---

## Task 7: `milestones.ts` pure logic

**Files:** Create `src/app/milestones.ts`, `src/app/milestones.test.ts`.

Build the whole file via TDD (helper by helper). Final `src/app/milestones.ts`:
```typescript
// Pure milestone-domain logic. No React, no I/O — testable core.
import { workdaysUntil } from "./due-dates";
import type { Milestone, Task } from "./types";

export type MilestoneStatus = "achieved" | "overdue" | "at-risk" | "due-soon" | "on-track";
export const MILESTONE_DUE_SOON_WORKDAYS = 3;

export function isAchieved(m: Milestone): boolean {
  return !!m.achievedDate;
}

/** Not achieved AND some linked task's effective end (completedDate||dueDate)
 *  lands after the milestone date — the gating work will be late. */
export function isAtRisk(m: Milestone, tasksById: ReadonlyMap<number, Task>): boolean {
  if (m.achievedDate) return false;
  for (const id of m.linkedTaskIds) {
    const t = tasksById.get(id);
    if (!t) continue;
    const end = t.completedDate || t.dueDate;
    if (end && end > m.date) return true;
  }
  return false;
}

export function milestoneStatus(
  m: Milestone,
  tasksById: ReadonlyMap<number, Task>,
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  leadWorkdays: number = MILESTONE_DUE_SOON_WORKDAYS,
): MilestoneStatus {
  if (m.achievedDate) return "achieved";
  if (m.date < todayISO) return "overdue";
  if (isAtRisk(m, tasksById)) return "at-risk";
  const hs = holidaySet instanceof Set ? holidaySet : new Set<string>(holidaySet);
  if (workdaysUntil(m.date, todayISO, hs) <= leadWorkdays) return "due-soon";
  return "on-track";
}

export function sortMilestones(milestones: readonly Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

export function partitionMilestones(
  milestones: readonly Milestone[],
  tasksById: ReadonlyMap<number, Task>,
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  leadWorkdays: number = MILESTONE_DUE_SOON_WORKDAYS,
): { overdue: Milestone[]; atRisk: Milestone[]; dueSoon: Milestone[] } {
  const overdue: Milestone[] = [];
  const atRisk: Milestone[] = [];
  const dueSoon: Milestone[] = [];
  for (const m of milestones) {
    const s = milestoneStatus(m, tasksById, todayISO, holidaySet, leadWorkdays);
    if (s === "overdue") overdue.push(m);
    else if (s === "at-risk") atRisk.push(m);
    else if (s === "due-soon") dueSoon.push(m);
  }
  const byDate = (a: Milestone, b: Milestone) => a.date.localeCompare(b.date) || a.id - b.id;
  overdue.sort(byDate); atRisk.sort(byDate); dueSoon.sort(byDate);
  return { overdue, atRisk, dueSoon };
}

/** Schedule RAG contribution: overdue→R, at-risk/due-soon→A, else null. */
export function milestoneScheduleContribution(
  milestones: readonly Milestone[],
  tasksById: ReadonlyMap<number, Task>,
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  leadWorkdays: number = MILESTONE_DUE_SOON_WORKDAYS,
): "R" | "A" | null {
  const { overdue, atRisk, dueSoon } = partitionMilestones(milestones, tasksById, todayISO, holidaySet, leadWorkdays);
  if (overdue.length > 0) return "R";
  if (atRisk.length > 0 || dueSoon.length > 0) return "A";
  return null;
}
```

- [ ] **Step 1: Failing tests.** Create `src/app/milestones.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  isAchieved, isAtRisk, milestoneStatus, sortMilestones,
  partitionMilestones, milestoneScheduleContribution,
} from "./milestones";
import type { Milestone, Task } from "./types";

function ms(o: Partial<Milestone> = {}): Milestone {
  return { id: 1, name: "M", date: "2026-08-01", linkedTaskIds: [], ...o };
}
function task(o: Partial<Task> = {}): Task {
  return { id: 1, taskName: "T", assignee: "A", assigneeEmail: "a@x.io", dueDate: "2026-07-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "", ...o };
}
const today = "2026-06-02";
const holidays = new Set<string>();
const byId = (...ts: Task[]) => new Map(ts.map((t) => [t.id, t]));

describe("isAchieved", () => {
  it("true only when achievedDate set", () => {
    expect(isAchieved(ms({ achievedDate: "2026-07-30" }))).toBe(true);
    expect(isAchieved(ms())).toBe(false);
  });
});

describe("isAtRisk", () => {
  it("true when a linked task's effective end is after the milestone date", () => {
    const m = ms({ date: "2026-08-01", linkedTaskIds: [10] });
    expect(isAtRisk(m, byId(task({ id: 10, dueDate: "2026-08-05" })))).toBe(true);
  });
  it("false when linked tasks finish on time", () => {
    const m = ms({ date: "2026-08-01", linkedTaskIds: [10] });
    expect(isAtRisk(m, byId(task({ id: 10, dueDate: "2026-07-20" })))).toBe(false);
  });
  it("uses completedDate over dueDate, and ignores achieved milestones + missing tasks", () => {
    const m = ms({ date: "2026-08-01", linkedTaskIds: [10, 99] });
    expect(isAtRisk(m, byId(task({ id: 10, dueDate: "2026-09-01", completedDate: "2026-07-15" })))).toBe(false);
    expect(isAtRisk(ms({ date: "2026-08-01", achievedDate: "2026-08-02", linkedTaskIds: [10] }), byId(task({ id: 10, dueDate: "2026-09-01" })))).toBe(false);
  });
});

describe("milestoneStatus precedence", () => {
  it("achieved > overdue > at-risk > due-soon > on-track", () => {
    expect(milestoneStatus(ms({ date: "2026-05-01", achievedDate: "2026-05-02" }), byId(), today, holidays)).toBe("achieved");
    expect(milestoneStatus(ms({ date: "2026-05-01" }), byId(), today, holidays)).toBe("overdue");
    expect(milestoneStatus(ms({ date: "2026-08-01", linkedTaskIds: [10] }), byId(task({ id: 10, dueDate: "2026-08-10" })), today, holidays)).toBe("at-risk");
    expect(milestoneStatus(ms({ date: "2026-06-03" }), byId(), today, holidays)).toBe("due-soon");
    expect(milestoneStatus(ms({ date: "2026-12-01" }), byId(), today, holidays)).toBe("on-track");
  });
});

describe("sortMilestones", () => {
  it("sorts by date then id", () => {
    expect(sortMilestones([ms({ id: 2, date: "2026-09-01" }), ms({ id: 1, date: "2026-08-01" })]).map((m) => m.id)).toEqual([1, 2]);
  });
});

describe("partitionMilestones", () => {
  it("buckets overdue / at-risk / due-soon, excludes achieved + on-track", () => {
    const tasksById = byId(task({ id: 10, dueDate: "2026-08-10" }));
    const list = [
      ms({ id: 1, date: "2026-05-01" }),                           // overdue
      ms({ id: 2, date: "2026-08-01", linkedTaskIds: [10] }),      // at-risk
      ms({ id: 3, date: "2026-06-03" }),                           // due-soon
      ms({ id: 4, date: "2026-12-01" }),                           // on-track -> excluded
      ms({ id: 5, date: "2026-05-01", achievedDate: "2026-05-02" }),// achieved -> excluded
    ];
    const p = partitionMilestones(list, tasksById, today, holidays);
    expect(p.overdue.map((m) => m.id)).toEqual([1]);
    expect(p.atRisk.map((m) => m.id)).toEqual([2]);
    expect(p.dueSoon.map((m) => m.id)).toEqual([3]);
  });
});

describe("milestoneScheduleContribution", () => {
  it("R if any overdue, A if any at-risk/due-soon, else null", () => {
    expect(milestoneScheduleContribution([ms({ date: "2026-05-01" })], byId(), today, holidays)).toBe("R");
    expect(milestoneScheduleContribution([ms({ date: "2026-06-03" })], byId(), today, holidays)).toBe("A");
    expect(milestoneScheduleContribution([ms({ date: "2026-12-01" })], byId(), today, holidays)).toBeNull();
    expect(milestoneScheduleContribution([], byId(), today, holidays)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm run test:run -- milestones`
- [ ] **Step 3: Create `src/app/milestones.ts`** with the full content above.
- [ ] **Step 4: Run — expect PASS + tsc.** `npm run test:run -- milestones` ; `npx tsc --noEmit; echo "tsc exit: $?"`
- [ ] **Step 5: Commit.**
```bash
git add src/app/milestones.ts src/app/milestones.test.ts
git commit -F - <<'EOF'
feat: milestones.ts pure logic (status/at-risk/partition/schedule-contribution)
EOF
```

---

## Task 8: Dashboard integration

**Files:** Modify `src/app/dashboard.ts`, `src/app/dashboard.test.ts`.

- [ ] **Step 1: Failing test.** In `dashboard.test.ts`: add `milestones: []` to the `baseInput()` helper's returned object (required once `DashboardInput` gains the field). Then add:
```typescript
import type { Milestone } from "./types";
// ... inside describe("computeDashboard", ...) ...
it("partitions milestones and folds them into the Schedule RAG", () => {
  const milestones: Milestone[] = [
    { id: 1, name: "late", date: "2026-05-01", linkedTaskIds: [] },     // overdue
    { id: 2, name: "soon", date: "2026-06-03", linkedTaskIds: [] },     // due-soon
  ];
  const m = computeDashboard(baseInput({ milestones }));
  expect(m.overdueMilestones.map((x) => x.id)).toEqual([1]);
  expect(m.dueSoonMilestones.map((x) => x.id)).toEqual([2]);
  expect(m.schedule.computed).toBe("R"); // overdue milestone drives Red
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm run test:run -- dashboard`

- [ ] **Step 3: Implement.** In `dashboard.ts`:
- Add imports: `import { partitionMilestones, milestoneScheduleContribution } from "./milestones";` and `Milestone` to the `./types` import.
- `DashboardInput` — add `milestones: readonly Milestone[];`.
- `DashboardModel` — add `overdueMilestones: Milestone[]; atRiskMilestones: Milestone[]; dueSoonMilestones: Milestone[];`.
- In `computeDashboard`, build the task map and fold milestones into schedule. Replace the `scheduleComputed` line and add the partition:
```typescript
  const tasksById = new Map(input.tasks.map((t) => [t.id, t] as const));
  const taskSchedule = computeScheduleStatus(input.tasks, today, holidaySet, dueSoonWorkdays);
  const msContribution = milestoneScheduleContribution(input.milestones, tasksById, today, holidaySet, dueSoonWorkdays);
  const scheduleComputed: Health =
    taskSchedule === "R" || msContribution === "R" ? "R"
    : taskSchedule === "A" || msContribution === "A" ? "A"
    : "G";
  const ms = partitionMilestones(input.milestones, tasksById, today, holidaySet, dueSoonWorkdays);
```
(Delete the old `const scheduleComputed = computeScheduleStatus(...)` line — `computeScheduleStatus` itself stays unchanged so its existing tests pass.)
- Add to the returned object:
```typescript
    overdueMilestones: ms.overdue,
    atRiskMilestones: ms.atRisk,
    dueSoonMilestones: ms.dueSoon,
```

- [ ] **Step 4: Run — expect PASS + tsc.** `npm run test:run -- dashboard` ; `npx tsc --noEmit; echo "tsc exit: $?"`. NOTE: `dashboard-panel.tsx` calls `computeDashboard` — it will now fail tsc until Task 10 passes `milestones`. To keep this task self-contained, ALSO update the `computeDashboard({...})` call site in `dashboard-panel.tsx` to pass `milestones: props.milestones ?? []` AND add an optional `milestones?: Milestone[]` to `DashboardPanelProps` now (full wiring lands in Task 10). If you prefer to keep panel changes in Task 10, expect this task's standalone tsc to flag the panel call — run `npm run test:run -- dashboard` (which doesn't typecheck the panel) to confirm the logic, and let Task 10 green the panel. Document which you chose.

- [ ] **Step 5: Commit.**
```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts
git commit -F - <<'EOF'
feat: fold milestones into the dashboard model + Schedule RAG
EOF
```

---

## Task 9: i18n keys (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: EN keys.** Add to `enUS` in `i18n.ts`:
```typescript
  navMilestones: "Milestones",
  milestoneNew: "New milestone",
  milestoneEdit: "Edit milestone #{0}",
  milestoneName: "Name",
  milestoneDate: "Date",
  milestoneDescription: "Description",
  milestoneAchieved: "Achieved",
  milestoneLinkedTasks: "Linked tasks",
  milestoneAddLinkedTask: "Link a task…",
  milestoneSave: "Save milestone",
  milestoneErrorRequired: "Name and date are required.",
  milestoneStatusAchieved: "Achieved",
  milestoneStatusOverdue: "Overdue",
  milestoneStatusAtRisk: "At risk",
  milestoneStatusDueSoon: "Due soon",
  milestoneStatusOnTrack: "On track",
  milestonesTitle: "Key dates",
  milestonesEmpty: "No milestones yet.",
  milestonesColName: "Milestone",
  milestonesColDate: "Date",
  milestonesColStatus: "Status",
  milestonesMarkAchieved: "Mark achieved",
  dashboardMilestones: "Milestones",
  ganttAddMilestone: "Add milestone",
  activityMilestoneCreated: "Created milestone #{0} – {1}",
  activityMilestoneUpdated: "Updated milestone #{0}",
  activityMilestoneDeleted: "Deleted milestone #{0}",
```
- [ ] **Step 2: DE keys.** Add the same keys to `i18n.de.ts` with German values, STRAIGHT ASCII `"` only, matching the file's existing real-umlaut style:
```typescript
  navMilestones: "Meilensteine",
  milestoneNew: "Neuer Meilenstein",
  milestoneEdit: "Meilenstein #{0} bearbeiten",
  milestoneName: "Name",
  milestoneDate: "Datum",
  milestoneDescription: "Beschreibung",
  milestoneAchieved: "Erreicht",
  milestoneLinkedTasks: "Verknüpfte Aufgaben",
  milestoneAddLinkedTask: "Aufgabe verknüpfen…",
  milestoneSave: "Meilenstein speichern",
  milestoneErrorRequired: "Name und Datum sind erforderlich.",
  milestoneStatusAchieved: "Erreicht",
  milestoneStatusOverdue: "Überfällig",
  milestoneStatusAtRisk: "Gefährdet",
  milestoneStatusDueSoon: "Bald fällig",
  milestoneStatusOnTrack: "Im Plan",
  milestonesTitle: "Wichtige Termine",
  milestonesEmpty: "Noch keine Meilensteine.",
  milestonesColName: "Meilenstein",
  milestonesColDate: "Datum",
  milestonesColStatus: "Status",
  milestonesMarkAchieved: "Als erreicht markieren",
  dashboardMilestones: "Meilensteine",
  ganttAddMilestone: "Meilenstein hinzufügen",
  activityMilestoneCreated: "Meilenstein #{0} erstellt – {1}",
  activityMilestoneUpdated: "Meilenstein #{0} aktualisiert",
  activityMilestoneDeleted: "Meilenstein #{0} gelöscht",
```
- [ ] **Step 3: Verify.** `npx tsc --noEmit; echo "tsc exit: $?"` (parity); PowerShell `(Select-String -Path src/app/i18n.de.ts -Pattern '[“”]' | Measure-Object).Count` — expect the same count as before this task (it was 4).
- [ ] **Step 4: Commit.**
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: milestone i18n keys (EN + DE)
EOF
```

---

## Task 10: Register the Milestones nav view + icon

**Files:** Modify `src/app/nav-config.ts`, `src/app/nav-icons.tsx`.

- [ ] **Step 1.** In `nav-config.ts`, add `"milestones"` to the `AppView` union (after `"gantt"`); add `{ view: "milestones" }` to the Plan group items right after `{ view: "gantt" }`; add `milestones: "navMilestones",` to `LABEL_KEYS`.
- [ ] **Step 2.** In `nav-icons.tsx`, add a diamond to `ICON_PATHS`:
```typescript
  milestones: "M12 3l7 9-7 9-7-9 7-9z",
```
- [ ] **Step 3: Verify.** `npx tsc --noEmit; echo "tsc exit: $?"` (0 — proves `LABEL_KEYS` + `ICON_PATHS` completeness).
- [ ] **Step 4: Commit.**
```bash
git add src/app/nav-config.ts src/app/nav-icons.tsx
git commit -F - <<'EOF'
feat: register the Milestones nav view (Plan group) + diamond icon
EOF
```

---

## Task 11: `MilestoneEditModal`

**Files:** Create `src/app/milestone-edit-modal.tsx`, `src/app/milestone-edit-modal.test.tsx`.

Model on `absence-edit-modal.tsx` (READ it for the exact `Modal`/`ModalHeader`/`useDraggable`/`ModalEditFooter` imports + draft-state pattern + tokens). The linked-tasks control: if the RAID edit modal has a reusable task-picker, reuse it; otherwise implement the simple chips + select below.

- [ ] **Step 1: Smoke test.** Create `src/app/milestone-edit-modal.test.tsx`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MilestoneEditModal } from "./milestone-edit-modal";

it("renders a new-milestone form without crashing", () => {
  render(
    <MilestoneEditModal
      lang="en-US"
      milestone={{ id: 1, name: "", date: "2026-08-01", linkedTaskIds: [] }}
      isNew
      tasks={[]}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByText(/new milestone/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm run test:run -- milestone-edit-modal`

- [ ] **Step 3: Implement** `src/app/milestone-edit-modal.tsx` following the absence-modal structure:
```typescript
"use client";
import { useState } from "react";
import { Modal } from "./modal";               // confirm exact import names from absence-edit-modal.tsx
import { ModalHeader } from "./modal-header";   // ^ adjust to the real paths
import { ModalEditFooter } from "./modal-edit-fields"; // ^ confirm
import { useDraggable } from "./use-draggable";
import { type Lang, t } from "./i18n";
import type { Milestone, Task } from "./types";

interface Props {
  lang: Lang;
  milestone: Milestone | null;   // null = hidden
  isNew: boolean;
  tasks: readonly Task[];        // for the linked-tasks picker
  onSave: (next: Milestone) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

export function MilestoneEditModal({ lang, milestone, isNew, tasks, onSave, onDelete, onClose }: Props) {
  const [prev, setPrev] = useState(milestone);
  const [draft, setDraft] = useState<Milestone | null>(milestone);
  const [error, setError] = useState<string | null>(null);
  if (prev !== milestone) { setPrev(milestone); setDraft(milestone); setError(null); }

  function update<K extends keyof Milestone>(key: K, value: Milestone[K]) {
    setDraft((p) => (p ? { ...p, [key]: value } : p));
    setError(null);
  }
  function toggleLinked(id: number) {
    setDraft((p) => {
      if (!p) return p;
      const has = p.linkedTaskIds.includes(id);
      return { ...p, linkedTaskIds: has ? p.linkedTaskIds.filter((x) => x !== id) : [...p.linkedTaskIds, id] };
    });
  }
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    const name = draft.name.trim();
    const date = draft.date.trim();
    if (!name || !date) { setError(t(lang, "milestoneErrorRequired")); return; }
    onSave({ ...draft, name, date, description: draft.description?.trim() || undefined });
  }

  const { offset, handleProps } = useDraggable(draft !== null);
  if (!draft) return null;

  return (
    <Modal open onClose={onClose} ariaLabel={isNew ? t(lang, "milestoneNew") : t(lang, "milestoneEdit", draft.id)} align="center" backdropClassName="bg-black/40" zIndex={50}>
      <div data-modal-panel style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} className="relative flex w-[560px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <ModalHeader lang={lang} title={isNew ? t(lang, "milestoneNew") : t(lang, "milestoneEdit", draft.id)} onClose={onClose} dragHandleProps={handleProps} />
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto p-5">
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">{t(lang, "milestoneName")} *</span>
            <input value={draft.name} onChange={(e) => update("name", e.target.value)} className="rounded-md border border-line bg-surface px-3 py-2 text-sm" /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">{t(lang, "milestoneDate")} *</span>
            <input type="date" required value={draft.date} onChange={(e) => update("date", e.target.value)} className="rounded-md border border-line bg-surface px-3 py-2 text-sm" /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium">{t(lang, "milestoneDescription")}</span>
            <textarea value={draft.description ?? ""} onChange={(e) => update("description", e.target.value)} className="min-h-16 rounded-md border border-line bg-surface px-3 py-2 text-sm" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft.achievedDate}
            onChange={(e) => update("achievedDate", e.target.checked ? new Date().toISOString().slice(0, 10) : undefined)} />
            <span className="font-medium">{t(lang, "milestoneAchieved")}</span></label>
          <fieldset className="flex flex-col gap-1 text-sm"><legend className="font-medium">{t(lang, "milestoneLinkedTasks")}</legend>
            <div className="max-h-40 overflow-y-auto rounded-md border border-line p-2">
              {tasks.length === 0 ? <p className="text-muted-foreground">—</p> : tasks.map((tk) => (
                <label key={tk.id} className="flex items-center gap-2"><input type="checkbox" checked={draft.linkedTaskIds.includes(tk.id)} onChange={() => toggleLinked(tk.id)} />
                  <span>#{tk.id} {tk.taskName}</span></label>
              ))}
            </div></fieldset>
          {error ? <p className="text-sm text-AIPM-pink">{error}</p> : null}
          <ModalEditFooter lang={lang} isNew={isNew} onDelete={() => onDelete(draft.id)} onClose={onClose} saveLabel={t(lang, "milestoneSave")} />
        </form>
      </div>
    </Modal>
  );
}
```
IMPORTANT: the import paths/names for `Modal`, `ModalHeader`, `ModalEditFooter`, `useDraggable` MUST match what `absence-edit-modal.tsx` actually imports — copy them verbatim from that file. If `ModalEditFooter` lives elsewhere or has different props, match the real one. Confirm `text-AIPM-pink` is the error token used elsewhere (absence modal uses an error style — match it).

- [ ] **Step 4: Run — expect PASS + tsc + lint.** `npm run test:run -- milestone-edit-modal` ; `npx tsc --noEmit; echo "tsc exit: $?"` ; `npm run lint`
- [ ] **Step 5: Commit.**
```bash
git add src/app/milestone-edit-modal.tsx src/app/milestone-edit-modal.test.tsx
git commit -F - <<'EOF'
feat: MilestoneEditModal (name/date/description/achieved + linked-tasks picker)
EOF
```

---

## Task 12: `MilestonesPanel` (list view)

**Files:** Create `src/app/milestones-panel.tsx`, `src/app/milestones-panel.test.tsx`.

Reuses the `report-table` kit. Reads `milestones`/`setMilestones`/`tasks` from `useWorkspace()`; opens `MilestoneEditModal` for add/edit; computes status via `milestoneStatus`.

- [ ] **Step 1: Smoke test.** Create `src/app/milestones-panel.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MilestonesPanel } from "./milestones-panel";
import { WorkspaceProvider } from "./workspace-context";
import { FiltersProvider } from "./filters-context"; // match the wrapper milestones-panel/useWorkspace needs (see dashboard-panel.test.tsx)

it("renders empty milestones without crashing", () => {
  const { container } = render(
    <FiltersProvider><WorkspaceProvider>
      <MilestonesPanel lang="en-US" today="2026-06-02" holidaySet={new Set()} />
    </WorkspaceProvider></FiltersProvider>,
  );
  expect(container).toBeTruthy();
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm run test:run -- milestones-panel`

- [ ] **Step 3: Implement** `src/app/milestones-panel.tsx`. Read `budget-report-panel.tsx`/`reports.tsx` for the `ReportCard` usage and `useResizable`/`sizeRef` pattern, and mirror it. Core shape:
```typescript
"use client";
import { useRef, useState } from "react";
import { ReportCard } from "./report-table";
import { MilestoneEditModal } from "./milestone-edit-modal";
import { useWorkspace } from "./workspace-context";
import { milestoneStatus, sortMilestones, type MilestoneStatus } from "./milestones";
import { type Lang, t } from "./i18n";
import type { Milestone } from "./types";

const STATUS_KEY: Record<MilestoneStatus, "milestoneStatusAchieved" | "milestoneStatusOverdue" | "milestoneStatusAtRisk" | "milestoneStatusDueSoon" | "milestoneStatusOnTrack"> = {
  achieved: "milestoneStatusAchieved", overdue: "milestoneStatusOverdue", "at-risk": "milestoneStatusAtRisk", "due-soon": "milestoneStatusDueSoon", "on-track": "milestoneStatusOnTrack",
};

export function MilestonesPanel({ lang, today, holidaySet }: { lang: Lang; today: string; holidaySet: ReadonlySet<string> }) {
  const { milestones, setMilestones, tasks } = useWorkspace();
  const sizeRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [isNew, setIsNew] = useState(false);
  const tasksById = new Map(tasks.map((tk) => [tk.id, tk] as const));
  const rows = sortMilestones(milestones);

  function nextId() { return milestones.reduce((m, x) => Math.max(m, x.id), 0) + 1; }
  function openNew() { setIsNew(true); setEditing({ id: nextId(), name: "", date: today, linkedTaskIds: [] }); }
  function save(next: Milestone) {
    setMilestones((prev) => prev.some((m) => m.id === next.id) ? prev.map((m) => (m.id === next.id ? next : m)) : [...prev, next]);
    setEditing(null);
  }
  function del(id: number) { setMilestones((prev) => prev.filter((m) => m.id !== id)); setEditing(null); }
  function toggleAchieved(m: Milestone) {
    setMilestones((prev) => prev.map((x) => x.id === m.id ? { ...x, achievedDate: x.achievedDate ? undefined : today } : x));
  }

  return (
    <ReportCard lang={lang} sizeRef={sizeRef} onResetSize={() => undefined} title={t(lang, "milestonesTitle")}
      toolbarExtra={<button type="button" onClick={openNew} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:border-AIPM-dark-blue">+ {t(lang, "milestoneNew")}</button>}>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t(lang, "milestonesEmpty")}</p> : (
        <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-muted-foreground">
          <th className="py-1">{t(lang, "milestonesColName")}</th><th>{t(lang, "milestonesColDate")}</th><th>{t(lang, "milestonesColStatus")}</th><th></th>
        </tr></thead><tbody>
          {rows.map((m) => {
            const s = milestoneStatus(m, tasksById, today, holidaySet);
            return (<tr key={m.id} className="border-t border-line">
              <td className="py-1"><button type="button" className="hover:underline" onClick={() => { setIsNew(false); setEditing(m); }}>{m.name}</button></td>
              <td>{m.date}</td>
              <td>{s === "at-risk" ? "⚠ " : ""}{t(lang, STATUS_KEY[s])}</td>
              <td><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!m.achievedDate} onChange={() => toggleAchieved(m)} />{t(lang, "milestonesMarkAchieved")}</label></td>
            </tr>);
          })}
        </tbody></table>
      )}
      {editing ? <MilestoneEditModal lang={lang} milestone={editing} isNew={isNew} tasks={tasks} onSave={save} onDelete={del} onClose={() => setEditing(null)} /> : null}
    </ReportCard>
  );
}
```
(Confirm `ReportCard`'s `toolbarExtra` prop exists — it does per report-table.tsx. Match real muted/border tokens. `useSortableFilter` is optional here; `sortMilestones` + a plain table is fine for v1. If you prefer the sortable kit, wire `useSortableFilter` with `getValue`.)

- [ ] **Step 4: Run — expect PASS + tsc + lint.** `npm run test:run -- milestones-panel` ; `npx tsc --noEmit; echo "tsc exit: $?"` ; `npm run lint`
- [ ] **Step 5: Commit.**
```bash
git add src/app/milestones-panel.tsx src/app/milestones-panel.test.tsx
git commit -F - <<'EOF'
feat: MilestonesPanel — key-dates list with add/edit/delete + mark-achieved
EOF
```

---

## Task 13: Dashboard Milestones subsection

**Files:** Modify `src/app/dashboard-sections/registers-band.tsx`, `src/app/dashboard-panel.tsx`.

- [ ] **Step 1.** Extend `RegistersBand` props with `overdueMilestones`, `atRiskMilestones`, `dueSoonMilestones` (`Milestone[]`) and `onOpenMilestone?: () => void`. Render a third `Section` titled `t(lang, "dashboardMilestones")` below the existing 2-col grid (wrap the current grid + the new section in a `<div className="space-y-4">`). List overdue (⚠ none), at-risk (⚠), and due-soon milestones as `name · date`, each a button calling `onOpenMilestone?.()` when provided (else a span), with an empty `—` when all three are empty. Add `import type { Milestone } from "../types";`.
- [ ] **Step 2.** In `dashboard-panel.tsx`: accept `milestones` (already added in Task 8 if you did the panel pre-wire — otherwise add now) and pass `milestones: props.milestones ?? []` into `computeDashboard`; pass the new model fields + `onOpenMilestone` to `RegistersBand`. Add `onOpenMilestone?: () => void` to `DashboardPanelProps` and forward it.
- [ ] **Step 3: Verify.** `npm run test:run -- dashboard-panel` ; `npx tsc --noEmit; echo "tsc exit: $?"` ; `npm run lint`
- [ ] **Step 4: Commit.**
```bash
git add src/app/dashboard-sections/registers-band.tsx src/app/dashboard-panel.tsx
git commit -F - <<'EOF'
feat: dashboard Milestones subsection (overdue / at-risk / due-soon)
EOF
```

---

## Task 14: Gantt — milestone diamond rows

**Files:** Modify `src/app/gantt.tsx`.

READ `gantt.tsx` thoroughly first (the row-rendering container around lines 1300–1660, the `range` useMemo ~954–984, the toolbar ~1000, `GanttPanel` props ~518). This task adds milestones as their OWN rows (diamonds), the date-range fold, the toolbar button, and click-to-edit. Edges are Task 15.

- [ ] **Step 1.** Extend `GanttPanel` props: add `milestones?: readonly Milestone[]`, `onAddMilestone?: () => void`, `onEditMilestone?: (m: Milestone) => void`. Import `Milestone` + `milestoneStatus`/`isAchieved` from `./milestones` (pass an empty `holidaySet`/today as the Gantt already derives `today` via `todayUTC()`; for status use `today` ISO + an empty holiday set — at-risk needs `tasksById`, build it from `tasks`).
- [ ] **Step 2.** Fold milestone dates into the `range` useMemo: after iterating `layout.bars`, also iterate `milestones` and expand `min`/`max` by `parseISO(m.date)`. Add `milestones` to the useMemo deps.
- [ ] **Step 3.** Render milestone rows. In the row container that maps `filteredTasks`, render an additional block mapping `milestones` (sorted by date). Each milestone row mirrors a task row's gutter (the milestone `name`) + a timeline cell containing a **diamond** at its date X:
```tsx
const mx = diffDays(range.min, parseISO(m.date)!) * DAY_WIDTH_PX;
// diamond: a rotated square via SVG, centered at mx
<svg className="h-full w-full overflow-visible" viewBox={`0 0 ${totalWidth} ${ROW_HEIGHT_PX}`} preserveAspectRatio="none">
  <rect x={mx - 7} y={(ROW_HEIGHT_PX - 14) / 2} width={14} height={14} transform={`rotate(45 ${mx} ${ROW_HEIGHT_PX / 2})`}
    className={isAchieved(m) ? "fill-emerald-500/50" : "fill-emerald-500"}
    stroke={status === "at-risk" ? "#ec4899" /* AIPM-pink */ : "none"} strokeWidth={status === "at-risk" ? 2 : 0} />
</svg>
```
Wrap the diamond row in a clickable element calling `onEditMilestone?.(m)`; add a `title` tooltip `${m.name} · ${m.date}`. Match the existing row markup (gutter width, `ROW_HEIGHT_PX`, role="row") by copying a task row's structure and swapping the bar for the diamond. (Confirm the real total-width var name used by the timeline svg.)
- [ ] **Step 4.** Toolbar: beside the "Add task" button, add (when `onAddMilestone`):
```tsx
<button type="button" onClick={onAddMilestone} className="<same classes as Add task>">{t(lang, "ganttAddMilestone")}</button>
```
- [ ] **Step 5: Verify.** There's no easy unit test for the SVG; rely on `npx tsc --noEmit` (0), `npm run lint`, and the existing gantt tests still passing: `npm run test:run -- gantt`. Add a minimal render smoke test only if the Gantt already has a test harness (check for `gantt.test.tsx`); if so, add a case rendering one milestone without crashing.
- [ ] **Step 6: Commit.**
```bash
git add src/app/gantt.tsx
git commit -F - <<'EOF'
feat: render milestones as diamond rows on the Gantt (+ add-milestone button)
EOF
```

---

## Task 15: Gantt — linked-task → milestone edges + at-risk

**Files:** Modify `src/app/gantt.tsx`.

READ the dependency-edge SVG overlay (how task→task arrows are drawn from `bars` positions, around `computeCriticalPath` consumption / the edges `<svg>` overlay). This task draws a faint connector from each linked task's bar end to its milestone diamond.

- [ ] **Step 1.** For each milestone with `linkedTaskIds`, for each linked task that has a bar in `layout.bars`, draw a connector (line/path) in the same SVG overlay the task edges use: from the linked task bar's end point `(taskEndX, taskRowY)` to the milestone diamond `(mx, milestoneRowY)`. Use a muted stroke (e.g. `stroke-slate-400`), thinner than critical edges; do NOT color them critical-path red. You'll need each milestone row's Y (track its index in the combined row layout) and `mx` (from Task 14).
- [ ] **Step 2.** (At-risk ring already added in Task 14 via `status === "at-risk"`.) Confirm the at-risk diamond stroke renders.
- [ ] **Step 3: Verify.** `npx tsc --noEmit; echo "tsc exit: $?"` ; `npm run lint` ; `npm run test:run -- gantt`.
- [ ] **Step 4: Commit.**
```bash
git add src/app/gantt.tsx
git commit -F - <<'EOF'
feat: draw linked-task → milestone connector edges on the Gantt
EOF
```
NOTE: if integrating edges into the existing overlay proves materially invasive (the overlay geometry isn't cleanly reusable for milestone rows), STOP and report — edges can ship as a fast follow without blocking the rest; the at-risk ring + diamonds already deliver the core value.

---

## Task 16: Mount the Milestones view + wire the Gantt

**Files:** Modify `src/app/workspace-section.tsx`.

- [ ] **Step 1.** Import `MilestonesPanel`. Add the mount block beside the others (mirror the `reports`/`dashboard` blocks; `today`, `holidaySet`, `lang` are in scope):
```tsx
{activeTab === "milestones" && (
  <div id="panel-milestones" role="tabpanel" className={panelScrollClass}>
    <MilestonesPanel lang={lang} today={today} holidaySet={holidaySet} />
  </div>
)}
```
- [ ] **Step 2.** Wire the Gantt mount: pass `milestones={milestones}`, `onAddMilestone`, `onEditMilestone` to `GanttPanel`. `milestones` comes from `useWorkspace()` in this file's scope (add to the destructure if needed). For add/edit, milestones are managed in the Milestones view — simplest wiring: `onAddMilestone={() => setActiveTab("milestones")}` and `onEditMilestone={() => setActiveTab("milestones")}` (navigates to the view to edit). (A nicer inline-modal-from-Gantt is a fast follow; navigating is acceptable for v1 and keeps editor state in one place.)
- [ ] **Step 3.** Wire the dashboard `onOpenMilestone={() => setActiveTab("milestones")}` on the `DashboardPanel` mount.
- [ ] **Step 4: Verify.** `npx tsc --noEmit; echo "tsc exit: $?"` ; `npm run lint` ; `npm run test:run` (full suite).
- [ ] **Step 5: Commit.**
```bash
git add src/app/workspace-section.tsx
git commit -F - <<'EOF'
feat: mount the Milestones view + wire Gantt/dashboard milestone navigation
EOF
```

---

## Task 17: Final verification

- [ ] **Step 1.** `npm run test:run` — all pass.
- [ ] **Step 2.** `npm run test:coverage` — gate (70%) holds; `milestones.ts` well covered.
- [ ] **Step 3.** `npx tsc --noEmit; echo "tsc exit: $?"` (0) ; `npm run lint` (clean).
- [ ] **Step 4 (manual smoke).** `npm run dev`: Milestones appears under Plan; add a milestone (with a linked task due after its date) → it shows at-risk (⚠) in the list, a diamond on the Gantt, and an at-risk entry in the dashboard Milestones subsection with Schedule going Amber/Red; mark achieved → it drops out. Reload → persists.
- [ ] **Step 5.** Restore dev churn if any: `git checkout -- sample-workspace.md` (if changed).

---

## Self-review (plan author)

**Spec coverage:** Milestone model + linkedTaskIds → T1. Persistence JSON/CSV/MD/Turso → T2–T5. Context/load-save/activity → T6. `milestones.ts` (status/at-risk/partition/schedule-contribution) → T7. Dashboard model + Schedule RAG → T8. i18n → T9. Nav view + icon → T10. Edit modal w/ task-picker → T11. Milestones view (list + mark-achieved) → T12. Dashboard subsection → T13. Gantt diamonds + add button → T14. Gantt edges + at-risk → T15. Mount + wiring → T16. Verify → T17.

**Deviations (intentional):** at-risk uses lexicographic `YYYY-MM-DD` string comparison (valid); `computeScheduleStatus` left task-only with milestone contribution folded in `computeDashboard` (keeps feature-#1 tests intact); Gantt add/edit navigates to the Milestones view rather than opening a modal from the Gantt (v1 simplicity — editor state stays in one place); Gantt edges (T15) explicitly degradable to a fast-follow if the overlay geometry resists.

**Placeholder scan:** the storage CSV/MD helper names (`entityToCsv`/`csvToEntities`/`raidToMarkdown`) and the modal import paths are flagged "READ the real names and mirror" — these are the few spots the implementer must confirm against the sibling code; every such spot names the exact sibling to copy and is guarded by a round-trip/smoke test.

**Type consistency:** `Milestone` shape, `MILESTONES_CSV_COLUMNS`, `milestoneFieldToString`/`buildMilestoneFromObj`/`sanitizeMilestone`, the `milestones.ts` exports, and the dashboard fields (`overdueMilestones`/`atRiskMilestones`/`dueSoonMilestones`) are used identically across tasks.
