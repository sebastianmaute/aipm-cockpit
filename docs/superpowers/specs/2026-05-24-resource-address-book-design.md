# Resource Address Book Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this into a phased implementation plan, then superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. This spec covers the whole feature; the plan sequences it into the phases in [Phased Build Order](#phased-build-order).

**Goal:** Turn `Resource` into a first-class **address-book contact** with rich attributes, split the Resources pane into four top-level tabs (**Directory · Workload · Calendar · Planning**), let users add and edit resources through a modal (reachable inline and from a dedicated **pop-out window**), and add a **birthday reminder** (top banner + load-time toast) with a configurable lead time.

This builds directly on the Resource Utilization feature ([`2026-05-23-resource-utilization-design.md`](2026-05-23-resource-utilization-design.md)), which introduced the persisted `Resource` entity, `Role` (discipline × grade), and the utilization/cost planner.

---

## Motivation

Today the Resources pane (`resources-panel.tsx`, ~600 lines) shows, inside its **List** view, two stacked things:

1. a *roster* — a `<ul>` of resources with inline discipline/grade `<select>`s (driven by `resources[]`), and
2. a *stats table* below it — per-assignee open/overdue counts and upcoming absences, **aggregated from free-text task/absence/shift assignee names** (not from `resources[]`).

A `Resource` carries only `name, email?, roleId, utilization…, active?`. There is no way to record who a person actually is (title, phone, department, birthday…), no dedicated add flow, and the two lists are crammed into one scrolling view. This spec promotes `Resource` to a proper contact record, separates the two concerns into their own tabs, and adds the address-book affordances (add, edit, pop-out) plus birthday reminders.

---

## Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Name model | **Replace `name` with `firstName` + `lastName`.** Display name derived as `` `${firstName} ${lastName}`.trim() ``. Existing `name` migrates by splitting on the first space. |
| 2 | Pane layout | **Flatten to four top tabs:** Directory \| Workload \| Calendar \| Planning. The old "List" view splits into Directory (roster) and Workload (stats). |
| 3 | Discipline/grade editing | Stays **inline in the Directory table** (selects), preserving today's quick-assign UX. The full record is edited in the modal. |
| 4 | Edit trigger | **Clicking the resource's name** in the Directory table opens the edit modal. |
| 5 | Add flow | **+ Add resource** button opens the edit modal in create mode (fresh id). |
| 6 | Pop-out | A dedicated **address-book pop-out** (`?popout=address-book`) renders the Directory and supports add/edit, reusing the existing popout + BroadcastChannel infrastructure. |
| 7 | Workload data source | **Key off managed resources.** Rows = `resources[]`, joining tasks/absences by `resourceId` (case-folded name fallback for legacy rows). Assignees matching no resource appear in a read-only **"Unlinked"** group so nothing is silently hidden. |
| 8 | Birthday format | **`MM-DD`** (no year). Entered as month + day selects. |
| 9 | Birthday reminder | **Configurable lead time.** New `settings.notifications.birthday = { enabled, leadDays }` (default `{ true, 7 }`). Top banner + load-time toast, mirroring due-alerts. |
| 10 | Spec scope | **One comprehensive design**, phased build order. |

---

## Data Model

Extend `Resource` in `types.ts`. The address-book fields are all optional except `firstName`/`lastName`; the planner fields are unchanged.

```ts
export type Resource = {
  id: number;
  firstName: string;
  lastName: string;
  title?: string;
  businessPhone?: string;
  location?: string;
  department?: string;
  email?: string;
  company?: string;
  birthday?: string;   // "MM-DD" (zero-padded month-day, no year)
  notes?: string;      // free text (may contain commas, pipes, newlines)
  // — unchanged planner fields —
  roleId: number | null;
  utilizationMode: UtilizationMode;
  utilization: Record<string, number>;
  absenceOverride?: Record<string, number>;
  active?: boolean;
  localModifiedAt?: string;
};
```

