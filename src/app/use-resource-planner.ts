"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { nextRaidId } from "./raid";
import { resolveEntitySave } from "./entity-id-mint";
import { reportSilentFailure } from "./guard-feedback";
import { nextId, resourceDisplayName } from "./resource-foundation";
import { generatePeriods, convertUtilization } from "./resource-capacity";
import { DEFAULT_WEEK_HOURS, type Absence, type RaidItem, type Resource, type Role, type Shift, type Task } from "./types";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { useWorkspace } from "./workspace-context";
import { sanitizeResource } from "./sanitize";
import { mergeImportedResources, type OutlookContact } from "./outlook-contacts";
import { eventsToAbsences, type AbsenceImportTarget, type OutlookEvent } from "./outlook-calendar";
import type { AbsenceType } from "./types";
import type { UndoStackApi } from "./undo/use-undo-stack";

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
  /** Capture a pre-op snapshot for undo (RAID/absence/shift delete, resource bulk-edit). */
  capture?: UndoStackApi["capture"];
}

/** True when an absence/shift belongs to one of the removed resources — by
 *  stable resourceId first, else case-folded assignee name or email (the same
 *  join the calendar/workload rows use). Lets a resource delete cascade to its
 *  calendar entries so no ghost row (fed by the orphan absence) survives.
 *  The name/email fallback is SKIPPED when a SURVIVING resource shares that key
 *  (e.g. two people named "John Smith") so a delete never sweeps a twin's
 *  entries — only the precise resourceId match deletes in that ambiguous case. */
