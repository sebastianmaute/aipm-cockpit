"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { nextRaidId } from "./raid";
import { nextId } from "./resource-foundation";
import { DEFAULT_WEEK_HOURS, type Absence, type RaidItem, type Resource, type Role, type Shift, type Task } from "./types";
import type { ActivityKind } from "./activity-log";
import { useWorkspace } from "./workspace-context";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyAbsenceDraft(id: number): Absence {
  const today = isoToday();
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    startDate: today,
    endDate: today,
    type: "vacation",
    note: undefined,
  };
}

function emptyShiftDraft(id: number): Shift {
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    hoursPerWeekday: DEFAULT_WEEK_HOURS,
    note: undefined,
  };
}

export interface UseResourcePlannerArgs {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useResourcePlanner(args: UseResourcePlannerArgs) {
  const {
    tasks,
    setTasks,
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
    setPlan,
  } = useWorkspace();

  const langRef = useRef(args.lang);
  const logActivityRef = useRef(args.logActivity);
  const showToastRef = useRef(args.showToast);
  const tasksRef = useRef(tasks);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { logActivityRef.current = args.logActivity; }, [args.logActivity]);
  useEffect(() => { showToastRef.current = args.showToast; }, [args.showToast]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const [editingAbsence, setEditingAbsence] = useState<{
    absence: Absence;
    isNew: boolean;
  } | null>(null);

  const [editingShift, setEditingShift] = useState<{
    shift: Shift;
    isNew: boolean;
  } | null>(null);

  const handleSaveRaidItem = useCallback(
    (item: RaidItem) => {
      const stamp = new Date().toISOString();
      const previous = raid.find((r) => r.id === item.id);
      const idx = raid.findIndex((r) => r.id === item.id);
      const withStamp: RaidItem = { ...item, localModifiedAt: stamp };
      const baseList =
        idx < 0
          ? [...raid, withStamp]
          : raid.map((r) => (r.id === item.id ? withStamp : r));

      const triggersAutoIssue =
        previous !== undefined &&
        item.category === "R" &&
        previous.status !== "Realized" &&
        item.status === "Realized" &&
        !raid.some(
          (r) => r.category === "I" && r.causedByRaidIds.includes(item.id),
        );

      let autoIssueId: number | null = null;
      if (triggersAutoIssue) {
        const newIssueId = nextRaidId(baseList);
        autoIssueId = newIssueId;
        const today = isoToday();
        const autoIssue: RaidItem = {
          id: newIssueId,
          category: "I",
          title: item.title,
          description: item.description,
          severity: item.severity,
          status: "Open",
          owner: item.owner,
          ownerEmail: item.ownerEmail,
          mitigation: undefined,
          linkedTaskIds: [],
          causedByRaidIds: [item.id],
          raisedDate: today,
          targetDate: item.targetDate,
          localModifiedAt: stamp,
        };
        setRaid([...baseList, autoIssue]);
        showToastRef.current(
          "info",
          t(langRef.current, "raidAutoCreatedIssue", item.id, newIssueId),
        );
      } else {
        setRaid(baseList);
      }

      if (previous === undefined) {
        logActivityRef.current("raid.created", item.id, item.category, item.title);
      } else if (previous.status !== item.status) {
        logActivityRef.current(
          "raid.statusChanged",
          item.id,
          previous.status,
          item.status,
        );
      } else {
        logActivityRef.current("raid.updated", item.id, item.category, item.title);
      }
      if (autoIssueId !== null) {
        logActivityRef.current("raid.autoIssue", item.id, autoIssueId);
      }
    },
    [raid, setRaid],
  );

  const handleDeleteRaidItem = useCallback(
    (id: number) => {
      const removed = raid.find((r) => r.id === id);
      setRaid((prev) => prev.filter((r) => r.id !== id));
      if (removed) {
        logActivityRef.current("raid.deleted", id, removed.category, removed.title);
      }
    },
    [raid, setRaid],
  );

  const handleOpenAddAbsence = useCallback(
    (seed?: Partial<Absence>) => {
      const nextId =
        absences.length > 0 ? Math.max(...absences.map((a) => a.id)) + 1 : 1;
      const draft: Absence = {
        ...emptyAbsenceDraft(nextId),
        ...seed,
        id: nextId,
      };
      setEditingAbsence({ absence: draft, isNew: true });
    },
    [absences],
  );

  const handleEditAbsence = useCallback((absence: Absence) => {
    setEditingAbsence({ absence, isNew: false });
  }, []);

  const handleCloseAbsenceModal = useCallback(() => {
    setEditingAbsence(null);
  }, []);

  const handleSaveAbsence = useCallback(
    (next: Absence) => {
      const stamp = new Date().toISOString();
      const withStamp: Absence = { ...next, localModifiedAt: stamp };
      const existing = absences.find((a) => a.id === next.id);
      if (existing) {
        setAbsences((prev) =>
          prev.map((a) => (a.id === next.id ? withStamp : a)),
        );
        logActivityRef.current(
          "absence.updated",
          next.id,
          next.assignee,
          next.startDate,
          next.endDate,
        );
      } else {
        setAbsences((prev) => [...prev, withStamp]);
        logActivityRef.current(
          "absence.created",
          next.id,
          next.assignee,
          next.startDate,
          next.endDate,
        );
      }
      setEditingAbsence(null);
    },
    [absences, setAbsences],
  );

  const handleDeleteAbsence = useCallback(
    (id: number) => {
      const removed = absences.find((a) => a.id === id);
      setAbsences((prev) => prev.filter((a) => a.id !== id));
      if (removed) {
        logActivityRef.current("absence.deleted", id, removed.assignee);
      }
      setEditingAbsence(null);
    },
    [absences, setAbsences],
  );

  const handleOpenShiftEditor = useCallback(
    (existing: Shift | null, seed: { display: string; email: string }) => {
      if (existing) {
        setEditingShift({ shift: existing, isNew: false });
        return;
      }
      const nextId =
        shifts.length > 0 ? Math.max(...shifts.map((s) => s.id)) + 1 : 1;
      const draft: Shift = {
        ...emptyShiftDraft(nextId),
        assignee: seed.display,
        assigneeEmail: seed.email || undefined,
      };
      setEditingShift({ shift: draft, isNew: true });
    },
    [shifts],
  );

  const handleCloseShiftModal = useCallback(() => {
    setEditingShift(null);
  }, []);

  const handleSaveShift = useCallback(
    (next: Shift) => {
      const stamp = new Date().toISOString();
      const withStamp: Shift = { ...next, localModifiedAt: stamp };
      const existing = shifts.find((s) => s.id === next.id);
      if (existing) {
        setShifts((prev) =>
          prev.map((s) => (s.id === next.id ? withStamp : s)),
        );
        logActivityRef.current("shift.updated", next.id, next.assignee);
      } else {
        setShifts((prev) => [...prev, withStamp]);
        logActivityRef.current("shift.created", next.id, next.assignee);
      }
      setEditingShift(null);
    },
    [shifts, setShifts],
  );

  const handleDeleteShift = useCallback(
    (id: number) => {
      const removed = shifts.find((s) => s.id === id);
      setShifts((prev) => prev.filter((s) => s.id !== id));
      if (removed) {
        logActivityRef.current("shift.deleted", id, removed.assignee);
      }
      setEditingShift(null);
    },
    [shifts, setShifts],
  );

  const [editingResource, setEditingResource] = useState<{
    resource: Resource;
    isNew: boolean;
  } | null>(null);

  const handleOpenAddResource = useCallback(
    (seed?: Partial<Resource>) => {
      const id = nextId(resources);
      const draft: Resource = {
        firstName: "",
        lastName: "",
        roleId: null,
        utilizationMode: "percent",
        utilization: {},
        ...seed,
        id, // authoritative regardless of seed
      };
      setEditingResource({ resource: draft, isNew: true });
    },
    [resources],
  );

  const handleEditResource = useCallback((resource: Resource) => {
    setEditingResource({ resource, isNew: false });
  }, []);

  const handleCloseResourceModal = useCallback(() => setEditingResource(null), []);

  const handleSaveResource = useCallback(
    (next: Resource) => {
      const stamp = new Date().toISOString();
      const withStamp: Resource = { ...next, localModifiedAt: stamp };
      setResources((prev) => {
        const exists = prev.some((r) => r.id === next.id);
        return exists
          ? prev.map((r) => (r.id === next.id ? withStamp : r))
          : [...prev, withStamp];
      });
      setEditingResource(null);
    },
    [setResources],
  );

  const handleDeleteResource = useCallback(
    (id: number) => {
      setResources((prev) => prev.filter((r) => r.id !== id));
      setEditingResource(null);
    },
    [setResources],
  );

  const [rolesModalOpen, setRolesModalOpen] = useState(false);
  const handleOpenRolesModal = useCallback(() => setRolesModalOpen(true), []);
  const handleCloseRolesModal = useCallback(() => setRolesModalOpen(false), []);

  const resolveOrCreateRole = useCallback(
    (disciplineId: number, gradeId: number): number => {
      const existing = roles.find(
        (r) => r.disciplineId === disciplineId && r.gradeId === gradeId,
      );
      if (existing) return existing.id;
      const id = nextId(roles);
      const role: Role = {
        id,
        disciplineId,
        gradeId,
        internalRate: 0,
        externalRate: 0,
        localModifiedAt: new Date().toISOString(),
      };
      setRoles((prev) => [...prev, role]);
      return id;
    },
    [roles, setRoles],
  );

  const handleSaveRole = useCallback(
    (role: Role) => {
      const stamp = new Date().toISOString();
      setRoles((prev) =>
        prev.map((r) => (r.id === role.id ? { ...role, localModifiedAt: stamp } : r)),
      );
    },
    [setRoles],
  );

  const handleDeleteRole = useCallback(
    (id: number) => {
      const stamp = new Date().toISOString();
      setRoles((prev) => prev.filter((r) => r.id !== id));
      setResources((prev) =>
        prev.map((r) =>
          r.roleId === id ? { ...r, roleId: null, localModifiedAt: stamp } : r,
        ),
      );
    },
    [setRoles, setResources],
  );

  const handleAssignResourceRole = useCallback(
    (resourceId: number, disciplineId: number, gradeId: number) => {
      const roleId = resolveOrCreateRole(disciplineId, gradeId);
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) =>
          r.id === resourceId ? { ...r, roleId, localModifiedAt: stamp } : r,
        ),
      );
    },
    [resolveOrCreateRole, setResources],
  );

  const handleClearResourceRole = useCallback(
    (resourceId: number) => {
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) =>
          r.id === resourceId ? { ...r, roleId: null, localModifiedAt: stamp } : r,
        ),
      );
    },
    [setResources],
  );

  const handleAddDiscipline = useCallback(
    (name: string): number | null => {
      const clean = name.trim();
      if (!clean) return null;
      const id = nextId(disciplines);
      setDisciplines((prev) => [
        ...prev,
        { id, name: clean, localModifiedAt: new Date().toISOString() },
      ]);
      return id;
    },
    [disciplines, setDisciplines],
  );

  const handleRenameDiscipline = useCallback(
    (id: number, name: string) => {
      const clean = name.trim();
      if (!clean) return;
      const stamp = new Date().toISOString();
      setDisciplines((prev) =>
        prev.map((d) => (d.id === id ? { ...d, name: clean, localModifiedAt: stamp } : d)),
      );
    },
    [setDisciplines],
  );

  const handleAddGrade = useCallback(
    (name: string): number | null => {
      const clean = name.trim();
      if (!clean) return null;
      const id = nextId(grades);
      setGrades((prev) => [
        ...prev,
        { id, name: clean, localModifiedAt: new Date().toISOString() },
      ]);
      return id;
    },
    [grades, setGrades],
  );

  const handleRenameGrade = useCallback(
    (id: number, name: string) => {
      const clean = name.trim();
      if (!clean) return;
      const stamp = new Date().toISOString();
      setGrades((prev) =>
        prev.map((g) => (g.id === id ? { ...g, name: clean, localModifiedAt: stamp } : g)),
      );
    },
    [setGrades],
  );

  const onDeleteDiscipline = useCallback((id: number) => {
    setDisciplines((prev) => prev.filter((d) => d.id !== id));
    setRoles((prev) => prev.map((r) =>
      r.disciplineId === id ? { ...r, disciplineId: 0, internalRate: 0, externalRate: 0 } : r,
    ));
  }, [setDisciplines, setRoles]);

  const onDeleteGrade = useCallback((id: number) => {
    setGrades((prev) => prev.filter((g) => g.id !== id));
    setRoles((prev) => prev.map((r) =>
      r.gradeId === id ? { ...r, gradeId: 0, internalRate: 0, externalRate: 0 } : r,
    ));
  }, [setGrades, setRoles]);

  const onReorderDisciplines = useCallback((orderedIds: number[]) => {
    setDisciplines((prev) =>
      orderedIds
        .map((id) => prev.find((d) => d.id === id))
        .filter((d): d is (typeof prev)[number] => !!d),
    );
  }, [setDisciplines]);

  const onReorderGrades = useCallback((orderedIds: number[]) => {
    setGrades((prev) =>
      orderedIds
        .map((id) => prev.find((g) => g.id === id))
        .filter((g): g is (typeof prev)[number] => !!g),
    );
  }, [setGrades]);

  const handleCreateMitigationTaskFromRaid = useCallback(
    (raidItemId: number): number | null => {
      const item = raid.find((r) => r.id === raidItemId);
      if (!item) return null;
      const list = tasksRef.current;
      const newId =
        list.length > 0 ? Math.max(...list.map((tk) => tk.id)) + 1 : 1;
      const stamp = new Date().toISOString();
      const today = isoToday();
      const newTask: Task = {
        id: newId,
        taskName: item.title,
        assignee: item.owner ?? "",
        assigneeEmail: item.ownerEmail ?? "",
        dueDate: item.targetDate ?? today,
        lastUpdateDate: today,
        priority: "Medium",
        blockers: "",
        notes: item.mitigation ?? item.description ?? "",
        inquiriesSent: 0,
        localModifiedAt: stamp,
      };
      const nextList = [...list, newTask];
      tasksRef.current = nextList;
      setTasks(nextList);
      setRaid((prev) =>
        prev.map((r) =>
          r.id === raidItemId
            ? {
                ...r,
                linkedTaskIds: [...r.linkedTaskIds, newId],
                localModifiedAt: stamp,
              }
            : r,
        ),
      );
      return newId;
    },
    [raid, setRaid, setTasks],
  );

  const handleSetUtilization = useCallback(
    (resourceId: number, periodKey: string, value: number) => {
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) =>
          r.id === resourceId
            ? { ...r, utilization: { ...r.utilization, [periodKey]: value }, localModifiedAt: stamp }
            : r,
        ),
      );
    },
    [setResources],
  );

  const handleSetUtilizationMode = useCallback(
    (resourceId: number, mode: "percent" | "hours") => {
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) =>
          r.id === resourceId ? { ...r, utilizationMode: mode, localModifiedAt: stamp } : r,
        ),
      );
    },
    [setResources],
  );

  const handleSetAbsenceOverride = useCallback(
    (resourceId: number, periodKey: string, hours: number | null) => {
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) => {
          if (r.id !== resourceId) return r;
          const next = { ...(r.absenceOverride ?? {}) };
          if (hours == null) delete next[periodKey];
          else next[periodKey] = hours;
          const out = { ...r, localModifiedAt: stamp } as typeof r;
          if (Object.keys(next).length > 0) out.absenceOverride = next;
          else delete out.absenceOverride;
          return out;
        }),
      );
    },
    [setResources],
  );

  const handleSetPlanWindow = useCallback(
    (startDate: string, endDate: string) => {
      setPlan((prev) => ({ ...prev, startDate, endDate }));
    },
    [setPlan],
  );

  const handleSetPlanGranularity = useCallback(
    (granularity: "week" | "month") => {
      setPlan((prev) => ({ ...prev, granularity }));
    },
    [setPlan],
  );

  return {
    editingAbsence,
    editingShift,
    editingResource,
    handleOpenAddResource,
    handleEditResource,
    handleCloseResourceModal,
    handleSaveResource,
    handleDeleteResource,
    handleSaveRaidItem,
    handleDeleteRaidItem,
    handleOpenAddAbsence,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
    rolesModalOpen,
    handleOpenRolesModal,
    handleCloseRolesModal,
    resolveOrCreateRole,
    handleSaveRole,
    handleDeleteRole,
    handleAssignResourceRole,
    handleClearResourceRole,
    handleAddDiscipline,
    handleRenameDiscipline,
    handleAddGrade,
    handleRenameGrade,
    onDeleteDiscipline,
    onDeleteGrade,
    onReorderDisciplines,
    onReorderGrades,
    handleSetUtilization,
    handleSetUtilizationMode,
    handleSetAbsenceOverride,
    handleSetPlanWindow,
    handleSetPlanGranularity,
  };
}
