# Resource Address Book — Phase 3 (Workload Rekey) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild the **Workload** tab's stats table off the managed `resources[]` (joining tasks/absences by `resourceId`, falling back to case-folded name; shifts by name), and surface any task/absence assignee that matches no resource in a read-only **"Unlinked"** group with an **"Add as resource"** action. Clicking a managed row's name opens the resource editor.

**Architecture:** New pure helper `resource-workload.ts#buildResourceWorkload(...)` returns `{ managed, unlinked }` rows. New `resource-workload.tsx` renders both groups (managed = editable name + shift/absence affordances; unlinked = read-only + "Add as resource"). `resources-panel.tsx` swaps its inline Workload `<table>` for `<ResourceWorkload/>`. The Calendar view keeps its existing `rows` assignee aggregation (out of scope).

**Tech Stack:** TypeScript, Next.js 16, React 19, Tailwind v4, Vitest + RTL. Source `src/app/`.

**Source spec:** [`../specs/2026-05-24-resource-address-book-design.md`](../specs/2026-05-24-resource-address-book-design.md) — Phase 3 of 5. Builds on Phase 2.

---

### Task 1: Pure helper `buildResourceWorkload`

**Files:**
- Create: `src/app/resource-workload.ts`
- Test: `src/app/resource-workload.test.ts`

- [ ] **Step 1: Failing tests** `src/app/resource-workload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildResourceWorkload } from "./resource-workload";
import type { Absence, Resource, Shift, Task } from "./types";

const res = (id: number, firstName: string, lastName: string, email?: string): Resource =>
  ({ id, firstName, lastName, email, roleId: null, utilizationMode: "percent", utilization: {} });
const task = (id: number, assignee: string, over: Partial<Task> = {}): Task =>
  ({ id, taskName: `T${id}`, assignee, assigneeEmail: "", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01",
     priority: "Medium", blockers: "", notes: "", inquiriesSent: 0, ...over });

describe("buildResourceWorkload", () => {
  it("joins tasks to a managed resource by resourceId", () => {
    const r = res(1, "Sample", "Dummy");
    const { managed, unlinked } = buildResourceWorkload([r], [task(10, "whatever", { resourceId: 1 })], [], [], "2026-06-01");
    expect(unlinked).toHaveLength(0);
    expect(managed).toHaveLength(1);
    expect(managed[0].openCount).toBe(1);
  });
  it("falls back to case-folded name when a task has no resourceId", () => {
    const r = res(1, "Sample", "Dummy");
    const { managed } = buildResourceWorkload([r], [task(10, "Alex Example")], [], [], "2026-06-01");
    expect(managed[0].openCount).toBe(1);
  });
  it("counts overdue open tasks", () => {
    const r = res(1, "Sample", "Dummy");
    const { managed } = buildResourceWorkload([r], [task(10, "Alex Example", { resourceId: 1, dueDate: "2026-01-01" })], [], [], "2026-06-01");
    expect(managed[0].overdueCount).toBe(1);
  });
  it("ignores completed tasks for open/overdue counts", () => {
    const r = res(1, "Sample", "Dummy");
    const { managed } = buildResourceWorkload([r], [task(10, "Alex Example", { resourceId: 1, dueDate: "2026-01-01", completedDate: "2026-02-01" })], [], [], "2026-06-01");
    expect(managed[0].openCount).toBe(0);
    expect(managed[0].overdueCount).toBe(0);
  });
  it("groups an unknown assignee under unlinked with a split name + email seed", () => {
    const { managed, unlinked } = buildResourceWorkload([], [task(10, "Bob Lee", { assigneeEmail: "bob@x.com" })], [], [], "2026-06-01");
    expect(managed).toHaveLength(0);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatchObject({ firstName: "Bob", lastName: "Lee", email: "bob@x.com", openCount: 1 });
  });
  it("treats a dangling resourceId (no matching resource) + unknown name as unlinked", () => {
    const { managed, unlinked } = buildResourceWorkload([res(1, "Sample", "Dummy")], [task(10, "Ghost", { resourceId: 999 })], [], [], "2026-06-01");
    expect(managed[0].openCount).toBe(0);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0].display).toBe("Ghost");
  });
  it("includes a managed resource with no tasks (zero counts, default weekly hours)", () => {
    const { managed } = buildResourceWorkload([res(1, "Sample", "Dummy")], [], [], [], "2026-06-01");
    expect(managed).toHaveLength(1);
    expect(managed[0].openCount).toBe(0);
    expect(managed[0].weeklyHours).toBeGreaterThan(0);
    expect(managed[0].shift).toBeNull();
  });
  it("attaches a shift's weekly hours by name match", () => {
    const r = res(1, "Sample", "Dummy");
    const shift: Shift = { id: 1, assignee: "Alex Example", hoursPerWeekday: [0, 10, 10, 10, 10, 0, 0] };
    const { managed } = buildResourceWorkload([r], [], [], [shift], "2026-06-01");
    expect(managed[0].weeklyHours).toBe(40);
    expect(managed[0].shift).not.toBeNull();
  });
  it("collects only upcoming absences within the 60-day horizon", () => {
    const r = res(1, "Sample", "Dummy");
    const past: Absence = { id: 1, assignee: "Alex Example", startDate: "2026-01-01", endDate: "2026-01-05", type: "vacation", resourceId: 1 };
    const soon: Absence = { id: 2, assignee: "Alex Example", startDate: "2026-06-10", endDate: "2026-06-12", type: "vacation", resourceId: 1 };
    const far: Absence = { id: 3, assignee: "Alex Example", startDate: "2026-12-01", endDate: "2026-12-05", type: "vacation", resourceId: 1 };
    const { managed } = buildResourceWorkload([r], [], [past, soon, far], [], "2026-06-01");
    expect(managed[0].upcoming.map((a) => a.id)).toEqual([2]);
  });
});
```

