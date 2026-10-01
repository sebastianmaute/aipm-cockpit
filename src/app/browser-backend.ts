// src/app/browser-backend.ts
//
// Default IndexedDB storage backend: per-entity record stores with
// diff-based saves plus KV slots for the singleton sections. Extracted from
// storage.ts (which re-exports everything).

import { defaultResourcePlan } from "./resource-foundation";
import { sanitizeLoadedProjectMeta, sanitizeSteeringCommittee, withNormalizedEmailField, withNormalizedResourceEmails, withLiteralCalendarOptOut } from "./sanitize";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import { sanitizeKnowledgeItems } from "./document-link";
import { sanitizeInsights } from "./insights/sanitize-insights";
import { sanitizeProjectDocumentsWithDiag, type DocTruncationDiag } from "./document-model";
import { noteDecodeFailure, noteIfSanitizedToNothing } from "./meta-slice-decode";
import { logDiag } from "./diagnostics";
import { sanitizeDocumentRichFields } from "./document-rich-fields";
import { sanitizeDocumentVersionsWithDiag } from "./document-versions";
import { sanitizeDocumentAsset, type DocumentAsset } from "./document-asset";
import { sanitizeOverridesOrNone, hasAnyOverride } from "./settings-overrides";
import { type CalendarEvent, sanitizeLoadedCalendarEvent } from "./calendar-event";
import { migrateTask } from "./task-status";
import {
  sanitizeNoteFields,
  sanitizeRaidRichFields,
  sanitizeChangeRichFields,
  sanitizeMilestoneRichFields,
} from "./note-log";
import {
  isBudgetCurrency,
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
  type SteeringCommittee,
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
  idbGet,
  idbGetAll,
  idbSet,
  idbTransaction,
  IDB_KV_STORE_NAME,
} from "./idb";
import { sanitizeFieldVisibility } from "./field-visibility";
import { sanitizeFeatures, type FeatureModuleId } from "./feature-modules";

