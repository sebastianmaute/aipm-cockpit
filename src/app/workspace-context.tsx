"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useFilters } from "./filters-context";
import type { FeatureModuleId } from "./feature-modules";
import type { FieldVisibilityConfig } from "./field-visibility";
import { defaultResourcePlan, effectiveAssignee } from "./resource-foundation";
import { statusSortIndex } from "./task-status";
import { descriptionText } from "./rich-text-projection";
import { resolveEffectiveFilters, type TaskFilterValues } from "./task-filters";
import { isExternalTask } from "./task-external";
import { useSettings } from "./use-settings";
import {
  PRIORITY_RANK,
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
import type { TimelogLinks } from "./timelog-types";
import type { KnowledgeItem } from "./document-link";
import type { Insight } from "./insights/insight";
import type { ProjectDocument } from "./document-model";
import { applyDocMutation, type DocMutation, type DocResult } from "./document-mutations";
import type { DocVersion, DocVersionSource } from "./document-versions";
import { mintId } from "./id-mint-session";
import type { SettingsOverrides } from "./settings-types";
import type { CalendarEvent } from "./calendar-event";
import type { ActivityEntry } from "./activity-log";

/** Workspace-section state is `readonly X[]` on purpose: these arrays become
 *  the `Workspace` sections handed to storage, and the Turso dirty-table save
 *  detects changes by reference equality (see workspace.ts / turso-schema.ts).
 *  The readonly types make setter updaters replace arrays instead of mutating
 *  them in place. Derived lists (filteredSortedTasks, …) stay mutable — they
 *  are freshly built each memo run and never persisted. */
interface WorkspaceValue {
  tasks: readonly Task[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;

  uniqueAssignees: string[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  tasksById: Map<number, Task>;
  taskSearchIndex: Map<number, string>;

  /** The assignee/group/label filters with any value that no longer exists on a
   *  task resolved to "All". Drives BOTH `filteredSortedTasks` and the pane's
   *  filter <select>s, so an orphaned filter can never hide every row while the
   *  control renders blank. The raw values stay in FiltersProvider — saved views
   *  capture those, and restoring the tasks restores the filter. */
  effectiveFilters: TaskFilterValues;

  filteredSortedTasks: Task[];

  raid: readonly RaidItem[];
  setRaid: Dispatch<SetStateAction<readonly RaidItem[]>>;
  absences: readonly Absence[];
  setAbsences: Dispatch<SetStateAction<readonly Absence[]>>;
  shifts: readonly Shift[];
  setShifts: Dispatch<SetStateAction<readonly Shift[]>>;
  resources: readonly Resource[];
  setResources: Dispatch<SetStateAction<readonly Resource[]>>;
  roles: readonly Role[];
  setRoles: Dispatch<SetStateAction<readonly Role[]>>;
  disciplines: readonly Discipline[];
  setDisciplines: Dispatch<SetStateAction<readonly Discipline[]>>;
  grades: readonly Grade[];
  setGrades: Dispatch<SetStateAction<readonly Grade[]>>;
  plan: ResourcePlan;
  setPlan: Dispatch<SetStateAction<ResourcePlan>>;
  budgets: readonly BudgetBucket[];
  setBudgets: Dispatch<SetStateAction<readonly BudgetBucket[]>>;
  fxRates: FxRates | null;
  setFxRates: Dispatch<SetStateAction<FxRates | null>>;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
  project: ProjectMeta | undefined;
  setProject: Dispatch<SetStateAction<ProjectMeta | undefined>>;
  fieldVisibility: FieldVisibilityConfig | undefined;
  setFieldVisibility: Dispatch<SetStateAction<FieldVisibilityConfig | undefined>>;
  features: readonly FeatureModuleId[] | undefined;
  setFeatures: Dispatch<SetStateAction<readonly FeatureModuleId[] | undefined>>;
  milestones: readonly Milestone[];
  setMilestones: Dispatch<SetStateAction<readonly Milestone[]>>;
  changes: readonly ChangeItem[];
  setChanges: Dispatch<SetStateAction<readonly ChangeItem[]>>;

  stakeholders: readonly Stakeholder[];
  setStakeholders: Dispatch<SetStateAction<readonly Stakeholder[]>>;

  steeringCommittee: SteeringCommittee | undefined;
  setSteeringCommittee: Dispatch<SetStateAction<SteeringCommittee | undefined>>;

  timelogLinks: TimelogLinks | undefined;
  setTimelogLinks: Dispatch<SetStateAction<TimelogLinks | undefined>>;

  knowledgeItems: readonly KnowledgeItem[] | undefined;
  setKnowledgeItems: Dispatch<SetStateAction<readonly KnowledgeItem[] | undefined>>;

  insights: readonly Insight[] | undefined;
  setInsights: Dispatch<SetStateAction<readonly Insight[] | undefined>>;

  /** ★ NON-optional (`[]` when empty), unlike `insights`/`knowledgeItems` and
   *  unlike `Workspace.documents?` itself — it follows the
   *  milestones/changes/stakeholders precedent instead. The Documents panel
   *  spreads `prev` inside a functional setter, so an `undefined` state would
   *  make `setDocuments(prev => [...prev, x])` throw. Byte-stability is
   *  unaffected: `workspaceToJson` emits the key only when `length > 0`, so an
   *  empty `[]` still serializes to nothing. */
  documents: readonly ProjectDocument[];
  setDocuments: Dispatch<SetStateAction<readonly ProjectDocument[]>>;

  /** ★ NON-optional (`[]` when empty) for exactly the same reason `documents`
   *  is — callers spread `prev` inside functional setters, and an `undefined`
   *  state would throw. Byte stability is unaffected: `workspaceToJson` emits
   *  the key only when `length > 0`. */
  documentVersions: readonly DocVersion[];
  setDocumentVersions: Dispatch<SetStateAction<readonly DocVersion[]>>;

  /** THE document mutation entry point — shared by the Documents pane and the
   *  AI tools, so "every mutation snapshots a before-image" cannot be
   *  half-implemented by one caller mutating `documents` on its own. Returns
   *  the result SYNCHRONOUSLY so a tool can report `rejected` without waiting
   *  for the state it just wrote to come back round. */
  mutateDocuments: (m: DocMutation, source: DocVersionSource) => DocResult;

  settingsOverrides: Readonly<SettingsOverrides> | undefined;
  setSettingsOverrides: Dispatch<SetStateAction<Readonly<SettingsOverrides> | undefined>>;

  calendarEvents: readonly CalendarEvent[] | undefined;
  setCalendarEvents: Dispatch<SetStateAction<readonly CalendarEvent[] | undefined>>;

  /** ★ NON-optional (`[]` when empty), like `documents` — every writer appends
   *  through a functional setter (`setActivityLog(prev => appendActivity(prev,
   *  …))`), so an `undefined` state would throw. Byte-stability is unaffected:
   *  the serializers emit the section only when `length > 0`.
   *  ★★ The audit trail is PROJECT data now, not per-device: it lives here so
   *  the save effect persists it across all six write paths and a load can
   *  reconcile it (`mergeActivityLogs`). An in-place `push` would keep the
   *  array identity and the save effect's reference-equality dirty check would
   *  skip the write — hence the readonly type, as for every slice above. */
  activityLog: readonly ActivityEntry[];
  setActivityLog: Dispatch<SetStateAction<readonly ActivityEntry[]>>;
}

const WorkspaceContext = createContext<WorkspaceValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const [raid, setRaid] = useState<readonly RaidItem[]>([]);
  const [absences, setAbsences] = useState<readonly Absence[]>([]);
  const [shifts, setShifts] = useState<readonly Shift[]>([]);
  const [resources, setResources] = useState<readonly Resource[]>([]);
  const [roles, setRoles] = useState<readonly Role[]>([]);
  const [disciplines, setDisciplines] = useState<readonly Discipline[]>([]);
  const [grades, setGrades] = useState<readonly Grade[]>([]);
  const [plan, setPlan] = useState<ResourcePlan>(() => defaultResourcePlan(new Date().toISOString().slice(0, 10)));
  const [budgets, setBudgets] = useState<readonly BudgetBucket[]>([]);
  const [fxRates, setFxRates] = useState<FxRates | null>(null);
  const [status, setStatus] = useState<ProjectStatus>({});
  const [project, setProject] = useState<ProjectMeta | undefined>(undefined);
  const [fieldVisibility, setFieldVisibility] = useState<FieldVisibilityConfig | undefined>(undefined);
  const [features, setFeatures] = useState<readonly FeatureModuleId[] | undefined>(undefined);
  const [milestones, setMilestones] = useState<readonly Milestone[]>([]);
  const [changes, setChanges] = useState<readonly ChangeItem[]>([]);
  const [stakeholders, setStakeholders] = useState<readonly Stakeholder[]>([]);
  const [steeringCommittee, setSteeringCommittee] = useState<SteeringCommittee | undefined>(undefined);
  const [timelogLinks, setTimelogLinks] = useState<TimelogLinks | undefined>(undefined);
  const [knowledgeItems, setKnowledgeItems] = useState<readonly KnowledgeItem[] | undefined>(undefined);
  const [insights, setInsights] = useState<readonly Insight[] | undefined>(undefined);
  const [documents, setDocuments] = useState<readonly ProjectDocument[]>([]);
  const [documentVersions, setDocumentVersions] = useState<readonly DocVersion[]>([]);
  const [settingsOverrides, setSettingsOverrides] = useState<Readonly<SettingsOverrides> | undefined>(undefined);
  const [calendarEvents, setCalendarEvents] = useState<readonly CalendarEvent[] | undefined>(undefined);
  const [activityLog, setActivityLog] = useState<readonly ActivityEntry[]>([]);

  // ★★★ THE BEFORE-IMAGE CANNOT BE COMPUTED INSIDE A FUNCTIONAL SETTER.
  // `documents` and `documentVersions` are two separate setters, and the
  // snapshot a mutation replaces is only available while updating the FIRST
  // while it has to land in the SECOND. Reaching across from one updater to
  // the other makes it impure, and React StrictMode double-invokes updaters —
  // which would append the SAME version twice. So both slices are mirrored
  // into refs and composed here, in the one place that owns both.
  const documentsRef = useRef(documents);
  const documentVersionsRef = useRef(documentVersions);
  useEffect(() => { documentsRef.current = documents; }, [documents]);
  useEffect(() => { documentVersionsRef.current = documentVersions; }, [documentVersions]);

  const mutateDocuments = useCallback((m: DocMutation, source: DocVersionSource): DocResult => {
    const result = applyDocMutation(
      { documents: documentsRef.current, versions: documentVersionsRef.current },
      m,
      {
        now: new Date().toISOString(),
        source,
        mintDocId: () => mintId("document", documentsRef.current),
        mintVersionId: () => mintId("documentVersion", documentVersionsRef.current),
      },
    );
    if (!result.changed) return result;
    // ★★★ THE CALLBACK MUST WRITE THE REFS ITSELF — the mirroring effects above
    // are not enough. A second call in the SAME tick runs before React has
    // re-rendered, so a callback that left the refs to the effect would read
    // the pre-mutation state, snapshot the same stale before-image twice, and
    // build its `versions` from a list missing the first mutation's entry —
    // silently DROPPING it (measured: two renames in one tick yield one
    // version, not two). The effects then re-sync these very values, a no-op.
    // ★ Their POSITION relative to the two setters is NOT what matters, though
    // the obvious reading says otherwise: the setters are batched, so putting
    // the ref writes after them still lands both before the next call in the
    // tick. Measured — that swap alone leaves every test green.
    documentsRef.current = result.documents;
    documentVersionsRef.current = result.versions;
    setDocuments(result.documents);
    setDocumentVersions(result.versions);
    return result;
  }, []);

  const {
    searchDebounced,
    priorityFilter,
    assigneeFilter,
    groupFilter,
    labelFilter,
    sortKey,
    sortDir,
  } = useFilters();

  // Directory map for resolving a linked assignee's LIVE name — the stored
  // `assignee` string is a stale-able cache. The filter options, the filter
  // comparison, the search haystack, and the assignee sort all resolve through
  // this so a renamed linked resource is shown/searchable/filterable by its
  // current name consistently (mirrors the Gantt assignee handling).
  const resourcesById = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );

  // View-level "hide externals" is applied ONCE, here, so the row filter and
  // every derived option list share a single source and cannot drift — the
  // orphan-filter failure task-filters.ts exists to prevent.
  const { settings } = useSettings();
  const hideExternalTasks = settings.hideExternalTasks === true;
  const visibleTasks = useMemo(
    () => (hideExternalTasks ? tasks.filter((t) => !isExternalTask(t, resourcesById)) : tasks),
    [hideExternalTasks, tasks, resourcesById],
  );

  const uniqueAssignees = useMemo(
    () =>
      Array.from(new Set(visibleTasks.map((t) => effectiveAssignee(t, resourcesById)))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [visibleTasks, resourcesById],
  );

  const uniqueGroups = useMemo(
    () =>
      Array.from(
        new Set(visibleTasks.map((t) => (t.group ?? "").trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [visibleTasks],
  );

  const uniqueLabels = useMemo(() => {
    const set = new Set<string>();
    for (const t of visibleTasks) {
      for (const l of t.labels ?? []) {
        const clean = l.trim();
        if (clean) set.add(clean);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [visibleTasks]);

  // Deliberately stays on the FULL `tasks` list, not `visibleTasks`: a
  // dependency chip on a hidden external's task must still resolve its id to
  // a Task object so it can render a name, even though the task itself is
  // filtered out of the visible rows/options above.
  const tasksById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  // Deliberately stays on the FULL `tasks` list, not `visibleTasks`: this is a
  // keyed lookup (by task id), never iterated — a filtered-out row simply
  // isn't reached by filteredSortedTasks, so indexing it here costs nothing
  // and keeps the index usable for any future lookup that isn't row-filtered.
  const taskSearchIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of tasks) {
      map.set(
        t.id,
        [
          `#${t.id}`,
          t.taskName,
          effectiveAssignee(t, resourcesById),
          t.blockers,
          descriptionText(t.description),
          t.group ?? "",
          (t.labels ?? []).join(" "),
        ]
          .join(" ")
          .toLowerCase(),
      );
    }
    return map;
  }, [tasks, resourcesById]);

  // The assignee/group/label options are derived from the live tasks, so editing
  // the last task carrying a filtered-for value orphans the filter: it goes on
  // hiding every row while the <select>, left with no matching option, falls
  // back to "All" and stops explaining the empty table.
  // Resolve the value that can still match ONCE here and feed it to both the row
  // filter below and the pane's <select>, so the two cannot drift apart.
  const effectiveFilters = useMemo(
    () =>
      resolveEffectiveFilters(
        { assignee: assigneeFilter, group: groupFilter, label: labelFilter },
        { assignees: uniqueAssignees, groups: uniqueGroups, labels: uniqueLabels },
      ),
    [assigneeFilter, groupFilter, labelFilter, uniqueAssignees, uniqueGroups, uniqueLabels],
  );
  // Hoisted to scalars: exhaustive-deps rejects an `obj.member` dep.
  const effAssignee = effectiveFilters.assignee;
  const effGroup = effectiveFilters.group;
  const effLabel = effectiveFilters.label;

  const filteredSortedTasks = useMemo(() => {
    const q = searchDebounced.trim().toLowerCase();
    const filtered = visibleTasks.filter((t) => {
      if (priorityFilter !== "All" && t.priority !== priorityFilter)
        return false;
      if (effAssignee !== "All" && effectiveAssignee(t, resourcesById) !== effAssignee)
        return false;
      if (effGroup !== "All" && (t.group ?? "") !== effGroup)
        return false;
      if (
        effLabel !== "All" &&
        !(t.labels ?? []).some(
          (l) => l.toLowerCase() === effLabel.toLowerCase(),
        )
      )
        return false;
      if (q) {
        const haystack = taskSearchIndex.get(t.id) ?? "";
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.slice().sort((a, b) => {
      let cmp: number;
      if (sortKey === "id") cmp = a.id - b.id;
      else if (sortKey === "estimate")
        cmp = (a.originalEstimateMinutes ?? 0) - (b.originalEstimateMinutes ?? 0);
      else if (sortKey === "spent")
        cmp = (a.timeSpentMinutes ?? 0) - (b.timeSpentMinutes ?? 0);
      else if (sortKey === "priority")
        cmp = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      else if (sortKey === "taskStatus")
        cmp =
          statusSortIndex(a.status) - statusSortIndex(b.status) ||
          (a.id - b.id);
      else if (sortKey === "startDate") {
        const av = a.startDate ?? "";
        const bv = b.startDate ?? "";
        if (av && !bv) cmp = -1;
        else if (!av && bv) cmp = 1;
        else if (!av && !bv) cmp = 0;
        else cmp = av.localeCompare(bv);
      } else if (sortKey === "assignee")
        cmp = effectiveAssignee(a, resourcesById).localeCompare(effectiveAssignee(b, resourcesById));
      else if (sortKey === "createdDate")
        cmp = (a.createdDate ?? "").localeCompare(b.createdDate ?? "");
      else cmp = a[sortKey].localeCompare(b[sortKey]);
      return cmp * dir;
    });
  }, [
    visibleTasks,
    taskSearchIndex,
    searchDebounced,
    priorityFilter,
    effAssignee,
    effGroup,
    effLabel,
    sortKey,
    sortDir,
    resourcesById,
  ]);

  // Memoized container: useState setters are identity-stable and excluded
  // from deps; every data value (state slice or derived memo) is listed so
  // the value identity only changes when a consumer-visible input changes.
  const value: WorkspaceValue = useMemo(
    () => ({
      tasks,
      setTasks,
      uniqueAssignees,
      uniqueGroups,
      uniqueLabels,
      tasksById,
      taskSearchIndex,
      effectiveFilters,
      filteredSortedTasks,
      raid,
      setRaid,
      absences,
      setAbsences,
      shifts,
      setShifts,
      resources,
      setResources,
      roles,
      setRoles,
      disciplines,
      setDisciplines,
      grades,
      setGrades,
      plan,
      setPlan,
      budgets, setBudgets,
      fxRates, setFxRates,
      status, setStatus,
      project, setProject,
      fieldVisibility, setFieldVisibility,
      features, setFeatures,
      milestones, setMilestones,
      changes, setChanges,
      stakeholders, setStakeholders,
      steeringCommittee, setSteeringCommittee,
      timelogLinks, setTimelogLinks,
      knowledgeItems, setKnowledgeItems,
      insights, setInsights,
      documents, setDocuments,
      documentVersions, setDocumentVersions,
      mutateDocuments,
      settingsOverrides, setSettingsOverrides,
      calendarEvents, setCalendarEvents,
      activityLog, setActivityLog,
    }),
    [
      tasks,
      uniqueAssignees,
      uniqueGroups,
      uniqueLabels,
      tasksById,
      taskSearchIndex,
      effectiveFilters,
      filteredSortedTasks,
      raid,
      absences,
      shifts,
      resources,
      roles,
      disciplines,
      grades,
      plan,
      budgets,
      fxRates,
      status,
      project,
      fieldVisibility,
      features,
      milestones,
      changes,
      stakeholders,
      steeringCommittee,
      timelogLinks,
      knowledgeItems,
      insights,
      documents,
      documentVersions,
      mutateDocuments,
      settingsOverrides,
      calendarEvents,
      activityLog,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
