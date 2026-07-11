"use client";

import {
  createContext,
  useContext,
  useMemo,
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

  const uniqueAssignees = useMemo(
    () =>
      Array.from(new Set(tasks.map((t) => effectiveAssignee(t, resourcesById)))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [tasks, resourcesById],
  );

  const uniqueGroups = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((t) => (t.group ?? "").trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [tasks],
  );

  const uniqueLabels = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      for (const l of t.labels ?? []) {
        const clean = l.trim();
        if (clean) set.add(clean);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const tasksById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

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
          t.notes,
          t.group ?? "",
          (t.labels ?? []).join(" "),
        ]
          .join(" ")
          .toLowerCase(),
      );
    }
    return map;
  }, [tasks, resourcesById]);

  const filteredSortedTasks = useMemo(() => {
    const q = searchDebounced.trim().toLowerCase();
    const filtered = tasks.filter((t) => {
      if (priorityFilter !== "All" && t.priority !== priorityFilter)
        return false;
      if (assigneeFilter !== "All" && effectiveAssignee(t, resourcesById) !== assigneeFilter)
        return false;
      if (groupFilter !== "All" && (t.group ?? "") !== groupFilter)
        return false;
      if (
        labelFilter !== "All" &&
        !(t.labels ?? []).some(
          (l) => l.toLowerCase() === labelFilter.toLowerCase(),
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
      let cmp = 0;
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
      else cmp = a[sortKey].localeCompare(b[sortKey]);
      return cmp * dir;
    });
  }, [
    tasks,
    taskSearchIndex,
    searchDebounced,
    priorityFilter,
    assigneeFilter,
    groupFilter,
    labelFilter,
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
    }),
    [
      tasks,
      uniqueAssignees,
      uniqueGroups,
      uniqueLabels,
      tasksById,
      taskSearchIndex,
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
