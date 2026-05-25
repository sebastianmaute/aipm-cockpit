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
