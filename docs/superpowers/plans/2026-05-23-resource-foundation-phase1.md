# Resource Foundation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the data foundation for the resource-utilization feature — new `Resource`, `Role`, `Discipline`, `Grade`, and `ResourcePlan` types; a `workdayHours` setting; schema-v5 persistence; and a non-destructive migration that backfills `resourceId` onto existing tasks/absences — with no behavior change beyond a read-only resource list.

**Architecture:** Migration and seeding are written as **pure functions over a `Workspace` object** (in `resource-foundation.ts`), so they unit-test without IndexedDB. `storage.ts` calls them in every backend's `load()`. The new entities are persisted exactly like `absences` (v3) and `shifts` (v4): a schema bump, new IDB record stores, JSON-envelope fields, and CSV/Markdown sections. The `ResourcePlan` singleton lives in the existing `kv` store. Tasks/absences keep their free-text `assignee` string; `resourceId` is an additive, authoritative-when-present link (spec Approach A).

**Tech Stack:** TypeScript, React 19, Next.js 16, Vitest (jsdom) + Testing Library. Reference spec: `docs/superpowers/specs/2026-05-23-resource-utilization-design.md`.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `src/app/types.ts` | Entity types + presets + `resourceId?` on Task/Absence | Modify |
| `src/app/resource-foundation.ts` | Pure seeding/default/backfill + migration helpers | **New** |
| `src/app/resource-foundation.test.ts` | Unit tests for the above | **New** |
| `src/app/sanitize.ts` | Period-map codec + entity sanitizers | Modify |
| `src/app/sanitize.test.ts` | Tests for the new sanitizers | Modify |
| `src/app/storage.ts` | `Workspace` shape, schema v5, IDB stores, CSV/MD sections, JSON envelope, migration call | Modify |
| `src/app/storage-serialization.test.ts` | CSV/MD/JSON round-trip + migration tests | **New** |
| `src/app/workspace-context.tsx` | Hold + expose `resources/roles/disciplines/grades/plan` | Modify |
| `src/app/use-storage-backend.ts` | Load/save/broadcast the new state | Modify |
| `src/app/settings-menu.tsx` | `resources.workdayHours` in `Settings` + default + control | Modify |
| `src/app/use-settings.ts` | Merge the `resources` settings group on load | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New i18n keys | Modify |
| `src/app/workspace-section.tsx` | Pass `resources` to the panel | Modify |
| `src/app/resources-panel.tsx` | Minimal read-only resource list | Modify |
| `src/app/resources-panel.test.tsx` | Test the list renders | **New/Modify** |

**Commands:** run a single test file with `npx vitest run src/app/<file>.test.ts`. Run all with `npm run test:run`. Type-check with `npx tsc --noEmit`.

---

## Task 1: Domain types + presets + `resourceId`

**Files:**
- Modify: `src/app/types.ts` (append after the `Shift` block at end of file; add `resourceId?` to `Task` and `Absence`)

- [ ] **Step 1: Add `resourceId?` to `Task`**

In `src/app/types.ts`, inside `export type Task = { … }`, add after `localModifiedAt?: string;`:

```ts
  /** Resource Planner v2: stable link to a Resource. Additive — the
   *  free-text `assignee` remains the display value and the fallback join. */
  resourceId?: number;
```

- [ ] **Step 2: Add `resourceId?` to `Absence`**

Inside `export type Absence = { … }`, add after `localModifiedAt?: string;`:

```ts
  /** Resource Planner v2: stable link to a Resource (see Task.resourceId). */
  resourceId?: number;
```

- [ ] **Step 3: Append the new entity types at the end of the file**

```ts
// ----------------------------------------------------------------------------
// Resource Planner v2 — Resources, Roles (discipline × grade), planning window.
//
// First-class workspace entities. A Resource links to tasks/absences by
// `resourceId` (stable) and carries per-period utilization. A Role is a
// concrete discipline × grade combination that carries internal/external
// hourly rates. Discipline and Grade are editable, seeded reference lists.

export type Discipline = { id: number; name: string; localModifiedAt?: string };
export type Grade = { id: number; name: string; localModifiedAt?: string };

export const PRESET_DISCIPLINES = [
  "Developer",
  "Business Analyst",
  "Consultant",
  "Project Manager",
] as const;

export const PRESET_GRADES = [
  "Junior",
  "Associate",
  "Consultant",
  "Senior",
  "Lead",
  "Principal",
] as const;

export type Role = {
  id: number;
  disciplineId: number;
  gradeId: number;
  /** Cost per hour in the plan currency. */
  internalRate: number;
  /** Customer-billable per hour. */
  externalRate: number;
  localModifiedAt?: string;
};

export type UtilizationMode = "percent" | "hours";

export type Resource = {
  id: number;
  name: string;
  email?: string;
  /** FK -> Role.id; null when unassigned. */
  roleId: number | null;
  utilizationMode: UtilizationMode;
  /** periodKey ("2026-01" | "2026-W03") -> value (percent 0..100 or hours). */
  utilization: Record<string, number>;
  /** periodKey -> manual absence-hours override (auto-derived otherwise). */
  absenceOverride?: Record<string, number>;
  /** Soft archive; treated as true when absent. */
  active?: boolean;
  localModifiedAt?: string;
};

export type PlanGranularity = "week" | "month";

export type ResourcePlan = {
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  granularity: PlanGranularity; // canonical (editable) granularity
  currency: string; // ISO 4217
};

/** Default plan currency when none is set. */
export const DEFAULT_CURRENCY = "EUR";
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no usages yet; pure additions).

- [ ] **Step 5: Commit**

```bash
git add src/app/types.ts
git commit -m "feat(types): add Resource/Role/Discipline/Grade/ResourcePlan + resourceId"
```

---

## Task 2: Pure foundation helpers (`resource-foundation.ts`)

Seeding, default plan, and assignee→resource backfill — pure functions, no IndexedDB.

**Files:**
- Create: `src/app/resource-foundation.ts`
- Test: `src/app/resource-foundation.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/app/resource-foundation.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import {
  seedDisciplines,
  seedGrades,
  defaultResourcePlan,
  backfillResources,
} from "./resource-foundation";
import { PRESET_DISCIPLINES, PRESET_GRADES, type Task, type Absence } from "./types";

