# Resource Utilization, Roles & Cost Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this into a phased implementation plan, then superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. This spec covers the whole feature; the plan sequences it into the phases in [Phased Build Order](#phased-build-order).

**Goal:** Turn the Resources tab from a derived, read-only view of assignees into a first-class capacity & cost planner. Add persisted **Resource** entries with a two-dimensional **Role** (discipline × grade) carrying internal/external rates, a **per-period utilization** grid that computes capacity from workdays (net of holidays and absences), and a **pop-out resources report** showing capacity and internal/external cost. This is the foundation for the project budget planner that comes later.

---

## Motivation

Today the Resources panel (`resources-panel.tsx`) derives per-assignee rows by aggregating `tasks` + `absences` + `shifts`, joined on a case-folded free-text name. There is no way to add a resource directly, no notion of role/rate, and no capacity or cost calculation. The reference spreadsheet (`docs/patterns/Book1.xlsx`) models exactly what's wanted: per-person, per-month **capacity = utilization × (workdays − absence)**, grouped by role with per-role hourly rates rolled up into a planned budget. This spec ports that model into the app, reusing the existing holiday and absence data.

The current per-weekday `Shift` was a stopgap; **utilization fully replaces it for capacity**. `Shift` is left dormant (not deleted) and a richer scheduling feature will return later as its own slice.

---

## Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Resource entity model | First-class entity with a **stable id**; tasks/absences link by id (Approach A migration). |
| 2 | Capacity source | **Utilization supersedes Shift.** Capacity = utilization × (workdays in window × work-day length) − absences. |
| 3 | Utilization shape | **Per-period values** (varies by period, like the Excel's monthly factors). |
| 4 | Planning horizon | **Explicit start + end window** (workspace-level), periods generated at the canonical granularity. |
| 5 | Week/month toggle | **One canonical granularity is editable; the other is a read-only re-bucketed rollup.** Default canonical = month. |
| 6 | Percent vs flat | Chosen **per resource** (`utilizationMode`); only the value varies per period. |
| 7 | Role / rate storage | **Workspace data** (travels with the saved file/backend). |
| 8 | Absence reduction | **Auto from the Absence entity, with manual per-period override.** |
| 9 | Spec scope | **One comprehensive design**, phased build order. |
| 10 | Role dimensions | **Two dimensions:** Discipline × Grade. A Role is a concrete combination carrying rates. |
| 11 | Grade naming clash | **Keep both lists as-is** ("Consultant" may appear as both a discipline and a grade; lists are editable). |
| 12 | Hours-mode absence | **Subtract auto-absences in hours mode too**, with the per-period override as escape hatch. |

Internal calculation unit is **hours** (work-day length is in hours; rates are per-hour). Days are displayed as `hours ÷ workdayHours`.

---

## Data Model

New types in `types.ts`. All ids are monotonic per entity (`Math.max(...ids)+1`), matching tasks/raid/absences/shifts.

```ts
// --- Role dimensions (workspace reference lists, editable + seeded) ---
export type Discipline = { id: number; name: string; localModifiedAt?: string };
export type Grade      = { id: number; name: string; localModifiedAt?: string };

export const PRESET_DISCIPLINES = [
  "Developer", "Business Analyst", "Consultant", "Project Manager",
] as const;
export const PRESET_GRADES = [
  "Junior", "Associate", "Consultant", "Senior", "Lead", "Principal",
] as const;

// --- Role = a concrete discipline × grade combo carrying rates ---
// Unique per (disciplineId, gradeId). Created on demand when a resource is
// assigned a combo that has no Role yet (rates default to 0).
export type Role = {
  id: number;
  disciplineId: number;
  gradeId: number;
  internalRate: number;   // cost per hour, in the workspace currency
  externalRate: number;   // customer-billable per hour
  localModifiedAt?: string;
};

// --- Resource = first-class workspace entity, stable id ---
export type UtilizationMode = "percent" | "hours";

export type Resource = {
  id: number;
  name: string;
  email?: string;
  roleId: number | null;                     // FK -> Role.id; null = unassigned
  utilizationMode: UtilizationMode;          // per resource
  utilization: Record<string, number>;       // periodKey -> value
  absenceOverride?: Record<string, number>;  // periodKey -> manual absence HOURS
  active?: boolean;                           // soft archive; default true
  localModifiedAt?: string;
};

// --- ResourcePlan = workspace singleton: the planning window ---
export type PlanGranularity = "week" | "month";
export type ResourcePlan = {
  startDate: string;            // "YYYY-MM-DD"
  endDate: string;              // "YYYY-MM-DD"
  granularity: PlanGranularity; // canonical (editable) granularity; default "month"
  currency: string;             // ISO 4217, default "EUR" — per-plan/contract
};
```

- `utilization` values are **percent (0–100)** when `utilizationMode === "percent"`, or **hours** when `"hours"`.
- **Period keys:** month = `"YYYY-MM"` (e.g. `2026-01`); week = ISO week `"GGGG-Www"` (e.g. `2026-W03`). A helper module owns key generation/parsing.
- `roleId` references a `Role`; the displayed role label is `` `${discipline} ${grade}` `` (e.g. "Developer Junior", "Consultant Senior").
- A resource's discipline/grade is reached via its `Role`. Picking a discipline+grade in the UI resolves to an existing `Role` or creates one (rates 0).

### Workspace shape

`Workspace` (in `storage.ts`) gains `resources`, `roles`, `disciplines`, `grades`, and `plan`:

```ts
export type Workspace = {
  tasks: Task[];
  raid: RaidItem[];
  absences: Absence[];
  shifts: Shift[];          // dormant
  resources: Resource[];    // new
  roles: Role[];            // new
  disciplines: Discipline[];// new
  grades: Grade[];          // new
  plan: ResourcePlan;       // new (singleton)
};
```

### Settings (global)

Add to the `Settings` type / `defaultSettings` (`settings-menu.tsx`), merged in `use-settings.ts` like the other nested groups:

```ts
resources: {
  workdayHours: number;   // default 8
};
```

Work-day length is an org-level standard (Settings). The planning window, canonical granularity, and **currency** are plan data (Workspace, on `ResourcePlan`) so different contracts can bill in different currencies.

---

## Persistence & Migration

Follows the established **additive, versioned** pattern used for absences (v3) and shifts (v4).

### Schema bump v4 → v5

- `SCHEMA_VERSION` and `IDB_VERSION` → **5**.
- `openIdb().onupgradeneeded` idempotently creates new `keyPath:"id"` object stores: `resources`, `roles`, `disciplines`, `grades`. The `plan` singleton is stored in the existing `kv` store under a fixed key (`"resource-plan"`), since it is not a record set.
- `BrowserBackend.load()/save()` read/write the new record stores and diff by reference identity (new baselines `resourcesBaseline`, `rolesBaseline`, `disciplinesBaseline`, `gradesBaseline`). `plan` is read/written via `idbGet`/`idbSet`.
- CSV/Markdown round-trip gains four new sections (`# RESOURCES`, `# ROLES`, `# DISCIPLINES`, `# GRADES`) plus a `# PLAN` line, emitted only when non-empty, mirroring the existing section split logic. The dynamic `utilization` / `absenceOverride` maps serialize into a single encoded cell each: `2026-01=80|2026-02=100`. New sanitizers (`sanitizeResource`, `sanitizeRole`, `sanitizeDiscipline`, `sanitizeGrade`) live in `sanitize.ts`, validating ids, clamping rates ≥ 0 and percents to 0–100.

### Migration (Approach A — additive, non-destructive)

- Add `resourceId?: number` to `Task` and `Absence` in `types.ts` and to their CSV/MD column lists.
- **Backfill** runs once when `resources` is empty but tasks/absences exist (analogous to `migrateLegacyIfNeeded`):
  1. Collect distinct case-folded assignee names across tasks + absences; preserve first-seen original casing and first non-empty email.
  2. Create a `Resource` per distinct name (`roleId: null`, `utilizationMode: "percent"`, empty `utilization`).
  3. Set `task.resourceId` / `absence.resourceId` to the matching resource id.
- **Seed** `disciplines`, `grades` from the presets, and a default `plan` (start = first day of current month, end = +11 months, granularity `"month"`, currency `"EUR"`) when absent. `roles` start empty (created on demand).
- The `assignee` / `assigneeEmail` strings **remain** on Task/Absence as the display value, the Jira-sync field, the filter/search key, and the fallback join for any row whose `resourceId` is unset. `resourceId` is authoritative when present.

> Rejected alternative (B): replace the free-text name with `resourceId` across the task form, filters, search index, Gantt, Jira sync, contacts, and exports. Single source of truth, but ~10-module blast radius and Jira persists assignee as text. Approach A delivers stable-ID linkage without that risk.

---

## Capacity Engine

A new pure module `resource-capacity.ts` (no React) with unit-testable functions. Holiday handling reuses the weekday/holiday logic already in `due-dates.ts` (weekends = Sat/Sun non-working; `holidaySet` membership excludes a date).

For a `(resource, period)`:

```
workdays      = count of dates in (period ∩ plan window) that are Mon–Fri and ∉ holidaySet
possibleHours = workdays × workdayHours
absenceHours  = absenceOverride[periodKey]  (if set)
              | else  (resource absence workdays in period × workdayHours)
                       // absence workdays = dates in the resource's Absence ranges
                       //   that are Mon–Fri and ∉ holidaySet
capacityHours =
   percent mode: (util / 100) × max(0, possibleHours − absenceHours)
   hours   mode: max(0, util − absenceHours)
capacityDays  = capacityHours / workdayHours
```

**Golden fixture (from `Book1.xlsx`, Forecast row 4 — Andre Weiß, month 1):**
util 95%, workdays 20, absence 5.5 days, workdayHours 8 →
`possibleHours = 160`, `absenceHours = 44`, `capacityHours = 0.95 × 116 = 110.2`, `capacityDays = 13.775`. Matches the sheet's `D4 = 13.775`. The whole-team monthly budget (`B18 = 40555.2`) is reproduced by `Σ capacityHours × rate` — these become engine test cases.

### Week/month rollup (read-only non-canonical view)

- canonical **month**, viewing **weeks**: each week's capacity is derived by applying the owning month's utilization/mode to that week's own workdays (percent: `(util/100) × (weekPossible − weekAbsence)`; hours: month flat hours distributed across the month's weeks proportionally to each week's workdays). Read-only.
- canonical **week**, viewing **months**: a month's capacity = Σ of the weeks falling in it.
- Changing the canonical granularity is an explicit action (re-keys `utilization`); values do not silently convert.

---

## Cost Model

Per `(resource, period)`, using the resource's `Role`:

```
internalCost = capacityHours × role.internalRate
externalCost = capacityHours × role.externalRate
margin       = externalCost − internalCost
```

Rolled up across periods, per resource, per discipline, per grade, and per role combo. Unassigned resources (`roleId: null`) contribute capacity but zero cost and are flagged in the report. Formatting via `Intl.NumberFormat(locale, { style: "currency", currency: plan.currency })`.

---

## UI — Resources Tab

`resources-panel.tsx` gains a third view in the existing `list / calendar` `SegmentedControl`: **"planning"**.

- **Planning grid:** rows = active resources, columns = periods at the canonical granularity. Each cell is a utilization input (percent or hours per the row's `utilizationMode`). Leading columns: name, role (discipline + grade picker), mode toggle. A trailing per-row total (capacity days/hours) and, once Phase 4 lands, cost.
- **Header controls:**
  - Week/month toggle — canonical view is editable; the other is the read-only rollup.
  - Planning-window date-range control (binds to `plan.startDate` / `plan.endDate`).
  - **"+ Add resource"** inline-add row at the bottom of the grid, reusing the inline-add pattern from `2026-05-22-inline-add-rows-design.md` (native `<button>`, dashed border).
  - **"Manage roles"** button → roles modal.
  - **"Report"** button → `openPopoutWindow("resource-report", settings.popout.reuseWindow)`.
- **Roles modal** (`roles-modal.tsx`, via `AppModals`): a discipline × grade rate grid. Each row is a Role combo with editable internal/external rate; add a combo by picking discipline + grade; manage the discipline and grade lists (add custom, rename). Presets are seeded and editable.

The existing `list` and `calendar` views keep working; they migrate from deriving rows off `tasks/absences/shifts` to listing `resources` (with task/absence aggregation joined by `resourceId`, falling back to name).

---

## Report Pop-out

New popout target `"resource-report"` registered in `broadcast-sync.ts` and rendered by `WorkspaceSection` in `isPopout` mode (mirroring the `reports` tab; it is report-only, not a main tab). New read-only `resources-report.tsx` (styled like `reports.tsx` — `Tile`, `Section`, tables):

- **Summary tiles:** total capacity (days + hours) over the window, total internal cost, total external cost, total margin.
- **Per-period table:** period | capacity (days/h) | internal | external | margin.
- **Per-discipline, per-grade, and per-combo breakdowns:** headcount, capacity, internal, external.
- **Per-resource table:** resource | role | avg utilization | capacity | internal | external; unassigned-role resources flagged.
- Honors the week/month rollup toggle.

---

## Files

| File | Change |
|------|--------|
| `src/app/types.ts` | Add `Discipline`, `Grade`, `Role`, `Resource`, `UtilizationMode`, `ResourcePlan`, presets; add `resourceId?` to `Task`/`Absence` |
| `src/app/storage.ts` | Schema v5: stores, baselines, CSV/MD sections, `plan` kv, migration + seeding |
| `src/app/sanitize.ts` | `sanitizeResource/Role/Discipline/Grade` + map encode/decode helpers |
| `src/app/settings-menu.tsx` | `resources: { workdayHours }` in `Settings` + `defaultSettings` + UI control |
| `src/app/use-settings.ts` | Merge the new `resources` settings group on load |
| `src/app/workspace-context.tsx` | Expose `resources/roles/disciplines/grades/plan` + setters |
| `src/app/use-resource-planner.ts` | CRUD handlers for resources/roles/disciplines/grades/plan |
| `src/app/resource-capacity.ts` | **New.** Pure capacity/cost/period engine |
| `src/app/resources-panel.tsx` | Planning view, grid, header controls, inline-add, list/calendar migration to `resourceId` |
| `src/app/roles-modal.tsx` | **New.** Discipline × grade rate grid + list management |
| `src/app/resources-report.tsx` | **New.** Read-only report panel |
| `src/app/app-modals.tsx` | Wire roles modal |
| `src/app/broadcast-sync.ts` | Register `"resource-report"` popout target |
| `src/app/workspace-section.tsx` | Render report popout; pass new props |
| `src/app/i18n.ts`, `i18n.de.ts` | New keys (resources, roles, grades, report) |

---

## Phased Build Order

Each phase is a self-contained plan slice with its own tests; later phases depend on earlier ones.

1. **Foundation** — types (`Discipline/Grade/Role/Resource/ResourcePlan`, `resourceId`), schema v5 (stores, CSV/MD, sanitizers, `plan` kv), additive migration + preset/plan seeding, settings (`workdayHours`, `currency`), workspace-context wiring. Migration + round-trip + sanitizer tests. No user-visible behavior change beyond plumbing and a resource list.
2. **Roles & rates manager** — `roles-modal.tsx`, discipline/grade list management, on-demand Role creation, role assignment on a resource. Tests.
3. **Utilization grid + capacity engine** — `resource-capacity.ts`, planning view, window/granularity controls, auto+override absences, week/month rollup. Engine unit tests seeded with the `Book1.xlsx` figures.
4. **Cost layer** — internal/external cost + margin in the grid and per-row/column totals.
5. **Report pop-out** — `resources-report.tsx` + `broadcast-sync`/`WorkspaceSection` wiring. Tests.

---

## Testing

Vitest + Testing Library, following existing `*.test.tsx` + `test-providers.tsx` patterns; target the repo's 80% coverage.

- **Capacity/cost engine** (`resource-capacity.test.ts`): pure-function unit tests with `Book1.xlsx` numbers as golden fixtures — Andre month 1 = 13.775 days; team monthly budget = 40 555.2; percent vs hours mode; absence auto vs override; week↔month rollup; holiday and weekend exclusion; empty/zero edge cases.
- **Storage** (`storage` tests): v4→v5 migration backfills `resourceId` and seeds disciplines/grades/plan; CSV/MD round-trip preserves resources/roles/maps; sanitizers reject malformed rows and clamp rates/percents.
- **Components:** roles modal CRUD + on-demand combo creation; planning grid edits update utilization; inline-add creates a resource; report renders summary/breakdowns and honors the rollup toggle.

---

## Deferred / Out of Scope

- **Project budget planner** (allocating resource capacity to planned work, plan-vs-booked variance). The `Book1.xlsx` "booked vs planned vs maximum" comparison needs effort actuals the app does not yet track.
- **Richer Shift/scheduling** feature (the dormant `Shift` entity returns later as its own slice).
- Multi-role resources (a resource holds exactly one `Role`).