**Display name helper** (new, in `resource-foundation.ts`):

```ts
export function resourceDisplayName(r: Pick<Resource, "firstName" | "lastName">): string {
  return `${r.firstName} ${r.lastName}`.trim();
}
```

All current `r.name` reads (resources-panel, resources-report, resource-calendar, capacity/cost join keys, backfill) switch to `resourceDisplayName(r)`.

**Name split helper** (for migration):

```ts
// "Alex Example"  -> { firstName: "Sample", lastName: "Dummy" }
// "Madonna"     -> { firstName: "Madonna", lastName: "" }
// "Sample Anne Dummy" -> { firstName: "Sample", lastName: "Anne Dummy" }
export function splitName(name: string): { firstName: string; lastName: string };
```

**Birthday validation** (`MM-DD`): month `01–12`, day `01–31`, no calendar-strict day-in-month check beyond range (keeps Feb-29 enterable). Invalid/empty → `undefined`.

### Migration

- **`sanitizeResource`** accepts both shapes: if `firstName`/`lastName` are present, use them; else if a legacy `name` is present, `splitName(name)`. Unknown/blank → record dropped only if BOTH names end up empty.
- **`migrateWorkspaceV5`** / `backfillResources`: when building resources from task/absence assignees, run `splitName(assignee)` to populate first/last instead of `name`.
- IDB records loaded from a prior session carry `name`; `sanitizeResource` runs on them via the load path and back-fills first/last. (Schema version stays 5 — additive fields, no store changes.)

---

## Persistence (`storage.ts`)

The RESOURCES section columns change from:

```
id,name,email,roleId,utilizationMode,utilization,absenceOverride,active,localModifiedAt
```

to:

```
id,firstName,lastName,title,businessPhone,location,department,email,company,birthday,notes,roleId,utilizationMode,utilization,absenceOverride,active,localModifiedAt
```

- **CSV** (`resourceFieldToString` / `csvToResources` via `sanitizeResource`): new string columns ride the existing `csvEscape` path (handles commas/quotes/newlines in `notes`). Backward compat: when the header has a `name` column and no `firstName`, the row is split on load.
- **Markdown** (`RESOURCES_MD_COLUMNS` / `markdownToResources`): add columns with labels (`First`, `Last`, `Title`, `Phone`, `Location`, `Department`, `Company`, `Birthday`, `Notes`); `notes` uses the existing `mdEscape`/`mdUnescape` (pipes/newlines). Same `name`-fallback on load.
- **JSON**: carries the richer object verbatim; `sanitizeResource` normalizes on load.
- **Sample workspace** (`sample-workspace.csv` / `.md`): regenerate with the new columns and plausible address-book values (reuse the round-trip approach: edit CSV, regenerate MD via `csvToWorkspace`→`workspaceToMarkdown`).

---

## Resources Pane — Four Tabs (`resources-panel.tsx`)

`View` becomes `"directory" | "workload" | "calendar" | "planning"`; the `SegmentedControl` lists all four. Default tab = `directory`.

### Directory tab — new `resource-directory.tsx`

An address-book **table** (replaces the `<ul>` roster). Columns:

| Name | Discipline | Grade | Title | Department | Email | Phone | Birthday |
|------|-----------|-------|-------|------------|-------|-------|----------|