function task(id: number, assignee: string, email?: string): Task {
  return {
    id, taskName: `T${id}`, assignee, assigneeEmail: email ?? "",
    dueDate: "2026-01-10", lastUpdateDate: "2026-01-01",
    priority: "Medium", blockers: "", notes: "",
  };
}
function absence(id: number, assignee: string): Absence {
  return { id, assignee, startDate: "2026-01-05", endDate: "2026-01-06", type: "vacation" };
}

describe("seedDisciplines / seedGrades", () => {
  test("seed presets with 1-based ids", () => {
    const d = seedDisciplines();
    expect(d.map((x) => x.name)).toEqual([...PRESET_DISCIPLINES]);
    expect(d[0].id).toBe(1);
    expect(seedGrades().map((x) => x.name)).toEqual([...PRESET_GRADES]);
  });
});

describe("defaultResourcePlan", () => {
  test("spans the current month plus 11 months, monthly, EUR", () => {
    const plan = defaultResourcePlan("2026-05-23");
    expect(plan.startDate).toBe("2026-05-01");
    expect(plan.endDate).toBe("2027-04-30");
    expect(plan.granularity).toBe("month");
    expect(plan.currency).toBe("EUR");
  });
});

describe("backfillResources", () => {
  test("creates one resource per case-folded assignee and stamps resourceId", () => {
    const { resources, tasks, absences } = backfillResources(
      [task(1, "Alex Example", "Sample@x.io"), task(2, "Alex Example")],
      [absence(9, "Bob Lee")],
    );
    expect(resources).toHaveLength(2);
    const Sample = resources.find((r) => r.name === "Alex Example");
    expect(Sample?.email).toBe("Sample@x.io");
    expect(tasks[0].resourceId).toBe(Sample?.id);
    expect(tasks[1].resourceId).toBe(Sample?.id); // case-folded match
    expect(absences[0].resourceId).toBe(resources.find((r) => r.name === "Bob Lee")?.id);
  });

  test("ignores blank assignees and defaults role/mode", () => {
    const { resources, tasks } = backfillResources([task(1, "   ")], []);
    expect(resources).toHaveLength(0);
    expect(tasks[0].resourceId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/resource-foundation.test.ts`
Expected: FAIL — `Failed to resolve import "./resource-foundation"`.

- [ ] **Step 3: Implement `resource-foundation.ts`**

```ts
import {
  DEFAULT_CURRENCY,
  PRESET_DISCIPLINES,
  PRESET_GRADES,
  type Absence,
  type Discipline,
  type Grade,
  type Resource,
  type ResourcePlan,
  type Task,
} from "./types";

export function seedDisciplines(): Discipline[] {
  return PRESET_DISCIPLINES.map((name, i) => ({ id: i + 1, name }));
}

export function seedGrades(): Grade[] {
  return PRESET_GRADES.map((name, i) => ({ id: i + 1, name }));
}

/** Window = the calendar month containing `today` through +11 months. */
export function defaultResourcePlan(today: string): ResourcePlan {
  const d = new Date(`${today}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  const pad = (n: number) => String(n).padStart(2, "0");
  const startDate = `${y}-${pad(m + 1)}-01`;
  // Day 0 of month (m+12) === last day of month (m+11).
  const end = new Date(Date.UTC(y, m + 12, 0));
  const endDate = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
  return { startDate, endDate, granularity: "month", currency: DEFAULT_CURRENCY };
}

/**
 * Build one Resource per distinct case-folded assignee across tasks +
 * absences, preserving first-seen casing and first non-empty email, and
 * stamp `resourceId` onto each task/absence. Pure: returns NEW arrays.
 */
export function backfillResources(
  tasks: readonly Task[],
  absences: readonly Absence[],
): { resources: Resource[]; tasks: Task[]; absences: Absence[] } {
  const byKey = new Map<string, Resource>();
  let nextId = 1;
  const ensure = (rawName: string, rawEmail?: string): Resource | null => {
    const name = (rawName ?? "").trim();
    if (!name) return null;
    const key = name.toLowerCase();
    let r = byKey.get(key);
    if (!r) {
      r = {
        id: nextId++,
        name,
        email: rawEmail?.trim() || undefined,
        roleId: null,
        utilizationMode: "percent",
        utilization: {},
      };
      byKey.set(key, r);
    } else if (!r.email && rawEmail?.trim()) {
      r.email = rawEmail.trim();
    }
    return r;
  };
  const outTasks = tasks.map((t) => {
    const r = ensure(t.assignee, t.assigneeEmail);
    return r ? { ...t, resourceId: r.id } : t;
  });
  const outAbsences = absences.map((a) => {
    const r = ensure(a.assignee, a.assigneeEmail);
    return r ? { ...a, resourceId: r.id } : a;
  });
  return { resources: Array.from(byKey.values()), tasks: outTasks, absences: outAbsences };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/resource-foundation.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/resource-foundation.ts src/app/resource-foundation.test.ts
git commit -m "feat(resources): pure seeding, default plan, and assignee backfill"
```

---

## Task 3: Period-map codec + entity sanitizers (`sanitize.ts`)

**Files:**
- Modify: `src/app/sanitize.ts` (append after the Shift sanitizers)
- Test: `src/app/sanitize.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/app/sanitize.test.ts` (and add the imports to the existing top import block):

```ts
import {
  encodePeriodMap,
  decodePeriodMap,
  sanitizeResource,
  sanitizeRole,
  sanitizeDiscipline,
  sanitizeGrade,
} from "./sanitize";

describe("period map codec", () => {
  test("round-trips a map and drops invalid keys/values", () => {
    const map = { "2026-01": 80, "2026-W03": 12 };
    expect(decodePeriodMap(encodePeriodMap(map))).toEqual(map);
    expect(decodePeriodMap("2026-01=80|bad|2026-13=5|=7|2026-02=x")).toEqual({
      "2026-01": 80,
    });
  });
});

describe("sanitizeResource", () => {
  test("accepts an object map and clamps percent to 0..100", () => {
    const r = sanitizeResource({
      id: 3, name: "  Sample  ", roleId: 2, utilizationMode: "percent",
      utilization: { "2026-01": 150, "2026-02": -5 },
    });
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Sample");
    expect(r!.utilization).toEqual({ "2026-01": 100, "2026-02": 0 });
  });

  test("accepts an encoded-string map (CSV path) and defaults bad mode", () => {
    const r = sanitizeResource({
      id: 4, name: "Bob", roleId: null, utilizationMode: "nope",
      utilization: "2026-01=12.5", absenceOverride: "2026-01=8",
    });
    expect(r!.utilizationMode).toBe("percent");
    expect(r!.utilization).toEqual({ "2026-01": 12.5 });
    expect(r!.absenceOverride).toEqual({ "2026-01": 8 });
  });

  test("returns null without id or name", () => {
    expect(sanitizeResource({ name: "x" })).toBeNull();
    expect(sanitizeResource({ id: 1, name: "" })).toBeNull();
  });
});

describe("sanitizeRole / sanitizeDiscipline / sanitizeGrade", () => {
  test("role clamps negative rates to 0 and requires ids", () => {
    expect(sanitizeRole({ id: 1, disciplineId: 2, gradeId: 3, internalRate: -10, externalRate: 90 }))
      .toEqual({ id: 1, disciplineId: 2, gradeId: 3, internalRate: 0, externalRate: 90 });
    expect(sanitizeRole({ id: 1, disciplineId: 0, gradeId: 3 })).toBeNull();
  });
  test("discipline/grade need id + name", () => {
    expect(sanitizeDiscipline({ id: 2, name: " Dev " })).toEqual({ id: 2, name: "Dev" });
    expect(sanitizeGrade({ id: 0, name: "Junior" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/sanitize.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement the codec + sanitizers**

First add `Resource`, `Role`, `Discipline`, `Grade`, `UtilizationMode` to the type import at the top of `src/app/sanitize.ts`. Then append:

```ts
// --- Resource Planner v2 sanitizers ----------------------------------------

const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2]|W[0-4]\d|W5[0-3])$/;
const HOURS_MAP_MAX = 1000; // sane upper bound for a single period's hours

/** Encode a periodKey->number map to "k=v|k=v" (CSV/MD-safe). */
export function encodePeriodMap(map: Record<string, number> | undefined): string {
  if (!map) return "";
  return Object.entries(map)
    .filter(([k, v]) => PERIOD_KEY_RE.test(k) && Number.isFinite(v))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
}

/** Decode "k=v|k=v" back to a map; drops malformed keys/values. */
export function decodePeriodMap(s: unknown): Record<string, number> {
  if (typeof s !== "string" || !s) return {};
  const out: Record<string, number> = {};
  for (const part of s.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = Number(part.slice(eq + 1).trim());
    if (PERIOD_KEY_RE.test(key) && Number.isFinite(val)) out[key] = val;
  }
  return out;
}

/** Coerce a map input (object OR encoded string) into a clamped number map. */
function coercePeriodMap(input: unknown, clampMax: number): Record<string, number> {
  const raw = typeof input === "string" ? decodePeriodMap(input) : isPlainObject(input) ? input : {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!PERIOD_KEY_RE.test(k)) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = Math.min(clampMax, Math.max(0, n));
  }
  return out;
}

export function sanitizeUtilizationMode(s: unknown): UtilizationMode {
  return s === "hours" ? "hours" : "percent";
}

export function sanitizeResource(input: unknown): Resource | null {
  if (!isPlainObject(input)) return null;
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeAssignee(input.name);
  if (!name) return null;
  const mode = sanitizeUtilizationMode(input.utilizationMode);
  const roleId =
    typeof input.roleId === "number" && Number.isFinite(input.roleId) && input.roleId > 0
      ? input.roleId
      : null;
  const utilization = coercePeriodMap(input.utilization, mode === "percent" ? 100 : HOURS_MAP_MAX);
  const overrideRaw = coercePeriodMap(input.absenceOverride, HOURS_MAP_MAX);
  const resource: Resource = {
    id,
    name,
    email: typeof input.email === "string" ? sanitizeEmail(input.email) || undefined : undefined,
    roleId,
    utilizationMode: mode,
    utilization,
  };
  if (Object.keys(overrideRaw).length > 0) resource.absenceOverride = overrideRaw;
  if (input.active === false) resource.active = false;
  if (typeof input.localModifiedAt === "string") resource.localModifiedAt = input.localModifiedAt;
  return resource;
}

function sanitizeRate(n: unknown): number {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
}

export function sanitizeRole(input: unknown): Role | null {
  if (!isPlainObject(input)) return null;
  const id = Number(input.id);
  const disciplineId = Number(input.disciplineId);
  const gradeId = Number(input.gradeId);
  if (![id, disciplineId, gradeId].every((n) => Number.isFinite(n) && n > 0)) return null;
  const role: Role = {
    id,
    disciplineId,
    gradeId,
    internalRate: sanitizeRate(input.internalRate),
    externalRate: sanitizeRate(input.externalRate),
  };
  if (typeof input.localModifiedAt === "string") role.localModifiedAt = input.localModifiedAt;
  return role;
}

function sanitizeNamedRef<T extends { id: number; name: string; localModifiedAt?: string }>(
  input: unknown,
): T | null {
  if (!isPlainObject(input)) return null;
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(input.name, GROUP_MAX);
  if (!name) return null;
  const ref = { id, name } as T;
  if (typeof input.localModifiedAt === "string") ref.localModifiedAt = input.localModifiedAt;
  return ref;
}

export function sanitizeDiscipline(input: unknown): Discipline | null {
  return sanitizeNamedRef<Discipline>(input);
}

export function sanitizeGrade(input: unknown): Grade | null {
  return sanitizeNamedRef<Grade>(input);
}
```

> Note: `sanitizeText` is a private helper already defined in `sanitize.ts` — `sanitizeNamedRef` lives in the same file, so it has access. No export needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/sanitize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/sanitize.ts src/app/sanitize.test.ts
git commit -m "feat(sanitize): period-map codec + resource/role/discipline/grade sanitizers"
```

---

## Task 4: `Workspace` shape + v5 migration call (`storage.ts`)

Extend the persisted shape and centralize seeding/backfill in one pure migration function used by all backends.

**Files:**
- Modify: `src/app/storage.ts`
- Test: `src/app/storage-serialization.test.ts` (new)

- [ ] **Step 1: Write the failing migration test**

`src/app/storage-serialization.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { migrateWorkspaceV5, emptyWorkspace } from "./storage";
import type { Task } from "./types";

function task(id: number, assignee: string): Task {
  return {
    id, taskName: `T${id}`, assignee, assigneeEmail: "",
    dueDate: "2026-01-10", lastUpdateDate: "2026-01-01",
    priority: "Medium", blockers: "", notes: "",
  };
}

describe("migrateWorkspaceV5", () => {
  test("seeds disciplines/grades/plan and backfills resources from assignees", () => {
    const ws = migrateWorkspaceV5({
      ...emptyWorkspace(),
      tasks: [task(1, "Alex Example"), task(2, "Bob Lee")],
    });
    expect(ws.disciplines.map((d) => d.name)).toContain("Developer");
    expect(ws.grades.map((g) => g.name)).toContain("Principal");
    expect(ws.plan.granularity).toBe("month");
    expect(ws.resources).toHaveLength(2);
    expect(ws.tasks[0].resourceId).toBe(ws.resources.find((r) => r.name === "Alex Example")?.id);
  });

  test("is idempotent: existing resources are not rebuilt", () => {
    const seeded = migrateWorkspaceV5({ ...emptyWorkspace(), tasks: [task(1, "Alex Example")] });
    const again = migrateWorkspaceV5(seeded);
    expect(again.resources).toEqual(seeded.resources);
    expect(again.tasks[0].resourceId).toBe(seeded.tasks[0].resourceId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/storage-serialization.test.ts`
Expected: FAIL — `migrateWorkspaceV5` / `emptyWorkspace` not exported.

- [ ] **Step 3: Extend the `Workspace` type**

In `src/app/storage.ts`, replace the `Workspace` type and bump the schema version:

```ts
export type Workspace = {
  tasks: Task[];
  raid: RaidItem[];
  absences: Absence[];
  shifts: Shift[]; // dormant
  resources: Resource[];
  roles: Role[];
  disciplines: Discipline[];
  grades: Grade[];
  plan: ResourcePlan;
};

const SCHEMA_VERSION = 5;
```

Add the new types to the `./types` import and import the foundation/sanitizer helpers:

```ts
import {
  type Absence, type Discipline, type Grade, type Priority, type RaidCategory,
  type RaidItem, type RaidSeverity, type RaidStatus, type Resource, type ResourcePlan,
  type RiskScale, type Role, type Shift, type Task,
} from "./types";
import {
  backfillResources, defaultResourcePlan, seedDisciplines, seedGrades,
} from "./resource-foundation";
// add to the existing "./sanitize" import:
//   sanitizeDiscipline, sanitizeGrade, sanitizeResource, sanitizeRole, encodePeriodMap
```

- [ ] **Step 4: Add `emptyWorkspace()` and `migrateWorkspaceV5()`**

Add near the top of `storage.ts` (after the `Workspace` type):

```ts
/** A blank workspace with a default plan anchored to today. */
export function emptyWorkspace(): Workspace {
  return {
    tasks: [], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [],
    plan: defaultResourcePlan(new Date().toISOString().slice(0, 10)),
  };
}

/**
 * Idempotent v5 migration over a loaded workspace:
 *   - seeds discipline/grade reference lists when empty,
 *   - ensures a plan exists,
 *   - backfills resources from task/absence assignees the first time
 *     (when no resources are present yet), stamping resourceId.
 * Pure — no IndexedDB. Returns a new workspace; reuses arrays unchanged.
 */
export function migrateWorkspaceV5(ws: Workspace): Workspace {
  const disciplines = ws.disciplines.length ? ws.disciplines : seedDisciplines();
  const grades = ws.grades.length ? ws.grades : seedGrades();
  const plan = ws.plan ?? defaultResourcePlan(new Date().toISOString().slice(0, 10));
  let { tasks, absences, resources } = ws;
  if (resources.length === 0) {
    const built = backfillResources(tasks, absences);
    resources = built.resources;
    tasks = built.tasks;
    absences = built.absences;
  }
  return { ...ws, tasks, absences, resources, roles: ws.roles, disciplines, grades, plan };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/app/storage-serialization.test.ts`
Expected: PASS (2 tests). Type-check (`npx tsc --noEmit`) will still report errors where backends build the old 4-field `Workspace`; those are fixed in Tasks 5–6.

- [ ] **Step 6: Commit**

```bash
git add src/app/storage.ts src/app/storage-serialization.test.ts
git commit -m "feat(storage): v5 Workspace shape + pure migrateWorkspaceV5"
```

---

## Task 5: JSON + CSV + Markdown serialization for new entities

Round-trip the new entities through all three file formats. The dynamic `utilization` / `absenceOverride` maps serialize to one encoded cell each via the codec from Task 3.

**Files:**
- Modify: `src/app/storage.ts`
- Test: `src/app/storage-serialization.test.ts` (append)

- [ ] **Step 1: Write the failing round-trip tests**

Append to `src/app/storage-serialization.test.ts`:

```ts
import { workspaceToCsv, csvToWorkspace, workspaceToMarkdown, markdownToWorkspace } from "./storage";
import type { Resource, Role, Discipline, Grade } from "./types";

function sampleWorkspace() {
  const disciplines: Discipline[] = [{ id: 1, name: "Developer" }];
  const grades: Grade[] = [{ id: 1, name: "Senior" }];
  const roles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 90, externalRate: 180 }];
  const resources: Resource[] = [
    { id: 1, name: "Alex Example", email: "Sample@x.io", roleId: 1, utilizationMode: "percent",
      utilization: { "2026-01": 80, "2026-02": 100 }, absenceOverride: { "2026-01": 8 } },
  ];
  return {
    ...emptyWorkspace(), resources, roles, disciplines, grades,
    plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "USD" },
  };
}

describe("CSV round-trip (new entities)", () => {
  test("preserves resources/roles/disciplines/grades/plan", () => {
    const ws = sampleWorkspace();
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.resources).toEqual(ws.resources);
    expect(back.roles).toEqual(ws.roles);
    expect(back.disciplines).toEqual(ws.disciplines);
    expect(back.grades).toEqual(ws.grades);
    expect(back.plan).toEqual(ws.plan);
  });
});

describe("Markdown round-trip (new entities)", () => {
  test("preserves resources/roles/plan", () => {
    const ws = sampleWorkspace();
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.resources).toEqual(ws.resources);
    expect(back.roles).toEqual(ws.roles);
    expect(back.plan).toEqual(ws.plan);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/storage-serialization.test.ts`
Expected: FAIL — round-tripped arrays come back empty (no sections emitted/parsed yet).

- [ ] **Step 3: Add CSV encoders/decoders + section wiring**

In `storage.ts`, add column definitions and section markers near the existing ones:

```ts
const RESOURCES_CSV_COLUMNS = [
  "id", "name", "email", "roleId", "utilizationMode", "utilization", "absenceOverride", "active", "localModifiedAt",
] as const;
const ROLES_CSV_COLUMNS = ["id", "disciplineId", "gradeId", "internalRate", "externalRate", "localModifiedAt"] as const;
const REF_CSV_COLUMNS = ["id", "name", "localModifiedAt"] as const;

const CSV_SECTION_RESOURCES = "# RESOURCES";
const CSV_SECTION_ROLES = "# ROLES";
const CSV_SECTION_DISCIPLINES = "# DISCIPLINES";
const CSV_SECTION_GRADES = "# GRADES";
const CSV_SECTION_PLAN = "# PLAN";
```

Add field encoders (use `encodePeriodMap` from `./sanitize`):

```ts
function resourceFieldToString(r: Resource, c: string): string {
  switch (c) {
    case "id": return String(r.id);
    case "name": return r.name;
    case "email": return r.email ?? "";
    case "roleId": return r.roleId == null ? "" : String(r.roleId);
    case "utilizationMode": return r.utilizationMode;
    case "utilization": return encodePeriodMap(r.utilization);
    case "absenceOverride": return encodePeriodMap(r.absenceOverride);
    case "active": return r.active === false ? "false" : "";
    case "localModifiedAt": return r.localModifiedAt ?? "";
    default: return "";
  }
}
function rowsToCsv(header: readonly string[], rows: string[][]): string {
  return [header.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\r\n");
}
function resourcesToCsv(rs: readonly Resource[]): string {
  return rowsToCsv(RESOURCES_CSV_COLUMNS, rs.map((r) => RESOURCES_CSV_COLUMNS.map((c) => resourceFieldToString(r, c))));
}
function rolesToCsv(rs: readonly Role[]): string {
  return rowsToCsv(ROLES_CSV_COLUMNS, rs.map((r) => ROLES_CSV_COLUMNS.map((c) => String((r as Record<string, unknown>)[c] ?? ""))));
}
function refsToCsv(rs: readonly { id: number; name: string; localModifiedAt?: string }[]): string {
  return rowsToCsv(REF_CSV_COLUMNS, rs.map((r) => [String(r.id), r.name, r.localModifiedAt ?? ""]));
}
function planToCsvLine(p: ResourcePlan): string {
  return [CSV_SECTION_PLAN, [p.startDate, p.endDate, p.granularity, p.currency].map(csvEscape).join(",")].join("\r\n");
}
```

Extend `workspaceToCsv` to append the new sections when non-empty (and the plan always):

```ts
  if (ws.disciplines.length > 0) parts.push("", CSV_SECTION_DISCIPLINES, refsToCsv(ws.disciplines));
  if (ws.grades.length > 0) parts.push("", CSV_SECTION_GRADES, refsToCsv(ws.grades));
  if (ws.roles.length > 0) parts.push("", CSV_SECTION_ROLES, rolesToCsv(ws.roles));
  if (ws.resources.length > 0) parts.push("", CSV_SECTION_RESOURCES, resourcesToCsv(ws.resources));
  parts.push("", planToCsvLine(ws.plan));
```

Add a generic header-mapped CSV reader and decoders:

```ts
function csvRowsToObjects(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  let h = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length && rows[i][0].trim() !== "" && !rows[i][0].startsWith("#")) { h = i; break; }
  }
  if (h < 0) return [];
  const headers = rows[h];
  const out: Record<string, string>[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    if (rows[i].length === 1 && rows[i][0] === "") continue;
    const obj: Record<string, string> = {};
    headers.forEach((key, idx) => { obj[key] = rows[i][idx] ?? ""; });
    out.push(obj);
  }
  return out;
}
function csvToResources(csv: string): Resource[] {
  return csvRowsToObjects(csv).map((o) => sanitizeResource(o)).filter((r): r is Resource => r !== null);
}
function csvToRoles(csv: string): Role[] {
  return csvRowsToObjects(csv).map((o) => sanitizeRole(o)).filter((r): r is Role => r !== null);
}
function csvToDisciplines(csv: string): Discipline[] {
  return csvRowsToObjects(csv).map((o) => sanitizeDiscipline(o)).filter((d): d is Discipline => d !== null);
}
function csvToGrades(csv: string): Grade[] {
  return csvRowsToObjects(csv).map((o) => sanitizeGrade(o)).filter((g): g is Grade => g !== null);
}
function parsePlanLine(line: string): ResourcePlan | null {
  const cells = parseCsv(line)[0];
  if (!cells || cells.length < 4) return null;
  const granularity = cells[2] === "week" ? "week" : "month";
  return { startDate: cells[0], endDate: cells[1], granularity, currency: cells[3] || "EUR" };
}
```

Extend `splitCsvSections` to recognize the five new markers (add `resources/roles/disciplines/grades/plan` to its `mode` union and per-marker branches, collecting lines into new arrays), then rewrite `csvToWorkspace` to parse them and run the result through `migrateWorkspaceV5`:

```ts
function csvToWorkspace(csv: string): Workspace {
  const s = splitCsvSections(csv);
  const ws: Workspace = {
    tasks: csvToTasks(s.tasksText),
    raid: s.raidText.trim() ? csvToRaid(s.raidText) : [],
    absences: s.absencesText.trim() ? csvToAbsences(s.absencesText) : [],
    shifts: s.shiftsText.trim() ? csvToShifts(s.shiftsText) : [],
    resources: s.resourcesText.trim() ? csvToResources(s.resourcesText) : [],
    roles: s.rolesText.trim() ? csvToRoles(s.rolesText) : [],
    disciplines: s.disciplinesText.trim() ? csvToDisciplines(s.disciplinesText) : [],
    grades: s.gradesText.trim() ? csvToGrades(s.gradesText) : [],
    plan: (s.planText.trim() && parsePlanLine(s.planText)) || defaultResourcePlan(new Date().toISOString().slice(0, 10)),
  };
  return migrateWorkspaceV5(ws);
}
```

> Because `migrateWorkspaceV5` only backfills when `resources` is empty, a CSV that already carries resources round-trips untouched (the test asserts `toEqual`). Also add `resourceId` to `CSV_COLUMNS` (tasks) and `ABSENCES_CSV_COLUMNS`, and set it in the `csvToTasks`/`csvToAbsences` builders: `resourceId: Number(obj.resourceId) || undefined`.

- [ ] **Step 4: Mirror the same for Markdown and the JSON envelope**

- Add `resourcesToMarkdown` / `rolesToMarkdown` / ref tables and a `## Plan` block to `workspaceToMarkdown`; add `markdownToResources` etc. and extend `splitMarkdownSections` + `markdownToWorkspace` (then run `migrateWorkspaceV5`). Markdown column labels reuse the CSV column names; reuse the existing `splitMdRow` + header-map approach already used for absences/shifts.
- Add `resourceId` to `MD_COLUMNS` (tasks) and `ABSENCES_MD_COLUMNS`, decoded in the MD task/absence builders.
- In `LocalFileBackend.load()` JSON path and `save()` JSON envelope, add `resources/roles/disciplines/grades/plan`; in `load()`, sanitize the arrays (`.map(sanitizeResource).filter(...)` etc.) and run the parsed object through `migrateWorkspaceV5`. Replace the four-field empty-text returns with `emptyWorkspace()` and relax the `parsed`-shape guard so files missing the new fields still load (default to `[]` / seeded).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/app/storage-serialization.test.ts`
Expected: PASS (CSV + Markdown round-trips). Type-check: `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/app/storage.ts src/app/storage-serialization.test.ts
git commit -m "feat(storage): CSV/MD/JSON serialization for resources, roles, refs, plan"
```

---

## Task 6: IndexedDB schema v5 + BrowserBackend persistence

No new unit tests (jsdom has no IndexedDB and the repo doesn't mock it — the migration logic is already covered by Task 4). Verify by type-check and manual smoke test.

**Files:**
- Modify: `src/app/storage.ts`

- [ ] **Step 1: Bump IDB version + add stores**

```ts
const IDB_VERSION = 5;
const IDB_RESOURCES_STORE = "resources";
const IDB_ROLES_STORE = "roles";
const IDB_DISCIPLINES_STORE = "disciplines";
const IDB_GRADES_STORE = "grades";
const KV_PLAN_KEY = "resource-plan";
```

In `openIdb().onupgradeneeded`, add idempotent `createObjectStore(..., { keyPath: "id" })` for the four new stores (mirroring the existing `if (!db.objectStoreNames.contains(...))` blocks).

- [ ] **Step 2: Extend `BrowserBackend` baselines + `load()`**

Add baselines: `resourcesBaseline`, `rolesBaseline`, `disciplinesBaseline`, `gradesBaseline` (all `new Map<number, …>()`). In `load()`, after the existing `idbGetAll` calls, read the four new stores and the plan kv, assemble a raw `Workspace`, run it through `migrateWorkspaceV5`, and — when the loaded `resources` store was empty (so backfill/seed ran) — persist the result so `resourceId`/seeds stick:

```ts
const raw: Workspace = {
  tasks, raid, absences, shifts,
  resources: await idbGetAll<Resource>(IDB_RESOURCES_STORE),
  roles: await idbGetAll<Role>(IDB_ROLES_STORE),
  disciplines: await idbGetAll<Discipline>(IDB_DISCIPLINES_STORE),
  grades: await idbGetAll<Grade>(IDB_GRADES_STORE),
  plan: (await idbGet<ResourcePlan>(KV_PLAN_KEY)) ?? defaultResourcePlan(new Date().toISOString().slice(0, 10)),
};
const ranMigration = raw.resources.length === 0; // backfill/seed will run
const ws = migrateWorkspaceV5(raw);
if (ranMigration) {
  try {
    await idbBulkUpdate(IDB_RESOURCES_STORE, ws.resources, []);
    await idbBulkUpdate(IDB_DISCIPLINES_STORE, ws.disciplines, []);
    await idbBulkUpdate(IDB_GRADES_STORE, ws.grades, []);
    await idbBulkUpdate(IDB_TASKS_STORE, ws.tasks, []); // resourceId stamped
    await idbBulkUpdate(IDB_ABSENCES_STORE, ws.absences, []);
    await idbSet(KV_PLAN_KEY, ws.plan);
  } catch { /* non-fatal: retried next load */ }
}
// set ALL baselines (incl. the four new) from ws, then `return ws;`
```

Update `migrateLegacyIfNeeded()`'s return objects and the `load()` `typeof window === "undefined"` guard to use `emptyWorkspace()` so they carry the new fields.

- [ ] **Step 3: Extend `BrowserBackend.save()`**

Diff and write the four new stores, write the plan kv, and refresh the four new baselines:

```ts
const resourceDelta = this.diff(this.resourcesBaseline, ws.resources);
const roleDelta = this.diff(this.rolesBaseline, ws.roles);
const discDelta = this.diff(this.disciplinesBaseline, ws.disciplines);
const gradeDelta = this.diff(this.gradesBaseline, ws.grades);
await idbBulkUpdate(IDB_RESOURCES_STORE, resourceDelta.puts, resourceDelta.deletes);
await idbBulkUpdate(IDB_ROLES_STORE, roleDelta.puts, roleDelta.deletes);
await idbBulkUpdate(IDB_DISCIPLINES_STORE, discDelta.puts, discDelta.deletes);
await idbBulkUpdate(IDB_GRADES_STORE, gradeDelta.puts, gradeDelta.deletes);
await idbSet(KV_PLAN_KEY, ws.plan);
this.resourcesBaseline = new Map(ws.resources.map((r) => [r.id, r]));
this.rolesBaseline = new Map(ws.roles.map((r) => [r.id, r]));
this.disciplinesBaseline = new Map(ws.disciplines.map((d) => [d.id, d]));
this.gradesBaseline = new Map(ws.grades.map((g) => [g.id, g]));
```

- [ ] **Step 4: Type-check + run full suite**

Run: `npx tsc --noEmit && npm run test:run`
Expected: PASS (no `Workspace`-shape errors remain).

- [ ] **Step 5: Manual smoke test**

Run `npm run dev`, open the app with existing tasks, confirm no console errors and (via DevTools → Application → IndexedDB → `lop-app`) that `resources`, `roles`, `disciplines`, `grades` stores exist and `resources` is populated from your assignees.

- [ ] **Step 6: Commit**

```bash
git add src/app/storage.ts
git commit -m "feat(storage): IndexedDB v5 stores + BrowserBackend resource persistence"
```

---

## Task 7: Workspace context + storage-backend wiring

**Files:**
- Modify: `src/app/workspace-context.tsx`, `src/app/use-storage-backend.ts`

- [ ] **Step 1: Extend `WorkspaceValue` + provider**

In `workspace-context.tsx`, import the new types, add to `WorkspaceValue`:

```ts
  resources: Resource[];
  setResources: Dispatch<SetStateAction<Resource[]>>;
  roles: Role[];
  setRoles: Dispatch<SetStateAction<Role[]>>;
  disciplines: Discipline[];
  setDisciplines: Dispatch<SetStateAction<Discipline[]>>;
  grades: Grade[];
  setGrades: Dispatch<SetStateAction<Grade[]>>;
  plan: ResourcePlan;
  setPlan: Dispatch<SetStateAction<ResourcePlan>>;
```

In `WorkspaceProvider`, add the state (`useState<Resource[]>([])`, etc.; `const [plan, setPlan] = useState<ResourcePlan>(() => defaultResourcePlan(new Date().toISOString().slice(0, 10)))` — import `defaultResourcePlan` from `./resource-foundation`) and include all in the `value` object.

- [ ] **Step 2: Wire load/save/broadcast in `use-storage-backend.ts`**

- Destructure the new state + setters from `useWorkspace()`.
- In the load effect, after `setShifts(...)`: `setResources(workspace.resources ?? []); setRoles(workspace.roles ?? []); setDisciplines(workspace.disciplines ?? []); setGrades(workspace.grades ?? []); if (workspace.plan) setPlan(workspace.plan);`
- In the save effect and the `onPickStorageFile` save call, change the payload to `{ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan }` and add `resources/roles/disciplines/grades/plan` to the save effect's dependency array.
- Add broadcast hooks: `useBroadcastSync("resources", resources, setResources);` and the same for `roles`/`disciplines`/`grades`. (Plan is a singleton; skip broadcast for Phase 1.)

- [ ] **Step 3: Type-check + run suite**

Run: `npx tsc --noEmit && npm run test:run`
Expected: PASS. Existing `workspace-context`/`use-storage-backend` tests may need the new context fields — update their mock/provider setup to include the new state (default empty arrays + a default plan).

- [ ] **Step 4: Commit**

```bash
git add src/app/workspace-context.tsx src/app/use-storage-backend.ts src/app/*.test.tsx
git commit -m "feat(workspace): thread resources/roles/refs/plan through context + storage"
```

---

## Task 8: `workdayHours` setting

**Files:**
- Modify: `src/app/settings-menu.tsx`, `src/app/use-settings.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/use-settings.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/app/use-settings.test.ts` (existing), add a test that mirrors the file's existing hook-render harness:

```ts
test("defaults resources.workdayHours to 8", () => {
  // render the hook with empty localStorage using the file's existing setup
  expect(result.current.settings.resources.workdayHours).toBe(8);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/use-settings.test.ts`
Expected: FAIL — `resources` undefined on settings.

- [ ] **Step 3: Add to `Settings` + default + merge**

In `settings-menu.tsx`:

```ts
// in the Settings type:
  resources: { workdayHours: number };
// in defaultSettings:
  resources: { workdayHours: 8 },
```

In `use-settings.ts`, add to the `merged` object (alongside `popout`):

```ts
            resources: {
              ...defaultSettings.resources,
              ...(isPlainObject(parsed.resources) ? parsed.resources : {}),
            },
```

- [ ] **Step 4: Add the UI control + i18n**

In `settings-menu.tsx`, near the popout checkbox, add a number input bound to `settings.resources.workdayHours` (clamp 1–24) using a new i18n key `resourcesWorkdayHours`. Add the key to `i18n.ts` (`resourcesWorkdayHours: "Hours per work day"`) and `i18n.de.ts` (`resourcesWorkdayHours: "Stunden pro Arbeitstag"`).

```tsx
<label className="flex items-center justify-between gap-2">
  <span className="text-sm text-AIPM-dark-grey dark:text-AIPM-light-grey">
    {t(lang, "resourcesWorkdayHours")}
  </span>
  <input
    type="number" min={1} max={24} step={0.5}
    value={settings.resources.workdayHours}
    onChange={(e) => {
      const n = Math.min(24, Math.max(1, Number(e.target.value) || 8));
      onChange({ ...settings, resources: { ...settings.resources, workdayHours: n } });
    }}
    className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
  />
</label>
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/app/use-settings.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-menu.tsx src/app/use-settings.ts src/app/i18n.ts src/app/i18n.de.ts src/app/use-settings.test.ts
git commit -m "feat(settings): add resources.workdayHours (default 8)"
```

---

## Task 9: Minimal read-only resource list

Surfaces the migrated resources so Phase 1 is verifiable in the UI — no editing yet.

**Files:**
- Modify: `src/app/workspace-section.tsx`, `src/app/resources-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/resources-panel.test.tsx` (new or extend)

- [ ] **Step 1: Write the failing test**

`src/app/resources-panel.test.tsx` (follow `test-providers.tsx` / existing panel tests for render setup):

```tsx
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResourcesPanel } from "./resources-panel";
import type { Resource } from "./types";

const resources: Resource[] = [
  { id: 1, name: "Alex Example", roleId: null, utilizationMode: "percent", utilization: {} },
];

test("renders the resource name in the list view", () => {
  render(
    <ResourcesPanel
      lang="en-US" tasks={[]} absences={[]} shifts={[]} resources={resources}
      today="2026-05-23" holidaySet={new Set()}
      onAddAbsence={() => {}} onEditAbsence={() => {}} onEditShift={() => {}}
    />,
  );
  expect(screen.getByText("Alex Example")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/resources-panel.test.tsx`
Expected: FAIL — `resources` is not a prop / name not rendered.

- [ ] **Step 3: Add the `resources` prop + render**

In `resources-panel.tsx`, add `resources: readonly Resource[]` to `Props` (import `Resource`), and in the `list` view render a small read-only roster above the existing derived table:

```tsx
{resources.length > 0 && (
  <ul className="mb-3 flex flex-wrap gap-2">
    {resources.map((r) => (
      <li key={r.id} className="rounded-md border border-zinc-200 px-2 py-0.5 text-xs text-AIPM-dark-grey dark:border-zinc-800 dark:text-AIPM-light-grey">
        {r.name}
        {r.roleId == null && (
          <span className="ml-1 text-AIPM-medium-grey italic">{t(lang, "resourcesUnassignedRole")}</span>
        )}
      </li>
    ))}
  </ul>
)}
```

Add i18n key `resourcesUnassignedRole` ("no role" / "keine Rolle") to both dicts.

- [ ] **Step 4: Pass `resources` from `workspace-section.tsx`**

Add `resources` to the `useWorkspace()` destructure and pass `resources={resources}` to `<ResourcesPanel … />`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/app/resources-panel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/resources-panel.tsx src/app/workspace-section.tsx src/app/resources-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): minimal read-only resource roster in Resources tab"
```

---

## Final Verification

- [ ] Run the whole suite: `npm run test:run` — all green.
- [ ] Type-check: `npx tsc --noEmit` — clean.
- [ ] Coverage: `npm run test:coverage` — new pure modules (`resource-foundation.ts`, the new sanitizers) ≥ 80%.
- [ ] Smoke test `npm run dev`: existing data still loads; IndexedDB shows the new stores populated; the resource roster lists prior assignees; the work-day-hours setting persists across reload.

---

## Self-Review

**Spec coverage (Phase 1 items):** types ✓ (T1); presets ✓ (T1); `resourceId` additive migration ✓ (T2/T4/T6); schema v5 + new IDB stores + baselines ✓ (T6); CSV/MD sections + plan kv ✓ (T5/T6); sanitizers ✓ (T3); seeding ✓ (T2/T4); `workdayHours` setting ✓ (T8); workspace-context wiring ✓ (T7); migration/round-trip/sanitizer tests ✓ (T2/T3/T4/T5); basic resource list ✓ (T9). Currency lives on `ResourcePlan` (T1/T5) per the latest spec decision.

**Type consistency:** `migrateWorkspaceV5`/`emptyWorkspace`/`backfillResources`/`defaultResourcePlan`/`seedDisciplines`/`seedGrades` names are used identically across tasks. `Resource.utilization`/`absenceOverride` are `Record<string, number>`; the codec (`encodePeriodMap`/`decodePeriodMap`) and `sanitizeResource` agree on that shape and the `"k=v|k=v"` encoding. The `Workspace` field set (`resources/roles/disciplines/grades/plan`) is identical in storage, context, and serialization.

**Placeholder scan:** Tasks 5 (Markdown/JSON mirror), 8 (test harness), and 9 (render setup) say "follow the existing pattern" rather than re-pasting large existing scaffolds — intentional, because that code is mechanical mirroring of code shown earlier in the same task or already present in the file. All net-new functions are given in full.

**Note for the implementer:** Task 5's Markdown/JSON mirror and Task 6's IDB wiring are the largest steps; if a step exceeds ~15 minutes, split it (e.g., CSV before Markdown) and commit between.
