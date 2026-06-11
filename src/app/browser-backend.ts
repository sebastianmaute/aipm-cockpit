// src/app/browser-backend.ts
//
// Default IndexedDB storage backend: per-entity record stores with
// diff-based saves plus KV slots for the singleton sections. Extracted from
// storage.ts (which re-exports everything).

import { defaultResourcePlan } from "./resource-foundation";
import { sanitizeProjectMeta } from "./sanitize";
import {
  type Absence,
  type BudgetBucket,
  type ChangeItem,
  type Discipline,
  type FxRates,
  type Grade,
  type Milestone,
  type ProjectMeta,
  type ProjectStatus,
  type RaidItem,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Stakeholder,
  type Task,
} from "./types";
import {
  IDB_TASKS_STORE,
  IDB_RAID_STORE,
  IDB_ABSENCES_STORE,
  IDB_SHIFTS_STORE,
  IDB_RESOURCES_STORE,
  IDB_ROLES_STORE,
  IDB_DISCIPLINES_STORE,
  IDB_GRADES_STORE,
  IDB_BUDGETS_STORE,
  KV_PLAN_KEY,
  KV_FXRATES_KEY,
  KV_STATUS_KEY,
  KV_MILESTONES_KEY,
  KV_CHANGES_KEY,
  KV_STAKEHOLDERS_KEY,
  KV_PROJECT_KEY,
  idbBulkUpdate,
  idbDelete,
  idbGet,
  idbGetAll,
  idbSet,
} from "./idb";
import {
  type StorageBackend,
  type Workspace,
  emptyWorkspace,
  migrateWorkspaceV8,
} from "./workspace";

/**
 * Browser-local persistence backed by IndexedDB record stores (one row per
 * Task / RaidItem). Replaces the previous "stringify the whole array into
 * localStorage" approach, which:
 *   - allocated a fresh ~N×KB JSON string on every debounced save,
 *   - hit the localStorage ~5–10 MB hard limit at scale, and
 *   - kept a duplicate string copy resident in the browser's localStorage
 *     map for the lifetime of the tab.
 *
 * Saves diff against an in-memory baseline (the last-loaded/last-saved
 * snapshot) and only write records whose reference identity changed, plus
 * the ids that were removed. The codebase follows an immutable-update
 * convention, so reference inequality reliably implies content change.
 *
 * Legacy localStorage data is migrated transparently on the first load
 * after upgrade — see `migrateLegacyIfNeeded`.
 */
export class BrowserBackend implements StorageBackend {
  readonly kind = "browser" as const;
  // Old key names — only read during the one-time migration on first load.
  private static LEGACY_TASKS_KEY = "lop-app:tasks";
  private static LEGACY_RAID_KEY = "lop-app:raid";

  // Baseline of what IDB currently holds, indexed by id. Populated by
  // `load()` and refreshed at the end of each successful `save()`. Used by
  // `save()` to compute the minimal puts + deletes.
  private tasksBaseline = new Map<number, Task>();
  private raidBaseline = new Map<number, RaidItem>();
  private absencesBaseline = new Map<number, Absence>();
  private shiftsBaseline = new Map<number, Shift>();
  private resourcesBaseline = new Map<number, Resource>();
  private rolesBaseline = new Map<number, Role>();
  private disciplinesBaseline = new Map<number, Discipline>();
  private gradesBaseline = new Map<number, Grade>();
  private budgetsBaseline = new Map<number, BudgetBucket>();