// KV slots for two optional workspace singletons that round-trip through the
// file/Turso codecs but were never persisted by the IndexedDB backend, so both
// were lost on reload in the default single-project browser storage mode.
const KV_FIELDVIS_KEY = "fieldVisibility";
const KV_FEATURES_KEY = "features";
const KV_STEERING_KEY = "steeringCommittee";
const KV_TIMELOG_LINKS_KEY = "timelogLinks";
const KV_KNOWLEDGE_ITEMS_KEY = "knowledgeItems";
const KV_INSIGHTS_KEY = "insights";
const KV_SETTINGS_OVERRIDES_KEY = "settingsOverrides";
const KV_CALENDAR_EVENTS_KEY = "calendarEvents";
const KV_DOCUMENTS_KEY = "documents";
const KV_DOCUMENT_VERSIONS_KEY = "documentVersions";
const KV_ACTIVITY_LOG_KEY = "activityLog";
const KV_BUDGET_HISTORY_KEY = "budgetHistory";
const KV_DOCUMENT_ASSETS_KEY = "documentAssets";
// §4 — the integer save revision this backend stamps on every successful
// save (see `save()` below); missing on load → 0.
const KV_REVISION_KEY = "revision";
import {
  type StorageBackend,
  type Workspace,
  emptyWorkspace,
  migrateWorkspaceV10,
} from "./workspace";
import { sanitizeActivityLog } from "./activity-log";
import { sanitizeBudgetHistory } from "./budget-history";
import { SaveConflictError } from "./storage-error";

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
  private static LEGACY_TASKS_KEY = "aipm-cockpit:tasks";
  private static LEGACY_RAID_KEY = "aipm-cockpit:raid";

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

  /** §4 — the revision this instance last loaded or wrote; `null` before any load. */
  private currentRevision: number | null = null;
  /** §4 — one-shot: set by `forceNextSave()`, consumed by `save()` only
   *  once its write has actually succeeded (R10 change 4). §4 fix round 3 —
   *  ALSO cleared by a successful `load()`, `adoptRevision()` and
   *  `adoptFrom()`, each of which establishes a genuine new baseline that a
   *  leftover forced-write intent from an earlier FAILED forced save must not
   *  silently carry past. */
  private forceNext = false;
  /** §4 — one-shot from `forceNextSave(expected)`: the next save is the forced FULL rewrite, but only while
   *  the stored revision is still `expected`. Consumed by that save attempt whatever its outcome (it can
   *  never write over a version nobody was shown), and dropped with `forceNext` by every new baseline. */
  private expectNext: string | null = null;

  /** What the most recent load() discarded to stay inside the document caps. */
  lastLoadTruncation: { entries: number; blocks: number } = { entries: 0, blocks: 0 };
  /** §620 — meta slices the last load decoded to NOTHING (see `jsonToWorkspace`).
   *  Read by `truncationOps.reportFor`, which pauses saving. Reset and published
   *  exactly like `lastLoadTruncation`, for the same stale-value reason. */
  lastDecodeFailures: readonly string[] = [];

  async load(): Promise<Workspace> {
    // Reset BEFORE any early return. A path that exits without publishing would
    // leave the PREVIOUS load's counts standing — worse than zero, because the
    // consumer would then warn about data loss on a workspace that is fine.
    this.lastLoadTruncation = { entries: 0, blocks: 0 };
    this.lastDecodeFailures = [];
    if (typeof window === "undefined") return emptyWorkspace();

    const diag: DocTruncationDiag = {};
    // §620 — same accumulator and rule as `jsonToWorkspace` (see
    // `meta-slice-decode.ts`'s `sanitizedToNothing`): a stored slice that
    // carried content and sanitized to nothing is dropped in silence and the
    // next save writes the file/DB without it. This backend reads each slice
    // independently (no single `jsonToWorkspace` call to record it centrally),
    // so it binds the shared `noteIfSanitizedToNothing` helper to this `diag`.
    const noteIfDropped = (key: string, rawValue: unknown, sanitized: unknown): void =>
      noteIfSanitizedToNothing(key, rawValue, sanitized, diag);
    let tasks: readonly Task[] = [];
    let raid: readonly RaidItem[] = [];
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
    let fieldVisibility: Workspace["fieldVisibility"] | undefined;
    let features: readonly FeatureModuleId[] | undefined;
    let steeringCommittee: SteeringCommittee | undefined;
    let timelogLinks: Workspace["timelogLinks"] | undefined;
    let knowledgeItems: Workspace["knowledgeItems"] | undefined;
    let insights: Workspace["insights"] | undefined;
    let settingsOverrides: Workspace["settingsOverrides"] | undefined;
    let calendarEvents: Workspace["calendarEvents"] | undefined;
    let documents: Workspace["documents"] | undefined;
    let documentVersions: Workspace["documentVersions"] | undefined;
    let activityLog: Workspace["activityLog"] | undefined;
    let budgetHistory: Workspace["budgetHistory"] | undefined;
    let documentAssets: Workspace["documentAssets"] | undefined;
    // §4 — stamped by `save()`; missing (never saved yet) → 0.
    let revision = 0;
    // §4 fix round 1 (R10 change 5) — true only once EVERY read/sanitize step
    // in the try below has completed without throwing (set at the very end of
    // the try, never inside it). A throw anywhere in the try — including the
    // revision read itself — means the returned workspace is a FALLBACK
    // (defaults/partial state, per the outer catch's comment), and adopting
    // the revision that was read moments before that failure would let this
    // instance's next save pass the compare while overwriting real data with
    // that fallback. Guarded by fail-closed (R10 change 1): `false` here
    // leaves `currentRevision` at `null` (see the end of this method), so the
    // next save on this instance REFUSES instead of silently winning.
    let dataLoadSucceeded = false;
    try {
      // §4 fix round 1 — read BEFORE the parallel data reads below, in its
      // OWN await/transaction, not alongside them in the same Promise.all.
      // `idbGet`/`idbGetAll` (idb.ts) each open their own IDB transaction, so
      // that Promise.all is not one snapshot: reading the revision LAST let a
      // load that overlapped another tab's locked save adopt the NEWER
      // revision while the data reads below it had already (or would still)
      // observe a MIX of old and new rows — a torn load that then adopts a
      // revision consistent with data it never actually read. This instance's
      // next save would pass the compare against that adopted revision and
      // silently rewrite every KV blob (and any row both writers touched).
      // Reading it first instead means a torn load can only adopt an OLDER
      // revision than what's really stored — this instance's next save then
      // fails safe as a spurious (but never silently-clobbering) conflict.
      const idbRevision = await idbGet<number>(KV_REVISION_KEY);
      revision = idbRevision ?? 0;

      // Independent stores/keys — fetch in parallel instead of ~16 awaits in
      // sequence. Result assembly below keeps the original order/defaults.
      const [
        idbTasks,
        idbRaid,
        idbAbsences,
        idbShifts,
        idbResources,
        idbRoles,
        idbDisciplines,
        idbGrades,
        idbPlan,
        idbBudgets,
        idbFxRates,
        idbStatus,
        idbMilestones,
        idbChanges,
        idbStakeholders,
        idbProject,
        idbFieldVisibility,
        idbFeatures,
        idbSteeringCommittee,
        idbTimelogLinks,
        idbKnowledgeItems,
        idbInsights,
        idbSettingsOverrides,
        idbCalendarEvents,
        idbDocuments,
        idbDocumentVersions,
        idbActivityLog,
        idbDocumentAssets,
        idbBudgetHistory,
      ] = await Promise.all([
        idbGetAll<Task>(IDB_TASKS_STORE),
        idbGetAll<RaidItem>(IDB_RAID_STORE),
        idbGetAll<Absence>(IDB_ABSENCES_STORE),
        idbGetAll<Shift>(IDB_SHIFTS_STORE),
        idbGetAll<Resource>(IDB_RESOURCES_STORE),
        idbGetAll<Role>(IDB_ROLES_STORE),
        idbGetAll<Discipline>(IDB_DISCIPLINES_STORE),
        idbGetAll<Grade>(IDB_GRADES_STORE),
        idbGet<ResourcePlan>(KV_PLAN_KEY),
        idbGetAll<BudgetBucket>(IDB_BUDGETS_STORE),
        idbGet<FxRates>(KV_FXRATES_KEY),
        idbGet<ProjectStatus>(KV_STATUS_KEY),
        idbGet<Milestone[]>(KV_MILESTONES_KEY),
        idbGet<ChangeItem[]>(KV_CHANGES_KEY),
        idbGet<Stakeholder[]>(KV_STAKEHOLDERS_KEY),
        idbGet(KV_PROJECT_KEY),
        idbGet(KV_FIELDVIS_KEY),
        idbGet(KV_FEATURES_KEY),
        idbGet(KV_STEERING_KEY),
        idbGet(KV_TIMELOG_LINKS_KEY),
        idbGet(KV_KNOWLEDGE_ITEMS_KEY),
        idbGet(KV_INSIGHTS_KEY),
        idbGet(KV_SETTINGS_OVERRIDES_KEY),
        idbGet(KV_CALENDAR_EVENTS_KEY),
        idbGet(KV_DOCUMENTS_KEY),
        idbGet(KV_DOCUMENT_VERSIONS_KEY),
        idbGet(KV_ACTIVITY_LOG_KEY),
        idbGet(KV_DOCUMENT_ASSETS_KEY),
        idbGet(KV_BUDGET_HISTORY_KEY),
      ]);
      tasks = idbTasks;
      raid = idbRaid;
      absences = idbAbsences;
      shifts = idbShifts;
      resources = idbResources;
      roles = idbRoles;
      disciplines = idbDisciplines;
      grades = idbGrades;
      // ★★ CURRENCY-ONLY coercion, and the "only" is load-bearing. This path
      // reads the KV plan blob VERBATIM and casts it — unlike `jsonToWorkspace`
      // and the CSV/MD/Turso decoders, it never runs `sanitizePlan`. Since
      // `ResourcePlan.currency` became the `BudgetCurrency` union, a workspace
      // stored before that narrowing can hold a value the type forbids ("CHF"),
      // which would make the declaration a lie on this backend. Do NOT
      // "complete the pattern" by calling `sanitizePlan` here: it would ALSO
      // clamp `granularity` to "month", replace the entire date window whenever
      // either date fails to parse, swap reversed dates, and DROP an explicit
      // `budgetFollowsPlan: false` — four unrelated rewrites on every load.
      // ★★ `storage-browser-kv.test.ts` pins TWO of those four, not all four:
      // the reversed window (a fixture whose end precedes its start, asserted
      // unswapped) and the dropped `budgetFollowsPlan: false`. The other two
      // are NOT covered. The granularity fixture seeds `"week"`, which
      // `sanitizePlan` PRESERVES (`raw.granularity === "week" ? "week" :
      // "month"`), so that assertion passes identically with or without the
      // call — only a granularity OUTSIDE the union would discriminate. And no
      // fixture carries a malformed date, so the date-window replacement is
      // unreachable there. Adding `sanitizePlan` here would still be wrong for
      // all four reasons; the suite would only go red for two of them.
      plan = idbPlan ? (isBudgetCurrency(idbPlan.currency) ? idbPlan : { ...idbPlan, currency: "EUR" }) : plan;
      budgets = idbBudgets;
      fxRates = idbFxRates ?? null;
      status = idbStatus ?? {};
      milestones = idbMilestones ?? [];
      changes = idbChanges ?? [];
      stakeholders = idbStakeholders ?? [];
      project = sanitizeLoadedProjectMeta(idbProject) ?? undefined;
      noteIfDropped("project", idbProject, project);
      // Optional singletons: junk/empty fieldVisibility sanitizes to undefined.
      fieldVisibility = sanitizeFieldVisibility(idbFieldVisibility);
      noteIfDropped("fieldVisibility", idbFieldVisibility, fieldVisibility);
      // Present-check: absent ⇒ undefined (no override); an explicit [] (Simple)
      // is preserved rather than expanded to all modules by sanitizeFeatures(undefined).
      if (idbFeatures !== undefined && idbFeatures !== null) {
        features = sanitizeFeatures(idbFeatures);
        noteIfDropped("features", idbFeatures, features);
      } else {
        features = undefined;
      }
      // Optional singleton: junk/empty committee sanitizes to undefined.
      steeringCommittee = sanitizeSteeringCommittee(idbSteeringCommittee);
      noteIfDropped("steeringCommittee", idbSteeringCommittee, steeringCommittee);
      // Optional singleton: junk/empty links sanitize to undefined.
      timelogLinks = sanitizeTimelogLinks(idbTimelogLinks);
      noteIfDropped("timelogLinks", idbTimelogLinks, timelogLinks);
      // Optional list: junk/empty knowledge items sanitize to [] → keep undefined.
      {
        const ki = sanitizeKnowledgeItems(idbKnowledgeItems);
        noteIfDropped("knowledgeItems", idbKnowledgeItems, ki);
        knowledgeItems = ki.length ? ki : undefined;
      }
      // Optional list: junk/empty insights sanitize to [] → keep undefined.
      {
        const ins = sanitizeInsights(idbInsights);
        noteIfDropped("insights", idbInsights, ins);
        insights = ins.length ? ins : undefined;
      }
      // Optional singleton: junk/empty overrides sanitize to {} → keep undefined.
      {
        const so = sanitizeOverridesOrNone(idbSettingsOverrides);
        noteIfDropped("settingsOverrides", idbSettingsOverrides, so);
        settingsOverrides = so;
      }
      // Optional list: garbage rows dropped individually (sanitizeLoadedCalendarEvent
      // never throws); junk/empty list sanitizes to [] → keep undefined.
      {
        const rawEvents = Array.isArray(idbCalendarEvents) ? idbCalendarEvents : [];
        const evs = rawEvents
          .map((e) => sanitizeLoadedCalendarEvent(e))
          .filter((e): e is CalendarEvent => e !== null);
        calendarEvents = evs.length ? evs : undefined;
      }
      // Optional list: junk/empty documents sanitize to [] → keep undefined.
      // TWO passes, in this order: the structural sanitizer is DOM-FREE by
      // contract, so the paragraph HTML allow-list has to run after it as a
      // separate map. Structural-only would pass stored `<script>` straight
      // through to the render sink.
      // ★★★ §620 — the rich-field pass is the ONLY DOM-dependent step here, and
      // it needs its OWN catch, exactly like `jsonToWorkspace` (workspace.ts).
      // Without one, a throw here reached the outer `catch` below, which treats
      // it as "IDB unavailable" and falls through — so `documentVersions`,
      // `activityLog`, `budgetHistory` and `documentAssets` (every slice
      // processed AFTER this one) never even got sanitized that load, nothing
      // was recorded, saving was not paused, and the next save deleted all of
      // them from IDB for good. Scoped to THIS pass only, never widened: a
      // broader catch would swallow a real IDB failure the outer one exists to
      // report.
      try {
        const docs = sanitizeProjectDocumentsWithDiag(idbDocuments, diag).map(sanitizeDocumentRichFields);
        noteIfDropped("documents", idbDocuments, docs);
        documents = docs.length ? docs : undefined;
      } catch (err) {
        logDiag("error", "workspace.documentsDropped", {
          message: err instanceof Error ? err.message : String(err),
        });
        noteDecodeFailure("documents", diag);
      }
      // Optional list: junk/empty versions sanitize to [] → keep undefined.
      // Same two-pass shape as documents just above — sanitizeDocumentVersions
      // enforces structure (DOM-free), then each version's blocks get the
      // paragraph HTML allow-list via sanitizeDocumentRichFields. A version has
      // no independent createdAt/updatedAt, so it is passed through a synthetic
      // ProjectDocument-shaped wrapper with savedAt standing in for both.
      // ★ Same containment as documents just above, for the same reason.
      try {
        const versions = sanitizeDocumentVersionsWithDiag(idbDocumentVersions, diag).map((v) => ({
          ...v,
          blocks: sanitizeDocumentRichFields({
            id: v.documentId,
            title: v.title,
            blocks: v.blocks,
            createdAt: v.savedAt,
            updatedAt: v.savedAt,
          }).blocks,
        }));
        noteIfDropped("documentVersions", idbDocumentVersions, versions);
        documentVersions = versions.length ? versions : undefined;
      } catch (err) {
        logDiag("error", "workspace.documentVersionsDropped", {
          message: err instanceof Error ? err.message : String(err),
        });
        noteDecodeFailure("documentVersions", diag);
      }
      // Optional list: junk/empty entries sanitize to [] → keep undefined, so a
      // cleared log reads as absent rather than as an empty array.
      {
        const log = sanitizeActivityLog(idbActivityLog);
        noteIfDropped("activityLog", idbActivityLog, log);
        activityLog = log.length ? log : undefined;
      }
      // Same optional-list shape for the budget history (never capped).
      {
        const history = sanitizeBudgetHistory(idbBudgetHistory);
        noteIfDropped("budgetHistory", idbBudgetHistory, history);
        budgetHistory = history.length ? history : undefined;
      }
      // Optional list: garbage rows dropped individually (sanitizeDocumentAsset
      // never throws); junk/empty list sanitizes to [] → keep undefined.
      {
        const rawAssets = Array.isArray(idbDocumentAssets) ? idbDocumentAssets : [];
        const assets = rawAssets
          .map((a) => sanitizeDocumentAsset(a))
          .filter((a): a is DocumentAsset => a !== null);
        documentAssets = assets.length ? assets : undefined;
      }
      // R10 change 5 — reached only when every read/sanitize step above
      // completed. The per-slice `documents`/`documentVersions` catches above
      // do NOT prevent this: they swallow their own throw and continue, so a
      // dropped rich-field slice does not make the CORE data read a failure.
      dataLoadSucceeded = true;
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

    // Migrate legacy task rows (IDB or localStorage) lacking a workflow status
    // to a valid TaskStatus before assembling the workspace.
    tasks = tasks.map(migrateTask);
    // Untrusted-import boundary: an imported/attacker-crafted IDB workspace can
    // carry malicious sanitized-HTML fields (noteLog[].html + every rich field —
    // RAID description/mitigation, change description/impactDescription/
    // resolutionNotes, milestone description) that the whole-object read would
    // pass through verbatim — scrub them like the CSV/MD/Turso load paths do
    // (idempotent on already-clean data). Changes and milestones are cast
    // verbatim HERE (unlike jsonToWorkspace, which runs their entity sanitizers),
    // so this is their ONLY normalisation on this backend.
    tasks = tasks.map(sanitizeNoteFields);
    raid = raid.map(sanitizeRaidRichFields);
    changes = changes.map(sanitizeChangeRichFields);
    milestones = milestones.map(sanitizeMilestoneRichFields);
    // Spec Part 2: this backend casts these arrays WITHOUT a record sanitizer,
    // so the email-shape normaliser the other five paths get from their
    // sanitizers runs here explicitly. The scalar fields only get `Name <addr>`
    // unwrapped; a resource's `emails` list also has multi-address members
    // split, members that repeat the primary dropped, and the list capped
    // (`withNormalizedResourceEmails`).
    absences = absences.map((a) => withNormalizedEmailField(a, "assigneeEmail"));
    shifts = shifts.map((s) => withNormalizedEmailField(s, "assigneeEmail"));
    raid = raid.map((r) => withNormalizedEmailField(r, "ownerEmail"));
    stakeholders = stakeholders.map((s) => withNormalizedEmailField(s, "email"));
    resources = resources.map((r) => withNormalizedResourceEmails(r));
    // §486 — only a literal `true` opts out; every one of these five is cast verbatim here.
    tasks = tasks.map(withLiteralCalendarOptOut);
    raid = raid.map(withLiteralCalendarOptOut);
    absences = absences.map(withLiteralCalendarOptOut);
    milestones = milestones.map(withLiteralCalendarOptOut);
    changes = changes.map(withLiteralCalendarOptOut);
    const raw: Workspace = { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, milestones, changes, stakeholders };
    if (project) raw.project = project;
    if (fieldVisibility) raw.fieldVisibility = fieldVisibility;
    if (features !== undefined) raw.features = features;
    if (steeringCommittee) raw.steeringCommittee = steeringCommittee;
    if (timelogLinks) raw.timelogLinks = timelogLinks;
    if (knowledgeItems) raw.knowledgeItems = knowledgeItems;
    if (insights) raw.insights = insights;
    if (settingsOverrides) raw.settingsOverrides = settingsOverrides;
    if (calendarEvents) raw.calendarEvents = calendarEvents;
    if (documents) raw.documents = documents;
    if (documentVersions) raw.documentVersions = documentVersions;
    if (activityLog) raw.activityLog = activityLog;
    if (budgetHistory) raw.budgetHistory = budgetHistory;
    if (documentAssets) raw.documentAssets = documentAssets;
    const ws = migrateWorkspaceV10(raw);

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
    // §4 fix round 1 (R10 change 5) — adopt the revision this load actually
    // saw ONLY when the data read that revision was paired with genuinely
    // succeeded. On the IDB-unavailable/fallback path `revision` may still
    // hold a real number (the revision read can succeed before a LATER data
    // read fails), but the workspace just assembled is a fallback, not what
    // that revision describes — adopting it would let this instance's next
    // save pass the compare while silently overwriting real data with that
    // fallback. Leaving it `null` (UNKNOWN) means the next save on this
    // instance fails closed (R10 change 1) instead.
    this.currentRevision = dataLoadSucceeded ? revision : null;
    // §4 fix round 3 (Important #1) — a genuine successful load is a real new
    // baseline; any forced-write intent left over from an earlier FAILED
    // forced save must not silently carry forward past it (e.g. a forced
    // save that failed, then another tab saves, then THIS instance reloads —
    // the next save here must compare again, not blindly full-rewrite over
    // what the other tab just wrote). Only on the genuinely-succeeded path:
    // a failed/fallback load establishes nothing new, so a pending force
    // (still exactly as valid or invalid as before) is left untouched.
    if (dataLoadSucceeded) { this.forceNext = false; this.expectNext = null; }
    this.lastLoadTruncation = {
      entries: diag.truncatedEntries ?? 0,
      blocks: diag.truncatedBlocks ?? 0,
    };
    this.lastDecodeFailures = diag.decodeFailedSlices ?? [];
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

  /**
   * §4 — the save, as ONE readwrite IndexedDB transaction (`idbTransaction`) over the `kv` store and
   * every record store. Inside it: read the STORED revision and compare it with this instance's own; a
   * mismatch means another writer (another tab or window) saved since this instance last loaded or wrote,
   * so the transaction is aborted and `SaveConflictError` thrown: nothing is written. Otherwise every
   * slice's writes and the new revision (`stored + 1`) are issued in the same transaction, which commits
   * all of them or none; the baselines refresh and the revision is adopted only once it has committed.
   *
   * ★★★ §4 round 7 — NO WEB LOCK, AND NOTHING AWAITED BEFORE THE CONNECTION IS REQUESTED. This used to
   *   take the Web Lock `aipm-cockpit:save:browser`, read the revision in a transaction of its own, then
   *   write through ~30 more connections. Measured in Chromium (e2e/pagehide-draft-persist.spec.ts, "a tab
   *   close whose own IndexedDB write also landed"): with either the lock wait OR the separate revision
   *   read in front of the writes, a save started by the pagehide flush of a CLOSING tab never reached
   *   the store; with neither, it did. One transaction keeps the compare-and-set atomic by itself, since
   *   readwrite transactions over overlapping stores run one at a time across tabs.
   *
   * §4 fix round 1 (R10 change 1, fail closed) — `currentRevision === null` means UNKNOWN (never loaded,
   * and not adopted or forced), and REFUSES rather than skipping the compare. An intentional blind write
   * (Save-As, create, demo, a storage conversion) goes through `forceNextSave()`.
   *
   * `forceNextSave()` (one-shot) skips the compare and makes this save a full rewrite: every id-keyed
   * store is CLEARED inside the transaction (its real contents, not this instance's possibly-stale
   * baseline), so a row only a concurrent writer had does not survive. A conditional Overwrite
   * (`forceNextSave(expected)`) is the same full rewrite, but only while storage is still at `expected`.
   * The force flag is cleared only after the transaction committed (R10 change 4), so a forced save
   * that fails keeps it for the retry.
   */
  save(ws: Workspace): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    const force = this.forceNext;
    const expected = this.expectNext;
    this.expectNext = null;
    const rewrite = force || expected !== null;
    const from = <T>(baseline: Map<number, T>): Map<number, T> => (rewrite ? new Map() : baseline);
    const recordWrites: Array<[string, { puts: readonly { id: number }[]; deletes: readonly number[] }]> = [
      [IDB_TASKS_STORE, this.diff(from(this.tasksBaseline), ws.tasks)],
      [IDB_RAID_STORE, this.diff(from(this.raidBaseline), ws.raid)],
      [IDB_ABSENCES_STORE, this.diff(from(this.absencesBaseline), ws.absences)],
      [IDB_SHIFTS_STORE, this.diff(from(this.shiftsBaseline), ws.shifts)],
      [IDB_RESOURCES_STORE, this.diff(from(this.resourcesBaseline), ws.resources)],
      [IDB_ROLES_STORE, this.diff(from(this.rolesBaseline), ws.roles)],
      [IDB_DISCIPLINES_STORE, this.diff(from(this.disciplinesBaseline), ws.disciplines)],
      [IDB_GRADES_STORE, this.diff(from(this.gradesBaseline), ws.grades)],
      [IDB_BUDGETS_STORE, this.diff(from(this.budgetsBaseline), ws.budgets ?? [])],
    ];
    // Each KV slot: a value to put, or `undefined` to delete (a cleared config must not linger and reload stale).
    const kvWrites: Array<[string, unknown]> = [
      [KV_PLAN_KEY, ws.plan],
      [KV_FXRATES_KEY, ws.fxRates ?? null],
      [KV_STATUS_KEY, ws.status ?? {}],
      [KV_MILESTONES_KEY, ws.milestones ?? []],
      [KV_CHANGES_KEY, ws.changes ?? []],
      [KV_STAKEHOLDERS_KEY, ws.stakeholders ?? []],
      [KV_PROJECT_KEY, ws.project ?? undefined],
      [KV_FIELDVIS_KEY, ws.fieldVisibility && Object.keys(ws.fieldVisibility).length > 0 ? ws.fieldVisibility : undefined],
      [KV_FEATURES_KEY, ws.features], // presence gate, NOT length: [] is persisted (Simple mode)
      [KV_STEERING_KEY, ws.steeringCommittee || undefined],
      [KV_TIMELOG_LINKS_KEY, ws.timelogLinks || undefined],
      [KV_KNOWLEDGE_ITEMS_KEY, ws.knowledgeItems && ws.knowledgeItems.length ? ws.knowledgeItems : undefined],
      [KV_INSIGHTS_KEY, ws.insights && ws.insights.length ? ws.insights : undefined],
      [KV_SETTINGS_OVERRIDES_KEY, ws.settingsOverrides && hasAnyOverride(ws.settingsOverrides) ? ws.settingsOverrides : undefined],
      [KV_CALENDAR_EVENTS_KEY, ws.calendarEvents && ws.calendarEvents.length ? ws.calendarEvents : undefined],
      [KV_DOCUMENTS_KEY, ws.documents && ws.documents.length ? ws.documents : undefined],
      [KV_DOCUMENT_VERSIONS_KEY, ws.documentVersions && ws.documentVersions.length ? ws.documentVersions : undefined],
      [KV_ACTIVITY_LOG_KEY, ws.activityLog && ws.activityLog.length ? ws.activityLog : undefined],
      [KV_BUDGET_HISTORY_KEY, ws.budgetHistory && ws.budgetHistory.length ? ws.budgetHistory : undefined],
      [KV_DOCUMENT_ASSETS_KEY, ws.documentAssets && ws.documentAssets.length ? ws.documentAssets : undefined],
    ];
    let newRevision = 0;
    return idbTransaction([IDB_KV_STORE_NAME, ...recordWrites.map(([store]) => store)], (tx, fail) => {
      const kv = tx.objectStore(IDB_KV_STORE_NAME);
      const read = kv.get(KV_REVISION_KEY);
      read.onsuccess = () => {
        try {
          const storedRevision = (read.result as number | undefined) ?? 0;
          const stale = expected !== null ? String(storedRevision) !== expected : this.currentRevision === null || storedRevision !== this.currentRevision;
          if (!force && stale) {
            fail(new SaveConflictError("browser", String(storedRevision)));
            return;
          }
          for (const [storeName, delta] of recordWrites) {
            const store = tx.objectStore(storeName);
            if (rewrite) store.clear();
            for (const item of delta.puts) store.put(item);
            for (const id of delta.deletes) store.delete(id);
          }
          for (const [key, value] of kvWrites) {
            if (value === undefined) kv.delete(key);
            else kv.put(value, key);
          }
          newRevision = storedRevision + 1;
          kv.put(newRevision, KV_REVISION_KEY);
          // ★★★ §4 round 7 — COMMIT EXPLICITLY, the moment the last write is issued. Measured in Chromium: at a
          //   tab close a transaction left to AUTO-commit did not commit once it wrote more than one store,
          //   and this one does (e2e/pagehide-draft-persist.spec.ts); `commit()` lands it. Optional: an
          //   engine without it auto-commits as before.
          (tx as IDBTransaction & { commit?: () => void }).commit?.();
        } catch (err) {
          fail(err);
        }
      };
    }).then(() => {
      // Refresh baselines so the next save's diff is computed against what's actually in IDB.
      this.tasksBaseline = new Map(ws.tasks.map((t) => [t.id, t]));
      this.raidBaseline = new Map(ws.raid.map((r) => [r.id, r]));
      this.absencesBaseline = new Map(ws.absences.map((a) => [a.id, a]));
      this.shiftsBaseline = new Map(ws.shifts.map((s) => [s.id, s]));
      this.resourcesBaseline = new Map(ws.resources.map((r) => [r.id, r]));
      this.rolesBaseline = new Map(ws.roles.map((r) => [r.id, r]));
      this.disciplinesBaseline = new Map(ws.disciplines.map((d) => [d.id, d]));
      this.gradesBaseline = new Map(ws.grades.map((g) => [g.id, g]));
      this.budgetsBaseline = new Map((ws.budgets ?? []).map((b) => [b.id, b]));
      // §4 — adopt the revision and clear the force only now that the transaction committed (R10 change 4).
      if (force) this.forceNext = false;
      this.currentRevision = newRevision;
    });
  }

  /** §4 — the revision this instance last loaded or wrote; `null` before any load. */
  revision(): string | null {
    return this.currentRevision === null ? null : String(this.currentRevision);
  }

  /** §4 — adopt `rev` as this instance's current revision without a
   *  load/save. R10 change 7 — revisions are opaque strings to CALLERS, but
   *  this backend's own encoding is an integer, so anything not made ENTIRELY
   *  of digits (a stray local-file `"lastModified:size"` string handed to the
   *  wrong backend, garbage, `""`) is ignored rather than partially parsed —
   *  `Number.parseInt` would otherwise silently accept a numeric PREFIX
   *  (`"12abc"` → `12`) and adopt a fabricated baseline. */
  adoptRevision(rev: string): void {
    if (!/^\d+$/.test(rev)) return;
    this.currentRevision = Number.parseInt(rev, 10);
    // §4 fix round 3 — also clears `forceNext`: adopting a real revision from
    // elsewhere (e.g. catching up to another tab after a conflict) is a
    // genuine new baseline, same as a real load, so it must not leave a
    // stale forced-write intent standing.
    this.forceNext = false;
    this.expectNext = null;
  }

  /** §4 — make the next `save()` skip the revision compare and force a full
   *  rewrite (see `save()`), then clear itself (R10 change 4 — only
   *  once that save's write actually succeeds). */
  forceNextSave(expected?: string): void {
    if (expected !== undefined) { this.forceNext = false; this.expectNext = expected; return; }
    this.forceNext = true;
    this.expectNext = null;
  }

  /**
   * §4 fix round 1 (R10 change 3) — copies another `BrowserBackend`
   * instance's revision and per-store diff baselines, so a throwaway backend
   * used to perform an op can hand its resulting state to the LIVE instance
   * in one step. Same-class only, not part of `StorageBackend`. `other` must
   * have loaded or written the SAME (single shared) IndexedDB this instance
   * targets; this does not verify that itself.
   */
  adoptFrom(other: BrowserBackend): void {
    this.currentRevision = other.currentRevision;
    this.tasksBaseline = other.tasksBaseline;
    this.raidBaseline = other.raidBaseline;
    this.absencesBaseline = other.absencesBaseline;
    this.shiftsBaseline = other.shiftsBaseline;
    this.resourcesBaseline = other.resourcesBaseline;
    this.rolesBaseline = other.rolesBaseline;
    this.disciplinesBaseline = other.disciplinesBaseline;
    this.gradesBaseline = other.gradesBaseline;
    this.budgetsBaseline = other.budgetsBaseline;
    // §4 fix round 3 — adopting another instance's state establishes a fresh,
    // genuine baseline; a forced-write intent left over from THIS instance's
    // own past (failed) save no longer applies to it.
    this.forceNext = false;
    this.expectNext = null;
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