function recordMatchesRemoved(
  rec: { assignee?: string; assigneeEmail?: string; resourceId?: number | null },
  ids: ReadonlySet<number>,
  names: ReadonlySet<string>,
  emails: ReadonlySet<string>,
  survivingNames: ReadonlySet<string>,
  survivingEmails: ReadonlySet<string>,
): boolean {
  if (rec.resourceId != null && ids.has(rec.resourceId)) return true;
  const n = (rec.assignee ?? "").trim().toLowerCase();
  if (n && names.has(n) && !survivingNames.has(n)) return true;
  const e = (rec.assigneeEmail ?? "").trim().toLowerCase();
  return !!e && emails.has(e) && !survivingEmails.has(e);
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
  const captureRef = useRef(args.capture);
  useEffect(() => { captureRef.current = args.capture; }, [args.capture]);
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

  // isNew carries the modal's create/edit intent so a create can't be misread as
  // an update and clobber a row committed since the modal opened (id-mint race).
  // Non-modal callers (bulk edit) omit it → id-existence fallback (unchanged).
  const handleSaveRaidItem = useCallback(
    (item: RaidItem, isNew?: boolean) => {
      const stamp = new Date().toISOString();
      const { create, id } = resolveEntitySave(raid, item.id, isNew, () => nextRaidId(raid));
      const withStamp: RaidItem = { ...item, id, localModifiedAt: stamp };
      // Only a genuine UPDATE of an existing Risk can auto-raise an Issue; a create
      // (re-minted id) has no meaningful `previous`.
      const previous = create ? undefined : raid.find((r) => r.id === id);
      // Editing a row a concurrent writer already deleted: the map-replace below
      // would silently no-op. Surface it instead of dropping the edit in silence.
      if (!create && !previous) {
        reportSilentFailure(showToastRef.current, langRef.current, "raid.editVanished", "concurrent delete during edit", "guardEditVanished");
        return;
      }

      const triggersAutoIssue =
        previous !== undefined &&
        item.category === "R" &&
        previous.status !== "Realized" &&
        item.status === "Realized" &&
        !raid.some((r) => r.category === "I" && r.causedByRaidIds.includes(id));

      let autoIssueId: number | null = null;
      let autoIssue: RaidItem | null = null;
      if (triggersAutoIssue) {
        // Derive the auto-issue id off the closure WITH this update applied so it
        // can't collide with the item being saved.
        const baseList = raid.map((r) => (r.id === id ? withStamp : r));
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
          causedByRaidIds: [id],
          stakeholderIds: [],
          raisedDate: today,
          targetDate: item.targetDate,
          localModifiedAt: stamp,
        };
      }

      // Functional updater so bulk (N saves in one tick) composes instead of each
      // call clobbering the last.
      setRaid((prev) => {
        const base = create ? [...prev, withStamp] : prev.map((r) => (r.id === id ? withStamp : r));
        return autoIssue ? [...base, autoIssue] : base;
      });
      if (autoIssue) {
        showToastRef.current(
          "info",
          t(langRef.current, "raidAutoCreatedIssue", id, autoIssueId ?? 0),
        );
      }

      if (create) {
        logActivityRef.current("raid.created", id, item.category, item.title);
      } else if (previous && previous.status !== item.status) {
        logActivityRef.current("raid.statusChanged", id, previous.status, item.status);
      } else {
        logUpdate("raid.updated", previous, withStamp, id, item.category, item.title);
      }
      if (autoIssueId !== null) {
        logActivityRef.current("raid.autoIssue", id, autoIssueId);
      }
    },
    [raid, setRaid, today, logUpdate],
  );

  const handleDeleteRaidItem = useCallback(
    (id: number) => {
      const removed = raid.find((r) => r.id === id);
      if (removed) captureRef.current?.({ setter: setRaid, kind: "raid.deleted", before: [removed], fromArray: raid });
      setRaid((prev) => prev.filter((r) => r.id !== id));
      if (removed) {
        logActivityRef.current("raid.deleted", id, removed.category, removed.title);
      }
    },
    [raid, setRaid],
  );

  // Snapshot the selected RAID rows' pre-edit images before a bulk apply loops
  // the per-row save handler; call BEFORE the loop mutates them.
  const captureRaidBulkUndo = useCallback((ids: readonly number[]) => {
    const before = raid.filter((r) => ids.includes(r.id));
    if (before.length) captureRef.current?.({ setter: setRaid, kind: "bulk.edit", before, fromArray: raid });
  }, [raid, setRaid]);

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
      if (removed) captureRef.current?.({ setter: setAbsences, kind: "absence.deleted", before: [removed], fromArray: absences });
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
      if (removed) captureRef.current?.({ setter: setShifts, kind: "shift.deleted", before: [removed], fromArray: shifts });
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
        // Editing a row a concurrent writer already deleted: the map-replace below
        // would silently no-op. Surface it instead of dropping the edit in silence.
        if (!previous) {
          reportSilentFailure(showToastRef.current, langRef.current, "resource.editVanished", "concurrent delete during edit", "guardEditVanished");
          setEditingResource(null);
          return;
        }
        const withStamp: Resource = { ...next, localModifiedAt: stamp };
        setResources((prev) => prev.map((r) => (r.id === next.id ? withStamp : r)));
        setEditingResource(null);
        logUpdate("resource.updated", previous, withStamp, next.id, name);
      }
    },
    [resources, setResources, logUpdate, editingResource],
  );

  // Cascade a resource removal to its calendar entries: drop every absence and
  // shift that belongs to a removed resource (else the orphan absence, joined by
  // name, keeps re-creating a ghost calendar row). Functional setters.
  const purgeCalendarFor = useCallback(
    (removed: readonly Resource[], surviving: readonly Resource[]) => {
      if (removed.length === 0) return;
      const ids = new Set(removed.map((r) => r.id));
      const names = new Set(
        removed.map((r) => resourceDisplayName(r).trim().toLowerCase()).filter(Boolean),
      );
      const emails = new Set(
        removed.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean),
      );
      // Keys still owned by a resource that ISN'T being deleted — never sweep a
      // surviving twin's entries on a name/email collision.
      const survivingNames = new Set(
        surviving.map((r) => resourceDisplayName(r).trim().toLowerCase()).filter(Boolean),
      );
      const survivingEmails = new Set(
        surviving.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean),
      );
      setAbsences((prev) =>
        prev.filter((a) => !recordMatchesRemoved(a, ids, names, emails, survivingNames, survivingEmails)),
      );
      setShifts((prev) =>
        prev.filter((s) => !recordMatchesRemoved(s, ids, names, emails, survivingNames, survivingEmails)),
      );
    },
    [setAbsences, setShifts],
  );

  const handleDeleteResource = useCallback(
    (id: number) => {
      const removed = resources.find((r) => r.id === id);
      const surviving = resources.filter((r) => r.id !== id);
      setResources(surviving);
      setEditingResource(null);
      if (removed) {
        purgeCalendarFor([removed], surviving);
        const name = `${removed.firstName} ${removed.lastName}`.trim();
        logActivityRef.current("resource.deleted", id, name);
      }
    },
    [resources, setResources, purgeCalendarFor],
  );

  // Bulk edit: merge the same patch into every selected resource in ONE
  // functional set (the N-saves-per-tick landmine — a non-functional setter
  // would drop all but the last).
  const handleBulkEditResources = useCallback(
    (ids: readonly number[], patch: Partial<Resource>) => {
      const idSet = new Set(ids);
      const stamp = new Date().toISOString();
      const affected = resources.filter((r) => idSet.has(r.id));
      if (affected.length > 0) captureRef.current?.({ setter: setResources, kind: "bulk.edit", before: affected, fromArray: resources });
      setResources((prev) =>
        prev.map((r) => {
          if (!idSet.has(r.id)) return r;
          const merged: Resource = { ...r, ...patch, localModifiedAt: stamp };
          // Route through the single validator so bulk-edited text fields get the
          // same caps the load path applies (never unbounded in JSON/IDB); the
          // merge keeps names intact so it can't return null, but fall back defensively.
          return sanitizeResource(merged) ?? merged;
        }),
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
      const surviving = resources.filter((r) => !idSet.has(r.id));
      setResources((prev) => prev.filter((r) => !idSet.has(r.id)));
      setEditingResource(null);
      purgeCalendarFor(removed, surviving);
      for (const r of removed) {
        logActivityRef.current("resource.deleted", r.id, `${r.firstName} ${r.lastName}`.trim());
      }
    },
    [resources, setResources, purgeCalendarFor],
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
    captureRaidBulkUndo,
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
