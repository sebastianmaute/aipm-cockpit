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

/**
 * Idempotently fill an unset `Task.resourceId` from the directory, by
 * case-folded email first and then by a UNIQUE case-folded display name.
 *
 * Tasks were deliberately outside {@link backfillResourceFks} (absence / raid /
 * shift), so a task whose person was stored only as an `assignee` STRING stayed
 * unlinked forever. That is what let one human own two swimlanes — the grouping
 * engine keys a linked task `res:<id>` and an unlinked one `name:<string>` —
 * and what made the per-card assignee select read "Unassigned" beside a card
 * printing that person's name.
 *
 * ★★ The NAME fallback is what makes this useful here and it is why the
 * uniqueness check is not optional: `assigneeEmail` is blank on most
 * hand-entered and AI-created tasks, so an email-only pass (all v9 does) would
 * fix almost nothing. A name shared by two resources resolves to NEITHER —
 * guessing would attribute someone's work to the wrong person, which is worse
 * than the duplicate lane this repairs.
 *
 * ★ Never overwrites a set FK, and leaves the denormalized `assignee` /
 * `assigneeEmail` caches untouched — `effectiveAssignee` already prefers the
 * live resource name over the cache, so rewriting them here would only destroy
 * the historical record of what was typed.
 *
 * ★ A DANGLING FK (an id absent from the directory) is deliberately NOT
 * re-resolved: it is a real pointer to something this workspace cannot see —
 * a partial load, a resource deleted in another tab — and silently repointing
 * it at a same-named person would be a guess dressed as a repair.
 *
 * ★★ `task-kanban.ts` DOES re-resolve a dangling FK through the assignee name,
 * and the divergence is intended: that is a DISPLAY decision, reversible the
 * moment the directory changes and costing at most a card in the wrong lane.
 * This function REWRITES STORED DATA, so it holds the stricter line. If the two
 * ever need to agree, move this one toward the kanban's leniency only with a
 * migration story — never the reverse, which would start rewriting FKs on load.
 *
 * ★★ TWO call sites, because there are two load funnels: `applyWorkspace`
 * (`use-storage-backend.ts`, every backend's load / project switch / create) and
 * `applyRestoredWorkspace` (`task-manager.tsx`, Turso version-history restore).
 * The second fans STORED rows straight into state without touching the first,
 * so omitting it there silently reverts a project's task FKs to the pre-repair
 * shape until the next real load. A third funnel must call this too.
 *
 * Pure: returns the SAME array reference when nothing matched, so the caller
 * can detect a no-op by identity.
 */
export function backfillTaskResourceFks(
  resources: readonly Resource[],
  tasks: readonly Task[],
): Task[] {
  if (tasks.length === 0 || resources.length === 0) return tasks as Task[];
  // Keys owned by MORE THAN ONE resource are poisoned to `null` rather than
  // dropped, so a third resource sharing the key cannot un-poison the clash.
  //
  // ★★ BOTH indexes poison, and the email one deliberately does NOT reuse the
  // shared `emailToResourceId` helper, which is FIRST-WINS. That helper backs
  // the v9 absence/raid/shift backfill and changing it would silently alter
  // behaviour well outside this fix — but inheriting first-wins here would have
  // this function refuse to guess between two people called "Anna Jordan" while
  // happily guessing between two rows sharing an address, which is the exact
  // outcome the paragraph above calls unacceptable. A duplicated email is
  // usually one person entered twice, so either id is "probably" right —
  // "probably" is not the standard for silently rewriting stored rows, and a
  // task left unlinked is trivially repairable while a task linked to the wrong
  // id is not.
  const index = (key: string, id: number, into: Map<string, number | null>) => {
    if (!key) return;
    into.set(key, into.has(key) ? null : id);
  };
  const byEmail = new Map<string, number | null>();
  const byName = new Map<string, number | null>();
  for (const r of resources) {
    index((r.email ?? "").trim().toLowerCase(), r.id, byEmail);
    // ★★★ EXTERNALS ARE NEVER NAME-MATCHED — and here it matters MORE than in
    // the kanban, because this writes to STORAGE. `isExternalTask`
    // (`task-external.ts`) classifies external ownership LINK-ONLY precisely so
    // a name collision cannot HIDE REAL WORK; stamping an FK from a name would
    // manufacture the very link that classification depends on, and with "Hide
    // externals" on the task then disappears from Open Points — silently, at
    // load, with no user action to connect it to and no undo entry.
    // ★ EMAIL still matches externals: an address is a definite identity, not a
    // guess, which is the whole distinction task-external.ts draws. A task
    // carrying an external's actual email genuinely IS their work.
    if (r.isExternal !== true) {
      index(personNameKey(resourceDisplayName(r)), r.id, byName);
    }
  }
  let changed = false;
  const out = tasks.map((task) => {
    if (task.resourceId != null) return task;
    const email = (task.assigneeEmail ?? "").trim().toLowerCase();
    const viaEmail = email ? byEmail.get(email) : undefined;
    const nameKey = personNameKey(task.assignee);
    const viaName = nameKey ? byName.get(nameKey) : undefined;
    // ★ A POISONED email (`null`, i.e. shared by two resources) falls THROUGH to
    // the name pass rather than blocking the link — `??` treats it exactly like
    // "no email match". That is intended: an ambiguous address plus an
    // unambiguous name still identifies one person. Only an ambiguity in the
    // pass that actually matched suppresses the link.
    const id = viaEmail ?? viaName ?? null;
    if (id === null || id === undefined) return task;
    changed = true;
    return { ...task, resourceId: id };
  });
  return changed ? out : (tasks as Task[]);
}

