"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { nextRaidId } from "./raid";
import { nextId } from "./resource-foundation";
import { generatePeriods, convertUtilization } from "./resource-capacity";
import { DEFAULT_WEEK_HOURS, type Absence, type RaidItem, type Resource, type Role, type Shift, type Task } from "./types";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { useWorkspace } from "./workspace-context";
import { mergeImportedResources, type OutlookContact } from "./outlook-contacts";
import { eventsToAbsences, type AbsenceImportTarget, type OutlookEvent } from "./outlook-calendar";
import type { AbsenceType } from "./types";

// Envelope-level defense against a caller accidentally forwarding a DOM/synthetic
// event as `seed` (e.g. `onClick={onAddResource}`). Spreading an event injects a
// non-cloneable PointerEvent into persisted state, which then crashes
// BroadcastChannel's structured clone. Accept only a plain `{}`-literal envelope
// (this deliberately rejects the rare `Object.create(null)` too); it does NOT
// deep-check property values, so a plain object holding a DOM node still slips
// through — the real guard is not forwarding events in the first place. On
// rejection we warn in dev so a future recurrence surfaces loudly instead of
// degrading to a silently-blank Add draft.
function plainSeed<T>(seed: T | undefined): T | undefined {
  if (seed == null) return undefined;
  if (Object.getPrototypeOf(seed) === Object.prototype) return seed;
  if (process.env.NODE_ENV !== "production") {
    console.warn("[useResourcePlanner] non-plain seed dropped (event forwarded as seed?)", seed);
  }
  return undefined;
}

