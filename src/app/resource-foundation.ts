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