  async load(): Promise<Workspace> {
    if (typeof window === "undefined") return emptyWorkspace();

    let tasks: Task[] = [];
    let raid: RaidItem[] = [];
    let absences: Absence[] = [];
    let shifts: Shift[] = [];
    let resources: Resource[] = [];
    let roles: Role[] = [];
    let disciplines: Discipline[] = [];
    let grades: Grade[] = [];
    let plan: ResourcePlan = defaultResourcePlan(new Date().toISOString().slice(0, 10));
    let budgets: BudgetBucket[] = [];
    let fxRates: FxRates | null = null;
    let status: ProjectStatus = {};
    let milestones: Milestone[] = [];
    let changes: ChangeItem[] = [];
    let stakeholders: Stakeholder[] = [];
    let project: ProjectMeta | undefined;
    try {
      tasks = await idbGetAll<Task>(IDB_TASKS_STORE);
      raid = await idbGetAll<RaidItem>(IDB_RAID_STORE);
      absences = await idbGetAll<Absence>(IDB_ABSENCES_STORE);
      shifts = await idbGetAll<Shift>(IDB_SHIFTS_STORE);
      resources = await idbGetAll<Resource>(IDB_RESOURCES_STORE);
      roles = await idbGetAll<Role>(IDB_ROLES_STORE);
      disciplines = await idbGetAll<Discipline>(IDB_DISCIPLINES_STORE);
      grades = await idbGetAll<Grade>(IDB_GRADES_STORE);
      plan = (await idbGet<ResourcePlan>(KV_PLAN_KEY)) ?? plan;
      budgets = await idbGetAll<BudgetBucket>(IDB_BUDGETS_STORE);
      fxRates = (await idbGet<FxRates>(KV_FXRATES_KEY)) ?? null;
      status = (await idbGet<ProjectStatus>(KV_STATUS_KEY)) ?? {};
      milestones = (await idbGet<Milestone[]>(KV_MILESTONES_KEY)) ?? [];
      changes = (await idbGet<ChangeItem[]>(KV_CHANGES_KEY)) ?? [];
      stakeholders = (await idbGet<Stakeholder[]>(KV_STAKEHOLDERS_KEY)) ?? [];
      project = sanitizeProjectMeta(await idbGet(KV_PROJECT_KEY)) ?? undefined;
    } catch {
      // IDB unavailable or upgrade failed. Fall through — the legacy
      // migration block below will still try localStorage, and if that's
      // also empty we just hand back blank state.
    }

    if (tasks.length === 0 && raid.length === 0) {
      const migrated = await this.migrateLegacyIfNeeded();
      tasks = migrated.tasks;
      raid = migrated.raid;
      // Legacy localStorage never stored absences/shifts/resources — leave as-is
      // from the (possibly successful) idbGetAll attempts above.
    }

    const raw: Workspace = { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, milestones, changes, stakeholders };
    if (project) raw.project = project;
    const ws = migrateWorkspaceV8(raw);

    try {
      if (ws.resources !== raw.resources) await idbBulkUpdate(IDB_RESOURCES_STORE, ws.resources, []);
      if (ws.disciplines !== raw.disciplines) await idbBulkUpdate(IDB_DISCIPLINES_STORE, ws.disciplines, []);
      if (ws.grades !== raw.grades) await idbBulkUpdate(IDB_GRADES_STORE, ws.grades, []);
      if (ws.tasks !== raw.tasks) await idbBulkUpdate(IDB_TASKS_STORE, ws.tasks, []); // resourceId stamped
      if (ws.absences !== raw.absences) await idbBulkUpdate(IDB_ABSENCES_STORE, ws.absences, []);
      if (ws.plan !== raw.plan) await idbSet(KV_PLAN_KEY, ws.plan);
    } catch { /* non-fatal: retried next load */ }

    this.tasksBaseline = new Map(ws.tasks.map((t) => [t.id, t]));
    this.raidBaseline = new Map(ws.raid.map((r) => [r.id, r]));
    this.absencesBaseline = new Map(ws.absences.map((a) => [a.id, a]));
    this.shiftsBaseline = new Map(ws.shifts.map((s) => [s.id, s]));
    this.resourcesBaseline = new Map(ws.resources.map((r) => [r.id, r]));
    this.rolesBaseline = new Map(ws.roles.map((r) => [r.id, r]));
    this.disciplinesBaseline = new Map(ws.disciplines.map((d) => [d.id, d]));
    this.gradesBaseline = new Map(ws.grades.map((g) => [g.id, g]));
    this.budgetsBaseline = new Map((ws.budgets ?? []).map((b) => [b.id, b]));
    return ws;
  }

  /**
   * One-time migration from the pre-IDB localStorage layout. Runs only when
   * the IDB record stores are empty AND the legacy keys hold data. On
   * success, copies records into IDB and removes the legacy keys so the
   * migration doesn't fire again. Failures leave the legacy data intact so
   * the user keeps a recoverable copy.
   *
   * Absences were introduced in schema v3 and shifts in v4; neither ever
   * had a localStorage representation, so this migration always returns
   * `absences: []` and `shifts: []`.
   */
  private async migrateLegacyIfNeeded(): Promise<Workspace> {
    const legacyTasks = this.readLegacyArray<Task>(
      BrowserBackend.LEGACY_TASKS_KEY,
    );
    const legacyRaid = this.readLegacyArray<RaidItem>(
      BrowserBackend.LEGACY_RAID_KEY,
    );
    if (legacyTasks.length === 0 && legacyRaid.length === 0) {
      return emptyWorkspace();
    }
    try {
      await idbBulkUpdate(IDB_TASKS_STORE, legacyTasks, []);
      await idbBulkUpdate(IDB_RAID_STORE, legacyRaid, []);
      try {
        window.localStorage.removeItem(BrowserBackend.LEGACY_TASKS_KEY);
        window.localStorage.removeItem(BrowserBackend.LEGACY_RAID_KEY);
      } catch {
        /* non-fatal */
      }
    } catch {
      // IDB write failed — return what we read so the UI still works this
      // session; next load will retry the migration.
    }
    return {
      ...emptyWorkspace(),
      tasks: legacyTasks,
      raid: legacyRaid,
    };
  }

