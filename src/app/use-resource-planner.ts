"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { nextRaidId } from "./raid";
import { resolveEntitySave } from "./entity-id-mint";
import { reportSilentFailure } from "./guard-feedback";
import { buildRaidInquiryMailto, resolveRaidOwnerEmail } from "./raid-inquiry";
import { mintId } from "./id-mint-session";
import { useCalendarEvents } from "./use-calendar-events";
import { useReferenceData } from "./use-reference-data";
import { plainSeed, useResourceDirectory } from "./use-resource-directory";
import { generatePeriods, convertUtilization } from "./resource-capacity";
import { DEFAULT_WEEK_HOURS, type Absence, type AbsenceType, type RaidItem, type Shift, type Task } from "./types";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { useWorkspace } from "./workspace-context";
import { isValidEmail } from "./sanitize";
import { descriptionHtml } from "./rich-text-plain";
import { eventsToAbsences, type AbsenceImportTarget, type OutlookEvent } from "./outlook-calendar";
import { type UndoStackApi } from "./undo/use-undo-stack";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { RAID_UNDO_GROUPS } from "./undo/field-groups";

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
  /** Capture a MULTI-array pre-op snapshot for undo — reference-data deletes
   *  (role/discipline/grade) that cascade an edit into a second array. */
  captureComposite?: UndoStackApi["captureComposite"];
  /** Capture per-field edits for undo (RAID/resource modal save). */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
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
    plan,
    setPlan,
  } = useWorkspace();

  const { workdayHours, holidaySet, today } = args;

  const langRef = useRef(args.lang);
  const logActivityRef = useRef(args.logActivity);
  const captureRef = useRef(args.capture);
  useEffect(() => { captureRef.current = args.capture; }, [args.capture]);
  const captureFieldEditRef = useRef(args.captureFieldEdit);
  useEffect(() => { captureFieldEditRef.current = args.captureFieldEdit; }, [args.captureFieldEdit]);
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
    (item: RaidItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => {
      const stamp = new Date().toISOString();
      const { create, id } = resolveEntitySave(raid, item.id, isNew, () => nextRaidId(raid));
      // Only a genuine UPDATE of an existing Risk can auto-raise an Issue; a create
      // (re-minted id) has no meaningful `previous`.
      const previous = create ? undefined : raid.find((r) => r.id === id);
      // ★★★ `noteLog` from the STORED row, never the payload — it is write-through
      // and the editor's snapshot goes stale. Read open-followups §48 before editing.
      const withStamp: RaidItem = { ...item, id, localModifiedAt: stamp, ...(create ? {} : { noteLog: previous?.noteLog }) };
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

      if (!create && previous && !opts?.suppressFieldUndo) {
        captureFieldChanges(captureFieldEditRef.current, {
          setter: setRaid, kind: "raid.updated", id,
          prev: previous, next: withStamp, groups: RAID_UNDO_GROUPS,
          stampField: "localModifiedAt", name: item.title,
        });
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
      if (removed) captureRef.current?.({ setter: setRaid, kind: "raid.deleted", removed: [removed], fromArray: raid, name: removed.title });
      setRaid((prev) => prev.filter((r) => r.id !== id));
      if (removed) {
        logActivityRef.current("raid.deleted", id, removed.category, removed.title);
      }
    },
    [raid, setRaid],
  );

  // Send a status-inquiry email to a RAID item's owner (mirrors the task
  // `onSendInquiry`): resolve the owner's LIVE email, open a mailto, and bump
  // `inquiriesSent` via a FUNCTIONAL setter (the bulk-edit landmine — a stale
  // closure value would drop concurrent bumps).
  const handleSendRaidInquiry = useCallback(
    (item: RaidItem) => {
      const lang = langRef.current;
      const byId = new Map(resources.map((r) => [r.id, r]));
      let email = resolveRaidOwnerEmail(item, byId);
      if (!email && isValidEmail(item.owner ?? "")) email = (item.owner ?? "").trim();
      if (!email) {
        const provided = window.prompt(t(lang, "promptEmail", item.owner || item.title), "");
        if (provided === null) return;
        const trimmed = provided.trim();
        if (!isValidEmail(trimmed)) {
          window.alert(t(lang, "errorInvalidEmail"));
          return;
        }
        email = trimmed;
        setRaid((prev) => prev.map((r) => (r.id === item.id ? { ...r, ownerEmail: trimmed } : r)));
      }
      window.location.href = buildRaidInquiryMailto(item, email, lang);
      setRaid((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, inquiriesSent: (r.inquiriesSent ?? 0) + 1 } : r)),
      );
    },
    [resources, setRaid],
  );

  // Snapshot the selected RAID rows' pre-edit images before a bulk apply loops
  // the per-row save handler; call BEFORE the loop mutates them.
  const captureRaidBulkUndo = useCallback((ids: readonly number[]) => {
    const edited = raid.filter((r) => ids.includes(r.id));
    if (edited.length) captureRef.current?.({ setter: setRaid, kind: "bulk.edit", edited, fromArray: raid, entityKey: "raid" });
  }, [raid, setRaid]);

  const handleOpenAddAbsence = useCallback(
    (seed?: Partial<Absence>) => {
      const nextId = mintId("absence", absences);
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
      if (removed) captureRef.current?.({ setter: setAbsences, kind: "absence.deleted", removed: [removed], fromArray: absences, name: removed.assignee });
      setAbsences((prev) => prev.filter((a) => a.id !== id));
      if (removed) {
        logActivityRef.current("absence.deleted", id, removed.assignee);
      }
      setEditingAbsence(null);
    },
    [absences, setAbsences],
  );

  // CRUD extracted to use-calendar-events.ts (useChangeLog/useStakeholders convention).
  const calendarEventsApi = useCalendarEvents({ today, logActivity: args.logActivity, logActivityChanges: args.logActivityChanges, capture: args.capture, captureFieldEdit: args.captureFieldEdit });

  // Reference-data (roles/disciplines/grades) CRUD extracted to use-reference-data.ts.
  const referenceDataApi = useReferenceData({ logActivity: args.logActivity, captureComposite: args.captureComposite, logUpdate });

  // Resource-directory CRUD (create/edit/delete/bulk/import) extracted to use-resource-directory.ts.
  const resourceDirectoryApi = useResourceDirectory({ lang: args.lang, logActivity: args.logActivity, showToast: args.showToast, capture: args.capture, captureComposite: args.captureComposite, captureFieldEdit: args.captureFieldEdit, logUpdate });

  const handleOpenShiftEditor = useCallback(
    (existing: Shift | null, seed: { display: string; email: string }) => {
      if (existing) {
        setEditingShift({ shift: existing, isNew: false });
        return;
      }
      const nextId = mintId("shift", shifts);
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
      if (removed) captureRef.current?.({ setter: setShifts, kind: "shift.deleted", removed: [removed], fromArray: shifts, name: removed.assignee });
      setShifts((prev) => prev.filter((s) => s.id !== id));
      if (removed) {
        logActivityRef.current("shift.deleted", id, removed.assignee);
      }
      setEditingShift(null);
    },
    [shifts, setShifts],
  );

  const handleCreateMitigationTaskFromRaid = useCallback(
    (raidItemId: number): number | null => {
      const item = raid.find((r) => r.id === raidItemId);
      if (!item) return null;
      const list = tasksRef.current;
      const newId = mintId("task", list);
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
        // Both fields are rich HTML since slice B: UPGRADE (pass HTML through,
        // wrap legacy plain text) instead of escaping an already-HTML value a
        // second time, which would render markup as visible text.
        // ★★★ The sink is the DESTINATION field's, never the SOURCE field's. The
        // source is a RAID `mitigation`/`description` (a "template" field, 11
        // tags) but the value lands in `Task.description`, whose human save runs
        // sanitizeNoteHtml — 8 tags at KEEP_CONTENT: false, which deletes an
        // unlisted element TOGETHER WITH its text. Classifying by the source
        // would copy an AI-authored <h1>/<h2>/<u> through as live markup and the
        // first human Save would silently delete those words, with no undo.
        // ★★★ SCOPE — THE SINK CLOSES ONLY THE LEADING-TAG CASE, and an earlier
        // wording of this comment claimed the whole class. `descriptionHtml`
        // classifies on the value's FIRST tag, so a disallowed tag sitting
        // MID-VALUE is invisible to it: both sinks see the leading <p>, both
        // store the same live markup, and the save deletes the words either way.
        // Measured 2026-08-10 through the real exported sanitizers:
        //   A leading  "<h2>Plan</h2><p>steps</p>"
        //     "template" stored as-is        -> save "<p>steps</p>"        Plan GONE
        //     "note"     stored escaped      -> save unchanged             Plan KEPT  <- what this fixes
        //   B mid-value "<p>Intro</p><h2>Plan</h2><p>steps</p>"
        //     "template" stored as-is        -> save "<p>Intro</p><p>steps</p>"  Plan GONE
        //     "note"     stored as-is        -> save "<p>Intro</p><p>steps</p>"  Plan GONE  <- UNCHANGED
        // Case B needs the value SANITIZED to the destination's allow-list at the
        // copy, not merely classified against it. Tracked in open-followups §137,
        // which carries the same measurement and the whole-program closure.
        description: descriptionHtml(item.mitigation ?? item.description ?? "", "rich"),
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

  const handleSetBudgetFollowsPlan = useCallback(
    (v: boolean) => {
      setPlan((prev) => ({ ...prev, budgetFollowsPlan: v }));
    },
    [setPlan],
  );

  return {
    editingAbsence,
    editingShift,
    ...resourceDirectoryApi,
    handleSaveRaidItem,
    handleDeleteRaidItem,
    handleSendRaidInquiry,
    captureRaidBulkUndo,
    handleOpenAddAbsence,
    handleImportAbsences,
    handleEditAbsence,
    handleCloseAbsenceModal,
    handleSaveAbsence,
    handleDeleteAbsence,
    ...calendarEventsApi,
    handleOpenShiftEditor,
    handleCloseShiftModal,
    handleSaveShift,
    handleDeleteShift,
    handleCreateMitigationTaskFromRaid,
    ...referenceDataApi,
    handleSetUtilization,
    handleSetAllUtilizationMode,
    handleSetAbsenceOverride,
    handleSetPlanWindow,
    handleSetPlanGranularity,
    handleSetBudgetFollowsPlan,
  };
}
