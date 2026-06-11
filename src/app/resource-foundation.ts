import {
  DEFAULT_CURRENCY,
  PRESET_DISCIPLINES,
  PRESET_GRADES,
  type Absence,
  type Discipline,
  type Grade,
  type RaidItem,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
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
      const { firstName, lastName } = splitName(name);
      r = {
        id: nextId++,
        firstName,
        lastName,
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

/**
 * Build a case-folded email -> Resource.id lookup. Resources with no email
 * are skipped. When two resources share an email (case-insensitively), the
 * first wins — matching the first-seen-casing convention in backfillResources.
 */
function emailToResourceId(resources: readonly Resource[]): Map<string, number> {
  const byEmail = new Map<string, number>();
  for (const r of resources) {
    const email = (r.email ?? "").trim().toLowerCase();
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, r.id);
  }
  return byEmail;
}

/**
 * Idempotently fill an unset (null/undefined) `resourceId` FK on each
 * absence/raid/shift by case-folded email match against Resource.email.
 * Never overwrites an already-set FK; leaves the denormalized name/email
 * cache untouched. Resources with no email are ignored. Pure: returns NEW
 * arrays only when something changed (so reference-equality callers can
 * detect a no-op).
 */
export function backfillResourceFks(
  resources: readonly Resource[],
  absences: readonly Absence[],
  raid: readonly RaidItem[],
  shifts: readonly Shift[],
): { absences: Absence[]; raid: RaidItem[]; shifts: Shift[] } {
  const byEmail = emailToResourceId(resources);
  const lookup = (email: string | undefined): number | undefined => {
    const key = (email ?? "").trim().toLowerCase();
    return key ? byEmail.get(key) : undefined;
  };
  let absencesChanged = false;
  const outAbsences = absences.map((a) => {
    if (a.resourceId != null) return a;
    const id = lookup(a.assigneeEmail);
    if (id === undefined) return a;
    absencesChanged = true;
    return { ...a, resourceId: id };
  });
  let raidChanged = false;
  const outRaid = raid.map((r) => {
    if (r.ownerResourceId != null) return r;
    const id = lookup(r.ownerEmail);
    if (id === undefined) return r;
    raidChanged = true;
    return { ...r, ownerResourceId: id };
  });
  let shiftsChanged = false;
  const outShifts = shifts.map((s) => {
    if (s.resourceId != null) return s;
    const id = lookup(s.assigneeEmail);
    if (id === undefined) return s;
    shiftsChanged = true;
    return { ...s, resourceId: id };
  });
  return {
    absences: absencesChanged ? outAbsences : (absences as Absence[]),
    raid: raidChanged ? outRaid : (raid as RaidItem[]),
    shifts: shiftsChanged ? outShifts : (shifts as Shift[]),
  };
}

/** Next monotonic id for an entity array (1-based). */
export function nextId(items: ReadonlyArray<{ id: number }>): number {
  return items.length ? Math.max(...items.map((i) => i.id)) + 1 : 1;
}

/** Find the Role for a discipline × grade combination, if one exists. */
export function findRoleByCombo(
  roles: ReadonlyArray<Role>,
  disciplineId: number,
  gradeId: number,
): Role | undefined {
  return roles.find((r) => r.disciplineId === disciplineId && r.gradeId === gradeId);
}

/** Human label for a role: "Developer Senior". Empty string when role is undefined. */
export function roleLabel(
  role: Role | undefined,
  disciplines: ReadonlyArray<Discipline>,
  grades: ReadonlyArray<Grade>,
): string {
  if (!role) return "";
  const d = disciplines.find((x) => x.id === role.disciplineId)?.name ?? "n/a";
  const g = grades.find((x) => x.id === role.gradeId)?.name ?? "n/a";
  return `${d} ${g}`;
}

/** Split a display name on the FIRST space: "Sample Anne Dummy" → first "Sample", last "Anne Dummy". */
export function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "", lastName: "" };
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1) };
}

/** Display name for a resource: "First Last", trimmed when last name is empty. */
export function resourceDisplayName(r: Pick<Resource, "firstName" | "lastName">): string {
  return `${r.firstName} ${r.lastName}`.trim();
}