Run `npx vitest run src/app/resource-workload.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `src/app/resource-workload.ts`:**

```ts
import { resourceDisplayName, splitName } from "./resource-foundation";
import { DEFAULT_WEEK_HOURS, type Absence, type Resource, type Shift, type Task, type WeekHours } from "./types";

export interface WorkloadRowBase {
  display: string;
  email: string;
  openCount: number;
  overdueCount: number;
  weeklyHours: number;
  shift: Shift | null;
  upcoming: Absence[];
}
export interface ManagedWorkloadRow extends WorkloadRowBase { kind: "managed"; resource: Resource; }
export interface UnlinkedWorkloadRow extends WorkloadRowBase { kind: "unlinked"; firstName: string; lastName: string; }
export interface WorkloadResult { managed: ManagedWorkloadRow[]; unlinked: UnlinkedWorkloadRow[]; }

function sumHours(h: WeekHours): number { return h.reduce((a, b) => a + (b || 0), 0); }
const DEFAULT_WEEKLY_HOURS = sumHours(DEFAULT_WEEK_HOURS);

/**
 * Workload rows keyed off the managed address book. A task/absence joins a
 * resource by `resourceId`, else by case-folded display name; shifts join by
 * name only. Assignees matching no resource fall into `unlinked` (read-only),
 * carrying a split name + email so the UI can offer "Add as resource".
 */