function emptyAbsenceDraft(id: number, today: string): Absence {
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
  /** Today (YYYY-MM-DD) in the resolved effective timezone, from the caller. */
  today: string;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
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
    plan,
    setPlan,
  } = useWorkspace();

  const { workdayHours, holidaySet, today } = args;

  const langRef = useRef(args.lang);
  const logActivityRef = useRef(args.logActivity);
  const logActivityChangesRef = useRef(args.logActivityChanges);
  const showToastRef = useRef(args.showToast);
  const tasksRef = useRef(tasks);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { logActivityRef.current = args.logActivity; }, [args.logActivity]);
  useEffect(() => { logActivityChangesRef.current = args.logActivityChanges; }, [args.logActivityChanges]);
  useEffect(() => { showToastRef.current = args.showToast; }, [args.showToast]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // Log an UPDATE with a per-field diff (#22) when a diff logger + previous
  // snapshot are available; else fall back to the plain (changes-less) log so
  // callers wiring only logActivity still record the event. Reads refs so it's
  // stable (useCallback []) and safe inside the memoised handlers.
  const logUpdate = useCallback(
    (
      kind: ActivityKind,
      previous: object | undefined,
      next: object,
      ...args: (string | number)[]
    ): void => {
      if (previous && logActivityChangesRef.current) {
        logActivityChangesRef.current(kind, diffFields(previous, next), ...args);
      } else {
        logActivityRef.current(kind, ...args);
      }
    },
    [],
  );

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
      const withStamp: RaidItem = { ...item, localModifiedAt: stamp };
      // Base off the CURRENT closure — used only to derive the auto-issue id; the
      // real write below uses a functional updater so bulk (N saves in one tick)
      // composes instead of each call clobbering the last.
      const baseList =
        raid.findIndex((r) => r.id === item.id) < 0
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
      let autoIssue: RaidItem | null = null;
      if (triggersAutoIssue) {
        autoIssueId = nextRaidId(baseList);
        autoIssue = {
          id: autoIssueId,
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
          stakeholderIds: [],
          raisedDate: today,
          targetDate: item.targetDate,
          localModifiedAt: stamp,
        };
      }

      setRaid((prev) => {
        const i = prev.findIndex((r) => r.id === item.id);
        const base = i < 0 ? [...prev, withStamp] : prev.map((r) => (r.id === item.id ? withStamp : r));
        return autoIssue ? [...base, autoIssue] : base;
      });
      if (autoIssue) {
        showToastRef.current(
          "info",
          t(langRef.current, "raidAutoCreatedIssue", item.id, autoIssueId ?? 0),
        );
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
        logUpdate("raid.updated", previous, withStamp, item.id, item.category, item.title);
      }
      if (autoIssueId !== null) {
        logActivityRef.current("raid.autoIssue", item.id, autoIssueId);
      }
    },
    [raid, setRaid, today, logUpdate],
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
        ...emptyAbsenceDraft(nextId, today),
        ...plainSeed(seed),
        id: nextId,
      };
      setEditingAbsence({ absence: draft, isNew: true });
    },
    [absences, today],
  );

  const handleImportAbsences = useCallback(
    (
      rows: readonly { event: OutlookEvent; type: AbsenceType }[],
      target: AbsenceImportTarget,
    ): void => {
      if (rows.length === 0) return;
      const stamp = new Date().toISOString();
      setAbsences((prev) => eventsToAbsences(rows, prev, target, stamp));
    },
    [setAbsences],
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
        logUpdate(
          "absence.updated",
          existing,
          withStamp,
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
    [absences, setAbsences, logUpdate],
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
        logUpdate("shift.updated", existing, withStamp, next.id, next.assignee);
      } else {
        setShifts((prev) => [...prev, withStamp]);
        logActivityRef.current("shift.created", next.id, next.assignee);
      }
      setEditingShift(null);
    },
    [shifts, setShifts, logUpdate],
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
        ...plainSeed(seed),
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
      const name = `${next.firstName} ${next.lastName}`.trim();
      // Decide create-vs-update by the KNOWN modal intent, not by id-existence:
      // the id is minted at modal-OPEN, so a concurrent writer (AI create_resource,
      // another tab, a bulk op) may have committed that id since. Deciding by
      // find(id) would misclassify this create as an update and clobber that row.
      // Non-modal callers (edit-from-anywhere) leave editingResource null → fall
      // back to id-existence, preserving their behavior.
      const isNew = editingResource?.isNew ?? (resources.find((r) => r.id === next.id) === undefined);
      if (isNew) {
        // Re-mint at SAVE time if the open-time id was taken since, so the append
        // can't collide with a row committed while the modal was open.
        const id = resources.some((r) => r.id === next.id) ? nextId(resources) : next.id;
        const created: Resource = { ...next, id, localModifiedAt: stamp };
        setResources((prev) => [...prev, created]);
        setEditingResource(null);
        logActivityRef.current("resource.created", id, name);
      } else {
        const previous = resources.find((r) => r.id === next.id);
        const withStamp: Resource = { ...next, localModifiedAt: stamp };
        setResources((prev) => prev.map((r) => (r.id === next.id ? withStamp : r)));
        setEditingResource(null);
        if (previous) logUpdate("resource.updated", previous, withStamp, next.id, name);
      }
    },
    [resources, setResources, logUpdate, editingResource],
  );

  const handleDeleteResource = useCallback(
    (id: number) => {
      const removed = resources.find((r) => r.id === id);
      setResources(resources.filter((r) => r.id !== id));
      setEditingResource(null);
      if (removed) {
        const name = `${removed.firstName} ${removed.lastName}`.trim();
        logActivityRef.current("resource.deleted", id, name);
      }
    },
    [resources, setResources],
  );

  // Bulk edit: merge the same patch into every selected resource in ONE
  // functional set (the N-saves-per-tick landmine — a non-functional setter
  // would drop all but the last).
  const handleBulkEditResources = useCallback(
    (ids: readonly number[], patch: Partial<Resource>) => {
      const idSet = new Set(ids);
      const stamp = new Date().toISOString();
      const affected = resources.filter((r) => idSet.has(r.id));
      setResources((prev) =>
        prev.map((r) => (idSet.has(r.id) ? { ...r, ...patch, localModifiedAt: stamp } : r)),
      );
      for (const r of affected) {
        logActivityRef.current("resource.updated", r.id, `${r.firstName} ${r.lastName}`.trim());
      }
    },
    [resources, setResources],
  );

  const handleBulkDeleteResources = useCallback(
    (ids: readonly number[]) => {
      const idSet = new Set(ids);
      const removed = resources.filter((r) => idSet.has(r.id));
      setResources((prev) => prev.filter((r) => !idSet.has(r.id)));
      setEditingResource(null);
      for (const r of removed) {
        logActivityRef.current("resource.deleted", r.id, `${r.firstName} ${r.lastName}`.trim());
      }
    },
    [resources, setResources],
  );

  const handleImportResources = useCallback(
    (selected: readonly OutlookContact[]): void => {
      if (selected.length === 0) return;
      setResources((prev) => mergeImportedResources(prev, selected));
    },
    [setResources],
  );

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
      logActivityRef.current("role.created", id, `${disciplineId}/${gradeId}`);
      return id;
    },
    [roles, setRoles],
  );

  const handleSaveRole = useCallback(
    (role: Role) => {
      const stamp = new Date().toISOString();
      const withStamp: Role = { ...role, localModifiedAt: stamp };
      const previous = roles.find((r) => r.id === role.id);
      setRoles((prev) =>
        prev.map((r) => (r.id === role.id ? withStamp : r)),
      );
      logUpdate("role.updated", previous, withStamp, role.id, `${role.disciplineId}/${role.gradeId}`);
    },
    [roles, setRoles, logUpdate],
  );

  const handleDeleteRole = useCallback(
    (id: number) => {
      const removed = roles.find((r) => r.id === id);
      const stamp = new Date().toISOString();
      setRoles((prev) => prev.filter((r) => r.id !== id));
      setResources((prev) =>
        prev.map((r) =>
          r.roleId === id ? { ...r, roleId: null, localModifiedAt: stamp } : r,
        ),
      );
      if (removed) {
        logActivityRef.current("role.deleted", id, `${removed.disciplineId}/${removed.gradeId}`);
      }
    },
    [roles, setRoles, setResources],
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

  // Directory single-role picker: assign an existing rate-card role directly by
  // id (or clear with null). Unlike handleAssignResourceRole this never mints a
  // role — new discipline/grade combos are authored in the rate-card editor.
  const handleAssignRoleById = useCallback(
    (resourceId: number, roleId: number | null) => {
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) =>
          r.id === resourceId ? { ...r, roleId, localModifiedAt: stamp } : r,
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

  // Rate-card row reorder: roles carry an explicit `order` field (not array
  // order) so the manual sequence survives Turso, which doesn't guarantee row
  // order without an ORDER BY. Rewrite each moved role's order to its new index.
  const onReorderRoles = useCallback((orderedIds: number[]) => {
    const stamp = new Date().toISOString();
    setRoles((prev) => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      return prev.map((r) =>
        orderMap.has(r.id) ? { ...r, order: orderMap.get(r.id)!, localModifiedAt: stamp } : r,
      );
    });
  }, [setRoles]);

  const handleCreateMitigationTaskFromRaid = useCallback(
    (raidItemId: number): number | null => {
      const item = raid.find((r) => r.id === raidItemId);
      if (!item) return null;
      const list = tasksRef.current;
      const newId =
        list.length > 0 ? Math.max(...list.map((tk) => tk.id)) + 1 : 1;
      const stamp = new Date().toISOString();
      const newTask: Task = {
        id: newId,
        taskName: item.title,
        assignee: item.owner ?? "",
        assigneeEmail: item.ownerEmail ?? "",
        dueDate: item.targetDate ?? today,
        lastUpdateDate: today,
        priority: "Medium",
        status: "To Do",
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
    [raid, setRaid, setTasks, today],
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

  const handleSetAllUtilizationMode = useCallback(
    (mode: "percent" | "hours") => {
      if (resources.every((r) => r.utilizationMode === mode)) return;
      const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) =>
          r.utilizationMode === mode
            ? r
            : {
                ...r,
                utilizationMode: mode,
                utilization: convertUtilization(r.utilization, r.utilizationMode, mode, periods, workdayHours, holidaySet),
                localModifiedAt: stamp,
              },
        ),
      );
    },
    [resources, plan, workdayHours, holidaySet, setResources],
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
    handleBulkEditResources,
    handleBulkDeleteResources,
    handleImportResources,
    handleSaveRaidItem,
    handleDeleteRaidItem,
    handleOpenAddAbsence,
    handleImportAbsences,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
    resolveOrCreateRole,
    handleSaveRole,
    handleDeleteRole,
    handleAssignResourceRole,
    handleAssignRoleById,
    handleClearResourceRole,
    handleAddDiscipline,
    handleRenameDiscipline,
    handleAddGrade,
    handleRenameGrade,
    onDeleteDiscipline,
    onDeleteGrade,
    onReorderDisciplines,
    onReorderGrades,
    onReorderRoles,
    handleSetUtilization,
    handleSetAllUtilizationMode,
    handleSetAbsenceOverride,
    handleSetPlanWindow,
    handleSetPlanGranularity,
  };
}