  private readLegacyArray<T>(key: string): T[] {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  async save(ws: Workspace): Promise<void> {
    if (typeof window === "undefined") return;

    const taskDelta = this.diff(this.tasksBaseline, ws.tasks);
    const raidDelta = this.diff(this.raidBaseline, ws.raid);
    const absenceDelta = this.diff(this.absencesBaseline, ws.absences);
    const shiftDelta = this.diff(this.shiftsBaseline, ws.shifts);

    await idbBulkUpdate(IDB_TASKS_STORE, taskDelta.puts, taskDelta.deletes);
    await idbBulkUpdate(IDB_RAID_STORE, raidDelta.puts, raidDelta.deletes);
    await idbBulkUpdate(
      IDB_ABSENCES_STORE,
      absenceDelta.puts,
      absenceDelta.deletes,
    );
    await idbBulkUpdate(
      IDB_SHIFTS_STORE,
      shiftDelta.puts,
      shiftDelta.deletes,
    );

    const resourceDelta = this.diff(this.resourcesBaseline, ws.resources);
    const roleDelta = this.diff(this.rolesBaseline, ws.roles);
    const discDelta = this.diff(this.disciplinesBaseline, ws.disciplines);
    const gradeDelta = this.diff(this.gradesBaseline, ws.grades);
    await idbBulkUpdate(IDB_RESOURCES_STORE, resourceDelta.puts, resourceDelta.deletes);
    await idbBulkUpdate(IDB_ROLES_STORE, roleDelta.puts, roleDelta.deletes);
    await idbBulkUpdate(IDB_DISCIPLINES_STORE, discDelta.puts, discDelta.deletes);
    await idbBulkUpdate(IDB_GRADES_STORE, gradeDelta.puts, gradeDelta.deletes);
    await idbSet(KV_PLAN_KEY, ws.plan);

    const budgetDelta = this.diff(this.budgetsBaseline, ws.budgets ?? []);
    await idbBulkUpdate(IDB_BUDGETS_STORE, budgetDelta.puts, budgetDelta.deletes);
    await idbSet(KV_FXRATES_KEY, ws.fxRates ?? null);
    await idbSet(KV_STATUS_KEY, ws.status ?? {});
    await idbSet(KV_MILESTONES_KEY, ws.milestones ?? []);
    await idbSet(KV_CHANGES_KEY, ws.changes ?? []);
    await idbSet(KV_STAKEHOLDERS_KEY, ws.stakeholders ?? []);
    if (ws.project) await idbSet(KV_PROJECT_KEY, ws.project);
    else await idbDelete(KV_PROJECT_KEY);

    // Refresh baselines so the next save's diff is computed against what's
    // actually in IDB. Rebuilding the maps is O(N) but only runs after a
    // successful write, not on every render.
    this.tasksBaseline = new Map(ws.tasks.map((t) => [t.id, t]));
    this.raidBaseline = new Map(ws.raid.map((r) => [r.id, r]));
    this.absencesBaseline = new Map(ws.absences.map((a) => [a.id, a]));
    this.shiftsBaseline = new Map(ws.shifts.map((s) => [s.id, s]));
    this.resourcesBaseline = new Map(ws.resources.map((r) => [r.id, r]));
    this.rolesBaseline = new Map(ws.roles.map((r) => [r.id, r]));
    this.disciplinesBaseline = new Map(ws.disciplines.map((d) => [d.id, d]));
    this.gradesBaseline = new Map(ws.grades.map((g) => [g.id, g]));
    this.budgetsBaseline = new Map((ws.budgets ?? []).map((b) => [b.id, b]));
  }

  /**
   * Reference-equality diff against the baseline. Unchanged rows in an
   * immutable codebase keep their object identity across renders, so a
   * fast `===` check separates "needs writing" from "nothing changed".
   * `deletes` are ids present in baseline but absent from the new list.
   */
  private diff<T extends { id: number }>(
    baseline: Map<number, T>,
    next: readonly T[],
  ): { puts: T[]; deletes: number[] } {
    const puts: T[] = [];
    const seen = new Set<number>();
    for (const item of next) {
      seen.add(item.id);
      if (baseline.get(item.id) !== item) {
        puts.push(item);
      }
    }
    const deletes: number[] = [];
    for (const id of baseline.keys()) {
      if (!seen.has(id)) deletes.push(id);
    }
    return { puts, deletes };
  }

  async isReady(): Promise<boolean> {
    return typeof window !== "undefined" && typeof indexedDB !== "undefined";
  }

  async describe(): Promise<string> {
    return "IndexedDB";
  }
}