export function buildResourceWorkload(
  resources: readonly Resource[],
  tasks: readonly Task[],
  absences: readonly Absence[],
  shifts: readonly Shift[],
  today: string,
): WorkloadResult {
  const horizon = (() => {
    const d = new Date(today);
    if (Number.isNaN(d.valueOf())) return null;
    d.setUTCDate(d.getUTCDate() + 60);
    return d.toISOString().slice(0, 10);
  })();

  const managed = new Map<number, ManagedWorkloadRow>();
  const nameToId = new Map<string, number>();
  for (const r of resources) {
    const display = resourceDisplayName(r);
    managed.set(r.id, {
      kind: "managed", resource: r, display, email: r.email ?? "",
      openCount: 0, overdueCount: 0, weeklyHours: DEFAULT_WEEKLY_HOURS, shift: null, upcoming: [],
    });
    const key = display.trim().toLowerCase();
    if (key && !nameToId.has(key)) nameToId.set(key, r.id);
  }

  const unlinked = new Map<string, UnlinkedWorkloadRow>();
  const ensureUnlinked = (rawName: string, rawEmail?: string): UnlinkedWorkloadRow | null => {
    const name = (rawName ?? "").trim();
    if (!name) return null;
    const key = name.toLowerCase();
    let row = unlinked.get(key);
    if (!row) {
      const { firstName, lastName } = splitName(name);
      row = { kind: "unlinked", firstName, lastName, display: name, email: rawEmail?.trim() ?? "",
        openCount: 0, overdueCount: 0, weeklyHours: DEFAULT_WEEKLY_HOURS, shift: null, upcoming: [] };
      unlinked.set(key, row);
    } else if (!row.email && rawEmail?.trim()) {
      row.email = rawEmail.trim();
    }
    return row;
  };

  const resolve = (resourceId: number | undefined, assignee: string, email?: string): WorkloadRowBase | null => {
    if (resourceId != null && managed.has(resourceId)) return managed.get(resourceId)!;
    const name = (assignee ?? "").trim();
    if (!name) return null;
    const id = nameToId.get(name.toLowerCase());
    if (id != null) return managed.get(id)!;
    return ensureUnlinked(name, email);
  };

  for (const t of tasks) {
    const row = resolve(t.resourceId, t.assignee, t.assigneeEmail);
    if (!row) continue;
    if (!t.completedDate) {
      row.openCount++;
      if (t.dueDate && t.dueDate < today) row.overdueCount++;
    }
  }
  for (const a of absences) {
    const row = resolve(a.resourceId, a.assignee, a.assigneeEmail);
    if (!row) continue;
    if (a.endDate < today) continue;
    if (horizon && a.startDate > horizon) continue;
    row.upcoming.push(a);
  }
  for (const s of shifts) {
    const row = resolve(undefined, s.assignee, s.assigneeEmail);
    if (!row) continue;
    row.shift = s;
    row.weeklyHours = sumHours(s.hoursPerWeekday);
  }

  for (const row of managed.values()) row.upcoming.sort((x, y) => x.startDate.localeCompare(y.startDate));
  for (const row of unlinked.values()) row.upcoming.sort((x, y) => x.startDate.localeCompare(y.startDate));

  return {
    managed: Array.from(managed.values()).sort((a, b) => a.display.localeCompare(b.display)),
    unlinked: Array.from(unlinked.values()).sort((a, b) => a.display.localeCompare(b.display)),
  };
}
```

Run tests → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/resource-workload.ts src/app/resource-workload.test.ts
git commit -m "feat(resources): pure buildResourceWorkload helper (managed + unlinked rows)"
```

---

### Task 2: `ResourceWorkload` component + wire into the pane

**Files:**
- Create: `src/app/resource-workload.tsx`, `src/app/resource-workload.test.tsx`
- Modify: `src/app/resources-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/resources-panel.test.tsx`

- [ ] **Step 1: i18n keys.** Add to `i18n.ts` (en-US + en-GB if separate) and `i18n.de.ts`:
```
resourcesUnlinked: "Unlinked"                    // de: "Nicht zugeordnet"
resourcesUnlinkedHint: "Not in the address book" // de: "Nicht im Verzeichnis"
resourcesAddAsResource: "Add as resource"        // de: "Als Ressource hinzufügen"
```
(Reuse existing `assignee`, `email`, `resourcesOpenTasks`, `resourcesOverdueTasks`, `resourcesWeeklyHours`, `resourcesUpcomingAbsences`, `resourcesEditShift`, `resourcesDefaultShift`.)

- [ ] **Step 2: Failing component test** `src/app/resource-workload.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResourceWorkload } from "./resource-workload";
import type { Resource, Task } from "./types";
const r: Resource = { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} };
const baseProps = {
  lang: "en-US" as const, resources: [r], absences: [], shifts: [], today: "2026-06-01",
  onEditResource: vi.fn(), onAddResource: vi.fn(), onEditAbsence: vi.fn(), onEditShift: vi.fn(),
};
describe("ResourceWorkload", () => {
  it("clicking a managed resource's name opens the editor", () => {
    const onEditResource = vi.fn();
    render(<ResourceWorkload {...baseProps} tasks={[]} onEditResource={onEditResource} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEditResource).toHaveBeenCalledWith(r);
  });
  it("offers Add as resource for an unlinked assignee and seeds the name", () => {
    const onAddResource = vi.fn();
    const tasks: Task[] = [{ id: 9, taskName: "T", assignee: "Bob Lee", assigneeEmail: "bob@x.com", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01", priority: "Medium", blockers: "", notes: "", inquiriesSent: 0 }];
    render(<ResourceWorkload {...baseProps} tasks={tasks} onAddResource={onAddResource} />);
    expect(screen.getByText("Bob Lee")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add as resource/i }));
    expect(onAddResource).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Bob", lastName: "Lee", email: "bob@x.com" }));
  });
});
```

Run → FAIL.

- [ ] **Step 3: Implement `resource-workload.tsx`.** Compute rows with `useMemo(() => buildResourceWorkload(resources, tasks, absences, shifts, today), [resources, tasks, absences, shifts, today])`. Props:

```ts
interface Props {
  lang: Lang;
  resources: readonly Resource[];
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  today: string;
  onEditResource: (r: Resource) => void;
  onAddResource: (seed: Partial<Resource>) => void;
  onEditAbsence: (a: Absence) => void;
  onEditShift: (existing: Shift | null, assignee: { display: string; email: string }) => void;
}
```

Render the SAME 6-column table markup currently in `resources-panel.tsx`'s workload block (Assignee, Email, Open, Overdue, Weekly hours [shift-edit button], Upcoming absences [absence-edit buttons]). Two row groups in the `<tbody>`:
- **Managed** (`result.managed`): name cell is `<button onClick={() => onEditResource(row.resource)}>{row.display}</button>` (link/edit style consistent with the Directory name button). Weekly-hours button → `onEditShift(row.shift, { display: row.display, email: row.email })`. Upcoming absence buttons → `onEditAbsence(a)`. `key={`res-${row.resource.id}`}`.
- **Unlinked** (`result.unlinked`, only if non-empty): a full-width subheading row (`<tr><td colSpan={6}>` containing `resourcesUnlinked` + a muted `resourcesUnlinkedHint`); then one row per unlinked assignee — name as PLAIN text plus an inline **Add as resource** button → `onAddResource({ firstName: row.firstName, lastName: row.lastName, email: row.email || undefined })`. Keep the same weekly-hours/upcoming affordances. `key={`unl-${row.display.toLowerCase()}`}`.

Copy the small `shortDateRange(a, lang)` and `localeFor(lang)` helpers from `resources-panel.tsx` (they are file-local there) into this file so the component is self-contained.

Run component test → PASS.

- [ ] **Step 4: Wire into `resources-panel.tsx`.** Replace the entire `{view === "workload" && !isEmpty && ( <div>…<table>…</table></div> )}` block with:

```tsx
{view === "workload" && !isEmpty && (
  <ResourceWorkload
    lang={lang}
    resources={resources}
    tasks={tasks}
    absences={absences}
    shifts={shifts}
    today={today}
    onEditResource={onEditResource}
    onAddResource={onAddResource}
    onEditAbsence={onEditAbsence}
    onEditShift={onEditShift}
  />
)}
```

Add `import { ResourceWorkload } from "./resource-workload";`. Widen the panel's `onAddResource` prop type to `(seed?: Partial<Resource>) => void` so the unlinked seed passes through (the Directory's no-arg call stays valid). Update `workspace-section.tsx` + `task-manager.tsx` prop types only if they declare a narrower signature — the planner's `handleOpenAddResource(seed?: Partial<Resource>)` already accepts the seed, so this is just widening the intermediate prop types to match. Keep the Calendar `rows` useMemo and the header count unchanged.

- [ ] **Step 5: Update `resources-panel.test.tsx`** if it asserted workload-table specifics now living in `ResourceWorkload` (move/adjust those, or mock `./resource-workload`). Keep coverage equivalent.

- [ ] **Step 6: Verify** — `npx tsc --noEmit` clean; `npx vitest run` green (only the known `use-holiday-set` flake acceptable).

- [ ] **Step 7: Commit**

```bash
git add src/app/resource-workload.tsx src/app/resource-workload.test.tsx src/app/resources-panel.tsx src/app/resources-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): rekey Workload tab to managed resources + Unlinked group"
```

---

## Self-Review

**Spec coverage (Phase 3):** Workload rows from `resources[]` joined by resourceId, name fallback (Task 1) ✓; shifts by name (Task 1) ✓; Unlinked group for unmatched assignees with "Add as resource" seed (Tasks 1 + 2) ✓; managed name → editor, unlinked read-only (Task 2) ✓; Calendar aggregation unchanged (left intact) ✓.

**Placeholder scan:** all code shown; the only "copy from resources-panel.tsx" instruction (the `shortDateRange`/`localeFor` helpers) points at concrete existing functions, not invented ones.

**Type consistency:** `ManagedWorkloadRow`/`UnlinkedWorkloadRow`/`WorkloadResult` defined in Task 1 and consumed in Task 2. `onAddResource: (seed?: Partial<Resource>) => void` aligns the panel prop with the planner's existing `handleOpenAddResource(seed?: Partial<Resource>)` and the Directory's no-arg call.

**Out of scope (later):** pop-out tab (Phase 4); birthday banner/toast/settings (Phase 5). Calendar rekey NOT in scope.
