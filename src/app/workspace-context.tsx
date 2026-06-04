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
import { defaultResourcePlan } from "./resource-foundation";
import {
  PRIORITY_RANK,
  type Absence,
  type BudgetBucket,
  type ChangeItem,
  type Discipline,
  type FxRates,
  type Grade,
  type Milestone,
  type ProjectStatus,
  type RaidItem,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Stakeholder,
  type Task,
} from "./types";

interface WorkspaceValue {
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;

  uniqueAssignees: string[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  tasksById: Map<number, Task>;
  taskSearchIndex: Map<number, string>;

  filteredSortedTasks: Task[];

  raid: RaidItem[];
  setRaid: Dispatch<SetStateAction<RaidItem[]>>;
  absences: Absence[];
  setAbsences: Dispatch<SetStateAction<Absence[]>>;
  shifts: Shift[];
  setShifts: Dispatch<SetStateAction<Shift[]>>;
  resources: Resource[];
  setResources: Dispatch<SetStateAction<Resource[]>>;
  roles: Role[];
  setRoles: Dispatch<SetStateAction<Role[]>>;
  disciplines: Discipline[];
  setDisciplines: Dispatch<SetStateAction<Discipline[]>>;
  grades: Grade[];
  setGrades: Dispatch<SetStateAction<Grade[]>>;
  plan: ResourcePlan;
  setPlan: Dispatch<SetStateAction<ResourcePlan>>;
  budgets: BudgetBucket[];
  setBudgets: Dispatch<SetStateAction<BudgetBucket[]>>;
  fxRates: FxRates | null;
  setFxRates: Dispatch<SetStateAction<FxRates | null>>;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
  milestones: Milestone[];
  setMilestones: Dispatch<SetStateAction<Milestone[]>>;
  changes: ChangeItem[];
  setChanges: Dispatch<SetStateAction<ChangeItem[]>>;

  stakeholders: Stakeholder[];
  setStakeholders: Dispatch<SetStateAction<Stakeholder[]>>;
}

const WorkspaceContext = createContext<WorkspaceValue | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [raid, setRaid] = useState<RaidItem[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [plan, setPlan] = useState<ResourcePlan>(() => defaultResourcePlan(new Date().toISOString().slice(0, 10)));
  const [budgets, setBudgets] = useState<BudgetBucket[]>([]);
  const [fxRates, setFxRates] = useState<FxRates | null>(null);
  const [status, setStatus] = useState<ProjectStatus>({});
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const {
    searchDebounced,
    priorityFilter,
    assigneeFilter,
    groupFilter,
    labelFilter,
    sortKey,
    sortDir,
  } = useFilters();

  const uniqueAssignees = useMemo(
    () =>
      Array.from(new Set(tasks.map((t) => t.assignee))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [tasks],
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
          t.assignee,
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
  }, [tasks]);

  const filteredSortedTasks = useMemo(() => {
    const q = searchDebounced.trim().toLowerCase();
    const filtered = tasks.filter((t) => {
      if (priorityFilter !== "All" && t.priority !== priorityFilter)
        return false;
      if (assigneeFilter !== "All" && t.assignee !== assigneeFilter)
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
      else if (sortKey === "startDate") {
        const av = a.startDate ?? "";
        const bv = b.startDate ?? "";
        if (av && !bv) cmp = -1;
        else if (!av && bv) cmp = 1;
        else if (!av && !bv) cmp = 0;
        else cmp = av.localeCompare(bv);
      } else cmp = a[sortKey].localeCompare(b[sortKey]);
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
  ]);

  const value: WorkspaceValue = {
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
    milestones, setMilestones,
    changes, setChanges,
    stakeholders, setStakeholders,
  };

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