- **Name** is a button → `onEditResource(resource)` (opens the modal).
- **Discipline** / **Grade** remain inline `<select>`s calling `onAssignRole` (today's behavior, lifted out of `ResourceRoleRow`).
- Header actions: **+ Add resource** (`onAddResource`) and **Open address book** (`onOpenAddressBook` → popout).
- Empty state when `resources.length === 0`.

### Workload tab — rekeyed stats table

Rows are built from `resources[]` (not free-text aggregation):

- For each resource: `openCount` / `overdueCount` from tasks where `task.resourceId === r.id`, else (no resourceId) case-folded `task.assignee === resourceDisplayName(r)`. `upcoming` absences joined the same way. `weeklyHours` from a matching `Shift` (name match; shifts have no `resourceId`).
- **Unlinked group:** tasks/absences whose assignee matches no resource (by id or name) are grouped into read-only rows at the bottom under an "Unlinked" subheading, each with an **"Add as resource"** action that opens the modal in create mode pre-filled with the split name + email. This preserves the visibility the current free-text table provides.
- Clicking a managed row's name also opens the edit modal; unlinked rows are read-only except for "Add as resource".

### Calendar / Planning tabs

Unchanged behavior; only `r.name` → `resourceDisplayName(r)` substitutions. The Planning grid keeps its window/granularity controls and rollup.

---

## Edit Modal — new `resource-edit-modal.tsx`

Mirrors `absence-edit-modal.tsx` / `shift-edit-modal.tsx`:

- Fields: First name, Last name, Title, Company, Department, Location, Business phone, Email, **Birthday** (month select + day select, no year), **Notes** (textarea). Discipline + Grade selects may also be edited here (writing through `onAssignRole`), so the modal is a complete editor.
- Actions: **Save** (`onSaveResource(next)`), **Delete** (`onDeleteResource(id)`; create mode hides Delete), **Cancel**.
- Validation: at least one of first/last name non-empty; birthday optional but must be a valid `MM-DD` if set; email format soft-validated (warning, not blocking).
- Rendered through `AppModals` driven by an `editingResource: { resource: Resource; isNew: boolean } | null` state in `task-manager.tsx`. **Not gated by `isPopout`** so it also opens inside the address-book popout.

### Handlers (`use-resource-planner.ts`)

Add to the planner hook (alongside `onAssignRole`, `onSetUtilization`, …):

- `onAddResource(seed?: Partial<Resource>)` — opens modal with a fresh id (`Math.max(...ids)+1`) and defaults (`utilizationMode: "percent"`, `utilization: {}`, `roleId: null`).
- `onSaveResource(next)` — immutable upsert into `resources[]`, stamping `localModifiedAt`.
- `onDeleteResource(id)` — removes the resource. Tasks/absences keep their `resourceId` (now dangling → they fall into the Unlinked group); no cascade.

---

## Address-Book Pop-out

- Add `"address-book"` to `POPOUT_TABS` (`broadcast-sync.ts`) and to `TopTab` (`workspace-tab-context.tsx`), plus its title key in `TAB_LABEL_KEYS` (`task-manager.tsx`).
- `workspace-section.tsx` renders the **Directory** panel for `activeTab === "address-book"`, and the Directory header's **Open address book** button calls `openPopoutWindow("address-book", settings.popout.reuseWindow)`.
- `resources` is already synced via `useBroadcastSync("resources", …)`, so edits in the popout propagate to the main window, which is the sole persister (per the single-writer rule established in the popout-save fix). The popout itself does not save.

---

## Birthday Reminders

### Pure helper — `getUpcomingBirthdays(resources, today, leadDays)`

Returns resources whose `birthday` (`MM-DD`) falls in the inclusive window `[today, today + leadDays]`, **handling year-wrap** (e.g. today = `12-30`, leadDays = `7` includes `01-02`). Output sorted by days-until ascending; each entry carries `daysUntil` (0 = today) for labeling. Resources with no/invalid birthday are skipped. Pure and unit-tested independently of React.

### Settings

Extend `Settings.notifications`:

```ts
birthday: { enabled: boolean; leadDays: number }  // default { enabled: true, leadDays: 7 }
```

A control in **Settings → Notifications** (next to the due-alert banner settings): an enable toggle + a lead-days number input. Defaults merged in the settings migration so older persisted settings gain the field.

### Banner + toast — `useBirthdayAlerts` + `BirthdayBanner`

- `useBirthdayAlerts({ hydrated, resources, today, settings, showToast })` mirrors `useDueAlerts`: on hydrate (and when the set changes), if `enabled` and there are upcoming birthdays, fire a **toast** once per session; expose `birthdayItems` + a dismissed flag.
- `BirthdayBanner` (in `notifications.tsx`, styled like `DueBanner`) renders at the **top of the page**, directly below the due-alerts banner and above the first pane (both gated `!isPopout`), summarizing today's/upcoming birthdays. Dismiss + "view" affordances match the due banner.
- New i18n keys for banner title/summary, toast text, and the settings labels (en-US, en-GB, de).

---

## Files

**New**
- `src/app/resource-directory.tsx` — Directory table + add/open-address-book actions.
- `src/app/resource-edit-modal.tsx` — address-book record editor.
- `src/app/use-birthday-alerts.ts` — birthday banner/toast hook.
- Tests: `resource-directory.test.tsx`, `resource-edit-modal.test.tsx`, `birthdays.test.ts` (pure helper), `use-birthday-alerts.test.tsx`.

**Changed**
- `types.ts` — `Resource` fields.
- `resource-foundation.ts` — `resourceDisplayName`, `splitName`, birthday seed in `backfillResources`.
- `sanitize.ts` — `sanitizeResource` (new fields + name fallback + birthday validation).
- `storage.ts` — RESOURCES CSV/MD columns + decoders; `name`-fallback.
- `resources-panel.tsx` — four-tab `SegmentedControl`; Workload rekey; delegate Directory to new component.
- `resources-report.tsx`, `resource-calendar.tsx`, `resource-capacity.ts`, `resource-cost.ts` — `name` → `resourceDisplayName`.
- `use-resource-planner.ts` — add/save/delete resource handlers.
- `task-manager.tsx` — `editingResource` state; render `BirthdayBanner`; wire `useBirthdayAlerts`; `address-book` tab label.
- `app-modals.tsx` — render `ResourceEditModal` (ungated by `isPopout`).
- `workspace-section.tsx` — Directory panel for `address-book` popout; pass new handlers.
- `broadcast-sync.ts`, `workspace-tab-context.tsx` — `address-book` tab.
- `settings-menu.tsx` + `use-settings.ts` — birthday notification settings + migration.
- `notifications.tsx` — `BirthdayBanner`.
- `i18n.ts` / `i18n.de.ts` — new keys.
- `sample-workspace.csv` / `sample-workspace.md` — new columns.

---

## Testing

- **Pure units:** `splitName`, `resourceDisplayName`, birthday `MM-DD` validation, `getUpcomingBirthdays` (incl. year-wrap, leap day, empty/invalid).
- **Serialization round-trips:** resource with all fields incl. `notes` containing commas/pipes/newlines through CSV and MD; legacy `name`-only file loads and splits.
- **Workload rekey:** resourceId join, name fallback, unlinked grouping.
- **Components:** Directory renders rows + add button; clicking name fires `onEditResource`; edit modal save/delete/validation; `useBirthdayAlerts` toast-once + banner items respect `enabled`/`leadDays`.
- Maintain the project's 80% coverage gate.

---

## Phased Build Order

1. **Model + persistence** — `Resource` fields, `resourceDisplayName`/`splitName`, `sanitizeResource`, CSV/MD/JSON columns + `name`-fallback, sample workspace, migration. Swap `r.name` reads. (Green build, no UI change yet.)
2. **Directory tab + edit modal** — four-tab `SegmentedControl`, `resource-directory.tsx`, `resource-edit-modal.tsx`, planner add/save/delete handlers, `editingResource` wiring, name-click → edit.
3. **Workload rekey** — rebuild the stats table off `resources[]` with resourceId/name join and the Unlinked group.
4. **Address-book pop-out** — `address-book` tab + popout button; verify edit-in-popout broadcasts to the main writer.
5. **Birthday reminders** — pure helper, settings, `useBirthdayAlerts`, `BirthdayBanner`, i18n.

Each phase ends on a green build + tests and is independently shippable.