/** Case-folded, whitespace-collapsed key for matching a stored person NAME
 *  against a directory display name.
 *
 *  ★ Shared with `task-kanban.ts` on purpose: the lane engine and this file's
 *  backfill must agree on what "the same name" means, or a project gets its
 *  duplicate lane back for exactly the names the stricter of the two would have
 *  merged. Anything added here (diacritic folding, punctuation) reaches both. */
export function personNameKey(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
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

/** True when a `resourceId` resolves to a live directory resource (i.e. it is
 *  linked, not free-text and not a dangling id). */
export function isResourceLinked(
  resourceId: number | null | undefined,
  resourcesById: ReadonlyMap<number, unknown>,
): boolean {
  return resourceId != null && resourcesById.has(resourceId);
}

/**
 * The name to DISPLAY for a person reference that carries both an FK id AND a
 * cached name string (task `assignee`/`resourceId`, RAID `owner`/
 * `ownerResourceId`, absence `assignee`/`resourceId`). When the id resolves to
 * a live directory resource, that resource's CURRENT name wins — the stored
 * string is only a cache and can go stale after a rename/re-link. Falls back to
 * the cached string when unlinked or dangling. Mirrors ResourcePicker's
 * `linked ? resourceDisplayName(linked) : value.name`, so every surface shows
 * the same live name the editor does.
 */
export function effectivePersonName(
  cachedName: string,
  resourceId: number | null | undefined,
  resourcesById: ReadonlyMap<number, Pick<Resource, "firstName" | "lastName">>,
): string {
  const r = resourceId != null ? resourcesById.get(resourceId) : undefined;
  return r ? resourceDisplayName(r) : cachedName;
}

/** Convenience wrapper of {@link effectivePersonName} for a task/absence-shaped
 *  reference (`{ assignee, resourceId }`). */
export function effectiveAssignee(
  ref: { assignee: string; resourceId?: number | null },
  resourcesById: ReadonlyMap<number, Pick<Resource, "firstName" | "lastName">>,
): string {
  return effectivePersonName(ref.assignee, ref.resourceId, resourcesById);
}

/**
 * The email to USE for an outbound action (draft/escalate) on a person
 * reference carrying both an FK id and a cached email. When the id resolves to
 * a live resource WITH an email, that current email wins; otherwise the cached
 * email is the fallback (so a linked resource whose email changed is never
 * mailed at its stale address). Mirrors {@link effectivePersonName}.
 */
export function effectivePersonEmail(
  cachedEmail: string,
  resourceId: number | null | undefined,
  resourcesById: ReadonlyMap<number, Pick<Resource, "email">>,
): string {
  const r = resourceId != null ? resourcesById.get(resourceId) : undefined;
  return r?.email ? r.email : cachedEmail;
}
